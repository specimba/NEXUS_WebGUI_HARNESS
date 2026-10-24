// ─── r516: Benchmark Intelligence Index — the "not on words only" doctrine ───
// Owner directive: "This needs to be really smart routing, not on words only…
// Make a proper list with active, dynamically changing data by reach and
// intelligence index, taken from arena.ai/leaderboard/code/webdev,
// arena.ai/leaderboard/agent, artificialanalysis.ai and its coding-agents
// board." Until now the relay chain ordered lanes by STATIC catalog Elo
// numbers — a diffusion speed lane (mercury-3) outranked proven free frontier
// models (qwen3.8-max-free) because a hand-typed constant said so.
//
// This module is the shared (client + server) half of the fix:
//   • IntelEntry / IntelligenceIndex types (what the server producer emits)
//   • alias matching: a vault model id ("qwen3.8-max-free",
//     "deepseek/deepseek-v4.1-flash-1017") → canonical leaderboard names
//   • blendedIntel(): live index 0.65 · catalog Elo prior 0.35 — benchmark
//     data leads, the hand-tuned prior only fills gaps
//   • localStorage cache (nexus-intelligence-index) with a 6h staleness TTL
//
// The SERVER half (fetch + parse + curated snapshot + PlatformSetting cache)
// lives in lib/server/intelligence-index.ts; the UI producer API is
// GET /api/intelligence[?fresh=1].

export const INTEL_CACHE_KEY = "nexus-intelligence-index";
export const INTEL_TTL_MS = 6 * 3_600_000;

/** Weight of the external benchmark signal vs the catalog Elo prior. */
export const INTEL_LIVE_WEIGHT = 0.65;

export type IntelSourceStatus = "live" | "snapshot" | "unavailable";

export interface IntelSource {
  id: "arena-webdev" | "arena-agent" | "aa-index" | "aa-coding";
  label: string;
  url: string;
  status: IntelSourceStatus;
  /** Distinct model rows this source contributed. */
  count: number;
  /** Honest one-liner (e.g. "parse found 0 rows", "HTTP 403"). */
  note?: string;
}

export interface IntelEntry {
  /** Canonical leaderboard name, lowercase ("claude-opus-5", "qwen3.8-max"). */
  name: string;
  /** Composite intelligence 0..1 (blend of every source that has the model). */
  intel: number;
  webdev?: number;
  agent?: number;
  aa?: number;
  coding?: number;
}

export interface IntelligenceIndex {
  asOf: number;
  /** "live" = ≥1 source answered this fetch; "snapshot" = curated table only. */
  origin: "live" | "snapshot";
  entries: IntelEntry[];
  sources: IntelSource[];
  /** ms the server spent producing this index (UI honesty chip). */
  ms: number;
}

// ─── Alias matching ──────────────────────────────────────────────────────────

/** Every canonical name a vault model id could map to, longest first.
 * "deepseek/deepseek-v4.1-flash-1017" → ["deepseek-v4.1-flash-1017",
 *  "deepseek-v4.1-flash"]; "qwen3.8-max-free" → ["qwen3.8-max"]. */
export function modelAliasCandidates(model: string): string[] {
  const raw = (model ?? "").toLowerCase().trim();
  if (!raw) return [];
  const out = new Set<string>();
  const strip = (s: string) =>
    s
      .replace(/:free$/, "")
      .replace(/-free$/, "")
      .replace(/-latest$/, "")
      .replace(/-\d{4}$/, "") // dated cuts: -1017, -0731, -0813
      .replace(/-pro$/, ""); // claude-sonnet-4-6-pro → sonnet-4-6 base row
  const noProvider = raw.includes("/") ? (raw.split("/").pop() ?? raw) : raw;
  out.add(noProvider);
  out.add(strip(noProvider));
  // "-turbo"/"-versatile" togetherness variants (together.ai naming)
  out.add(noProvider.replace(/-(?:turbo|versatile)$/, ""));
  if (raw !== noProvider) out.add(raw);
  out.delete("");
  return [...out].sort((a, b) => b.length - a.length);
}

/** Match a model id against the index. Returns the entry or null. */
export function matchIntelligence(
  index: IntelligenceIndex | null,
  model: string
): IntelEntry | null {
  if (!index || index.entries.length === 0) return null;
  const byName = new Map(index.entries.map((e) => [e.name, e]));
  for (const cand of modelAliasCandidates(model)) {
    const hit = byName.get(cand);
    if (hit) return hit;
  }
  return null;
}

/**
 * The ordering signal buildRelayChain sorts by: benchmark blend when the
 * index knows the model, catalog Elo prior untouched when it doesn't.
 * `origin` tells the UI which badge to paint (live vs prior).
 */
export function blendedIntel(
  index: IntelligenceIndex | null,
  model: string,
  catalogElo: number
): { intel: number; origin: "live" | "prior"; name?: string } {
  const hit = matchIntelligence(index, model);
  if (!hit || typeof hit.intel !== "number" || Number.isNaN(hit.intel)) {
    return { intel: catalogElo, origin: "prior" };
  }
  const intel = hit.intel * INTEL_LIVE_WEIGHT + catalogElo * (1 - INTEL_LIVE_WEIGHT);
  return { intel, origin: "live", name: hit.name };
}

// ─── Client cache ────────────────────────────────────────────────────────────

export function readIntelligenceCache(): IntelligenceIndex | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(INTEL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IntelligenceIndex;
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeIntelligenceCache(index: IntelligenceIndex): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INTEL_CACHE_KEY, JSON.stringify(index));
  } catch {
    /* quota — the in-memory copy still serves this session */
  }
}

export function intelligenceStale(index: IntelligenceIndex | null): boolean {
  if (!index) return true;
  return Date.now() - index.asOf > INTEL_TTL_MS;
}
