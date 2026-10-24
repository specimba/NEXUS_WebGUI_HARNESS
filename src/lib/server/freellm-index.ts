// ─── r517: freellm.sh reach-index producer (SERVER) ──────────────────────────
// The REACH half of the owner's "reach and intelligence index" directive.
// The r516 intelligence index (lib/server/intelligence-index.ts) distills
// arena.ai + artificialanalysis.ai into a smartness ranking; this producer
// distills freellm.sh into an availability census: which free-access sources
// are operational right now, and what landed freshest.
//
// HOW freellm.sh is crawled (the "generalized crawl" the Owner approved):
// the site is a Next.js RSC app. The models table arrives inside the served
// HTML as React-flight chunks — a sequence of
//     <script>self.__next_f.push([1,"…JSON string…"])</script>
// bodies whose string literals concatenate into the flight buffer. The
// models array lives in that buffer as `"models":[…]`. The site's filtered
// view (?access=free-tier&…&status=operational&sort=newest) is applied
// CLIENT-SIDE by the site (the HTML is byte-identical with or without the
// params — measured this round), so this producer parses the same payload
// ONCE and derives the identical filter server-side, honestly labelling
// everything "live" only when the flight payload actually parsed.
//
// Doctrine (mirrors the r516 intelligence producer):
//   • FAIL-OPEN — a fetch/parse failure returns origin:"unavailable" with an
//     honest note; the API never 500s on freellm trouble. There is NO
//     curated snapshot here: a stale hand-typed "free sources" list would be
//     invented reach, which is exactly what the Owner banned for routing.
//   • CACHE — in-memory + PlatformSetting("freellm.index.v1"), 6h TTL.
//     GET /api/freellm serves the cache; ?fresh=1 forces a re-fetch.

import { db } from "@/lib/db";
import { FREE_ACCESS_TIERS, type FreellmEntry, type FreellmIndex } from "@/lib/freellm";

const SETTING_KEY = "freellm.index.v1";
const TTL_MS = 6 * 3_600_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY = 3_000_000;
const UA = "NEXUS-WebGUI/1.0 (free reach census; local-first agentic platform)";
/** A real freellm payload carries 150+ rows; below this we did not parse
 * the flight buffer — report unavailable instead of trusting a torn read. */
const MIN_ENTRIES = 20;

const FREELLM_BASE = "https://freellm.sh/";

// ─── Flight-payload extraction ───────────────────────────────────────────────

const PUSH_PREFIX = "self.__next_f.push([1,";

/** Concatenate every well-formed flight-push string literal in the HTML. */
export function extractFlightBuffer(html: string): string {
  let buf = "";
  let i = 0;
  for (;;) {
    const s = html.indexOf("<script", i);
    if (s < 0) break;
    const open = html.indexOf(">", s);
    const close = html.indexOf("</script>", open);
    if (open < 0 || close < 0) break;
    const body = html.slice(open + 1, close).trim();
    if (body.startsWith(PUSH_PREFIX) && body.endsWith("])")) {
      const literal = body.slice(PUSH_PREFIX.length, -2);
      try {
        buf += JSON.parse(literal) as string;
      } catch {
        // torn chunk (streaming cut mid-escape) — skip, the models array
        // usually lives whole in one of the large chunks.
      }
    }
    i = close + "</script>".length;
  }
  return buf;
}

/** Slice the JSON array text starting at `from` (the index of '['), honoring
 * string escapes so bracket-shaped text inside freeLimit strings cannot end
 * the scan early. Returns null when the array never closes. */
export function sliceJsonArray(buf: string, from: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = from; k < buf.length; k++) {
    const c = buf[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) return buf.slice(from, k + 1);
    }
  }
  return null;
}

interface RawEntry {
  id?: unknown;
  name?: unknown;
  provider?: unknown;
  providerSlug?: unknown;
  type?: unknown;
  access?: unknown;
  status?: unknown;
  freeLimit?: unknown;
  addedAt?: unknown;
  gated?: unknown;
  url?: unknown;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];

/** Defensive normalization — freellm rows we cannot vouch for are skipped,
 * never guessed. */
export function normalizeEntry(raw: RawEntry): FreellmEntry | null {
  const id = str(raw.id);
  const name = str(raw.name);
  const provider = str(raw.provider);
  if (!id || !name || !provider) return null;
  return {
    id,
    name,
    provider,
    ...(str(raw.providerSlug) ? { providerSlug: str(raw.providerSlug) } : {}),
    types: strArr(raw.type),
    access: strArr(raw.access),
    status: str(raw.status) ?? "unknown",
    ...(str(raw.freeLimit) ? { freeLimit: str(raw.freeLimit) } : {}),
    ...(str(raw.addedAt) ? { addedAt: str(raw.addedAt) } : {}),
    gated: raw.gated === true,
    ...(str(raw.url) ? { url: str(raw.url) } : {}),
  };
}

