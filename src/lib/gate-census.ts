/**
 * r668: the gate-activity census as a shared adapter — one reader for the
 * callLog's gate notes, replacing the r667 board IIFE and powering the run
 * panel's header chip (two honest call sites, r649 doctrine).
 *
 * Reader contract (mirrors what the run panel colors at line ~233):
 * - a call whose note starts with "Decision gate"  → one ENGAGEMENT
 *   (the gate saw gate-worthy output and called the ladder)
 * - a call whose note starts with "System-One gate" → one CONFIDENT VERDICT
 *   (a judge answered with ≥threshold confidence; PASS skips, FAIL reworks)
 * Everything else (relay hops, lane notes, dial errors) is not gate business.
 *
 * Born from the r667 correction: six engagement notes sat unseen inside a
 * converged run because the only readers were rendered-text searches; the
 * census must live in the data layer, not in the DOM.
 */

/** Prefix the runner stamps when the gate engages but no verdict lands. */
export const GATE_ENGAGE_PREFIX = "Decision gate";
/** Prefix the runner stamps when a judge lands a confident verdict. */
export const GATE_VERDICT_PREFIX = "System-One gate";

export interface GateCensus {
  /** Gate engagements: gate-worthy outputs that called the judge ladder. */
  engaged: number;
  /** Confident verdicts: judges that answered with ≥threshold confidence. */
  verdicts: number;
}

const EMPTY: GateCensus = { engaged: 0, verdicts: 0 };

/** Count gate engagements + verdicts from a run's call log (tolerant input). */
export function gateCensusOf(
  callLog?: { note?: string }[] | null
): GateCensus {
  if (!callLog || callLog.length === 0) return EMPTY;
  let engaged = 0;
  let verdicts = 0;
  for (const c of callLog) {
    const note = c?.note;
    if (!note) continue;
    if (note.startsWith(GATE_VERDICT_PREFIX)) verdicts += 1;
    else if (note.startsWith(GATE_ENGAGE_PREFIX)) engaged += 1;
  }
  if (engaged === 0 && verdicts === 0) return EMPTY;
  return { engaged, verdicts };
}
