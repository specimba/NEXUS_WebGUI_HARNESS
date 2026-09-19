import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { executeTool } from "@/lib/server/tools";
import { buildToolDefs, type EngineToolIO } from "@/lib/tools-defs";
import type { ToolCallInfo } from "@/lib/types";
import {
  clampIter,
  composeAbortSignals,
  composeSystem,
  classifyUpstreamError,
  humanizeError,
  isAbort,
  isTransientNetworkError,
  runCustomEngine,
  runRelayedCustom,
  sanitizeImages,
  simulateStream,
  withImages,
  type EngineBody,
  type EngineSend,
} from "@/lib/agent-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── /api/chat — server agent engine ─────────────────────────────────────────
// r23: the agentic loop itself now lives in src/lib/agent-engine.ts so the
// BROWSER can run it directly against the provider (browser-direct transport,
// the default) — this route remains the server-side execution path for:
//   • the built-in auto engine (server SDK — browser-direct hops with
//     useAuto fall back to this route automatically),
//   • vision requests,
//   • providers whose CORS policy blocks browser calls.
// Request/response contract is unchanged, so chat-client's server fallback
// speaks exactly the same protocol as before.

interface ChatBody extends EngineBody {
  provider?: "auto" | "custom";
}

type Send = EngineSend;

