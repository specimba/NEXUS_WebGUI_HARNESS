// ─── r528 — TASK-102 slice 4: Anthropic-dialect lane adapter ─────────────────
// The NEXUS_BOT wave's dialect requirement: lanes whose provider pairs an
// Anthropic-style /v1/messages endpoint must be shaped for THAT wire, not
// force-fit into the OpenAI /chat/completions dialect the engine speaks
// natively. This module is the dialect boundary:
//
//   OpenAI house shape  ──toAnthropic──▶  Anthropic /v1/messages body
//   Anthropic response  ──fromAnthropic─▶ house text/tool_calls shape
//
// DOCTRINE (honest scope): slice 4 covers the SERVER-LANE step dial
// (automation-executor dialStep) — non-streaming — gated on a provider
// registry entry carrying dialect:"anthropic" (vyce, whose own guide
// advertises the /v1/messages bonus endpoint). slice 5 (r529) adds the
// ENGINE's streaming tool-loop lane: consumeUpstreamSSE translates
// Anthropic SSE events (content_block_delta → house deltas) through the
// stateful translator below, and openaiBodyToAnthropic now folds the
// engine's tool-loop shapes (assistant tool_calls / role:"tool" rows /
// function tool defs) into legal /v1/messages wire shapes. Still NOT
// claimed: threading the registry dialect flag through the chat-route hop
// build (the engine gate is the dial base URL itself until then).
//
// The redaction choke (src/lib/redaction.ts) stays dialect-agnostic: it
// deep-walks whatever JSON body it is handed — the executor wraps the SHAPED
// Anthropic body in the same redactDialBody call, so the r524 invariant
// ("auth header carries the real key, the body can never leak it") holds
// across dialects.
//
// Isomorphic like redaction.ts: pure data shaping, no node builtins — the
// browser lane can reuse it when an Anthropic-style hop joins the relay.

export const ANTHROPIC_VERSION = "2023-06-01";

/** True when the URL IS an Anthropic-style /v1/messages endpoint. */
export function isAnthropicStyleEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() === "api.anthropic.com") return true;
    return /\/v1\/messages\/?$/.test(u.pathname);
  } catch {
    return false; // unparseable — not an anthropic endpoint we can claim
  }
}

/** Derive the /v1/messages dial URL from a provider base (…/v1 or bare).
 * Strips a trailing /v1 first — appending /v1/messages to a base that
 * already carries it produced /v1/v1/messages (caught by qa-anthropic-dialect). */
