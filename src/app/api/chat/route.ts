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
  /**
   * Model Relay — ordered fallback hops (Genius-rotator doctrine). The primary
   * runs first (baseUrl/model above); when it fails while NOTHING has streamed
   * to the client, the server rotates down this list until a hop answers.
   * Keys travel per-request from the user's vault; the server stays stateless.
   */
  relay?: RelayWireHop[];
}

interface RelayWireHop {
  /** Stable hop key — echoed in rotation status lines so the client's health memory can learn. */
  key?: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  label?: string;
  /** True ⇒ use the built-in auto engine for this hop (no external endpoint). */
  useAuto?: boolean;
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
        // Custom engine needs a base URL; apiKey is optional (keyless providers
        // like Pollinations work without one).
        const useCustom = body.provider === "custom" && !!body.baseUrl;
        if (useCustom) {
          await runRelayedCustom(body, send, req.signal);
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

/** Transient upstream failures worth an automatic retry (not user aborts). */
function isTransientNetworkError(err: unknown): boolean {
  if (isAbort(err)) return false;
  const message = err instanceof Error ? err.message : String(err);
  return /network error|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|socket hang up|undici.*socket|terminated|timeout|\bupstream\b|bad gateway|service unavailable|gateway.*(dropped|unavailable)|http 5\d\d/i.test(
    message
  );
}

/** Collapse an error to a short status-line fragment for retry notices. */
function shortError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 90 ? `${m.slice(0, 90)}…` : m;
}

function humanizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(message))
    return "Could not reach the LLM provider. Check the API Base URL in Settings.";
  if (/network error/i.test(message))
    return "Upstream network hiccup — the run was retried automatically but the provider stayed unreachable. Try again shortly.";
  return message;
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

/**
 * Model Relay runner: try the primary endpoint, then rotate down body.relay
 * while nothing has streamed to the client. Rotation covers every failure the
 * user cannot fix mid-run — gateway 5xx/network death, 429 rate limits, 402
 * out-of-credits, dead model ids — the "Genius rotator" contract: the chain
 * answers even when the head of the chain is having a bad day.
 */
async function runRelayedCustom(body: ChatBody, send: Send, signal: AbortSignal): Promise<void> {
  const primary: RelayWireHop = {
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    model: body.model ?? "auto",
    label: body.model ? `primary (${body.model})` : "primary",
  };
  const hops = [primary, ...(body.relay ?? [])];
  let clientSawTokens = false;
  const sendGate: Send = (evt) => {
    if (evt.type === "token") clientSawTokens = true;
    send(evt);
  };

  let lastErr: unknown = null;
  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    try {
      if (hop.useAuto || !hop.baseUrl) {
        await runAutoEngine({ ...body, provider: "auto", baseUrl: undefined }, sendGate, signal);
      } else {
        await runCustomEngine(
          { ...body, baseUrl: hop.baseUrl, apiKey: hop.apiKey, model: hop.model },
          sendGate,
          signal
        );
      }
      // A backup hop answered after the primary died — tell the client's
      // health memory so this hop gets promoted next time.
      if (i > 0 && hop.key) {
        send({ type: "status", message: `Model relay: ${hop.label ?? hop.model} answered ✓ [hopok:${hop.key}]` });
      }
      return;
    } catch (err) {
      if (isAbort(err)) throw err;
      lastErr = err;
      // Mid-stream death: the client already rendered partial output from this
      // hop — rotating now would stitch two models into one answer. Surface it
      // honestly; the step-level self-heal (if any) recovers cleanly.
      if (clientSawTokens) throw err;
      if (i === hops.length - 1) throw err;
      const next = hops[i + 1];
      // [hop:…] marker is consumed by the client's relay health memory — it
      // demotes recently-failed hops in future chains (Genius-rotator memory).
      send({
        type: "status",
        message: `Model relay: ${hop.label ?? hop.model} failed (${shortError(err)}) — rotating to ${next.label ?? next.model}…${hop.key ? ` [hop:${hop.key}]` : ""}`,
      });
    }
  }
  throw lastErr ?? new Error("Relay exhausted with no error");
}

