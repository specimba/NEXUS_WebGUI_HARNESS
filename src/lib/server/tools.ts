import vm from "node:vm";
import { inspect } from "node:util";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import ZAI from "z-ai-web-dev-sdk";
import { TOOL_META } from "../constants";
import { buildToolDefs, type ToolDef, type ToolResult } from "../tools-defs";
import { guardPublicUrl } from "./url-guard";

// ─── Tool execution engine (server-side only) ────────────────────────────────
// Schemas live in ../tools-defs.ts (isomorphic — the browser-direct engine
// shares them); this module is the SERVER executor (ZAI search, vm sandbox).

export { buildToolDefs };
export type { ToolDef, ToolResult };

// Lazy SDK singleton
let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;
async function getZai() {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

export async function executeTool(
  name: string,
  argsJson: string,
  signal?: AbortSignal
): Promise<ToolResult> {
  const started = Date.now();
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    args = {};
  }

  try {
    let content: string;
    switch (name) {
      case "web_search":
        content = await doWebSearch(args, signal);
        break;
      case "read_url":
        content = await doReadUrl(args);
        break;
      case "run_code":
        content = doRunCode(args);
        break;
      case "current_time":
        content = doCurrentTime();
        break;
      case "arxiv_search":
        content = await doArxivSearch(args, signal);
        break;
      case "wikipedia_search":
        content = await doWikipediaSearch(args, signal);
        break;
      case "hacker_news_search":
        content = await doHackerNewsSearch(args, signal);
        break;
      case "github_repo_read":
        content = await doGithubRepoRead(args, signal);
        break;
      case "package_info":
        content = await doPackageInfo(args, signal);
        break;
      case "market_rates":
        content = await doMarketRates(args, signal);
        break;
      case "uuid_hash":
        content = doUuidHash(args);
        break;
      case "image_generate":
        content = await doImageGenerate(args);
        break;
      case "tts_speak":
        content = await doTtsSpeak(args);
        break;
      default:
        return { ok: false, content: `Unknown tool: ${name}`, ms: 0 };
    }
    return { ok: true, content: clip(content, 7000), ms: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, content: `Tool error: ${message}`, ms: Date.now() - started };
  }
}

