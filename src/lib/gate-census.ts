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
 * - r669: the runner's SECOND verdict family — "Decision gate PASS|FAIL N%
 *   (fast-model)" notes — is a real verdict, not a bare engagement. The
 *   store read proved it: Novelty Lab runs hold "Decision gate PASS 95%
 *   (fast-model) — output accepted" and "Decision gate FAIL 95% (fast-
 *   model) — one free rework pass runs". Both families count as verdicts
 *   now, and the first outcome ("FAIL 95%") rides along as verdictLine so
 *   the chips can show WHAT the verdict was without opening the call log.
 * No-judge notes ("engaged but no judge answered") stay engagement-only —
 * the verdict regex is anchored to the note's head, so the tried-ladder
 * trace inside those notes can never masquerade as an outcome.
 *
 * Born from the r667 correction: six engagement notes sat unseen inside a
 * converged run because the only readers were rendered-text searches; the
 * census must live in the data layer, not in the DOM.
 */

/** Prefix the runner stamps when the gate engages but no verdict lands. */
export const GATE_ENGAGE_PREFIX = "Decision gate";
/** Prefix the runner stamps when a judge lands a confident verdict. */
export const GATE_VERDICT_PREFIX = "System-One gate";

/** A verdict outcome at the head of a gate note, e.g. "FAIL 95%". */
const VERDICT_OUTCOME_RE = /(?:PASS|FAIL) \d+%/;

export interface GateCensus {
  /** Gate engagements: gate-worthy outputs that called the judge ladder. */
  engaged: number;
  /** Confident verdicts: judges that answered with ≥threshold confidence. */
  verdicts: number;
  /** First verdict outcome found, e.g. "FAIL 95%" — for at-a-glance chips. */
  verdictLine?: string;
}

const EMPTY: GateCensus = { engaged: 0, verdicts: 0 };

/** Count gate engagements + verdicts from a run's call log (tolerant input). */
export function gateCensusOf(
  callLog?: { note?: string }[] | null
): GateCensus {
  if (!callLog || callLog.length === 0) return EMPTY;
  let engaged = 0;
  let verdicts = 0;
  let verdictLine: string | undefined;
  for (const c of callLog) {
    const note = c?.note;
    if (!note) continue;
    if (note.startsWith(GATE_VERDICT_PREFIX)) {
      verdicts += 1;
      verdictLine ??= VERDICT_OUTCOME_RE.exec(note)?.[0];
    } else if (note.startsWith(GATE_ENGAGE_PREFIX)) {
      engaged += 1;
      // r669: the fast-model verdict family ("Decision gate FAIL 95%
      // (fast-model) — one free rework pass runs") is a verdict too.
      if (/^Decision gate (?:PASS|FAIL) \d+%/.test(note)) {
        verdicts += 1;
        verdictLine ??= VERDICT_OUTCOME_RE.exec(note)?.[0];
      }
    }
  }
  if (engaged === 0 && verdicts === 0) return EMPTY;
  return verdictLine ? { engaged, verdicts, verdictLine } : { engaged, verdicts };
}
