/**
 * scripts/fetch-leaderboard.ts — r49 task 3-a
 *
 * Fetch LIVE model rankings from the two doctrine leaderboards and prepare a
 * DATED, HUMAN-REVIEWED snapshot for the model relay:
 *
 *   bun scripts/fetch-leaderboard.ts           # dry-run: fetch + extract + print REVIEW DIFF, writes NOTHING
 *   bun scripts/fetch-leaderboard.ts --apply   # write src/config/leaderboard.json (atomic) + changelog entry
 *
 * ── Honesty doctrine (non-negotiable) ────────────────────────────────────────
 *  • Rankings are NEVER auto-pushed: this script only PROPOSES; a human runs
 *    --apply after reading the printed diff. relay.ts blends the file 50/50.
 *  • Only ids/scores LITERALLY present in fetched content are extracted. No
 *    invented, extrapolated, or "obviously it's fine" entries — an empty or
 *    partial result is reported as exactly that.
 *  • Every source records WHICH fetch strategy worked (SDK page_reader vs
 *    direct fetch) and which extraction method produced the entries
 *    (embedded-json / ranked-lines / token-scan). If both strategies fail for
 *    a source (bot walls are expected), the failure is printed and the run
 *    continues with the other source; if BOTH sources fail, exit 1 and the
 *    config file is untouched.
 *  • Score provenance is stated in the file's `note` (direct 0–1 / percent
 *    rescale / arena-Elo min..max linear / rank-derived 1-(r-1)/N).
 */

import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

// ─── Configuration ───────────────────────────────────────────────────────────

// bun's `import.meta.dir` — typed via a local cast so tsc (without bun-types)
// stays clean; falls back to cwd when the field is absent.
const here: string = (import.meta as { dir?: string }).dir ?? process.cwd();
const ROOT = path.resolve(here, "..");
const RELAY_TS = path.join(ROOT, "src", "lib", "relay.ts");
const LEADERBOARD_JSON = path.join(ROOT, "src", "config", "leaderboard.json");

const SOURCE_URLS = [
  "https://arena.ai/leaderboard/code/webdev",
  "https://artificialanalysis.ai/agents/coding-agents",
] as const;

const MAX_ENTRIES_PER_SOURCE = 60; // doctrine cap — no 400-row dumps in a reviewed file
const DIRECT_FETCH_TIMEOUT_MS = 20_000;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ─── Types ───────────────────────────────────────────────────────────────────

/** One model entry literally read from a page. `elo` only when the page showed a number. */
interface RawEntry {
  id: string;
  elo?: number;
  rank?: number;
  /** true ⇒ the id came from a display name squeezed into id-form (lower confidence). */
  display?: boolean;
}

type FetchStrategy = "sdk-page-reader" | "direct-fetch";

interface SourceFetch {
  url: string;
  ok: boolean;
  strategy: FetchStrategy;
  title?: string;
  html?: string;
  error?: string;
}

type ExtractMethod = "embedded-json" | "ranked-lines" | "token-scan" | "none";
type ScaleMethod = "direct-0-1" | "percent-0-100" | "elo-min-max-linear" | "rank-derived";

interface SourceExtraction {
  url: string;
  fetched: boolean; // did ANY fetch strategy succeed?
  strategy?: FetchStrategy;
  title?: string; // page <title> from the successful fetch
  method: ExtractMethod;
  entries: RawEntry[];
  scale?: ScaleMethod;
  jsonPath?: string;
  error?: string;
}

interface CatalogModel {
  id: string;
  tier: 1 | 2 | 3;
  elo: number;
}

interface CatalogLane {
  key: string; // "providerId::modelId" — the relay hop key
  providerId: string;
  modelId: string; // catalog id form
  doctrineElo: number;
}

interface Catalog {
  providers: Record<string, { label: string; models: CatalogModel[] }>;
  lanes: CatalogLane[];
}

