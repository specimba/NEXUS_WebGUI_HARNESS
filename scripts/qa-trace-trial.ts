/**
 * r647 dial-free QA for src/lib/trace-trial.ts (arXiv 2610.32285 slice 1).
 * Pure string/structure assertions — no dials, no db, no network.
 * House doctrine: exit-after-finally; exitCode 1 on any failure.
 */
import {
  HARNESS_COMPONENTS,
  LOOP_CAP,
  DECLARED_CHAINS,
  VALIDATED_R640_CHAIN,
  classifyRunCriteria,
  attributeFailure,
  harnessSummary,
  attributionNote,
  harnessChipForRun,
  type RunShape,
} from "../src/lib/trace-trial";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean): void {
  if (cond) pass++;
  else fails.push(name);
}

// ── 1. Taxonomy data (F1) ────────────────────────────────────────────────────
check("taxonomy has exactly 7 components", HARNESS_COMPONENTS.length === 7);
check(
  "taxonomy codes are C E G L O T V in order",
  HARNESS_COMPONENTS.map((c) => c.code).join("") === "CEGLOTV",
);
check(
  "taxonomy task coverage sums to the paper's 95",
  HARNESS_COMPONENTS.reduce((n, c) => n + c.tasks, 0) === 95,
);
check("every component carries a focus line", HARNESS_COMPONENTS.every((c) => c.focus.length > 10));
check("verification coverage is honestly thin (1 task, cited)", HARNESS_COMPONENTS.find((c) => c.id === "verification")?.tasks === 1);
check("loop cap is the house mirror of r<=3", LOOP_CAP === 3);

// ── 2. Two-layer classification (F2) ────────────────────────────────────────
const cleanRun: RunShape = {
  success: true,
  finalVerdict: "pass",
  steps: [
    { status: "done", kind: "generate", output: "ok", ms: 120, toolCalls: [{ id: "t1" }] },
    { status: "done", kind: "review", verdict: "pass" },
  ],
};
const clean = classifyRunCriteria(cleanRun);
check("clean run classifies to 6 criteria", clean.length === 6);
check("clean run: zero failures", clean.every((c) => c.verdict === "pass"));
check("clean run: no bypassed criteria", clean.every((c) => c.verdict !== "bypassed"));
check("notes are countable (TraceTrial-prefixed)", clean.every((c) => c.note.startsWith("TraceTrial ")));

// E1 — success must not carry error rows (F3 shape)
const errRun: RunShape = {
  success: true,
  steps: [{ status: "error", output: "", kind: "generate" }],
};
const errC = classifyRunCriteria(errRun).find((c) => c.criterion === "execution/no-silent-failure");
check("success + error row => E fail", errC?.verdict === "fail");
check("E fail note names F3 discipline", (errC?.note ?? "").includes("success ≠ reliable"));

// E2 — sentinel impersonation (F6 wrapper shape)
const sentinelC = classifyRunCriteria({
  success: true,
  steps: [{ status: "done", autoDigest: true, output: "auto-digest" }],
}).find((c) => c.criterion === "execution/no-sentinel-impersonation");
check("success + auto-digest sentinel => E fail", sentinelC?.verdict === "fail");

// L1 — rework convergence + loop cap
const lc = classifyRunCriteria({
  success: true,
  steps: [
    { status: "done", reworked: true, output: "v2" },
    { status: "done", looped: { k: 2, r: 3, reason: "pass-verdict" }, output: "x" },
  ],
}).find((c) => c.criterion === "lifecycle/rework-converges");
check("bounded rework + looped within cap => L pass", lc?.verdict === "pass");
const lcap = classifyRunCriteria({
  success: true,
  steps: [{ status: "done", looped: { k: 4, r: 4, reason: "cap-reached" }, output: "x" }],
}).find((c) => c.criterion === "lifecycle/rework-converges");
check("looped k>cap => L fail", lcap?.verdict === "fail");
const lunc = classifyRunCriteria({
  success: true,
  steps: [{ status: "error", reworked: true }],
}).find((c) => c.criterion === "lifecycle/rework-converges");
check("unconverged rework => L fail", lunc?.verdict === "fail");

