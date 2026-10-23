// ============================================================================
// NEXUS CORTEX HARNESS — Supabase Edge Function (Deno) · v2.0
// ============================================================================
// The harness's free intelligence substrate: one Deno edge function that
// stitches Hyperbrowser (deep web), Upstash (Redis · Vector · QStash · Box)
// and BYOK LLMs into AGENT capabilities — memory, durable jobs, sandbox,
// rate protection. "As free as possible, as smart as possible." Built for
// agentic-harness calls (tools/memory/jobs/sandbox), NOT a chat widget.
//
// ACTION CATALOG (POST {action, params, keys?}):
//   scrape / search / crawl      — Hyperbrowser deep-web lanes (L2-cached,
//                                  rate-metered; scrape accepts
//                                  autoRemember:true → a FREE rubric judge
//                                  may distill the page into vector memory)
//   llm                          — hedged BYOK chat (kickbot v29 race
//                                  pattern); cache:true adds an exact Redis
//                                  cache (6h) + a DENSE cosine semantic cache
//                                  (score ≥ 0.93 → cached reply, never dials)
//   memory.put|query|delete      — Upstash Vector semantic memory with FREE
//                                  hosted auto-embeddings (hybrid
//                                  text-embedding-3-small/BM25 index;
//                                  queryMode:"DENSE" → 0–1 cosine scores)
//   job.enqueue|result|schedule  — QStash durable async: breaks the ~26s
//                                  client/edge wall-clock; the outcome is
//                                  parked in Redis for 1h and polled via
//                                  job.result. (job.execute + job.complete
//                                  are internal — invoked BY QStash only.)
//   sandbox.exec|info            — Upstash Box micro-VM shell lane
//                                  (CPU-hour frugal)
//   lock.acquire|release         — Redis SET NX PX distributed lock
//                                  (schedule/pipeline dedupe)
//   diagnostics                  — presence-only secret map + daily/hourly
//                                  rate snapshot + vector index info
//
// FREE-TIER RATIONALE: Upstash free tiers + Supabase Edge = $0 intelligence
// substrate. Redis ≈500K cmds/mo → tiny INCR/GET/SETEX commands only.
// Vector 10K query+upsert ops/day COMBINED → the rubric judge gates
// auto-memory and the LLM semantic cache is strictly opt-in (cache:true) so
// we never burn vector ops on junk. QStash 1000 msgs/day → long jobs only.
// Box 5 CPU-h/mo → capped exec lane. Every metered reply carries
// telemetry.rate = {count, cap} for frugal UI meters.
//
// AUTH MODEL (deliberate, no-JWT): verify_jwt = false. The public
// publishable/anon key is NOT a credential, so a caller-chosen shared secret
// is used instead: when the Supabase secret CORTEX_SHARED_SECRET is present,
// every POST must carry a matching `x-nexus-cortex-key` header. QStash
// forwards that key on deliveries and callbacks via Upstash-Forward- /
// Upstash-Callback-Forward- headers, so scheduled/async jobs pass the same
// gate. GET health stays open for probes. There is deliberately NO QStash
// signature verification: the shared-secret gate already protects the
// endpoint (a forged callback without the key is 401'd when the gate is on).
//
// SECURITY NOTE (deliberate): Upstash Redis is NOT BYOK. It holds shared
// state — cache, rate counters, locks, job parking. A caller-supplied Redis
// URL would let any caller poison the cache, reset rate limits, or fake job
// results, so Redis is always resolved from EDGE SECRETS ONLY. Vector /
// QStash / Box / Hyperbrowser ARE BYOK-able per request (body.keys) because
// they are per-caller resources. Keys are NEVER logged, NEVER echoed.
//
// SUPABASE-SET ENV (never sent from the client):
//   HYPERBROWSER_API_KEY            — enables scrape/search/crawl lanes
//   CORTEX_SHARED_SECRET            — enables the shared-secret gate
//   UPSTASH_REDIS_REST_URL/_TOKEN   — L2 cache · rate limits · locks · jobs
//   UPSTASH_VECTOR_REST_URL/_TOKEN  — semantic memory · LLM semantic cache
//   QSTASH_TOKEN (+ QSTASH_URL)     — durable async jobs + schedules
//   BOX_API_KEY + BOX_ID (+ BOX_REGION) — sandbox lane
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase
//
// CLIENT-BYOK (per-request, edge-secret-first then body key — NEVER logged):
//   body.keys = { hyperbrowserKey?, vectorUrl?, vectorToken?, qstashToken?,
//                 boxApiKey?, boxId? }
// ============================================================================

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types + constants
// ---------------------------------------------------------------------------
type ByokKeys = {
  hyperbrowserKey?: string;
  vectorUrl?: string;
  vectorToken?: string;
  qstashToken?: string;
  boxApiKey?: string;
  boxId?: string;
};

type RateInfo = { limited?: false; note?: string; count?: number; cap?: number; blocked?: boolean };

type MemorizedInfo = { judged: boolean; passed: boolean; id?: string; note?: string };

type VectorCfg = { url: string; tok: string };
type RedisCfg = { url: string; tok: string };
type QStashCfg = { tok: string; base: string };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-nexus-cortex-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Hourly fixed-window caps per action (Redis bucket nexus:cortex:rate:{action}:{YYYYMMDDHH}).
// lock/jobs share the 60/h family; job.result is deliberately unmetered so polling works.
const RATE_CAPS: Record<string, number> = {
  scrape: 60,
  search: 90,
  crawl: 20,
  llm: 120,
  "memory.put": 200,
  "memory.query": 300,
  "sandbox.exec": 40,
  "lock.acquire": 60,
  "lock.release": 60,
  "job.enqueue": 60,
  "job.schedule": 60,
};

const L2_TTL_SECONDS = 1800; // scrape/search L2 cache (30 min)
const LLM_CACHE_TTL_SECONDS = 21600; // llm exact cache (6h)
const JOB_PARK_TTL_SECONDS = 3600; // parked job outcomes (1h)
const SCHED_SUMMARY_TTL_SECONDS = 604800; // schedule summary (7d)
const LLM_SEMANTIC_THRESHOLD = 0.93; // DENSE cosine score at which we reuse a cached reply
const MEMORY_AUTO_THRESHOLD = 0.5; // default memory.query cosine threshold

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// v1 BUG FIX: the old `clip` returned "" for any string SHORTER than n (which
// erased short markdown/errors). v2 clips only when actually longer.
const clip = (s: unknown, n: number): string => {
  const t = typeof s === "string" ? s : s == null ? "" : String(s);
  return t.length > n ? t.slice(0, n) : t;
};

const errSlice = (e: unknown) => clip(e instanceof Error ? e.message : String(e), 180);

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const sha16 = async (s: string) => (await sha256Hex(s)).slice(0, 16);

function randomHex(nBytes: number): string {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctl.signal }).finally(() => clearTimeout(t));
}

// UTC hour/day buckets for rate windows: YYYYMMDDHH / YYYYMMDD
const hourBucket = () => new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 10);
const dayBucket = () => new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 8);

