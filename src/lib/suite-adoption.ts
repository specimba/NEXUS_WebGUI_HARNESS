// ─── r40 sticky-adoption guard ───────────────────────────────────────────────
// r39 lets a scheduled bake-off apply its own verdicts (opt-in). Risk: one
// noisy round flips a pipeline's harness, and the next round flips it back —
// the "self-maintaining" loop becomes a flip-flopper. Guard doctrine:
//
//   A round's verdict only auto-applies when it AGREES with the previous
//   scheduled round's winner for the same case (2 consecutive agreeing
//   rounds). A single flipped verdict is HELD — recorded honestly in the
//   adoption audit — so one bad round can never move a pipeline. A real,
//   sustained shift still lands: the second agreeing round applies it.
//
// Pure functions here so the decision is unit-testable without the scheduler.

export interface AdoptionDecision {
  /** Apply the verdict as the workflow's harness default. */
  apply: boolean;
  /** Short human reason recorded in the audit (present when held/no-op). */
  reason?: string;
}

/**
 * Decide whether THIS round's winner should auto-apply.
 * @param prevWinner The previous scheduled round's winner for this case
 *   (undefined = first observation — nothing to agree with yet).
 * @param winner This round's crowned harness id.
 */
export function decideAdoption(prevWinner: string | undefined, winner: string): AdoptionDecision {
  if (prevWinner === undefined) {
    return { apply: true, reason: "first observation — baseline verdict applied" };
  }
  if (prevWinner === winner) {
    return { apply: true };
  }
  return {
    apply: false,
    reason: "verdict changed vs last round — held until it agrees twice in a row",
  };
}

/** Merge this round's winners into the sticky map for the NEXT round. */
export function mergeLastWinners(
  prev: Record<string, string> | undefined,
  winners: Record<string, string>
): Record<string, string> {
  return { ...(prev ?? {}), ...winners };
}
