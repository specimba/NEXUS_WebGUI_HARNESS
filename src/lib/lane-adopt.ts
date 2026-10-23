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
//   5. lanes the tracker later marks `removedAt` are RETIRED here too —
//      pinned work won't 404 on a corpse (the "12 models removed in 48h"
//      capability-radar warning class, r512 auto-retire below).
//
// Policy: FREE lanes only, KNOWN registry providers only (dialable base
// URLs), capped registry (oldest-first eviction keeps the newest frontier),
// and the whole pipeline is one settings switch (`radarAutoAdopt`, default
// ON — that is the point) with a manual override list in Settings → Model
// relay. HuggingFace signal rows are watch-list repos, NOT dialable lanes —
// they are never adopted.

import { providerById } from "./providers";
import { TRACKER_CACHE_KEY, parseTrackerMirror, type TrackedModelRow } from "./tracker-types";

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
  // ── r512 retirement fields (ALL optional so old persisted registries
  // survive the shape bump — readRegistry only requires key/providerId). ──
  /** Proven removed from its provider catalog: excluded from every dial
   * path (relay chain, lane pins, experiment prefill) but still LISTED so
   * the audit trail stays visible in Settings → Model relay. */
  retired?: boolean;
  /** Full human reason — "removed from {provider} catalog · {date}". */
  retiredReason?: string;
  /** ISO — when the retirement was stamped. */
  retiredAt?: string;
  /** r512 dial-time backstop: 404/503 missing-model strikes (retire at 2). */
  removalStrikes?: number;
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

/** Snapshot for UIs (Settings → Model relay, radar tab "in relay" chips).
 * r512: runs the lazy retirement pass first so audit surfaces show the amber
 * retired chip as soon as the tracker knows, without waiting for a dial. */
export function adoptedLanesSnapshot(): AdoptedLane[] {
  runLazyRetirementPass();
  return readRegistry();
}

/** True when the lane key is already registered (any enabled state). */
export function isLaneAdopted(key: string): boolean {
  return readRegistry().some((l) => l.key === key);
}

// ─── r512: pinned-lane auto-retire ─────────────────────────────────────
// The capability-radar warning class ("48h: N catalog models removed —
// pinned lanes will 404/503") as MECHANISM, not warning: a lane proven
// removed from its provider catalog is retired IN THIS SAME registry key
// (no key sprawl) and excluded from every dial path. Retirement fires
// LAZILY — every read path runs a throttled pass against the tracker's
// removal mirror (nexus-tracker-cache) — plus a DIAL-TIME backstop
// (noteRemovalStrike, 2 strikes) for removals the tracker mirror missed.
// Retired lanes stay listed (the audit trail) and honor a manual restore
// only when the catalog shows the lane again.

export interface LaneRetirement {
  key: string;
  reason: string;
  /** ISO — when the retirement was stamped. */
  at: string;
}

/** Dial strikes before a tracker-missed removal retires (spec cap). */
const REMOVAL_STRIKES_TO_RETIRE = 2;

function providerLabel(providerId: string): string {
  return providerById(providerId)?.name ?? providerId;
}

function removalReason(providerId: string, removedAt?: string | null): string {
  const d = removedAt ? new Date(removedAt) : new Date();
  const day = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `removed from ${providerLabel(providerId)} catalog · ${day}`;
}

/** key → removedAt for every row the tracker mirror marks removed. */
function trackerRemovedRows(): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const raw = localStorage.getItem(TRACKER_CACHE_KEY);
    if (!raw) return out;
    const boot = parseTrackerMirror(raw);
    if (boot.kind !== "data") return out;
    for (const row of boot.data.tracked) {
      if (row?.id && row.removedAt) out.set(row.id, row.removedAt);
    }
  } catch {
    /* private mode / quota — the pass is best-effort by design */
  }
  return out;
}

function stampRetirement(l: AdoptedLane, reason: string): void {
  l.retired = true;
  l.retiredReason = reason;
  l.retiredAt = new Date().toISOString();
  l.enabled = false;
  l.disabledReason = reason;
}

/** Retire a lane (tracker removal / dial strikes / future callers). Idempotent
 * — an already-retired lane keeps its original reason. The record STAYS in
 * the registry: the settings card renders it with the amber retired chip. */
export function retireLane(key: string, reason: string): AdoptedLane[] {
  const lanes = readRegistry();
  const l = lanes.find((x) => x.key === key);
  if (l && !l.retired) {
    stampRetirement(l, reason);
    writeRegistry(lanes);
  }
  return lanes;
}

/** Un-retire (Settings restore affordance — the UI verifies catalog presence
 * before calling this). Clears every retirement field and re-enables. */
export function restoreLane(key: string): AdoptedLane[] {
  const lanes = readRegistry();
  const l = lanes.find((x) => x.key === key);
  if (l) {
    l.retired = undefined;
    l.retiredReason = undefined;
    l.retiredAt = undefined;
    l.removalStrikes = undefined;
    l.enabled = true;
    l.disabledReason = undefined;
    writeRegistry(lanes);
  }
  return lanes;
}

/** Every retired lane with its reason — audit feeds / future UIs. */
export function retiredLanesWithReason(): LaneRetirement[] {
  return readRegistry()
    .filter((l) => l.retired)
    .map((l) => ({
      key: l.key,
      reason: l.retiredReason ?? "removed from provider catalog",
      at: l.retiredAt ?? l.adoptedAt,
    }));
}

export function isLaneRetired(key: string): boolean {
  return readRegistry().some((l) => l.key === key && l.retired);
}