// Fire-and-forget that survives the reply (never blocks, never throws).
function bgForget(p: Promise<unknown>): void {
  // @ts-ignore — EdgeRuntime is globally available on Supabase Edge Functions.
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    // @ts-ignore
    EdgeRuntime.waitUntil(p.catch(() => {}));
  } else {
    p.catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Upstash Redis REST (edge-secret-only — see SECURITY NOTE in the header).
// Single commands: POST {url} with a JSON array body, numbers unquoted
// (["SETEX","k",3600,"v"]). Pipelines: POST {url}/pipeline with a 2-D array.
// Envelope: {"result":...} / {"error":"..."}.
// ---------------------------------------------------------------------------
function redisCfg(): RedisCfg | null {
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const tok = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  return url && tok ? { url, tok } : null;
}

async function redisCmd(rc: RedisCfg, cmd: unknown[], timeoutMs = 2500): Promise<unknown> {
  const r = await timedFetch(rc.url, {
    method: "POST",
    headers: { authorization: `Bearer ${rc.tok}`, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  }, timeoutMs);
  const j = await r.json().catch(() => null);
  if (isObj(j) && "error" in j) throw new Error(clip(String(j.error), 160));
  return isObj(j) ? j.result : undefined;
}

async function redisPipeline(
  rc: RedisCfg,
  cmds: unknown[][],
  timeoutMs = 2500,
): Promise<Array<{ result?: unknown; error?: string }>> {
  const r = await timedFetch(`${rc.url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${rc.tok}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  }, timeoutMs);
  const j = await r.json().catch(() => null);
  return Array.isArray(j) ? j as Array<{ result?: unknown; error?: string }> : [];
}

// ---------------------------------------------------------------------------
// L2 cache — Upstash Redis first (true SETEX), Postgres table fallback.
// Values are wrapped {at, payload}. Never throws; best-effort only.
// ---------------------------------------------------------------------------
async function cacheGet(
  db: SupabaseClient | null,
  key: string,
  maxAgeSeconds: number,
): Promise<unknown | null> {
  const rc = redisCfg();
  if (rc) {
    try {
      const r = await timedFetch(
        `${rc.url}/get/${encodeURIComponent(key)}`,
        { headers: { authorization: `Bearer ${rc.tok}` } },
        2500,
      );
      const j = await r.json();
      if (typeof j?.result === "string") {
        const wrapped = JSON.parse(j.result) as { at: number; payload: unknown };
        if (Date.now() - wrapped.at <= maxAgeSeconds * 1000) return wrapped.payload;
      }
    } catch { /* fall through to postgres */ }
  }
  if (db) {
    try {
      const { data } = await db
        .from("nexus_cortex_cache")
        .select("payload, created_at")
        .eq("key", key)
        .maybeSingle();
      if (data?.payload) {
        const at = new Date(data.created_at as string).getTime();
        if (Date.now() - at <= maxAgeSeconds * 1000) return data.payload;
      }
    } catch { /* cache is best-effort */ }
  }
  return null;
}

// v2 FIX: v1 posted {value, ex} JSON to /set/{key} — a shape that does NOT
// exist on raw Redis REST (the whole JSON became the value with NO expiry).
// v2 uses the array-body form ["SETEX","key",ttl,"json"] (POST to Redis root).
async function cachePut(
  db: SupabaseClient | null,
  key: string,
  payload: unknown,
  ttlSeconds: number,
): Promise<void> {
  const wrapped = { at: Date.now(), payload };
  const rc = redisCfg();
  if (rc) {
    try {
      await redisCmd(rc, ["SETEX", key, ttlSeconds, JSON.stringify(wrapped)]);
    } catch { /* best-effort */ }
  }
  if (db) {
    try {
      await db.from("nexus_cortex_cache").upsert(
        {
          key,
          payload: wrapped.payload,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        },
        { onConflict: "key" },
      );
    } catch { /* best-effort */ }
  }
}

// ---------------------------------------------------------------------------
// Rate limiting — Redis hourly fixed window, ONE /pipeline call per gate.
// INCR + EXPIRE 3660 (window outlives the hour boundary). Fail-open: a Redis
// hiccup never blocks a lane. Over cap → caller returns a 429-style reply.
// Also best-effort bumps the global daily counter (reported in diagnostics).
// ---------------------------------------------------------------------------
async function rateGate(action: string): Promise<RateInfo> {
  const rc = redisCfg();
  const cap = RATE_CAPS[action];
  if (!rc || cap == null) return { limited: false };
  const key = `nexus:cortex:rate:${action}:${hourBucket()}`;
  try {
    const pipe = await redisPipeline(rc, [["INCR", key], ["EXPIRE", key, 3660]]);
    const count = Number(pipe[0]?.result ?? 0);
    const dayKey = `nexus:cortex:day:${dayBucket()}`;
    bgForget(redisPipeline(rc, [["INCR", dayKey], ["EXPIRE", dayKey, 90000]]));
    if (count > cap) return { blocked: true, count, cap };
    return { count, cap };
  } catch {
    return { limited: false, note: "rate check failed — fail-open" };
  }
}

// ---------------------------------------------------------------------------
// Upstash Vector REST — free hosted auto-embeddings (NO embedding API).
// The index must be Upstash-hosted-model (hybrid text-embedding-3-small/BM25,
// 1536-dim). queryMode:"DENSE" is ALWAYS sent for threshold-able queries:
// on hybrid indexes default scores are rank-only (RRF); DENSE yields
// normalized cosine 0–1 from the dense half. Envelope {result}/{error}.
// ---------------------------------------------------------------------------
function vectorCfg(keys: ByokKeys): VectorCfg | null {
  const url = Deno.env.get("UPSTASH_VECTOR_REST_URL") || keys.vectorUrl || "";
  const tok = Deno.env.get("UPSTASH_VECTOR_REST_TOKEN") || keys.vectorToken || "";
  return url && tok ? { url, tok } : null;
}

async function vectorUpsert(
  v: VectorCfg,
  rec: { id: string; data: string; metadata: Record<string, unknown> },
): Promise<void> {
  const r = await timedFetch(`${v.url}/upsert-data`, {
    method: "POST",
    headers: { authorization: `Bearer ${v.tok}`, "content-type": "application/json" },
    body: JSON.stringify(rec),
  }, 3000);
  const j = await r.json().catch(() => null);
  if (!r.ok || (isObj(j) && "error" in j)) {
    throw new Error(`vector upsert HTTP ${r.status}: ${clip(isObj(j) ? j.error : "", 160)}`);
  }
}

async function vectorQuery(
  v: VectorCfg,
  p: { data: string; topK: number },
): Promise<Array<{ id?: string; score?: number; data?: string; metadata?: Record<string, unknown> }>> {
  const r = await timedFetch(`${v.url}/query-data`, {
    method: "POST",
    headers: { authorization: `Bearer ${v.tok}`, "content-type": "application/json" },
    body: JSON.stringify({
      data: p.data,
      topK: p.topK,
      includeMetadata: true,
      includeData: true,
      queryMode: "DENSE",
    }),
  }, 3000);
  const j = await r.json().catch(() => null);
  if (!r.ok || (isObj(j) && "error" in j)) {
    throw new Error(`vector query HTTP ${r.status}: ${clip(isObj(j) ? j.error : "", 160)}`);
  }
  return isObj(j) && Array.isArray(j.result) ? j.result : [];
}

async function vectorDeleteIds(v: VectorCfg, ids: string[]): Promise<number> {
  const r = await timedFetch(`${v.url}/delete`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${v.tok}`, "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  }, 3000);
  const j = await r.json().catch(() => null);
  if (!r.ok || (isObj(j) && "error" in j)) {
    throw new Error(`vector delete HTTP ${r.status}: ${clip(isObj(j) ? j.error : "", 160)}`);
  }
  const del = isObj(j) && isObj(j.result) ? Number((j.result as { deleted?: unknown }).deleted) : 0;
  return Number.isFinite(del) ? del : 0;
}

// ---------------------------------------------------------------------------
// QStash REST — durable async jobs + schedules. Bare responses (no envelope).
// Destination URL is appended RAW WITH PROTOCOL (no encodeURIComponent).
// ALL options travel as Upstash-* headers. Callback envelope carries the
// original response base64-encoded in `body` + sourceMessageId.
// ---------------------------------------------------------------------------
function qstashCfg(keys: ByokKeys): QStashCfg | null {
  const tok = Deno.env.get("QSTASH_TOKEN") || keys.qstashToken || "";
  const base = (Deno.env.get("QSTASH_URL") || "https://qstash.upstash.io").replace(/\/+$/, "");
  return tok ? { tok, base } : null;
}

function edgePublicUrl(): string {
  const supa = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  return `${supa}/functions/v1/nexus-cortex-harness`;
}

// Publish/schedule headers. When the shared secret exists we forward it to
// the destination AND to the callback so async jobs pass the same gate.
function qstashHeaders(q: QStashCfg, opts: { delaySeconds?: number } = {}): Record<string, string> {
  const h: Record<string, string> = {
    authorization: `Bearer ${q.tok}`,
    "content-type": "application/json",
    "Upstash-Method": "POST",
    "Upstash-Retries": "2",
  };
  const shared = Deno.env.get("CORTEX_SHARED_SECRET");
  if (shared) {
    h["Upstash-Forward-x-nexus-cortex-key"] = shared;
    h["Upstash-Callback"] = edgePublicUrl();
    h["Upstash-Callback-Method"] = "POST";
    h["Upstash-Callback-Forward-x-nexus-cortex-key"] = shared;
  }
  if (opts.delaySeconds && opts.delaySeconds > 0) {
    h["Upstash-Delay"] = `${Math.min(Math.floor(opts.delaySeconds), 604800)}s`;
  }
  return h;
}

// Scheduled fires park under nexus:cortex:job:{sched_name_ts}; this rolls the
// lastFiredAt into the nexus:cortex:sched:{name} summary (best-effort).
async function touchSchedSummary(rc: RedisCfg, jobId: string): Promise<void> {
  const rest = jobId.slice("sched_".length);
  const cut = rest.lastIndexOf("_");
  const name = cut > 0 ? rest.slice(0, cut) : rest;
  if (!name) return;
  try {
    let summary: Record<string, unknown> = { name };
    const raw = await redisCmd(rc, ["GET", `nexus:cortex:sched:${name}`]);
    if (typeof raw === "string") {
      try { summary = JSON.parse(raw) as Record<string, unknown>; } catch { /* overwrite */ }
    }
    summary.lastFiredAt = new Date().toISOString();
    await redisCmd(rc, [
      "SETEX", `nexus:cortex:sched:${name}`, SCHED_SUMMARY_TTL_SECONDS, JSON.stringify(summary),
    ]);
  } catch { /* best-effort */ }
}

// ---------------------------------------------------------------------------
// FREE rubric judge for auto-remember (no LLM, no vector ops spent deciding).
// Rationale: don't burn the 10K/day vector budget on junk — the rubric gate
// mirrors the frontier judge cascade (cheap deterministic filter first).
// ---------------------------------------------------------------------------
function judgeForMemory(md: string): { passed: boolean; note: string } {
  const lengthOk = md.length >= 1200;
  let signals = 0;
  if (/(^|\n)\s{0,3}#{1,6}\s+\S/.test(md)) signals++; // headings #/##
  if (/\n- \S/.test(md)) signals++; // list items "\n- "
  if (md.includes("|")) signals++; // tables
  if (md.includes("```")) signals++; // code fences
  const links = (md.match(/\]\(https?:\/\/[^)\s]*/g) ?? []).length;
  const words = (md.match(/\S+/g) ?? []).length || 1;
  const ratio = links / words; // nav-boilerplate pages are link-dominated
  const passed = lengthOk && signals >= 2 && ratio < 0.5;
  return {
    passed,
    note: passed
      ? "rubric passed"
      : `rubric: len>=1200:${lengthOk} structureSignals:${signals}/2 linksPerWord:${ratio.toFixed(2)}<0.5`,
  };
}

// ---------------------------------------------------------------------------
// Hyperbrowser Web API lanes (v1 behavior unchanged)
// ---------------------------------------------------------------------------
function hbKey(explicit?: string): string {
  return explicit || Deno.env.get("HYPERBROWSER_API_KEY") || "";
}

async function hbFetch(
  key: string,
  p: { url: string; formats?: string[]; excludeSelectors?: string[]; maxChars?: number },
): Promise<unknown> {
  const r = await timedFetch(
    "https://api.hyperbrowser.ai/api/web/fetch",
    {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        url: p.url,
        stealth: "auto",
        outputs: {
          formats: p.formats?.length ? p.formats : ["markdown", "links"],
          sanitize: "basic",
          ...(p.excludeSelectors?.length ? { excludeSelectors: p.excludeSelectors } : {}),
        },
        navigation: { waitUntil: "domcontentloaded", waitFor: 1200, timeoutMs: 20000 },
        cache: { maxAgeSeconds: 1800 },
      }),
    },
    25000,
  );
  if (!r.ok) throw new Error(`hyperbrowser fetch HTTP ${r.status}: ${clip(await r.text(), 160)}`);
  const j = await r.json();
  const data = j?.data ?? {};
  if (typeof data.markdown === "string") data.markdown = clip(data.markdown, p.maxChars ?? 6000);
  if (Array.isArray(data.links)) data.links = data.links.slice(0, 40);
  return { metadata: data.metadata ?? {}, markdown: data.markdown ?? "", links: data.links ?? [] };
}

async function hbSearch(
  key: string,
  p: {
    query: string;
    site?: string;
    filetype?: string;
    excludeTerms?: string[];
    boostTerms?: string[];
    maxAgeSeconds?: number;
  },
): Promise<unknown> {
  const filters: Record<string, unknown> = {};
  if (p.site) filters.site = p.site;
  if (p.filetype) filters.filetype = p.filetype;
  if (p.excludeTerms?.length) filters.excludeTerms = p.excludeTerms;
  if (p.boostTerms?.length) filters.boostTerms = p.boostTerms;
  const r = await timedFetch(
    "https://api.hyperbrowser.ai/api/web/search",
    {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        query: clip(p.query, 500),
        ...(Object.keys(filters).length ? { filters } : {}),
        ...(p.maxAgeSeconds != null ? { maxAgeSeconds: p.maxAgeSeconds } : {}),
      }),
    },
    20000,
  );
  if (!r.ok) throw new Error(`hyperbrowser search HTTP ${r.status}: ${clip(await r.text(), 160)}`);
  const j = await r.json();
  const results = Array.isArray(j?.data?.results) ? j.data.results.slice(0, 12) : [];
  return { query: p.query, results };
}

