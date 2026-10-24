// ─── r517: Free Reach Index — the freellm.sh census (reach × intelligence) ───
// Owner directive (r517): the generalized freellm.sh crawl is okay, but the
// FILTERED view is also very useful —
//   https://freellm.sh/?access=free-tier&access=free-forever&access=signup-credits
//     &status=operational&sort=newest#models
// The r516 benchmark intelligence index answers "which model is SMARTEST?"
// (arena.ai + artificialanalysis.ai). This module answers the other half of
// the owner's "reach and intelligence index" directive: "where can we dial
// for FREE, operational, right now — and what landed fresh?"
//
// freellm.sh is a Next.js RSC app — the models table rides the served HTML
// as flight-payload chunks (self.__next_f.push([1,"…"])). The site's own
// filtered view is client-side (the HTML is byte-identical with or without
// the query params), so the server producer parses the SAME payload and
// derives the filter honestly instead of pretending a second crawl happened.
//
// This is the shared (client + server) half:
//   • FreellmEntry / FreellmIndex types (what the producer emits)
//   • matchFreellmEntry(): relay-lane model id → a free+operational source
//   • localStorage cache (nexus-freellm-index) with a 6h staleness TTL
// The SERVER half lives in lib/server/freellm-index.ts; the UI producer API
// is GET /api/freellm[?fresh=1].

export const FREELLM_CACHE_KEY = "nexus-freellm-index";
export const FREELLM_TTL_MS = 6 * 3_600_000;

/** The Owner's filtered view — the canonical reference link for the panel. */
export const FREELLM_FILTERED_URL =
  "https://freellm.sh/?access=free-tier&access=free-forever&access=signup-credits&status=operational&sort=newest#models";

/** Access tiers that count as "free reach" (the filtered view's axis). */
export const FREE_ACCESS_TIERS = ["free-tier", "free-forever", "signup-credits"] as const;
export type FreeAccessTier = (typeof FREE_ACCESS_TIERS)[number];

/** How recent an entry must be to wear the NEW badge (matches the site's
 * "sort=newest" spirit — the census cares about what just landed). */
export const FREELLM_NEW_DAYS = 14;

export interface FreellmEntry {
  id: string;
  name: string;
  provider: string;
  providerSlug?: string;
  /** Capability kinds: text | image | audio | code … */
  types: string[];
  /** Access labels: free-tier, free-forever, signup-credits, no-card,
   *  no-signup, open-source, data-training, card-required … */
  access: string[];
  /** operational | degraded | … */
  status: string;
  /** Human sentence about the free limits ("50 req/day …"). */
  freeLimit?: string;
  /** ISO date the source was added to the index (newest-first sort key). */
  addedAt?: string;
  gated: boolean;
  url?: string;
}

export interface FreellmIndex {
  asOf: number;
  /** "live" = flight payload parsed this fetch; "unavailable" = honest empty. */
  origin: "live" | "unavailable";
  /** Total entries in the freellm.sh table (pre-filter census). */
  total: number;
  /** The filtered view: free access ∩ operational, newest first. */
  entries: FreellmEntry[];
  counts: {
    operational: number;
    degraded: number;
    /** Filtered entries added within the last 14 days. */
    new14d: number;
    /** Access-tier histogram over the WHOLE census (honest context). */
    byTier: Record<string, number>;
    byProvider: Array<{ provider: string; count: number }>;
  };
  /** Honest one-liner when origin !== "live" (never invented data). */
  note?: string;
  /** ms the server spent producing this index. */
  ms: number;
}

// ─── Matching (relay lanes → reach rows) ─────────────────────────────────────

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Alias candidates for a relay model id ("zai/glm-4.7-flash" →
 *  "glm47flash"; ":free"/"-free"/"-latest" suffixes stripped so the free
 *  dial variants match their base row). */
export function reachAliasCandidates(model: string): string[] {
  const raw = (model ?? "").toLowerCase().trim();
  if (!raw) return [];
  const out = new Set<string>();
  const base = raw.includes("/") ? (raw.split("/").pop() ?? raw) : raw;
  out.add(base);
  out.add(base.replace(/:free$/, "").replace(/-free$/, "").replace(/-latest$/, ""));
  out.delete("");
  return [...out].map(norm).filter(Boolean);
}

/**
 * Match a relay-lane model id against the free+operational census. Returns
 * the first entry whose name agrees (exact normalized equality, or a ≥6-char
 * containment so dated cuts like "…-1017" still find their base row).
 */
export function matchFreellmEntry(
  index: FreellmIndex | null,
  model: string
): FreellmEntry | null {
  if (!index || index.origin !== "live" || index.entries.length === 0) return null;
  const aliases = reachAliasCandidates(model);
  if (!aliases.length) return null;
  for (const e of index.entries) {
    const en = norm(e.name);
    if (!en) continue;
    for (const a of aliases) {
      if (a === en) return e;
      if (a.length >= 6 && en.length >= 6 && (a.includes(en) || en.includes(a))) {
        return e;
      }
    }
  }
  return null;
}

/** NEW badge rule: added to the census within FREELLM_NEW_DAYS days. */
export function isNewcomer(entry: FreellmEntry, withinDays = FREELLM_NEW_DAYS): boolean {
  if (!entry.addedAt) return false;
  const t = Date.parse(entry.addedAt);
  return Number.isFinite(t) && Date.now() - t < withinDays * 86_400_000;
}

// ─── Client cache (mirrors lib/intelligence.ts) ─────────────────────────────

export function readFreellmCache(): FreellmIndex | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FREELLM_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FreellmIndex;
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeFreellmCache(index: FreellmIndex): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FREELLM_CACHE_KEY, JSON.stringify(index));
  } catch {
    /* quota — the in-memory copy still serves this session */
  }
}

export function freellmStale(index: FreellmIndex | null): boolean {
  if (!index) return true;
  return Date.now() - index.asOf > FREELLM_TTL_MS;
}