// ─── web_search ──────────────────────────────────────────────────────────────
async function doWebSearch(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("query is required");
  const num = Math.min(Math.max(Number(args.num ?? 6) || 6, 1), 10);
  const zai = await getZai();
  // r25: search stalls used to hang the whole step — 15s budget, same
  // envelope shape on timeout as any other tool failure.
  const SEARCH_TIMEOUT_MS = 15_000;
  const results = (await Promise.race([
    zai.functions.invoke("web_search", { query, num }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("web_search timed out after 15s")), SEARCH_TIMEOUT_MS)
    ),
    ...(signal
      ? [
          new Promise<never>((_, reject) =>
            signal.addEventListener("abort", () => reject(new Error("web_search aborted")), { once: true })
          ),
        ]
      : []),
  ])) as Array<{
    url?: string;
    name?: string;
    snippet?: string;
    host_name?: string;
    date?: string;
  }>;
  if (!Array.isArray(results) || results.length === 0) return "No results found.";
  // r29 relevance hygiene: drop duplicate URLs and cap per-host spam (3) so
  // one loud domain can't crowd out the topic in a briefing digest.
  const seenUrls = new Set<string>();
  const hostCount = new Map<string, number>();
  const fresh = results.filter((r) => {
    const u = (r.url ?? "").replace(/[#?].*$/, "");
    if (u && seenUrls.has(u)) return false;
    const host = (r.host_name ?? "").toLowerCase();
    if (host) {
      const n = hostCount.get(host) ?? 0;
      if (n >= 3) return false;
      hostCount.set(host, n + 1);
    }
    if (u) seenUrls.add(u);
    return true;
  });
  if (fresh.length === 0) return "No results found.";
  return fresh
    .map(
      (r, i) =>
        `${i + 1}. ${r.name ?? "(untitled)"}${r.host_name ? ` — ${r.host_name}` : ""}${
          r.date ? ` (${r.date})` : ""
        }\n   ${r.snippet ?? ""}\n   URL: ${r.url ?? "n/a"}`
    )
    .join("\n");
}

// ─── read_url ────────────────────────────────────────────────────────────────
async function doReadUrl(args: Record<string, unknown>): Promise<string> {
  const url = String(args.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("A full http(s) URL is required");
  // r26 SECURITY: read_url fetches model-chosen URLs — block loopback /
  // private-range / metadata targets before the request leaves the server.
  // r26.2: redirects are followed MANUALLY (≤3 hops) with a FRESH SSRF check
  // per hop. `redirect: "follow"` let a public URL bounce to a private or
  // metadata target inside fetch(), bypassing the pre-flight check entirely.
  let target = url;
  const MAX_HOPS = 3;
  for (let hop = 0; ; hop++) {
    const verdict = guardPublicUrl(target, { allowHttp: true });
    if (!verdict.ok) throw new Error(`Blocked by the SSRF guard: ${verdict.reason}`);
    // r29 fetch policy (Autonomous-Pipelines doctrine): ONE polite retry for
    // bot-walls (403) and transient throttles (429/503), upgrading to a
    // browser UA — 404/410 are terminal (a dead link stays dead). The retry
    // only fires while the caller's time budget has headroom, so the total
    // stays under the executor's 30s tool-call timeout.
    const readStart = Date.now();
    let res = await fetch(target, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PraisonAgent/1.0; +https://github.com/specimba/PraisonAI)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
    });
    if ((res.status === 403 || res.status === 429 || res.status === 503) && Date.now() - readStart < 10_000) {
      res.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, 2_000));
      res = await fetch(target, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(12_000),
        redirect: "manual",
      });
    }
    if (res.status >= 300 && res.status < 400) {
      res.body?.cancel().catch(() => {});
      const location = res.headers.get("location");
      if (!location) throw new Error(`HTTP ${res.status} for ${target} without a Location header`);
      if (hop >= MAX_HOPS) throw new Error(`Too many redirects (> ${MAX_HOPS}) fetching ${url}`);
      try {
        target = new URL(location, target).toString();
      } catch {
        throw new Error(`Invalid redirect target "${location}"`);
      }
      continue; // re-guard the new target before following it
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${target}`);
    const type = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    let text: string;
    if (type.includes("html")) {
      text = htmlToText(raw);
    } else if (type.includes("json")) {
      try {
        text = JSON.stringify(JSON.parse(raw), null, 1);
      } catch {
        text = raw;
      }
    } else {
      text = raw;
    }
    return `Content of ${target} (${type || "unknown type"}):\n\n${clip(text, 7000)}`;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

// ─── run_code (node:vm sandbox) ──────────────────────────────────────────────
function doRunCode(args: Record<string, unknown>): string {
  const code = String(args.code ?? "");
  if (!code.trim()) throw new Error("code is required");
  const logs: string[] = [];
  const push = (...parts: unknown[]) => {
    logs.push(
      parts
        .map((p) => (typeof p === "string" ? p : inspect(p, { depth: 3, maxArrayLength: 50 })))
        .join(" ")
    );
    if (logs.length > 200) logs.splice(0, logs.length - 200);
  };
  // r26 SECURITY FIX: the sandbox used to be SEEDED WITH HOST-REALM objects
  // (Math, JSON, Date, Promise, structuredClone, TextEncoder, …). Any host
  // object exposes .constructor.constructor — the HOST Function — so code as
  // simple as Math.constructor.constructor("return process")() escaped to
  // full Node RCE. The sandbox is now a BARE vm context: a fresh realm whose
  // intrinsics (Math/JSON/Date/Promise/Map/Set/…) belong to that realm and
  // hold NO reference back to the host. Console capture is realm-local too:
  // a prelude defines console INSIDE the context writing to a context-local
  // array, so no host closure is reachable from user code. Host globals that
  // are not ECMAScript intrinsics (fetch, setTimeout, process, require,
  // Buffer) do not exist in the bare context at all.
  const context = vm.createContext({}); // bare realm — zero host objects
  try {
    const prelude = new vm.Script(
      '"use strict"; var __logs = [];\n' +
      'var console = {\n' +
      '  log: (...a) => { __logs.push(a.map((x) => { try { return String(x); } catch { return "[unprintable]"; } })); if (__logs.length > 200) __logs.splice(0, __logs.length - 200); },\n' +
      '  info: (...a) => console.log(...a),\n' +
      '  warn: (...a) => console.log(...a),\n' +
      '  error: (...a) => console.log(...a),\n' +
      '  debug: () => {},\n' +
      '};',
      { filename: "agent-sandbox-prelude.js" }
    );
    prelude.runInContext(context, { timeout: 1000, displayErrors: true });
  } catch {
    /* the prelude is static — unreachable */
  }
  let result: unknown;
  try {
    // Try as an expression first (captures the completion value, e.g. "2+2").
    // Fall back to statement mode for multi-statement code (const/let/for/…).
    try {
      const expr = new vm.Script(`"use strict";\n(\n${code}\n)`, { filename: "agent-sandbox.js" });
      result = expr.runInContext(context, { timeout: 4000, displayErrors: true });
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      const stmts = new vm.Script(`"use strict";\n${code}`, { filename: "agent-sandbox.js" });
      result = stmts.runInContext(context, { timeout: 4000, displayErrors: true });
    }
  } catch (err) {
    const e = err as Error;
    const msg = logs.length ? `Output before failure:\n${logs.join("\n")}\n\n` : "";
    throw new Error(`${msg}${e.name}: ${e.message}`);
  }
  // Realm-local console capture → host-side rendering. Safe: values were
  // String()ed inside the context, so nothing host-reachable crosses over.
  try {
    const rows = vm.runInContext("__logs", context, { timeout: 1000 }) as unknown;
    if (Array.isArray(rows)) {
      for (const row of rows.slice(-200)) {
        push(Array.isArray(row) ? row.join(" ") : String(row));
      }
    }
  } catch {
    /* user code reassigned __logs — fall back to no console capture */
  }
  let out = "";
  if (logs.length) out += `${logs.join("\n")}\n`;
  if (result !== undefined)
    out += `Return value: ${inspect(result, { depth: 4, maxArrayLength: 100 })}`;
  return out.trim() || "(no output — code ran without errors)";
}

// ─── current_time ────────────────────────────────────────────────────────────
function doCurrentTime(): string {
  const now = new Date();
  return `Current time: ${now.toUTCString()} (UTC)\nISO: ${now.toISOString()}`;
}

// ─── arxiv_search (r26) ──────────────────────────────────────────────────────
// Public arXiv Atom API — no key, no tracking, user-triggered queries only.
// Every result carries its alphaXiv mirror link (community discussion and
// ratings: https://www.alphaxiv.org/abs/<id>) so papers reach both surfaces.
const ARXIV_TIMEOUT_MS = 15_000;

async function doArxivSearch(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("query is required");
  const max = Math.min(Math.max(Number(args.max_results ?? 8) || 8, 1), 20);
  const sortMap: Record<string, string> = {
    relevance: "relevance",
    submittedDate: "submittedDate",
    lastUpdatedDate: "lastUpdatedDate",
  };
  const sort = sortMap[String(args.sort ?? "relevance")] ?? "relevance";
  const feedUrl =
    `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}` +
    `&start=0&max_results=${max}&sortBy=${sort}&sortOrder=descending`;

  const res = (await Promise.race([
    fetch(feedUrl, {
      headers: {
        "User-Agent": "PraisonAgent/1.0 (research tool; +https://github.com/specimba/PraisonAI)",
      },
      signal: AbortSignal.timeout(ARXIV_TIMEOUT_MS),
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("arxiv_search timed out after 15s")), ARXIV_TIMEOUT_MS)
    ),
    ...(signal
      ? [
          new Promise<never>((_, reject) =>
            signal.addEventListener("abort", () => reject(new Error("arxiv_search aborted")), { once: true })
          ),
        ]
      : []),
  ])) as Response;
  if (!res.ok) throw new Error(`arXiv API HTTP ${res.status}`);
  const xml = await res.text();
  const papers = parseArxivFeed(xml);
  if (papers.length === 0) {
    return 'No arXiv papers matched that query. Try broader keywords or arXiv field syntax, e.g. all:"agent memory" AND cat:cs.CL.';
  }
  return papers
    .map(
      (p, i) =>
        `${i + 1}. ${p.title}\n   Authors: ${p.authors}\n   Published: ${p.published}  |  arXiv:${p.id}\n   PDF: ${p.pdf}\n   alphaXiv (discussion): https://www.alphaxiv.org/abs/${p.id}\n   Abstract: ${p.summary}`
    )
    .join("\n\n");
}

