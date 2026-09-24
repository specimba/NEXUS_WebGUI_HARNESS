// ─── r45: capability flags (from the provider catalogs that publish them) ───
// OpenRouter + Kilo carry `supported_parameters` and `architecture`; other
// sources publish nothing — their rows show NO caps rather than guessed ones.

export interface ModelCaps {
  tools: boolean; // tool/function calling
  structured: boolean; // structured outputs / json response_format
  reasoning: boolean; // reasoning / chain-of-thought controls
  vision: boolean; // image input
}

/** Tone-coded badge metadata — one glyph per capability, honest tooltips. */
export const CAP_META: { key: keyof ModelCaps; glyph: string; label: string; hint: string; cls: string }[] = [
  {
    key: "tools",
    glyph: "🔧",
    label: "tools",
    hint: "Declares tool/function calling — drives agents and pipelines",
    cls: "text-sky-600 dark:text-sky-400 bg-sky-500/10",
  },
  {
    key: "structured",
    glyph: "{ }",
    label: "structured",
    hint: "Declares structured outputs / JSON response format",
    cls: "text-violet-600 dark:text-violet-400 bg-violet-500/10",
  },
  {
    key: "reasoning",
    glyph: "🧠",
    label: "reasoning",
    hint: "Declares reasoning controls (effort / include-reasoning)",
    cls: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
  },
  {
    key: "vision",
    glyph: "👁",
    label: "vision",
    hint: "Accepts image input alongside text",
    cls: "text-pink-600 dark:text-pink-400 bg-pink-500/10",
  },
];

/**
 * Read caps from a tracked row's meta (synced by the OpenRouter/Kilo fetchers).
 * Returns null when the source publishes nothing — "unknown" is rendered as
 * nothing, never as a false "no".
 */
export function capsOf(row: Pick<TrackedModelRow, "meta">): ModelCaps | null {
  const caps = (row.meta as Record<string, unknown> | null)?.caps;
  if (!caps || typeof caps !== "object") return null;
  const c = caps as Record<string, unknown>;
  const bool = (v: unknown) => v === true;
  return { tools: bool(c.tools), structured: bool(c.structured), reasoning: bool(c.reasoning), vision: bool(c.vision) };
}

/** True when the row's catalog data says tool-calling is unsupported. */
export function declaresNoTools(row: Pick<TrackedModelRow, "meta">): boolean {
  const c = capsOf(row);
  return c !== null && !c.tools;
}

// ─── r28 wire types ──────────────────────────────────────────────────────────

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
