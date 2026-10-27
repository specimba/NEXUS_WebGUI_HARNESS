# r622: salvage what reads, rebuild a clean image.
# Evidence: main file (Sep 14) integrity-ok but 2 tables; live pair (main+Oct WAL)
# serves most reads (frontier API ok) but fails on AutomationState pages
# ("database disk image is malformed", ext 11). Strategy: open the pair
# read-only, replay schema DDL, copy every readable table's rows, report the
# unreadable ones honestly. Never destructive — db/*.corrupt-backup-* exist.
import sqlite3, os, sys

SRC = "file:/home/z/my-project/db/custom.db?mode=ro"
DST = "/home/z/my-project/db/custom.db.salvaged-r622"

if os.path.exists(DST):
    os.remove(DST)

src = sqlite3.connect(SRC, uri=True)
dst = sqlite3.connect(DST)

objs = src.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name"
).fetchall()

salvaged, failed = [], []
for typ, name, ddl in objs:
    # DDL first (tables before rows; indexes after rows is fine via order)
    pass

# create tables first
for typ, name, ddl in objs:
    if typ == "table":
        try:
            dst.execute(ddl)
        except Exception as e:
            print(f"[ddl-fail:{typ}:{name}] {str(e)[:100]}")
            failed.append((typ, name, "ddl"))

# copy rows
for typ, name, ddl in objs:
    if typ != "table":
        continue
    if any(f == name and r == "ddl" for t, f, r in failed):
        continue
    try:
        cols = [r[1] for r in src.execute(f'PRAGMA table_info("{name}")').fetchall()]
        rows = src.execute(f'SELECT * FROM "{name}"').fetchall()
        ph = ",".join("?" * len(cols))
        dst.executemany(f'INSERT INTO "{name}" VALUES ({ph})', rows)
        salvaged.append((name, len(rows)))
    except Exception as e:
        failed.append((typ, name, "rows"))
        print(f"[rows-fail:{name}] {str(e)[:110]}")

# indexes/triggers/views after rows
for typ, name, ddl in objs:
    if typ in ("index", "trigger", "view"):
        try:
            dst.execute(ddl)
        except Exception as e:
            print(f"[ddl-fail:{typ}:{name}] {str(e)[:100]}")

dst.commit()
ic = dst.execute("PRAGMA integrity_check;").fetchall()
print("[new-db integrity]", str(ic)[:120])

print(f"[SALVAGED {len(salvaged)}]")
for name, n in salvaged:
    print(f"  ok {name}={n}")
print(f"[FAILED {len(failed)}]")
for typ, name, why in failed:
    print(f"  FAIL {name} ({why})")
src.close()
dst.close()
sys.exit(0 if ic == [("ok",)] else 1)
