"use client";

import type { ToolCallInfo, ToolId } from "./types";
import { runRelayedCustom, type EngineBody, type RelayWireHop } from "./agent-engine";
import { buildToolDefs, httpToolExecutor } from "./tools-defs";

// ─── Client agent runner ─────────────────────────────────────────────────────
// TWO transports, tried in order (r23):
//
// 1. BROWSER-DIRECT (default for custom providers) — the agentic loop runs in
//    YOUR browser: LLM calls go straight from your network to the provider
//    with your key (true BYOK: the key is used where you are, and providers
//    that block datacenter IPs — Groq/Cerebras/Google do — work again).
//    Tools still execute server-side via /api/tools/execute (search SDK +
//    CORS-free fetcher live there).
// 2. SERVER RELAY (automatic fallback) — POST /api/chat, the pre-r23 path.
//    Engaged when the browser-direct call fails BEFORE streaming anything
//    (CORS refusal, provider down); also the only path for the built-in
//    auto engine and vision-heavy requests.

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
  /**
   * Model Relay fallback hops (Genius-rotator doctrine): tried in order when
   * the primary fails while nothing has streamed. Built from the vault via
   * buildRelayWire().
   */
  relay?: { baseUrl?: string; apiKey?: string; model: string; label?: string; useAuto?: boolean }[];
  signal?: AbortSignal;
  /** Force the legacy server transport (used after a browser-direct CORS death). */
  forceServer?: boolean;
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
  /** Which transport produced the answer (run-call-log observability). */
  transport: "browser-direct" | "server";
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

export async function runAgentChat(
  params: RunAgentParams,
  h: AgentHandlers = {}
): Promise<AgentRunResult> {
  const canDirect =
    !params.forceServer && params.provider === "custom" && !!params.baseUrl?.trim();

  if (canDirect) {
    let sawTokens = false;
    try {
      return await runBrowserDirect(params, h, () => {
        sawTokens = true;
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      // Mid-stream death: the user already saw partial output from this
      // transport — surface it honestly (the workflow self-heal retries).
      if (sawTokens) throw err;
      // Pre-stream death (CORS refusal, provider unreachable from this
      // network) → transparently continue through the server relay.
      h.onStatus?.(
        `Browser-direct call failed (${short(err)}) — routing through the app relay…`
      );
    }
  }
  return runServerAgent(params, h);
}

/** Browser-direct execution of the SAME engine the server runs. */
async function runBrowserDirect(
  params: RunAgentParams,
  h: AgentHandlers,
  onFirstToken: () => void
): Promise<AgentRunResult> {
  const body: EngineBody = {
    baseUrl: params.baseUrl,
    apiKey: params.apiKey,
    model: params.model,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    maxIterations: params.maxIterations,
    system: params.system,
    messages: params.messages,
    tools: params.tools ?? [],
    ...(params.images && params.images.length > 0 ? { images: params.images } : {}),
    ...(params.relay && params.relay.length > 0
      ? { relay: params.relay as RelayWireHop[] }
      : {}),
  };

  const send = (evt: Record<string, unknown>) => {
    switch (evt.type) {
      case "status":
        h.onStatus?.(String(evt.message ?? ""));
        break;
      case "iteration":
        h.onIteration?.(Number(evt.n ?? 1));
        break;
      case "token":
        onFirstToken();
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
      case "done": {
        done = {
          content: String(evt.content ?? ""),
          toolCalls: Array.isArray(evt.toolCalls) ? (evt.toolCalls as ToolCallInfo[]) : [],
          iterations: Number(evt.iterations ?? 1),
        };
        break;
      }
      case "error":
        throw new Error(String(evt.message ?? "Unknown agent error"));
      default:
        break;
    }
  };

  let done: DonePayload | null = null;
  await runRelayedCustom(
    body,
    send,
    params.signal ?? new AbortController().signal,
    { defs: buildToolDefs(params.tools ?? []), execute: httpToolExecutor },
    // No autoRunner in the browser — a useAuto hop throws here, the relay
    // rotates past it, and if the chain exhausts we fall back to the server
    // (which owns the built-in engine) in runAgentChat.
    undefined
  );
  h.onStatus?.("Served browser-direct — your key never touched the app server.");
  if (!done) throw new Error("The browser-direct engine ended without a result.");
  const result: DonePayload = done;
  return { ...result, transport: "browser-direct" as const };
}

/** Legacy transport: POST /api/chat and parse its SSE stream. */
async function runServerAgent(params: RunAgentParams, h: AgentHandlers): Promise<AgentRunResult> {
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
      ...(params.relay && params.relay.length > 0 ? { relay: params.relay } : {}),
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
  return { content: result.content, toolCalls: result.toolCalls, iterations: result.iterations, transport: "server" as const };
}

function short(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 80 ? `${m.slice(0, 80)}…` : m || "network/CORS";
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "ResponseAborted");
}