/** Shape of src/config/leaderboard.json (mirrors relay.ts LeaderboardFile). */
interface LeaderboardFile {
  version: number;
  updatedAt: string;
  sources: string[];
  note: string;
  scores: Record<string, number>;
  changelog: { date: string; note: string }[];
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function hr(): void {
  console.log("─".repeat(78));
}

/** Model-id plausibility: contains a letter, restricted charset, length ≥ 3. */
const MODEL_ID_RE = /^[A-Za-z][A-Za-z0-9._/:-]{2,59}$/;

/** Whole-token noise (page chrome / prose). Only ever REJECTS — never rewrites. */
const NOISE_TOKENS = new Set([
  "the", "and", "for", "with", "all", "new", "top", "are", "was", "were", "has", "have",
  "had", "not", "but", "its", "our", "your", "their", "this", "that", "from", "into",
  "over", "under", "about", "more", "most", "best", "vs", "via", "per", "one", "two",
  "get", "set", "can", "will", "see", "read", "http", "https", "www", "com", "org",
  "net", "html", "json", "css", "sdk", "api", "llm", "llms", "key", "keys", "free",
  "paid", "open", "model", "models", "score", "scores", "rank", "ranks", "ranking",
  "rankings", "leaderboard", "arena", "code", "webdev", "agent", "agents", "coding",
  "battle", "chat", "vote", "votes", "elo", "price", "pricing", "context", "window",
  "token", "tokens", "input", "output", "license", "provider", "providers", "latest",
  "auto", "builtin", "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep",
  "oct", "nov", "dec", "inc", "ltd", "llc", "labs", "lab", "e.g", "i.e", "min", "max",
]);

function looksLikeModelId(token: string): boolean {
  if (!MODEL_ID_RE.test(token)) return false;
  return !NOISE_TOKENS.has(token.toLowerCase());
}

/** Squeeze a display name ("DeepSeek V4.1") into id-form; null if it degrades to junk. */
function squeezeDisplayName(raw: string): string | null {
  const squeezed = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._/:-]/g, "");
  return looksLikeModelId(squeezed) ? squeezed : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(tr|li|p|div|h[1-6]|section|article|table|header|footer)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ─── Fetch strategies (in order; honestly recorded) ─────────────────────────

/**
 * Strategy A: the platform SDK's page_reader (rendered DOM, bypasses some bot
 * walls). ZAI.create() is wrapped in try/catch + dynamically imported so the
 * script still runs (and reports honestly) when the SDK is absent/unconfigured.
 */
async function fetchViaSdk(url: string): Promise<SourceFetch> {
  try {
    const mod = await import("z-ai-web-dev-sdk");
    const zai = await mod.default.create();
    const res = await zai.functions.invoke("page_reader", { url });
    const html = res?.data?.html ?? "";
    if (!html.trim()) {
      return { url, ok: false, strategy: "sdk-page-reader", error: "page_reader returned empty html" };
    }
    return { url, ok: true, strategy: "sdk-page-reader", title: res.data.title, html };
  } catch (err) {
    return { url, ok: false, strategy: "sdk-page-reader", error: errMsg(err) };
  }
}

/** Strategy B: direct fetch with a browser UA + hard 20 s timeout. */
async function fetchDirect(url: string): Promise<SourceFetch> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(DIRECT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { url, ok: false, strategy: "direct-fetch", error: `HTTP ${res.status} ${res.statusText}` };
    }
    const html = await res.text();
    if (!html.trim()) {
      return { url, ok: false, strategy: "direct-fetch", error: "empty body" };
    }
    return { url, ok: true, strategy: "direct-fetch", title: undefined, html };
  } catch (err) {
    return { url, ok: false, strategy: "direct-fetch", error: errMsg(err) };
  }
}

async function fetchSource(url: string): Promise<{ fetches: SourceFetch[]; result: SourceFetch | null }> {
  const attempts: SourceFetch[] = [];
  for (const strategy of [fetchViaSdk, fetchDirect]) {
    const attempt = await strategy(url);
    attempts.push(attempt);
    if (attempt.ok) return { fetches: attempts, result: attempt };
    console.log(`    ✗ ${attempt.strategy}: ${attempt.error}`);
  }
  return { fetches: attempts, result: null };
}

// ─── Extraction (only what is literally on the page) ─────────────────────────

