// ─── r305: 429-aware provider rotation (user report) ─────────────────────────
// "Why is there no model or provider rotation while we have dozens of them?"
// Forensics agreed: the step ladder's only escape hatches were (a) LANE
// rotation (browser-direct ↔ server relay — but a keyless vault makes the
// relay land on the SAME shared gateway) and (b) final-attempt model
// substitution INSIDE the relay chain (empty when keyless). So all 3 attempts
// of a 429'd step re-dialed the same exhausted upstream and the run parked.
//
// This module gives the client engine a per-provider exhaustion memory:
//   • every 429 puts that provider on an EXPONENTIAL cooldown (60s → 2m → 4m
//     → … capped at 15m) — request slowness driven by demonstrated provider
//     exhaustion, not a fixed guess;
//   • a successful dial clears the lane; 30m of silence erases stale streaks;
//   • nextRotation() walks the READY registry (key saved or noKey needed),
//     skipping the failed lane and every cooling lane — preferring a
//     ready-now lane, else the soonest-available one whose remaining cooldown
//     becomes the retry's wait (harness pacing for a saturated roster).

import type { ResolvedLlm } from "./llm-config";
import { FREE_PROVIDERS, providerBaseUrl, providerById } from "./providers";
import type { Settings } from "./types";

export const ROTATION_COOLDOWN_BASE_MS = 60_000;
export const ROTATION_COOLDOWN_CAP_MS = 15 * 60_000;
/** A lane silent this long is treated as recovered — its streak resets. */
export const ROTATION_RECOVERY_MS = 30 * 60_000;

interface Lane429 {
  streak: number;
  last429At: number;
}

const lanes = new Map<string, Lane429>();

/** Record a 429 for a provider; returns the lane's new consecutive-429 streak. */
export function noteProvider429(providerId: string, now: number = Date.now()): number {
  const lane = lanes.get(providerId);
  const stale = !lane || now - lane.last429At > ROTATION_RECOVERY_MS;
  const next: Lane429 = {
    streak: stale ? 1 : lane.streak + 1,
    last429At: now,
  };
  lanes.set(providerId, next);
  return next.streak;
}

/** Consecutive-429 streak for a provider (0 = healthy / no memory). */
export function provider429Streak(providerId: string): number {
  return lanes.get(providerId)?.streak ?? 0;
}

/**
 * r307: registry cooldowns key on any PROVEN lane failure — a 429 or a
 * mid-stream drop. A lane that died mid-call is not a safe rotation target
 * until its cooldown clears, exactly like a quota-exhausted one.
 */
export const noteProviderFailure = noteProvider429;

/** A lane that just served a full successful call is healthy again. */
export function resetProvider429(providerId: string): void {
  lanes.delete(providerId);
}

/** Remaining ms the lane should not be dialed for (0 = free to dial). */
export function provider429CooldownLeftMs(
  providerId: string,
  now: number = Date.now()
): number {
  const lane = lanes.get(providerId);
  if (!lane) return 0;
  const window = Math.min(
    ROTATION_COOLDOWN_BASE_MS * 2 ** (lane.streak - 1),
    ROTATION_COOLDOWN_CAP_MS
  );
  return Math.max(0, lane.last429At + window - now);
}

export interface RotationPick {
  llm: ResolvedLlm;
  /** ms the picked lane is still cooling (0 = ready now). */
  waitMs: number;
}

/**
 * Pick a rotation lane ≠ failedProviderId: ready registry providers only
 * (key saved, or the provider needs none), skipping cooling lanes — a
 * ready-now lane in registry order wins; if the whole roster is cooling,
 * the soonest-available lane is picked so the retry can wait EXACTLY its
 * remaining window instead of a blind fixed sleep. Null when the profile
 * has no alternative provider at all.
 */
export function nextRotation(
  settings: Settings,
  failedProviderId: string,
  now: number = Date.now()
): RotationPick | null {
  const picks: RotationPick[] = [];
  for (const reg of FREE_PROVIDERS) {
    if (reg.id === failedProviderId) continue;
    const known = providerById(reg.id);
    if (!known) continue;
    const entry = settings.providerKeys?.[reg.id];
    const key = entry?.key?.trim() ?? "";
    if (!key && !reg.noKey) continue;
    picks.push({
      waitMs: provider429CooldownLeftMs(reg.id, now),
      llm: {
        provider: "custom",
        apiKey: key || undefined,
        baseUrl: providerBaseUrl(known, entry?.accountId),
        model: entry?.model || known.models[0]?.id,
        label: known.name,
        providerId: reg.id,
      },
    });
  }
  const ready = picks.find((p) => p.waitMs <= 0);
  if (ready) return ready;
  if (picks.length === 0) return null;
  let soonest = picks[0];
  for (const p of picks) {
    if (p.waitMs < soonest.waitMs) soonest = p;
  }
  return soonest;
}