interface ArxivPaper {
  id: string;
  title: string;
  authors: string;
  published: string;
  summary: string;
  pdf: string;
}

export type { ArxivPaper };

/**
 * arXiv Atom feed → paper list. Exported (r26) so server routes outside the
 * tool engine (e.g. /api/radar/papers) reuse the exact same parser.
 */
export function parseArxivFeed(xml: string): ArxivPaper[] {
  const out: ArxivPaper[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  const tag = (block: string, name: string): string => {
    const t = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block);
    return t ? decodeXml(t[1]).replace(/\s+/g, " ").trim() : "";
  };
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const absId = /arxiv\.org\/abs\/([\w.\-/]+)/.exec(tag(block, "id"))?.[1] ?? "";
    const id = absId.replace(/v\d+$/, "");
    if (!id) continue;
    const allAuthors = [...block.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((a) =>
      decodeXml(a[1]).trim()
    );
    const authors =
      allAuthors.slice(0, 4).join(", ") +
      (allAuthors.length > 4 ? ` +${allAuthors.length - 4} more` : "");
    const summaryFull = tag(block, "summary");
    const pdfMatch =
      /<link[^>]*title="pdf"[^>]*href="([^"]+)"/.exec(block) ??
      /<link[^>]*href="([^"]+\.pdf[^"]*)"/.exec(block);
    out.push({
      id,
      title: tag(block, "title"),
      authors: authors || "Unknown",
      published: tag(block, "published").slice(0, 10),
      summary: summaryFull.length > 420 ? `${summaryFull.slice(0, 420)}…` : summaryFull,
      pdf: pdfMatch?.[1] ?? `https://arxiv.org/pdf/${id}`,
    });
  }
  return out;
}