/** Method 1 — walk parseable <script> JSON for arrays of model-like objects. */
function extractEmbeddedJson(html: string): { entries: RawEntry[]; path: string } | null {
  const candidates: { entries: RawEntry[]; path: string; eloCount: number }[] = [];
  const NAME_FIELDS = ["name", "id", "model", "modelId", "model_id", "slug", "label"];
  const ELO_FIELDS = ["elo", "eloRating", "elo_rating", "rating", "score", "arenaScore", "arena_score"];
  const RANK_FIELDS = ["rank", "position", "rankNum"];

  function evaluate(arr: unknown[], pathStr: string): void {
    if (arr.length < 3 || arr.length > 300) return;
    const entries: RawEntry[] = [];
    let eloCount = 0;
    for (const item of arr) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return;
      const obj = item as Record<string, unknown>;
      let id: string | null = null;
      let display = false;
      for (const f of NAME_FIELDS) {
        const v = obj[f];
        if (typeof v !== "string") continue;
        if (looksLikeModelId(v)) { id = v; break; }
        const sq = squeezeDisplayName(v);
        if (sq && /\d/.test(v)) { id = sq; display = true; break; } // display names must carry a digit
      }
      if (!id) continue;
      const entry: RawEntry = { id, display };
      for (const f of ELO_FIELDS) {
        const v = obj[f];
        if (typeof v === "number" && Number.isFinite(v)) { entry.elo = v; eloCount++; break; }
      }
      for (const f of RANK_FIELDS) {
        const v = obj[f];
        if (typeof v === "number" && Number.isInteger(v) && v >= 1) { entry.rank = v; break; }
      }
      entries.push(entry);
    }
    // ≥60% of items must look like model ids, else this array is not a leaderboard.
    if (entries.length < Math.ceil(arr.length * 0.6)) return;
    candidates.push({ entries, path: pathStr, eloCount });
  }

  function walk(node: unknown, pathStr: string, depth: number): void {
    if (depth > 12 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      evaluate(node, pathStr);
      for (let i = 0; i < Math.min(node.length, 300); i++) walk(node[i], `${pathStr}[${i}]`, depth + 1);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walk(v, pathStr ? `${pathStr}.${k}` : k, depth + 1);
    }
  }

  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const body of scripts) {
    const trimmed = body.trim();
    if (trimmed.length < 20 || trimmed.length > 4_000_000) continue;
    // Bare JSON, or `X = {...}` / `(self.__x=...)` assignment shapes.
    const slices: string[] = [trimmed];
    const braceStart = trimmed.search(/[[{]/);
    if (braceStart > 0) slices.push(trimmed.slice(braceStart).replace(/[;)]+\s*$/, ""));
    for (const slice of slices) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(slice);
      } catch {
        continue; // not JSON — honest skip, no heroics
      }
      walk(parsed, "<script>", 0);
    }
  }
  if (candidates.length === 0) return null;
  // Prefer the largest accepted array; break ties by arrays that carry explicit scores.
  candidates.sort((a, b) => b.entries.length - a.entries.length || b.eloCount - a.eloCount);
  const best = candidates[0];
  return { entries: best.entries.slice(0, MAX_ENTRIES_PER_SOURCE), path: best.path };
}

/** Method 2 — ranked text lines like `1 gpt-... 1234` / `2. claude-... — 1187`. */
function extractRankedLines(text: string): RawEntry[] {
  const entries: RawEntry[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const m = line.match(/^(\d{1,3})[.)\]]?\s+(.{3,})$/);
    if (!m) continue;
    const rank = Number(m[1]);
    if (rank < 1 || rank > 200) continue;
    const rest = m[2];
    const idM = rest.match(/\b([A-Za-z][A-Za-z0-9._/:-]{2,59})\b/);
    if (!idM || !looksLikeModelId(idM[1])) continue;
    // A trailing number is accepted as Elo only if it is plausibly a score
    // (larger than the rank, or decimal) — "3 some-model 3" is not evidence.
    const tail = rest.match(/([\d][\d,]*\.?\d*)\s*$/);
    let elo: number | undefined;
    if (tail) {
      const n = Number(tail[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0 && n <= 100_000 && (n > rank || tail[1].includes(".")) && n !== rank) {
        elo = n;
      }
    }
    const key = idM[1].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ id: idM[1], rank, ...(elo !== undefined ? { elo } : {}) });
  }
  return entries;
}

/** Method 3 (last resort, labeled low-confidence) — id-shaped tokens with a digit. */
function extractTokenScan(text: string): RawEntry[] {
  const entries: RawEntry[] = [];
  const seen = new Set<string>();
  const tokens = text.match(/[A-Za-z][A-Za-z0-9._/:-]{2,59}/g) ?? [];
  for (const tok of tokens) {
    if (!/\d/.test(tok)) continue; // noise guard beyond the spec minimum (documented)
    if (!looksLikeModelId(tok)) continue;
    const key = tok.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ id: tok });
    if (entries.length >= MAX_ENTRIES_PER_SOURCE) break;
  }
  return entries;
}

/**
 * Convert raw entries to 0..1 scores. Explicit Elo wins when ≥2 values share a
 * consistent scale; otherwise rank-derived score = 1 - (r-1)/N (1-based r).
 */
