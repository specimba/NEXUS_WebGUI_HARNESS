/**
 * r647 (paper adaptation slice 1, arXiv 2610.32285 "Trial by Trace") —
 * TraceTrial harness-reliability layer.
 *
 * The paper evaluates agent HARNESSES as first-class subjects: seven
 * reliability components, a two-layer evaluation (agent task outcome vs
 * harness behavior), measurement-bypass handling (Z_H = F_H ∖ B), and
 * failure attribution through explicit mechanism chains where co-occurrence
 * is NEVER reported as propagation without evidence review (candidate vs
 * validated).
 *
 * Port the QUESTIONS, never the judge: this module is a pure, dial-free
 * classifier over the run artifacts the house already materializes (step
 * statuses, rework flags, gate verdicts, tool-call rows, sentinel chips).
 * Every criterion below has its trigger, expected behavior, observation
 * boundary and verdict condition fixed BEFORE execution — the paper's
 * "admission gate" (F7) — so a criterion can never be invented post-hoc to
 * explain a bad run.
 */

// ── F1: the seven-component taxonomy (data as cited) ────────────────────────

export type HarnessComponentId =
  | "context"
  | "execution"
  | "governance"
  | "lifecycle"
  | "observability"
  | "tools"
  | "verification";

export interface HarnessComponent {
  id: HarnessComponentId;
  code: "C" | "E" | "G" | "L" | "O" | "T" | "V";
  name: string;
  /** Evaluation focus, verbatim-faithful to the paper's taxonomy table. */
  focus: string;
  /** Task coverage in the paper's 95-task population (Fig. 4). */
  tasks: number;
}

export const HARNESS_COMPONENTS: HarnessComponent[] = [
  { id: "context", code: "C", name: "Context", focus: "Information preservation and disclosure across boundaries.", tasks: 15 },
  { id: "execution", code: "E", name: "Execution", focus: "Faithful process semantics, state, and result delivery.", tasks: 27 },
  { id: "governance", code: "G", name: "Governance", focus: "Approvals, guardrails, secret redaction, and trust boundaries.", tasks: 9 },
  { id: "lifecycle", code: "L", name: "Lifecycle", focus: "Correct state transitions, recovery, and idempotent retries.", tasks: 19 },
  { id: "observability", code: "O", name: "Observability", focus: "Model-visible diagnostics, replayable logs, and provenance.", tasks: 7 },
  { id: "tools", code: "T", name: "Tools", focus: "Valid tool interfaces, faithful transport, and discovery.", tasks: 17 },
  { id: "verification", code: "V", name: "Verification", focus: "Consistency of completion claims with authoritative outcomes.", tasks: 1 },
];

/** The paper's Looped-pass hard cap (house mirror of the r<=3 plateau). */
export const LOOP_CAP = 3;

// ── Minimal structural run shape (no imports; structural typing) ────────────

export type StepStatus = "pending" | "running" | "done" | "error" | "stopped" | "skipped";

export interface RunStepShape {
  status?: StepStatus;
  kind?: "generate" | "review";
  verdict?: "pass" | "rework";
  reworked?: boolean;
  toolCalls?: unknown[];
  /** r29 sentinel: the step ended on a tool-budget auto-digest, not a real answer. */
  autoDigest?: boolean;
  /** r644 looped-depth outcome: k tied passes delivered of r planned. */
  looped?: { k: number; r: number; reason: string };
  output?: string;
  ms?: number;
}

export interface RunShape {
  steps?: RunStepShape[];
  /** Agent-layer task outcome (did the run deliver). */
  success?: boolean;
  /** Final gate verdict, when a gate ran. */
  finalVerdict?: "pass" | "fail" | null;
}

// ── Two-layer criterion verdicts (F2: separate the layers) ──────────────────

export type CriterionVerdict = "pass" | "fail" | "bypassed";

export interface RunCriterion {
  component: HarnessComponentId;
  /** Stable mechanism id — specified before execution, never post-hoc. */
  criterion: string;
  verdict: CriterionVerdict;
  /** Countable evidence line (house note vocabulary). */
  note: string;
}

const first = <T,>(v: T | undefined, d: T): T => (v === undefined ? d : v);

/**
 * Derive harness-layer criteria from native run artifacts. Each criterion is
 * an admitted mechanism: trigger + expected behavior + boundary + verdict,
 * fixed in code (F7). Components whose properties are NOT observable from
 * the run shape (context isolation, governance/redaction) are deliberately
 * ABSENT — they need harness-side telemetry (redaction lane, r525) and are
 * slice-2 work; fabricating a pass would be the exact theatre this paper
 * exists to kill.
 */
