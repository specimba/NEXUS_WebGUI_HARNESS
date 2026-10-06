/**
 * r304 — the "deep paused" card chip, derived by ONE pure rule.
 *
 * The runner degrades a Deep workflow's scheduled fires to Standard once
 * schedule.failStreak reaches 2 (see workflow-runner.ts — enforcement lives at
 * the single choke point every fire path shares; manual runs keep the authored
 * depth, and any completed run resets the streak, restoring deep). The
 * workflows board mirrors that state as a card chip. Before r304 the chip
 * hardcoded "deep paused · firing standard" whenever depth=deep and
 * failStreak ≥ 2 — including while the failure breaker or a rate-limit
 * backoff had the schedule PAUSED, a state in which nothing fires at all
 * (witnessed live on a user board: the chip sat stacked on the red
 * "auto-paused · click to resume" chip, claiming to fire standard).
 *
 * This module is dependency-free on purpose: the unit suite imports it
 * directly (scripts/qa-depth-chip.ts) and the board renders exactly what it
 * computes, so chip and runner semantics can never drift apart silently.
 */

export interface DeepPauseChipInput {
  depth?: string;
  schedule?: {
    enabled?: boolean;
    failStreak?: number;
    autoResumeAt?: number;
  } | null;
}

export interface DeepPauseChipState {
  /** The chip's visible label — honest to whether anything actually fires. */
  label: string;
  /** Tooltip: what happened, and what restores deep. */
  title: string;
}

/** The runner's degrade threshold: failStreak ≥ 2 fires Standard. */
const DEGRADE_STREAK = 2;

function backoffLabel(autoResumeAt: number): string {
  const mins = Math.max(1, Math.ceil((autoResumeAt - Date.now()) / 60_000));
  return `auto-resume in ~${mins}m`;
}

export function deepPauseChip(wf: DeepPauseChipInput): DeepPauseChipState | null {
  if ((wf.depth ?? "standard") !== "deep") return null;
  const streak = wf.schedule?.failStreak ?? 0;
  if (streak < DEGRADE_STREAK) return null;
  const sched = wf.schedule;

  // A disabled schedule fires NOTHING — the chip must not claim "firing
  // standard" while the breaker or a 429 backoff has it parked (r304).
  if (!sched || sched.enabled === false) {
    const why =
      sched?.autoResumeAt != null
        ? `in rate-limit backoff (${backoffLabel(sched.autoResumeAt)})`
        : "auto-paused by the failure breaker";
    return {
      label: "deep paused",
      title: `Deep passes are paused after ${streak} consecutive failures — and the schedule is ${why}, so nothing fires at all right now. Resume the schedule (or any completed run) to restore deep; manual Runs keep the authored Deep depth.`,
    };
  }

  return {
    label: "deep paused · firing standard",
    title: `Deep passes are paused after ${streak} consecutive failures — scheduled fires run Standard until a run completes (manual Run keeps Deep). If a scheduled fire still materializes deep passes, this tab is running a stale bundle — refresh.`,
  };
}
