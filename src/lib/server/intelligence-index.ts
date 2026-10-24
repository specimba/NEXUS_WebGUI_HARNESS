// ─── r516: Intelligence Index producer (SERVER) ─────────────────────────────
// Fetches the Owner-cited leaderboard sources and distills one composite
// intelligence index the relay chain orders by:
//
//   ① arena.ai/leaderboard/code/webdev   — WebDev arena Elo
//   ② arena.ai/leaderboard/agent         — Agent arena Elo
//   ③ artificialanalysis.ai              — AA intelligence index
//   ④ artificialanalysis.ai/agents/coding-agents — coding-agents board
//
// Doctrine:
//   • FAIL-OPEN — every source is tried with an 8s budget; a source that
//     can't be parsed marks itself honestly ("unavailable") and the curated
//     snapshot below fills the gap. The API NEVER 500s on leaderboard trouble.
//   • HONESTY — every source row carries live | snapshot | unavailable plus a
//     note; the UI paints the difference. Nothing is invented: when the live
//     parse finds nothing, the snapshot's origin stays "snapshot" and the
//     curated table's asOf date travels to the UI.
//   • CACHE — in-memory + PlatformSetting("intelligence.index.v1"), 6h TTL.
//     GET /api/intelligence serves cache; ?fresh=1 forces a re-fetch.
//
// The parse is intentionally conservative: leaderboard pages are JS-heavy,
// so we scan the served HTML for JSON-shaped name/score pairs and only trust
// a source when ≥5 known-model rows resolve. Anything less → snapshot.

import { db } from "@/lib/db";
import type { IntelEntry, IntelSource, IntelligenceIndex } from "@/lib/intelligence";

const SETTING_KEY = "intelligence.index.v1";
const TTL_MS = 6 * 3_600_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY = 2_000_000;
const UA = "NEXUS-WebGUI/1.0 (lane intelligence index; local-first agentic platform)";
/** A source counts as live-parsed when at least this many rows resolve. */
const MIN_LIVE_ROWS = 5;

// ─── Curated snapshot (2026-10-24) ───────────────────────────────────────────
// Hand-curated from the Owner-cited boards + our own live dial evidence
// (relay health, answered counts, first-token latencies). This is the gap
// filler when live parsing fails — honestly labelled "snapshot" end-to-end.
// KEY CORRECTION vs the old static catalog: mercury-3 (diffusion LM) sits at
// 0.90 — elite speed, mid-deep reasoning — BELOW the proven free frontier
// (qwen3.8-max 0.95). Owner: "why is Mercury shit on 2 while significant free
// frontier and benchmark-proven models are already in our arsenal."
const SNAPSHOT_ASOF = Date.parse("2026-10-24T00:00:00Z");

type Snap = [name: string, intel: number];
const SNAPSHOT: Snap[] = [
  ["claude-opus-5", 0.99],
  ["deepseek-v4.1", 0.985],
  ["claude-sonnet-5", 0.98],
  ["gemini-3.8-flash", 0.972],
  ["kimi-k3", 0.972],
  ["glm-5.3", 0.968],
  ["gpt-5.6-luna", 0.968],
  ["gemini-3.6-flash", 0.965],
  ["claude-sonnet-4-6-pro", 0.958],
  ["gemini-3.1-pro-preview", 0.958],
  ["gpt-5.6-terra", 0.96],
  ["claude-sonnet-4-6", 0.955],
  ["grok-4.5", 0.955],
  ["qwen3.8-max", 0.95],
  ["nemotron-3-ultra-550b-a55b", 0.94],
  ["minimax-m3", 0.93],
  ["deepseek-v4.1-flash", 0.925],
  ["deepseek-v4-pro", 0.92],
  ["minimax-m3.1-flash", 0.918],
  ["qwen3.8-flash", 0.912],
  ["deepseek-v4-flash", 0.905],
  ["mercury-3", 0.9],
  ["gpt-oss-120b", 0.9],
  ["deepseek-v4-flash-lr", 0.9],
  ["gemini-2.5-pro", 0.9],
  ["glm-5.3-flash", 0.9],
  ["deepseek-v4-pro-0813", 0.92],
  ["kimi-k2.6", 0.88],
  ["agnes-3.0-flash", 0.88],
  ["agents-a1", 0.87],
  ["atria-dawn", 0.87],
  ["hy4-preview", 0.87],
  ["gemini-3.5-flash-lite", 0.87],
  ["mistral-medium-latest", 0.86],
  ["qwen3.8-27b", 0.84],
  ["command-a-03-2025", 0.84],
  ["xiaomi-mimo-v2.6-pro", 0.83],
  ["codestral-latest", 0.83],
  ["nemotron-3.5-lightning", 0.82],
  ["llama-3.3-70b-instruct", 0.82],
  ["mistral-small-latest", 0.82],
  ["labs-leanstral-1-5-1", 0.81],
  ["gemma-4-31b-it", 0.8],
  ["glm-4.7-flash", 0.8],
  ["gpt-oss-20b", 0.85],
  ["mercury-2", 0.82],
  ["ternary-bonsai-27b", 0.78],
  ["mercury-decide", 0.74],
  ["openai-fast", 0.72],
];

