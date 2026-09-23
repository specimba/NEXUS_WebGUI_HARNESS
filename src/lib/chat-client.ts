"use client";

import type { McpServer, RouteReceipt, ToolCallInfo, ToolId } from "./types";
import { runRelayedCustom, type EngineBody, type RelayWireHop } from "./agent-engine";
import { buildToolDefs, httpToolExecutor, type EngineToolIO } from "./tools-defs";
import { buildMcpToolPlan, executeMcpDefCall, parseMcpToolDefName } from "./mcp";

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
//
// r25 watchdogs: the /api/chat fetch gets a 20s connect deadline, and the SSE
// read loop fails honestly when NO bytes (server keep-alive pings count) have
// arrived for 90s — a dead stream used to spin forever.

export interface RunAgentParams {
  provider?: "auto" | "custom";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Registry id of the resolved provider (r25) — stamps the primary hop's
   *  health-memory key so its failures/successes reach the rotator. */
  providerId?: string;
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
  /** r34 harness knob: mid-answer stall resumes allowed for this turn (0-3). */
  stallResumes?: number;
  /** r35 per-step reasoning effort — forwarded to OpenAI-compatible custom lanes. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  signal?: AbortSignal;
  /** Force the legacy server transport (used after a browser-direct CORS death). */
  forceServer?: boolean;
  /**
   * r38 MCP registry slice (see mcpRunParams): enabled servers whose enabled
   * tools ride this run. Browser-direct only — the server engine never sees
   * MCP defs (registry is browser-local by design).
   */
  mcpServers?: McpServer[];
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

export interface RouterEvent {
  resolved: string;
  policy?: string;
  reason?: string;
  sticky?: boolean;
}

export interface AgentHandlers {
  onStatus?: (message: string) => void;
  onIteration?: (n: number) => void;
  onToken?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onToolCall?: (call: ToolCallEvent) => void;
  onToolResult?: (result: ToolResultEvent) => void;
  /** r27 route receipt: which serving path answered (arXiv:2605.01710). */
  onReceipt?: (receipt: RouteReceipt) => void;
  /** r34 gateway-router receipt: which model the gateway's auto policy picked. */
  onRouter?: (router: RouterEvent) => void;
}

interface DonePayload {
  content: string;
  toolCalls: ToolCallInfo[];
  iterations: number;
}

/** Headers budget for the /api/chat fetch (r25 watchdog). */
const CONNECT_TIMEOUT_MS = 20_000;
/** Max byte gap tolerated on the /api/chat SSE stream (r25 watchdog). */
const SERVER_STALL_TIMEOUT_MS = 90_000;

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
    providerId: params.providerId,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    maxIterations: params.maxIterations,
    system: params.system,
    messages: params.messages,
    tools: params.tools ?? [],
    ...(typeof params.stallResumes === "number" ? { stallResumes: params.stallResumes } : {}),
    ...(params.reasoningEffort ? { reasoningEffort: params.reasoningEffort } : {}),
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
      case "receipt":
        if (evt.receipt && typeof evt.receipt === "object") {
          h.onReceipt?.(evt.receipt as RouteReceipt);
        }
        break;
      case "router":
        if (evt.resolved) {
          h.onRouter?.({
            resolved: String(evt.resolved),
            ...(evt.policy ? { policy: String(evt.policy) } : {}),
            ...(evt.reason ? { reason: String(evt.reason) } : {}),
            sticky: evt.sticky === true,
          });
        }
        break;
      case "done": {
        done = {
          content: String(evt.content ?? ""),
          toolCalls: Array.isArray(evt.toolCalls) ? (evt.toolCalls as ToolCallInfo[]) : [],
          iterations: Number(evt.iterations ?? 1),
        };
        break;
      }
      case "error": {
        const err = new Error(String(evt.message ?? "Unknown agent error"));
        if (evt.kind) (err as Error & { kind?: string }).kind = String(evt.kind);
        throw err;
      }
      default:
        break;
    }
  };

  let done: DonePayload | null = null;
  // r38 MCP bridge: enabled MCP tools join the built-in defs; calls whose name
  // parses as mcp__<server>__<tool> route to the MCP client, everything else
  // to the standard server executor. Output then flows through the same
  // fencing/scrubbing as built-in tools (fenceToolOutputForModel downstream).
  const mcpPlan =
    params.mcpServers && params.mcpServers.length > 0
      ? buildMcpToolPlan(params.mcpServers)
      : null;
  const toolIO: EngineToolIO = {
    defs: [...buildToolDefs(params.tools ?? []), ...(mcpPlan?.defs ?? [])],
    execute:
      mcpPlan && mcpPlan.offered.length > 0
        ? (name, argsJson, signal) =>
            parseMcpToolDefName(name)
              ? executeMcpDefCall(params.mcpServers ?? [], name, argsJson, signal)
              : httpToolExecutor(name, argsJson, signal)
        : httpToolExecutor,
  };
  await runRelayedCustom(
    body,
    send,
    params.signal ?? new AbortController().signal,
    toolIO,
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
  // Connect deadline (r25): if the app server is wedged, fail fast with a
  // human error instead of hanging on the fetch forever. Implemented with an
  // owned controller + timer so the deadline only covers the HEADER phase —
  // it is disarmed the moment headers arrive, never killing long streams.
  const connectCtl = new AbortController();
  const onCallerAbort = () => connectCtl.abort(params.signal?.reason);
  if (params.signal?.aborted) connectCtl.abort(params.signal.reason);
  else params.signal?.addEventListener("abort", onCallerAbort, { once: true });
  const connectTimer = setTimeout(
    () => connectCtl.abort(new DOMException(`server did not respond in ${Math.round(CONNECT_TIMEOUT_MS / 1000)}s`, "TimeoutError")),
    CONNECT_TIMEOUT_MS
  );
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: params.provider,
        apiKey: params.apiKey,
        baseUrl: params.baseUrl,
        model: params.model,
        providerId: params.providerId,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        maxIterations: params.maxIterations,
        system: params.system,
        messages: params.messages,
        tools: params.tools ?? [],
        ...(typeof params.stallResumes === "number" ? { stallResumes: params.stallResumes } : {}),
        ...(params.reasoningEffort ? { reasoningEffort: params.reasoningEffort } : {}),
        ...(params.relay && params.relay.length > 0 ? { relay: params.relay } : {}),
        ...(params.images && params.images.length > 0 ? { images: params.images } : {}),
      }),
      signal:
        params.signal && typeof AbortSignal.any === "function"
          ? AbortSignal.any([params.signal, connectCtl.signal])
          : connectCtl.signal,
    });
  } catch (err) {
    clearTimeout(connectTimer);
    if (!params.signal?.aborted && connectCtl.signal.aborted) {
      throw new Error(`server did not respond in ${Math.round(CONNECT_TIMEOUT_MS / 1000)}s`);
    }
    throw err; // caller abort / network error — original semantics
  }
  // Headers arrived — the connect deadline is spent. The caller-abort
  // forwarding stays attached (it carries user stops into the stream when
  // AbortSignal.any is unavailable); the stream watchdog takes over below.
  clearTimeout(connectTimer);

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
  // Stream watchdog (r25): the server pings every 15s, so ANY 90s byte gap
  // (pings count — every successful read refreshes this) means the pipe is
  // dead. Abort the reader and fail honestly instead of spinning forever.
  let lastBytesAt = Date.now();

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
      case "receipt":
        if (evt.receipt && typeof evt.receipt === "object") {
          h.onReceipt?.(evt.receipt as RouteReceipt);
        }
        break;
      case "router":
        if (evt.resolved) {
          h.onRouter?.({
            resolved: String(evt.resolved),
            ...(evt.policy ? { policy: String(evt.policy) } : {}),
            ...(evt.reason ? { reason: String(evt.reason) } : {}),
            sticky: evt.sticky === true,
          });
        }
        break;
      case "done":
        done = {
          content: String(evt.content ?? ""),
          toolCalls: Array.isArray(evt.toolCalls) ? (evt.toolCalls as ToolCallInfo[]) : [],
          iterations: Number(evt.iterations ?? 1),
        };
        break;
      case "error": {
        const err = new Error(String(evt.message ?? "Unknown agent error"));
        if (evt.kind) (err as Error & { kind?: string }).kind = String(evt.kind);
        throw err;
      }
      default:
        break;
    }
  };

  while (true) {
    // Per-read watchdog race (r25): each read competes against a fresh
    // SERVER_STALL_TIMEOUT_MS timer; a successful read of ANY bytes (data or
    // keep-alive comments) refreshes lastBytesAt.
    let stalled: Error | null = null;
    let rejectStall: (e: Error) => void = () => {};
    const stallPromise = new Promise<never>((_, reject) => {
      rejectStall = reject;
    });
    const stallTimer = setTimeout(() => {
      const idleFor = Date.now() - lastBytesAt;
      if (idleFor < SERVER_STALL_TIMEOUT_MS) return; // a fresh byte just landed
      stalled = new Error(`stream stalled: no data for ${Math.round(SERVER_STALL_TIMEOUT_MS / 1000)}s (network timeout)`);
      rejectStall(stalled);
    }, SERVER_STALL_TIMEOUT_MS);
    let value: Uint8Array | undefined;
    let finished: boolean;
    try {
      const read = await Promise.race([reader.read(), stallPromise]);
      value = read.value;
      finished = read.done;
    } catch (err) {
      clearTimeout(stallTimer);
      if (stalled !== null && err === stalled) {
        // Watchdog fired — NOT a user abort (plain Error, distinguishable);
        // kill the stream and surface the honest timeout.
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw err;
      }
      throw err; // caller abort / stream death — original semantics
    }
    clearTimeout(stallTimer);
    if (finished) break;
    lastBytesAt = Date.now();
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
