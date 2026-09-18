// ─── Agent engine (isomorphic) ───────────────────────────────────────────────
// The agentic tool-loop engine extracted from /api/chat (r23) so it can run in
// TWO places:
//   1. SERVER  — /api/chat keeps executing it (auto-engine fallback, vision,
//      and providers whose CORS blocks browser calls).
//   2. BROWSER — chat-client runs the SAME loop browser-direct: the LLM call
//      goes straight from the user's browser to the provider (their network,
//      their keys, their region — no more datacenter-IP 403s), while tools
//      still execute server-side via /api/tools/execute (search SDK + CORS-free
//      fetcher live there).
// Faithful port of the r19–r22 behaviors: relay rotation with health markers,
// 3x pre-stream upstream retry, max_completion_tokens adaptation, tools→no-tools
// 400 fallback, tool-call-as-text salvage with grace rounds + digest fallback.

import { CUSTOM_FALLBACK_MODEL, MAX_ITERATIONS_DEFAULT } from "./constants";
import { buildToolDefs, type EngineToolIO } from "./tools-defs";
import type { ToolCallInfo, ToolId } from "./types";

// ─── Wire types ──────────────────────────────────────────────────────────────

export interface EngineImage {
  name: string;
  dataUrl: string;
}

export interface RelayWireHop {
  /** Stable hop key — echoed in rotation status lines so health memory can learn. */
  key?: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  label?: string;
  /** True ⇒ use the built-in auto engine for this hop (server-only). */
  useAuto?: boolean;
}

export interface EngineBody {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxIterations?: number;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  tools?: ToolId[];
  images?: EngineImage[];
  relay?: RelayWireHop[];
}

export type EngineSend = (evt: Record<string, unknown>) => void;

/** The built-in SDK runner (server-only) — injected so the engine stays portable. */
export type AutoRunner = (body: EngineBody, send: EngineSend, signal: AbortSignal) => Promise<void>;

export const MAX_IMAGES = 4;
const MAX_IMAGE_DATAURL_LENGTH = 2_000_000; // ≈1.5 MB binary per image

/** Validate + sanitize the images array (drops non-conforming entries). */
export function sanitizeImages(images: EngineImage[] | undefined): EngineImage[] | undefined {
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
export function withImages(messages: { role: string; content: string }[], images?: EngineImage[]): Record<string, unknown>[] {
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

export function isAbort(err: unknown): boolean {
  return (
    (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) ||
    (err as { code?: string })?.code === "ABORT_ERR"
  );
}

/** Transient upstream failures worth an automatic retry (not user aborts). */
export function isTransientNetworkError(err: unknown): boolean {
  if (isAbort(err)) return false;
  const message = err instanceof Error ? err.message : String(err);
  return /network error|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|socket hang up|undici.*socket|terminated|timeout|\bupstream\b|bad gateway|service unavailable|gateway.*(dropped|unavailable)|http 5\d\d|load failed|failed to fetch/i.test(
    message
  );
}

/** Collapse an error to a short status-line fragment for retry notices. */
export function shortError(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 90 ? `${m.slice(0, 90)}…` : m;
}

export function humanizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|Failed to fetch|load failed/i.test(message))
    return "Could not reach the LLM provider. Check the API Base URL in Settings — or the provider blocks this network (the relay will try another lane).";
  if (/network error/i.test(message))
    return "Upstream network hiccup — the run was retried automatically but the provider stayed unreachable. Try again shortly.";
  return message;
}

export function clampIter(n?: number): number {
  return Math.min(Math.max(Number(n ?? MAX_ITERATIONS_DEFAULT) || MAX_ITERATIONS_DEFAULT, 1), 10);
}

