// r363 probe: local-route internal-failure hygiene.
// CONTRACT (not string shapes): raw infra errors never interpolate into
// response bodies; every failure site routes through localFailure(); the
// degraded body shapes and status codes survive byte-stable.
// Reads ROUTE FILES + HELPER only — never its own source (r349 lesson).
import { readFileSync } from "node:fs";

const ROOT = "/home/z/my-project";
const FILES = {
  helper: `${ROOT}/src/lib/local-failure.ts`,
  vault: `${ROOT}/src/app/api/vault/route.ts`,
  consume: `${ROOT}/src/app/api/vault/consume/route.ts`,
  sync: `${ROOT}/src/app/api/automation/sync/route.ts`,
  runnow: `${ROOT}/src/app/api/automation/run-now/route.ts`,
  tracker: `${ROOT}/src/app/api/tracker/route.ts`,
};
const src = {};
for (const [k, p] of Object.entries(FILES)) src[k] = readFileSync(p, "utf8");

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
const count = (hay, re) => (hay.match(re) || []).length;

// ── helper contract ──────────────────────────────────────────────────────────
ok("helper.exports-localFailure", /export function localFailure\(route: string, e: unknown, fallback: string\): string/.test(src.helper));
ok("helper.logs-raw-server-side", /console\.error\(/.test(src.helper));
ok("helper.returns-fallback-copy", /return fallback;/.test(src.helper));

// ── every route imports the policy ───────────────────────────────────────────
for (const k of ["vault", "consume", "sync", "runnow", "tracker"])
  ok(`import.${k}`, src[k].includes(`from "@/lib/local-failure"`));

// ── THE leak guard: no raw error text interpolation anywhere ─────────────────
const LEAK_PATTERNS = [/instanceof Error \? (e|err)\.message/, /String\((e|err)\)/];
for (const k of ["vault", "consume", "sync", "runnow", "tracker"])
  for (const re of LEAK_PATTERNS)
    ok(`no-leak.${k}.${re.source.slice(0, 24)}`, !re.test(src[k]));

// ── every failure site routes through the policy ─────────────────────────────
ok("site.vault-get", src.vault.includes('localFailure("vault:get"'));
ok("site.vault-post", src.vault.includes('localFailure("vault:post"'));
ok("site.vault-delete", src.vault.includes('localFailure("vault:delete"'));
ok("site.consume", src.consume.includes('localFailure("vault:consume"'));
ok("site.sync-post", src.sync.includes('localFailure("automation-sync:post"'));
ok("site.sync-get", src.sync.includes('localFailure("automation-sync:get"'));
ok("site.run-now", src.runnow.includes('localFailure("automation-run-now"'));
ok("site.tracker-get", src.tracker.includes('localFailure("tracker:get"'));
ok("site.tracker-post", src.tracker.includes('localFailure("tracker:post"'));

// ── degraded shapes survive byte-stable ──────────────────────────────────────
ok("shape.vault-get-degraded", /\{ vault: \[\], error: localFailure/.test(src.vault));
ok("shape.sync-get-degraded", /serverDriving: false, registry: \[\], runs: \[\], error: localFailure/.test(src.sync));
ok("shape.ok-false-error", count(src.vault + src.consume + src.sync + src.runnow, /\{ ok: false, error:/g) >= 8);

// ── status codes: 500s intact, exact per file ────────────────────────────────
ok("status.vault-3x500", count(src.vault, /status: 500/g) === 3);
ok("status.consume-1x500", count(src.consume, /status: 500/g) === 1);
ok("status.sync-2x500", count(src.sync, /status: 500/g) === 2);
ok("status.runnow-1x500", count(src.runnow, /status: 500/g) === 1);
ok("status.tracker-2x500", count(src.tracker, /status: 500/g) === 2);

// ── tracker POST pipeline actually wrapped (open + close) ────────────────────
ok("wrap.tracker-try-opens-before-db", /try \{[\s\S]{0,420}const overall = await db\.trackerMeta\.findUnique/.test(src.tracker));
ok("wrap.tracker-catch-closes-500", /} catch \(err\) \{[\s\S]{0,220}localFailure\("tracker:post"[\s\S]{0,120}status: 500/.test(src.tracker));

// ── regression pins (family contracts that must not silently move) ───────────
ok("pin.consume-localhost-guard", src.consume.includes("consume is localhost-only"));
ok("pin.vault-masking", src.vault.includes("MASK_MIN") && src.vault.includes("••••"));
ok("pin.sync-heartbeat-constant", src.sync.includes("HEARTBEAT_STALE_MS = 120_000"));
ok("pin.runnow-404-shape", src.runnow.includes("workflow not registered"));
ok("pin.tracker-csrf-403", src.tracker.includes("Cross-origin tracker sync is not allowed"));
ok("pin.sync-prune-guard-r234", src.sync.includes("pushHasEnabled"));

console.log(`probe-r363: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