// V1 — claims vs gates, with bypass semantics
const vBypass = classifyRunCriteria({ success: true, steps: [{ status: "done", output: "x" }] }).find(
  (c) => c.criterion === "verification/claims-match-gates",
);
check("no gate info => V bypassed (visible zero)", vBypass?.verdict === "bypassed");
check("bypass note says unobservable", (vBypass?.note ?? "").includes("unobservable"));
const vFail = classifyRunCriteria({ success: true, finalVerdict: "fail", steps: [] }).find(
  (c) => c.criterion === "verification/claims-match-gates",
);
check("success claimed against failing verdict => V fail", vFail?.verdict === "fail");

// T1 — transport faithful
const tBypass = classifyRunCriteria({ success: true, steps: [{ status: "done", output: "x" }] }).find(
  (c) => c.criterion === "tools/transport-faithful",
);
check("no tool calls => T bypassed", tBypass?.verdict === "bypassed");
const tFail = classifyRunCriteria({
  success: true,
  steps: [{ status: "error", toolCalls: [{ id: "t1" }] }],
}).find((c) => c.criterion === "tools/transport-faithful");
check("tool-dialing error row inside success => T fail", tFail?.verdict === "fail");

// O1 — lineage present
const oFail = classifyRunCriteria({
  success: true,
  steps: [{ status: "done", output: "", kind: "generate" }],
}).find((c) => c.criterion === "observability/lineage-present");
check("done row with no output and no ms => O fail", oFail?.verdict === "fail");
const oBypass = classifyRunCriteria({ success: false, steps: [] }).find(
  (c) => c.criterion === "observability/lineage-present",
);
check("empty run => O bypassed", oBypass?.verdict === "bypassed");

// ── 3. Failure attribution (F5+F6) ──────────────────────────────────────────
const mixed = classifyRunCriteria({
  success: true,
  finalVerdict: "pass",
  steps: [
    { status: "error", output: "", kind: "generate" },
    { status: "done", autoDigest: true, output: "digest" },
    { status: "done", verdict: "pass" },
  ],
});
const rep = attributeFailure(mixed, true);
check("raw failures include bypassed rows (stay visible)", rep.rawFailures.length >= rep.harnessFailures.length);
check("bypassed excluded from harness failure set Z_H", rep.harnessFailures.every((c) => c.verdict === "fail"));
check("bypass set carries its own rows", rep.bypassed.length > 0 && rep.bypassed.every((c) => c.verdict === "bypassed"));
check("agent failure recorded", rep.agentFailed === true);
check("chains default to candidate (co-occurrence ≠ propagation)", rep.chains.every((c) => c.status === "candidate"));
check("candidate chains cite mechanism + criterion", rep.chains.every((c) => c.mechanism.length > 5 && c.criterion.length > 5));
const repV = attributeFailure(mixed, true, [VALIDATED_R640_CHAIN]);
check("non-matching validated list leaves all chains candidate", repV.chains.every((c) => c.status === "candidate"));
// Validated promotion requires a failure in the chain's component: the r640
// chain is governance-rooted, and the classifier honestly never emits
// governance criteria from a run shape — so craft the synthetic failure.
const govCriteria = [
  { component: "governance" as const, criterion: "governance/redaction-visible", verdict: "fail" as const, note: "synthetic" },
];
const repG = attributeFailure(govCriteria, true, [VALIDATED_R640_CHAIN]);
check("matching component + validated list => validated chain", repG.chains.length === 1 && repG.chains[0].status === "validated");
const repG2 = attributeFailure(govCriteria, true, []);
check("same shape without the validated list => candidate only", repG2.chains.length === 1 && repG2.chains[0].status === "candidate");
const repNoAgent = attributeFailure(mixed, false, [VALIDATED_R640_CHAIN]);
check("no agent failure => no chains at all", repNoAgent.chains.length === 0);
check("declared chains have valid component ids", DECLARED_CHAINS.every((d) => HARNESS_COMPONENTS.some((c) => c.id === d.from)));

