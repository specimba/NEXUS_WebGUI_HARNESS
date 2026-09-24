"use client";

// ─── r49 Relay event recorder — the failover log's client funnel ─────────────
// Every "Model relay: …" status line the engine emits (both browser-direct and
// server-relayed runs stream through here) is parsed ONCE into:
//   1. a health-memory update (relay.ts — cooldowns, demotions, promotions)
//   2. a queryable RelayEvent row POSTed to /api/router/events (fire-and-forget
//      batching; failure to log must NEVER break a run)
// No secrets travel: hop keys, clipped error prose, and the correlation id —
// never API keys (they never appear in status lines by construction).

import {
  isCapacityError,
  isHardRelayFailure,
  recordRelayHopResult,
} from "./relay";

export type RelayEventTransport = "browser" | "server" | "probe";

export interface RelayEventPayload {
  requestId: string;
  hopKey: string;
  providerId: string;
  modelId: string;
  ok: boolean;
  kind?: string;
  attempt?: "primary" | "relay" | "probe";
  action?: string;
  latencyMs?: number;
  error?: string;
  transport?: RelayEventTransport;
}

// ─── Local error-kind classification (mirrors agent-engine's taxonomy with a
// tiny regex set — importing the engine here would drag it into the bundle) ──
export function classifyRelayKind(error?: string): string {
  if (!error) return "unknown";
  const m = error;
  if (/\b429\b|rate.?limit|quota|too many requests|capacity is limited/i.test(m)) return "rate-limit";
  if (/\b402\b|out of credits|insufficient (?:credits?|funds|balance)/i.test(m)) return "credits";
  if (/\b401\b|\b403\b|unauthorized|invalid.{0,12}(api )?key|forbidden|permission denied/i.test(m)) return "auth";
  if (/\b404\b|no such model|model.?not.?found|model_not_found|does not exist or is not supported/i.test(m)) return "model";
  if (/region\/?IP block|datacenter|server-region|\b451\b|blocked this network/i.test(m)) return "region";
  if (/upstream deadline|no first token|no data for|timed? ?out|stalled/i.test(m)) return "timeout";
  return "network";
}

// ─── Batched fire-and-forget POST queue ───────────────────────────────────────
const QUEUE_KEY_LIMIT = 40;
const FLUSH_DELAY_MS = 4_000;

let queue: RelayEventPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined = undefined;
const seen = new Set<string>(); // per-session dedupe of identical status lines

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushRelayEvents();
  }, FLUSH_DELAY_MS);
}

export async function flushRelayEvents(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, QUEUE_KEY_LIMIT);
  try {
    await fetch("/api/router/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
  } catch {
    /* logging is best-effort — never surface, never retry-spam */
  }
}

export function queueRelayEvent(evt: RelayEventPayload): void {
  queue.push(evt);
  if (queue.length >= QUEUE_KEY_LIMIT) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    void flushRelayEvents();
  } else {
    scheduleFlush();
  }
}

// ─── Status-line parsing ──────────────────────────────────────────────────────

const HOP_FAIL_RE = /\[hop:([^\]]+)\]/;
const HOP_OK_RE = /\[hopok:([^\]]+)\]/;
const REQ_RE = /\[req:([^\]]+)\]/;
const EXHAUSTED_RE = /\[exhausted\]/;
const MIDSTREAM_RE = /died mid-stream/i;
const ROTATING_RE = /rotating to/i;
const PROBE_RE = /\[probe:([^\]]+)\]/; // probe results carry [probe:key]

function splitHopKey(key: string): { providerId: string; modelId: string } {
  const idx = key.indexOf("::");
  if (idx === -1) return { providerId: key, modelId: key };
  return { providerId: key.slice(0, idx), modelId: key.slice(idx + 2) };
}

/** Strip every machine marker so the user sees clean prose. */
export function stripRelayMarkers(message: string): string {
  return message
    .replace(/\s*\[(?:hop|hopok|req|probe):[^\]]+\]/g, "")
    .replace(/\s*\[exhausted\]/g, "")
    .trim();
}

function actionFor(ok: boolean, raw: string, error: string | undefined): string {
  if (ok) return "served";
  if (EXHAUSTED_RE.test(raw)) return "exhausted";
  if (MIDSTREAM_RE.test(raw)) return "recorded";
  if (!error) return "failed";
  if (isCapacityError(error)) return "cooled";
  if (isHardRelayFailure(error)) return "demoted";
  return "failed";
}

/**
 * One funnel for every relay status line (chat view, workflow runner, probe
 * loop). Updates health memory, queues a queryable event, and returns the
 * marker-free prose for display. Safe to call on ANY status line — non-relay
 * lines return null without touching anything.
 */
export function recordFromStatusLine(
  raw: string,
  transport: RelayEventTransport = "browser"
): string | null {
  if (!/Model relay:/i.test(raw) && !PROBE_RE.test(raw)) return null;

  const okMatch = HOP_OK_RE.exec(raw);
  const failMatch = okMatch ? null : HOP_FAIL_RE.exec(raw);
  const probeMatch = PROBE_RE.exec(raw);
  const key = okMatch?.[1] ?? failMatch?.[1] ?? probeMatch?.[1] ?? "";
  const reqMatch = REQ_RE.exec(raw);
  const requestId = reqMatch?.[1] ?? "";
  const error = okMatch ? undefined : stripRelayMarkers(raw).replace(/^Model relay:\s*/i, "");
  const ok = !!okMatch;

  if (!key) return stripRelayMarkers(raw);

  // Health memory (capacity cooldowns / demotions / recovery live in relay.ts).
  if (probeMatch) {
    // Probe outcomes are recorded by relay-prober via recordProbeResult — this
    // funnel only logs the event row when a probe line flows through a status
    // channel (defensive; the prober calls queueRelayEvent itself).
    return stripRelayMarkers(raw);
  }
  recordRelayHopResult(key, ok, error);

  // Queryable event row (deduped per session, no secrets, fire-and-forget).
  const action = actionFor(ok, raw, error);
  const dedupeKey = `${requestId}|${key}|${ok ? 1 : 0}|${action}`;
  if (!seen.has(dedupeKey)) {
    seen.add(dedupeKey);
    if (seen.size > 600) {
      // cap memory — clear half (simple, allocation-free amortization)
      let i = 0;
      for (const k of seen) {
        if (i++ >= 300) break;
        seen.delete(k);
      }
    }
    const { providerId, modelId } = splitHopKey(key);
    queueRelayEvent({
      requestId,
      hopKey: key,
      providerId,
      modelId,
      ok,
      kind: ok ? undefined : classifyRelayKind(error),
      attempt: /\(primary|primary \(/.test(raw) ? "primary" : "relay",
      action,
      error: error ? error.slice(0, 300) : undefined,
      transport,
    });
  }

  return stripRelayMarkers(raw);
}