/** Parse the models array out of a flight buffer. Exported for tests/QA. */
export function parseFreellmModels(flight: string): FreellmEntry[] {
  const key = flight.indexOf('"models":');
  if (key < 0) return [];
  const open = flight.indexOf("[", key);
  if (open < 0) return [];
  const sliced = sliceJsonArray(flight, open);
  if (!sliced) return [];
  try {
    const arr: unknown = JSON.parse(sliced);
    if (!Array.isArray(arr)) return [];
    const out: FreellmEntry[] = [];
    for (const row of arr as RawEntry[]) {
      const e = row && typeof row === "object" ? normalizeEntry(row) : null;
      if (e) out.push(e);
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Census + filtered view ──────────────────────────────────────────────────

const isNew = (e: FreellmEntry): boolean => {
  if (!e.addedAt) return false;
  const t = Date.parse(e.addedAt);
  return Number.isFinite(t) && Date.now() - t < 14 * 86_400_000;
};

export function buildIndex(entries: FreellmEntry[], ms: number): FreellmIndex {
  // The filtered view — the Owner's URL, derived server-side:
  // access ∈ {free-tier, free-forever, signup-credits} ∧ status operational,
  // sorted newest first (missing addedAt sorts last, stably).
  const filtered = entries
    .filter(
      (e) => e.status === "operational" && e.access.some((a) => (FREE_ACCESS_TIERS as readonly string[]).includes(a))
    )
    .sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""));

  const byTier: Record<string, number> = {};
  for (const e of entries) for (const t of e.access) byTier[t] = (byTier[t] ?? 0) + 1;

  const providerCounts = new Map<string, number>();
  for (const e of filtered) providerCounts.set(e.provider, (providerCounts.get(e.provider) ?? 0) + 1);
  const byProvider = [...providerCounts.entries()]
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    asOf: Date.now(),
    origin: "live",
    total: entries.length,
    entries: filtered,
    counts: {
      operational: entries.filter((e) => e.status === "operational").length,
      degraded: entries.filter((e) => e.status !== "operational").length,
      new14d: filtered.filter(isNew).length,
      byTier,
      byProvider,
    },
    ms,
  };
}

// ─── Cache (PlatformSetting KV, r514 pattern) ────────────────────────────────

let memoryCache: FreellmIndex | null = null;
let inflight: Promise<FreellmIndex> | null = null;

async function readCacheRow(): Promise<FreellmIndex | null> {
  if (memoryCache) return memoryCache;
  try {
    const row = await db.platformSetting.findUnique({ where: { id: SETTING_KEY } });
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as FreellmIndex;
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    memoryCache = parsed;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCacheRow(index: FreellmIndex): Promise<void> {
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

async function produce(): Promise<FreellmIndex> {
  const started = Date.now();
  const unavailable = (note: string): FreellmIndex => ({
    asOf: Date.now(),
    origin: "unavailable",
    total: 0,
    entries: [],
    counts: { operational: 0, degraded: 0, new14d: 0, byTier: {}, byProvider: [] },
    note,
    ms: Date.now() - started,
  });

  try {
    const res = await fetch(FREELLM_BASE, {
      headers: { "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return unavailable(`freellm.sh HTTP ${res.status}`);
    const html = (await res.text()).slice(0, MAX_BODY);
    const entries = parseFreellmModels(extractFlightBuffer(html));
    if (entries.length < MIN_ENTRIES) {
      return unavailable(
        `flight payload parsed ${entries.length} rows (<${MIN_ENTRIES}) — site shape likely changed`,
      );
    }
    const index = buildIndex(entries, Date.now() - started);
    await writeCacheRow(index);
    return index;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    return unavailable(/timeout|abort/i.test(msg) ? "timeout (10s)" : msg.slice(0, 90));
  }
}

/** The API entry: cached within TTL, `fresh` forces a re-fetch, and a failed
 * fresh fetch degrades to the last cache instead of an empty hand. */
export async function getFreellmIndex(opts: { fresh?: boolean } = {}): Promise<FreellmIndex> {
  const cached = await readCacheRow();
  const age = cached ? Date.now() - cached.asOf : Infinity;
  if (!opts.fresh && cached && age < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = produce()
    .then(async (idx) => {
      // A fresh fetch that came back unavailable keeps the last live cache
      // (an honest outage must not erase good reach data).
      if (idx.origin === "unavailable" && cached && cached.origin === "live" && opts.fresh) {
        const keep: FreellmIndex = { ...cached, note: idx.note, ms: idx.ms };
        memoryCache = keep;
        return keep;
      }
      return idx;
    })
    .catch(() => {
      // produce() itself never throws, but the belt stays on.
      return cached ?? {
        asOf: Date.now(),
        origin: "unavailable" as const,
        total: 0,
        entries: [],
        counts: { operational: 0, degraded: 0, new14d: 0, byTier: {}, byProvider: [] },
        note: "producer error — no cached census",
        ms: 0,
      };
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
