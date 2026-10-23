import type { RouteReceipt, ToolCallInfo, ToolId } from "./types";
import {
  classifyUpstreamError,
  runRelayedCustom,
  type EngineBody,
  type RelayWireHop,
} from "./agent-engine";
import { buildToolDefs, httpToolExecutor } from "./tools-defs";
import {
  noteProvider429,
  provider429CooldownLeftMs,
  resetProvider429,
} from "./provider-rotation";

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
//
// r315: the browser-direct lane now feeds the SHARED per-provider 429
// exhaustion memory (provider-rotation.ts) — a pre-stream rate-limit on this
// lane notes the provider with the same exponential cooldown workflow steps
// use, and a successful dial clears it. Chat and scheduled workflows finally
// share one saturation map (tab-wide module memory); before this, a chat 429
// left zero trace in the memory that gates registry rotation.

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
  /**
   * r506: per-request first-token budget (ms) — utility dials carry a short
   * one (UTILITY_FAST_BUDGET_MS) so a silent lane is rotated off in 30s
   * instead of the 60s engine default. Threaded to the engine for the
   * primary AND every relay hop; clamped server-side to [10s, 120s].
   */
  firstTokenBudgetMs?: number;
  /**
   * 2-a: Cortex Edge config (BYOK) — forwarded PER REQUEST to whichever lane
   * executes tools: the server relay body, or /api/tools/execute for the
   * browser-direct engine. Never persisted server-side; absent = the
   * deep_scrape ladder degrades to its read_url/web_search fallback.
   */
  cortex?: { url: string; key?: string; hbKey?: string };
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
  /** r511 Praison-style L4 — why the loop ended ("goal" is healthy; doom_loop
   *  / max_iterations / no_tool_calls feed the run drawer's honest evidence). */
  completionReason?: string;
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
}

interface DonePayload {
  content: string;
  toolCalls: ToolCallInfo[];
  iterations: number;
  /** r511 — Praison L4 completion reason echoed by the engine's done event. */
  completionReason?: string;
}

/**
 * Headers budget for the /api/chat fetch (r25 watchdog). r141: 20s killed the
 * relay lane whenever the dev server started slowly — cold route compile or
 * event-loop congestion under the scheduled pipelines' own tool traffic —
 * surfacing as "server did not respond in 20s" on every scheduled run
 * (live: 12 hourly runs, all dead at the same step). That is slow-start, not
 * a wedged server: headers flush immediately once the handler runs
 * (route sends a start frame synchronously). r505: 60s → 90s — the Vyce-class
 * outage (silent ~65s hangs, 0% success) needs the header wall to EXCEED one
 * engine first-token budget (60s) plus rotation slack, or the client kills
 * the request exactly when the ladder starts rotating ("✗4 failed dials
 * (Vyce AI ×4)", every dial dead at 60s while the server logged 200 in 61s).
 * 90s still bounds a genuinely wedged server; the 90s stream stall watchdog
 * takes over the moment headers arrive.
 */
const CONNECT_TIMEOUT_MS = 90_000;
/** Max byte gap tolerated on the /api/chat SSE stream (r25 watchdog). */
const SERVER_STALL_TIMEOUT_MS = 90_000;

/**
 * v9: ONE decision point for the browser-direct lane's failures.
 * "rethrow" — the caller cancelled (never re-dial over a cancel), or output
 * already streamed (surfacing honestly beats stitching two models into one
 * answer; the workflow self-heal retries cleanly).
 * "fallback" — pre-stream transport failure, INCLUDING internal deadline
 * aborts (first-token/connect budgets). Pre-v9 code mistook those for user
 * cancels via the bare isAbortError check — the r92 E2E proved a stalled
 * direct provider then TERMINATED the step with no fallback at all.
 */
export type DirectLaneAction = "rethrow" | "fallback";

export function classifyDirectLaneFailure(
  userAborted: boolean,
  sawTokens: boolean
): DirectLaneAction {
  if (userAborted) return "rethrow";
  if (sawTokens) return "rethrow";
  return "fallback";
}

/**
 * v10: true when an abort reason marks a CALLER-side watchdog (stall/timeout),
 * not user intent. The workflow runner's stall watchdog aborts with
 * Error("no model output for over Ns — the stream stalled") (workflow-runner.ts);
 * user cancels abort bare. Without this, such watchdog aborts flip
 * signal.aborted and the v9 classifier mistakes them for user cancels —
 * the r94 E2E proved the fallback never engaged on the runner path.
 * Exported for unit tests.
 */
export function isWatchdogAbortReason(reason: unknown): boolean {
  const msg =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "";
  return /no model output|stalled|timed?\s?out/i.test(msg);
}