export function composeSystem(system: string | undefined, hasTools: boolean): string {
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

export function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}\n…[truncated]`;
}

/** The built-in SDK returns the full completion at once; emit it in small chunks for a live feel. */
export async function simulateStream(text: string, send: EngineSend, signal: AbortSignal): Promise<void> {
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

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Region-block detection (r23) ────────────────────────────────────────────
// Datacenter egress IPs are blocked by several providers (Groq/Cerebras/Google
// do it to cloud regions). A 403 there is NOT a key problem — say so honestly
// instead of sending users to re-check a perfectly good key.

const HTML_BLOCK_RE = /<!DOCTYPE html|<!doctype html|<html[\s>]/i;
const CF_BLOCK_RE = /cloudflare|attention required|cf-ray|just a moment|error code: 10\d\d/i;

export function looksLikeRegionBlock(status: number, bodyText: string): boolean {
  if (status !== 403 && status !== 451) return false;
  return HTML_BLOCK_RE.test(bodyText) || CF_BLOCK_RE.test(bodyText) || status === 451;
}

export const REGION_HINT =
  "This provider refuses datacenter IPs (server-region block) — your key is fine. Calls now go browser-direct from your own network; if you still see this, switch provider via the header picker (the relay rotates automatically).";

export function upstreamErrorMessage(status: number, text: string): string {
  // 5xx = the PROVIDER's infrastructure failed (not the user's config) — say
  // so explicitly so diagnostics + retry classification are unambiguous.
  const prefix = status >= 500 ? `Upstream HTTP ${status}: ` : "";
  if (looksLikeRegionBlock(status, text)) {
    return `Provider blocked this network (HTTP ${status}, region/IP block): ${clip(
      text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      120
    )} — ${REGION_HINT}`;
  }
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

// ─── Engine 1: custom OpenAI-compatible provider (BYOK) ──────────────────────

interface UpstreamToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * Model Relay runner: try the primary endpoint, then rotate down body.relay
 * while nothing has streamed to the client. Rotation covers every failure the
 * user cannot fix mid-run — gateway 5xx/network death, 429 rate limits, 402
 * out-of-credits, dead model ids, region blocks — the "Genius rotator"
 * contract: the chain answers even when the head of the chain is having a bad
 * day. Runs identically server-side and browser-direct.
 */
export async function runRelayedCustom(
  body: EngineBody,
  send: EngineSend,
  signal: AbortSignal,
  toolIO: EngineToolIO,
  autoRunner?: AutoRunner
): Promise<void> {
  const primary: RelayWireHop = {
    baseUrl: body.baseUrl,
    apiKey: body.apiKey,
    model: body.model ?? "auto",
    label: body.model ? `primary (${body.model})` : "primary",
  };
  const hops = [primary, ...(body.relay ?? [])];
  let clientSawTokens = false;
  const sendGate: EngineSend = (evt) => {
    if (evt.type === "token") clientSawTokens = true;
    send(evt);
  };

  let lastErr: unknown = null;
  for (let i = 0; i < hops.length; i++) {
    const hop = hops[i];
    try {
      if (hop.useAuto || !hop.baseUrl) {
        if (!autoRunner) throw new Error("The built-in engine is only available through the app relay");
        await autoRunner({ ...body, baseUrl: undefined }, sendGate, signal);
      } else {
        await runCustomEngine(
          { ...body, baseUrl: hop.baseUrl, apiKey: hop.apiKey, model: hop.model },
          sendGate,
          signal,
          toolIO
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

export async function runCustomEngine(
  body: EngineBody,
  send: EngineSend,
  signal: AbortSignal,
  toolIO: EngineToolIO
): Promise<void> {
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

  let tools = toolIO.defs.length > 0 ? toolIO.defs : buildToolDefs(toolIds);
  const msgs: Record<string, unknown>[] = [
    { role: "system", content: composeSystem(body.system, tools.length > 0) },
    ...withImages(body.messages, body.images),
  ];

  let graceUsed = 0; // tool-calls salvaged from the FINAL pass (max 2)
  for (let iteration = 1; iteration <= maxIterations + 3 && iteration <= 13; iteration++) {
    send({ type: "iteration", n: iteration });
    const isFinalPass = iteration > maxIterations;
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
        const result = await toolIO.execute(tc.name, tc.args);
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
          const result = await toolIO.execute(salvaged.name, argsStr);
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
          const result = await toolIO.execute(salvaged.name, argsStr);
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

export async function consumeUpstreamSSE(
  body: ReadableStream<Uint8Array>,
  send: EngineSend,
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

// ─── Tool-call-as-text salvage parser (harness r22) ──────────────────────────
// Gateways like Vyce sometimes serialize a model's tool call into the CONTENT
// channel instead of delta.tool_calls. Known shapes:
//   1. Mangled arg-tag soup:  "web_searchnum<arg_value>10</arg_value>query<arg_value>…</arg_value>"
//      (tool name immediately followed by bare arg keys + <arg_value> pairs)
//   2. Hermes-style:          "<tool_call>{json}</tool_call>"
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
export function tryParseContentToolCall(
  content: string,
  defs: { function: { name: string } }[]
): { name: string; args: Record<string, unknown> } | null {
  const text = content.trim();
  if (!text || text.length > 4000) return null; // long answers are prose, not calls

  // Shape 2 — Hermes-style {json}
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
export function stripContentToolCall(content: string): string {
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
