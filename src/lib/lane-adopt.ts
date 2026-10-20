"use client";

// ─── r503: Radar → Relay adoption pipeline ───────────────────────────────────
// Owner directive: "free radar new findings should be added related locations
// and providers with correct tags in first seen automatically — we need that
// pipeline automation for platform reliability and smartness."
//
// Before this module the two universes never touched:
//   • the Model Tracker (radar) recorded brand-new free lanes with rich tags
//     (provider glyph, ctx, $-per-M, first-seen age) — display only;
//   • the Model Relay chain was built from the STATIC doctrine catalog + the
//     vault's live rosters — a tracker sighting joined the chain only when a
//     developer manually pasted it into ARENA_CATALOG (the r502 absorption).
// The result: the platform kept dialing the same saturated primary (live
// evidence: "all works directed to single api source … vyce deepseek, which
// is exhausting that connection eventually") while fresh free capacity sat in
// the radar unread.
//
// THE PIPELINE (all client-side, BYOK doctrine intact):
//   1. tracker sync / GET lands rows (first-seen tagged, server-diffed);
//   2. absorbTrackerLanes() registers NEW FREE lanes of KNOWN providers into
//      the adopted registry (localStorage `nexus-relay-adopted`) with their
//      full tag set — provider, ctx, pricing, free, first-seen, origin;
//   3. buildRelayChain() appends enabled adopted lanes as real hops, so the
//      very next dial (chat, workflow step, server-lane bridge payload) can
//      rotate onto fresh capacity;
//   4. the rotator's health memory self-corrects — a bad adoption fails a
//      dial, gets demoted, and sinks (never a silent permanent seat);
//   5. lanes the tracker later marks `removedAt` are disabled here too —
//      pinned work won't 404 on a corpse (the "12 models removed in 48h"
//      capability-radar warning class).
//
// Policy: FREE lanes only, KNOWN registry providers only (dialable base
// URLs), capped registry (oldest-first eviction keeps the newest frontier),
// and the whole pipeline is one settings switch (`radarAutoAdopt`, default
// ON — that is the point) with a manual override list in Settings → Model
// relay. HuggingFace signal rows are watch-list repos, NOT dialable lanes —
// they are never adopted.

import { providerById } from "./providers";
import type { TrackedModelRow } from "./tracker-types";

export const ADOPTED_LANES_KEY = "nexus-relay-adopted";

/** Hard cap — the chain reads this list on EVERY dial build; stale depth
 * costs sort time, and the tracker's 48h "new" window means the frontier
 * is always fresher than anything past the first few dozen. */
export const MAX_ADOPTED_LANES = 24;

/** A radar sighting promoted into the relay lane registry. */
export interface AdoptedLane {
  /** Relay hop key — "providerId::modelId" (same convention everywhere). */
  key: string;
  providerId: string;
  modelId: string;
  displayName?: string;
  contextWindow?: number | null;
  priceIn?: number | null;
  priceOut?: number | null;
  free: boolean;
  /** ISO — the tracker's firstSeenAt (the "correct tag in first seen"). */
  firstSeenAt: string;
  /** ISO — when the pipeline registered it. */
  adoptedAt: string;
  /** Where the adoption came from. */
  origin: "radar-auto" | "manual";
  /** Disabled lanes stay listed (audit) but never join the chain. */
  enabled: boolean;
  /** Why it was disabled — "removed from catalog", "user muted", … */
  disabledReason?: string;
}

function readRegistry(): AdoptedLane[] {
  try {
    const raw = localStorage.getItem(ADOPTED_LANES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (l): l is AdoptedLane =>
        !!l && typeof l === "object" &&
        typeof (l as AdoptedLane).key === "string" &&
        typeof (l as AdoptedLane).providerId === "string"
    );
  } catch {
    return [];
  }
}

function writeRegistry(lanes: AdoptedLane[]): void {
  try {
    localStorage.setItem(ADOPTED_LANES_KEY, JSON.stringify(lanes));
  } catch {
    /* quota — the registry is best-effort; the doctrine chain still stands */
  }
}

/** Snapshot for UIs (Settings → Model relay, radar tab "in relay" chips). */
export function adoptedLanesSnapshot(): AdoptedLane[] {
  return readRegistry();
}

/** True when the lane key is already registered (any enabled state). */
export function isLaneAdopted(key: string): boolean {
  return readRegistry().some((l) => l.key === key);
}

