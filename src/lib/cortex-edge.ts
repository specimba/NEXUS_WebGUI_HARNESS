// ─── Cortex Edge — isomorphic agentic lane client (2-a v1 → 2-c v2) ──────────
// Client + server shared module for the NEXUS Cortex Harness: a Supabase Edge
// Function (deliverables/nexus-cortex-harness/) that fronts the Hyperbrowser
// Web API server-side (zero browser CORS), with an L2 cache and telemetry —
// and, since the v2 deliverable, FREE-TIER AGENTIC LANES: semantic memory
// (Upstash Vector auto-embeddings), a sandbox shell (Upstash Box), durable
// jobs (QStash) and Redis rate metering.
//
// LANE LADDER (cortexDeepScrape):
//   1. "edge"    — POST the configured edge function (edge secrets and/or the
//                  per-request BYOK Hyperbrowser key in body.keys).
//   2. "direct"  — call api.hyperbrowser.ai directly with the BYOK key. Works
//                  server-side always; from the BROWSER it may hit CORS — a
//                  failure here is caught and reported honestly (never silent).
//   3. "fallback"— no lane configured (lane "off") or every lane failed: the
//                  caller falls through to the existing read_url / web_search
//                  implementations. The marker CORTEX_FALLBACK is returned so
//                  the server executor can catch it; "crawl" has no fallback
//                  and explains what it needs instead.
//
// LANE LADDERS (cortexMemory / cortexSandbox, 2-c):
//   1. "edge"    — POST memory.put / memory.query / sandbox.exec with the full
//                  non-empty BYOK set in body.keys.
//   2. "direct"  — Upstash Vector REST (memory) or the Upstash Box exec API
//                  (sandbox) with the BYOK keys. Server-side always; from the
//                  BROWSER these may hit CORS — caught, reported honestly.
//   3. "off"     — NO fallback lane: read_url/web_search cannot answer memory
//                  or run a shell, so the result is an honest explanation of
//                  exactly what to configure (Settings → Cortex Edge).
//
// ISOMORPHIC ON PURPOSE: no node:* imports, no DOM/localStorage access — the
// server executor (src/lib/server/tools.ts) and the settings card both import
// this module. BYOK doctrine: keys ride per-request only, nothing persists.

import {
  CORTEX_PROBE_TIMEOUT_MS,
  CORTEX_TOOL_TIMEOUT_MS,
} from "./cortex-edge-paste-pack";
import type { CortexTransports } from "./cortex-census";

/**
 * Cortex Edge configuration (Settings → Cortex Edge, persisted client-side).
 * v2 (2-c): widened for the free-tier agentic lanes. Every new field is BYOK —
 * it rides per-request in edge `body.keys` and drives the direct lanes; keys
 * are never logged and never persisted server-side.
 */
export type CortexConfig = {
  /** Supabase Edge Function URL (…/functions/v1/nexus-cortex-harness). Empty = edge lane off. */
  url: string;
  /** x-nexus-cortex-key shared secret (the CORTEX_SHARED_SECRET edge secret — NOT an SSL/GPG key). */
  key?: string;
  /** Optional per-request Hyperbrowser key (BYOK; edge body.keys + direct lane). */
  hbKey?: string;
  /** Upstash Vector REST URL (https://…upstash.io) — semantic memory lane (direct + edge keys). */
  vectorUrl?: string;
  /** Upstash Vector REST token. */
  vectorToken?: string;
  /** QStash bearer token (edge jobs lane only — forwarded in body.keys). */
  qstashToken?: string;
  /** Upstash Box API key (box_…) — sandbox lane (direct + edge keys). */
  boxApiKey?: string;
  /** Box id for the sandbox lane. */
  boxId?: string;
  /** Box region host prefix (default "us-east-1"). */
  boxRegion?: string;
};

export type CortexLane = "edge" | "direct" | "fallback" | "off";

export interface CortexScrapeArgs {
  url?: string;
  query?: string;
  mode?: "read" | "search" | "crawl";
  /** search only: restrict results to one site. */
  site?: string;
  /** crawl only: pages to pull (1-20, default 6). */
  maxPages?: number;
}

export interface CortexScrapeResult {
  ok: boolean;
  lane: CortexLane;
  /** Provenance-headed content, or the CORTEX_FALLBACK marker when the caller
   *  should fall through to read_url / web_search. */
  content: string;
  title?: string;
  links?: string[];
  ms: number;
  error?: string;
}

/**
 * Sentinel returned (as content) when the deep-web lanes are exhausted and the
 * caller should fall through to the existing read_url / web_search executor.
 * The server executor catches this exact value.
 */
export const CORTEX_FALLBACK = "__cortex_fallback_read_url__";

const HB_BASE = "https://api.hyperbrowser.ai/api";

function clip(s: string, n: number): string {
  return s && s.length > n ? `${s.slice(0, n)}…[truncated]` : s || "";
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return clip(m, 200);
}

/** Budget signal: caller abort ∩ a fresh timeout, when the platform supports it. */
function budgetSignal(ms: number, caller?: AbortSignal): AbortSignal | undefined {
  const t =
    typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
  if (!t) return caller;
  if (caller && typeof AbortSignal.any === "function") return AbortSignal.any([caller, t]);
  return t;
}

/** " · 3/60 this hour" when an edge reply's telemetry carries a metered snapshot. */
function rateSuffix(rate: unknown): string {
  const r = (rate ?? null) as { count?: unknown; cap?: unknown } | null;
  const count = Number(r?.count);
  const cap = Number(r?.cap);
  if (!Number.isFinite(count) || !Number.isFinite(cap) || cap <= 0) return "";
  return ` · ${count}/${cap} this hour`;
}

/** Integer clamp with a default (schema clamps for topK / timeoutSec). */
function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : dflt;
}