export function classifyRunCriteria(run: RunShape): RunCriterion[] {
  try {
    const steps = Array.isArray(run.steps) ? run.steps : [];
    const success = first(run.success, false);
    const out: RunCriterion[] = [];

    // E1 — no-silent-failure: a successful run must not carry error rows.
    // Empty run = property unobservable = bypassed (no vacuous green, r183).
    const errorSteps = steps.filter((s) => s.status === "error").length;
    out.push({
      component: "execution",
      criterion: "execution/no-silent-failure",
      verdict: steps.length === 0 ? "bypassed" : success && errorSteps > 0 ? "fail" : "pass",
      note: steps.length === 0
        ? "TraceTrial E/no-silent-failure BYPASSED — empty run (property unobservable, visible zero)"
        : success && errorSteps > 0
          ? `TraceTrial E/no-silent-failure FAIL — run reports success with ${errorSteps} error row${errorSteps === 1 ? "" : "s"} (success ≠ reliable, paper F3)`
          : "TraceTrial E/no-silent-failure pass — error rows and success agree",
    });

    // E2 — no-sentinel-impersonation: an auto-digest sentinel must not count
    // as a real answer (the paper's wrapper-replacing-exit-status shape).
    const sentinels = steps.filter((s) => s.autoDigest === true).length;
    out.push({
      component: "execution",
      criterion: "execution/no-sentinel-impersonation",
      verdict: steps.length === 0 ? "bypassed" : success && sentinels > 0 ? "fail" : "pass",
      note: steps.length === 0
        ? "TraceTrial E/no-sentinel-impersonation BYPASSED — empty run (property unobservable, visible zero)"
        : success && sentinels > 0
          ? `TraceTrial E/no-sentinel-impersonation FAIL — ${sentinels} auto-digest sentinel row${sentinels === 1 ? "" : "s"} inside a successful run (bypass shape, paper F6)`
          : "TraceTrial E/no-sentinel-impersonation pass — no sentinel row read as a real answer",
    });

    // L1 — rework converges: a reworked step must reach a terminal done state,
    // and looped passes must respect the cap.
    const reworked = steps.filter((s) => s.reworked === true);
    const capBreach = steps.some((s) => s.looped && s.looped.k > LOOP_CAP);
    const unconverged = reworked.filter((s) => s.status !== "done").length;
    out.push({
      component: "lifecycle",
      criterion: "lifecycle/rework-converges",
      verdict: steps.length === 0 ? "bypassed" : capBreach || unconverged > 0 ? "fail" : "pass",
      note: steps.length === 0
        ? "TraceTrial L/rework-converges BYPASSED — empty run (property unobservable, visible zero)"
        : capBreach
          ? `TraceTrial L/rework-converges FAIL — looped pass count exceeded the cap (${LOOP_CAP})`
          : unconverged > 0
            ? `TraceTrial L/rework-converges FAIL — ${unconverged} reworked step${unconverged === 1 ? "" : "s"} did not reach done`
            : "TraceTrial L/rework-converges pass — rework bounded and convergent",
    });

    // V1 — claims match gates: success must not contradict a failing final
    // verdict; no gate information at all = property unobservable = bypassed
    // (stays visible, excluded from attribution — the paper's Z_H = F_H ∖ B).
    const hasVerdict = steps.some((s) => s.verdict) || run.finalVerdict != null;
    out.push({
      component: "verification",
      criterion: "verification/claims-match-gates",
      verdict: !hasVerdict ? "bypassed" : success && run.finalVerdict === "fail" ? "fail" : "pass",
      note: !hasVerdict
        ? "TraceTrial V/claims-match-gates BYPASSED — no gate verdict in this run (property unobservable, visible zero, not attributed)"
        : success && run.finalVerdict === "fail"
          ? "TraceTrial V/claims-match-gates FAIL — success claimed against a failing final verdict"
          : "TraceTrial V/claims-match-gates pass — completion claims consistent with gate verdicts",
    });

    // T1 — transport faithful: steps that dialed tools must not end in errors
    // inside an otherwise-successful run; no tool use at all = bypassed.
    const toolSteps = steps.filter((s) => Array.isArray(s.toolCalls) && s.toolCalls.length > 0);
    const toolError = toolSteps.filter((s) => s.status === "error").length;
    out.push({
      component: "tools",
      criterion: "tools/transport-faithful",
      verdict: toolSteps.length === 0 ? "bypassed" : success && toolError > 0 ? "fail" : "pass",
      note: toolSteps.length === 0
        ? "TraceTrial T/transport-faithful BYPASSED — no tool calls in this run (property unobservable, visible zero, not attributed)"
        : success && toolError > 0
          ? `TraceTrial T/transport-faithful FAIL — ${toolError} tool-dialing step${toolError === 1 ? "" : "s"} in error inside a successful run`
          : `TraceTrial T/transport-faithful pass — ${toolSteps.length} tool-dialing step${toolSteps.length === 1 ? "" : "s"} delivered`,
    });

    // O1 — lineage present: every done step carries a replayable trace
    // (output, duration, or a gate verdict — a verdict row IS provenance).
    const blind = steps.filter(
      (s) =>
        s.status === "done" &&
        !(typeof s.output === "string" && s.output.length > 0) &&
        typeof s.ms !== "number" &&
        !s.verdict,
    ).length;
    out.push({
      component: "observability",
      criterion: "observability/lineage-present",
      verdict: steps.length === 0 ? "bypassed" : blind > 0 ? "fail" : "pass",
      note: steps.length === 0
        ? "TraceTrial O/lineage-present BYPASSED — empty run (property unobservable)"
        : blind > 0
          ? `TraceTrial O/lineage-present FAIL — ${blind} done step${blind === 1 ? "" : "s"} with no output and no duration (not replayable)`
          : "TraceTrial O/lineage-present pass — every done row carries output or duration",
    });

    return out;
  } catch {
    // never-throw: a degenerate run classifies as fully bypassed, visible.
    return [
      {
        component: "observability",
        criterion: "observability/lineage-present",
        verdict: "bypassed",
        note: "TraceTrial O/lineage-present BYPASSED — run shape unreadable",
      },
    ];
  }
}

