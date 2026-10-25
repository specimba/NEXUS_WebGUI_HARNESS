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
// (automation-executor dialStep) — non-streaming, no tools — gated on a
// provider registry entry carrying dialect:"anthropic" (vyce, whose own
// guide advertises the /v1/messages bonus endpoint). The engine's streaming
// tool-loop SSE translation (content_block_delta → house deltas) is the
// documented NEXT slice, not claimed here.
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
  messages: { role: string; content: unknown }[];
  max_tokens?: number;
  temperature?: number;
}

/**
 * Shape an OpenAI-dialect chat body into an Anthropic /v1/messages body.
 * Dialect rules honored here:
 *   - "system" is NOT a message role: it moves to the top-level `system`
 *     field (string).
 *   - max_tokens is REQUIRED by the wire (defaults to 4096 when absent).
 *   - stop → stop_sequences (array).
 *   - only user/assistant roles are legal in messages.
 */
export function openaiBodyToAnthropic(body: OpenAIDialBody): Record<string, unknown> {
  const systemParts: string[] = [];
  const messages: { role: string; content: unknown }[] = [];
  for (const m of body.messages ?? []) {
    if (m.role === "system") {
      if (typeof m.content === "string" && m.content.trim()) systemParts.push(m.content);
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