/** sha256 hex, first 16 chars — content-dedupe ids for the direct Vector lane. */
async function sha16(s: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  } catch {
    // Non-secure context / no subtle crypto — dedupe degrades, the write works.
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`.slice(0, 16);
  }
}

function normalizeLinks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const l of raw) {
    const u =
      typeof l === "string"
        ? l
        : l && typeof l === "object"
          ? String((l as { url?: unknown; href?: unknown }).url ?? (l as { href?: unknown }).href ?? "")
          : "";
    if (u) out.push(u);
  }
  return out;
}

// ─── Probe (Settings card) ───────────────────────────────────────────────────

export interface CortexProbeResult {
  ok: boolean;
  ms: number;
  service?: string;
  edgeRegion?: string;
  error?: string;
  /** v2 lane matrix (undefined when the probe hits a v1 function or fails). */
  lanes?: {
    hyperbrowser: boolean;
    redis: boolean;
    vector: boolean;
    qstash: boolean;
    box: boolean;
    sharedSecretGate: boolean;
  };
  /** v2 diagnostics rate snapshot (undefined on v1/failure; null when no Redis at edge). */
  rate?: { limited?: boolean; note?: string; day?: { count?: number }; hour?: Record<string, number> } | null;
  /** v2 vector index info (undefined on v1/failure/unconfigured). */
  vector?: { vectorCount?: number; dimension?: number; indexType?: string; embeddingModel?: string } | null;
  /** r709: WHICH transport answered, per lane — census truth (no silent fallbacks). */
  transports?: CortexTransports;
}

/** Mirror of the edge function's hourly caps — for the UI meter only. */
export const CORTEX_RATE_CAPS: Record<string, number> = {
  scrape: 60,
  search: 90,
  crawl: 20,
  llm: 120,
  "memory.put": 200,
  "memory.query": 300,
  "sandbox.exec": 40,
};

/** Budget for the diagnostics POST (health 8s + diagnostics 9s ≤ 18s total). */
const CORTEX_DIAGNOSTICS_TIMEOUT_MS = 9_000;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Non-empty BYOK keys as the edge `body.keys` envelope (undefined when none). */
function byokKeys(cfg?: CortexConfig): Record<string, string> | undefined {
  if (!cfg) return undefined;
  const keys: Record<string, string> = {};
  if (cfg.hbKey?.trim()) keys.hyperbrowserKey = cfg.hbKey.trim();
  if (cfg.vectorUrl?.trim()) keys.vectorUrl = cfg.vectorUrl.trim();
  if (cfg.vectorToken?.trim()) keys.vectorToken = cfg.vectorToken.trim();
  if (cfg.qstashToken?.trim()) keys.qstashToken = cfg.qstashToken.trim();
  if (cfg.boxApiKey?.trim()) keys.boxApiKey = cfg.boxApiKey.trim();
  if (cfg.boxId?.trim()) keys.boxId = cfg.boxId.trim();
  return Object.keys(keys).length > 0 ? keys : undefined;
}

/** Budget for ONE direct Upstash lane dial (the trio dials in parallel). */
const CORTEX_DIRECT_LANE_TIMEOUT_MS = 4_000;

/** The r709 direct-dial verdict: trio lanes + wall time (booleans only — no secrets ride back). */
export interface CortexDirectProbeResult {
  ms: number;
  lanes: { vector: boolean; qstash: boolean; box: boolean };
}

/**
 * r709 (Cortex local-fallback, first slice): dial the Upstash trio's REST APIs
 * DIRECTLY — no edge function anywhere in the path. Vector: POST ["INFO"] on
 * the index URL; QStash: GET /v2/topics; Box: GET /2.0/users/me. Each dial is
 * budgeted and never throws; a 401 means "reachable, credential rejected" —
 * the lane reports false (it did not ANSWER with the given credential).
 * Intended to run SERVER-SIDE via /api/cortex/probe-direct: the doctrine's
 * Upstash lanes are server lanes, and the browser never CORS-fights Upstash/Box.
 */
export async function probeUpstashDirect(cfg: CortexConfig): Promise<CortexDirectProbeResult> {
  const started = Date.now();
  const vectorUrl = cfg?.vectorUrl?.trim() ?? "";
  const vectorToken = cfg?.vectorToken?.trim() ?? "";
  const qstashToken = cfg?.qstashToken?.trim() ?? "";
  const boxApiKey = cfg?.boxApiKey?.trim() ?? "";
  const lane = async (go: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await go();
    } catch {
      return false;
    }
  };
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const [vector, qstash, box] = await Promise.all([
    vectorUrl && vectorToken
      ? lane(async () => {
          const res = await fetch(vectorUrl, {
            method: "POST",
            headers: { ...bearer(vectorToken), "content-type": "application/json" },
            body: JSON.stringify(["INFO"]),
            signal: budgetSignal(CORTEX_DIRECT_LANE_TIMEOUT_MS),
          });
          return res.ok;
        })
      : Promise.resolve(false),
    qstashToken
      ? lane(async () => {
          const res = await fetch("https://qstash.upstash.io/v2/topics", {
            headers: bearer(qstashToken),
            signal: budgetSignal(CORTEX_DIRECT_LANE_TIMEOUT_MS),
          });
          return res.ok;
        })
      : Promise.resolve(false),
    boxApiKey
      ? lane(async () => {
          const res = await fetch("https://api.box.com/2.0/users/me", {
            headers: bearer(boxApiKey),
            signal: budgetSignal(CORTEX_DIRECT_LANE_TIMEOUT_MS),
          });
          return res.ok;
        })
      : Promise.resolve(false),
  ]);
  return { ms: Date.now() - started, lanes: { vector, qstash, box } };
}

/**
 * v2 probe: ① GET health (open by design, 8s budget) — parse service/edgeRegion;
 * ② POST action:"diagnostics" (~9s budget) with the shared-secret header (when
 * set) and the non-empty BYOK keys in body.keys — derive the lane matrix, pass
 * rate + vector through verbatim. Health-ok + diagnostics-fail still probes
 * ok:true with an honest note (matrix undefined) — a 401 on diagnostics must
 * not turn the health verdict red. Total budget ≤ 18s. NEVER throws.
 */
export async function probeCortexEdge(cfg: CortexConfig): Promise<CortexProbeResult> {
  const started = Date.now();
  const url = (cfg?.url ?? "").trim();
  if (!url) {
    // r709 (Cortex local-fallback, first slice): an empty edge URL no longer
    // short-circuits the whole probe. The Upstash trio is plain REST and the
    // app's OWN server dials it directly (no Supabase deploy) — the probe asks
    // the same-origin server route and NAMES the transport in the census
    // (UPSTASH), per the no-silent-fallback doctrine. Still honest: with no
    // trio config at all, the old verdict stands.
    const anyTrio = !!(cfg?.vectorUrl?.trim() || cfg?.qstashToken?.trim() || cfg?.boxApiKey?.trim());
    if (!anyTrio) return { ok: false, ms: 0, error: "No function URL configured" };
    try {
      const res = await fetch("/api/cortex/probe-direct", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // BYOK doctrine: only the trio fields ride, per-request, never persisted.
        body: JSON.stringify({
          vectorUrl: cfg?.vectorUrl ?? "",
          vectorToken: cfg?.vectorToken ?? "",
          qstashToken: cfg?.qstashToken ?? "",
          boxApiKey: cfg?.boxApiKey ?? "",
        }),
        signal: budgetSignal(CORTEX_PROBE_TIMEOUT_MS),
      });
      const j = (await res.json().catch(() => null)) as
        | (CortexDirectProbeResult & { error?: string })
        | null;
      if (!res.ok || !j) {
        return { ok: false, ms: Date.now() - started, error: `direct probe HTTP ${res.status}` };
      }
      const lanes = {
        hyperbrowser: false,
        redis: false,
        vector: !!j.lanes?.vector,
        qstash: !!j.lanes?.qstash,
        box: !!j.lanes?.box,
        sharedSecretGate: false,
      };
      const answered = [lanes.vector, lanes.qstash, lanes.box].filter(Boolean).length;
      return {
        ok: answered > 0,
        ms: typeof j.ms === "number" ? j.ms : Date.now() - started,
        ...(answered > 0 ? {} : { error: "EDGE OFF (no function URL) · no Upstash lane answered directly" }),
        lanes,
        transports: { vector: "upstash-direct", qstash: "upstash-direct", box: "upstash-direct" },
      };
    } catch (e) {
      return { ok: false, ms: Date.now() - started, error: `direct probe failed: ${errText(e)}` };
    }
  }

  // ① Health (open by design).
  let service: string | undefined;
  let edgeRegion: string | undefined;
  try {
    const res = await fetch(url, {
      headers: cfg.key?.trim() ? { "x-nexus-cortex-key": cfg.key.trim() } : undefined,
      signal: budgetSignal(CORTEX_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, ms: Date.now() - started, error: `HTTP ${res.status} from the function URL` };
    const j = (await res.json().catch(() => null)) as
      | { service?: unknown; edgeRegion?: unknown; ok?: unknown }
      | null;
    if (j && j.ok === false) return { ok: false, ms: Date.now() - started, error: "Function answered ok:false" };
    service = typeof j?.service === "string" ? j.service : undefined;
    edgeRegion = typeof j?.edgeRegion === "string" ? j.edgeRegion : undefined;
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: errText(e) };
  }

  // ② Diagnostics — secrets-presence lane matrix + rate snapshot + vector info.
  const keys = byokKeys(cfg);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.key?.trim() ? { "x-nexus-cortex-key": cfg.key.trim() } : {}),
      },
      body: JSON.stringify({ action: "diagnostics", params: {}, ...(keys ? { keys } : {}) }),
      signal: budgetSignal(CORTEX_DIAGNOSTICS_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        ok: true,
        ms: Date.now() - started,
        service,
        edgeRegion,
        error: `health ok; diagnostics HTTP ${res.status} — lane matrix unavailable`,
      };
    }
    const j = (await res.json().catch(() => null)) as
      | {
          ok?: boolean;
          error?: string;
          secrets?: Record<string, unknown>;
          rate?: unknown;
          vector?: unknown;
        }
      | null;
    if (!j || j.ok === false) {
      return {
        ok: true,
        ms: Date.now() - started,
        service,
        edgeRegion,
        error: `health ok; diagnostics failed: ${j?.error ?? "no payload"} — lane matrix unavailable`,
      };
    }
    const secrets = isObj(j.secrets) ? j.secrets : {};
    const flag = (v: unknown): boolean => v === true;
    const lanes = {
      // Redis is deliberately edge-secret-only (poisonable shared state) — the
      // matrix reports the edge's verdict and never derives it from body keys.
      hyperbrowser: flag(secrets.hyperbrowser) || !!cfg.hbKey?.trim(),
      redis: flag(secrets.redis),
      vector: flag(secrets.vector) || !!(cfg.vectorUrl?.trim() && cfg.vectorToken?.trim()),
      qstash: flag(secrets.qstash) || !!cfg.qstashToken?.trim(),
      box: flag(secrets.box) || !!(cfg.boxApiKey?.trim() && cfg.boxId?.trim()),
      sharedSecretGate: flag(secrets.sharedSecretGate),
    };
    return {
      ok: true,
      ms: Date.now() - started,
      service,
      edgeRegion,
      lanes,
      // r709: the edge path NAMES its transport too — every lane says "edge".
      transports: {
        hyperbrowser: "edge",
        redis: "edge",
        vector: "edge",
        qstash: "edge",
        box: "edge",
      },
      ...(isObj(j.rate) ? { rate: j.rate as CortexProbeResult["rate"] } : {}),
      ...(isObj(j.vector) ? { vector: j.vector as CortexProbeResult["vector"] } : {}),
    };
  } catch (e) {
    return {
      ok: true,
      ms: Date.now() - started,
      service,
      edgeRegion,
      error: `health ok; diagnostics failed: ${errText(e)} — lane matrix unavailable`,
    };
  }
}

// ─── Lane 1: edge function ───────────────────────────────────────────────────

interface LaneOutcome {
  ok: boolean;
  content: string;
  title?: string;
  links?: string[];
  error?: string;
}

async function edgeLane(
  mode: "read" | "search" | "crawl",
  args: CortexScrapeArgs,
  cfg: CortexConfig,
  caller?: AbortSignal
): Promise<LaneOutcome> {
  const url = (args.url ?? "").trim();
  const query = (args.query ?? "").trim();
  const action = mode === "search" ? "search" : mode === "crawl" ? "crawl" : "scrape";
  const params: Record<string, unknown> =
    action === "scrape"
      ? { url, formats: ["markdown", "links"], maxChars: 6000 }
      : action === "search"
        ? { query: query.slice(0, 500), ...(args.site?.trim() ? { site: args.site.trim() } : {}) }
        : { url, maxPages: Math.min(Math.max(Number(args.maxPages) || 6, 1), 20) };
  const res = await fetch(cfg.url.trim(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cfg.key?.trim() ? { "x-nexus-cortex-key": cfg.key.trim() } : {}),
    },
    body: JSON.stringify({
      action,
      params,
      // BYOK forward: the edge uses its own secret when present, else this key.
      ...(cfg.hbKey?.trim() ? { keys: { hyperbrowserKey: cfg.hbKey.trim() } } : {}),
    }),
    signal: budgetSignal(CORTEX_TOOL_TIMEOUT_MS, caller),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`cortex edge HTTP ${res.status}: ${clip(body.replace(/\s+/g, " "), 160)}`);
  }
  const j = (await res.json().catch(() => null)) as
    | {
        ok?: boolean;
        error?: string;
        data?: Record<string, unknown>;
        telemetry?: { latencyMs?: number; edgeRegion?: string; cached?: boolean; rate?: unknown };
      }
    | null;
  if (!j || j.ok === false) {
    throw new Error(j?.error ? `cortex edge: ${j.error}` : "cortex edge returned no payload");
  }
  const tel = j.telemetry ?? {};
  const header =
    `[cortex edge · ${tel.edgeRegion || "edge"} · ${Number(tel.latencyMs) || 0}ms${tel.cached ? " · cached" : ""}` +
    `${rateSuffix(tel.rate)}]`;
  const data = (j.data ?? {}) as Record<string, unknown>;
  if (action === "search") {
    const results = Array.isArray(data.results) ? (data.results as { title?: unknown; url?: unknown; description?: unknown }[]) : [];
    const lines = results
      .map((r, i) => {
        const t = typeof r.title === "string" ? r.title : "(untitled)";
        const u = typeof r.url === "string" ? r.url : "";
        const d = typeof r.description === "string" ? clip(r.description, 240) : "";
        return `${i + 1}. ${t} — ${u}${d ? ` — ${d}` : ""}`;
      })
      .join("\n");
    return { ok: true, content: `${header}\n\n${lines || "No results found."}` };
  }
  if (action === "crawl") {
    const pages = Array.isArray(data.pages)
      ? (data.pages as { url?: unknown; title?: unknown; markdown?: unknown }[])
      : [];
    const sections = pages
      .map((pg, i) => {
        const t = typeof pg.title === "string" ? pg.title : "(untitled)";
        const u = typeof pg.url === "string" ? pg.url : "";
        const md = clip(typeof pg.markdown === "string" ? pg.markdown : "", 2200);
        return `## ${i + 1}. ${t}${u ? ` — ${u}` : ""}\n${md || "(empty)"}`;
      })
      .join("\n\n");
    const total = Number(data.totalPages) || pages.length;
    return {
      ok: true,
      content: `${header}\n\nCrawled ${total} page${total === 1 ? "" : "s"} (status: ${String(data.status ?? "unknown")}):\n\n${sections || "(no pages returned)"}`,
    };
  }
  // scrape
  const meta = (data.metadata ?? {}) as { title?: unknown };
  const title = typeof meta.title === "string" ? meta.title : undefined;
  const markdown = typeof data.markdown === "string" ? data.markdown : "";
  const links = normalizeLinks(data.links).slice(0, 20);
  const parts = [header];
  if (title) parts.push(`# ${title}`);
  parts.push(clip(markdown, 6000) || "(empty page — the reader returned no markdown)");
  if (links.length) parts.push(`Links:\n${links.map((l) => `- ${l}`).join("\n")}`);
  return { ok: true, content: parts.join("\n\n"), title, links: links.length ? links : undefined };
}

