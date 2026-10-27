// r190 QA — branch router for variation proposals (arXiv:2609.37834,
// "Mixture of Self-Improving Branches For Agent Harness Optimization"):
// least-used branch first (exploration), best-past-novelty among equals
// (exploitation), legacy hash pick as cold-start tie-break.
// Run: bun run scripts/qa-spawn-branches.ts

import {
  ANGLES,
  angleOfProposal,
  buildAngleHistory,
  buildVariationProposal,
  latestScoredNovelty,
  maybeProposeSpawn,
  pickVariationAngle,
  NOVELTY_SPAWN_THRESHOLD,
  type AngleHistoryEntry,
} from "../src/lib/spawn-proposal-engine";
import * as fs from "node:fs";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (c) pass++; else fail++;
};
const src = fs.readFileSync("src/lib/spawn-proposal-engine.ts", "utf8");
const runnerSrc = fs.readFileSync("src/lib/workflow-runner.ts", "utf8");
const viewSrc = fs.readFileSync("src/components/nexus/workflows/workflows-view.tsx", "utf8");

const TASK = "recursive self improvement for agentic automation systems";

console.log("B1 — cold start: empty history collapses to the legacy hash pick");
const legacyIdx = (() => {
  let h = 0;
  for (let i = 0; i < TASK.length; i++) h = (h * 31 + TASK.charCodeAt(i)) >>> 0;
  return h % ANGLES.length;
})();
ok(pickVariationAngle(TASK) === ANGLES[legacyIdx], "empty history === legacy hash angle (backward compatible)");
ok(pickVariationAngle(TASK) === pickVariationAngle(TASK), "deterministic for the same task");

console.log("B2 — exploration: never re-propose the same single trajectory");
const once: AngleHistoryEntry[] = [{ angle: ANGLES[0] }];
ok(pickVariationAngle(TASK, once) !== ANGLES[0], "after one proposal of branch 0, router picks a complementary branch");
const threeUsed: AngleHistoryEntry[] = [
  { angle: ANGLES[0] }, { angle: ANGLES[1] }, { angle: ANGLES[2] },
];
ok(pickVariationAngle(TASK, threeUsed) === ANGLES[3], "three branches used once → the untouched 4th is next (full coverage before any repeat)");

console.log("B3 — exploitation: best past novelty among equally-fresh branches wins");
const allOnce = [
  { angle: ANGLES[0], novelty: 10 },
  { angle: ANGLES[1], novelty: 90 },
  { angle: ANGLES[2], novelty: 50 },
  { angle: ANGLES[3], novelty: 50 },
];
ok(pickVariationAngle(TASK, allOnce) === ANGLES[1], "all branches used → highest-avg-novelty branch (90%) selected");
const weakBest = [
  { angle: ANGLES[0], novelty: 90, },
  { angle: ANGLES[0], novelty: 10 },
  { angle: ANGLES[1], novelty: 55 },
  { angle: ANGLES[2], novelty: 55 },
  { angle: ANGLES[3], novelty: 55 },
];
ok(pickVariationAngle(TASK, weakBest) === ANGLES[1], "avg novelty: overused branch 0 (avg 50) excluded by least-used rule; 55-branches tie → stable ANGLES order picks branch 1");
const freshBeatsOld = [
  { angle: ANGLES[0], novelty: 95 },
  { angle: ANGLES[1], novelty: 5 },
];
ok(pickVariationAngle(TASK, freshBeatsOld) !== ANGLES[0] && pickVariationAngle(TASK, freshBeatsOld) !== ANGLES[1], "used-once branches lose to untouched ones regardless of past novelty");

console.log("B4 — history hygiene");
ok(pickVariationAngle(TASK, [{ angle: "garbage angle text" }, { angle: "" }]) === ANGLES[legacyIdx], "unknown/legacy angle strings are ignored");
ok(ANGLES.every((a) => angleOfProposal(`do X — approach it from ${a}`) === a), "angleOfProposal round-trips every branch");
ok(angleOfProposal("a goal with no embedded angle") === null, "angleless goal → null (ignored by the router)");
ok(pickVariationAngle(TASK, [{ angle: ANGLES[2], novelty: 1 }, { angle: ANGLES[2] }]) !== ANGLES[2], "novelty attaches to the right branch even mixed with unscored uses");