export function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ─── r26-3 shared plumbing for the keyless network tools ────────────────────
// Every outbound URL these tools build is either a PINNED API host or a URL
// constructed by interpolating ARGS (repo slugs, package names, coin ids) —
// exactly the class guardPublicUrl exists for. guardedFetch re-runs the guard
// on every redirect hop (same doctrine as the r26.2 read_url fix).

const PRAISON_UA =
  "Mozilla/5.0 (compatible; PraisonAgent/1.0; +https://github.com/specimba/PraisonAI)";

/** Caller abort + per-tool deadline, composed when the runtime supports it. */
function toolSignal(signal?: AbortSignal, timeoutMs = 15_000): AbortSignal | undefined {
  const timeout =
    typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
  if (!signal) return timeout;
  if (timeout && typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal;
}

/** SSRF-guarded fetch with UA + manual redirects (re-guarded per hop, ≤3). */
async function guardedFetch(
  url: string,
  opts?: { signal?: AbortSignal; headers?: Record<string, string>; timeoutMs?: number }
): Promise<Response> {
  let target = url;
  const MAX_HOPS = 3;
  for (let hop = 0; ; hop++) {
    const verdict = guardPublicUrl(target);
    if (!verdict.ok) throw new Error(`Blocked by the SSRF guard: ${verdict.reason}`);
    let res: Response;
    try {
      res = await fetch(target, {
        headers: { "User-Agent": PRAISON_UA, Accept: "application/json", ...(opts?.headers ?? {}) },
        signal: toolSignal(opts?.signal, opts?.timeoutMs ?? 15_000),
        redirect: "manual",
        // Live-data tools: never let the framework serve a stale cached body.
        cache: "no-store",
      });
    } catch (err) {
      if (err instanceof Error && /invalid url/i.test(err.message)) {
        throw new Error(`Blocked by the SSRF guard: invalid URL`);
      }
      throw err;
    }
    if (res.status >= 300 && res.status < 400) {
      res.body?.cancel().catch(() => {});
      const location = res.headers.get("location");
      if (!location) throw new Error(`HTTP ${res.status} for ${target} without a Location header`);
      if (hop >= MAX_HOPS) throw new Error(`Too many redirects (> ${MAX_HOPS}) fetching ${url}`);
      try {
        target = new URL(location, target).toString();
      } catch {
        throw new Error(`Invalid redirect target "${location}"`);
      }
      continue; // re-guard the new target before following it
    }
    return res;
  }
}

async function readJson(res: Response, what: string): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what}: unexpected non-JSON response (HTTP ${res.status})`);
  }
}

function str(args: Record<string, unknown>, key: string): string {
  return String(args[key] ?? "").trim();
}

function clampNum(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

// ─── wikipedia_search (r26-3) ─────────────────────────────────────────────────
// MediaWiki Action API, keyless: list=search for hits, then intro extracts for
// the top 3. Article URLs are the canonical /wiki/<Title> form.

async function doWikipediaSearch(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const query = str(args, "query");
  if (!query) throw new Error("query is required");
  const num = clampNum(args.num, 5, 1, 8);
  const searchUrl =
    `https://en.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(query)}&srlimit=${num}&format=json&origin=*`;
  const search = (await readJson(await guardedFetch(searchUrl, { signal }), "wikipedia_search")) as {
    query?: { search?: Array<{ title?: string; pageid?: number; snippet?: string }> };
  };
  const hits = search.query?.search ?? [];
  if (hits.length === 0) return `No Wikipedia articles matched "${query}".`;
  const wikiUrl = (title: string) =>
    `https://en.wikipedia.org/wiki/${encodeURIComponent(title).replace(/%20/g, "_")}`;
  const top = hits.slice(0, 3).filter((h) => h.pageid != null);
  let extracts = new Map<number, string>();
  if (top.length > 0) {
    const ids = top.map((h) => h.pageid).join("|");
    const extUrl =
      `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext` +
      `&pageids=${ids}&format=json&origin=*`;
    const ext = (await readJson(await guardedFetch(extUrl, { signal }), "wikipedia_search")) as {
      query?: { pages?: Record<string, { pageid?: number; extract?: string }> };
    };
    extracts = new Map(
      Object.values(ext.query?.pages ?? {})
        .filter((p) => p.pageid != null)
        .map((p) => [p.pageid as number, (p.extract ?? "").replace(/\s+/g, " ").trim()])
    );
  }
  return hits
    .map((h, i) => {
      const title = h.title ?? "(untitled)";
      const extract = h.pageid != null ? extracts.get(h.pageid) : undefined;
      const snippet = (h.snippet ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const body = extract || snippet || "(no summary returned)";
      return `${i + 1}. ${title}\n   URL: ${wikiUrl(title)}\n   ${body}`;
    })
    .join("\n\n");
}