function snapshotEntries(): IntelEntry[] {
  return SNAPSHOT.map(([name, intel]) => ({ name, intel }));
}

// ─── Live parse ──────────────────────────────────────────────────────────────

const SOURCE_DEFS: Array<{
  id: IntelSource["id"];
  label: string;
  url: string;
  signal: "webdev" | "agent" | "aa" | "coding";
}> = [
  {
    id: "arena-webdev",
    label: "Arena · WebDev",
    url: "https://arena.ai/leaderboard/code/webdev",
    signal: "webdev",
  },
  {
    id: "arena-agent",
    label: "Arena · Agent",
    url: "https://arena.ai/leaderboard/agent",
    signal: "agent",
  },
  {
    id: "aa-index",
    label: "Artificial Analysis · Intelligence",
    url: "https://artificialanalysis.ai/",
    signal: "aa",
  },
  {
    id: "aa-coding",
    label: "Artificial Analysis · Coding Agents",
    url: "https://artificialanalysis.ai/agents/coding-agents",
    signal: "coding",
  },
];

/** Pull JSON-shaped `"name":"…","score":N` pairs out of served HTML.
 * Conservative by design — leaderboard apps embed their data as JSON; when
 * the shape drifts we find nothing and fail open to the snapshot. */
function parseScoredNames(text: string): Map<string, number[]> {
  const found = new Map<string, number[]>();
  const re =
    /"(?:model(?:Name|_name)?|name|model)"\s*:\s*"([^"]{2,64})"[^{}]{0,240}?"(?:score|elo|rating|artificialAnalysisIntelligence|intelligenceIndex|value)"\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
  for (let i = 0; i < 4000; i++) {
    const m = re.exec(text);
    if (!m) break;
    const name = m[1].toLowerCase().trim();
    const raw = Number(m[2]);
    if (!name || !Number.isFinite(raw) || raw <= 0) continue;
    // Normalize: arena-style Elo (hundreds) vs 0..1 indices vs 0..100 indices.
    const norm = raw > 3 ? Math.min(1, raw / 1500) : Math.min(1, raw);
    const bucket = found.get(name) ?? [];
    bucket.push(norm);
    found.set(name, bucket);
  }
  re.lastIndex = 0;
  return found;
}

