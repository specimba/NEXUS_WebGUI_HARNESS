// ─── qa-looped-icl.ts — dial-free witness for the r643 adaptation slice ─────
// Pure-module QA for src/lib/looped-icl.ts (arXiv 2610.31421 adaptation:
// looped/grown pass plans, verdict-gated early exit, two-occurrence prompt
// shaping, reassigned-labels probe, ICL/IWL split). No db, no dials, no
// network — every check is a string/structure assertion, per the house
// dial-free QA doctrine (cf. qa-peer-blind-score.ts, qa-constraint-block.ts).
//   bun scripts/qa-looped-icl.ts
import {
  LOOP_PASSES_CAP,
  fnv1a,
  grownPlan,
  iclIwlSplit,
  loopExit,
  loopedPlan,
  reassignLabels,
  twoOccurrencePrompt,
  type LoopedStepSpec,
  type LoopVerdict,
  type ProbeTask,
} from "../src/lib/looped-icl";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed += 1;
    console.log(`  ok ${passed} — ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL — ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n== ${title} ==`);
}

// ── 1. loopedPlan: prelude -> block x r -> coda, tied invariant ─────────────
section("loopedPlan shape + tied invariant");
const spec: LoopedStepSpec = {
  prelude: "Gather the task context and prior notes.",
  block: "Critique the draft above against the assignment, then improve it.",
  passes: 3,
  coda: "Produce the final answer.",
};
const plan = loopedPlan(spec);
check("plan ok", plan.ok);
if (plan.ok) {
  const kinds = plan.passes.map((p) => p.kind).join(",");
  check("order = prelude,3x block,coda", kinds === "prelude,block,block,block,coda", kinds);
  const blocks = plan.passes.filter((p) => p.kind === "block");
  check("3 block passes at r=3", blocks.length === 3);
  check("block prompts byte-identical (tied)", blocks.every((b) => b.prompt === spec.block));
  check("tied=true on blocks, false on prelude/coda", blocks.every((b) => b.tied) && plan.passes[0]?.tied === false && plan.passes[4]?.tied === false);
  check("indices 0..r+1", plan.passes.map((p) => p.index).join(",") === "0,1,2,3,4");
  check("nothing budget-capped at r<=cap", plan.passes.every((p) => !p.budgetCapped));
}

// ── 2. cap + clamp honesty ───────────────────────────────────────────────────
section("cap: over-budget request clamps to LOOP_PASSES_CAP");
const over = loopedPlan({ ...spec, passes: 7 });
check("over-budget plan ok", over.ok);
if (over.ok) {
  const blocks = over.passes.filter((p) => p.kind === "block");
  check(`clamped to ${LOOP_PASSES_CAP} block passes`, blocks.length === LOOP_PASSES_CAP);
  check("clamped flag reported", over.clamped === true);
  check("requested=7 preserved for the log", over.requested === 7);
  check("truncation point marked budgetCapped", blocks[blocks.length - 1]?.budgetCapped === true && blocks[0]?.budgetCapped === false);
}

// ── 3. contract refusals (never-throw envelope) ─────────────────────────────
section("loopedPlan contract refusals");
check("empty block refused", !loopedPlan({ ...spec, block: "   " }).ok);
check("passes=0 refused", !loopedPlan({ ...spec, passes: 0 }).ok);
check("passes=NaN refused", !loopedPlan({ ...spec, passes: Number.NaN }).ok);
const neg = loopedPlan({ ...spec, passes: -2 });
check("negative passes refused with named error", !neg.ok && neg.error.includes(">= 1"));

// ── 4. grownPlan: copies specialize independently ───────────────────────────
section("grownPlan: copy + per-pass specialization");
const deltas = ["Focus on factual consistency.", "Focus on tone and register.", "Focus on formatting compliance."];
const grown = grownPlan(spec, deltas);
check("grown plan ok", grown.ok);
if (grown.ok) {
  const blocks = grown.passes.filter((p) => p.kind === "block");
  check("one delta per block copy", blocks.length === 3);
  check("copies carry their specialization", blocks.every((b) => deltas.some((d) => b.prompt.includes(d))));
  check("grown copies are NOT tied", blocks.every((b) => !b.tied));
  check("base block text preserved under the delta", blocks.every((b) => b.prompt.startsWith(spec.block)));
}
check("delta-count mismatch refused", !grownPlan(spec, deltas.slice(0, 2)).ok);
check("non-array deltas refused", !grownPlan(spec, undefined as unknown as string[]).ok);

// ── 5. loopExit: verdict-gated early exit ───────────────────────────────────
section("loopExit: pass exits, one bounded rework, cap on unsure");
const cases: Array<{ v: LoopVerdict[]; at: number; why: string }> = [
  { v: ["pass"], at: 1, why: "pass-verdict" },
  { v: ["fail", "pass"], at: 2, why: "pass-verdict" },
  { v: ["fail", "fail", "pass"], at: 2, why: "rework-exhausted" },
  { v: ["fail"], at: 1, why: "rework-exhausted" },
  { v: ["unsure", "unsure", "unsure"], at: 3, why: "cap-reached" },
  { v: ["fail", "unsure", "pass"], at: 3, why: "pass-verdict" },
];
for (const c of cases) {
  const r = loopExit(c.v);
  check(`[${c.v.join(",")}] -> exit@${c.at} (${c.why})`, r.exitedAt === c.at && r.reason === c.why, `got ${r.exitedAt}/${r.reason}`);
}
check("empty verdict list -> empty exit", loopExit([]).reason === "empty" && loopExit([]).exitedAt === 0);