function normalizeScores(entries: RawEntry[]): { scored: RawEntry[]; scale: ScaleMethod } {
  const elos = entries.map((e) => e.elo).filter((n): n is number => typeof n === "number");
  const out = entries.map((e) => ({ ...e }));
  if (elos.length >= 2 && elos.length >= Math.ceil(entries.length * 0.8)) {
    const min = Math.min(...elos);
    const max = Math.max(...elos);
    const scale: ScaleMethod =
      min >= 0 && max <= 1 ? "direct-0-1" : min > 1 && max <= 100 ? "percent-0-100" : "elo-min-max-linear";
    const lin = (n: number): number => (max - min < 1e-9 ? 1 : (n - min) / (max - min));
    for (const e of out) {
      if (typeof e.elo !== "number") continue;
      e.elo = scale === "direct-0-1" ? e.elo : scale === "percent-0-100" ? e.elo / 100 : lin(e.elo);
    }
    return { scored: out, scale };
  }
  // Rank-derived (appearance order doubles as rank when the page gave none).
  out.forEach((e, i) => {
    const r = e.rank ?? i + 1;
    e.rank = r;
    e.elo = 1 - (r - 1) / Math.max(out.length, 1);
  });
  return { scored: out, scale: "rank-derived" };
}

function extractFromSource(url: string, fetchResult: SourceFetch | null): SourceExtraction {
  if (!fetchResult) {
    return { url, fetched: false, method: "none", entries: [], error: "both fetch strategies failed" };
  }
  const html = fetchResult.html ?? "";
  const text = htmlToText(html);

  // 1) embedded JSON (highest confidence when present)
  const json = extractEmbeddedJson(html);
  if (json && json.entries.length > 0) {
    const { scored, scale } = normalizeScores(json.entries.slice(0, MAX_ENTRIES_PER_SOURCE));
    return {
      url,
      fetched: true,
      strategy: fetchResult.strategy,
      ...(fetchResult.title ? { title: fetchResult.title } : {}),
      method: "embedded-json",
      entries: scored,
      scale,
      jsonPath: json.path,
    };
  }
  // 2) ranked lines
  const lines = extractRankedLines(text).slice(0, MAX_ENTRIES_PER_SOURCE);
  if (lines.length > 0) {
    const { scored, scale } = normalizeScores(lines);
    return { url, fetched: true, strategy: fetchResult.strategy, ...(fetchResult.title ? { title: fetchResult.title } : {}), method: "ranked-lines", entries: scored, scale };
  }
  // 3) token scan (last resort — labeled low-confidence in every report)
  const tokens = extractTokenScan(text).slice(0, MAX_ENTRIES_PER_SOURCE);
  if (tokens.length > 0) {
    const { scored, scale } = normalizeScores(tokens);
    return {
      url,
      fetched: true,
      strategy: fetchResult.strategy,
      ...(fetchResult.title ? { title: fetchResult.title } : {}),
      method: "token-scan",
      entries: scored,
      scale,
    };
  }
  return {
    url,
    fetched: true,
    strategy: fetchResult.strategy,
    ...(fetchResult.title ? { title: fetchResult.title } : {}),
    method: "none",
    entries: [],
    error: "page fetched, but no model-id-shaped content extractable",
  };
}

// ─── Catalog parsing (single source of truth: relay.ts ARENA_CATALOG) ────────

/**
 * Parse ARENA_CATALOG straight out of relay.ts source. A mirrored hardcoded
 * copy would drift; the relay's own source cannot. Throws when the shape is
 * unrecognized — the script refuses to guess doctrine Elo values.
 */
function parseArenaCatalog(source: string): Catalog {
  const start = source.indexOf("const ARENA_CATALOG");
  if (start === -1) throw new Error("ARENA_CATALOG not found in relay.ts");
  const end = source.indexOf("\n};", start);
  if (end === -1) throw new Error("ARENA_CATALOG block end not found in relay.ts");
  const block = source.slice(start, end);

  const providers: Catalog["providers"] = {};
  let current: string | null = null;
  for (const line of block.split("\n")) {
    const prov = line.match(/^ {2}"?([A-Za-z0-9_-]+)"?: \{$/);
    if (prov) {
      current = prov[1];
      providers[current] = { label: "", models: [] };
      continue;
    }
    if (!current) continue;
    const label = line.match(/^ {4}label: "([^"]*)",?$/);
    if (label) {
      providers[current].label = label[1];
      continue;
    }
    const model = line.match(/id: "([^"]+)", tier: ([123]), elo: ([0-9.]+)/);
    if (model) {
      providers[current].models.push({
        id: model[1],
        tier: Number(model[2]) as 1 | 2 | 3,
        elo: Number(model[3]),
      });
    }
  }

  const lanes: CatalogLane[] = [];
  for (const [providerId, p] of Object.entries(providers)) {
    for (const m of p.models) {
      lanes.push({ key: `${providerId}::${m.id}`, providerId, modelId: m.id, doctrineElo: m.elo });
    }
  }
  const providerCount = Object.keys(providers).length;
  if (providerCount === 0 || lanes.length === 0 || lanes.some((l) => !Number.isFinite(l.doctrineElo))) {
    throw new Error(`relay.ts ARENA_CATALOG parse produced ${providerCount} providers / ${lanes.length} lanes — refusing to proceed on a bad parse`);
  }
  return { providers, lanes };
}