export async function POST(req: NextRequest) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError(400, "messages[] is required");
  }

  const encoder = new TextEncoder();
  // r25: engine signal = the request's own abort (client disconnect) plus an
  // engine-owned controller that fires when the keep-alive ping below finds
  // the client gone — the same abort path a user-cancel takes.
  const clientGone = new AbortController();
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  const stopPings = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = undefined;
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // SSE keep-alive pings (r25): between the `start` event and the first
      // engine event — and during long tool-execution / LLM phases — this
      // stream used to go completely silent, and idle-killer middlewares /
      // proxies reaped it (the "8/8 tool calls then network error" report).
      // A `: ping` comment every 15s keeps the pipe warm for the WHOLE
      // request lifetime. Comments are their own SSE frames and never split
      // a `data:` event; both writers share one encoder.
      pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // client went away mid-run — stop the heartbeat and let the engine
          // work die through the same abort path a user-cancel takes
          stopPings();
          clientGone.abort();
        }
      }, 15_000);
      const engineAbort = composeAbortSignals(req.signal, clientGone.signal);
      const send: Send = (evt) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt)}\n\n`));
        } catch {
          /* client gone */
        }
      };
      send({ type: "start" });
      try {
        body.images = sanitizeImages(body.images);
        const toolIO: EngineToolIO = { defs: buildToolDefs((body.tools ?? []).filter(Boolean)), execute: executeTool };
        // Custom engine needs a base URL; apiKey is optional (keyless providers
        // like Pollinations work without one).
        const useCustom = body.provider === "custom" && !!body.baseUrl;
        if (useCustom) {
          await runRelayedCustom(body, send, engineAbort.signal, toolIO, runAutoEngine);
        } else {
          await runAutoEngine(body, send, engineAbort.signal);
        }
      } catch (err) {
        if (!isAbort(err)) {
          send({
            type: "error",
            message: humanizeError(err),
            kind: classifyUpstreamError(err),
          });
        }
      } finally {
        engineAbort.dispose();
        stopPings();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // Client disconnected — stop the heartbeat and abort engine work the
      // same way the ping's enqueue-failure path does.
      stopPings();
      clientGone.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

/** Retry helper for transient upstream failures (auto engine LLM calls). */
async function withRetry<T>(
  attempts: number,
  label: string,
  send: Send,
  fn: () => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isTransientNetworkError(err)) throw err;
      const waitMs = 1200 * attempt;
      send({
        type: "status",
        message: `${label} — network hiccup, retrying (${attempt + 1}/${attempts})…`,
      });
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ─── Engine 2: auto — built-in SDK with JSON tool protocol ───────────────────
async function runAutoEngine(body: EngineBody, send: Send, signal: AbortSignal): Promise<void> {
  const zai = await ZAI.create();
  const toolIds = (body.tools ?? []).filter(Boolean);
  const toolDefs = buildToolDefs(toolIds);
  const maxIterations = clampIter(body.maxIterations);
  const collected: ToolCallInfo[] = [];

  const toolBlock =
    toolDefs.length > 0
      ? `\n\n# TOOLS\nYou may call these tools:\n${toolDefs
          .map((t) => `- ${t.function.name}: ${t.function.description}`)
          .join("\n")}\n\nTOOL CALL PROTOCOL: when you need a tool, reply with ONLY a raw JSON object (no markdown fences, no extra text):\n{"thought": "why", "tool": "<name>", "args": { ... }}\nYou will then receive the tool result and can continue. When you have everything you need, reply with your final markdown answer (plain text, NOT JSON). If you do not need tools, answer directly.`
      : "";

  const msgs: Record<string, unknown>[] = [
    {
      role: "assistant",
      content: `${composeSystem(body.system, toolDefs.length > 0)}${toolBlock}`,
    },
    ...withImages(body.messages, body.images),
  ];

  if (body.images?.length) {
    send({ type: "status", message: `Analyzing ${body.images.length} attached image${body.images.length === 1 ? "" : "s"}…` });
  }

  for (let iteration = 1; iteration <= maxIterations + 1; iteration++) {
    send({ type: "iteration", n: iteration });
    send({ type: "status", message: iteration === 1 ? "Thinking…" : "Reasoning with tool results…" });

    // The built-in SDK exposes vision through createVision; text-only turns
    // use the regular completion call. (The vision endpoint defaults its
    // model server-side; "auto" satisfies the SDK's required field.)
    // Transient network failures are retried up to 3x with backoff — a long
    // multi-tool run (e.g. Morning Briefing) must not die on one hiccup.
    const completion = await withRetry(3, "Thinking", send, () =>
      body.images?.length
        ? zai.chat.completions.createVision({
            model: "auto",
            messages: msgs as never,
            thinking: { type: "disabled" },
          })
        : zai.chat.completions.create({
            messages: msgs as never,
            thinking: { type: "disabled" },
          })
    );
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const call = toolDefs.length > 0 && iteration <= maxIterations ? tryParseToolCall(raw, toolDefs) : null;

    if (call) {
      send({ type: "status", message: `Using tool: ${call.name}` });
      send({ type: "tool_call", id: call.id, name: call.name, args: JSON.stringify(call.args) });
      const result = await executeTool(call.name, JSON.stringify(call.args));
      collected.push({
        id: call.id,
        name: call.name,
        args: JSON.stringify(call.args),
        result: result.content,
        ok: result.ok,
        ms: result.ms,
      });
      send({
        type: "tool_result",
        id: call.id,
        name: call.name,
        ok: result.ok,
        ms: result.ms,
        content: clipLocal(result.content, 4000),
      });
      msgs.push({ role: "assistant", content: raw });
      msgs.push({
        role: "user",
        content:
          `TOOL_RESULT (${call.name}, ok=${result.ok}):\n${clipLocal(result.content, 6000)}\n\n` +
          (iteration >= maxIterations
            ? "TOOL LIMIT REACHED. Reply with your final markdown answer now — do NOT call any more tools and do NOT reply with JSON."
            : "Continue: either call another tool (raw JSON object) or give your final markdown answer."),
      });
      continue;
    }

    const final = cleanFinalText(raw);
    await simulateStream(final, send, signal);
    send({ type: "done", content: final, toolCalls: collected, iterations: iteration });
    return;
  }
  throw new Error("Agent loop exceeded maximum iterations.");
}

interface ParsedCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Find the matching close-brace for the opener at `start`, respecting strings. */
function matchBrace(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function tryParseToolCall(text: string, defs: { function: { name: string } }[]): ParsedCall | null {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  if (!cleaned.startsWith("{")) return null;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    // Tolerant fallback: LLMs often emit unbalanced braces or trailing commas.
    const nameMatch = /"tool"\s*:\s*"([a-z_]+)"/i.exec(cleaned);
    const name = nameMatch?.[1];
    if (!name) return null;
    let args: Record<string, unknown> = {};
    const argsIdx = cleaned.indexOf('"args"');
    if (argsIdx !== -1) {
      const braceStart = cleaned.indexOf("{", argsIdx);
      if (braceStart !== -1) {
        const braceEnd = matchBrace(cleaned, braceStart);
        if (braceEnd !== -1) {
          const argsRaw = cleaned.slice(braceStart, braceEnd + 1);
          try {
            args = JSON.parse(argsRaw) as Record<string, unknown>;
          } catch {
            // one more attempt: strip trailing commas
            try {
              args = JSON.parse(argsRaw.replace(/,\s*([}\]])/g, "$1")) as Record<string, unknown>;
            } catch {
              args = { input: argsRaw };
            }
          }
        }
      }
    }
    parsed = { tool: name, args };
  }

  const name = typeof parsed.tool === "string" ? parsed.tool : "";
  if (!name || !defs.some((d) => d.function.name === name)) return null;
  const args =
    parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)
      ? (parsed.args as Record<string, unknown>)
      : {};
  return { id: `auto_${Math.random().toString(36).slice(2, 10)}`, name, args };
}

function cleanFinalText(text: string): string {
  // If the model accidentally answered with a JSON tool object for an unknown tool, unwrap common fields
  const t = text.trim();
  if (t.startsWith("{")) {
    // If it's actually a valid tool call for an available tool, the caller already handled it.
    // Here we only rescue human-readable content from stray JSON replies.
    const thoughtMatch = /"(?:thought|answer|content|final)"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(t);
    if (thoughtMatch && /"tool"\s*:/.test(t)) {
      try {
        return JSON.parse(`"${thoughtMatch[1]}"`) as string;
      } catch {
        return thoughtMatch[1];
      }
    }
  }
  return text;
}

function clipLocal(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated]`;
}
