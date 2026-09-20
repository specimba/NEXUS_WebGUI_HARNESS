import vm from "node:vm";
import { inspect } from "node:util";
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
  return results
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
  const verdict = guardPublicUrl(url, { allowHttp: true });
  if (!verdict.ok) throw new Error(`Blocked by the SSRF guard: ${verdict.reason}`);
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; PraisonAgent/1.0; +https://github.com/specimba/PraisonAI)",
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
    },
    signal: AbortSignal.timeout(15_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
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
  return `Content of ${url} (${type || "unknown type"}):\n\n${clip(text, 7000)}`;
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

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]`;
}

export function toolLabel(name: string): string {
  const entry = Object.entries(TOOL_META).find(([id]) => id === name);
  return entry ? entry[1].label : name;
}