// ── Failure attribution (F5+F6): bypass subtraction + mechanism chains ──────

export type ChainStatus = "candidate" | "validated";

export interface MechanismChain {
  /** Harness component whose failure opens the chain. */
  from: HarnessComponentId;
  /** Declared mechanism, e.g. "vault-empty starves the closed-tab lane". */
  mechanism: string;
  /** House-validated chains (evidence-reviewed, e.g. r640). */
  validated?: boolean;
}

export interface AttributionReport {
  /** Raw zero-scored harness criteria INCLUDING bypassed ones (F6: stay visible). */
  rawFailures: RunCriterion[];
  /** Z_H = F_H ∖ B — bypassed criteria excluded from attribution. */
  harnessFailures: RunCriterion[];
  /** B — the bypass set, visible but not attributable. */
  bypassed: RunCriterion[];
  /** Agent-layer failure present? */
  agentFailed: boolean;
  /** Chains activated by this run: candidate by default, validated only
   * against the declared validated list (co-occurrence ≠ propagation, F5). */
  chains: Array<{ status: ChainStatus; from: HarnessComponentId; mechanism: string; criterion: string }>;
}

/**
 * Attribute failures at run level. The agent layer and the harness layer are
 * scored separately FIRST; this function only connects finalized verdicts.
 * A chain is `candidate` when a harness failure co-occurs with an agent
 * failure under a declared mechanism — it becomes `validated` only if the
 * mechanism appears in `validatedMechanisms` (evidence-reviewed chains, like
 * the r640 vault-empty → closed-tab starvation incident).
 */
export function attributeFailure(
  criteria: RunCriterion[],
  agentFailed: boolean,
  validatedMechanisms: string[] = [],
): AttributionReport {
  try {
    const list = Array.isArray(criteria) ? criteria : [];
    const rawFailures = list.filter((c) => c.verdict !== "pass");
    const harnessFailures = list.filter((c) => c.verdict === "fail");
    const bypassed = list.filter((c) => c.verdict === "bypassed");
    const chains: AttributionReport["chains"] = [];
    if (agentFailed) {
      for (const h of harnessFailures) {
        for (const m of DECLARED_CHAINS) {
          if (m.from !== h.component) continue;
          const validated = validatedMechanisms.includes(m.mechanism);
          chains.push({ status: validated ? "validated" : "candidate", from: m.from, mechanism: m.mechanism, criterion: h.criterion });
        }
      }
    }
    return { rawFailures, harnessFailures, bypassed, agentFailed, chains };
  } catch {
    return { rawFailures: [], harnessFailures: [], bypassed: [], agentFailed: false, chains: [] };
  }
}

/**
 * House-declared mechanism chains. Only mechanisms whose trigger, expected
 * behavior and verdict were specified BEFORE execution may be declared here
 * (the paper's admission gate). The r640 vault incident is the first
 * evidence-validated member.
 */