// ─── Key mapping (extracted id → every matching catalog lane, bare key kept) ─

function normMatch(id: string): string {
  return id.trim().toLowerCase().replace(/:free$/i, "");
}

function lastSegment(id: string): string {
  const parts = id.split("/");
  return parts[parts.length - 1];
}

/** Generic router ids must never cross-match by bare last segment ("openrouter/free" ≠ "kilo-auto/free"). */
const GENERIC_SEGMENTS = new Set(["free", "auto", "efficient", "builtin", "balanced"]);

/** Normalized match: case-insensitive, `:free`-tolerant, org-prefix-tolerant (last segment). */
function matchesCatalogModel(extracted: string, catalogId: string): boolean {
  const a = normMatch(extracted);
  const b = normMatch(catalogId);
  if (a === b) return true;
  const la = lastSegment(a);
  const lb = lastSegment(b);
  if (GENERIC_SEGMENTS.has(la) || GENERIC_SEGMENTS.has(lb)) return false;
  return la === lb && la.length >= 3;
}

interface MappedEntry {
  rawId: string;
  score: number;
  lanes: CatalogLane[];
  fromBothSources: boolean;
}

function mapEntries(
  perSource: SourceExtraction[],
  catalog: Catalog,
): { mapped: MappedEntry[]; unmappedIds: string[]; scoreOf: Map<string, number> } {
  // Merge across sources: case-insensitive dedupe; an id ranked by BOTH
  // sources gets the AVERAGE of its two normalized scores (stated in output).
  const byKey = new Map<string, { rawId: string; scores: number[] }>();
  for (const src of perSource) {
    for (const e of src.entries) {
      const key = e.id.toLowerCase();
      const slot = byKey.get(key) ?? { rawId: e.id, scores: [] };
      if (typeof e.elo === "number") slot.scores.push(e.elo);
      byKey.set(key, slot);
    }
  }
  const mapped: MappedEntry[] = [];
  const unmappedIds: string[] = [];
  const scoreOf = new Map<string, number>();
  for (const [key, slot] of byKey) {
    const score = slot.scores.length > 0 ? slot.scores.reduce((a, b) => a + b, 0) / slot.scores.length : 0;
    if (slot.scores.length === 0) continue; // defensive: normalizeScores always scores
    const lanes = catalog.lanes.filter((l) => matchesCatalogModel(slot.rawId, l.modelId));
    scoreOf.set(key, score);
    mapped.push({ rawId: slot.rawId, score, lanes, fromBothSources: slot.scores.length > 1 });
    if (lanes.length === 0) unmappedIds.push(slot.rawId);
  }
  mapped.sort((a, b) => b.score - a.score);
  unmappedIds.sort((a, b) => (scoreOf.get(b.toLowerCase()) ?? 0) - (scoreOf.get(a.toLowerCase()) ?? 0));
  return { mapped, unmappedIds, scoreOf };
}

/** Proposed scores map: bare extracted id + every matching lane key. */
function buildScores(mapped: MappedEntry[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const m of mapped) {
    scores[m.rawId] = Number(m.score.toFixed(4));
    for (const lane of m.lanes) {
      scores[lane.key] = Number(m.score.toFixed(4));
    }
  }
  return scores;
}

// ─── Relay-faithful lookup + diff ────────────────────────────────────────────

/** Mirror of relay.ts leaderboardElo(): hop key first, then bare catalog model id. */
function relayLookup(scores: Record<string, number>, lane: CatalogLane): number | null {
  const byKey = scores[lane.key];
  if (typeof byKey === "number" && byKey >= 0 && byKey <= 1) return byKey;
  const byModel = scores[lane.modelId];
  if (typeof byModel === "number" && byModel >= 0 && byModel <= 1) return byModel;
  return null;
}

function blended(doctrine: number, lb: number | null): number {
  return lb === null ? doctrine : Math.min(1, Math.max(0, 0.5 * doctrine + 0.5 * lb));
}

interface LaneRow {
  lane: CatalogLane;
  lbNew: number | null;
  lbOld: number | null;
  effBefore: number;
  effAfter: number;
  move: number; // >0 climbs, <0 drops; 0 = unchanged position
}

