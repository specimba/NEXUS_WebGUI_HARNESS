/**
 * r305 — behavioral unit suite for lib/lane-rotation.ts (per-family 429
 * saturation memory + congestion rotation). User directive: "harness properly
 * the request slowness based on provider exhaustion 429 limitations… why is
 * there no model or provider rotation while we have dozens of them?"
 * Before r305 only MID-STREAM drops were remembered as sick; a pre-stream 429
 * was re-learned by every later step, cooldowns ignored how exhausted the lane
 * was, and rotation waited for the final attempt or a park.
 * Run: bun run scripts/qa-lane-rotation.ts
 */
import {
  LANE_SICK_MS,
  congestionCooldownMs,
  laneFamilyKey,
  laneSickUntil,
  laneStrikes,
  noteLane429,
  rotateHops,
} from "../src/lib/lane-rotation";

let pass = 0, fail = 0;
function ok(cond: boolean, name: string, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── laneFamilyKey ─────────────────────────────────────────────────────────────
ok(laneFamilyKey("vyce::deepseek-v4.1") === "vyce", "hop key resolves to its provider family");
ok(laneFamilyKey("vyce") === "vyce", "bare provider id passes through unchanged");
ok(laneFamilyKey("auto::builtin") === "auto", "built-in hop key resolves to the auto family");
ok(laneFamilyKey(undefined) === "", "undefined id → empty family (untracked)");
ok(laneFamilyKey("  ") === "", "blank id → empty family (untracked)");

// ── noteLane429 / laneSickUntil ───────────────────────────────────────────────
const store = new Map<string, { until: number; strikes: number }>();
const t0 = 1_000_000;
const first = noteLane429(store, "vyce", t0);
ok(first.until === t0 + LANE_SICK_MS, "first 429 opens the 5-minute window", `until=${first.until}`);
ok(first.strikes === 1, "first 429 counts as 1 strike");
ok(laneSickUntil(store, "vyce", t0 + 1_000) === t0 + LANE_SICK_MS, "inside the window the family is sick");
ok(laneSickUntil(store, "aihubmix", t0 + 1_000) === 0, "an unnoted family stays healthy");
ok(laneSickUntil(store, "vyce", t0 + LANE_SICK_MS + 1) === 0, "an expired window heals the family");

// Repeat 429 inside the window: slides + escalates.
const second = noteLane429(store, "vyce", t0 + 60_000);
ok(second.until === t0 + 60_000 + LANE_SICK_MS, "a repeat 429 slides the window forward");
ok(second.strikes === 2, "a repeat 429 escalates the strike count");
ok(laneStrikes(store, "vyce", t0 + 61_000) === 2, "strikes are readable while the window is live");
ok(laneStrikes(store, "vyce", t0 + 60_000 + LANE_SICK_MS + 1) === 0, "an expired window resets strikes — the lane is forgiven");

// A 429 long after the window expired starts a fresh count (no zombie escalation).
const muchLater = noteLane429(store, "vyce", t0 + 60_000 + LANE_SICK_MS + 60_000);
ok(muchLater.strikes === 1, "a 429 after expiry starts a fresh strike count");

// ── rotateHops ────────────────────────────────────────────────────────────────
const hops = [
  { key: "vyce::deepseek-v4.1", label: "Vyce primary" },
  { key: "aihubmix::coding-glm-5.3-free", label: "AIHubMix GLM" },
  { key: "groq::openai/gpt-oss-120b", label: "Groq" },
];
const sickStore = new Map<string, { until: number; strikes: number }>();
noteLane429(sickStore, "vyce", t0);
noteLane429(sickStore, "groq", t0);
const rot = rotateHops(hops, sickStore, t0 + 1_000);
ok(rot.hops.length === 3, "rotation never drops a hop", `len=${rot.hops.length}`);
ok(rot.hops[0].key === "aihubmix::coding-glm-5.3-free", "the healthy lane leads after rotation");
ok(
  rot.hops[1].key === "vyce::deepseek-v4.1" && rot.hops[2].key === "groq::openai/gpt-oss-120b",
  "sick lanes park at the back in stable order"
);
ok(rot.demoted.length === 2 && rot.demoted[0] === "Vyce primary", "the demoted list names sick lanes by label");

const clean = rotateHops(hops, new Map(), t0 + 1_000);
ok(
  clean.hops[0].key === "vyce::deepseek-v4.1" && clean.demoted.length === 0,
  "an all-healthy wire is left untouched"
);

noteLane429(sickStore, "aihubmix", t0);
const allSick = rotateHops(hops, sickStore, t0 + 1_000);
ok(
  allSick.hops[0].key === "vyce::deepseek-v4.1" && allSick.demoted.length === 3,
  "an all-sick wire keeps its order (nothing healthier to lead with)"
);

const withKeyless = rotateHops(
  [{ label: "mystery hop" }, ...hops],
  sickStore,
  t0 + 1_000
);
ok(withKeyless.hops[0].label === "mystery hop", "keyless hops stay in place (nothing to key them by)");

const empty = rotateHops([], sickStore, t0 + 1_000);
ok(empty.hops.length === 0 && empty.demoted.length === 0, "an empty wire rotates to an empty wire");

// ── congestionCooldownMs (adaptive slowness) ─────────────────────────────────
ok(congestionCooldownMs(1, 0, t0) === 20_000, "first strike → 20s base");
ok(congestionCooldownMs(2, 0, t0) === 45_000, "second strike → 45s base");
ok(congestionCooldownMs(3, 0, t0) === 90_000, "third strike → 90s base");
ok(congestionCooldownMs(9, 0, t0) === 90_000, "strikes saturate at the 90s cap");
ok(congestionCooldownMs(1, t0 + 70_000, t0) === 70_000, "the shared quiet window floors the cooldown");
ok(congestionCooldownMs(3, t0 - 5_000, t0) === 90_000, "a passed quiet window never shortens the base");

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);

// ── Source-level wiring asserts (qa-depth-degrade pattern) ───────────────────
// A live 429 cannot be ethically forced against the shared free gateway (the
// hammering this module exists to stop), so these asserts pin the runner
// wiring that the pure rules above power.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const runner = readFileSync(join(process.cwd(), "src/lib/workflow-runner.ts"), "utf8");
let wpass = 0, wfail = 0;
function wire(cond: boolean, name: string) {
  if (cond) { wpass++; console.log(`  ✓ ${name}`); }
  else { wfail++; console.log(`  ✗ ${name}`); }
}
wire(
  runner.includes(`from "@/lib/lane-rotation"`),
  "runner imports the lane-rotation module"
);
wire(
  runner.includes("noteLane429(laneSaturation") && runner.includes("rotateHops(relayHops, laneSaturation"),
  "429 marking and hop demotion are wired into the stream loop"
);
wire(
  runner.includes("congestionCooldownMs("),
  "the retry cooldown scales with lane exhaustion"
);
wire(
  runner.includes("congestion rotation — "),
  "rotation carries an honest call-log note"
);
wire(
  runner.includes("primaryFamilySick"),
  "family saturation demotes the primary on later steps too"
);
console.log(`  ${wpass}/${wpass + wfail} wiring asserts passed`);
process.exit(wfail === 0 ? 0 : 1);
