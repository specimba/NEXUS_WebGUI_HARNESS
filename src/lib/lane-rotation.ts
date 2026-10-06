// ─── r305: Lane saturation memory + congestion rotation ─────────────────────
// User directive (2026-10-07): "focus on why we are stopping at some steps and
// why we are getting a 429 error… harness properly the request slowness based
// on provider exhaustion 429 limitations… why is there no model or provider
// rotation while we have dozens of them?"
//
// What the engine already had (v23/r126/r171): a per-RUN sick memory for
// MID-STREAM primary deaths only, a global 90s quiet window (gateway-cadence),
// and an escalating park ladder. What it lacked — and what this module adds —
// is per-FAMILY memory for PRE-STREAM 429s:
//  1. A 429 is provable provider exhaustion, but only mid-stream deaths marked
//     anything sick — every later step re-learned the same saturated lane from
//     scratch (3 dials per step against the same family, then a park).
//  2. Rotation to a healthy family happened only on the FINAL attempt or after
//     a minutes-long park — never on the FIRST retry after a 429.
//  3. Retry cooldowns were a fixed 20s/45s ladder no matter how many 429s the
//     same lane had already served — the opposite of "slow down when the
//     provider is exhausted".
//
// Semantics (all pure — the Map is injected, so scripts/qa-lane-rotation.ts
// can test every rule without a browser):
//  - window: 5 minutes, sliding — refreshed on every repeat 429 (matches the
//    providers' own 5m telemetry windows and PRIMARY_SICK_MS doctrine);
//  - strikes: consecutive 429s observed while the family's window is live;
//    they reset once the window expires — a lane that recovered is forgiven;
//  - cooldown: 20s → 45s → 90s base by strikes, floored by the shared
//    gateway-quiet window; the caller applies ±20% jitter.
// The "auto" (built-in engine) family is deliberately NOT tracked here — the
// global gateway-cadence quiet window already owns that lane's politeness.

export interface LaneSaturation {
  /** Epoch ms until which the family is considered saturated. */
  until: number;
  /** Consecutive 429s observed while the window stayed live. */
  strikes: number;
}

/** Sliding saturation window for one lane family (see header for the sizing). */
export const LANE_SICK_MS = 5 * 60_000;

/**
 * Provider family of a lane id: "vyce::deepseek-v4.1" → "vyce", a bare
 * provider id passes through, missing/empty → "" (nothing to track).
 */
export function laneFamilyKey(providerIdOrHopKey: string | undefined): string {
  const s = (providerIdOrHopKey ?? "").trim();
  if (s === "") return "";
  const sep = s.indexOf("::");
  return sep === -1 ? s : s.slice(0, sep);
}

/** Record a 429 on a lane family: opens/refreshes its window, bumps strikes. */
export function noteLane429(
  store: Map<string, LaneSaturation>,
  family: string,
  now: number
): LaneSaturation {
  const prev = store.get(family);
  const wasLive = prev != null && prev.until > now;
  const entry: LaneSaturation = {
    until: now + LANE_SICK_MS,
    strikes: (wasLive ? prev.strikes : 0) + 1,
  };
  store.set(family, entry);
  return entry;
}

/** Epoch ms until which `family` is saturated (0 = healthy). */
export function laneSickUntil(
  store: Map<string, LaneSaturation>,
  family: string,
  now: number
): number {
  const e = store.get(family);
  if (!e) return 0;
  return e.until > now ? e.until : 0;
}

/** Consecutive 429 strikes for `family` while its window is live (0 = forgiven). */
export function laneStrikes(
  store: Map<string, LaneSaturation>,
  family: string,
  now: number
): number {
  const e = store.get(family);
  if (!e || e.until <= now) return 0;
  return e.strikes;
}

/**
 * Reorder a relay wire so saturated families ride at the BACK — demoted,
 * never dropped (their window may outlive this wire build, and a demoted lane
 * is still reachable if everything healthy fails). Healthy hops keep their
 * relative order; keyless hops are left in place (nothing to key them by).
 */
export function rotateHops<T extends { key?: string; label?: string }>(
  hops: T[],
  store: Map<string, LaneSaturation>,
  now: number
): { hops: T[]; demoted: string[] } {
  const healthy: T[] = [];
  const sick: T[] = [];
  const demoted: string[] = [];
  for (const hop of hops) {
    const fam = laneFamilyKey(hop.key);
    if (fam !== "" && laneSickUntil(store, fam, now) > 0) {
      sick.push(hop);
      demoted.push(hop.label ?? hop.key ?? fam);
    } else {
      healthy.push(hop);
    }
  }
  return { hops: [...healthy, ...sick], demoted };
}

/**
 * Adaptive cooldown base for a rate-limited retry: escalates with the
 * family's consecutive 429 strikes (20s → 45s → 90s) — request slowness
 * harnessed to provider exhaustion — floored by the shared gateway-quiet
 * window. The caller applies ±20% jitter (gateway-cadence.jitteredBackoff).
 */
export function congestionCooldownMs(
  strikes: number,
  quietUntil: number,
  now: number
): number {
  let base = 20_000;
  if (strikes === 2) base = 45_000;
  else if (strikes >= 3) base = 90_000;
  return Math.max(base, quietUntil - now);
}