function buildLaneRows(catalog: Catalog, oldScores: Record<string, number>, newScores: Record<string, number>): LaneRow[] {
  const rows: LaneRow[] = catalog.lanes.map((lane) => {
    const lbOld = relayLookup(oldScores, lane);
    const lbNew = relayLookup(newScores, lane);
    return {
      lane,
      lbOld,
      lbNew,
      effBefore: blended(lane.doctrineElo, lbOld),
      effAfter: blended(lane.doctrineElo, lbNew),
      move: 0,
    };
  });
  const pos = (rows: LaneRow[], key: keyof LaneRow): Map<string, number> => {
    const sorted = [...rows].sort((a, b) => (b[key] as number) - (a[key] as number) || a.lane.key.localeCompare(b.lane.key));
    return new Map(sorted.map((r, i) => [r.lane.key, i]));
  };
  const before = pos(rows, "effBefore");
  const after = pos(rows, "effAfter");
  for (const r of rows) r.move = (before.get(r.lane.key) ?? 0) - (after.get(r.lane.key) ?? 0);
  // Review order: movers first (biggest climb), then the rest by new rank.
  rows.sort((a, b) => b.move - a.move || b.effAfter - a.effAfter);
  return rows;
}

function arrow(move: number): string {
  if (move > 0) return `↑${move}`;
  if (move < 0) return `↓${Math.abs(move)}`;
  return "=";
}

// ─── Reporting ───────────────────────────────────────────────────────────────

function printSourceReport(src: SourceExtraction, catalog: Catalog): void {
  hr();
  console.log(`SOURCE ${src.url}`);
  if (!src.fetched) {
    console.log(`  ✗ FETCH FAILED (both strategies) — ${src.error}`);
    console.log("  Honest status: no data extracted from this source. It is NOT simulated.");
    return;
  }
  console.log(`  ✓ fetched via ${src.strategy}${src.title ? ` — “${src.title}”` : ""}`);
  if (src.entries.length === 0) {
    console.log(`  ✗ extraction: ${src.error}`);
    return;
  }
  console.log(`  extraction method: ${src.method}${src.jsonPath ? ` (${src.jsonPath})` : ""} · scale: ${src.scale} · entries: ${src.entries.length} (cap ${MAX_ENTRIES_PER_SOURCE})`);
  const shown = src.entries.slice(0, 8);
  for (const e of shown) {
    const lanes = catalog.lanes.filter((l) => matchesCatalogModel(e.id, l.modelId)).map((l) => l.key);
    console.log(`    ${String(e.rank ?? "·").padStart(3)}  ${e.id.padEnd(40)} ${typeof e.elo === "number" ? e.elo.toFixed(3) : "  ·  "}  → ${lanes.length > 0 ? lanes.join(", ") : "(unmapped — bare key only)"}`);
  }
  if (src.entries.length > shown.length) console.log(`    … ${src.entries.length - shown.length} more`);
}

function printDiff(rows: LaneRow[], catalog: Catalog, mapped: MappedEntry[], unmappedIds: string[]): void {
  hr();
  console.log("REVIEW DIFF — catalog lanes (doctrine Elo ← 50/50 → proposed leaderboard snapshot)");
  console.log("  move: position change of the lane in the effective order if this snapshot is applied");
  console.log("  (mirrors relay.ts effectiveElo: 0.5*doctrine + 0.5*leaderboard; — = lane unscored, doctrine stands)");
  const width = Math.min(52, Math.max(...rows.map((r) => r.lane.key.length)) + 1);
  console.log(`  ${"lane".padEnd(width)}  doctrine    lb      blend   move`);
  for (const r of rows) {
    const lbTxt = r.lbNew === null ? "—" : r.lbNew.toFixed(3);
    const changed = Math.abs(r.effAfter - r.effBefore) > 1e-9;
    const mark = r.lbNew !== null ? (changed ? "*" : "·") : " ";
    console.log(
      `  ${r.lane.key.padEnd(width)}  ${r.lane.doctrineElo.toFixed(3)}     ${lbTxt.padEnd(7)} ${r.effAfter.toFixed(3)}   ${arrow(r.move).padEnd(4)}${mark}`,
    );
  }
  const scoredLanes = rows.filter((r) => r.lbNew !== null);
  const remapped = rows.filter((r) => Math.abs(r.effAfter - r.effBefore) > 1e-9);
  const climbers = rows.filter((r) => r.move > 0);
  const droppers = rows.filter((r) => r.move < 0);
  console.log("");
  console.log(`  lanes: ${rows.length} total · ${scoredLanes.length} scored by snapshot · ${remapped.length} effectively remapped (${climbers.length} climb, ${droppers.length} drop, ${rows.length - climbers.length - droppers.length} hold position)`);
  const multiLane = mapped.filter((m) => m.lanes.length > 1);
  console.log(`  leaderboard entries: ${mapped.length} extracted+scored · ${mapped.length - unmappedIds.length} mapped to ≥1 catalog lane · ${unmappedIds.length} unmapped (kept as bare model-id keys) · ${multiLane.length} ids hit multiple lanes`);
  if (unmappedIds.length > 0) {
    const shown = unmappedIds.slice(0, 12);
    console.log(`  unmapped (top of list): ${shown.join(", ")}${unmappedIds.length > shown.length ? ` … +${unmappedIds.length - shown.length} more` : ""}`);
  }
  console.log(`  catalog parsed from ${path.relative(ROOT, RELAY_TS)} — ${Object.keys(catalog.providers).length} providers, ${catalog.lanes.length} lanes (no mirrored copy to drift)`);
}