async function fetchSource(def: (typeof SOURCE_DEFS)[number]): Promise<{ source: IntelSource; rows: Map<string, number[]> }> {
  const started = Date.now();
  const fail = (note: string): { source: IntelSource; rows: Map<string, number[]> } => ({
    source: { id: def.id, label: def.label, url: def.url, status: "unavailable", count: 0, note },
    rows: new Map(),
  });
  try {
    const res = await fetch(def.url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return fail(`HTTP ${res.status}`);
    const text = (await res.text()).slice(0, MAX_BODY);
    const rows = parseScoredNames(text);
    if (rows.size < MIN_LIVE_ROWS) {
      return fail(`parse found ${rows.size} rows (<${MIN_LIVE_ROWS}) — JS-rendered board`);
    }
    return {
      source: {
        id: def.id,
        label: def.label,
        url: def.url,
        status: "live",
        count: rows.size,
        note: `${Date.now() - started}ms`,
      },
      rows,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return fail(/timeout|abort/i.test(msg) ? "timeout (8s)" : msg.slice(0, 80));
  }
}

/** Composite per model: aa counts double (general intelligence), the two
 * arena boards and coding-agents one each, over the AVAILABLE subset. */
function composite(parts: { aa?: number; webdev?: number; agent?: number; coding?: number }): number | null {
  const items: Array<[number, number]> = [];
  if (typeof parts.aa === "number") items.push([parts.aa, 0.4]);
  if (typeof parts.webdev === "number") items.push([parts.webdev, 0.2]);
  if (typeof parts.agent === "number") items.push([parts.agent, 0.2]);
  if (typeof parts.coding === "number") items.push([parts.coding, 0.2]);
  if (items.length === 0) return null;
  const wsum = items.reduce((s, [, w]) => s + w, 0);
  return items.reduce((s, [v, w]) => s + v * w, 0) / wsum;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

let memoryCache: IntelligenceIndex | null = null;
let inflight: Promise<IntelligenceIndex> | null = null;

async function readCacheRow(): Promise<IntelligenceIndex | null> {
  if (memoryCache) return memoryCache;
  try {
    const row = await db.platformSetting.findUnique({ where: { id: SETTING_KEY } });
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as IntelligenceIndex;
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCacheRow(index: IntelligenceIndex): Promise<void> {
  memoryCache = index;
  try {
    await db.platformSetting.upsert({
      where: { id: SETTING_KEY },
      update: { value: JSON.stringify(index) },
      create: { id: SETTING_KEY, value: JSON.stringify(index) },
    });
  } catch {
    /* memory cache still serves this process */
  }
}

async function produce(): Promise<IntelligenceIndex> {
  const started = Date.now();
  const results = await Promise.all(
    SOURCE_DEFS.map(async (def) => ({ def, ...(await fetchSource(def)) }))
  );
  const sources: IntelSource[] = results.map((r) => r.source);

  // Seed with the snapshot, then overlay live rows (live wins per name).
  const merged = new Map<string, IntelEntry>();
  for (const e of snapshotEntries()) merged.set(e.name, { ...e });

  for (const { def, source, rows } of results) {
    if (source.status !== "live") continue;
    for (const [name, values] of rows) {
      const best = Math.max(...values);
      const entry = merged.get(name) ?? { name, intel: best };
      entry[def.signal] = best;
      const intel = composite({
        aa: entry.aa,
        webdev: entry.webdev,
        agent: entry.agent,
        coding: entry.coding,
      });
      if (intel !== null) entry.intel = intel;
      merged.set(name, entry);
    }
  }

  const anyLive = sources.some((s) => s.status === "live");
  const index: IntelligenceIndex = {
    ...(anyLive ? { asOf: Date.now() } : { asOf: SNAPSHOT_ASOF }),
    origin: anyLive ? "live" : "snapshot",
    entries: [...merged.values()].sort((a, b) => b.intel - a.intel),
    sources,
    ms: Date.now() - started,
  };
  await writeCacheRow(index);
  return index;
}

/** The API entry: cached within TTL, `fresh` forces a re-fetch, and a failed
 * fresh fetch degrades to the last cache instead of erroring. */
export async function getIntelligenceIndex(opts: { fresh?: boolean } = {}): Promise<IntelligenceIndex> {
  const cached = await readCacheRow();
  const age = cached ? Date.now() - cached.asOf : Infinity;
  if (!opts.fresh && cached && age < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = produce()
    .then(async (idx) => {
      // A fresh fetch that found NOTHING live and the cache is NEWER keeps
      // the cache (a snapshot re-read can't beat a previous live pull).
      if (!cached) return idx;
      if (idx.origin === "snapshot" && cached.origin === "live" && opts.fresh) {
        const keep: IntelligenceIndex = {
          ...cached,
          sources: idx.sources,
          ms: idx.ms,
        };
        memoryCache = keep;
        return keep;
      }
      return idx;
    })
    .catch(() => cached ?? snapshotFallback())
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function snapshotFallback(): IntelligenceIndex {
  return {
    asOf: SNAPSHOT_ASOF,
    origin: "snapshot",
    entries: snapshotEntries(),
    sources: SOURCE_DEFS.map((d) => ({
      id: d.id,
      label: d.label,
      url: d.url,
      status: "unavailable" as const,
      count: 0,
      note: "producer error — curated snapshot served",
    })),
    ms: 0,
  };
}