// ─── hacker_news_search (r26-3) ───────────────────────────────────────────────
// Algolia's public HN Search API — keyless, no auth, read-only.

async function doHackerNewsSearch(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const query = str(args, "query");
  if (!query) throw new Error("query is required");
  const num = clampNum(args.num, 6, 1, 10);
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&hitsPerPage=${num}`;
  const data = (await readJson(await guardedFetch(url, { signal }), "hacker_news_search")) as {
    hits?: Array<{
      title?: string | null;
      story_title?: string | null;
      url?: string | null;
      story_url?: string | null;
      author?: string;
      points?: number | null;
      num_comments?: number | null;
      objectID?: string;
      story_id?: string;
      created_at?: string;
      comment_text?: string | null;
    }>;
  };
  const hits = data.hits ?? [];
  if (hits.length === 0) return `No Hacker News stories matched "${query}".`;
  return hits
    .map((h, i) => {
      const isComment = !h.title && !!h.comment_text; // Algolia comment hits carry story_* fields
      const title = h.title ?? h.story_title ?? (isComment ? "(comment)" : "(untitled)");
      const link =
        h.url ||
        h.story_url ||
        `https://news.ycombinator.com/item?id=${h.story_id ?? h.objectID ?? ""}`;
      const date = (h.created_at ?? "").slice(0, 10);
      const stats = isComment
        ? `comment by ${h.author ?? "unknown"}`
        : `${h.points ?? 0} points · ${h.num_comments ?? 0} comments · by ${h.author ?? "unknown"}`;
      const snippet = isComment
        ? `\n   ${(h.comment_text ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 240)}`
        : "";
      return `${i + 1}. ${title}\n   ${stats}${date ? ` · ${date}` : ""}\n   ${link}${snippet}`;
    })
    .join("\n");
}

// ─── github_repo_read (r26-3) ─────────────────────────────────────────────────
// api.github.com, keyless (60 req/h). Optional server-side GITHUB_TOKEN raises
// the quota — env-only, attached per request, never logged or shipped anywhere.

function githubAuthHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function doGithubRepoRead(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const repo = str(args, "repo").replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error('repo must be in "owner/repo" form, e.g. "microsoft/TypeScript"');
  }
  const headers = { ...githubAuthHeaders() };
  const metaRes = await guardedFetch(`https://api.github.com/repos/${repo}`, {
    signal,
    headers: { ...headers, Accept: "application/vnd.github+json" },
  });
  if (metaRes.status === 403 || metaRes.status === 429) {
    const remaining = metaRes.headers.get("x-ratelimit-remaining");
    throw new Error(
      remaining === "0"
        ? "GitHub API rate limit reached (60 req/hour keyless) — wait for the quota to reset or set a server-side GITHUB_TOKEN to raise it."
        : `GitHub API refused the request (HTTP ${metaRes.status})`
    );
  }
  if (!metaRes.ok) {
    throw new Error(metaRes.status === 404 ? `Repository "${repo}" not found (HTTP 404)` : `GitHub API HTTP ${metaRes.status}`);
  }
  const meta = (await readJson(metaRes, "github_repo_read")) as {
    full_name?: string;
    description?: string | null;
    html_url?: string;
    stargazers_count?: number;
    forks_count?: number;
    open_issues_count?: number;
    language?: string | null;
    license?: { spdx_id?: string | null } | null;
    default_branch?: string;
    updated_at?: string;
    homepage?: string | null;
    topics?: string[];
  };
  const lines: string[] = [
    `${meta.full_name ?? repo}${meta.description ? ` — ${meta.description}` : ""}`,
    `URL: ${meta.html_url ?? `https://github.com/${repo}`}`,
    `Stars: ${meta.stargazers_count ?? "?"} · Forks: ${meta.forks_count ?? "?"} · Open issues: ${meta.open_issues_count ?? "?"}`,
    `Language: ${meta.language ?? "unknown"} · License: ${meta.license?.spdx_id ?? "none declared"} · Default branch: ${meta.default_branch ?? "unknown"}`,
    meta.homepage ? `Homepage: ${meta.homepage}` : "",
    meta.topics?.length ? `Topics: ${meta.topics.slice(0, 8).join(", ")}` : "",
    `Last updated: ${(meta.updated_at ?? "").slice(0, 10)}`,
  ].filter(Boolean);

  // README — raw when the server honors the Accept header, base64-JSON fallback
  // otherwise (the b64 branch exists because some proxies rewrite Accept).
  try {
    const readmeRes = await guardedFetch(`https://api.github.com/repos/${repo}/readme`, {
      signal,
      headers: { ...headers, Accept: "application/vnd.github.raw+json" },
    });
    if (readmeRes.ok) {
      let text = await readmeRes.text();
      if (/^\s*{/.test(text)) {
        try {
          const parsed = JSON.parse(text) as { content?: string; encoding?: string };
          if (parsed.content && parsed.encoding === "base64") {
            text = Buffer.from(parsed.content, "base64").toString("utf8");
          }
        } catch {
          /* raw text after all */
        }
      }
      const trimmed = text.trim();
      if (trimmed) lines.push(`\nREADME (trimmed):\n${trimmed.slice(0, 3500)}${trimmed.length > 3500 ? "\n…[README truncated]" : ""}`);
    }
  } catch {
    lines.push("\nREADME: unavailable (fetch failed — the repo may be empty or the quota exhausted)");
  }

  if (args.include_issues === true) {
    try {
      const issuesRes = await guardedFetch(
        `https://api.github.com/repos/${repo}/issues?per_page=5&state=open`,
        { signal, headers: { ...headers, Accept: "application/vnd.github+json" } }
      );
      if (issuesRes.ok) {
        const issues = (await readJson(issuesRes, "github_repo_read")) as Array<{
          number?: number;
          title?: string;
          html_url?: string;
          user?: { login?: string };
          pull_request?: unknown;
        }>;
        const real = (Array.isArray(issues) ? issues : []).filter((i) => !i.pull_request).slice(0, 5);
        lines.push(
          `\nTop open issues:${real.length === 0 ? " none" : ""}` +
            real.map((i) => `\n- #${i.number} ${i.title ?? "(untitled)"}${i.user?.login ? ` (@${i.user.login})` : ""} — ${i.html_url ?? ""}`).join("")
        );
      }
    } catch {
      lines.push("\nOpen issues: unavailable (fetch failed)");
    }
  }
  return lines.join("\n");
}

// ─── package_info (r26-3) ─────────────────────────────────────────────────────
// npm registry + npm downloads API, with PyPI as the requested or automatic
// fallback ecosystem. All three endpoints are keyless.

