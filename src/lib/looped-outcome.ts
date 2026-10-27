// ─── r658: looped-depth OUTCOME vocabulary (surface honesty, r656 lineage) ──
// The runner writes step.looped.reason (workflow-runner FAIL branch, r644);
// the run-row chip rendered the SAME amber for every exit reason — a
// CONVERGED loop (pass-verdict) wore warning amber exactly like a judge
// refusal, and a judge-unavailable stop (infrastructure, not quality)
// was indistinguishable from one. This module is the single adapter:
// surface renders tone+label from HERE, never from string luck.
// Never-throw; unknown reasons stay honest (muted "exit unknown").

export type LoopedOutcomeTone = "pass" | "warn" | "muted";

export interface LoopedOutcomeChip {
  tone: LoopedOutcomeTone;
  /** Short visible suffix after "↻ looped k/r ·" */
  label: string;
  /** Full honest sentence for the tooltip. */
  says: string;
}

const KNOWN: Record<string, LoopedOutcomeChip> = {
  "pass-verdict": {
    tone: "pass",
    label: "pass",
    says: "a re-judge accepted the reworked output — the loop converged",
  },
  "rework-exhausted": {
    tone: "warn",
    label: "best kept",
    says: "the judge kept refusing every tied pass — the best attempt is kept",
  },
  "cap-reached": {
    tone: "warn",
    label: "unsure at cap",
    says: "every re-judge landed unsure (below gate confidence both ways) — stopped at the cap",
  },
  "judge-unavailable": {
    tone: "muted",
    label: "judge down",
    says: "the judge errored mid-loop — infrastructure stop, not a quality verdict",
  },
};

export function loopedOutcomeChip(reason: unknown): LoopedOutcomeChip {
  if (typeof reason === "string" && KNOWN[reason]) return KNOWN[reason];
  return {
    tone: "muted",
    label: "exit unknown",
    says: `exit reason "${String(reason)}" is outside the known loop vocabulary — shown honestly unknown`,
  };
}