async function runCustomEngine(body: ChatBody, send: Send, signal: AbortSignal): Promise<void> {
  if (body.images?.length) {
    send({ type: "status", message: `Analyzing ${body.images.length} attached image${body.images.length === 1 ? "" : "s"}…` });
  }
  const base = (body.baseUrl || "").replace(/\/+$/, "");
  // Accept both a base URL (…/v1) and a full chat-completions endpoint.
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const model = !body.model || body.model === "auto" ? CUSTOM_FALLBACK_MODEL : body.model;
  const authHeaders: Record<string, string> = body.apiKey
    ? { Authorization: `Bearer ${body.apiKey}` }
    : {};
  const toolIds = (body.tools ?? []).filter(Boolean);
  const maxIterations = clampIter(body.maxIterations);
  const collected: ToolCallInfo[] = [];

  let tools: ToolDef[] = buildToolDefs(toolIds);
  const msgs: Record<string, unknown>[] = [
    { role: "system", content: composeSystem(body.system, tools.length > 0) },
    ...withImages(body.messages, body.images),
  ];

  let graceUsed = 0; // tool-calls salvaged from the FINAL pass (max 2)
  for (let iteration = 1; iteration <= maxIterations + 3 && iteration <= 13; iteration++) {
    send({ type: "iteration", n: iteration });
    const isFinalPass = iteration > maxIterations;
    // One-time grace: when the FINAL pass leaks a tool call as text (Vyce
    // gateways serialize it into content instead of delta.tool_calls), we
    // execute it anyway and grant exactly one extra synthesis round.
    // Resilience (r19): gateways like Vyce sit behind rotating upstream pools
    // and occasionally drop a call mid-run (502/504/socket death) — exactly
    // what killed a Morning-Briefing step after 7 successful tool calls.
    // Retry each LLM call up to 3x while NOTHING has been streamed to the
    // client yet (a mid-stream death can still surface honestly and is
    // recovered one level up by the step-level auto-retry).
    const MAX_UPSTREAM_ATTEMPTS = 3;
    // Parameter adaptation (ModelRelay doctrine): some gateways (Vyce builds)
    // reject the legacy `max_tokens` with "Unknown parameter" and require
    // `max_completion_tokens`. Flip the field on that exact 5xx/4xx signature
    // and retry — the request itself is otherwise identical.
    let maxTokField: "max_tokens" | "max_completion_tokens" = "max_tokens";
    let streamedAny = false;
    let outcome: { content: string; toolCalls: UpstreamToolCall[]; reasoning: string } | null = null;

    attemptLoop: for (let attempt = 1; attempt <= MAX_UPSTREAM_ATTEMPTS; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: msgs,
            temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
            [maxTokField]: body.maxTokens ?? 2048,
            stream: true,
            ...(tools.length > 0 && !isFinalPass ? { tools, tool_choice: "auto" } : {}),
          }),
          signal,
        });
      } catch (err) {
        if (isAbort(err)) throw err;
        if (attempt < MAX_UPSTREAM_ATTEMPTS && !streamedAny && isTransientNetworkError(err)) {
          send({ type: "status", message: `Upstream hiccup (${shortError(err)}) — retrying (${attempt + 1}/${MAX_UPSTREAM_ATTEMPTS})…` });
          await sleep(1200 * attempt);
          continue attemptLoop;
        }
        throw err;
      }

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        if (res.status === 400 && tools.length > 0 && !isFinalPass && /tool/i.test(text)) {
          send({ type: "status", message: "Model does not support tools — continuing without them" });
          tools = [];
          iteration -= 1; // retry same iteration without tools
          break attemptLoop;
        }
        // Parameter adaptation: gateway rejects `max_tokens` → flip to the
        // newer `max_completion_tokens` name and retry the same attempt.
        if (/unknown parameter[\s\S]{0,20}['"]?max_tokens['"]?/i.test(text)) {
          maxTokField = "max_completion_tokens";
          send({ type: "status", message: "Provider wants max_completion_tokens — adapting…" });
          continue attemptLoop;
        }
        const httpErr = new Error(upstreamErrorMessage(res.status, text));
        if (attempt < MAX_UPSTREAM_ATTEMPTS && isTransientNetworkError(httpErr)) {
          send({ type: "status", message: `Upstream hiccup (${shortError(httpErr)}) — retrying (${attempt + 1}/${MAX_UPSTREAM_ATTEMPTS})…` });
          await sleep(1200 * attempt);
          continue attemptLoop;
        }
        throw httpErr;
      }

      outcome = await consumeUpstreamSSE(res.body, send, signal, () => {
        streamedAny = true;
      });
      break attemptLoop;
    }

    if (!outcome) continue; // tools dropped — replay the same iteration
    const { content, toolCalls, reasoning } = outcome;

    // Some gateways (Pollinations) deliver key-budget notices INSIDE a 200
    // stream as if they were assistant text. Surface them as real errors.
    if (/has reached its budget|raise the key budget/i.test(content)) {
      throw new Error(
        "This provider key has reached its budget — raise the key budget on the provider's dashboard (e.g. enter.pollinations.ai → your key) or switch providers."
      );
    }

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

    // ─── Tool-call-as-text salvage (harness r22) ───────────────────────────
    // Some gateways (Vyce builds) serialize the model's tool call into the
    // CONTENT channel — "web_searchnum<arg_value>10</arg_value>query<arg_value>…"
    // — instead of proper delta.tool_calls. Left alone, that markup becomes
    // the step's "answer" and poisons every downstream step's context. Parse
    // it, execute it, continue the loop like a real tool call.
    if (toolCalls.length === 0 && tools.length > 0) {
      const salvaged = tryParseContentToolCall(content, tools);
      if (salvaged) {
        if (!isFinalPass) {
          send({ type: "status", message: `Model emitted its tool call as text — salvaging: ${salvaged.name}` });
          const id = `salvage_${Math.random().toString(36).slice(2, 10)}`;
          const argsStr = JSON.stringify(salvaged.args);
          msgs.push({ role: "assistant", content });
          send({ type: "status", message: `Using tool: ${salvaged.name}` });
          send({ type: "tool_call", id, name: salvaged.name, args: argsStr });
          const result = await executeTool(salvaged.name, argsStr);
          collected.push({ id, name: salvaged.name, args: argsStr, result: result.content, ok: result.ok, ms: result.ms });
          send({ type: "tool_result", id, name: salvaged.name, ok: result.ok, ms: result.ms, content: clip(result.content, 4000) });
          msgs.push({
            role: "user",
            content: `TOOL_RESULT (${salvaged.name}, ok=${result.ok}):\n${clip(result.content, 6000)}\n\nContinue: use tools if you need more information (call them normally), or give your final markdown answer.`,
          });
          continue;
        }
        // Final-pass leak: execute the salvaged call, grant up to TWO extra
        // synthesis rounds (research models are stubborn — the first grace
        // prompt gets an escalated retry, then the digest fallback fires).
        if (graceUsed < 2 && iteration <= maxIterations + 2) {
          graceUsed += 1;
          send({ type: "status", message: `The model tried another tool call (${salvaged.name}) — running it, then finalizing…` });
          const id = `salvage_${Math.random().toString(36).slice(2, 10)}`;
          const argsStr = JSON.stringify(salvaged.args);
          msgs.push({ role: "assistant", content });
          send({ type: "tool_call", id, name: salvaged.name, args: argsStr });
          const result = await executeTool(salvaged.name, argsStr);
          collected.push({ id, name: salvaged.name, args: argsStr, result: result.content, ok: result.ok, ms: result.ms });
          send({ type: "tool_result", id, name: salvaged.name, ok: result.ok, ms: result.ms, content: clip(result.content, 4000) });
          msgs.push({
            role: "user",
            content:
              graceUsed === 1
                ? `TOOL_RESULT (${salvaged.name}, ok=${result.ok}):\n${clip(result.content, 6000)}\n\nYour tool budget is now spent. Write your FINAL markdown answer now — plain prose/markdown only, no tool calls of any kind.`
                : `TOOL_RESULT (${salvaged.name}, ok=${result.ok}):\n${clip(result.content, 6000)}\n\nFINAL WARNING: this is your LAST chance. If you reply with another tool call it will be DISCARDED and the run ends with your research notes only. Write your final markdown answer NOW, synthesizing what you already have — plain prose/markdown only.`,
          });
          send({ type: "status", message: "Finalizing answer…" });
          continue;
        }
      }
    }

    // Cleanup: never let leaked tool-call markup masquerade as the answer.
    const stripped = stripContentToolCall(content);
    // If the answer was ENTIRELY a leaked tool call, still hand the next
    // step real material: digest what the tools actually gathered.
    const finalContent =
      /^_The model ended/.test(stripped) && collected.length > 0
        ? `${stripped}\n\n**Research material gathered (auto-digest):**\n${collected
            .slice(-6)
            .map((tc) => `- ${tc.name} ${tc.ok ? "✓" : "✗"} — ${clip(tc.result || "(no result)", 160).replace(/\n/g, " ")}`)
            .join("\n")}`
        : stripped;
    send({ type: "done", content: finalContent, toolCalls: collected, iterations: iteration });
    return;
  }
  throw new Error("Agent loop exceeded maximum iterations.");
}

