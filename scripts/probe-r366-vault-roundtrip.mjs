// ─── r366: Vault consume round-trip live probe ──────────────────────────────
// Closes the long-carried risk "vault consume round-trip live-unverified":
// dials the REAL API (zero LLM dials) and verifies the full contract the way
// the Settings UI "Test key" button does — store a slot, GET the masked
// preview, POST /api/vault/consume for the raw key, and mask-compare.
// Also live-triggers all five localhost-guard 403 paths (host, x-forwarded-
// host, x-forwarded-for, forwarded, x-real-ip), the 404/400 honest copies,
// upsert swap, the mask boundary (12 chars → 8 bullets), and cleanup.
//
// Rerunnable: node scripts/probe-r366-vault-roundtrip.mjs [BASE]
//   exit 0 = all assertions pass; 1 = drift; 2 = server unreachable.
// Uses node:http (not fetch) so the Host-header override is unambiguous.

import http from "node:http";

const BASE = process.argv[2] || "http://localhost:3000";
const P = "probe-r366";
const K_LONG = "probekey-r366-abcdefghijklmnopqrstuvwxyz123456";
const K_SHORT = "shorty12345"; // 11 chars
const K_BOUND = "abcdefghijkl"; // exactly 12 chars — MASK_MIN boundary, NOT masked-preview form

// Same mask contract as src/app/api/vault/route.ts (MASK_MIN=12, strict >):
const mask = (k) => (k.length > 12 ? `${k.slice(0, 4)}••••${k.slice(-4)}` : "••••••••");
const BULLETS = "••••••••";

function req(method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      }
    );
    r.on("error", reject);
    r.setTimeout(15000, () => r.destroy(new Error("request timed out")));
    if (body) r.write(body);
    r.end();
  });
}

const postJson = (path, obj, headers = {}) =>
  req("POST", path, {
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(obj),
  });

let pass = 0;
let fail = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — got: ${detail}` : ""}`);
  }
}
const j = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

// Preflight: server reachable? (exit 2 = skip, not drift)
try {
  await req("GET", "/api/vault");
} catch (e) {
  console.log(`SKIP  server unreachable at ${BASE} (${e.message}) — run when the app is up`);
  process.exit(2);
}

// ── 0. Pre-clean (rerunnable: remove any leftover from a crashed run)
const pre0 = j((await req("DELETE", `/api/vault?provider=${P}`)).body);
ok("pre-clean delete ok", pre0?.ok === true, JSON.stringify(pre0));
const pre1 = j((await req("GET", "/api/vault")).body);
ok("pre-clean slot absent", Array.isArray(pre1?.vault) && !pre1.vault.some((s) => s.provider === P));

// ── 1. Store: POST /api/vault {provider,key,label} → masked ack
const s1 = await postJson("/api/vault", { provider: P, key: K_LONG, label: "r366 probe" });
const b1 = j(s1.body);
ok("store 200", s1.status === 200, `${s1.status} ${s1.body.slice(0, 120)}`);
ok("store ok:true + provider echo", b1?.ok === true && b1?.provider === P);
ok("store maskedKey = first4+••••+last4", b1?.maskedKey === mask(K_LONG), JSON.stringify(b1?.maskedKey));

// ── 2. GET /api/vault: slot visible, masked-only, metadata intact
const g1 = j((await req("GET", "/api/vault")).body);
const slot = g1?.vault?.find((s) => s.provider === P);
ok("get slot present", !!slot);
ok("get maskedKey matches ack", slot?.maskedKey === mask(K_LONG));
ok("get label round-trips", slot?.label === "r366 probe");
ok("get createdAt+updatedAt present", !!slot?.createdAt && !!slot?.updatedAt);
ok("get never returns raw key", JSON.stringify(g1).includes(K_LONG) === false);

// ── 3. Consume: raw key handoff + mask-compare (the Test-key round-trip)
const c1 = await postJson("/api/vault/consume", { provider: P });
const bc1 = j(c1.body);
ok("consume 200", c1.status === 200, `${c1.status} ${c1.body.slice(0, 120)}`);
ok("consume raw key matches stored", bc1?.key === K_LONG);
ok("mask-compare: mask(raw) === displayed preview", mask(bc1?.key ?? "") === slot?.maskedKey);
ok("consume echoes provider+updatedAt", bc1?.provider === P && !!bc1?.updatedAt);

