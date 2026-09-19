// ─── Tool definitions (isomorphic) ───────────────────────────────────────────
// Pure, dependency-free tool schemas + types shared by BOTH engines:
//  • the server engine (src/lib/server/tools.ts — executes with ZAI/vm)
//  • the browser-direct engine (src/lib/agent-engine.ts — executes via
//    POST /api/tools/execute, so tool results still come from the server)
// Split out of server/tools.ts so client code never imports node:vm / ZAI.

import type { ToolId } from "./types";

export interface ToolResult {
  ok: boolean;
  content: string;
  ms: number;
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function buildToolDefs(tools: ToolId[]): ToolDef[] {
  const defs: Record<ToolId, ToolDef> = {
    web_search: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the web for current information. Returns ranked results with title, url, snippet and date. Use for anything time-sensitive, factual or external.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
            num: { type: "number", description: "Number of results (1-10), default 6" },
          },
          required: ["query"],
        },
      },
    },
    read_url: {
      type: "function",
      function: {
        name: "read_url",
        description:
          "Fetch a web page and return its readable text content. Use after web_search to read a promising source, or when the user gives you a URL.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "Full URL including https://" },
          },
          required: ["url"],
        },
      },
    },
    run_code: {
      type: "function",
      function: {
        name: "run_code",
        description:
          "Execute JavaScript (ES2022) in a secure sandbox. Use console.log for output; the value of the last expression is also returned. No network, no file access. Great for math, data transformations, algorithms, quick verification.",
        parameters: {
          type: "object",
          properties: {
            code: { type: "string", description: "JavaScript source code to run" },
          },
          required: ["code"],
        },
      },
    },
    current_time: {
      type: "function",
      function: {
        name: "current_time",
        description: "Get the current UTC date and time.",
        parameters: { type: "object", properties: {} },
      },
    },
  };
  return tools.map((t) => defs[t]).filter(Boolean);
}

/** The executor half — server implements directly, browser via /api/tools/execute. */
export type ToolExecutor = (name: string, argsJson: string, signal?: AbortSignal) => Promise<ToolResult>;

/** Bundled tool IO for the agent engine: schemas + executor. */
export interface EngineToolIO {
  defs: ToolDef[];
  execute: ToolExecutor;
}

/** Hard budget for one browser→server tool call (r25). */
const TOOL_CALL_TIMEOUT_MS = 30_000;

/**
 * Compose the caller's signal with the tool deadline. AbortSignal.any when
 * available, otherwise manual forwarding with a dispose() so per-call
 * listeners never accumulate on the run-long caller signal.
 */
function composeToolSignals(a: AbortSignal, b: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  if (typeof AbortSignal.any === "function") {
    return { signal: AbortSignal.any([a, b]), dispose: () => {} };
  }
  const ctl = new AbortController();
  const forward = () => ctl.abort((a.aborted ? a : b).reason);
  if (a.aborted || b.aborted) {
    forward();
    return { signal: ctl.signal, dispose: () => {} };
  }
  a.addEventListener("abort", forward, { once: true });
  b.addEventListener("abort", forward, { once: true });
  return {
    signal: ctl.signal,
    dispose: () => {
      a.removeEventListener("abort", forward);
      b.removeEventListener("abort", forward);
    },
  };
}

/**
 * Browser-side executor: same server logic, one HTTP hop.
 * r25: bounded — the engine's signal (when provided) and a hard 30s deadline
 * ride the fetch together (AbortSignal.any when available). A timeout reports
 * the standard ok:false tool-error envelope so the model can adapt mid-run;
 * a caller abort is rethrown so a user stop stays a user stop.
 */
export const httpToolExecutor: ToolExecutor = async (name, argsJson, signal) => {
  const timeout =
    typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(TOOL_CALL_TIMEOUT_MS) : null;
  const composed = timeout ? (signal ? composeToolSignals(signal, timeout) : { signal: timeout, dispose: () => {} }) : null;
  const started = Date.now();
  try {
    const res = await fetch("/api/tools/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args: argsJson }),
      ...(composed ? { signal: composed.signal } : {}),
    });
    const data = (await res.json().catch(() => null)) as ToolResult | { error?: string } | null;
    if (!res.ok || !data || (data as ToolResult).content === undefined) {
      const message = (data as { error?: string } | null)?.error ?? `Tool endpoint failed (HTTP ${res.status})`;
      return { ok: false, content: `Tool error: ${message}`, ms: 0 };
    }
    return data as ToolResult;
  } catch (err) {
    if (signal?.aborted) throw err; // caller/user abort — original semantics
    if (timeout?.aborted && !signal?.aborted) {
      return {
        ok: false,
        content: `Tool error: tool call timed out after ${Math.round(TOOL_CALL_TIMEOUT_MS / 1000)}s (${name})`,
        ms: Date.now() - started,
      };
    }
    throw err;
  } finally {
    composed?.dispose();
  }
};