async function consumeUpstreamSSE(
  body: ReadableStream<Uint8Array>,
  send: Send,
  signal: AbortSignal,
  onFirstChunk?: () => void
): Promise<{ content: string; toolCalls: UpstreamToolCall[]; reasoning: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let first = true;
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
    if (first) {
      first = false;
      onFirstChunk?.();
    }
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let chunk: {
        model?: string;
        choices?: Array<{
          delta?: { content?: string; reasoning?: string; reasoning_content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
        }>;
      };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      // Pollinations injects sponsored chunks from a separate "ad-system" model
      // into the same stream — they are not assistant output, drop them.
      if (chunk.model === "ad-system") continue;
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
  // 5xx = the PROVIDER's infrastructure failed (not the user's config) — say
  // so explicitly so diagnostics + retry classification are unambiguous.
  const prefix = status >= 500 ? `Upstream HTTP ${status}: ` : "";
  try {
    const parsed = JSON.parse(text);
    const msg = parsed?.error?.message ?? parsed?.message;
    if (msg) {
      if (status === 401) return `Invalid API key: ${msg}`;
      if (status === 402) return `Out of credits (HTTP 402): ${msg}`;
      if (status === 403) return `Access forbidden (check key/region): ${msg}`;
      if (status === 404) return `Model or endpoint not found: ${msg}`;
      if (status === 429) return `Rate limit exceeded: ${msg}`;
      return `${prefix}${msg}`;
    }
  } catch {
    /* not json */
  }
  return `${prefix}Provider error (HTTP ${status}): ${clip(text || "no details", 300)}`;
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

// ─── Tool-call-as-text salvage parser (harness r22) ──────────────────────────
// Gateways like Vyce sometimes serialize a model's tool call into the CONTENT
// channel instead of delta.tool_calls. Known shapes:
//   1. Mangled arg-tag soup:  "web_searchnum<arg_value>10</arg_value>query<arg_value>…</arg_value>"
//      (tool name immediately followed by bare arg keys + <arg_value> pairs)
//   2. Hermes-style:          "<tool_call>{"name": … , "arguments": …}</tool_call>"
//   3. Bare JSON protocol:    {"tool": "web_search", "args": { … }}
function coerceArgValue(v: string): string | number | boolean {
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  return t;
}

function toolArgsFromJson(j: Record<string, unknown>): Record<string, unknown> | null {
  const raw = (j.args ?? j.arguments ?? j.parameters ?? {}) as unknown;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function tryJsonObj(s: string): Record<string, unknown> | null {
  try {
    const j = JSON.parse(s) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Parse a tool call that leaked into the assistant CONTENT channel.
 * Returns { name, args } when the text unambiguously matches a known tool.
 */
function tryParseContentToolCall(
  content: string,
  defs: ToolDef[]
): { name: string; args: Record<string, unknown> } | null {
  const text = content.trim();
  if (!text || text.length > 4000) return null; // long answers are prose, not calls

  // Shape 2 — Hermes-style <tool_call>{json}</tool_call>
  const hermesRe = new RegExp("<" + "tool_call\\s*>\\s*([\\s\\S]+?)\\s*</" + "tool_call\\s*>", "i");
  const hermes = hermesRe.exec(text);
  if (hermes) {
    const j = tryJsonObj(hermes[1]);
    if (j) {
      const name = typeof (j.name ?? j.tool) === "string" ? String(j.name ?? j.tool) : "";
      const args = toolArgsFromJson(j);
      if (name && args && defs.some((d) => d.function.name === name)) return { name, args };
    }
  }

  // Shape 3 — bare JSON protocol object
  if (text.startsWith("{")) {
    const j = tryJsonObj(text);
    if (j && (j.tool || j.name)) {
      const name = String(j.tool ?? j.name);
      const args = toolArgsFromJson(j);
      if (args && defs.some((d) => d.function.name === name)) return { name, args };
    }
  }

  // Shape 1 — mangled arg-tag soup, matched by known tool name prefix:
  // "web_searchnum<arg_value>10</arg_value>query<arg_value>daily AI news …</arg_value>"
  for (const d of defs) {
    const n = d.function.name;
    if (!text.toLowerCase().startsWith(n.toLowerCase())) continue;
    const rest = text.slice(n.length).trim();
    if (!rest) continue;
    if (/<arg_value>/i.test(rest)) {
      const args: Record<string, unknown> = {};
      const pair = /([a-zA-Z_]\w*)\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
      let pm: RegExpExecArray | null;
      while ((pm = pair.exec(rest))) args[pm[1]] = coerceArgValue(pm[2]);
      if (Object.keys(args).length > 0) return { name: n, args };
    }
    if (rest.startsWith("{")) {
      const j = tryJsonObj(rest);
      if (j) {
        const args = toolArgsFromJson(j) ?? {};
        return { name: n, args };
      }
    }
  }
  return null;
}

/** Remove leaked tool-call markup from a final answer (never show it as prose). */
function stripContentToolCall(content: string): string {
  const stripped = content
    .replace(/<arg_(?:key|value)>[\s\S]*?<\/arg_(?:key|value)>/gi, "")
    .replace(/<arg_(?:key|value)[^>]*>/gi, "")
    .replace(new RegExp("<" + "tool_call[\\s\\S]*?</" + "tool_call\\s*>", "gi"), "")
    .replace(new RegExp("<" + "tool_call[^>]*>", "gi"), "")
    .trim();
  if (stripped === content.trim()) return content;
  if (stripped.length === 0) {
    return "_The model ended with another tool call after the tool budget was spent — the gathered results above are the step's work. Retry the step for a fuller synthesized answer._";
  }
  return stripped;
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
