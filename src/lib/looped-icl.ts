// ─── looped-icl.ts — depth-reuse semantics for harness steps (r643) ─────────
// Adaptation slice of arXiv 2610.31421 (Kapl, Maile, Bauer, von Oswald:
// "How Depth Growth and Looping Shape In-Context Learning in Language
// Models", TUM x Google Paradigms of Intelligence Team, 22 Oct 2026 —
// local PDF at upload/How Depth Growth and Looping Shape In-Context
// Learning in Language Models.pdf; digest at
// docs/strategy/paper-digest-2610-31421-looping-icl.md).
//
// The paper's core: REUSING computation across depth — looping (a tied
// block applied r times per forward pass) or depth growing (duplicated
// blocks whose copies then specialize independently) — builds a shared
// inductive bias toward learning FROM CONTEXT (induction-style precedent
// copying) and protects that solution from being displaced by associations
// learned into the weights (IWL). Grown/looped 3B models beat a matched
// dense baseline on few-shot GSM8K, adapt to unseen formal languages
// within the first ~15 symbols (RegBench), retain ICL where dense models
// let it decay, and trace their strongest induction heads back to a
// handful of EARLY ancestors that duplication propagates across depth.
//
// We port the SHAPES, not the neurons — the harness analogs:
//   loopedPlan / grownPlan — prelude -> shared-block x r -> coda pass
//                            plans (tied vs copy-and-specialize semantics)
//   loopExit               — verdict-gated early exit (pass exits, ONE
//                            bounded rework on fail, cap on unsure)
//   twoOccurrencePrompt    — the format exemplar appears twice: an early
//                            anchor and a target immediately before the
//                            generation point (an induction circuit copies
//                            the continuation of an EARLIER occurrence;
//                            the ablation data says task identity (FV)
//                            dominates early tokens while structure
//                            copying grows with position — so anchor the
//                            task early and repeat the shape late)
//   reassignLabels         — the paper's Figure 3(b) probe: mint fresh
//                            identifiers per sequence so a memorized
//                            (in-weights) solution cannot fire
//   iclIwlSplit            — ICL probe (held-out, reassigned) vs IWL probe
//                            (fixed labels, identifiers absent from the
//                            context), with an honest disjoint witness
//
// Pure + isomorphic: no imports, no IO, deterministic on its inputs.
// Claim discipline: behavioral analogy, not mechanism — nothing here
// measures attention heads.

/** RegBench shows the iterative advantage plateaus after the first few
 *  strings — more passes buy the plateau, not more. Hard cap for plans. */
export const LOOP_PASSES_CAP = 3;

export type LoopVerdict = "pass" | "fail" | "unsure";

export interface LoopedStepSpec {
  /** Context assembly prompt — plays the role of the prelude layers. */
  prelude: string;
  /** THE shared block prompt — applied identically on every looped pass. */
  block: string;
  /** Requested applications of the shared block (clamped to [1, CAP]). */
  passes: number;
  /** Finalization prompt — the coda layers. */
  coda: string;
}

export interface LoopedPass {
  /** 0 = prelude, 1..r = block applications, r+1 = coda. */
  index: number;
  kind: "prelude" | "block" | "coda";
  prompt: string;
  /** true iff this block pass shares the byte-identical tied prompt. */
  tied: boolean;
  /** true iff this is the truncation point of an over-budget request. */
  budgetCapped: boolean;
}

export type PlanResult =
  | { ok: true; passes: LoopedPass[]; clamped: boolean; requested: number }
  | { ok: false; error: string };

/** Loop p-b×r-c semantics (paper App A.2): p prelude layers, a shared block
 *  of b applied r times, c coda layers. The harness version keeps the block
 *  prompt byte-identical across applications — the TIED invariant — and
 *  clamps r to LOOP_PASSES_CAP with a budgetCapped marker on the truncation
 *  point. Never throws: contract violations come back as ok:false. */