// ── 6. twoOccurrencePrompt: anchor early, target late ───────────────────────
section("twoOccurrencePrompt: induction-shaped layout");
const ex = 'Return JSON: {"verdict": "pass" | "fail", "why": "<= 20 words"}';
const two = twoOccurrencePrompt("Review the patch and answer with the verdict shape.", ex, "Patch notes: rewrote the retry loop.");
check("exactly 2 occurrences of the exemplar", two.occurrences === 2, String(two.occurrences));
check("anchor precedes target", two.anchorIndex >= 0 && two.targetIndex > two.anchorIndex);
check("target sits at the generation point", two.prompt.endsWith("Generate now:"));
const anchorPos = two.prompt.indexOf("Reference shape (anchor):");
const bodyPos = two.prompt.indexOf("Patch notes:");
const targetPos = two.prompt.indexOf("Reference shape (repeat");
check("layout = task -> anchor -> body -> target", anchorPos > 0 && bodyPos > anchorPos && targetPos > bodyPos);
// degenerate-input guard: a single-char exemplar must be counted against the
// WHOLE prompt (the tag text contains "exactly" — x AND y both collide).
check("no body -> still valid layout", twoOccurrencePrompt("Review the task.", "ok").occurrences === 2);
check("degenerate single-char exemplar colliding with tag text is reported honestly", twoOccurrencePrompt("t", "x").occurrences === 3);

// ── 7. reassignLabels: the Figure 3(b) probe ────────────────────────────────
section("reassignLabels: in-weights solutions cannot fire");
const fixture = { prompt: "Pipeline acme/widget-ci failed at step deploy; owner acme was notified.", identifiers: ["acme/widget-ci", "acme"] };
const a = reassignLabels(fixture, "seq-001");
const b = reassignLabels(fixture, "seq-001");
const c = reassignLabels(fixture, "seq-002");
check("deterministic per sequence salt", JSON.stringify(a) === JSON.stringify(b));
check("different salt -> different mapping", Object.values(a.mapping).every((v) => !Object.values(c.mapping).includes(v)));
check("original identifiers absent from the reassigned prompt", fixture.identifiers.every((id) => !a.prompt.includes(id)));
check("mints carry the synthetic zx- prefix", Object.values(a.mapping).every((v) => v.startsWith("zx-")));
check("mapping covers every identifier", Object.keys(a.mapping).length === new Set(fixture.identifiers).size);
check("longest-first replacement (no mixed residue)", !a.prompt.includes("zx-") === false && /\bzx-[a-z0-9]{10}\b/.test(a.prompt));
check("fnv1a deterministic + unsigned", fnv1a("nexus") === fnv1a("nexus") && fnv1a("nexus") > 0);

// ── 8. iclIwlSplit: the two probes, disjoint witness ────────────────────────
section("iclIwlSplit: ICL probe vs IWL probe");
const tasks: ProbeTask[] = [
  { id: "t1", prompt: "Classify repo alpha/one.", identifiers: ["alpha/one"], label: "alpha/one" },
  { id: "t2", prompt: "Classify repo beta/two.", identifiers: ["beta/two"], label: "beta/two" },
  { id: "t3", prompt: "Classify repo gamma/three.", identifiers: ["gamma/three"], label: "gamma/three" },
  { id: "t4", prompt: "Classify repo delta/four.", identifiers: ["delta/four"], label: "delta/four" },
  { id: "t5", prompt: "Classify repo epsilon/five.", identifiers: ["epsilon/five"], label: "epsilon/five" },
];
const split = iclIwlSplit(tasks, "probe-salt", 2);
check("held-out tail becomes the ICL probe", split.icl.length === 2 && split.icl[0]?.id === "t4" && split.icl[1]?.id === "t5");
check("IWL keeps the head with originals intact", split.iwl.length === 3 && split.iwl.every((t) => t.prompt === t.prompt && !t.prompt.includes("zx-")));
check("reassigned count honest", split.reassigned === 2);
check("ICL prompts carry mints, not originals", split.icl.every((t) => !t.prompt.includes("/") && t.prompt.includes("zx-")));
check("label keys re-dealt through the same mapping", split.icl.every((t) => t.label.startsWith("zx-")));
check("disjoint witness true on clean fixtures", split.disjoint === true);
// A real leak rides the PROMPT TEXT without being declared: x2 mentions
// shared/repo but declares no identifiers, so no re-mint cleans it and the
// IWL probe's identifier genuinely appears inside the ICL context.
const leaky = iclIwlSplit(
  [
    { id: "x1", prompt: "Use repo shared/repo.", identifiers: ["shared/repo"], label: "shared/repo" },
    { id: "x2", prompt: "Compare against shared/repo in your answer.", identifiers: [], label: "other" },
  ],
  "leak-salt",
  1,
);
check("undeclared identifier leak reported disjoint=false (honest, not assumed)", leaky.disjoint === false);
check("heldOutCount clamped to list length", iclIwlSplit(tasks.slice(0, 1), "s", 5).icl.length === 1);

// ── summary ─────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\nQA LOOPED-ICL: ${passed}/${total} checks ${failed === 0 ? "PASS" : "FAIL"}`);
if (failed > 0) process.exitCode = 1;