/** The full retirement reason for a lane — registry retirement first, then
 * the raw tracker removal (pins may reference lanes that were never
 * adopted). Null = the lane is neither retired nor tracker-removed, i.e.
 * dialable as far as this module knows. */
export function laneRetirementReason(key: string): string | null {
  if (!key || key === "auto::builtin") return null;
  const l = readRegistry().find((x) => x.key === key);
  if (l?.retired) return l.retiredReason ?? "removed from provider catalog";
  const removedAt = trackerRemovedRows().get(key);
  if (removedAt) {
    return removalReason(key.slice(0, key.indexOf("::")), removedAt);
  }
  return null;
}

/** r512 dial-time backstop: one 404/503 missing-model dial against a registry
 * lane. Two strikes retire it ("cap: 2 strikes per lane before retire") even
 * when the tracker mirror never saw the removal. Safe on unknown keys —
 * non-adopted lanes keep the relay health memory as their corpse handler. */
export function noteRemovalStrike(key: string, error?: string): { strikes: number; retired: boolean } {
  const lanes = readRegistry();
  const l = lanes.find((x) => x.key === key);
  if (!l) return { strikes: 0, retired: false };
  if (l.retired) return { strikes: l.removalStrikes ?? 0, retired: true };
  l.removalStrikes = (l.removalStrikes ?? 0) + 1;
  if (l.removalStrikes >= REMOVAL_STRIKES_TO_RETIRE) {
    const detail = error ? ` (${error.slice(0, 80)})` : "";
    stampRetirement(l, `${removalReason(l.providerId)} · ${l.removalStrikes} dial strikes${detail}`);
    writeRegistry(lanes);
    return { strikes: l.removalStrikes, retired: true };
  }
  writeRegistry(lanes);
  return { strikes: l.removalStrikes, retired: false };
}

// The pass is throttled: buildRelayChain() runs on EVERY dial (per streamStep
// attempt), and the mirror parse — while small — must not ride each one.
let lastLazyPassAt = 0;
const LAZY_PASS_INTERVAL_MS = 10_000;

/** Lazy auto-retire: cross-check the registry against the tracker's removal
 * mirror and retire matching lanes with the full reason. Called from every
 * adopted-lane READ path (rotation build / prefill / settings snapshot), so
 * no sync-time coupling is needed. Returns how many lanes retired now. */
export function runLazyRetirementPass(): number {
  const now = Date.now();
  if (now - lastLazyPassAt < LAZY_PASS_INTERVAL_MS) return 0;
  lastLazyPassAt = now;
  let retired = 0;
  try {
    const removals = trackerRemovedRows();
    if (removals.size === 0) return 0;
    const lanes = readRegistry();
    let dirty = false;
    for (const l of lanes) {
      if (l.retired || !removals.has(l.key)) continue;
      stampRetirement(l, removalReason(l.providerId, removals.get(l.key)));
      l.removalStrikes = 0;
      dirty = true;
      retired += 1;
    }
    if (dirty) writeRegistry(lanes);
  } catch {
    /* best-effort — the doctrine chain still stands */
  }
  return retired;
}

/** True when the tracker catalog currently shows the lane alive (present and
 * NOT removedAt) — the restore affordance's presence check. Reads the
 * localStorage mirror; the Settings restore button re-verifies against a
 * live /api/tracker fetch before actually un-retiring. */
export function catalogHasLane(key: string): boolean {
  try {
    const raw = localStorage.getItem(TRACKER_CACHE_KEY);
    if (!raw) return false;
    const boot = parseTrackerMirror(raw);
    if (boot.kind !== "data") return false;
    return boot.data.tracked.some((r) => r?.id === key && !r.removedAt);
  } catch {
    return false;
  }
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
      // r512: a manual Adopt is an explicit user override on a row the user
      // is LOOKING at (radar rows render on live tracker data) — clear the
      // retirement fields too, not just the mute.
      existing.enabled = true;
      existing.disabledReason = undefined;
      existing.retired = undefined;
      existing.retiredReason = undefined;
      existing.retiredAt = undefined;
      existing.removalStrikes = undefined;
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
    // r512: a REMOVED sighting is not fresh capacity — never adopt a corpse
    // (the removedAt branch below only maintains EXISTING registry rows).
    if (row.removedAt && !byKey.has(row.id)) continue;
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
      // r512: the catalog dropped the lane — RETIRE it (was: plain disable).
      // Same audit trail (the record stays listed) but the full reason now
      // carries provider + date, and the retired flag excludes the lane from
      // EVERY dial path (relay chain, per-step pins, experiment prefill).
      const reason = removalReason(row.providerId, row.removedAt);
      retireLane(row.id, reason);
      // Keep the loop's local snapshot consistent with retireLane's write.
      existing.retired = true;
      existing.retiredReason = reason;
      existing.retiredAt = new Date().toISOString();
      existing.enabled = false;
      existing.disabledReason = reason;
      report.disabledKeys.push(row.id);
    }
  }
  report.adopted = readRegistry();
  return report;
}

/** Enabled adopted lanes that can actually dial (used by buildRelayChain).
 * r512: runs the lazy retirement pass first and EXCLUDES retired lanes —
 * this one filter is what the relay rotation, the lane-experiment prefill
 * and every "freshest lanes" list all inherit (one truth, no parallel skip
 * logic). Retired records stay visible via adoptedLanesSnapshot(). */
export function enabledAdoptedLanes(): AdoptedLane[] {
  runLazyRetirementPass();
  return readRegistry().filter((l) => l.enabled && !l.retired && providerById(l.providerId));
}
