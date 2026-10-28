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
 * - r670: verdictLine is the LATEST verdict's outcome (a rework-then-pass run
 *   must read PASS — the run's final gate state), and it carries a TONE:
 *   pass → emerald, fail → amber. A FAIL verdict in an emerald chip misreads
 *   as success — the r659 note-level false-alarm doctrine, now at chip level.
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
  /** LATEST verdict outcome found, e.g. "FAIL 95%" — for at-a-glance chips. */
  verdictLine?: string;
  /** Tone of the latest verdict: pass → emerald, fail → amber. */
  verdictTone?: "pass" | "fail";
  /** r692: newest gate-relevant `at` (epoch ms) — visible-run freshness.
   *  Stamped only by rows the census counts (gate heads); junk skipped. */
  latestAt?: number;
}

const EMPTY: GateCensus = { engaged: 0, verdicts: 0 };

/** Count gate engagements + verdicts from a run's call log (tolerant input).
 *  r692: rows may carry `at` (epoch ms, RunCallLogEntry) — the newest
 *  gate-relevant one returns as latestAt, the digest ⚖ chip's visible-run
 *  freshness input (read through the ledger-freshness home). */
export function gateCensusOf(
  callLog?: { note?: string; at?: number }[] | null
): GateCensus {
  if (!callLog || callLog.length === 0) return EMPTY;
  let engaged = 0;
  let verdicts = 0;
  let verdictLine: string | undefined;
  let latestAt: number | undefined;
  // r692: only rows the census COUNTS stamp freshness — an unrelated
  // engine call's newer `at` must never read as gate activity.
  const stampGate = (row?: { at?: number }): void => {
    if (!row || typeof row.at !== "number" || !Number.isFinite(row.at)) return;
    latestAt = latestAt === undefined ? row.at : Math.max(latestAt, row.at);
  };
  for (const c of callLog) {
    const note = c?.note;
    // r670 fixture catch: a junk row (note: 123) must be skipped, not throw —
    // tolerant input means tolerant, the never-throw doctrine at the reader.
    if (!note || typeof note !== "string") continue;
    if (note.startsWith(GATE_VERDICT_PREFIX)) {
      verdicts += 1;
      stampGate(c);
      verdictLine = VERDICT_OUTCOME_RE.exec(note)?.[0] ?? verdictLine;
    } else if (note.startsWith(GATE_ENGAGE_PREFIX)) {
      engaged += 1;
      stampGate(c);
      // r669: the fast-model verdict family ("Decision gate FAIL 95%
      // (fast-model) — one free rework pass runs") is a verdict too.
      if (/^Decision gate (?:PASS|FAIL) \d+%/.test(note)) {
        verdicts += 1;
        verdictLine = VERDICT_OUTCOME_RE.exec(note)?.[0] ?? verdictLine;
      }
    }
  }
  if (engaged === 0 && verdicts === 0) return EMPTY;
  // r670: last verdict wins — the run's final gate state is what the chip
  // shows and colors (emerald PASS / amber FAIL / muted engaged-only).
  const verdictTone = verdictLine?.startsWith("PASS")
    ? "pass"
    : verdictLine?.startsWith("FAIL")
      ? "fail"
      : undefined;
  const withStamp = latestAt !== undefined ? { latestAt } : {};
  return verdictLine
    ? { engaged, verdicts, verdictLine, ...(verdictTone ? { verdictTone } : {}), ...withStamp }
    : { engaged, verdicts, ...withStamp };
}

/**
 * r672 (RSI ledger slice): typed events extracted from the same note
 * vocabulary — the KICK corpus's interaction_logs pattern (KB-1-a candidate
 * #2): a durable ledger row per gate outcome, so the training corpus grows
 * from production verdicts instead of living only in the browser's trimmed
 * localStorage store. The census counts; the events EXPLAIN.
 */
export type GateEventKind =
  /** A confident judge verdict landed (PASS or FAIL, any family). */
  | "gate-verdict"
  /** The judge answered but below gate confidence — accepted unchanged. */
  | "gate-uncertain"
  /** The gate engaged; no judge rung answered (congestion / unarmed). */
  | "gate-no-judge"
  /** The judge dial itself errored — an infra stop, not a quality verdict. */
  | "gate-judge-error";

export interface GateEvent {
  kind: GateEventKind;
  /** PASS | FAIL — verdicts only. */
  verdict?: "PASS" | "FAIL";
  /** Judge confidence, 0-100 (verdicts and uncertains). */
  confidence?: number;
  /** Which rung answered, when the note names it (e.g. "fast-model"). */
  via?: string;
  /** The step the gate judged, when the callLog row carries it (r672 ledger). */
  stepId?: string;
  /** The note verbatim, capped at 500 chars (the export-cap doctrine). */
  note: string;
}

const VERDICT_EVENT_RE = /^(?:System-One|Decision) gate (PASS|FAIL) (\d+)%(?: \(([^)]+)\))?/;
const UNCERTAIN_RE = /^Decision gate uncertain (\d+)%(?: \(([^)]+)\))?/;

/** Extract typed gate events from a call log (tolerant, note-head anchored). */
export function gateEventsOf(
  callLog?: { note?: string; stepId?: string }[] | null
): GateEvent[] {
  if (!callLog || callLog.length === 0) return [];
  const out: GateEvent[] = [];
  for (const c of callLog) {
    const note = c?.note;
    if (!note || typeof note !== "string") continue;
    const stepId = typeof c.stepId === "string" ? c.stepId : undefined;
    const withStep = (e: Omit<GateEvent, "stepId">): GateEvent =>
      stepId != null ? { ...e, stepId } : e;
    if (note.startsWith(GATE_VERDICT_PREFIX)) {
      const m = VERDICT_EVENT_RE.exec(note);
      if (m) {
        out.push(withStep({
          kind: "gate-verdict",
          verdict: m[1] as "PASS" | "FAIL",
          confidence: Number(m[2]),
          ...(m[3] != null ? { via: m[3] } : {}),
          note: note.slice(0, 500),
        }));
      }
    } else if (note.startsWith(GATE_ENGAGE_PREFIX)) {
      const u = UNCERTAIN_RE.exec(note);
      if (u) {
        out.push(withStep({
          kind: "gate-uncertain",
          confidence: Number(u[1]),
          ...(u[2] != null ? { via: u[2] } : {}),
          note: note.slice(0, 500),
        }));
      } else if (note.includes("no judge answered")) {
        out.push(withStep({ kind: "gate-no-judge", note: note.slice(0, 500) }));
      } else if (note.includes("judge errored")) {
        out.push(withStep({ kind: "gate-judge-error", note: note.slice(0, 500) }));
      } else {
        const v = VERDICT_EVENT_RE.exec(note);
        if (v) {
          out.push(withStep({
            kind: "gate-verdict",
            verdict: v[1] as "PASS" | "FAIL",
            confidence: Number(v[2]),
            ...(v[3] != null ? { via: v[3] } : {}),
            note: note.slice(0, 500),
          }));
        }
      }
    }
  }
  return out;
}
