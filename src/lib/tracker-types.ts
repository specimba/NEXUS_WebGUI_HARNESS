// ─── r28: Free/New Model Tracker — shared wire types (client + server) ───────

export interface TrackedModelRow {
  id: string; // "providerId::modelId"
  providerId: string;
  modelId: string;
  displayName: string | null;
  contextWindow: number | null;
  priceIn: number | null;
  priceOut: number | null;
  free: boolean;
  sightings: number;
  isNew: boolean;
  firstSeenAt: string; // ISO
  lastSeenAt: string; // ISO
  removedAt: string | null;
  meta: Record<string, unknown> | null;
}

export interface TrackerEventRow {
  id: string;
  type: "new" | "removed" | "reappeared";
  modelKey: string;
  providerId: string;
  modelId: string;
  payload: string | null;
  createdAt: string; // ISO
}

export interface TrackerSourceHealth {
  id: string;
  lastSyncAt: string | null;
  lastOk: boolean;
  lastError: string | null;
  modelCount: number;
}

export interface TrackerData {
  tracked: TrackedModelRow[];
  signals: TrackedModelRow[];
  events: TrackerEventRow[];
  sources: TrackerSourceHealth[];
  status: {
    lastSyncAt: string | null;
    stale: boolean;
    nextForceEligibleAt: number;
    newWindowHours: number;
    syncTtlHours: number;
  };
}

/** Ticker localStorage mirror shape (instant paint before the fetch resolves). */
export interface TrackerCache {
  at: number;
  tracked: TrackedModelRow[];
  events: TrackerEventRow[];
  lastSyncAt: string | null;
}

export const TRACKER_CACHE_KEY = "praison-tracker-cache";
export const TRACKER_LAST_SEEN_KEY = "praison-tracker-lastseen";
export const TRACKER_SYNC_TTL_MS = 4 * 60 * 60_000;

/** Provider display metadata for tracker rows (glyphs shared with the relay). */
export const TRACKER_PROVIDER_META: Record<string, { label: string; glyph: string }> = {
  vyce: { label: "Vyce AI", glyph: "◈" },
  aihubmix: { label: "AIHubMix", glyph: "⬢" },
  orcarouter: { label: "OrcaRouter", glyph: "🐋" },
  openrouter: { label: "OpenRouter", glyph: "🛰" },
  pollinations: { label: "Pollinations", glyph: "🌻" },
  huggingface: { label: "HF signals", glyph: "🤗" },
};

export function providerMeta(id: string): { label: string; glyph: string } {
  return TRACKER_PROVIDER_META[id] ?? { label: id, glyph: "◆" };
}

/** "$0.10/$0.40" style price string, or null when unknown. */
export function fmtPrice(row: { priceIn: number | null; priceOut: number | null }): string | null {
  if (row.priceIn == null && row.priceOut == null) return null;
  const f = (v: number | null) => (v == null ? "?" : v === 0 ? "$0" : `$${v < 1 ? v.toFixed(2) : v.toFixed(1)}`);
  return `${f(row.priceIn)}/${f(row.priceOut)}`;
}

/** "1M ctx" style context string. */
export function fmtCtx(ctx: number | null): string | null {
  if (!ctx || ctx <= 0) return null;
  if (ctx >= 1_000_000) return `${+(ctx / 1_000_000).toFixed(1)}M ctx`;
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}K ctx`;
  return `${ctx} ctx`;
}

/** Relative "first seen" age for the firsthand-advantage feel. */
export function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