export const DECLARED_CHAINS: MechanismChain[] = [
  { from: "governance", mechanism: "vault-empty starves the closed-tab lane", validated: false },
  { from: "execution", mechanism: "sentinel digest displaces the real answer downstream", validated: false },
  { from: "lifecycle", mechanism: "unbounded rework exhausts the run budget", validated: false },
];

/** The r640-validated chain id, for callers that pass a validated list. */
export const VALIDATED_R640_CHAIN = "vault-empty starves the closed-tab lane";

// ── F3: the success-despite-violation summary ───────────────────────────────

export interface HarnessSummary {
  total: number;
  pass: number;
  fail: number;
  bypassed: number;
  /** Paper-faithful harness score: passes over (passes + failures); bypassed excluded. */
  score: number | null;
  /** The F3 counter — green masks red underneath. */
  successDespiteViolation: boolean;
}

export function harnessSummary(criteria: RunCriterion[], success: boolean): HarnessSummary {
  try {
    const list = Array.isArray(criteria) ? criteria : [];
    const pass = list.filter((c) => c.verdict === "pass").length;
    const fail = list.filter((c) => c.verdict === "fail").length;
    const bypassed = list.filter((c) => c.verdict === "bypassed").length;
    const denom = pass + fail;
    return {
      total: list.length,
      pass,
      fail,
      bypassed,
      score: denom > 0 ? pass / denom : null,
      successDespiteViolation: success && fail > 0,
    };
  } catch {
    return { total: 0, pass: 0, fail: 0, bypassed: 0, score: null, successDespiteViolation: false };
  }
}

// ── Countable call-log note vocabulary (house doctrine) ─────────────────────

/** Render an attribution as a countable call-log note. */
export function attributionNote(report: AttributionReport): string {
  try {
    const n = report.harnessFailures.length;
    const b = report.bypassed.length;
    const chains = report.chains
      .map((c) => `${c.status} chain: ${c.criterion} → ${c.mechanism}`)
      .join("; ");
    return `TraceTrial attribution — ${n} harness failure${n === 1 ? "" : "s"}, ${b} bypassed (visible, unattributed)${chains ? ` — ${chains}` : ""}${report.agentFailed ? " — agent layer failed" : " — agent layer passed"}`;
  } catch {
    return "TraceTrial attribution — report unreadable";
  }
}

// ── r648 slice-2 adapter: run-level chip for UI surfaces ────────────────────

export type HarnessChipTone = "pass" | "warn";

export interface HarnessChip {
  label: string;
  tone: HarnessChipTone;
  tooltip: string;
  /** F3: the run SUCCEEDED while violating >=1 harness criterion (a debt). */
  successDespiteViolation: boolean;
}

/**
 * Classify one run into its harness-layer chip. Accepts the house run-step
 * shape INCLUDING the `degraded` alias (WorkflowRunStep's r29 sentinel field
 * name) so UI call sites need no mapping. Returns null when every criterion
 * is bypassed — no signal, no chip (absent evidence renders absent).
 */
export function harnessChipForRun(
  steps: Array<RunStepShape & { degraded?: boolean }>,
  status?: string,
): HarnessChip | null {
  try {
    const list = Array.isArray(steps) ? steps : [];
    const success = status === "done";
    const criteria = classifyRunCriteria({
      steps: list.map((s) => ({ ...s, autoDigest: s.autoDigest === true || s.degraded === true })),
      success,
      finalVerdict: null,
    });
    const sum = harnessSummary(criteria, success);
    const scored = sum.pass + sum.fail;
    if (scored === 0) return null;
    const failed = criteria.filter((c) => c.verdict === "fail");
    const label = `harness ${sum.pass}/${scored}`;
    if (sum.fail === 0) {
      return {
        label,
        tone: "pass",
        tooltip: `TraceTrial harness layer (arXiv 2610.32285): ${sum.pass}/${scored} criteria pass — judged separately from the task outcome.`,
        successDespiteViolation: false,
      };
    }
    return {
      label,
      tone: "warn",
      tooltip: `TraceTrial harness layer (arXiv 2610.32285): ${sum.fail} violation${sum.fail === 1 ? "" : "s"} — ${failed
        .map((f) => f.criterion)
        .join(", ")}${sum.successDespiteViolation ? " · run SUCCEEDED despite violations (F3: success ≠ reliable)" : ""}`,
      successDespiteViolation: sum.successDespiteViolation,
    };
  } catch {
    return null;
  }
}
