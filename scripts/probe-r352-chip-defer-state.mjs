// r352 probe: the gateway pulse chip must (a) reflect the r351 two-lane ring
// honestly, (b) say "deferring fires" exactly when the r181 saturation gate
// is live — same signal, same math as the scheduler. Static pins + behavioral
// pins of the gate semantics the chip now surfaces.
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) pass++;
  else fails.push(label);
}

const chip = readFileSync(
  `${ROOT}src/components/nexus/workflows/gateway-pulse-chip.tsx`,
  "utf8"
);

// ── Static pins ─────────────────────────────────────────────────────────────
ok(
  chip.includes('import { gatewaySaturated } from "@/lib/gateway-cadence"'),
  "chip imports the SAME gate the scheduler uses"
);
ok(
  chip.includes("const deferring = pulse ? gatewaySaturated(pulse) : false;"),
  "deferring is computed from the gate math, not hand-rolled"
);
ok(
  chip.includes('{deferring ? " · deferring fires" : ""}'),
  "chip label gains '· deferring fires' while the gate is live"
);
ok(
  chip.includes('"; scheduled fires are being deferred"'),
  "aria-label names the deferral for screen readers"
);
ok(
  chip.includes('e.s === "browser-direct" ? "browser" : "relay"'),
  "recent lines carry a per-event lane tag [browser]/[relay]"
);
ok(
  !chip.includes("browser-direct keys are invisible here") &&
    !chip.includes("server-seen only"),
  "stale r161 'browser-direct invisible' caveat is GONE"
);
ok(
  chip.includes("The saturation gate is ACTIVE"),
  "tooltip explains the active deferral in plain words"
);
ok(
  chip.includes("Totals: ${relay24h} relay · ${browser24h} browser"),
  "tooltip splits relay vs browser totals"
);

// ── Behavioral: what 'deferring' MEANS (gate semantics the chip surfaces) ──
const { gatewaySaturated } = await import(`${ROOT}src/lib/gateway-cadence.ts`);
const now = Date.now();
ok(gatewaySaturated({ last429At: now - 5 * 60_000, count1h: 3 }) === true, "fresh wave + ≥3/h → deferring");
ok(gatewaySaturated({ last429At: now - 20 * 60_000, count1h: 5 }) === true === false || gatewaySaturated({ last429At: now - 20 * 60_000, count1h: 5 }) === false, "stale 429 (>10m) → NOT deferring (wave passed)");
ok(gatewaySaturated({ last429At: now - 5 * 60_000, count1h: 1 }) === false, "lone blip → NOT deferring (no stall on one 429)");
ok(gatewaySaturated({ last429At: null, count1h: 0 }) === false, "clean ring → NOT deferring");

console.log(`probe-r352-chip-defer-state: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("FAILED:\n - " + fails.join("\n - "));
  process.exit(1);
}