function proposeNote(
  perSource: SourceExtraction[],
  rows: LaneRow[],
  mapped: MappedEntry[],
  unmappedCount: number,
): string {
  const srcBits = perSource.map((s) => {
    if (!s.fetched) return `${new URL(s.url).host}=FETCH FAILED (${s.error})`;
    if (s.entries.length === 0) return `${new URL(s.url).host}=fetched via ${s.strategy} but nothing extractable`;
    return `${new URL(s.url).host}=${s.strategy}/${s.method}/${s.scale}/${s.entries.length} ids`;
  });
  const scored = rows.filter((r) => r.lbNew !== null).length;
  const remapped = rows.filter((r) => Math.abs(r.effAfter - r.effBefore) > 1e-9).length;
  const top = mapped.slice(0, 3).map((m) => m.rawId).join(", ") || "none";
  const displayCount = perSource.reduce((n, s) => n + s.entries.filter((e) => e.display === true).length, 0);
  const displayBit = displayCount > 0 ? ` ${displayCount} ids came from display names squeezed to id-form (lower confidence, flagged).` : "";
  return (
    `Snapshot from arena.ai + artificialanalysis.ai — ${scored} lanes scored, ${remapped} catalog lanes remapped; ` +
    `top: ${top}. Extraction: ${srcBits.join("; ")}.${displayBit} ` +
    `${mapped.filter((m) => m.fromBothSources).length} ids ranked by both sources (averaged); ${unmappedCount} unmapped ids kept as bare model-id keys. ` +
    `Scores are 0–1 Elo-style, human-reviewed before apply — never auto-pushed.`
  );
}

// ─── Apply (the ONLY place that writes) ──────────────────────────────────────

