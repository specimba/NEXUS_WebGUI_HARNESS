// ─── Provider circuit breaker (r504) — "be prepared and auto-rotate smartly" ─
// Owner evidence (Vyce status page, degraded): a whole MODEL FAMILY can die
// together (deepseek-v4-flash / v4.1 / v4-pro all "temporarily unavailable",
// 0% success, 65s latencies) while the per-lane health memory only learns one
// corpse at a time — every unsampled lane of that provider still sits at its
// full chain position and burns a 60s+ ladder rung per dial. This module adds
// the missing PROVIDER-level memory: N consecutive hard lane-fails trip a
// breaker that docks the whole provider's lanes to the back of the chain
// (lanes that answered recently keep their seat — partial outages must not
// sink the family's healthy members, e.g. deepseek-v4-flash-lr stayed online
// at 380ms while its siblings died), escalating on repeat trips and fully
// resetting on any success.
//
// Deliberately a separate localStorage record (`nexus-relay-provider-breaker`)
// and a directive-free module: relay.ts imports it, it never imports relay.ts
// (no client/server graph tangles — same doctrine as relay-core.ts).

export const PROVIDER_BREAKER_KEY = "nexus-relay-provider-breaker";

/** Hard lane-fails (soft 429/capacity noise NEVER counts) needed to trip. */
export const BREAKER_STREAK_THRESHOLD = 3;
/** First trip quarantines the provider for 10 minutes… */
const BASE_QUARANTINE_MS = 10 * 60_000;
/** …and repeat trips double, capped at an hour (10 → 20 → 40 → 60m). */
const MAX_QUARANTINE_MS = 60 * 60_000;
/** A lane that ANSWERED inside this window keeps its chain seat even while
 * its provider is quarantined (the deepseek-v4-flash-lr doctrine — see
 * header): quarantine is a prior, not a sentence, for proven-healthy lanes. */
export const FRESH_OK_WINDOW_MS = 15 * 60_000;

export interface ProviderBreakerEntry {
  ok: number;
  /** HARD fails counted (soft never reaches here). */
  fail: number;
  /** Consecutive hard fails — any ok resets to 0. */
  streak: number;
  /** Completed quarantine trips — drives the escalation ladder. */
  trips: number;
  quarantinedAt?: number;
  lastError?: string;
  lastFailAt?: number;
  lastOkAt?: number;
}

export type ProviderBreakerMap = Record<string, ProviderBreakerEntry>;

function quarantineMs(trips: number): number {
  return Math.min(MAX_QUARANTINE_MS, BASE_QUARANTINE_MS * 2 ** Math.max(0, trips - 1));
}

function loadBreakers(): ProviderBreakerMap {
  try {
    const raw = localStorage.getItem(PROVIDER_BREAKER_KEY);
    return raw ? (JSON.parse(raw) as ProviderBreakerMap) : {};
  } catch {
    return {};
  }
}

function saveBreakers(m: ProviderBreakerMap): void {
  try {
    localStorage.setItem(PROVIDER_BREAKER_KEY, JSON.stringify(m));
  } catch {
    /* quota — breaker memory is best-effort, like the lane health beside it */
  }
}

/**
 * Record one dial outcome at the PROVIDER level. Called from
 * recordRelayHopResult (relay.ts) so there is ONE call site and no parallel
 * truth: `hard` = the lane failure was hard/dead (soft capacity noise is
 * excluded upstream). A success heals everything — streak, trips and any
 * open quarantine (the breaker's own recovery probe is just the next dial).
 */
export function recordProviderOutcome(providerId: string, ok: boolean, hard: boolean, error?: string): void {
  if (!providerId) return;
  const m = loadBreakers();
  const e = m[providerId] ?? { ok: 0, fail: 0, streak: 0, trips: 0 };
  if (ok) {
    e.ok += 1;
    e.lastOkAt = Date.now();
    // Full recovery: one answer proves the provider lives again.
    e.streak = 0;
    e.trips = 0;
    e.quarantinedAt = undefined;
    e.lastError = undefined;
  } else if (hard) {
    e.fail += 1;
    e.streak += 1;
    e.lastFailAt = Date.now();
    if (error) e.lastError = error.slice(0, 160);
    if (e.streak >= BREAKER_STREAK_THRESHOLD && !isQuarantinedEntry(e)) {
      e.trips += 1;
      e.quarantinedAt = Date.now();
    }
  }
  m[providerId] = e;
  saveBreakers(m);
}

function isQuarantinedEntry(e: ProviderBreakerEntry): boolean {
  if (!e.quarantinedAt) return false;
  return Date.now() - e.quarantinedAt < quarantineMs(e.trips);
}

/** Snapshot for the settings board (call ONCE per render, like the lane health). */
export function providerBreakerSnapshot(): ProviderBreakerMap {
  return loadBreakers();
}

/** True when the provider's breaker is currently open (quarantine active). */
export function isProviderQuarantined(
  providerId: string,
  snapshot?: ProviderBreakerMap
): boolean {
  const e = (snapshot ?? loadBreakers())[providerId];
  return !!e && isQuarantinedEntry(e);
}

/** Ms left on an open quarantine (0 = not quarantined / already lapsed). */
export function quarantineLeftMs(
  providerId: string,
  snapshot?: ProviderBreakerMap
): number {
  const e = (snapshot ?? loadBreakers())[providerId];
  if (!e || !e.quarantinedAt) return 0;
  const left = e.quarantinedAt + quarantineMs(e.trips) - Date.now();
  return left > 0 ? left : 0;
}

/** Human countdown for chips — "9m" / "42s". */
export function fmtQuarantineLeft(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

/** True when the provider's breaker HAS tripped at least once and the memory
 * still carries it (for board rows even after the timer lapses). */
export function breakerHistory(e: ProviderBreakerEntry | undefined): boolean {
  return !!e && (e.trips > 0 || e.streak >= BREAKER_STREAK_THRESHOLD);
}

/** r548: scoped heal for ONE provider — a freshly stored vault key must not
 * inherit the old key's streak/quarantine memory. Drops only that provider's
 * entry; every sibling keeps its own memory. (Scoped twin of
 * resetProviderBreakers, paired with clearProviderLaneHealth in relay.ts.) */
export function resetProviderBreaker(providerId: string): void {
  if (!providerId) return;
  try {
    const m = loadBreakers();
    if (m[providerId]) {
      delete m[providerId];
      saveBreakers(m);
    }
  } catch {
    /* ignore — memory is best-effort */
  }
}

/** Wipe the breaker memory (paired with the lane-health clear button). */
export function resetProviderBreakers(): void {
  try {
    localStorage.removeItem(PROVIDER_BREAKER_KEY);
  } catch {
    /* ignore */
  }
}
