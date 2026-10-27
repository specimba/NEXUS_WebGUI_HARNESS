/**
 * r181 QA — pre-fire congestion gate (K-series).
 *
 * The user report behind this round: the hourly Continuous-Research Deep
 * pipeline burned 12 runs / 24h with ZERO done (8 dead at the same step,
 * "Deep research pass 2") against one saturated gateway — while every
 * resilience layer (retries, relay, parks, r171 breaker) could only react
 * AFTER doomed runs had already burned quota. The fix: scheduled fires
 * consult the persistent 429 ring BEFORE starting and defer while a wave
 * is active, in both lanes (in-tab scheduler + headless mini-service).
 *
 * Run: bun run scripts/qa-congestion-gate.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  SATURATION_MIN_1H,
  SATURATION_RECENT_MS,
  gatewaySaturated,
  gatewaySaturatedFromEvents,
  rateLimitResumeDelayMs,
  MAX_AUTO_RESUME_TRIPS,
  RL_RESUME_CAP_MS,
  RL_RESUME_BASE_MS,
} from "../src/lib/gateway-cadence";

let pass = 0;
let fail = 0;
function k(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ K${pass} ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const MIN = 60_000;
const now = 1_800_000_000_000; // fixed "now" — boundary math must be deterministic

console.log("\n── K-series: saturation predicate (gatewaySaturated) ──");

k("K1: no 429 on record → gate open",
  gatewaySaturated({ last429At: null, count1h: 0 }, now) === false);

k("K2: fresh 429 (2m) + 5 in the past hour → SATURATED (defer)",
  gatewaySaturated({ last429At: now - 2 * MIN, count1h: 5 }, now) === true);

k("K3: stale 429 (11m) + 5 in the past hour → gate open (wave passed)",
  gatewaySaturated({ last429At: now - 11 * MIN, count1h: 5 }, now) === false);

k("K4: fresh 429 but only 2 in the past hour → gate open (a lone blip never stalls a schedule)",
  gatewaySaturated({ last429At: now - 2 * MIN, count1h: 2 }, now) === false);

k("K5: exactly at the 10m boundary → gate open (strict <, the wave owns the ambiguity)",
  gatewaySaturated({ last429At: now - SATURATION_RECENT_MS, count1h: 5 }, now) === false);

k("K6: exactly 3 in the past hour → SATURATED (threshold is inclusive)",
  gatewaySaturated({ last429At: now - 2 * MIN, count1h: SATURATION_MIN_1H }, now) === true);

k("K7: fresh 429 + zero 1h count (defensive impossible combo) → gate open",
  gatewaySaturated({ last429At: now - 1_000, count1h: 0 }, now) === false);

console.log("\n── K-series: event-derived signal (gatewaySaturatedFromEvents) ──");

k("K8: empty event list → gate open (first run / pruned ring)",
  gatewaySaturatedFromEvents([], now) === false);

k("K9: mixed-age events — last429At derives from the NEWEST, count1h counts only the trailing hour",
  gatewaySaturatedFromEvents(
    [
      { t: now - 90 * MIN }, // outside 1h window — must not count
      { t: now - 70 * MIN }, // outside 1h window
      { t: now - 3 * MIN },  // newest — inside everything
    ],
    now
  ) === false, "70m-old events must not inflate count1h; newest is 3m old but count1h=1 < 3");

k("K10: three events inside the hour, newest 4m old → SATURATED",
  gatewaySaturatedFromEvents(
    [{ t: now - 40 * MIN }, { t: now - 20 * MIN }, { t: now - 4 * MIN }],
    now
  ) === true);

k("K11: malformed entries (non-numeric t) are filtered, not fatal",
  gatewaySaturatedFromEvents(
    [{ t: NaN }, { t: undefined } as unknown as { t: number }, { t: now - 2 * MIN }, { t: now - 5 * MIN }, { t: now - 8 * MIN }],
    now
  ) === true);

console.log("\n── K-series: doctrine constants ──");

k("K12: saturation window is wave-scale (≥6× the 90s blip window, not another politeness sliver)",
  SATURATION_RECENT_MS >= 6 * 90_000,
  `SATURATION_RECENT_MS=${SATURATION_RECENT_MS}`);

k("K13: min-429 threshold ≥3 — one unlucky dial must never stall an hourly schedule",
  SATURATION_MIN_1H >= 3);

console.log("\n── K-series: r171 ladder regression (the gate must not disturb it) ──");

k("K14: trip at streak 2 → 45m backoff (base)",
  rateLimitResumeDelayMs(2) === RL_RESUME_BASE_MS);
k("K15: trip at streak 3 → 90m (streak-exponential)",
  rateLimitResumeDelayMs(3) === 2 * RL_RESUME_BASE_MS);
k("K16: deep streak capped at 6h",
  rateLimitResumeDelayMs(99) === RL_RESUME_CAP_MS);
k("K17: auto-resume trip budget unchanged (5 trips → manual pause)",
  MAX_AUTO_RESUME_TRIPS === 5);

console.log("\n── K-series: integration (both fire lanes actually gated) ──");

const root = process.cwd();
const schedSrc = fs.readFileSync(
  path.join(root, "src/components/nexus/workflows/workflow-scheduler.tsx"),
  "utf8"
);
const svcSrc = fs.readFileSync(
  path.join(root, "mini-services/workflow-scheduler/index.ts"),
  "utf8"
);
const viewSrc = fs.readFileSync(
  path.join(root, "src/components/nexus/workflows/workflows-view.tsx"),
  "utf8"
);
const skipsSrc = fs.readFileSync(path.join(root, "src/lib/schedule-skips.ts"), "utf8");

k("K18: in-tab scheduler fetches the pulse and defers with the audit reason",
  schedSrc.includes("/api/gateway/pulse") &&
    schedSrc.includes('noteScheduleDeferred(wf.id, wf.name, "gateway-saturated")'));

k("K19: in-tab gate checked BEFORE the v24 spacing gate (zero-cost defer wins)",
  schedSrc.indexOf("if (saturated)") < schedSrc.indexOf("v24: cadence gate"));

k("K20: gate is fail-open on telemetry failure (catch → null → not saturated)",
  schedSrc.includes(".catch(() => null)") && schedSrc.includes("saturated = !!sig && gatewaySaturated(sig)"));

k("K21: headless service gates BEFORE claiming (defer-before-claim ordering)",
  svcSrc.indexOf("const saturated = gatewaySaturatedFromEvents") < svcSrc.indexOf("inFlight.add(wf.id)"));

k("K22: headless service records its own 429s (closed-tab dials are server-invisible — blind-spot fix)",
  svcSrc.includes("recordOwn429()") && svcSrc.includes("headless-autopilot"));

k("K23: audit line renders the new reason (both open + closed episode states)",
  viewSrc.includes("while the gateway was saturated") &&
    viewSrc.includes("waiting for the gateway congestion wave to pass"));

k("K24: ScheduleSkipEntry carries the reason field (backward-compatible optional)",
  skipsSrc.includes("reason?: ScheduleSkipReason"));

console.log("\n── Live signal smoke (informational — depends on real congestion) ──");
try {
  const raw = fs.readFileSync(path.join(root, "db/gateway-pulse.json"), "utf8");
  const parsed = JSON.parse(raw) as { events?: { t: number }[] };
  const events = parsed.events ?? [];
  const saturatedNow = gatewaySaturatedFromEvents(events);
  const last = events.length ? events[events.length - 1].t : null;
  const ageMin = last ? Math.round((Date.now() - last) / MIN) : null;
  console.log(
    `  ℹ pulse ring: ${events.length} event(s), last 429 ${ageMin === null ? "never" : `${ageMin}m ago`} → gate ${saturatedNow ? "CLOSED (defer fires)" : "open (fires proceed)"}`
  );
} catch {
  console.log("  ℹ pulse ring not readable — gate defaults open (fail-open doctrine)");
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