async function doPackageInfo(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const pkg = str(args, "package").replace(/^npm:/i, "");
  if (!pkg || /[/\\]\.\.[/\\]/.test(pkg) || pkg.length > 214) {
    throw new Error('package is required (a package NAME like "zod", not a path or URL)');
  }
  const enc = encodeURIComponent(pkg);
  const wantPypi = args.ecosystem === "pypi";
  if (!wantPypi) {
    const res = await guardedFetch(`https://registry.npmjs.org/${enc}/latest`, { signal });
    if (res.ok) {
      const data = (await readJson(res, "package_info")) as {
        name?: string;
        version?: string;
        description?: string;
        homepage?: string;
        license?: string;
        dependencies?: Record<string, string>;
      };
      let downloads: number | null = null;
      try {
        const dl = (await readJson(
          await guardedFetch(`https://api.npmjs.org/downloads/point/last-week/${enc}`, { signal }),
          "package_info"
        )) as { downloads?: number };
        downloads = typeof dl.downloads === "number" ? dl.downloads : null;
      } catch {
        /* downloads API hiccup — non-fatal */
      }
      return [
        `${data.name ?? pkg}@${data.version ?? "?"} (npm)`,
        data.description ? `${data.description}` : "",
        data.homepage ? `Homepage: ${data.homepage}` : "",
        `License: ${data.license ?? "none declared"}`,
        `Dependencies: ${data.dependencies ? Object.keys(data.dependencies).length : 0}`,
        downloads != null ? `Downloads last week: ${downloads.toLocaleString("en-US")}` : "",
        `Registry: https://www.npmjs.com/package/${pkg}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (res.status !== 404) throw new Error(`npm registry HTTP ${res.status}`);
    if (args.ecosystem === "npm") throw new Error(`npm package "${pkg}" not found (HTTP 404)`);
    // fall through to PyPI
  }
  const pyRes = await guardedFetch(`https://pypi.org/pypi/${enc}/json`, { signal });
  if (!pyRes.ok) {
    throw new Error(
      pyRes.status === 404
        ? `Package "${pkg}" not found on npm${wantPypi ? "" : " or PyPI"} (HTTP 404)`
        : `PyPI HTTP ${pyRes.status}`
    );
  }
  const py = (await readJson(pyRes, "package_info")) as {
    info?: {
      name?: string;
      version?: string;
      summary?: string;
      home_page?: string;
      license?: string;
      requires_dist?: string[] | null;
    };
  };
  const info = py.info ?? {};
  return [
    `${info.name ?? pkg}${info.version ? ` ${info.version}` : ""} (PyPI)`,
    info.summary ?? "",
    info.home_page ? `Homepage: ${info.home_page}` : "",
    `License: ${info.license || "none declared"}`,
    `Dependencies: ${Array.isArray(info.requires_dist) ? info.requires_dist.length : 0}`,
    `Registry: https://pypi.org/project/${pkg}/`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── market_rates (r26-3) ─────────────────────────────────────────────────────
// Two keyless JSON GETs: CoinGecko simple/price (crypto) and open.er-api.com
// (fiat vs USD). INDICATIVE data — the description says so, the output repeats it.

async function doMarketRates(args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const coins = str(args, "coins") || "bitcoin,ethereum";
  const fiatRaw = str(args, "fiat");
  const fiat = fiatRaw
    ? fiatRaw
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{3}$/.test(c))
        .slice(0, 12)
    : [];
  const parts: string[] = [];

  if (str(args, "coins") || !fiatRaw) {
    const url =
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coins)}` +
      `&vs_currencies=usd,eur`;
    const data = (await readJson(await guardedFetch(url, { signal }), "market_rates")) as Record<
      string,
      { usd?: number; eur?: number } | { status?: { error_code?: number; error_message?: string } }
    >;
    const errStatus = (data as { status?: { error_code?: number; error_message?: string } }).status;
    if (errStatus && typeof errStatus === "object" && "error_code" in errStatus) {
      throw new Error(
        `CoinGecko refused the request (code ${errStatus.error_code ?? "?"}: ${errStatus.error_message ?? "rate limited or unknown ids"}) — wait a moment and retry, and use lowercase CoinGecko ids like "bitcoin" or "solana".`,
      );
    }
    const rows = Object.entries(data ?? {});
    if (rows.length === 0) {
      parts.push(`Crypto: no CoinGecko data for ids "${coins}" (ids are lowercase slugs like "bitcoin", "solana", "cardano").`);
    } else {
      parts.push(
        "Crypto (spot, indicative):\n" +
          rows
            .map(([id, p]) => {
              const price = p as { usd?: number; eur?: number } | undefined;
              return `- ${id}: $${price?.usd ?? "?"} / €${price?.eur ?? "?"}`;
            })
            .join("\n")
      );
    }
  }

  if (fiat.length > 0) {
    const data = (await readJson(
      await guardedFetch("https://open.er-api.com/v6/latest/USD", { signal }),
      "market_rates"
    )) as { result?: string; rates?: Record<string, number> };
    const rates = data.rates ?? {};
    const rows = fiat
      .filter((code) => rates[code] != null)
      .map((code) => `- 1 USD = ${rates[code]} ${code}`);
    parts.push(
      rows.length > 0
        ? `FX vs USD (indicative):\n${rows.join("\n")}`
        : `FX: no rates found for codes "${fiat.join(", ")}".`
    );
  }

  return parts.join("\n\n") + "\n\n(Indicative market data for context only — not financial advice.)";
}

// ─── uuid_hash (r26-3) ────────────────────────────────────────────────────────
// Models must not invent entropy or hashes (Jev jaggedness doctrine: keep
// crypto in code). Zero network, zero fs — the args are values, never paths.

function doUuidHash(args: Record<string, unknown>): string {
  const op = str(args, "op");
  switch (op) {
    case "uuid":
      return `UUIDv4: ${randomUUID()}`;
    case "sha256": {
      const value = str(args, "value");
      if (!value) throw new Error('sha256 requires the "value" argument');
      return `SHA-256 of ${value.length} char(s):\n${createHash("sha256").update(value, "utf8").digest("hex")}`;
    }
    case "hmac": {
      const value = str(args, "value");
      if (!value) throw new Error('hmac requires the "value" argument');
      const secret = str(args, "secret") || "praison";
      return `HMAC-SHA256 (secret ${secret ? `of ${secret.length} char(s)` : "default"}):\n${createHmac("sha256", secret).update(value, "utf8").digest("hex")}`;
    }
    case "random": {
      const length = clampNum(args.length, 16, 1, 128);
      return `Random hex (${length} byte${length === 1 ? "" : "s"}):\n${randomBytes(length).toString("hex")}`;
    }
    default:
      throw new Error(`Unknown op "${op}" — use one of: uuid, sha256, hmac, random`);
  }
}

// ─── image_generate (r26-3) ───────────────────────────────────────────────────
// SDK image generation via the same getZai() client the auto engine uses.
// STATUS-LINE ONLY: the binary is deliberately NOT returned into the chat —
// base64 images would blow up localStorage. The model directs the user to the
// Image Studio (the persisted, regenerable surface).

const IMAGE_SIZES = new Set(["1024x1024", "768x1344", "864x1152", "1344x768", "1152x864", "1440x720", "720x1440"]);

async function doImageGenerate(args: Record<string, unknown>): Promise<string> {
  const prompt = str(args, "prompt");
  if (!prompt) throw new Error("prompt is required");
  const requested = str(args, "size") || "1024x1024";
  if (!IMAGE_SIZES.has(requested)) {
    throw new Error(`size must be one of ${[...IMAGE_SIZES].join(", ")} (got "${requested}")`);
  }
  const zai = await getZai();
  const res = (await Promise.race([
    zai.images.generations.create({
      prompt,
      size: requested as "1024x1024",
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("image_generate timed out after 120s")), 120_000)
    ),
  ])) as { created?: number; data?: Array<{ base64?: string }> };
  const b64 = res?.data?.[0]?.base64 ?? "";
  if (!b64) throw new Error("the image backend returned no image data");
  const kb = Math.round((b64.length * 3) / 4 / 1024);
  const id = randomUUID().slice(0, 8);
  return (
    `Generated ${requested} image (id ${id}, ~${kb} KB) — the binary was discarded to keep chat storage light. ` +
    `Tell the user to open the Image Studio to generate and keep images; do not claim the image is attached.`
  );
}

// ─── tts_speak (r26-3) ────────────────────────────────────────────────────────
// SDK TTS (same zai.audio.tts path /api/tts uses). STATUS-LINE ONLY — audio is
// never embedded into chat messages (memory pressure); read-aloud lives on the
// reply's speaker button.

async function doTtsSpeak(args: Record<string, unknown>): Promise<string> {
  const raw = str(args, "text");
  if (!raw) throw new Error("text is required");
  const MAX_CHARS = 1000;
  const text = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) : raw;
  const voice = str(args, "voice") || "tongtong";
  const zai = await getZai();
  const res = (await Promise.race([
    zai.audio.tts.create({ input: text, voice, speed: 1, response_format: "pcm", stream: false }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("tts_speak timed out after 30s")), 30_000)
    ),
  ])) as Response;
  // The SDK returns a Response (same shape /api/tts consumes) — read the PCM
  // payload only to MEASURE it; the audio itself is discarded (status-line
  // doctrine: never embed base64 audio into chat/localStorage).
  const bytes = (await res.arrayBuffer()).byteLength;
  const seconds = bytes > 0 ? (bytes / 48_000).toFixed(1) : "?"; // 24 kHz × 16-bit mono
  return (
    `Speech generated: ${text.length} char${text.length === 1 ? "" : "s"}${raw.length > MAX_CHARS ? " (clipped from " + raw.length + ")" : ""} → ~${seconds}s of 24 kHz audio via voice "${voice}". ` +
    `Audio is not attached to this chat (storage pressure) — tell the user to use the speaker button on any reply for read-aloud playback.`
  );
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]`;
}

export function toolLabel(name: string): string {
  const entry = Object.entries(TOOL_META).find(([id]) => id === name);
  return entry ? entry[1].label : name;
}