console.log("B5 — proposal builder: rotation is visible, cold start unchanged");
const stalled = buildVariationProposal({
  sourceWorkflowId: "wf-1",
  sourceWorkflowName: "RSIinFIELD",
  sourceRunId: "run-1",
  taskExcerpt: TASK,
  novelty: 22,
});
ok(stalled.goal.endsWith(`approach it from ${ANGLES[legacyIdx]}`), "no history → goal matches legacy angle");
ok(!stalled.reason.includes("branch rotated"), "no history → no rotation note");
const rotated = buildVariationProposal({
  sourceWorkflowId: "wf-1",
  sourceWorkflowName: "RSIinFIELD",
  sourceRunId: "run-2",
  taskExcerpt: TASK,
  novelty: 22,
  angleHistory: [{ angle: ANGLES[legacyIdx] }, { angle: ANGLES[legacyIdx] }],
});
ok(ANGLES.some((a) => rotated.goal.endsWith(`approach it from ${a}`)), "rotated goal still names a valid branch");
ok(rotated.goal !== stalled.goal, "two uses of the legacy branch force a DIFFERENT goal angle");
ok(rotated.reason.includes("the router is exploring"), "exploration mode names the router decision in the reason (unscored history)");
// r199: exploitation fires name the leading branch and its outcome evidence.
const exploit = buildVariationProposal({
  sourceWorkflowId: "wf-x",
  sourceWorkflowName: "x",
  sourceRunId: "r",
  taskExcerpt: TASK,
  novelty: 20,
  angleHistory: [
    { angle: ANGLES[0], novelty: 30 },
    { angle: ANGLES[1], novelty: 85 },
    { angle: ANGLES[1], novelty: 90 },
    { angle: ANGLES[2], novelty: 10 },
    { angle: ANGLES[3], novelty: 95 },
  ],
});
ok(exploit.goal.endsWith(`approach it from ${ANGLES[3]}`), "exploitation picks the best-scoring least-used branch");
ok(exploit.reason.includes("exploiting the leading branch"), "exploitation reason names the leading branch");
ok(
  exploit.reason.includes("95% novelty across 1 scored variation"),
  "exploitation reason cites avg novelty + sample count"
);

console.log("B6 — maybeProposeSpawn: gates intact, history flows through");
ok(maybeProposeSpawn({
  status: "error", novelty: 10, openSourceIds: [], sourceWorkflowId: "wf-1",
  sourceWorkflowName: "x", sourceRunId: "r", taskExcerpt: TASK,
}) === null, "non-done runs never spawn");
ok(maybeProposeSpawn({
  status: "done", novelty: NOVELTY_SPAWN_THRESHOLD + 5, openSourceIds: [], sourceWorkflowId: "wf-1",
  sourceWorkflowName: "x", sourceRunId: "r", taskExcerpt: TASK,
}) === null, "healthy novelty never spawns");
ok(maybeProposeSpawn({
  status: "done", novelty: 10, openSourceIds: ["wf-1"], sourceWorkflowId: "wf-1",
  sourceWorkflowName: "x", sourceRunId: "r", taskExcerpt: TASK,
}) === null, "open-proposal anti-spam cap intact");
const spawned = maybeProposeSpawn({
  status: "done", novelty: 10, openSourceIds: ["wf-other"], sourceWorkflowId: "wf-1",
  sourceWorkflowName: "RSIinFIELD", sourceRunId: "r", taskExcerpt: TASK,
  angleHistory: [{ angle: ANGLES[legacyIdx] }, { angle: ANGLES[legacyIdx] }],
});
ok(spawned != null && spawned.goal !== stalled.goal, "qualifying stall + history → routed proposal (not the hashed repeat)");

console.log("B7 — source wiring: both call sites feed the router via the shared join (r191)");
ok(/buildAngleHistory/.test(runnerSrc) && /latestScoredNovelty/.test(runnerSrc), "workflow-runner derives angle history via the shared outcome-novelty join");
ok(/buildAngleHistory/.test(viewSrc) && /latestScoredNovelty/.test(viewSrc), "manual 'Suggest variation' uses the shared join too");
ok(!/angleOfProposal\(p\.goal\)/.test(runnerSrc) && !/angleOfProposal\(p\.goal\)/.test(viewSrc), "no consumer re-implements the join (single decision point)");
ok(/for \(const w of st\.workflows\)/.test(runnerSrc) && /for \(const w of workflows\)/.test(viewSrc), "both call sites score from the live workflows store, not stale props");
ok(
  /pickVariationAngleWithReason\(base, input\.angleHistory\)/.test(src) &&
    /return pickVariationAngleWithReason\(taskExcerpt, history\)\.angle/.test(src),
  "builder + public router both route through the single decision point (r199)"
);
ok(!/hashPick/.test(src), "legacy hashPick name is gone (replaced by index tie-break)");

