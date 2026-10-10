// ─── Schedule deferral audit (r77) ───────────────────────────────────────────
// The scheduler deliberately SKIPS a due fire while the same workflow has an
// active run (no double-fire; the first tick after the run ends fires — r76
// made that state visible LIVE via the amber "blocked by run" chip). This is
// the historical half: an append-only, capped localStorage trail of deferral
// EPISODES so the question "why didn't it fire at 16:10?" stays answerable
// AFTER the fact, not just while it is happening.
//
// Lives in its own module (NOT workflow-scheduler.tsx) for react-refresh
// safety: a component file that also exports a non-component function loses
// state preservation on edit (full reload) — which would destroy an
// in-flight client-side run. A new lib file invalidates nothing.

export type ScheduleSkipReason = "active-run" | "gateway-saturated" | "depth-degraded";

export interface ScheduleSkipEntry {
  id: string;
  name: string;
  /** Episode start: first tick that found this schedule due + blocked. */
  at: number;
  /** Set when the schedule finally fired (first tick after the run ended). */
  firedAt?: number;
  /** r181: WHY the fire was skipped — the audit line renders it. Old entries
   * predate the field and always meant "active-run". */
  reason?: ScheduleSkipReason;
}

const KEY = "praison-schedule-skips";
const CAP = 20;
/** A tab closed mid-episode leaves the entry open — 24h then treat as stale. */
const OPEN_STALE_MS = 24 * 60 * 60_000;

function load(): ScheduleSkipEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as ScheduleSkipEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list: ScheduleSkipEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-CAP)));
  } catch {
    /* quota — the audit trail is best-effort */
  }
}

/**
 * Record the start of a deferral episode. Idempotent per episode: while one
 * is open, further blocked ticks are no-ops — the 10s tick must not spam the
 * trail. An episode still open after 24h is considered abandoned (tab closed
 * mid-run) and a fresh one may start.
 */
export function noteScheduleDeferred(
  id: string,
  name: string,
  reason: ScheduleSkipReason = "active-run"
): void {
  const list = load();
  const last = [...list].reverse().find((e) => e.id === id);
  if (last && !last.firedAt && Date.now() - last.at < OPEN_STALE_MS) return;
  list.push({ id, name, at: Date.now(), reason });
  save(list);
}

/** Close the open episode for `id` — the schedule finally fired. */
export function closeScheduleDeferral(id: string, firedAt: number): void {
  const list = load();
  const last = [...list].reverse().find((e) => e.id === id);
  if (!last || last.firedAt) return;
  last.firedAt = firedAt;
  save(list);
}

/** Read the trail; open entries older than 24h are dropped as stale. */
export function readScheduleSkips(): ScheduleSkipEntry[] {
  const now = Date.now();
  return load().filter((e) => e.firedAt || now - e.at < OPEN_STALE_MS);
}