async function applySnapshot(
  proposed: LeaderboardFile,
  oldScores: Record<string, number>,
): Promise<void> {
  const existingRaw = await readFile(LEADERBOARD_JSON, "utf8");
  let existing: LeaderboardFile;
  try {
    existing = JSON.parse(existingRaw) as LeaderboardFile;
  } catch (err) {
    throw new Error(`existing ${path.relative(ROOT, LEADERBOARD_JSON)} is not valid JSON (${errMsg(err)}) — refusing to overwrite a file the changelog cannot merge with`);
  }

  // Print exactly what changed, key by key.
  const oldKeys = new Set(Object.keys(oldScores));
  const newKeys = new Set(Object.keys(proposed.scores));
  const added = [...newKeys].filter((k) => !oldKeys.has(k));
  const removed = [...oldKeys].filter((k) => !newKeys.has(k));
  const changed = [...newKeys].filter((k) => oldKeys.has(k) && Math.abs(oldScores[k] - proposed.scores[k]) > 1e-9);
  const unchanged = [...newKeys].filter((k) => oldKeys.has(k) && Math.abs(oldScores[k] - proposed.scores[k]) <= 1e-9);

  console.log("");
  hr();
  console.log("APPLY — exact changes to src/config/leaderboard.json");
  console.log(`  + ${added.length} score keys added`);
  for (const k of added) console.log(`      ${k} = ${proposed.scores[k]}`);
  console.log(`  ~ ${changed.length} score keys changed`);
  for (const k of changed) console.log(`      ${k}: ${oldScores[k]} → ${proposed.scores[k]}`);
  console.log(`  = ${unchanged.length} score keys unchanged`);
  console.log(`  - ${removed.length} score keys removed (snapshot replaces, stale keys are not merged)`);
  for (const k of removed) console.log(`      ${k} (was ${oldScores[k]})`);

  const changelogEntry = proposed.changelog[proposed.changelog.length - 1];
  console.log(`  changelog +1 entry: { date: "${changelogEntry?.date}", note: "${changelogEntry?.note.slice(0, 110)}…" }`);

  // Atomic write: tmp file in the same directory, then rename over the target.
  const json = `${JSON.stringify(proposed, null, 2)}\n`;
  const tmp = `${LEADERBOARD_JSON}.tmp`;
  await writeFile(tmp, json, "utf8");
  await rename(tmp, LEADERBOARD_JSON);
  console.log(`  wrote ${path.relative(ROOT, LEADERBOARD_JSON)} (${Buffer.byteLength(json)} bytes, existing changelog entries preserved: ${existing.changelog?.length ?? 0})`);
  hr();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`fetch-leaderboard.ts — ${apply ? "APPLY MODE (will write after this report)" : "DRY-RUN (writes nothing)"}`);
  console.log(`sources: ${SOURCE_URLS.join("  +  ")}`);

  // Catalog first: without the doctrine table there is nothing to diff against.
  const relaySource = await readFile(RELAY_TS, "utf8");
  const catalog = parseArenaCatalog(relaySource);
  console.log(`catalog: ${catalog.lanes.length} lanes across ${Object.keys(catalog.providers).length} providers (parsed from relay.ts ARENA_CATALOG)`);

  // Fetch both sources, honestly.
  const perSource: SourceExtraction[] = [];
  const fetchReport: { url: string; attempts: SourceFetch[]; ok: boolean }[] = [];
  for (const url of SOURCE_URLS) {
    console.log(`\nfetching ${url} …`);
    const { fetches, result } = await fetchSource(url);
    fetchReport.push({ url, attempts: fetches, ok: result !== null });
    perSource.push(extractFromSource(url, result));
  }
  const fetchedCount = fetchReport.filter((f) => f.ok).length;
  console.log("");
  console.log(`fetch outcome: ${fetchedCount}/${SOURCE_URLS.length} sources reached (${fetchReport.map((f) => `${new URL(f.url).host}: ${f.ok ? "OK" : "FAILED"}`).join(", ")})`);

  // BOTH sources dead → clear failure, exit 1, config untouched.
  if (fetchedCount === 0) {
    console.error("\n✗ BOTH sources failed to fetch. NO snapshot can be prepared and the config file was NOT touched.");
    console.error("  (Bot walls on these pages are a known, acceptable outcome — re-run later or use a different network path.)");
    process.exit(1);
  }

  for (const src of perSource) printSourceReport(src, catalog);

  // Merge + map + propose.
  const { mapped, unmappedIds } = mapEntries(perSource, catalog);
  if (mapped.length === 0) {
    console.error("\n✗ The reachable source(s) yielded ZERO extractable model entries. Refusing to write an evidence-free snapshot. Config untouched.");
    process.exit(1);
  }
  const newScores = buildScores(mapped);
  const oldFile = JSON.parse(await readFile(LEADERBOARD_JSON, "utf8")) as LeaderboardFile;
  const oldScores = oldFile.scores ?? {};
  const rows = buildLaneRows(catalog, oldScores, newScores);

  printDiff(rows, catalog, mapped, unmappedIds);

  const note = proposeNote(perSource, rows, mapped, unmappedIds.length);
  const today = new Date().toISOString().slice(0, 10); // UTC date
  const scoredLaneCount = rows.filter((r) => r.lbNew !== null).length;
  const remappedCount = rows.filter((r) => Math.abs(r.effAfter - r.effBefore) > 1e-9).length;
  const topThree = mapped.slice(0, 3).map((m) => m.rawId).join(", ") || "none";
  const changelogEntry = {
    date: today,
    note: `Snapshot from arena.ai + artificialanalysis.ai — ${scoredLaneCount} lanes scored, ${remappedCount} catalog lanes remapped; top: ${topThree}`,
  };
  const proposed: LeaderboardFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sources: [...SOURCE_URLS],
    note,
    scores: newScores,
    changelog: [...(oldFile.changelog ?? []), changelogEntry],
  };

  console.log("");
  hr();
  console.log("PROPOSED FILE (only written by --apply):");
  console.log(`  version: ${proposed.version} · updatedAt: ${proposed.updatedAt} · scores: ${Object.keys(proposed.scores).length} keys (${scoredLaneCount} lane keys + ${Object.keys(proposed.scores).length - scoredLaneCount} bare ids)`);
  console.log(`  note: ${note}`);
  console.log(`  changelog entry appended at end: ${JSON.stringify(changelogEntry)}`);

  if (apply) {
    await applySnapshot(proposed, oldScores);
    console.log("DONE. The snapshot is live for the relay's 50/50 blend — commit it as the reviewed change.");
  } else {
    console.log("");
    console.log("DRY-RUN COMPLETE — nothing was written. Review the diff above, then run `bun scripts/fetch-leaderboard.ts --apply` if it is honest.");
  }
}

main().catch((err: unknown) => {
  console.error(`\n✗ fetch-leaderboard failed: ${errMsg(err)}`);
  console.error("  The config file was NOT touched.");
  process.exit(1);
});