export function anthropicDialectUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${base}/v1/messages`;
}

/**
 * Anthropic authenticates with x-api-key + anthropic-version — NOT Bearer.
 * (The redaction choke never touches auth headers; the key rides here.)
 */
export function anthropicAuthHeaders(key: string): Record<string, string> {
  return { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION };
}

export interface OpenAIDialBody {
  model: string;
  // role/content widened (r529): the engine's tool-loop msgs are
  // Record<string, unknown>[] — role:"tool" rows and assistant tool_calls
  // carry extra keys the converter folds below.
  messages: Record<string, unknown>[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: unknown[];
}

/**
 * Shape an OpenAI-dialect chat body into an Anthropic /v1/messages body.
 * Dialect rules honored here:
 *   - "system" is NOT a message role: it moves to the top-level `system`
 *     field (string).
 *   - max_tokens is REQUIRED by the wire (defaults to 4096 when absent).
 *   - only user/assistant roles are legal in messages:
 *     · an assistant turn carrying OpenAI tool_calls becomes tool_use
 *       content blocks (id/name/input) — r529 slice 5 (engine tool-loop).
 *     · a role:"tool" result row becomes a USER turn of tool_result blocks
 *       (the wire has no "tool" role).
 *   - OpenAI function tool defs become {name, description, input_schema}
 *       with tool_choice auto — dropping them would silently de-tool the
 *       engine loop.
 *   - stream passes through (the engine always streams).
 */
export function openaiBodyToAnthropic(body: OpenAIDialBody): Record<string, unknown> {
  const systemParts: string[] = [];
  const messages: { role: string; content: unknown }[] = [];
  for (const m of (body.messages ?? []) as Record<string, unknown>[]) {
    if (m.role === "system") {
      if (typeof m.content === "string" && (m.content as string).trim()) systemParts.push(m.content as string);
      continue;
    }
    // Engine tool-loop shape: assistant turn that issued tool calls.
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      const blocks: Record<string, unknown>[] = [];
      if (typeof m.content === "string" && m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls as { id?: string; function?: { name?: string; arguments?: string } }[]) {
        let input: unknown = {};
        try {
          input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          input = {}; // malformed partial args — honest empty input, never a crash
        }
        blocks.push({ type: "tool_use", id: tc.id ?? `call_${blocks.length}`, name: tc.function?.name ?? "", input });
      }
      messages.push({ role: "assistant", content: blocks });
      continue;
    }
    // Engine tool-loop shape: the result row following a tool call.
    if (m.role === "tool") {
      const result = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: typeof m.tool_call_id === "string" ? m.tool_call_id : "", content: result }],
      });
      continue;
    }
    messages.push({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    });
  }
  const out: Record<string, unknown> = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens && body.max_tokens > 0 ? body.max_tokens : 4096,
  };
  if (systemParts.length > 0) out.system = systemParts.join("\n\n");
  if (typeof body.temperature === "number") out.temperature = body.temperature;
  if (body.stream != null) out.stream = body.stream;
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    out.tools = body.tools.map((t) => {
      const fn =
        (t as { function?: { name?: string; description?: string; parameters?: unknown } }).function ?? {};
      return {
        name: fn.name ?? "",
        description: fn.description ?? "",
        input_schema: fn.parameters ?? { type: "object", properties: {} },
      };
    });
    out.tool_choice = { type: "auto" };
  }
  return out;
}

/**
 * Translate an Anthropic /v1/messages response into the house text shape.
 * content is a BLOCK LIST: text blocks joined; tool_use blocks become
 * house-style tool_calls (id/name/arguments-as-JSON-string) so the caller
 * needs no second parsing path. Returns { text, toolCalls }.
 */
export function anthropicResponseToHouse(j: unknown): {
  text: string;
  toolCalls: { id: string; name: string; arguments: string }[];
} {
  const blocks = (j as { content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[] })
    ?.content;
  const list = Array.isArray(blocks) ? blocks : [];
  const text = list
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  const toolCalls = list
    .filter((b) => b?.type === "tool_use")
    .map((b) => ({
      id: typeof b.id === "string" ? b.id : "",
      name: typeof b.name === "string" ? b.name : "",
      arguments: JSON.stringify(b.input ?? {}),
    }));
  return { text, toolCalls };
}

// ─── r529 — TASK-102 slice 5: engine streaming-SSE dialect translation ──────

export interface AnthropicSSEDelta {
  text?: string;
  reasoning?: string;
  /** Finalized at content_block_stop for tool_use blocks (args = JSON string). */
  toolCall?: { index: number; id: string; name: string; args: string };
  /** message_delta carried a stop_reason — the wire finished its turn. */
  finished?: boolean;
  /** message_stop — the stream is complete (the house [DONE] equivalent). */
  done?: boolean;
}

/**
 * Stateful per-stream translator: Anthropic /v1/messages SSE events → house
 * deltas. A tool call spans THREE events (content_block_start names id+name,
 * input_json_delta appends partial JSON, content_block_stop finalizes) — the
 * per-index accumulator map is why this is a class, not a pure function. Fed
 * from consumeUpstreamSSE's parse loop; the error event THROWS with the same
 * "Upstream stream error: …" contract as the OpenAI in-band error path, so
 * the engine's retry/rotate semantics are shared across dialects.
 */
export class AnthropicSSETranslator {
  private blocks = new Map<number, { id: string; name: string; args: string }>();

  feed(ev: unknown): AnthropicSSEDelta | null {
    const e = ev as {
      type?: string;
      index?: number;
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
      error?: { message?: string };
    };
    switch (e.type) {
      case "content_block_start":
        if (e.content_block?.type === "tool_use" && e.content_block.id) {
          this.blocks.set(e.index ?? 0, { id: e.content_block.id, name: e.content_block.name ?? "", args: "" });
        }
        return null;
      case "content_block_delta": {
        const d = e.delta ?? {};
        if (d.type === "text_delta" && d.text) return { text: d.text };
        if (d.type === "thinking_delta" && d.thinking) return { reasoning: d.thinking };
        if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
          const b = this.blocks.get(e.index ?? 0);
          if (b) b.args += d.partial_json;
        }
        return null;
      }
      case "content_block_stop": {
        const b = this.blocks.get(e.index ?? 0);
        if (b) {
          this.blocks.delete(e.index ?? 0);
          return { toolCall: { index: e.index ?? 0, id: b.id, name: b.name, args: b.args } };
        }
        return null;
      }
      case "message_delta":
        return { finished: true };
      case "message_stop":
        return { done: true };
      case "error":
        throw new Error(
          `Upstream stream error: ${String(e.error?.message ?? "unknown anthropic stream error").slice(0, 300)}`,
        );
      default:
        return null; // message_start, ping, unknown event types — no house delta
    }
  }
}
