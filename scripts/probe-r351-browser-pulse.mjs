// r351 probe: browser-direct 429s must reach the persistent gateway pulse.
// Static pins (three files) + LIVE round-trip against the running dev server
// (POST → GET → gate math), with teardown restoring the original pulse file
// (the server re-reads the file on every call — refresh() honors the restore).
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) pass++;
  else fails.push(label);
}

// ── 1. Static pins ──────────────────────────────────────────────────────────
const route = readFileSync(`${ROOT}src/app/api/gateway/pulse/route.ts`, "utf8");
ok(route.includes("export async function POST"), "route exports POST");
ok(
  route.includes('recordGateway429(model, "browser-direct")'),
  "POST records with browser-direct source"
);
ok(route.includes('status: 400'), "POST rejects invalid JSON with 400");

const runner = readFileSync(`${ROOT}src/lib/workflow-runner.ts`, "utf8");
const noteIdx = runner.indexOf("noteGateway429();");
const postIdx = runner.indexOf('void fetch("/api/gateway/pulse"');
ok(noteIdx !== -1 && postIdx > noteIdx, "runner POSTs the pulse right after noteGateway429");
ok(/void fetch\("\/api\/gateway\/pulse", \{[\s\S]{0,400}?\.catch\(\(\) => \{\}\)/.test(
  runner.slice(postIdx, postIdx + 600)
), "report is fire-and-forget (.catch no-op)");

const pulse = readFileSync(`${ROOT}src/lib/server/gateway-pulse.ts`, "utf8");
ok(pulse.includes('source: Gateway429Source = "relay"'), "recordGateway429 defaults to relay");
ok(pulse.includes("s?: Gateway429Source"), "event carries optional source tag");

// ── 2. Live round-trip (dev server :3000) ───────────────────────────────────
const BASE = "http://localhost:3000/api/gateway/pulse";
const PULSE_FILE = `${ROOT}db/gateway-pulse.json`;
let original = null;
try {
  original = readFileSync(PULSE_FILE, "utf8");
} catch {
  /* file may not exist yet */
}

const get = async () => (await fetch(BASE)).json();
try {
  const baseline = await get();
  const base1h = baseline.count1h ?? 0;

  for (let i = 0; i < 3; i++) {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "probe-r351-model" }),
    });
    ok(res.status === 202, `POST #${i + 1} → 202`);
  }

  const after = await get();
  ok(
    after.count1h >= base1h + 3,
    `count1h grew by the 3 reports (${base1h} → ${after.count1h})`
  );
  ok(
    typeof after.last429At === "number" && Date.now() - after.last429At < 30_000,
    "last429At is fresh (<30s)"
  );
  const last3 = (after.recent ?? []).slice(-3);
  ok(
    last3.length === 3 &&
      last3.every((e) => e.s === "browser-direct" && e.model === "probe-r351-model"),
    "recent tail carries s=browser-direct + the reported model id"
  );

  // THE fix contract: the r181 pre-fire gate now sees the browser wave.
  const { gatewaySaturatedFromEvents } = await import(
    `${ROOT}src/lib/gateway-cadence.ts`
  );
  ok(
    gatewaySaturatedFromEvents((after.recent ?? []).map((e) => ({ t: e.t }))) === true,
    "gatewaySaturatedFromEvents → true on the reported wave (the gate defers)"
  );

  // Hygiene: junk bodies never corrupt the ring.
  ok((await fetch(BASE, { method: "POST", body: "not-json" })).status === 400, "invalid JSON → 400");
  await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "x".repeat(300), evil: "sk-fake-key" }),
  });
  const afterJunk = await get();
  const lastJunk = (afterJunk.recent ?? []).slice(-1)[0];
  ok(
    lastJunk && lastJunk.model.length <= 120 && lastJunk.evil === undefined,
    "oversized model truncated; non-schema fields dropped"
  );
} finally {
  // Teardown: restore the probe's events away — the chip must not show them.
  if (original !== null) writeFileSync(PULSE_FILE, original, "utf8");
  else {
    try {
      writeFileSync(PULSE_FILE, JSON.stringify({ events: [] }), "utf8");
    } catch {}
  }
  const restored = await get();
  ok(
    !(restored.recent ?? []).some((e) => e.model === "probe-r351-model"),
    "teardown: probe events gone from the ring (file is source of truth)"
  );
}

console.log(`probe-r351-browser-pulse: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("FAILED:\n - " + fails.join("\n - "));
  process.exit(1);
}
