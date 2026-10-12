#!/usr/bin/env python3
"""r380 QA: vault backup export/import round-trip — live witness.

Exercises GET/POST /api/vault/backup against the running server:
  1. export shape: ok/app/version/exportedAt/slots with RAW keys
  2. import a QA slot -> imported:1; re-import (idempotent upsert) -> imported:1
  3. exported doc re-import round-trip: export -> import -> counts honest
  4. validation: non-array slots / empty / missing key -> 400 or skipped count
  5. non-local guard (spoofed x-forwarded-for) -> 403 on GET and POST
  6. consume route still works after the localGuard extraction (refactor check)
Repo state discipline: vault table snapshotted before, restored byte-for-byte after.
"""
import io, json, sqlite3, sys, urllib.request, urllib.error

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
QA_PROVIDER = "qa380-roundtrip-slot"
QA_KEY = "qa380-raw-key-value-abcdefghijklmnop"

results = []

def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASS" if cond else "FAIL"), "-", name, ("| " + str(detail)) if detail else "")

def req(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method)
    r.add_header("content-type", "application/json")
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}

def vault_rows():
    con = sqlite3.connect(DB)
    rows = con.execute(
        "SELECT provider, label, key, createdAt, updatedAt FROM automationVault ORDER BY provider"
    ).fetchall()
    con.close()
    return rows

before = vault_rows()
print(f"vault rows before: {len(before)} (providers: {[r[0] for r in before]})")

try:
    # 1. export shape + raw key present
    st, exp = req("GET", "/api/vault/backup")
    check("export 200", st == 200, st)
    check("export markers", exp.get("ok") is True and exp.get("app") == "praison-automation-vault"
          and exp.get("version") == 1 and bool(exp.get("exportedAt")))
    slots = exp.get("slots") or []
    check("export slots match DB", sorted(s.get("provider") for s in slots) == sorted(r[0] for r in before),
          [s.get("provider") for s in slots])
    check("export carries RAW keys", all(isinstance(s.get("key"), str) and len(s["key"]) > 0 for s in slots))
    by_prov = {s["provider"]: s for s in slots}
    check("export key matches DB byte-for-byte",
          all(by_prov[r[0]]["key"] == r[2] for r in before if r[0] in by_prov))

    # 2. import QA slot -> imported:1 ; idempotent re-import -> imported:1 (upsert)
    doc = {"app": "praison-automation-vault", "version": 1, "slots":
           [{"provider": QA_PROVIDER, "key": QA_KEY, "label": "r380 QA"}]}
    st, imp = req("POST", "/api/vault/backup", doc)
    check("import QA slot 200 imported:1", st == 200 and imp.get("imported") == 1 and imp.get("skipped") == 0, imp)
    st, imp2 = req("POST", "/api/vault/backup", doc)
    check("re-import idempotent imported:1", st == 200 and imp2.get("imported") == 1, imp2)
    st, exp2 = req("GET", "/api/vault/backup")
    got = {s["provider"]: s for s in exp2.get("slots", [])}.get(QA_PROVIDER, {})
    check("QA slot landed with raw key", got.get("key") == QA_KEY and got.get("label") == "r380 QA")

    # 3. full round-trip: export -> re-import the WHOLE document (empty base
    #    vaults must round-trip the QA slot itself; the restore cleans up)
    rt_doc = {"app": "praison-automation-vault", "version": 1,
              "slots": exp2.get("slots", [])}
    st, rt = req("POST", "/api/vault/backup", rt_doc)
    check("round-trip re-import counts", st == 200 and rt.get("imported") == len(rt_doc["slots"])
          and rt.get("skipped") == 0, rt)

    # 4. validation
    st, _ = req("POST", "/api/vault/backup", {"slots": "nope"})
    check("non-array slots -> 400", st == 400, st)
    st, _ = req("POST", "/api/vault/backup", {"slots": []})
    check("empty slots -> 400", st == 400, st)
    st, _ = req("POST", "/api/vault/backup", {"nope": True})
    check("missing slots -> 400", st == 400, st)
    st, mixed = req("POST", "/api/vault/backup", {"slots": [
        {"provider": "ok-but-qa", "key": "k"}, {"provider": ""}, {"key": "no-provider"}, "junk"]})
    check("mixed doc -> imported:1 skipped:3", st == 200 and mixed.get("imported") == 1
          and mixed.get("skipped") == 3, mixed)

    # 5. localhost guard (same trust model as consume)
    spoof = {"x-forwarded-for": "203.0.113.9"}
    st, _ = req("GET", "/api/vault/backup", headers=spoof)
    check("export spoofed -> 403", st == 403, st)
    st, _ = req("POST", "/api/vault/backup", doc, headers=spoof)
    check("import spoofed -> 403", st == 403, st)

    # 6. consume route still healthy after guard extraction
    if before:
        st, cons = req("POST", "/api/vault/consume", {"provider": before[0][0]})
        check("consume still 200 + raw key", st == 200 and cons.get("key") == before[0][2], (st, cons.get("provider")))
    else:
        st, cons = req("POST", "/api/vault/consume", {"provider": QA_PROVIDER})
        check("consume still 200 + raw key", st == 200 and cons.get("key") == QA_KEY, st)
    st, _ = req("POST", "/api/vault/consume", {"provider": "x"}, headers=spoof)
    check("consume guard intact", st == 403, st)
finally:
    # restore vault table byte-for-byte
    con = sqlite3.connect(DB)
    con.execute("DELETE FROM automationVault")
    con.executemany(
        "INSERT INTO automationVault (provider, label, key, createdAt, updatedAt) VALUES (?,?,?,?,?)",
        before,
    )
    con.commit()
    con.close()
    after = vault_rows()
    check("vault restored byte-for-byte", after == before,
          f"{len(before)} -> {len(after)} rows")

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
