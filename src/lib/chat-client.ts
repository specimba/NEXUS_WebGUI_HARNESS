"use client";

import type { ToolCallInfo, ToolId } from "./types";

// ─── Client for the /api/chat SSE endpoint ───────────────────────────────────

export interface RunAgentParams {
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
  /** Images attached to the newest user message (data URLs) — vision path. */
  images?: { name: string; dataUrl: string }[];
  signal?: AbortSignal;
}

export interface ToolCallEvent {
  id: string;
  name: string;
  args: string;
}

export interface ToolResultEvent extends ToolCallEvent {
  ok: boolean;
  ms: number;
  content: string;
}

export interface AgentRunResult {
  content: string;
  toolCalls: ToolCallInfo[];
  iterations: number;
}

export interface AgentHandlers {
  onStatus?: (message: string) => void;
  onIteration?: (n: number) => void;
  onToken?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolCall?: (call: ToolCallEvent) => void;
  onToolResult?: (result: ToolResultEvent) => void;
}

interface DonePayload {
  content: string;
  toolCalls: ToolCallInfo[];
  iterations: number;
}

/**
 * Streams one agent turn from POST /api/chat.
 * Resolves with the final answer; throws Error on failure (including aborts —
 * check `err.name === "AbortError"` for user-initiated stops).
 */
export async function runAgentChat(
  params: RunAgentParams,
  h: AgentHandlers = {}
): Promise<AgentRunResult> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: params.provider,
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      model: params.model,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
      maxIterations: params.maxIterations,
      system: params.system,
      messages: params.messages,
      tools: params.tools ?? [],
      ...(params.images && params.images.length > 0 ? { images: params.images } : {}),
    }),
    signal: params.signal,
  });

  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: DonePayload | null = null;

  const handleEvent = (raw: string) => {
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }
    switch (evt.type) {
      case "status":
        h.onStatus?.(String(evt.message ?? ""));
        break;
      case "iteration":
        h.onIteration?.(Number(evt.n ?? 1));
        break;
      case "token":
        h.onToken?.(String(evt.text ?? ""));
        break;
      case "reasoning":
        h.onReasoning?.(String(evt.text ?? ""));
        break;
      case "tool_call":
        h.onToolCall?.({ id: String(evt.id), name: String(evt.name), args: String(evt.args ?? "") });
        break;
      case "tool_result":
        h.onToolResult?.({
          id: String(evt.id),
          name: String(evt.name),
          args: String(evt.args ?? ""),
          ok: Boolean(evt.ok),
          ms: Number(evt.ms ?? 0),
          content: String(evt.content ?? ""),
        });
        break;
      case "done":
        done = {
          content: String(evt.content ?? ""),
          toolCalls: Array.isArray(evt.toolCalls) ? (evt.toolCalls as ToolCallInfo[]) : [],
          iterations: Number(evt.iterations ?? 1),
        };
        break;
      case "error":
        throw new Error(String(evt.message ?? "Unknown agent error"));
      default:
        break;
    }
  };

  while (true) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) handleEvent(line.slice(5).trim());
      }
    }
  }

  if (!done) {
    throw new Error("The agent stream ended without a result.");
  }
  const result: DonePayload = done;
  return { content: result.content, toolCalls: result.toolCalls, iterations: result.iterations };
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "ResponseAborted");
}
