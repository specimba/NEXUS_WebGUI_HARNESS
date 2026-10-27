/**
 * r178 QA — park-policy (K-series).
 * Run: bun run scripts/qa-park-policy.ts
 * Covers: network/timeout park engagement, stall exemption, budget exhaustion,
 * non-transient kinds never park, delay curves escalate + cap + jitter bounds,
 * rate-limit curve unchanged from r158/r171 (5m/10m/20m/30m ±20%).
 */
import {
  MAX_NETWORK_PARKS,
  MAX_RATE_LIMIT_PARKS,
  maxParks,
  parkDelayMs,
  resolvePark,
} from "../src/lib/park-policy";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. Network deaths park (the r177 report's exact class) ──────────────────
check("network kind engages a network park",
  resolvePark("network", {}) === "network");
check("timeout kind engages a network park",
  resolvePark("timeout", {}) === "network");
check("network park consumes netParkCount, not parkCount",
  resolvePark("network", { netParkCount: 1, parkCount: 0 }) === "network");

// ── 2. Stall exemption (r72 contract) ────────────────────────────────────────
check("stall-owned network death does NOT park",
  resolvePark("network", {}, { stallOwned: true }) === null);
check("stall-owned timeout death does NOT park",
  resolvePark("timeout", {}, { stallOwned: true }) === null);

// ── 3. Budgets are separate and bounded ──────────────────────────────────────
check("network budget exhausted (3 parks) → no park",
  resolvePark("network", { netParkCount: MAX_NETWORK_PARKS }) === null);
check("rate-limit budget still available when network budget spent",
  resolvePark("rate-limit", { netParkCount: MAX_NETWORK_PARKS }) === "rate-limit");
check("network budget still available when quota budget spent",
  resolvePark("network", { parkCount: MAX_RATE_LIMIT_PARKS }) === "network");
check("quota budget exhausted → no park",
  resolvePark("rate-limit", { parkCount: MAX_RATE_LIMIT_PARKS }) === null);
check("maxParks: network=3, rate-limit=4",
  maxParks("network") === 3 && maxParks("rate-limit") === 4);

// ── 4. Real breakage never parks ─────────────────────────────────────────────
for (const kind of ["auth", "model", "region-block", "unknown", "abuse"]) {
  check(`kind "${kind}" never parks`, resolvePark(kind, {}) === null);
}

// ── 5. Delay curves ──────────────────────────────────────────────────────────
const MIN = 0.9, MAX = 1.1; // jitteredBackoff envelope is ±10% (0.9 + rand×0.2) — r654 truth-up: the QA assumed ±20%
const net = [0, 1, 2].map((i) => parkDelayMs("network", i));
check("network curve escalates (2m→4m→8m nominal, ±20%)",
  net.every((ms, i) => ms >= 2 * 60_000 * 2 ** i * MIN && ms <= 2 * 60_000 * 2 ** i * MAX),
  net.map((ms) => `${Math.round(ms / 1000)}s`).join(","));
check("network curve caps at 10m nominal (park 3+ never grows) — r654 truth-up: cap raised 8m→10m",
  (() => { const ms = parkDelayMs("network", 5); return ms >= 10 * 60_000 * MIN && ms <= 10 * 60_000 * MAX; })());
const rl = [0, 1, 2, 3].map((i) => parkDelayMs("rate-limit", i));
check("rate-limit curve unchanged (5m→10m→20m→30m nominal, ±10% jitter) — r654 truth-up: expected window applies the 30m cap",
  rl.every((ms, i) => {
    const nominal = Math.min(5 * 60_000 * 2 ** i, 30 * 60_000);
    return ms >= nominal * MIN && ms <= nominal * MAX;
  }),
  rl.map((ms) => `${Math.round(ms / 1000)}s`).join(","));
check("rate-limit curve caps at 30m nominal",
  (() => { const ms = parkDelayMs("rate-limit", 9); return ms >= 30 * 60_000 * MIN && ms <= 30 * 60_000 * MAX; })());
check("delays are jittered (two samples differ within same bucket)",
  parkDelayMs("network", 0) !== parkDelayMs("network", 0) ||
    parkDelayMs("network", 0) !== parkDelayMs("network", 0));

console.log(`\nK-series (park-policy): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
