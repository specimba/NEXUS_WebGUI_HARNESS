"use client";

// ─── r40 MRTR human gate (Multi Round-Trip Requests, MCP 2026-07-28) ─────────
// The 2026-07-28 MCP spec replaced server-initiated sampling/elicitation with
// MRTR: a tools/call may answer `resultType: "input_required"` carrying
// `inputRequests[]`, and the client retries the ORIGINAL request with
// `inputResponses`. That maps 1:1 onto an approval/clarify dialog + re-POST.
//
// Doctrine:
//   • INTERACTIVE lanes (chat conversation, agent playground) open the gate —
//     the model's tool call pauses until the user answers, declines, or the
//     deadline auto-declines (an unattended gate must never hang a run).
//   • HEADLESS lanes (pipeline runs, suite bake-offs, the external heartbeat)
//     NEVER open dialogs — they get an honest "input unavailable" result so
//     the model can adapt or skip (same app-open-only doctrine as schedules).
//   • One human round per call (MCP_INPUT_MAX_ROUNDS) — a server that asks
//     again after receiving answers is stopped honestly, not looped.
//   • The gate is a plain promise + store; the engine loop just sees a tool
//     call that took longer — zero engine changes, both transports safe.

import { create } from "zustand";
import { MCP_INPUT_MAX_REQUESTS, MCP_INPUT_RESPONSE_MAX_CHARS, MCP_INPUT_TIMEOUT_MS } from "./constants";
import type { McpInputRequest, McpInputResponse } from "./types";

// ─── Defensive parsing ───────────────────────────────────────────────────────

/** Best-effort human prompt from the common request field shapes. */
function extractMessage(raw: Record<string, unknown>): string | undefined {
  for (const key of ["message", "prompt", "question", "text", "description", "reason"]) {
    const v = raw[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 400);
  }
  return undefined;
}

/**
 * Parse an `inputRequests[]` payload defensively: the spec fixes the result
 * envelope, not the request fields, so anything that looks like a request is
 * kept (raw echoed verbatim, id/type/message extracted when present).
 * Never throws; returns [] for garbage so a broken server degrades to a
 * plain decline instead of crashing the run.
 */
export function parseMcpInputRequests(payload: unknown): McpInputRequest[] {
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).requests)
      ? ((payload as Record<string, unknown>).requests as unknown[])
      : [];
  const out: McpInputRequest[] = [];
  for (const item of list.slice(0, MCP_INPUT_MAX_REQUESTS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : typeof raw.requestId === "string" ? raw.requestId : undefined;
    const type = typeof raw.type === "string" ? raw.type : undefined;
    out.push({
      ...(id ? { id } : {}),
      ...(type ? { type } : {}),
      ...(extractMessage(raw) ? { message: extractMessage(raw) } : {}),
      raw,
    });
  }
  return out;
}

/** Build the `inputResponses` array sent on the retried request. */
export function buildInputResponses(
  requests: McpInputRequest[],
  answers: string[]
): McpInputResponse[] {
  return requests.map((req, i) => ({
    ...(req.id ? { id: req.id } : {}),
    value: (answers[i] ?? "").slice(0, MCP_INPUT_RESPONSE_MAX_CHARS),
  }));
}

// ─── The gate store (drives the global dialog) ───────────────────────────────

export interface McpGatePending {
  /** Full def name, e.g. mcp__deepwiki__ask_question — audit + tooltips. */
  defName: string;
  serverName: string;
  toolName: string;
  requests: McpInputRequest[];
  requestedAt: number;
  timeoutMs: number;
  resolve: (r: GateResolution) => void;
}

export interface GateResolution {
  action: "answered" | "declined";
  /** Present on "answered" — one response per request, same order. */
  responses?: McpInputResponse[];
  /** Why the gate closed without answers ("deadline" / user decline). */
  reason?: string;
}

interface McpGateState {
  pending: McpGatePending | null;
  open: (p: McpGatePending) => void;
  answer: (values: string[]) => void;
  decline: (reason?: string) => void;
}

export const useMcpGateStore = create<McpGateState>((set, get) => ({
  pending: null,
  open: (p) => set({ pending: p }),
  answer: (values) => {
    const p = get().pending;
    if (!p) return;
    set({ pending: null });
    p.resolve({ action: "answered", responses: buildInputResponses(p.requests, values) });
  },
  decline: (reason) => {
    const p = get().pending;
    if (!p) return;
    set({ pending: null });
    p.resolve({ action: "declined", reason: reason ?? "declined by user" });
  },
}));

// ─── The gate function (the ONLY surface mcp.ts talks to) ────────────────────

export interface McpGateArgs {
  /** Interactive lanes open the dialog; headless lanes decline immediately. */
  interactive: boolean;
  defName: string;
  serverName: string;
  toolName: string;
  requests: McpInputRequest[];
  signal?: AbortSignal;
  /** Test seam — defaults to MCP_INPUT_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * Resolve an input_required round. Resolves null when the gate is unavailable
 * (headless) or the caller was aborted — both mean "honest decline".
 */
export function gateMcpInput(args: McpGateArgs): Promise<GateResolution | null> {
  if (!args.interactive || args.requests.length === 0) {
    return Promise.resolve(null);
  }
  return new Promise<GateResolution | null>((resolve) => {
    let settled = false;
    const finish = (r: GateResolution | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupAbort();
      resolve(r);
    };

    const deadline = args.timeoutMs ?? MCP_INPUT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      // Store decline resolves the pending promise → finish(declined).
      useMcpGateStore.getState().decline(`auto-declined after ${Math.round(deadline / 1000)}s — no user input`);
      finish(null); // safety net if no dialog was mounted
    }, deadline);

    const onAbort = () => {
      useMcpGateStore.getState().decline("run aborted");
      finish(null);
    };
    const cleanupAbort = () => args.signal?.removeEventListener("abort", onAbort);
    if (args.signal) {
      if (args.signal.aborted) {
        finish(null);
        return;
      }
      args.signal.addEventListener("abort", onAbort, { once: true });
    }

    useMcpGateStore.getState().open({
      defName: args.defName,
      serverName: args.serverName,
      toolName: args.toolName,
      requests: args.requests,
      requestedAt: Date.now(),
      timeoutMs: deadline,
      resolve: (r) => finish(r),
    });
  });
}

/** Summarize requests for the honest decline/stop message fed to the model. */
export function summarizeInputRequests(requests: McpInputRequest[]): string {
  if (requests.length === 0) return "(no details)";
  return requests
    .map((r, i) => `${i + 1}. ${r.message ?? r.type ?? r.id ?? "(unspecified request)"}`)
    .join(" ");
}