export function loopedPlan(spec: LoopedStepSpec): PlanResult {
  if (!spec.block || spec.block.trim().length === 0) {
    return { ok: false, error: "loopedPlan: the shared block prompt must be non-empty" };
  }
  if (!Number.isFinite(spec.passes) || spec.passes < 1) {
    return { ok: false, error: "loopedPlan: passes must be a finite number >= 1" };
  }
  const requested = Math.floor(spec.passes);
  const clamped = requested > LOOP_PASSES_CAP;
  const r = Math.min(requested, LOOP_PASSES_CAP);
  const passes: LoopedPass[] = [];
  if (spec.prelude.trim().length > 0) {
    passes.push({
      index: 0,
      kind: "prelude",
      prompt: spec.prelude,
      tied: false,
      budgetCapped: false,
    });
  }
  for (let i = 1; i <= r; i++) {
    passes.push({
      index: i,
      kind: "block",
      prompt: spec.block,
      tied: true,
      budgetCapped: clamped && i === r,
    });
  }
  if (spec.coda.trim().length > 0) {
    passes.push({
      index: r + 1,
      kind: "coda",
      prompt: spec.coda,
      tied: false,
      budgetCapped: false,
    });
  }
  return { ok: true, passes, clamped, requested };
}

/** Grown semantics (paper App A.2): duplicated blocks' copies "train
 *  independently" — each copy carries its own specialization delta on top
 *  of the shared base prompt. Refuses silently-wrong calls: the delta list
 *  must have exactly one entry per block copy. */
export function grownPlan(spec: LoopedStepSpec, deltas: string[]): PlanResult {
  const base = loopedPlan(spec);
  if (!base.ok) return base;
  const blockCount = base.passes.filter((p) => p.kind === "block").length;
  if (!Array.isArray(deltas) || deltas.length !== blockCount) {
    return {
      ok: false,
      error: `grownPlan: expected ${blockCount} deltas (one per block copy — copies specialize independently), got ${
        Array.isArray(deltas) ? deltas.length : "non-array"
      }`,
    };
  }
  let d = 0;
  const passes = base.passes.map((p) => {
    if (p.kind !== "block") return p;
    const delta = deltas[d];
    d += 1;
    return {
      ...p,
      tied: false,
      prompt: `${p.prompt}\n\nCopy specialization: ${delta ?? ""}`,
    };
  });
  return { ...base, passes };
}

export interface LoopExit {
  /** 1-based pass index that ended the loop (0 when the list is empty). */
  exitedAt: number;
  planned: number;
  reason: "pass-verdict" | "rework-exhausted" | "cap-reached" | "empty";
}

/** Verdict-gated early exit over a sequence of per-pass verdicts.
 *  - "pass" exits immediately (pass-verdict).
 *  - "fail" buys ONE bounded rework pass; a second consecutive fail (or a
 *    fail with no pass left) exhausts the budget — mirrors the house
 *    "max two rework dials per step" doctrine from the decision gates.
 *  - "unsure" keeps iterating until the plan cap (cap-reached). */
export function loopExit(verdicts: LoopVerdict[]): LoopExit {
  if (verdicts.length === 0) {
    return { exitedAt: 0, planned: 0, reason: "empty" };
  }
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i];
    if (v === "pass") {
      return { exitedAt: i + 1, planned: verdicts.length, reason: "pass-verdict" };
    }
    if (v === "fail") {
      const next = verdicts[i + 1];
      if (next === undefined || next === "fail") {
        return { exitedAt: Math.min(i + 2, verdicts.length), planned: verdicts.length, reason: "rework-exhausted" };
      }
    }
  }
  return { exitedAt: verdicts.length, planned: verdicts.length, reason: "cap-reached" };
}

export const ANCHOR_TAG = "Reference shape (anchor):";
export const TARGET_TAG = "Reference shape (repeat — follow exactly):";

export interface TwoOccurrenceResult {
  prompt: string;
  /** Char index of the early anchor occurrence. */
  anchorIndex: number;
  /** Char index of the target occurrence adjacent to the generation point. */
  targetIndex: number;
  /** Number of times the exemplar appears in the assembled prompt. */
  occurrences: number;
}

/** The two-occurrence rule (paper F6/F7): an induction circuit copies the
 *  continuation of an EARLIER occurrence, and induction-head importance
 *  GROWS with token position while function-vector (task identity) effects
 *  dominate early tokens and plateau. Layout: task statement (task identity,
 *  early) -> anchor exemplar -> optional working body -> target exemplar
 *  immediately before the generation point. One exemplar, two occurrences,
 *  fixed roles. */