/** Manual adoption (radar row action / settings) — idempotent, un-disables. */
export function adoptLane(
  row: Pick<TrackedModelRow, "id" | "providerId" | "modelId" | "displayName" | "contextWindow" | "priceIn" | "priceOut" | "free" | "firstSeenAt">,
  origin: AdoptedLane["origin"] = "manual"
): { added: boolean; lanes: AdoptedLane[] } {
  const lanes = readRegistry();
  const existing = lanes.find((l) => l.key === row.id);
  if (existing) {
    if (!existing.enabled) {
      existing.enabled = true;
      existing.disabledReason = undefined;
      writeRegistry(lanes);
      return { added: true, lanes };
    }
    return { added: false, lanes };
  }
  // Dialability gate: unknown providers would build hops resolveExplicitLlm
  // cannot serve — they stay display-only in the tracker instead.
  if (!providerById(row.providerId)) return { added: false, lanes };
  lanes.unshift({
    key: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    ...(row.displayName ? { displayName: row.displayName } : {}),
    contextWindow: row.contextWindow ?? null,
    priceIn: row.priceIn ?? null,
    priceOut: row.priceOut ?? null,
    free: row.free,
    firstSeenAt: row.firstSeenAt,
    adoptedAt: new Date().toISOString(),
    origin,
    enabled: true,
  });
  // Evict oldest DISABLED first, then oldest adopted, past the cap.
  while (lanes.length > MAX_ADOPTED_LANES) {
    const disabledIdx = findLastIndex(lanes, (l) => !l.enabled);
    if (disabledIdx >= 0) lanes.splice(disabledIdx, 1);
    else lanes.pop();
  }
  writeRegistry(lanes);
  return { added: true, lanes };
}

export function removeAdoptedLane(key: string): AdoptedLane[] {
  const lanes = readRegistry().filter((l) => l.key !== key);
  writeRegistry(lanes);
  return lanes;
}

export function setAdoptedLaneEnabled(key: string, enabled: boolean, reason?: string): AdoptedLane[] {
  const lanes = readRegistry();
  const l = lanes.find((x) => x.key === key);
  if (l) {
    l.enabled = enabled;
    if (enabled) l.disabledReason = undefined;
    else l.disabledReason = reason ?? "user muted";
    writeRegistry(lanes);
  }
  return lanes;
}

export function clearAdoptedLanes(): AdoptedLane[] {
  writeRegistry([]);
  return [];
}

function findLastIndex<T>(arr: T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

// ─── The automatic pipeline step ─────────────────────────────────────────────

export interface AbsorbReport {
  adopted: AdoptedLane[];
  /** Keys newly registered this pass. */
  addedKeys: string[];
  /** Keys disabled because the tracker marked the lane removed. */
  disabledKeys: string[];
}

/**
 * Feed the registry from a tracker snapshot. Called after every tracker
 * sync/load in the radar surfaces — the "first seen" moment. Free-only by
 * default (paid lanes join via manual Adopt), known providers only, and the
 * caller's `autoAdopt` flag (Settings → radarAutoAdopt, default true) gates
 * the automatic path; with it off the pass only MAINTAINS the registry
 * (disables lanes the catalog dropped) and never adds.
 */
export function absorbTrackerLanes(
  tracked: TrackedModelRow[],
  opts: { autoAdopt: boolean }
): AbsorbReport {
  const report: AbsorbReport = { adopted: readRegistry(), addedKeys: [], disabledKeys: [] };
  const lanes = report.adopted;
  const byKey = new Map(lanes.map((l) => [l.key, l]));
  const seen = new Set<string>();

  for (const row of tracked) {
    if (!row || typeof row.id !== "string") continue;
    seen.add(row.id);
    // Correct-tag gate 1: known dialable provider (HF signal rows fail here
    // by design — they are repos, not OpenAI-compatible lanes).
    if (!providerById(row.providerId)) continue;
    // Correct-tag gate 2: free capacity only — the directive names free
    // findings; paid lanes are a deliberate manual Adopt.
    if (!row.free) continue;
    // Correct-tag gate 3: the 48h "new" window or an explicit manual adopt.
    // Stale free lanes beyond the window don't auto-join (the doctrine chain
    // already covers them via ARENA_CATALOG/live rosters); first-seen freshness
    // is the whole firsthand advantage.
    const fresh = Date.now() - new Date(row.firstSeenAt).getTime() < 72 * 3600_000;
    const existing = byKey.get(row.id);
    if (!existing) {
      if (!opts.autoAdopt || !fresh) continue;
      const res = adoptLane(row, "radar-auto");
      if (res.added) {
        report.addedKeys.push(row.id);
        byKey.set(row.id, res.lanes.find((l) => l.key === row.id)!);
      }
    } else if (existing.enabled && row.removedAt) {
      // Catalog dropped the lane — disable, don't delete (the audit trail is
      // the "12 removed in 48h" visibility, now wired instead of warned).
      setAdoptedLaneEnabled(row.id, false, "removed from provider catalog");
      existing.enabled = false;
      existing.disabledReason = "removed from provider catalog";
      report.disabledKeys.push(row.id);
    }
  }
  report.adopted = readRegistry();
  return report;
}

/** Enabled adopted lanes that can actually dial (used by buildRelayChain). */
export function enabledAdoptedLanes(): AdoptedLane[] {
  return readRegistry().filter((l) => l.enabled && providerById(l.providerId));
}
