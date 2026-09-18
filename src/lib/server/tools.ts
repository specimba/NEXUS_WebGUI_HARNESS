import vm from "node:vm";
import { inspect } from "node:util";
import ZAI from "z-ai-web-dev-sdk";
import { TOOL_META } from "../constants";
import { buildToolDefs, type ToolDef, type ToolResult } from "../tools-defs";

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

export async function executeTool(name: string, argsJson: string): Promise<ToolResult> {
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
        content = await doWebSearch(args);
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
async function doWebSearch(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("query is required");
  const num = Math.min(Math.max(Number(args.num ?? 6) || 6, 1), 10);
  const zai = await getZai();
  const results = (await zai.functions.invoke("web_search", { query, num })) as Array<{
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
  const sandbox: Record<string, unknown> = {
    console: { log: push, info: push, warn: push, error: push, debug: () => {} },
    Math,
    JSON,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    structuredClone,
    TextEncoder,
    TextDecoder,
  };
  vm.createContext(sandbox);
  let result: unknown;
  try {
    // Try as an expression first (captures the completion value, e.g. "2+2").
    // Fall back to statement mode for multi-statement code (const/let/for/…).
    try {
      const expr = new vm.Script(`"use strict";\n(\n${code}\n)`, { filename: "agent-sandbox.js" });
      result = expr.runInContext(sandbox, { timeout: 4000, displayErrors: true });
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      logs.length = 0; // expression attempt may have logged before failing
      const stmts = new vm.Script(`"use strict";\n${code}`, { filename: "agent-sandbox.js" });
      result = stmts.runInContext(sandbox, { timeout: 4000, displayErrors: true });
    }
  } catch (err) {
    const e = err as Error;
    const msg = logs.length ? `Output before failure:\n${logs.join("\n")}\n\n` : "";
    throw new Error(`${msg}${e.name}: ${e.message}`);
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

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]`;
}

export function toolLabel(name: string): string {
  const entry = Object.entries(TOOL_META).find(([id]) => id === name);
  return entry ? entry[1].label : name;
}