export function twoOccurrencePrompt(task: string, exemplar: string, body = ""): TwoOccurrenceResult {
  const anchor = `\n\n${ANCHOR_TAG}\n${exemplar}`;
  const target = `\n\n${TARGET_TAG}\n${exemplar}\n\nGenerate now:`;
  const parts: string[] = [task.trim(), anchor];
  if (body.trim().length > 0) {
    parts.push(`\n\n${body.trim()}`);
  }
  parts.push(target);
  const prompt = parts.join("");
  return {
    prompt,
    anchorIndex: prompt.indexOf(anchor),
    targetIndex: prompt.lastIndexOf(target),
    occurrences: exemplar.length > 0 ? prompt.split(exemplar).length - 1 : 0,
  };
}

/** FNV-1a, deterministic, 32-bit unsigned. */
export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const MINT_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Mint a fresh synthetic identifier: deterministic per (salt, id, slot),
 *  carries the "zx-" prefix so it can never collide with a natural token. */
function mint(salt: string, identifier: string, slot: number): string {
  let out = "";
  for (let i = 0; i < 10; i++) {
    const h = fnv1a(`${salt}::${slot}::${identifier}::${i}`);
    out += MINT_ALPHABET[h % MINT_ALPHABET.length];
  }
  return `zx-${out}`;
}

export interface ReassignResult {
  prompt: string;
  /** original identifier -> freshly minted identifier. */
  mapping: Record<string, string>;
}

/** The Figure 3(b) probe: labels re-dealt every sequence. Every identifier
 *  in the fixture is replaced with a per-run minted token, so a solution
 *  memorized from a previous run (in-weights) cannot fire — the only
 *  surviving solution reads the current context. Longest identifiers are
 *  replaced first so overlapping names cannot leave mixed residue. */
export function reassignLabels(
  fixture: { prompt: string; identifiers: string[] },
  sequenceSalt: string,
): ReassignResult {
  const ordered = [...new Set(fixture.identifiers)].sort((a, b) => b.length - a.length);
  const mapping: Record<string, string> = {};
  let prompt = fixture.prompt;
  ordered.forEach((id, slot) => {
    const fresh = mint(sequenceSalt, id, slot);
    mapping[id] = fresh;
    prompt = prompt.split(id).join(fresh);
  });
  return { prompt, mapping };
}

export interface ProbeTask {
  id: string;
  prompt: string;
  identifiers: string[];
  /** Expected answer key. Remapped through the mint when it is one of the
   *  identifiers (the paper re-deals class->label bindings per sequence). */
  label: string;
}

export interface SplitResult {
  /** ICL probe: held-out tasks, identifiers (and matching label keys)
   *  re-minted per run. */
  icl: ProbeTask[];
  /** IWL probe: fixed identifiers, originals intact — passing these with
   *  their identifiers ABSENT from the surrounding context is the memory
   *  (leak) direction of the probe. */
  iwl: ProbeTask[];
  /** Number of ICL probe tasks that were re-minted. */
  reassigned: number;
  /** true iff no IWL identifier appears inside any ICL prompt — the paper's
   *  guarantee ("query class absent from context"), reported honestly so a
   *  leaky fixture set is visible instead of silently assumed. */
  disjoint: boolean;
}

/** Split probe tasks into the paper's two measurements: ICL accuracy on
 *  held-out material with re-dealt bindings, IWL accuracy on fixed
 *  associations whose identifiers never enter the context. Held-out = the
 *  tail of the list (the newest entries). */
export function iclIwlSplit(tasks: ProbeTask[], salt: string, heldOutCount: number): SplitResult {
  const held = Math.max(0, Math.min(Math.floor(heldOutCount), tasks.length));
  const iclRaw = tasks.slice(tasks.length - held);
  const iwl = tasks.slice(0, tasks.length - held);
  const icl = iclRaw.map((t) => {
    const re = reassignLabels({ prompt: t.prompt, identifiers: t.identifiers }, `${salt}:${t.id}`);
    return { ...t, prompt: re.prompt, label: re.mapping[t.label] ?? t.label };
  });
  const iwlIds = iwl.flatMap((t) => t.identifiers);
  const iclPrompts = icl.map((t) => t.prompt).join("\n");
  return {
    icl,
    iwl,
    reassigned: icl.length,
    disjoint: iwlIds.every((id) => !iclPrompts.includes(id)),
  };
}