export async function runAgentChat(
  params: RunAgentParams,
  h: AgentHandlers = {}
): Promise<AgentRunResult> {
  const canDirect =
    !params.forceServer && params.provider === "custom" && !!params.baseUrl?.trim();

  if (canDirect) {
    // r316: consult the shared 429 cooldown BEFORE dialing. The user picked
    // this provider, so the dial proceeds — but the status line says
    // honestly, once, that the lane is cooling from a proven recent rate
    // limit (scheduled workflow steps rotate off it meanwhile; a fresh 429
    // here re-notes the lane and extends the window, r315).
    if (params.providerId && params.providerId !== "auto") {
      const coolingMs = provider429CooldownLeftMs(params.providerId);
      if (coolingMs > 0) {
        h.onStatus?.(
          `Provider cooling ${Math.ceil(coolingMs / 1000)}s (recent rate limit) — dialing anyway…`
        );
      }
    }
    let sawTokens = false;
    try {
      const direct = await runBrowserDirect(params, h, () => {
        sawTokens = true;
      });
      // r315: a successful direct dial clears the provider's cooldown —
      // mirrors the workflow runner's post-success reset (workflow-runner).
      if (params.providerId && params.providerId !== "auto") {
        resetProvider429(params.providerId);
      }
      return direct;
    } catch (err) {
      // v10: signal.aborted alone is NOT user intent — a caller watchdog
      // (runner stall abort) aborts the same signal with a stall reason.
      const userAborted =
        params.signal?.aborted === true &&
        !isWatchdogAbortReason(params.signal?.reason);
      const action = classifyDirectLaneFailure(userAborted, sawTokens);
      if (action === "rethrow") throw err;
      // r315: a pre-stream 429 on the chat lane feeds the SAME per-provider
      // exhaustion memory the workflow runner notes (r306 doctrine) —
      // nextRotation and lane demotion read this map tab-wide, so a chat 429
      // keeps scheduled steps off the saturated provider for the cooldown
      // window instead of re-learning it per run. The engine ships a
      // structured kind (r25); the message regex is the fallback for native
      // browser-direct failures (CORS/network TypeErrors carry no kind).
      // Billing/auth/model kinds are deliberately NOT noted — mirrors r307,
      // which reserves the memory for proven saturation only.
      if (params.providerId && params.providerId !== "auto") {
        const failKind =
          (err as { kind?: string }).kind ?? classifyUpstreamError(err);
        if (failKind === "rate-limit") {
          noteProvider429(params.providerId, Date.now());
        }
      }
      h.onStatus?.(
        isAbortError(err)
          ? `Browser-direct timed out (${short(err)}) — routing through the app relay…`
          : `Browser-direct call failed (${short(err)}) — routing through the app relay…`
      );
    }
    // v10: if the caller's signal already died from a watchdog abort, hand the
    // relay leg a clean signal — a poisoned (already-aborted) signal would
    // kill the fallback before it ever dials.
    const relayParams =
      params.signal?.aborted === true ? { ...params, signal: undefined } : params;
    return runServerAgent(relayParams, h);
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
    ...(params.images && params.images.length > 0 ? { images: params.images } : {}),
    ...(params.relay && params.relay.length > 0
      ? { relay: params.relay as RelayWireHop[] }
      : {}),
    ...(params.firstTokenBudgetMs ? { firstTokenBudgetMs: params.firstTokenBudgetMs } : {}),
    ...(params.cortex ? { cortex: params.cortex } : {}),
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
      case "done": {
        done = {
          content: String(evt.content ?? ""),
          toolCalls: Array.isArray(evt.toolCalls) ? (evt.toolCalls as ToolCallInfo[]) : [],
          iterations: Number(evt.iterations ?? 1),
          ...(typeof (evt as { completionReason?: unknown }).completionReason === "string"
            ? { completionReason: (evt as { completionReason: string }).completionReason }
            : {}),
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
  await runRelayedCustom(
    body,
    send,
    params.signal ?? new AbortController().signal,
    {
      defs: buildToolDefs(params.tools ?? []),
      // 2-a: the browser-direct engine's tools still execute server-side via
      // /api/tools/execute — forward the Cortex config per request so
      // deep_scrape gets its edge lane there too (BYOK: transit only, never
      // persisted).
      execute: (name, argsJson, signal) =>
        httpToolExecutor(name, argsJson, signal, params.cortex ? { cortex: params.cortex } : undefined),
    },
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
        ...(params.relay && params.relay.length > 0 ? { relay: params.relay } : {}),
        ...(params.firstTokenBudgetMs ? { firstTokenBudgetMs: params.firstTokenBudgetMs } : {}),
        ...(params.cortex ? { cortex: params.cortex } : {}),
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
      case "done":
        done = {
          content: String(evt.content ?? ""),
          toolCalls: Array.isArray(evt.toolCalls) ? (evt.toolCalls as ToolCallInfo[]) : [],
          iterations: Number(evt.iterations ?? 1),
          ...(typeof (evt as { completionReason?: unknown }).completionReason === "string"
            ? { completionReason: (evt as { completionReason: string }).completionReason }
            : {}),
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
  return { content: result.content, toolCalls: result.toolCalls, iterations: result.iterations, completionReason: result.completionReason, transport: "server" as const };
}

function short(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.length > 80 ? `${m.slice(0, 80)}…` : m || "network/CORS";
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "ResponseAborted");
}

// v9 doc note: isAbortError matches INTERNAL deadline aborts too (the engine's
// first-token/connect budgets abort with the plain "AbortError" name). It is
// therefore a TRANSPORT-signal classifier, not a user-intent classifier —
// user intent must come from params.signal.aborted (see classifyDirectLaneFailure).