console.log("B8 — r191 outcome-novelty join: proposals × spawned pipelines");
ok(latestScoredNovelty([]) === undefined, "no runs → no score");
ok(latestScoredNovelty([{ status: "error" }, { status: "done", novelty: 41 }]) === 41, "skips newer error runs, finds the last scored done run");
ok(latestScoredNovelty([{ status: "done" }, { status: "done", novelty: 77 }]) === 77, "newer unscored done run (pre-Evolution) doesn't erase the score");
ok(latestScoredNovelty([{ status: "done", novelty: 0 }]) === 0, "0% novelty is a real score, not missing");
const joinProposals = [
  { goal: `g — approach it from ${ANGLES[0]}`, sourceWorkflowId: "wf-1", status: "accepted" as const, spawnedWorkflowId: "wf-a" },
  { goal: `g — approach it from ${ANGLES[1]}`, sourceWorkflowId: "wf-1", status: "open" as const },
  { goal: `g — approach it from ${ANGLES[2]}`, sourceWorkflowId: "wf-1", status: "dismissed" as const },
  { goal: `g — approach it from ${ANGLES[3]}`, sourceWorkflowId: "wf-2", status: "accepted" as const, spawnedWorkflowId: "wf-b" },
  { goal: "legacy goal without an angle", sourceWorkflowId: "wf-1", status: "accepted" as const, spawnedWorkflowId: "wf-c" },
];
const joinScores = new Map([["wf-a", 80], ["wf-b", 90], ["wf-c", 95]]);
const joinHist = buildAngleHistory(joinProposals, "wf-1", joinScores);
ok(joinHist.length === 3, "only the source workflow's proposals enter history");
ok(joinHist[0].novelty === 80, "accepted + spawned + scored → outcome novelty flows to the branch");
ok(joinHist[1].novelty === undefined && joinHist[2].novelty === undefined, "open/dismissed proposals count for exploration only — never exploitation");
ok(joinHist[2].angle === ANGLES[2], "dismissed branch still occupies exploration usage");
ok(!joinHist.some((e) => e.angle === ""), "angleless/legacy goals are dropped from history");
ok(buildAngleHistory([{ goal: `g — approach it from ${ANGLES[0]}`, sourceWorkflowId: "s", status: "accepted", spawnedWorkflowId: "wf-gone" }], "s", new Map())[0].novelty === undefined, "accepted but unscored/deleted spawned pipeline → exploration only");
const e2e = buildAngleHistory(
  [
    { goal: `g — approach it from ${ANGLES[0]}`, sourceWorkflowId: "s", status: "accepted" as const, spawnedWorkflowId: "spawn-0" },
    { goal: `g — approach it from ${ANGLES[1]}`, sourceWorkflowId: "s", status: "accepted" as const, spawnedWorkflowId: "spawn-1" },
    { goal: `g — approach it from ${ANGLES[2]}`, sourceWorkflowId: "s", status: "accepted" as const, spawnedWorkflowId: "spawn-2" },
    { goal: `g — approach it from ${ANGLES[3]}`, sourceWorkflowId: "s", status: "accepted" as const, spawnedWorkflowId: "spawn-3" },
  ],
  "s",
  new Map([["spawn-0", 15], ["spawn-1", 88], ["spawn-2", 40], ["spawn-3", 40]])
);
ok(pickVariationAngle(TASK, e2e) === ANGLES[1], "end-to-end: router exploits the branch whose spawned pipeline scored highest (88%)");

// ─── r215: latestScoredNovelty is a TIME claim, not a position claim ────────
// The Novelty Lab sample seed stored runs oldest-first while the runner
// prepends — the old find()-based helper returned the OLDEST score (62%),
// masking the sample's real 22% stall and hiding the "Suggest variation"
// path. Regression: max-startedAt selection with a first-match fallback.
const storesSrc = fs.readFileSync("src/lib/stores.ts", "utf8");
ok(
  latestScoredNovelty([
    { status: "done", novelty: 62, startedAt: 1000 },
    { status: "done", novelty: 22, startedAt: 4000 },
  ]) === 22,
  "append-order runs (sample-seed shape) → the NEWEST startedAt's score wins (was 62 before r215)"
);
ok(
  latestScoredNovelty([
    { status: "done", novelty: 22, startedAt: 4000 },
    { status: "done", novelty: 62, startedAt: 1000 },
  ]) === 22,
  "prepend-order runs (runner shape) → still the newest score"
);
ok(
  latestScoredNovelty([{ status: "done", novelty: 62 }, { status: "done", novelty: 22 }]) === 62,
  "no timestamps → first-match fallback preserved for legacy callers"
);
ok(
  latestScoredNovelty([
    { status: "error", startedAt: 9000 },
    { status: "done", novelty: 22, startedAt: 4000 },
  ]) === 22,
  "newer unscored/error runs still don't erase the last score"
);
ok(latestScoredNovelty([]) === undefined, "no runs → undefined");
ok(
  storesSrc.indexOf("mkRun(3, 22") < storesSrc.indexOf("mkRun(0, 62"),
  "sample seed stores runs newest-first (22 at index 0) per the runner's prepend contract"
);

console.log(`\nB-series (branch router): ${pass} passed, ${fail} failed`);
console.log(`SUMMARY: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