// ── 4. F3 summary counter ───────────────────────────────────────────────────
const sum = harnessSummary(mixed, true);
check("summary counts fail rows", sum.fail >= 2);
check("summary score = pass/(pass+fail), bypassed excluded", Math.abs((sum.score ?? 0) - sum.pass / (sum.pass + sum.fail)) < 1e-9);
check("success-despite-violation flag is TRUE (the F3 debt)", sum.successDespiteViolation === true);
const sumClean = harnessSummary(clean, true);
check("clean run: no debt, full score", sumClean.successDespiteViolation === false && sumClean.score === 1);
const allBypassed = harnessSummary(
  classifyRunCriteria({ success: false, steps: [] }).filter((c) => c.verdict === "bypassed"),
  false,
);
check("all-bypassed => score null (honest no-signal)", allBypassed.score === null);

// ── 5. Never-throw + determinism ────────────────────────────────────────────
let threw = false;
try {
  classifyRunCriteria({});
  classifyRunCriteria({ steps: undefined, success: undefined });
  attributeFailure(undefined as never, true);
  harnessSummary(undefined as never, true);
  attributionNote(undefined as never);
} catch {
  threw = true;
}
check("degenerate inputs never throw", !threw);
const a = JSON.stringify(classifyRunCriteria(cleanRun));
const b = JSON.stringify(classifyRunCriteria(cleanRun));
check("classification is deterministic", a === b);
check("attribution note is countable", attributionNote(rep).startsWith("TraceTrial attribution —"));
check("attribution note carries candidate chain language", attributionNote(rep).includes("candidate chain"));

// ── 6. r648 slice-2 adapter: run-level chip ─────────────────────────────
const chipClean = harnessChipForRun(
  [
    { status: "done", kind: "generate", output: "ok", ms: 10, toolCalls: [{ id: "t" }] },
    { status: "done", kind: "review", verdict: "pass" },
  ],
  "done",
);
check("adapter: clean done run => pass chip 6/6", chipClean?.tone === "pass" && chipClean.label === "harness 6/6");
check("adapter: pass chip is not a debt", chipClean?.successDespiteViolation === false);
const chipDebt = harnessChipForRun(
  [
    { status: "error", output: "" },
    { status: "done", autoDigest: true, output: "digest" },
  ],
  "done",
);
check("adapter: success despite violations => warn chip", chipDebt?.tone === "warn" && chipDebt.successDespiteViolation === true);
check("adapter: debt tooltip names F3", (chipDebt?.tooltip ?? "").includes("SUCCEEDED despite"));
check("adapter: debt tooltip cites criteria", (chipDebt?.tooltip ?? "").includes("execution/no-silent-failure"));
const chipDegraded = harnessChipForRun([{ status: "done", degraded: true, output: "d" }], "done");
check("adapter: degraded alias maps to the sentinel criterion", chipDegraded?.tone === "warn" && chipDegraded.tooltip.includes("no-sentinel-impersonation"));
check("adapter: empty steps => null (no signal, no chip)", harnessChipForRun([], "done") === null);
const chipErrored = harnessChipForRun([{ status: "error", output: "" }], "error");
check("adapter: errored run => pass chip (F2 separation: harness behaved, agent layer failed)", chipErrored?.tone === "pass" && chipErrored.successDespiteViolation === false);
check("empty run: every criterion bypassed (no vacuous green, r183 doctrine)", classifyRunCriteria({ success: true, steps: [] }).every((c) => c.verdict === "bypassed"));

// ── verdict ─────────────────────────────────────────────────────────────
const total = pass + fails.length;
console.log(`QA:TRACE-TRIAL ${pass}/${total} checks PASS`);
if (fails.length > 0) {
  console.log(fails.map((f) => `FAIL ${f}`).join("\n"));
  process.exitCode = 1;
}
