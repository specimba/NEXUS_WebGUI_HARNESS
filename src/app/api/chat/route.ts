import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import type { ToolCallInfo, ToolId } from "@/lib/types";
import { CUSTOM_FALLBACK_MODEL, MAX_ITERATIONS_DEFAULT } from "@/lib/constants";
import { buildToolDefs, executeTool, type ToolDef } from "@/lib/server/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Request contract ────────────────────────────────────────────────────────
interface ChatImage {
  name: string;
  dataUrl: string;
}

interface ChatBody {
  provider?: "auto" | "custom";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxIterations?: number;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  tools?: ToolId[];
  /** Images attached to the LAST user message (data URLs) — enables vision. */
  images?: ChatImage[];
}

const MAX_IMAGES = 4;
const MAX_IMAGE_DATAURL_LENGTH = 2_000_000; // ≈1.5 MB binary per image

/** Validate + sanitize the images array (drops non-conforming entries). */
function sanitizeImages(images: ChatImage[] | undefined): ChatImage[] | undefined {
  if (!Array.isArray(images)) return undefined;
  const ok = images
    .filter(
      (i) =>
        i &&
        typeof i.dataUrl === "string" &&
        i.dataUrl.startsWith("data:image/") &&
        i.dataUrl.length <= MAX_IMAGE_DATAURL_LENGTH
    )
    .slice(0, MAX_IMAGES)
    .map((i, n) => ({ name: typeof i.name === "string" && i.name ? i.name : `image-${n + 1}`, dataUrl: i.dataUrl }));
  return ok.length > 0 ? ok : undefined;
}

/**
 * Convert the last user message into an OpenAI-style multimodal content array
 * (text + image_url parts) when images are attached.
 */
function withImages(messages: { role: string; content: string }[], images?: ChatImage[]): Record<string, unknown>[] {
  const msgs: Record<string, unknown>[] = messages.map((m) => ({ ...m }));
  if (!images || images.length === 0) return msgs;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      const parts: Record<string, unknown>[] = [{ type: "text", text: String(msgs[i].content ?? "") }];
      for (const img of images) {
        parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
      }
      msgs[i] = { ...msgs[i], content: parts };
      break;
    }
  }
  return msgs;
}