async function hbCrawl(
  key: string,
  p: {
    url: string;
    maxPages?: number;
    includePatterns?: string[];
    excludePatterns?: string[];
    maxCharsPerPage?: number;
  },
): Promise<unknown> {
  const maxPages = Math.min(Math.max(p.maxPages ?? 6, 1), 20);
  const start = await timedFetch(
    "https://api.hyperbrowser.ai/api/web/crawl",
    {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        url: p.url,
        crawlOptions: {
          maxPages,
          followLinks: true,
          ...(p.includePatterns?.length ? { includePatterns: p.includePatterns } : {}),
          ...(p.excludePatterns?.length ? { excludePatterns: p.excludePatterns } : {}),
        },
      }),
    },
    15000,
  );
  if (!start.ok) throw new Error(`hyperbrowser crawl HTTP ${start.status}: ${clip(await start.text(), 160)}`);
  const { jobId } = await start.json();
  if (!jobId) throw new Error("hyperbrowser crawl: no jobId");

  const deadline = Date.now() + 24000;
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 2000));
    const poll = await timedFetch(
      `https://api.hyperbrowser.ai/api/web/crawl/${jobId}`,
      { headers: { "x-api-key": key } },
      10000,
    );
    if (!poll.ok) continue;
    const j = await poll.json();
    if (j?.status === "completed" || j?.status === "failed" || Array.isArray(j?.data)) {
      const pages = Array.isArray(j?.data) ? j.data : [];
      return {
        status: j?.status ?? "unknown",
        totalPages: j?.totalPages ?? pages.length,
        pages: pages.slice(0, maxPages).map((pg: Record<string, unknown>) => ({
          url: pg?.url,
          title: pg?.metadata?.title,
          markdown: clip(typeof pg?.markdown === "string" ? pg.markdown : "", p.maxCharsPerPage ?? 2200),
        })),
      };
    }
  }
  return { status: "timeout", totalPages: 0, pages: [], note: "poll window elapsed — job may still complete" };
}