// ─── Lane 2: direct Hyperbrowser (same body shapes the edge function uses) ───

async function hbPost(
  path: string,
  key: string,
  body: unknown,
  caller?: AbortSignal
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${HB_BASE}${path}`, {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: budgetSignal(CORTEX_TOOL_TIMEOUT_MS, caller),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`hyperbrowser ${path} HTTP ${res.status}: ${clip(t.replace(/\s+/g, " "), 160)}`);
  }
  return (await res.json().catch(() => null)) as Record<string, unknown> | null;
}

async function directLane(
  mode: "read" | "search" | "crawl",
  args: CortexScrapeArgs,
  hbKey: string,
  caller?: AbortSignal
): Promise<LaneOutcome> {
  const started = Date.now();
  const url = (args.url ?? "").trim();
  const query = (args.query ?? "").trim();
  if (mode === "search") {
    const j = await hbPost(
      "/web/search",
      hbKey,
      {
        query: query.slice(0, 500),
        ...(args.site?.trim() ? { filters: { site: args.site.trim() } } : {}),
      },
      caller
    );
    const data = (j?.data ?? {}) as { results?: unknown };
    const results = Array.isArray(data.results)
      ? (data.results as { title?: unknown; url?: unknown; description?: unknown }[])
      : [];
    const header = `[cortex direct · ${Date.now() - started}ms]`;
    const lines = results
      .map((r, i) => {
        const t = typeof r.title === "string" ? r.title : "(untitled)";
        const u = typeof r.url === "string" ? r.url : "";
        const d = typeof r.description === "string" ? clip(r.description, 240) : "";
        return `${i + 1}. ${t} — ${u}${d ? ` — ${d}` : ""}`;
      })
      .join("\n");
    return { ok: true, content: `${header}\n\n${lines || "No results found."}` };
  }
  if (mode === "crawl") {
    const maxPages = Math.min(Math.max(Number(args.maxPages) || 6, 1), 20);
    const start = await hbPost(
      "/web/crawl",
      hbKey,
      { url, crawlOptions: { maxPages, followLinks: true } },
      caller
    );
    const jobId = typeof start?.jobId === "string" ? start.jobId : "";
    if (!jobId) throw new Error("hyperbrowser crawl: no jobId");
    const deadline = Date.now() + 24_000;
    let payload: Record<string, unknown> | null = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if (caller?.aborted) throw new Error("aborted");
      try {
        const poll = await fetch(`${HB_BASE}/web/crawl/${jobId}`, {
          headers: { "x-api-key": hbKey },
          signal: budgetSignal(10_000, caller),
        });
        if (!poll.ok) continue;
        const j = (await poll.json().catch(() => null)) as Record<string, unknown> | null;
        if (j && (j.status === "completed" || j.status === "failed" || Array.isArray(j.data))) {
          payload = j;
          break;
        }
      } catch {
        /* poll is best-effort — the deadline governs */
      }
    }
    const header = `[cortex direct · ${Date.now() - started}ms]`;
    if (!payload) {
      return {
        ok: false,
        content: `${header}\n\ncrawl poll window elapsed without a completed job — try fewer pages or retry.`,
        error: "crawl poll timeout",
      };
    }
    const pages = Array.isArray(payload.data) ? (payload.data as { url?: unknown; metadata?: { title?: unknown }; markdown?: unknown }[]) : [];
    const sections = pages
      .slice(0, maxPages)
      .map((pg, i) => {
        const t = typeof pg.metadata?.title === "string" ? pg.metadata.title : "(untitled)";
        const u = typeof pg.url === "string" ? pg.url : "";
        const md = clip(typeof pg.markdown === "string" ? pg.markdown : "", 2200);
        return `## ${i + 1}. ${t}${u ? ` — ${u}` : ""}\n${md || "(empty)"}`;
      })
      .join("\n\n");
    const total = Number(payload.totalPages) || pages.length;
    return {
      ok: true,
      content: `${header}\n\nCrawled ${total} page${total === 1 ? "" : "s"} (status: ${String(payload.status ?? "unknown")}):\n\n${sections || "(no pages returned)"}`,
    };
  }
  // read
  const j = await hbPost(
    "/web/fetch",
    hbKey,
    {
      url,
      stealth: "auto",
      outputs: { formats: ["markdown", "links"], sanitize: "basic" },
      navigation: { waitUntil: "domcontentloaded", waitFor: 1200, timeoutMs: 20000 },
      cache: { maxAgeSeconds: 1800 },
    },
    caller
  );
  const data = (j?.data ?? {}) as { metadata?: { title?: unknown }; markdown?: unknown; links?: unknown };
  const title = typeof data.metadata?.title === "string" ? data.metadata.title : undefined;
  const links = normalizeLinks(data.links).slice(0, 20);
  const parts = [`[cortex direct · ${Date.now() - started}ms]`];
  if (title) parts.push(`# ${title}`);
  parts.push(clip(typeof data.markdown === "string" ? data.markdown : "", 6000) || "(empty page — the reader returned no markdown)");
  if (links.length) parts.push(`Links:\n${links.map((l) => `- ${l}`).join("\n")}`);
  return { ok: true, content: parts.join("\n\n"), title, links: links.length ? links : undefined };
}