// ── 4. Consume is a reusable handoff (r154 reveal re-dials it) — not one-time
const c2 = await postJson("/api/vault/consume", { provider: P });
ok("consume reuse 200 + same key", c2.status === 200 && j(c2.body)?.key === K_LONG);

// ── 5. Localhost guard: all five 403 paths, live-triggered, before key lookup
const guardBody = async (headers) => {
  const r = await postJson("/api/vault/consume", { provider: P }, headers);
  return { status: r.status, b: j(r.body) };
};
{
  const { status, b } = await guardBody({ Host: "evil.example.com" });
  ok("guard non-local Host → 403", status === 403 && String(b?.error || "").startsWith("consume is localhost-only (non-local host"), `${status} ${JSON.stringify(b)}`);
}
{
  const { status, b } = await guardBody({ "x-forwarded-host": "tracker.example.com" });
  ok("guard x-forwarded-host → 403", status === 403 && String(b?.error || "").includes("x-forwarded-host"), `${status} ${JSON.stringify(b)}`);
}
{
  const { status, b } = await guardBody({ "x-forwarded-for": "203.0.113.9" });
  ok("guard x-forwarded-for → 403", status === 403 && String(b?.error || "").includes("x-forwarded-for"), `${status} ${JSON.stringify(b)}`);
}
{
  const { status, b } = await guardBody({ forwarded: "for=203.0.113.9" });
  ok("guard any forwarded header → 403", status === 403 && String(b?.error || "").includes("forwarded header"), `${status} ${JSON.stringify(b)}`);
}
{
  const { status, b } = await guardBody({ "x-real-ip": "203.0.113.9" });
  ok("guard x-real-ip → 403", status === 403 && String(b?.error || "").includes("x-real-ip"), `${status} ${JSON.stringify(b)}`);
}

// ── 6. Honest failure copies: 404 unknown slot, 400 empty provider
{
  const r = await postJson("/api/vault/consume", { provider: "probe-r366-missing" });
  const b = j(r.body);
  ok("consume unknown → 404 honest copy", r.status === 404 && String(b?.error || "").startsWith("no vault key stored for provider"), `${r.status} ${r.body.slice(0, 120)}`);
}
{
  const r = await postJson("/api/vault/consume", { provider: "" });
  ok("consume empty provider → 400", r.status === 400 && j(r.body)?.error === "provider required", `${r.status} ${r.body.slice(0, 120)}`);
}
{
  const r = await postJson("/api/vault", { provider: P, key: "" });
  ok("vault store missing key → 400", r.status === 400 && j(r.body)?.error === "provider and key are required", `${r.status} ${r.body.slice(0, 120)}`);
}

// ── 7. Upsert swap + mask boundary (12 chars = exactly MASK_MIN → 8 bullets)
{
  const r = await postJson("/api/vault", { provider: P, key: K_SHORT });
  ok("upsert short key → masked 8 bullets", r.status === 200 && j(r.body)?.maskedKey === BULLETS, `${r.status} ${r.body.slice(0, 120)}`);
  const c = await postJson("/api/vault/consume", { provider: P });
  ok("consume after swap returns new key", c.status === 200 && j(c.body)?.key === K_SHORT);
}
{
  const r = await postJson("/api/vault", { provider: P, key: K_BOUND });
  ok("boundary 12-char key → masked 8 bullets", r.status === 200 && j(r.body)?.maskedKey === BULLETS, `${r.status} ${r.body.slice(0, 120)}`);
  const c = await postJson("/api/vault/consume", { provider: P });
  ok("boundary key round-trips raw", c.status === 200 && j(c.body)?.key === K_BOUND);
}

// ── 8. Delete + verify gone (headless lane falls back to shared lane)
{
  const r = await req("DELETE", `/api/vault?provider=${P}`);
  const b = j(r.body);
  ok("delete 200 ok:true + provider echo", r.status === 200 && b?.ok === true && b?.provider === P, `${r.status} ${r.body.slice(0, 120)}`);
  const g = j((await req("GET", "/api/vault")).body);
  ok("post-delete slot absent", Array.isArray(g?.vault) && !g.vault.some((s) => s.provider === P));
  const c = await postJson("/api/vault/consume", { provider: P });
  ok("post-delete consume → 404", c.status === 404, `${c.status}`);
}

console.log(`\n${pass}/${pass + fail} assertions pass`);
process.exit(fail > 0 ? 1 : 0);