// ---------------------------------------------------------------------------
// Hedged BYOK LLM lane (kickbot v29 race pattern: primary ↔ hedge)
// ---------------------------------------------------------------------------
type LlmParams = {
  messages: Array<{ role?: string; content?: unknown }>;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  hedge?: { baseUrl: string; apiKey: string; model: string };
  cache?: boolean;
};

async function chatOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: unknown[],
  temperature: number | undefined,
  maxTokens: number | undefined,
  timeoutMs: number,
): Promise<{ content: string; modelLabel: string }> {
  const r = await timedFetch(
    `${baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        ...(temperature != null ? { temperature } : {}),
        ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
      }),
    },
    timeoutMs,
  );
  if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${clip(await r.text(), 160)}`);
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("LLM: empty content");
  return { content, modelLabel: model };
}

async function hedgedLlm(
  p: LlmParams,
): Promise<{ content: string; modelLabel: string; hedged: boolean }> {
  const shieldMs = 6500;
  try {
    return {
      ...(await chatOnce(p.baseUrl, p.apiKey, p.model, p.messages, p.temperature, p.maxTokens, shieldMs)),
      hedged: false,
    };
  } catch (primaryErr) {
    if (!p.hedge?.baseUrl || !p.hedge?.apiKey || !p.hedge?.model) throw primaryErr;
    return {
      ...(await chatOnce(p.hedge.baseUrl, p.hedge.apiKey, p.hedge.model, p.messages, p.temperature, p.maxTokens, 25000)),
      hedged: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Shared web-lane dispatch — used by direct calls AND by QStash job.execute
// (inner actions consume their own caps — that's correct).
// ---------------------------------------------------------------------------
async function runWebLane(
  action: "scrape" | "search" | "crawl",
  params: Record<string, unknown>,
  keys: ByokKeys,
  db: SupabaseClient | null,
): Promise<{ ok: boolean; data?: unknown; error?: string; lane: string; cached?: boolean; rate: RateInfo; memorized?: MemorizedInfo }> {
  const key = hbKey(keys.hyperbrowserKey);
  if (!key) {
    return { ok: false, error: "no Hyperbrowser key at edge or in body.keys", lane: "edge:hyperbrowser", rate: { limited: false } };
  }
  const rate = await rateGate(action);
  if (rate.blocked) {
    return {
      ok: false,
      error: `rate limit exceeded for ${action} (cap ${rate.cap}/hour) — try later`,
      lane: "edge:rate",
      rate,
    };
  }
  const cacheable = action !== "crawl";
  const cacheKey = await sha256Hex(`${action}:${JSON.stringify(params)}`);
  if (cacheable) {
    const hit = await cacheGet(db, cacheKey, L2_TTL_SECONDS);
    if (hit != null) return { ok: true, data: hit, lane: "cache", cached: true, rate };
  }
  const data = action === "scrape"
    ? await hbFetch(key, params as never)
    : action === "search"
      ? await hbSearch(key, params as never)
      : await hbCrawl(key, params as never);
  if (cacheable) bgForget(cachePut(db, cacheKey, data, L2_TTL_SECONDS));

  // Judge-gated auto-remember: only when the caller explicitly opted in.
  // The vector op runs in the background — it can never delay the scrape.
  let memorized: MemorizedInfo | undefined;
  if (action === "scrape" && params.autoRemember === true) {
    const v = vectorCfg(keys);
    const md = typeof (data as { markdown?: unknown })?.markdown === "string"
      ? (data as { markdown: string }).markdown
      : "";
    if (!v) {
      memorized = { judged: false, passed: false, note: "vector not configured — autoRemember skipped" };
    } else {
      const judge = judgeForMemory(md);
      if (!judge.passed) {
        memorized = { judged: true, passed: false, note: judge.note };
      } else {
        const dist = clip(md, 6000);
        const id = `mem_${await sha16(dist)}`; // content-dedupe: same page → same id
        const url = clip(String(params.url ?? ""), 500);
        const title = clip((data as { metadata?: { title?: unknown } })?.metadata?.title ?? "", 300);
        const at = new Date().toISOString();
        bgForget(vectorUpsert(v, { id, data: dist, metadata: { url, title, kind: "scrape", at } }));
        memorized = { judged: true, passed: true, id, note: "storing in background — verify with memory.query" };
      }
    }
  }
  return { ok: true, data, lane: "edge:hyperbrowser", rate, ...(memorized ? { memorized } : {}) };
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const started = Date.now();
  const edgeRegion = Deno.env.get("SB_REGION") ?? "unknown";

  if (req.method === "GET") {
    return json({
      ok: true,
      service: "nexus-cortex-harness-v2",
      engine: "NEXUS harness free intelligence substrate",
      actions: [
        "scrape", "search", "crawl", "llm",
        "memory.put", "memory.query", "memory.delete",
        "job.enqueue", "job.result", "job.schedule",
        "job.execute (internal)", "job.complete (internal)",
        "sandbox.exec", "sandbox.info",
        "lock.acquire", "lock.release", "diagnostics",
      ],
      laneNotes:
        "Hyperbrowser deep web + hedged BYOK LLM w/ semantic cache + Upstash Vector memory + QStash durable jobs + Box sandbox + Redis rates/locks/cache — agentic harness lanes, not a chat widget.",
      edgeRegion,
      timestamp: new Date().toISOString(),
    });
  }
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  // Shared-secret gate (only enforced when the secret exists at the edge).
  // QStash deliveries/callbacks pass because we forward the key via
  // Upstash-Forward- / Upstash-Callback-Forward- headers.
  const shared = Deno.env.get("CORTEX_SHARED_SECRET");
  if (shared && req.headers.get("x-nexus-cortex-key") !== shared) {
    return json({ ok: false, error: "unauthorized — x-nexus-cortex-key mismatch" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const db = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!isObj(body)) throw new Error("not an object");
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }

  // --- Envelope detection ---------------------------------------------------
  // (a) QStash callback envelope (has sourceMessageId; body = base64 of the
  //     original job.execute response) → treat as job.complete. No QStash
  //     signature verification: the shared-secret gate protects the endpoint.
  // (b) job.execute envelope {action:"job.execute", jobId, inner} (or bare
  //     {jobId, inner}) → durable async lane invoked BY QStash.
  let action = String(body.action ?? "");
  let params = isObj(body.params) ? body.params : {};
  let keys = (isObj(body.keys) ? body.keys : {}) as ByokKeys;

  if ("sourceMessageId" in body) {
    action = "job.complete";
    params = body;
  } else if (isObj(body.inner) && (action === "job.execute" || typeof body.jobId === "string")) {
    action = "job.execute";
    params = { jobId: body.jobId ?? "", inner: body.inner };
  }

  const finish = (
    payload: Record<string, unknown>,
    ok: boolean,
    lane: string,
    cached = false,
    extra: Record<string, unknown> = {},
    status = 200,
  ) => {
    const latencyMs = Date.now() - started;
    // Zero-latency telemetry — the reply never waits on the database.
    bgForget((async () => {
      try {
        await db?.from("nexus_cortex_events").insert({
          action,
          ok,
          lane,
          cached,
          latency_ms: latencyMs,
          error: ok ? "" : clip(String(payload.error ?? ""), 180),
          created_at: new Date().toISOString(),
        });
      } catch { /* telemetry is best-effort */ }
    })());
    return json({ ...payload, telemetry: { latencyMs, edgeRegion, cached, ...extra } }, status);
  };

  try {
    if (action === "diagnostics") {
      const rc = redisCfg();
      const v = vectorCfg(keys);
      const secrets = {
        hyperbrowser: !!hbKey(keys.hyperbrowserKey),
        redis: !!rc,
        vector: !!v,
        qstash: !!qstashCfg(keys),
        box: !!(Deno.env.get("BOX_API_KEY") || keys.boxApiKey),
        sharedSecretGate: !!shared,
      };
      let rate: Record<string, unknown> = {
        limited: false,
        note: "no Redis — no rate limiting, L2 cache falls back to Postgres",
      };
      if (rc) {
        try {
          const probes = ["scrape", "search", "crawl", "llm", "memory.put", "memory.query", "sandbox.exec"];
          const hour = hourBucket();
          const pipe = await redisPipeline(rc, [
            ["GET", `nexus:cortex:day:${dayBucket()}`],
            ...probes.map((a) => ["GET", `nexus:cortex:rate:${a}:${hour}`]),
          ]);
          const n = (i: number) => Number(pipe[i]?.result ?? 0);
          const hourCounts: Record<string, number> = {};
          probes.forEach((a, i) => { hourCounts[a] = n(i + 1); });
          rate = {
            day: {
              count: n(0),
              note: "metered harness actions today · Upstash Redis free tier ≈ 500K cmds/month",
            },
            hour: hourCounts,
          };
        } catch (e) {
          rate = { limited: false, note: `redis read failed: ${errSlice(e)}` };
        }
      }
      let vector: Record<string, unknown> | undefined;
      if (v) {
        try {
          // GET /info is eventually consistent — purely informational here.
          const r = await timedFetch(`${v.url}/info`, { headers: { authorization: `Bearer ${v.tok}` } }, 3000);
          const j = await r.json().catch(() => null);
          const info = isObj(j) && isObj(j.result) ? j.result : {};
          const dense = isObj(info.denseIndex) ? info.denseIndex as Record<string, unknown> : {};
          vector = {
            vectorCount: info.vectorCount,
            dimension: info.dimension,
            indexType: info.indexType,
            embeddingModel: dense.embeddingModel,
          };
        } catch { /* omit vector info on error */ }
      }
      return finish(
        {
          ok: true,
          action,
          service: "nexus-cortex-harness-v2",
          secrets,
          rate,
          ...(vector ? { vector } : {}),
        },
        true,
        "edge:diagnostics",
      );
    }

    // ------------------------------------------------------------------
    // Hyperbrowser web lanes (direct)
    // ------------------------------------------------------------------
    if (action === "scrape" || action === "search" || action === "crawl") {
      const r = await runWebLane(action, params, keys, db);
      return finish(
        r.ok ? { ok: true, action, data: r.data } : { ok: false, action, error: r.error },
        r.ok,
        r.lane,
        !!r.cached,
        { rate: r.rate, ...(r.memorized ? { memorized: r.memorized } : {}) },
        r.rate.blocked ? 429 : 200,
      );
    }

    // ------------------------------------------------------------------
    // Hedged LLM + exact/semantic cache (opt-in via params.cache)
    // ------------------------------------------------------------------
    if (action === "llm") {
      const p = params as never as LlmParams;
      if (!p?.baseUrl || !p?.apiKey || !p?.model || !Array.isArray(p.messages)) {
        return finish({ ok: false, action, error: "llm requires params.{messages, baseUrl, apiKey, model}" }, false, "edge:llm");
      }
      const rate = await rateGate("llm");
      if (rate.blocked) {
        return finish(
          { ok: false, action, error: `rate limit exceeded for llm (cap ${rate.cap}/hour) — try later` },
          false, "edge:rate", false, { rate }, 429,
        );
      }
      const cacheOn = p.cache === true;
      const msgs = p.messages as Array<{ role?: string; content?: unknown }>;
      const lastUserRaw = [...msgs].reverse().find((m) => m?.role === "user");
      const lastUser = clip(
        typeof lastUserRaw?.content === "string" ? lastUserRaw.content : JSON.stringify(lastUserRaw?.content ?? ""),
        4000,
      );
      if (cacheOn) {
        // Layer 1 — exact cache (Redis SETEX, Postgres fallback), 6h.
        const ck = `nexus:cortex:llm:${await sha256Hex(JSON.stringify({ model: p.model, messages: p.messages }))}`;
        const exact = await cacheGet(db, ck, LLM_CACHE_TTL_SECONDS);
        if (isObj(exact) && typeof exact.reply === "string") {
          return finish(
            { ok: true, action, data: { reply: clip(exact.reply, 8000), modelLabel: "exact-cache", hedged: false, cached: true } },
            true, "cache:llm-exact", true, { rate, cacheHit: "exact" },
          );
        }
        // Layer 2 — semantic cache on the vector index (DENSE cosine ≥ 0.93).
        // Never dials the LLM when it fires; best-effort (fail open to dial).
        const v = vectorCfg(keys);
        if (v) {
          try {
            const hits = await vectorQuery(v, { data: lastUser, topK: 1 });
            const top = hits[0];
            const score = Number(top?.score ?? 0);
            const cachedReply = top?.metadata?.cachedReply;
            if (top && score >= LLM_SEMANTIC_THRESHOLD && typeof cachedReply === "string" && cachedReply) {
              return finish(
                { ok: true, action, data: { reply: clip(cachedReply, 8000), modelLabel: "semantic-cache", hedged: false, cached: true } },
                true, "cache:llm-semantic", true,
                { rate, cacheHit: "semantic", semanticScore: score },
              );
            }
          } catch { /* semantic cache is best-effort */ }
        }
        // Remember the fresh reply in the background (both layers).
        // Vector metadata ≤ 48KB is fine — cachedReply is clipped to 4000.
      }
      const { content, modelLabel, hedged } = await hedgedLlm(p);
      if (cacheOn) {
        const ck2 = `nexus:cortex:llm:${await sha256Hex(JSON.stringify({ model: p.model, messages: p.messages }))}`;
        bgForget(cachePut(db, ck2, { reply: clip(content, 8000), modelLabel }, LLM_CACHE_TTL_SECONDS));
        const v = vectorCfg(keys);
        if (v) {
          bgForget((async () => {
            await vectorUpsert(v, {
              id: `llm_${await sha16(lastUser)}`, // dedupe: same prompt → same id → freshest reply wins
              data: lastUser,
              metadata: { cachedReply: clip(content, 4000), model: String(p.model), at: new Date().toISOString() },
            });
          })());
        }
      }
      return finish(
        { ok: true, action, data: { reply: clip(content, 8000), modelLabel, hedged } },
        true, hedged ? "edge:llm-hedge" : "edge:llm", false, { rate },
      );
    }

    // ------------------------------------------------------------------
    // Semantic memory (Upstash Vector, free auto-embeddings)
    // ------------------------------------------------------------------
    if (action === "memory.put") {
      const p = params as { text?: unknown; kind?: unknown; id?: unknown; metadata?: unknown; source?: unknown };
      const text = clip(typeof p.text === "string" ? p.text : "", 12000);
      if (!text) return finish({ ok: false, action, error: "memory.put requires params.text (≤12000 chars)" }, false, "edge:memory");
      const v = vectorCfg(keys);
      if (!v) {
        return finish(
          { ok: false, action, error: "no Upstash Vector config at edge or in body.keys — set UPSTASH_VECTOR_REST_URL/TOKEN (index must use an Upstash-hosted embedding model)" },
          false, "edge:memory", false, { rate: { limited: false } },
        );
      }
      const rate = await rateGate("memory.put");
      if (rate.blocked) {
        return finish(
          { ok: false, action, error: `rate limit exceeded for memory.put (cap ${rate.cap}/hour) — try later` },
          false, "edge:rate", false, { rate }, 429,
        );
      }
      const kind = clip(typeof p.kind === "string" && p.kind ? p.kind : "note", 60);
      const id = typeof p.id === "string" && p.id ? p.id : `mem_${await sha16(text)}`;
      const extraMeta = isObj(p.metadata) ? p.metadata : {};
      const metadata = {
        kind,
        ...(typeof p.source === "string" && p.source ? { source: clip(p.source, 300) } : {}),
        at: new Date().toISOString(),
        ...extraMeta,
      };
      try {
        await vectorUpsert(v, { id, data: text, metadata });
        return finish({ ok: true, action, id, kind }, true, "edge:memory", false, { rate });
      } catch (err) {
        return finish({ ok: false, action, error: errSlice(err) }, false, "edge:memory", false, { rate });
      }
    }

    if (action === "memory.query") {
      const p = params as { text?: unknown; topK?: unknown; kind?: unknown; threshold?: unknown };
      const text = typeof p.text === "string" ? p.text : "";
      if (!text) return finish({ ok: false, action, error: "memory.query requires params.text" }, false, "edge:memory");
      const v = vectorCfg(keys);
      if (!v) {
        return finish(
          { ok: false, action, error: "no Upstash Vector config at edge or in body.keys — set UPSTASH_VECTOR_REST_URL/TOKEN" },
          false, "edge:memory", false, { rate: { limited: false } },
        );
      }
      const rate = await rateGate("memory.query");
      if (rate.blocked) {
        return finish(
          { ok: false, action, error: `rate limit exceeded for memory.query (cap ${rate.cap}/hour) — try later` },
          false, "edge:rate", false, { rate }, 429,
        );
      }
      const topK = Math.min(Math.max(Number(p.topK ?? 5) || 5, 1), 10);
      const threshold = Number.isFinite(Number(p.threshold)) ? Number(p.threshold) : MEMORY_AUTO_THRESHOLD;
      const kindFilter = typeof p.kind === "string" && p.kind ? p.kind : "";
      try {
        const hits = await vectorQuery(v, { data: clip(text, 4000), topK });
        // kind filter is applied client-side of the API (Upstash filters are
        // metadata-only on /query-data with data queries) — accepted tradeoff.
        const results = hits
          .filter((h) =>
            (!kindFilter || h?.metadata?.kind === kindFilter) &&
            Number(h?.score ?? 0) >= threshold
          )
          .slice(0, topK)
          .map((h) => ({
            id: String(h?.id ?? ""),
            score: Number(h?.score ?? 0),
            data: clip(h?.data ?? "", 600),
            metadata: isObj(h?.metadata) ? h.metadata : {},
          }));
        return finish({ ok: true, action, results, topK, threshold }, true, "edge:memory", false, { rate });
      } catch (err) {
        return finish({ ok: false, action, error: errSlice(err) }, false, "edge:memory", false, { rate });
      }
    }

    if (action === "memory.delete") {
      const v = vectorCfg(keys);
      if (!v) {
        return finish(
          { ok: false, action, error: "no Upstash Vector config at edge or in body.keys — set UPSTASH_VECTOR_REST_URL/TOKEN" },
          false, "edge:memory", false, { rate: { limited: false, note: "unmetered action" } },
        );
      }
      const id = typeof params.id === "string" ? params.id : "";
      if (!id) {
        return finish(
          { ok: false, action, error: "memory.delete requires params.id — prefix delete not supported, pass the exact id" },
          false, "edge:memory", false, { rate: { limited: false, note: "unmetered action" } },
        );
      }
      try {
        const deleted = await vectorDeleteIds(v, [id]);
        return finish({ ok: true, action, id, deleted }, true, "edge:memory", false, { rate: { limited: false, note: "unmetered action" } });
      } catch (err) {
        return finish({ ok: false, action, error: errSlice(err) }, false, "edge:memory", false, { rate: { limited: false, note: "unmetered action" } });
      }
    }

    // ------------------------------------------------------------------
    // Durable async jobs (QStash) — breaks the ~26s client/edge wall-clock
    // ------------------------------------------------------------------
    if (action === "job.enqueue") {
      const q = qstashCfg(keys);
      if (!q) {
        return finish({ ok: false, action, error: "job.enqueue needs QSTASH_TOKEN (edge secret or body.keys.qstashToken)" }, false, "qstash:enqueue");
      }
      const p = params as { action?: unknown; params?: unknown; delaySeconds?: unknown; jobId?: unknown };
      const innerAction = String(p.action ?? "");
      if (!["scrape", "search", "crawl"].includes(innerAction)) {
        return finish({ ok: false, action, error: "job.enqueue requires params.action = scrape | search | crawl (+ params.params payload)" }, false, "qstash:enqueue");
      }
      const rate = await rateGate("job.enqueue");
      if (rate.blocked) {
        return finish(
          { ok: false, action, error: `rate limit exceeded for job.enqueue (cap ${rate.cap}/hour) — try later` },
          false, "edge:rate", false, { rate }, 429,
        );
      }
      const jobId = typeof p.jobId === "string" && p.jobId ? p.jobId : `job_${randomHex(12)}`;
      const delayRaw = Number(p.delaySeconds);
      const delay = Number.isFinite(delayRaw) && delayRaw > 0 ? Math.min(Math.floor(delayRaw), 604800) : 0;
      const edgeUrl = edgePublicUrl();
      try {
        const r = await timedFetch(`${q.base}/v2/publish/${edgeUrl}`, {
          method: "POST",
          headers: qstashHeaders(q, { delaySeconds: delay }),
          body: JSON.stringify({
            action: "job.execute",
            jobId,
            inner: { action: innerAction, params: isObj(p.params) ? p.params : {} },
          }),
        }, 3000);
        const txt = await r.text();
        let j: { messageId?: string; error?: string } = {};
        try { j = JSON.parse(txt) as typeof j; } catch { /* non-JSON error body */ }
        if (!r.ok || j.error) throw new Error(`qstash publish HTTP ${r.status}: ${clip(j.error ?? txt, 160)}`);
        return finish(
          { ok: true, action, jobId, messageId: String(j.messageId ?? ""), note: "poll job.result — the edge parks the outcome for 1h" },
          true, "qstash:enqueue", false, { rate },
        );
      } catch (err) {
        return finish({ ok: false, action, jobId, error: errSlice(err) }, false, "qstash:enqueue", false, { rate });
      }
    }

    if (action === "job.execute") {
      // Internal — invoked BY QStash (or manually with the shared key).
      // NOT caller-rate-capped itself; inner actions consume their own caps.
      const p = params as { jobId?: unknown; inner?: { action?: unknown; params?: unknown } };
      const jobId = clip(String(p.jobId ?? ""), 80);
      const innerAction = String(p.inner?.action ?? "");
      const innerParams = isObj(p.inner?.params) ? p.inner!.params as Record<string, unknown> : {};
      const rate: RateInfo = { limited: false, note: "internal QStash lane — inner actions consume their own caps" };
      if (!jobId || !["scrape", "search", "crawl"].includes(innerAction)) {
        return finish(
          { ok: false, action, jobId, error: `job.execute requires {jobId, inner.action = scrape | search | crawl} (got "${clip(innerAction, 40)}")` },
          false, "qstash:job-execute", false, { rate },
        );
      }
      try {
        const r = await runWebLane(innerAction as "scrape" | "search" | "crawl", innerParams, keys, db);
        return finish(
          r.ok
            ? { ok: true, action, jobId, data: r.data }
            : { ok: false, action, jobId, error: r.error },
          r.ok,
          `qstash:job-execute:${r.lane}`,
          !!r.cached,
          { rate },
        );
      } catch (err) {
        return finish({ ok: false, action, jobId, error: errSlice(err) }, false, "qstash:job-execute", false, { rate });
      }
    }

    if (action === "job.complete") {
      // Internal — QStash callback envelope: {status, body: <base64>, sourceMessageId, ...}.
      const env = params;
      const rawB64 = typeof env.body === "string" ? env.body : "";
      let inner: { ok?: boolean; jobId?: string; data?: unknown; error?: string } | null = null;
      let jobId = "";
      try {
        const decoded = atob(rawB64);
        try { inner = JSON.parse(decoded) as typeof inner; } catch { /* JSON failed — regex below */ }
        if (inner?.jobId) jobId = String(inner.jobId);
        if (!jobId) {
          const m = decoded.match(/"jobId"\s*:\s*"([^"]+)"/);
          if (m) jobId = m[1];
        }
      } catch { /* atob failed — undecodable */ }
      const rc = redisCfg();
      if (jobId && rc) {
        const parked = {
          ok: inner ? !!inner.ok : false,
          data: inner?.data ?? null,
          error: inner && !inner.ok ? clip(String(inner.error ?? "job failed"), 300) : "",
          at: new Date().toISOString(),
        };
        try {
          await redisCmd(rc, ["SETEX", `nexus:cortex:job:${jobId}`, JOB_PARK_TTL_SECONDS, JSON.stringify(parked)]);
        } catch (e) {
          return finish(
            { ok: true, action, jobId, parked: false, note: `park failed: ${errSlice(e)} — 200 anyway so QStash doesn't retry` },
            true, "qstash:callback", false, { rate: { limited: false, note: "internal QStash lane" } },
          );
        }
        if (jobId.startsWith("sched_")) bgForget(touchSchedSummary(rc, jobId));
        return finish(
          { ok: true, action, jobId, parked: true, sourceMessageId: clip(String(env.sourceMessageId ?? ""), 60) },
          true, "qstash:callback", false, { rate: { limited: false, note: "internal QStash lane" } },
        );
      }
      return finish(
        { ok: true, action, parked: false, note: jobId ? "no Redis configured — outcome not parked" : "could not decode callback body / extract jobId" },
        true, "qstash:callback", false, { rate: { limited: false, note: "internal QStash lane" } },
      );
    }

    if (action === "job.result") {
      const rc = redisCfg();
      if (!rc) {
        return finish({ ok: false, action, error: "job.result needs Upstash Redis for job parking (edge secrets UPSTASH_REDIS_REST_URL/TOKEN)" }, false, "edge:job-result");
      }
      const jobId = clip(String(params.jobId ?? ""), 80);
      if (!jobId) return finish({ ok: false, action, error: "job.result requires params.jobId" }, false, "edge:job-result");
      try {
        const raw = await redisCmd(rc, ["GET", `nexus:cortex:job:${jobId}`]);
        if (typeof raw === "string") {
          let result: unknown = raw;
          try { result = JSON.parse(raw); } catch { /* park raw string */ }
          return finish({ ok: true, action, found: true, result }, true, "edge:job-result", false, { rate: { limited: false, note: "unmetered poll" } });
        }
        return finish(
          { ok: true, action, found: false, note: "not finished yet (or expired after 1h)" },
          true, "edge:job-result", false, { rate: { limited: false, note: "unmetered poll" } },
        );
      } catch (err) {
        return finish({ ok: false, action, error: errSlice(err) }, false, "edge:job-result");
      }
    }

    if (action === "job.schedule") {
      const q = qstashCfg(keys);
      if (!q) {
        return finish({ ok: false, action, error: "job.schedule needs QSTASH_TOKEN (edge secret or body.keys.qstashToken)" }, false, "qstash:schedule");
      }
      const p = params as { name?: unknown; cron?: unknown; action?: unknown; params?: unknown };
      const name = String(p.name ?? "");
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) {
        return finish({ ok: false, action, error: "job.schedule requires params.name as a slug (lowercase letters, digits, hyphens, ≤40 chars)" }, false, "qstash:schedule");
      }
      const cron = String(p.cron ?? "").trim();
      if (!/^\S+\s+\S+\s+\S+\s+\S+\s+\S+/.test(cron)) {
        return finish({ ok: false, action, error: "job.schedule requires params.cron as a 5+ field cron expression (QStash validates final syntax)" }, false, "qstash:schedule");
      }
      const innerAction = String(p.action ?? "");
      if (!["scrape", "search", "crawl"].includes(innerAction)) {
        return finish({ ok: false, action, error: "job.schedule requires params.action = scrape | search | crawl (+ params.params payload)" }, false, "qstash:schedule");
      }
      const rate = await rateGate("job.schedule");
      if (rate.blocked) {
        return finish(
          { ok: false, action, error: `rate limit exceeded for job.schedule (cap ${rate.cap}/hour) — try later` },
          false, "edge:rate", false, { rate }, 429,
        );
      }
      const edgeUrl = edgePublicUrl();
      // Idempotent upsert via Upstash-Schedule-Id: re-registering the same
      // name replaces the schedule instead of stacking a duplicate.
      // Each fire gets a fresh jobId sched_{name}_{ts}; the callback parks
      // its outcome under nexus:cortex:job:{jobId} and rolls lastFiredAt
      // into the nexus:cortex:sched:{name} summary (no caller polls those).
      const scheduleId = `nexus-${name}`;
      try {
        const r = await timedFetch(`${q.base}/v2/schedules/${edgeUrl}`, {
          method: "POST",
          headers: {
            ...qstashHeaders(q),
            "Upstash-Cron": cron,
            "Upstash-Schedule-Id": scheduleId,
          },
          body: JSON.stringify({
            action: "job.execute",
            jobId: `sched_${name}_${Date.now()}`,
            inner: { action: innerAction, params: isObj(p.params) ? p.params : {} },
          }),
        }, 3000);
        const txt = await r.text();
        let j: { scheduleId?: string; error?: string } = {};
        try { j = JSON.parse(txt) as typeof j; } catch { /* non-JSON error body */ }
        if (!r.ok || j.error) throw new Error(`qstash schedule HTTP ${r.status}: ${clip(j.error ?? txt, 160)}`);
        const rc = redisCfg();
        if (rc) {
          bgForget(redisCmd(rc, [
            "SETEX", `nexus:cortex:sched:${name}`, SCHED_SUMMARY_TTL_SECONDS,
            JSON.stringify({ name, scheduleId: j.scheduleId ?? "", cron, lastFiredAt: null, createdAt: new Date().toISOString() }),
          ]));
        }
        return finish(
          { ok: true, action, scheduleId: j.scheduleId ?? "", scheduleKey: scheduleId, cron, note: "fires park results under nexus:cortex:job:{sched_jobId} for 1h; lastFiredAt rolls into nexus:cortex:sched:{name}" },
          true, "qstash:schedule", false, { rate },
        );
      } catch (err) {
        return finish({ ok: false, action, error: errSlice(err) }, false, "qstash:schedule", false, { rate });
      }
    }

    // ------------------------------------------------------------------
    // Sandbox lane (Upstash Box — bare snake_case responses, X-Box-Api-Key)
    // ------------------------------------------------------------------
    if (action === "sandbox.exec" || action === "sandbox.info") {
      const p = params as {
        command?: unknown; argv?: unknown; boxId?: unknown; region?: unknown;
        timeoutMs?: unknown; boxApiKey?: unknown;
      };
      const apiKey = (typeof p.boxApiKey === "string" && p.boxApiKey) || keys.boxApiKey || Deno.env.get("BOX_API_KEY") || "";
      const boxId = (typeof p.boxId === "string" && p.boxId) || keys.boxId || Deno.env.get("BOX_ID") || "";
      if (!apiKey || !boxId) {
        return finish(
          { ok: false, action, error: "no Box API key at edge or in params — set BOX_API_KEY (+ BOX_ID) as edge secrets (or pass body.keys.boxApiKey + params.boxId)" },
          false, "edge:box", false, { rate: { limited: false, note: "box keys missing" } },
        );
      }
      const regionRaw = (typeof p.region === "string" && p.region) || Deno.env.get("BOX_REGION") || "us-east-1";
      const region = /^[a-z0-9-]{2,20}$/.test(regionRaw) ? regionRaw : "us-east-1";
      const base = `https://${region}.box.upstash.com/v2/box/${encodeURIComponent(boxId)}`;

      if (action === "sandbox.exec") {
        const command = typeof p.command === "string" ? p.command : "";
        const argv = Array.isArray(p.argv) ? p.argv.map((a) => String(a)) : null;
        if (!command && !argv?.length) {
          return finish({ ok: false, action, error: "sandbox.exec requires params.command (string, run via sh -c) or params.argv (string[])" }, false, "edge:box");
        }
        let rate = await rateGate("sandbox.exec");
        if (rate.blocked) {
          return finish(
            { ok: false, action, error: `rate limit exceeded for sandbox.exec (cap ${rate.cap}/hour) — try later` },
            false, "edge:rate", false, { rate }, 429,
          );
        }
        if (rate.limited === false && !rate.note) {
          rate = { limited: false, note: "no Redis — sandbox lane is uncapped (set UPSTASH_REDIS_REST_URL/TOKEN to enforce 40/h)" };
        }
        const timeoutMs = Math.min(Math.max(Number(p.timeoutMs ?? 60000) || 60000, 1000), 600000);
        try {
          const r = await timedFetch(`${base}/exec`, {
            method: "POST",
            headers: { "X-Box-Api-Key": apiKey, "content-type": "application/json" },
            body: JSON.stringify({ command: argv ?? ["sh", "-c", command] }),
          }, timeoutMs);
          const txt = await r.text();
          let j: { exit_code?: number; output?: string; error?: string } = {};
          try { j = JSON.parse(txt) as typeof j; } catch { /* non-JSON error body */ }
          if (!r.ok) throw new Error(`box exec HTTP ${r.status}: ${clip(j.error ?? txt, 160)}`);
          return finish(
            {
              ok: true,
              action,
              exitCode: Number(j.exit_code ?? -1),
              output: clip(j.output ?? "", 8000),
              ...(j.error ? { error: clip(j.error, 500) } : {}),
            },
            true, "edge:box", false, { rate },
          );
        } catch (err) {
          return finish({ ok: false, action, error: errSlice(err) }, false, "edge:box", false, { rate });
        }
      }

      // sandbox.info
      try {
        const r = await timedFetch(base, { headers: { "X-Box-Api-Key": apiKey } }, 5000);
        const txt = await r.text();
        let j: Record<string, unknown> = {};
        try { j = JSON.parse(txt) as Record<string, unknown>; } catch { /* non-JSON error body */ }
        if (!r.ok) throw new Error(`box info HTTP ${r.status}: ${clip(String(j.error ?? txt), 160)}`);
        return finish(
          { ok: true, action, status: j.status, runtime: j.runtime, size: j.size },
          true, "edge:box", false, { rate: { limited: false, note: "unmetered action" } },
        );
      } catch (err) {
        return finish({ ok: false, action, error: errSlice(err) }, false, "edge:box", false, { rate: { limited: false, note: "unmetered action" } });
      }
    }

    // ------------------------------------------------------------------
    // Distributed lock (Redis SET NX PX) — pipeline/schedule dedupe
    // ------------------------------------------------------------------
    if (action === "lock.acquire" || action === "lock.release") {
      const rc = redisCfg();
      if (!rc) {
        return finish(
          { ok: false, action, error: "locks need Upstash Redis (edge secret UPSTASH_REDIS_REST_URL/TOKEN)" },
          false, "edge:lock", false, { rate: { limited: false, note: "redis missing" } },
        );
      }
      const name = clip(String(params.name ?? ""), 120);
      if (!name) return finish({ ok: false, action, error: `${action} requires params.name` }, false, "edge:lock");
      const lockKey = `nexus:cortex:lock:${name}`;
      const rate = await rateGate(action);
      if (rate.blocked) {
        return finish(
          { ok: false, action, error: `rate limit exceeded for ${action} (cap ${rate.cap}/hour) — try later` },
          false, "edge:rate", false, { rate }, 429,
        );
      }
      try {
        if (action === "lock.acquire") {
          const ttlMs = Math.min(Math.max(Number(params.ttlMs ?? 60000) || 60000, 1000), 600000);
          const holder = `h_${randomHex(8)}`;
          const res = await redisCmd(rc, ["SET", lockKey, holder, "NX", "PX", ttlMs]);
          const acquired = res === "OK";
          return finish(
            acquired
              ? { ok: true, action, acquired: true, holder, ttlMs }
              : { ok: true, action, acquired: false, note: "already held" },
            true, "edge:lock", false, { rate },
          );
        }
        const holder = clip(String(params.holder ?? ""), 40);
        if (!holder) return finish({ ok: false, action, error: "lock.release requires params.holder (from lock.acquire)" }, false, "edge:lock");
        const cur = await redisCmd(rc, ["GET", lockKey]);
        if (cur === holder) {
          await redisCmd(rc, ["DEL", lockKey]);
          return finish({ ok: true, action, released: true }, true, "edge:lock", false, { rate });
        }
        return finish(
          { ok: true, action, released: false, note: "not the holder — lock may have expired" },
          true, "edge:lock", false, { rate },
        );
      } catch (err) {
        return finish({ ok: false, action, error: errSlice(err) }, false, "edge:lock", false, { rate });
      }
    }

    return json({
      ok: false,
      error: `unknown action "${clip(action, 60)}" — use scrape | search | crawl | llm | memory.put | memory.query | memory.delete | job.enqueue | job.result | job.schedule | sandbox.exec | sandbox.info | lock.acquire | lock.release | diagnostics`,
    }, 400);
  } catch (err) {
    return finish({ ok: false, action, error: errSlice(err) }, false, "edge:error");
  }
});
