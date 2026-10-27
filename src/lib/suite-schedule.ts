// ─── Suite-schedule hygiene (r42) ────────────────────────────────────────────
// Pure repair math for persisted SuiteSchedule objects. The scheduler tick
// does `Math.max(SUITE_SCHEDULE_MIN_MS, schedule.intervalMs)` — but
// `Math.max(floor, NaN)` is NaN, and a NaN nextRunAt never satisfies
// `nextRunAt <= now`, so one corrupted number silently KILLS an armed
// schedule (no error, no breaker, just dead). Corrupt numbers can arrive via
// a truncated localStorage write, a hand-edited export, or an old schema —
// so boot hygiene (ensureSeeded) and the fire-time tick both run schedules
// through this sanitizer before trusting them.
//
// Doctrine mirrors the r31 workflow-schedule quarantine: a malformed schedule
// must never block boot, and must never keep burning quota either — garbage
// beyond repair is disarmed honestly (console flag) instead of silently kept.

import { SUITE_REPEATS_MAX, SUITE_SCHEDULE_MIN_MS } from "./constants";
import type { SuiteSchedule } from "./types";

export interface SuiteScheduleSanitizeReport {
  schedule: SuiteSchedule;
  /** True when any field was repaired (callers should persist + log). */
  changed: boolean;
  /** True when the schedule was disarmed (garbage beyond repair). */
  quarantined: boolean;
  /** Human-readable repair notes (boot console + tests). */
  notes: string[];
}

/** Defensive number: finite + in-range, else undefined. */
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Repair one persisted schedule. Never throws, never mutates the input.
 * Returns null only when there is no schedule to sanitize.
 */
export function sanitizeSuiteSchedule(raw: SuiteSchedule | undefined): SuiteScheduleSanitizeReport | null {
  if (!raw || typeof raw !== "object") return null;
  const notes: string[] = [];
  let quarantined = false;

  // ── enabled: strict boolean, anything else disarms (fail-closed) ─────────
  const enabledRaw = raw.enabled;
  const enabled = enabledRaw === true;
  if (enabledRaw !== true && enabledRaw !== false) {
    quarantined = true;
    notes.push(`enabled was ${JSON.stringify(enabledRaw) ?? "undefined"} — schedule disarmed (fail-closed)`);
  }

  // ── intervalMs: must be a real number ≥ the 30-min quota floor ───────────
  const interval = num(raw.intervalMs);
  let intervalMs: number;
  if (interval === undefined) {
    if (raw.intervalMs !== undefined) {
      quarantined = true;
      notes.push(`intervalMs ${JSON.stringify(raw.intervalMs)} is not a usable number — schedule disarmed`);
    }
    intervalMs = SUITE_SCHEDULE_MIN_MS;
  } else if (interval < SUITE_SCHEDULE_MIN_MS) {
    intervalMs = SUITE_SCHEDULE_MIN_MS;
    notes.push(`intervalMs ${Math.round(interval)}ms was below the ${Math.round(SUITE_SCHEDULE_MIN_MS / 60_000)}-min quota floor — clamped`);
  } else {
    intervalMs = interval;
  }

  // ── nextRunAt: non-finite (or NaN) reset to undefined = "awaiting slot",
  //    the next tick fires honestly instead of never ─────────────────────────
  let nextRunAt: number | undefined;
  if (raw.nextRunAt != null) {
    if (num(raw.nextRunAt) === undefined) {
      nextRunAt = undefined;
      notes.push(`nextRunAt ${JSON.stringify(raw.nextRunAt)} was not a number — reset (fires on the next tick)`);
    } else {
      nextRunAt = raw.nextRunAt;
    }
  }

  // ── lastRunAt: same defensive shape (never load-bearing, keep if sane) ────
  let lastRunAt: number | undefined;
  if (raw.lastRunAt != null) lastRunAt = num(raw.lastRunAt);

  // ── repeats: clamp to 1..SUITE_REPEATS_MAX ────────────────────────────────
  const repeatsRaw = num(raw.repeats) ?? 1;
  const repeats = Math.min(Math.max(1, Math.round(repeatsRaw)), SUITE_REPEATS_MAX);
  if (repeats !== raw.repeats) {
    notes.push(`repeats ${JSON.stringify(raw.repeats)} clamped to ${repeats}`);
  }

  // ── failStreak: sane non-negative counter, else 0 ─────────────────────────
  const failStreakRaw = num(raw.failStreak);
  let failStreak: number | undefined;
  if (raw.failStreak != null) {
    if (failStreakRaw === undefined || failStreakRaw < 0) {
      failStreak = 0;
      notes.push(`failStreak ${JSON.stringify(raw.failStreak)} repaired to 0`);
    } else {
      failStreak = Math.round(failStreakRaw);
    }
  }

  // ── lastWinners: string→string record, else dropped (sticky-guard memory) ─
  let lastWinners: Record<string, string> | undefined;
  if (raw.lastWinners != null) {
    if (raw.lastWinners && typeof raw.lastWinners === "object" && !Array.isArray(raw.lastWinners)) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw.lastWinners)) {
        if (typeof k === "string" && k && typeof v === "string" && v) clean[k] = v;
      }
      lastWinners = Object.keys(clean).length > 0 ? clean : undefined;
      if (lastWinners === undefined) notes.push("lastWinners was empty/garbage — dropped");
    } else {
      lastWinners = undefined;
      notes.push("lastWinners was not a record — dropped (sticky guard relearns)");
    }
  }

  // ── autoAdopt: strict boolean opt-in ──────────────────────────────────────
  let autoAdopt: boolean | undefined;
  if (raw.autoAdopt != null) {
    if (typeof raw.autoAdopt === "boolean") autoAdopt = raw.autoAdopt;
    else notes.push(`autoAdopt ${JSON.stringify(raw.autoAdopt)} was not a boolean — dropped`);
  }

  const schedule: SuiteSchedule = {
    // Garbage beyond repair always disarms (fail-closed) — a quarantined
    // schedule must never keep firing on repaired numbers alone.
    enabled: quarantined ? false : enabled,
    intervalMs,
    repeats,
    ...(autoAdopt !== undefined ? { autoAdopt } : {}),
    ...(failStreak !== undefined ? { failStreak } : {}),
    ...(lastWinners ? { lastWinners } : {}),
    ...(lastRunAt !== undefined ? { lastRunAt } : {}),
    ...(nextRunAt !== undefined ? { nextRunAt } : {}),
  };
  const changed =
    notes.length > 0 ||
    schedule.enabled !== raw.enabled ||
    schedule.intervalMs !== raw.intervalMs ||
    schedule.repeats !== raw.repeats ||
    schedule.nextRunAt !== raw.nextRunAt ||
    schedule.lastRunAt !== raw.lastRunAt ||
    (schedule.autoAdopt ?? false) !== (raw.autoAdopt ?? false) ||
    (schedule.failStreak ?? 0) !== (raw.failStreak ?? 0) ||
    JSON.stringify(schedule.lastWinners ?? null) !== JSON.stringify(raw.lastWinners ?? null);

  return { schedule, changed, quarantined, notes };
}
