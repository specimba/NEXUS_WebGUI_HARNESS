"use client";

// ─── MCP tool health ledger (r39) ────────────────────────────────────────────
// The relay keeps a hop ledger for LLM lanes; this is the honest analog for
// MCP tools: every EXECUTED tool call (not discovery) records ok/fail/latency
// into a small, local-only ledger. Outcomes surface three ways:
//   1. Settings → MCP tool rows get a health chip (ok-rate, mean ms, streaks).
//   2. buildMcpToolPlan appends a short "recently flaky" hint to the tool
//      description sent to the model after repeated failures — the model can
//      then prefer another tool or ask instead of blindly retrying (the same
//      steering idea as relay hop order, at tool granularity).
//   3. The card offers a per-ledger reset (quarantine-free, user-owned).
// Everything stays in localStorage — BYOK doctrine: no server ever sees it.

import type { McpToolInfo } from "./types";

export interface McpToolHealth {
  calls: number;
  oks: number;
  fails: number;
  /** Consecutive failures (reset by any ok). Drives the flaky hint + chip. */
  failStreak: number;
  lastOkAt?: number;
  lastFailAt?: number;
  lastError?: string;
  /** Mean latency over the last MCP_HEALTH_WINDOW outcomes. */
  meanMs: number;
  lastMs?: number;
}

const STORAGE_KEY = "praison-mcp-health";
const SCHEMA_VERSION = 1;

/** Ledger cap — oldest entries (by last activity) drop first. */
export const MCP_HEALTH_CAP = 200;
/** Outcomes averaged into meanMs (recent window, not lifetime). */
export const MCP_HEALTH_WINDOW = 10;
/** Consecutive failures before the model-facing description gains a hint. */
export const MCP_HEALTH_FLAKY_STREAK = 2;

let cache: Record<string, McpToolHealth> | null = null;
const recentMs = new Map<string, number[]>();

function load(): Record<string, McpToolHealth> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { version?: number; entries?: Record<string, McpToolHealth> };
      if (parsed?.version === SCHEMA_VERSION && parsed.entries && typeof parsed.entries === "object") {
        cache = parsed.entries;
      }
    }
  } catch {
    // corrupt ledger → start fresh (health is advisory, never load-bearing)
  }
  cache ??= {};
  return cache;
}

function persist(): void {
  if (!cache) return;
  const keys = Object.keys(cache);
  if (keys.length > MCP_HEALTH_CAP) {
    // Evict the stalest entries by last activity (ok or fail, whichever later).
    const lastTouch = (k: string) => Math.max(cache![k].lastOkAt ?? 0, cache![k].lastFailAt ?? 0);
    keys.sort((a, b) => lastTouch(a) - lastTouch(b));
    for (const k of keys.slice(0, keys.length - MCP_HEALTH_CAP)) delete cache![k];
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION, entries: cache })
    );
  } catch {
    // storage full/quota — health silently degrades to in-memory only
  }
}

function windowPush(defName: string, ms: number): number {
  const arr = recentMs.get(defName) ?? [];
  arr.push(ms);
  while (arr.length > MCP_HEALTH_WINDOW) arr.shift();
  recentMs.set(defName, arr);
  return arr.reduce((a, x) => a + x, 0) / arr.length;
}

/** Record one executed MCP tool outcome. Never throws. */
export function recordMcpToolOutcome(defName: string, ok: boolean, ms: number, error?: string): void {
  try {
    if (!defName) return;
    const ledger = load();
    const prev = ledger[defName] ?? {
      calls: 0,
      oks: 0,
      fails: 0,
      failStreak: 0,
      meanMs: ms,
    };
    const meanMs = windowPush(defName, ms);
    ledger[defName] = {
      calls: prev.calls + 1,
      oks: prev.oks + (ok ? 1 : 0),
      fails: prev.fails + (ok ? 0 : 1),
      failStreak: ok ? 0 : prev.failStreak + 1,
      ...(ok ? { lastOkAt: Date.now() } : { lastFailAt: Date.now() }),
      ...(ok ? {} : { lastError: (error ?? "call failed").slice(0, 300) }),
      meanMs: Math.round(meanMs),
      lastMs: ms,
    };
    persist();
  } catch {
    // advisory only — a ledger write must never break a tool result
  }
}

export function getMcpToolHealth(defName: string): McpToolHealth | undefined {
  return load()[defName];
}

/** Snapshot for UI rendering (the card re-renders on settings changes, not ledger ticks — callers re-read on open/expand). */
export function allMcpToolHealth(): Record<string, McpToolHealth> {
  return { ...load() };
}

/** Wipe the whole ledger, or just one tool's row. */
export function resetMcpToolHealth(defName?: string): void {
  if (!defName) {
    cache = {};
    recentMs.clear();
  } else {
    load();
    delete cache![defName];
    recentMs.delete(defName);
  }
  persist();
}

/**
 * Model-facing steering: after MCP_HEALTH_FLAKY_STREAK consecutive failures a
 * short, honest note joins the tool description so the model knows the lane is
 * rough (prefer an alternative, simplify arguments, or surface the issue).
 */
export function mcpHealthHint(defName: string): string {
  const h = getMcpToolHealth(defName);
  if (!h || h.failStreak < MCP_HEALTH_FLAKY_STREAK) return "";
  const last = h.lastError ? ` Last error: ${h.lastError.slice(0, 120)}` : "";
  return ` Note: this tool failed its last ${h.failStreak} calls — consider an alternative or fix the arguments before retrying.${last}`;
}

/** Health summary for one tool row (card rendering + tooltips). */
export function summarizeToolHealth(
  serverSlug: string,
  tool: McpToolInfo
): { defName: string; health?: McpToolHealth; tone: "idle" | "ok" | "flaky" | "down" } {
  const defName = `mcp__${serverSlug}__${tool.name}`;
  const health = getMcpToolHealth(defName);
  if (!health || health.calls === 0) return { defName, tone: "idle" };
  if (health.failStreak >= MCP_HEALTH_FLAKY_STREAK) {
    return { defName, health, tone: health.failStreak >= 4 ? "down" : "flaky" };
  }
  return { defName, health, tone: "ok" };
}