// ─── Orchestrator: the lane ladder ───────────────────────────────────────────

/**
 * Run the Cortex deep-web lane ladder for one deep_scrape call. NEVER throws —
 * every failure degrades to the next lane and finally to the CORTEX_FALLBACK
 * marker (read/search) or an honest explanatory error (crawl), so the agent
 * step always gets usable output when read_url/web_search can still answer.
 */
export async function cortexDeepScrape(
  args: CortexScrapeArgs,
  cfg?: CortexConfig,
  signal?: AbortSignal
): Promise<CortexScrapeResult> {
  const started = Date.now();
  const mode: "read" | "search" | "crawl" =
    args.mode === "search" || args.mode === "crawl" ? args.mode : "read";
  const url = (args.url ?? "").trim();
  const query = (args.query ?? "").trim();

  // Argument validation — falling back cannot fix a missing input (read_url /
  // web_search would throw the same), so answer with a direct honest error.
  if (mode === "search" && !query) {
    return {
      ok: false,
      lane: "off",
      content: 'deep_scrape mode="search" requires a query argument.',
      ms: 0,
      error: "query is required for mode=search",
    };
  }
  if (mode !== "search" && !url) {
    return {
      ok: false,
      lane: "off",
      content: `deep_scrape mode="${mode}" requires a url argument (full https:// URL).`,
      ms: 0,
      error: "url is required",
    };
  }

  const fnUrl = (cfg?.url ?? "").trim();
  const hbKey = (cfg?.hbKey ?? "").trim();
  const errors: string[] = [];

  // Lane 1 — edge function.
  if (fnUrl) {
    try {
      const out = await edgeLane(mode, args, { url: fnUrl, key: cfg?.key, hbKey: cfg?.hbKey }, signal);
      if (out.ok) return { ...out, lane: "edge", ms: Date.now() - started };
      errors.push(`edge: ${out.error ?? "failed"}`);
    } catch (e) {
      if (signal?.aborted) {
        return { ok: false, lane: "edge", content: "deep_scrape aborted.", ms: Date.now() - started, error: "aborted" };
      }
      errors.push(`edge: ${errText(e)}`);
    }
  }

  // Lane 2 — direct Hyperbrowser with the BYOK key (server-side always works;
  // from the browser this may hit CORS — caught and reported honestly).
  if (hbKey) {
    try {
      const out = await directLane(mode, args, hbKey, signal);
      if (out.ok) return { ...out, lane: "direct", ms: Date.now() - started };
      errors.push(`direct: ${out.error ?? "failed"}`);
    } catch (e) {
      if (signal?.aborted) {
        return { ok: false, lane: "direct", content: "deep_scrape aborted.", ms: Date.now() - started, error: "aborted" };
      }
      const raw = errText(e);
      const msg = /failed to fetch|networkerror|load failed/i.test(raw)
        ? "direct Hyperbrowser unreachable (CORS or network) — the edge lane or server relay carries this lane"
        : raw;
      errors.push(`direct: ${msg}`);
    }
  }

  // Lane 3 — fallback (or "off" when no lane was configured at all).
  const lane: CortexLane = fnUrl || hbKey ? "fallback" : "off";
  const note = errors.length ? ` (note: ${errors.join("; ")})` : "";
  if (mode === "crawl") {
    return {
      ok: false,
      lane,
      content:
        `crawl needs the Cortex Edge function or a Hyperbrowser key (Settings → Cortex Edge).` +
        (note ? `\n${note}` : ""),
      ms: Date.now() - started,
      error: errors.join("; ") || "no cortex lane configured",
    };
  }
  // read / search → hand the decision back to the server executor, which owns
  // the existing read_url / web_search implementations.
  return {
    ok: true,
    lane,
    content: CORTEX_FALLBACK,
    ms: Date.now() - started,
    ...(errors.length ? { error: errors.join("; ") } : {}),
  };
}