type Send = (evt: Record<string, unknown>) => void;

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
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
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
        const useCustom = body.provider === "custom" && !!body.apiKey && !!body.baseUrl;
        if (useCustom) {
          await runCustomEngine(body, send, req.signal);
        } else {
          await runAutoEngine(body, send, req.signal);
        }
      } catch (err) {
        if (!isAbort(err)) {
          send({ type: "error", message: humanizeError(err) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
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

function isAbort(err: unknown): boolean {
  return (
    (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) ||
    (err as { code?: string })?.code === "ABORT_ERR"
  );
}

function humanizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(message))
    return "Could not reach the LLM provider. Check the API Base URL in Settings.";
  return message;
}

function clampIter(n?: number): number {
  return Math.min(Math.max(Number(n ?? MAX_ITERATIONS_DEFAULT) || MAX_ITERATIONS_DEFAULT, 1), 10);
}

function composeSystem(system: string | undefined, hasTools: boolean): string {
  const lines = [
    "You are an autonomous AI agent running inside PraisonAI, a multi-agent platform.",
    system ? `YOUR PERSONA & INSTRUCTIONS:\n${system}` : "",
    "Answer using rich markdown (headings, lists, tables, fenced code blocks with language tags).",
    hasTools
      ? "You have tools available. Prefer calling them over guessing when they help. After using tools, synthesize the results into a clear final answer."
      : "",
    `Today is ${new Date().toDateString()}.`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

// ─── Engine 1: custom OpenAI-compatible provider (BYOK: Groq, OpenAI, …) ─────
interface UpstreamToolCall {
  id: string;
  name: string;
  args: string;
}

async function runCustomEngine(body: ChatBody, send: Send, signal: AbortSignal): Promise<void> {
  if (body.images?.length) {
    send({ type: "status", message: `Analyzing ${body.images.length} attached image${body.images.length === 1 ? "" : "s"}…` });
  }
  const base = (body.baseUrl || "").replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const model = !body.model || body.model === "auto" ? CUSTOM_FALLBACK_MODEL : body.model;
  const toolIds = (body.tools ?? []).filter(Boolean);
  const maxIterations = clampIter(body.maxIterations);
  const collected: ToolCallInfo[] = [];

  let tools: ToolDef[] = buildToolDefs(toolIds);
  const msgs: Record<string, unknown>[] = [
    { role: "system", content: composeSystem(body.system, tools.length > 0) },
    ...withImages(body.messages, body.images),
  ];

  for (let iteration = 1; iteration <= maxIterations + 1; iteration++) {
    send({ type: "iteration", n: iteration });
    const isFinalPass = iteration > maxIterations;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${body.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: msgs,
        temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
        max_tokens: body.maxTokens ?? 2048,
        stream: true,
        ...(tools.length > 0 && !isFinalPass ? { tools, tool_choice: "auto" } : {}),
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      if (res.status === 400 && tools.length > 0 && !isFinalPass && /tool/i.test(text)) {
        send({ type: "status", message: "Model does not support tools — continuing without them" });
        tools = [];
        iteration -= 1; // retry same iteration without tools
        continue;
      }
      throw new Error(upstreamErrorMessage(res.status, text));
    }

    const { content, toolCalls, reasoning } = await consumeUpstreamSSE(res.body, send, signal);

    if (toolCalls.length > 0 && tools.length > 0 && !isFinalPass) {
      msgs.push({
        role: "assistant",
        content: content || null,
        ...(toolCalls.length
          ? {
              tool_calls: toolCalls.map((t) => ({
                id: t.id,
                type: "function",
                function: { name: t.name, arguments: t.args || "{}" },
              })),
            }
          : {}),
      });
      for (const tc of toolCalls) {
        send({ type: "status", message: `Using tool: ${tc.name}` });
        send({ type: "tool_call", id: tc.id, name: tc.name, args: tc.args });
        const result = await executeTool(tc.name, tc.args);
        collected.push({ id: tc.id, name: tc.name, args: tc.args, result: result.content, ok: result.ok, ms: result.ms });
        send({
          type: "tool_result",
          id: tc.id,
          name: tc.name,
          ok: result.ok,
          ms: result.ms,
          content: clip(result.content, 4000),
        });
        msgs.push({ role: "tool", tool_call_id: tc.id, content: clip(result.content, 6000) });
      }
      if (iteration >= maxIterations) {
        send({ type: "status", message: "Finalizing answer…" });
      }
      continue;
    }

    send({ type: "done", content, toolCalls: collected, iterations: iteration });
    return;
  }
  throw new Error("Agent loop exceeded maximum iterations.");
}

async function consumeUpstreamSSE(
  body: ReadableStream<Uint8Array>,
  send: Send,
  signal: AbortSignal
): Promise<{ content: string; toolCalls: UpstreamToolCall[]; reasoning: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  const toolCalls: UpstreamToolCall[] = [];

  while (true) {
    if (signal.aborted) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new DOMException("Aborted", "AbortError");
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let chunk: {
        choices?: Array<{
          delta?: { content?: string; reasoning?: string; reasoning_content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
        }>;
      };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.reasoning || delta.reasoning_content) {
        const r = delta.reasoning ?? delta.reasoning_content ?? "";
        reasoning += r;
        send({ type: "reasoning", text: r });
      }
      if (delta.content) {
        content += delta.content;
        send({ type: "token", text: delta.content });
      }
      if (delta.tool_calls) {
        for (const tcd of delta.tool_calls) {
          const i = tcd.index ?? 0;
          if (!toolCalls[i]) toolCalls[i] = { id: tcd.id ?? `call_${i}_${Date.now()}`, name: "", args: "" };
          if (tcd.id) toolCalls[i].id = tcd.id;
          if (tcd.function?.name) toolCalls[i].name += tcd.function.name;
          if (tcd.function?.arguments) toolCalls[i].args += tcd.function.arguments;
        }
      }
    }
  }
  return { content, toolCalls: toolCalls.filter(Boolean), reasoning };
}

function upstreamErrorMessage(status: number, text: string): string {
  try {
    const parsed = JSON.parse(text);
    const msg = parsed?.error?.message ?? parsed?.message;
    if (msg) {
      if (status === 401) return `Invalid API key: ${msg}`;
      if (status === 403) return `Access forbidden (check key/region): ${msg}`;
      if (status === 404) return `Model or endpoint not found: ${msg}`;
      if (status === 429) return `Rate limit exceeded: ${msg}`;
      return msg;
    }
  } catch {
    /* not json */
  }
  return `Provider error (HTTP ${status}): ${clip(text || "no details", 300)}`;
}

// ─── Engine 2: auto — built-in SDK with JSON tool protocol ───────────────────
async function runAutoEngine(body: ChatBody, send: Send, signal: AbortSignal): Promise<void> {
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
    const completion = body.images?.length
      ? await zai.chat.completions.createVision({
          model: "auto",
          messages: msgs as never,
          thinking: { type: "disabled" },
        })
      : await zai.chat.completions.create({
          messages: msgs as never,
          thinking: { type: "disabled" },
        });
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
        content: clip(result.content, 4000),
      });
      msgs.push({ role: "assistant", content: raw });
      msgs.push({
        role: "user",
        content:
          `TOOL_RESULT (${call.name}, ok=${result.ok}):\n${clip(result.content, 6000)}\n\n` +
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

function tryParseToolCall(text: string, defs: ToolDef[]): ParsedCall | null {
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

/** The built-in SDK returns the full completion at once; emit it in small chunks for a live feel. */
async function simulateStream(text: string, send: Send, signal: AbortSignal): Promise<void> {
  const parts = text.match(/\S+\s*/g) ?? [text];
  let batch = "";
  for (let i = 0; i < parts.length; i++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    batch += parts[i];
    if (batch.length >= 24 || i === parts.length - 1) {
      send({ type: "token", text: batch });
      batch = "";
      await sleep(12);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated]`;
}