// ─── v2 lanes: semantic memory (cortex_memory tool) ──────────────────────────

export interface CortexMemoryArgs {
  /** remember = store · recall = semantic search (default). */
  mode?: "remember" | "recall";
  /** remember: knowledge to store (clipped 12000) · recall: the query. Validated first. */
  text?: string;
  /** Optional label (note | scrape | dossier | frontier, default "note"). */
  kind?: string;
  /** recall only: max hits 1-10, default 5. */
  topK?: number;
}

export interface CortexMemoryResult {
  ok: boolean;
  lane: "edge" | "direct" | "off";
  content: string;
  ms: number;
  error?: string;
}

/** Memory has NO fallback lane — read_url/web_search cannot answer memory. */
const MEMORY_OFF_MESSAGE =
  "Cortex memory needs the Cortex Edge function or an Upstash Vector index " +
  "(Settings → Cortex Edge → Semantic memory — the index must use an Upstash-hosted " +
  "embedding model, e.g. hybrid text-embedding-3-small/BM25)";

const MEMORY_THRESHOLD = 0.5;

/** Numbered recall lines shared by both lanes: "{i}. {score} — {data} ({kind}, {source})". */
function memoryRecallLines(hits: unknown[]): string {
  return hits
    .map((h, i) => {
      const hit = (h ?? {}) as { score?: unknown; data?: unknown; metadata?: unknown };
      const meta = isObj(hit.metadata) ? hit.metadata : {};
      const score = Number(hit.score ?? 0).toFixed(2);
      const data = clip(typeof hit.data === "string" ? hit.data : "", 300);
      const kind = typeof meta.kind === "string" && meta.kind ? meta.kind : "note";
      const source = typeof meta.source === "string" && meta.source ? meta.source : "edge";
      return `${i + 1}. ${score} — ${data} (${kind}, ${source})`;
    })
    .join("\n");
}

/**
 * Semantic memory over the owner's free Upstash Vector index (auto-embeddings
 * — no embedding API calls). NEVER throws: missing args answer honestly, the
 * edge lane tries memory.put/memory.query with the BYOK keys, the direct lane
 * dials Vector REST (browser CORS caught honestly), and with no lane at all
 * the result explains exactly what to configure.
 */
export async function cortexMemory(
  args: CortexMemoryArgs,
  cfg?: CortexConfig,
  signal?: AbortSignal
): Promise<CortexMemoryResult> {
  const started = Date.now();
  const mode: "remember" | "recall" = args?.mode === "remember" ? "remember" : "recall";
  const text = (args?.text ?? "").trim();
  const kind = (args?.kind ?? "").trim();

  // Validation first — no lane can fix a missing payload.
  if (!text) {
    return {
      ok: false,
      lane: "off",
      content: `cortex_memory mode="${mode}" requires a text argument (remember: the knowledge to store · recall: the query).`,
      ms: 0,
      error: "text is required",
    };
  }

  const fnUrl = (cfg?.url ?? "").trim();
  const vectorUrl = (cfg?.vectorUrl ?? "").trim();
  const vectorToken = (cfg?.vectorToken ?? "").trim();
  const errors: string[] = [];

  // Lane 1 — edge function (memory.put / memory.query).
  if (fnUrl) {
    try {
      const action = mode === "remember" ? "memory.put" : "memory.query";
      const params =
        mode === "remember"
          ? { text: clip(text, 12000), kind: kind || "note", source: "nexus-agent" }
          : {
              text,
              topK: clampInt(args?.topK, 1, 10, 5),
              threshold: MEMORY_THRESHOLD,
              ...(kind ? { kind } : {}),
            };
      const keys = byokKeys(cfg);
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg?.key?.trim() ? { "x-nexus-cortex-key": cfg.key.trim() } : {}),
        },
        body: JSON.stringify({ action, params, ...(keys ? { keys } : {}) }),
        signal: budgetSignal(CORTEX_TOOL_TIMEOUT_MS, signal),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`cortex edge HTTP ${res.status}: ${clip(body.replace(/\s+/g, " "), 160)}`);
      }
      const j = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            id?: unknown;
            kind?: unknown;
            results?: unknown;
            telemetry?: { latencyMs?: number; edgeRegion?: string; rate?: unknown };
          }
        | null;
      if (!j || j.ok === false) {
        throw new Error(j?.error ? `cortex edge: ${j.error}` : "cortex edge returned no payload");
      }
      const ms = Number(j.telemetry?.latencyMs) || Date.now() - started;
      const header = `[cortex memory · edge · ${ms}ms${rateSuffix(j.telemetry?.rate)}]`;
      if (mode === "remember") {
        const id = typeof j.id === "string" && j.id ? j.id : "unknown";
        const k = typeof j.kind === "string" && j.kind ? j.kind : kind || "note";
        return {
          ok: true,
          lane: "edge",
          content: `${header}\n\nstored as ${id} (kind ${k}) — recall it with mode=recall`,
          ms: Date.now() - started,
        };
      }
      const hits = Array.isArray(j.results) ? j.results : [];
      return {
        ok: true,
        lane: "edge",
        content: `${header}\n\n${hits.length ? memoryRecallLines(hits) : `no memories above threshold ${MEMORY_THRESHOLD} — remember some first`}`,
        ms: Date.now() - started,
      };
    } catch (e) {
      if (signal?.aborted) {
        return { ok: false, lane: "edge", content: "cortex_memory aborted.", ms: Date.now() - started, error: "aborted" };
      }
      errors.push(`edge: ${errText(e)}`);
    }
  }

  // Lane 2 — direct Upstash Vector REST (server-side always; from the BROWSER
  // this may hit CORS — caught and reported honestly).
  if (vectorUrl && vectorToken) {
    try {
      if (mode === "remember") {
        const id = `mem_${await sha16(text)}`;
        const res = await fetch(`${vectorUrl}/upsert-data`, {
          method: "POST",
          headers: { authorization: `Bearer ${vectorToken}`, "content-type": "application/json" },
          body: JSON.stringify({
            id,
            data: clip(text, 12000),
            metadata: { kind: kind || "note", source: "nexus-agent", at: new Date().toISOString() },
          }),
          signal: budgetSignal(CORTEX_TOOL_TIMEOUT_MS, signal),
        });
        const j = (await res.json().catch(() => null)) as { result?: unknown; error?: unknown } | null;
        if (!res.ok || (j && "error" in j)) {
          throw new Error(`vector upsert HTTP ${res.status}: ${clip(String(j?.error ?? ""), 160)}`);
        }
        return {
          ok: true,
          lane: "direct",
          content: `[cortex memory · direct · ${Date.now() - started}ms]\n\nstored as ${id} (kind ${kind || "note"}) — recall it with mode=recall`,
          ms: Date.now() - started,
        };
      }
      const topK = clampInt(args?.topK, 1, 10, 5);
      const res = await fetch(`${vectorUrl}/query-data`, {
        method: "POST",
        headers: { authorization: `Bearer ${vectorToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          data: text,
          topK,
          includeMetadata: true,
          includeData: true,
          queryMode: "DENSE",
        }),
        signal: budgetSignal(CORTEX_TOOL_TIMEOUT_MS, signal),
      });
      const j = (await res.json().catch(() => null)) as { result?: unknown; error?: unknown } | null;
      if (!res.ok || (j && "error" in j)) {
        throw new Error(`vector query HTTP ${res.status}: ${clip(String(j?.error ?? ""), 160)}`);
      }
      const raw = Array.isArray(j?.result) ? j.result : [];
      const hits = raw
        .filter((h) => {
          const hit = (h ?? {}) as { score?: unknown; metadata?: unknown };
          if (Number(hit.score ?? 0) < MEMORY_THRESHOLD) return false;
          if (!kind) return true;
          const meta = isObj(hit.metadata) ? hit.metadata : {};
          return meta.kind === kind;
        })
        .slice(0, topK);
      return {
        ok: true,
        lane: "direct",
        content: `[cortex memory · direct · ${Date.now() - started}ms]\n\n${hits.length ? memoryRecallLines(hits) : `no memories above threshold ${MEMORY_THRESHOLD} — remember some first`}`,
        ms: Date.now() - started,
      };
    } catch (e) {
      if (signal?.aborted) {
        return { ok: false, lane: "direct", content: "cortex_memory aborted.", ms: Date.now() - started, error: "aborted" };
      }
      const raw = errText(e);
      const msg = /failed to fetch|networkerror|load failed/i.test(raw)
        ? "direct Vector unreachable (CORS or network)"
        : raw;
      errors.push(`direct: ${msg}`);
    }
  }

  // Lane off / exhausted — memory has NO read_url/web_search fallback.
  const note = errors.length ? `\n(note: ${errors.join("; ")})` : "";
  return {
    ok: false,
    lane: "off",
    content: `${MEMORY_OFF_MESSAGE}${note}`,
    ms: Date.now() - started,
    error: errors.join("; ") || "no cortex memory lane configured",
  };
}

// ─── v2 lanes: sandbox shell (sandbox_exec tool) ─────────────────────────────────

export interface CortexSandboxArgs {
  /** Shell command run via `sh -c` (required — validated first). */
  command?: string;
  /** Command timeout in seconds (5-120, default 30). */
  timeoutSec?: number;
}

export interface CortexSandboxResult {
  ok: boolean;
  lane: "edge" | "direct" | "off";
  content: string;
  ms: number;
  error?: string;
}

/** Sandbox has NO fallback lane — a plain JS runner cannot execute shell commands. */
const SANDBOX_OFF_MESSAGE =
  "Sandbox needs the Cortex Edge function or Upstash Box keys " +
  "(Settings → Cortex Edge → Sandbox — free tier: 5 CPU-hours/month)";

/** Shared sandbox output shape: provenance header + exit code + clipped output. */
function sandboxContent(header: string, exitCode: number, output: string, stderr: string): string {
  const parts = [header, `exit ${exitCode}`, clip(output, 6000) || "(no output)"];
  let content = parts.join("\n\n");
  if (stderr) content += `\n\nstderr: ${clip(stderr, 500)}`;
  return content;
}

/**
 * Sandbox shell over the owner's free Upstash Box micro-VM (python/node/jq/…
 * available). NEVER throws: a missing command answers honestly, the edge lane
 * dials sandbox.exec with the BYOK keys, the direct lane dials the Box exec
 * API (browser CORS caught honestly), and with no lane at all the result
 * explains exactly what to configure.
 */
export async function cortexSandbox(
  args: CortexSandboxArgs,
  cfg?: CortexConfig,
  signal?: AbortSignal
): Promise<CortexSandboxResult> {
  const started = Date.now();
  const command = (args?.command ?? "").trim();

  // Validation first — no lane can fix a missing command.
  if (!command) {
    return {
      ok: false,
      lane: "off",
      content: 'sandbox_exec requires a command argument (a shell command run via sh -c, e.g. "python3 -c \'print(2+2)\'").',
      ms: 0,
      error: "command is required",
    };
  }

  const timeoutSec = clampInt(args?.timeoutSec, 5, 120, 30);
  const timeoutMs = timeoutSec * 1000;
  const fnUrl = (cfg?.url ?? "").trim();
  const boxApiKey = (cfg?.boxApiKey ?? "").trim();
  const boxId = (cfg?.boxId ?? "").trim();
  const regionRaw = (cfg?.boxRegion ?? "").trim();
  const region = /^[a-z0-9-]{2,20}$/i.test(regionRaw) ? regionRaw.toLowerCase() : "us-east-1";
  const errors: string[] = [];

  // Lane 1 — edge function (sandbox.exec; edge request must outlive the command).
  if (fnUrl) {
    try {
      const keys = byokKeys(cfg);
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg?.key?.trim() ? { "x-nexus-cortex-key": cfg.key.trim() } : {}),
        },
        body: JSON.stringify({
          action: "sandbox.exec",
          params: { command, timeoutMs },
          ...(keys ? { keys } : {}),
        }),
        signal: budgetSignal(timeoutMs + 8_000, signal),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`cortex edge HTTP ${res.status}: ${clip(body.replace(/\s+/g, " "), 160)}`);
      }
      const j = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            exitCode?: unknown;
            output?: unknown;
            telemetry?: { latencyMs?: number; edgeRegion?: string; rate?: unknown };
          }
        | null;
      if (!j || j.ok === false) {
        throw new Error(j?.error ? `cortex edge: ${j.error}` : "cortex edge returned no payload");
      }
      const ms = Number(j.telemetry?.latencyMs) || Date.now() - started;
      const header = `[cortex sandbox · edge · ${ms}ms${rateSuffix(j.telemetry?.rate)}]`;
      return {
        ok: true,
        lane: "edge",
        // On a SUCCESS payload the edge's `error` field is the box's stderr.
        content: sandboxContent(
          header,
          Number(j.exitCode ?? -1),
          typeof j.output === "string" ? j.output : "",
          typeof j.error === "string" ? j.error : ""
        ),
        ms: Date.now() - started,
      };
    } catch (e) {
      if (signal?.aborted) {
        return { ok: false, lane: "edge", content: "sandbox_exec aborted.", ms: Date.now() - started, error: "aborted" };
      }
      errors.push(`edge: ${errText(e)}`);
    }
  }

  // Lane 2 — direct Upstash Box exec API (server-side always; from the BROWSER
  // this may hit CORS — caught and reported honestly).
  if (boxApiKey && boxId) {
    try {
      const res = await fetch(
        `https://${region}.box.upstash.com/v2/box/${encodeURIComponent(boxId)}/exec`,
        {
          method: "POST",
          headers: { "X-Box-Api-Key": boxApiKey, "content-type": "application/json" },
          body: JSON.stringify({ command: ["sh", "-c", command] }),
          signal: budgetSignal(timeoutMs + 2_000, signal),
        }
      );
      const j = (await res.json().catch(() => null)) as
        | { exit_code?: unknown; output?: unknown; error?: unknown }
        | null;
      if (!res.ok || !j) {
        throw new Error(`box exec HTTP ${res.status}${j?.error ? `: ${clip(String(j.error), 160)}` : ""}`);
      }
      return {
        ok: true,
        lane: "direct",
        content: sandboxContent(
          `[cortex sandbox · direct · ${Date.now() - started}ms]`,
          Number(j.exit_code ?? -1),
          typeof j.output === "string" ? j.output : "",
          typeof j.error === "string" ? j.error : ""
        ),
        ms: Date.now() - started,
      };
    } catch (e) {
      if (signal?.aborted) {
        return { ok: false, lane: "direct", content: "sandbox_exec aborted.", ms: Date.now() - started, error: "aborted" };
      }
      const raw = errText(e);
      const msg = /failed to fetch|networkerror|load failed/i.test(raw)
        ? "direct Box unreachable (CORS or network)"
        : raw;
      errors.push(`direct: ${msg}`);
    }
  }

  // Lane off / exhausted — the sandbox has NO fallback lane.
  const note = errors.length ? `\n(note: ${errors.join("; ")})` : "";
  return {
    ok: false,
    lane: "off",
    content: `${SANDBOX_OFF_MESSAGE}${note}`,
    ms: Date.now() - started,
    error: errors.join("; ") || "no sandbox lane configured",
  };
}
