// ─── Relay failure taxonomy + status wire — the ISOMORPHIC core (r309) ───────
// Extracted from lib/relay.ts, which is a "use client" module (the rotator's
// health memory lives in localStorage). Every function below is PURE — no DOM,
// no storage — so both the browser bundle and the server lane (API routes,
// workflow-runner server runs) can import and CALL them freely.
//
// Why this file exists (live evidence, r309): agent-engine classifies provider
// errors server-side with isDeadlyRelayFailure(), but importing it from a
// "use client" module turns the function into a client-reference proxy on the
// server — calling it threw "Attempted to call isDeadlyRelayFailure() from the
// server but isDeadlyRelayFailure is on the client", which REPLACED the real
// provider error and failed the run with "Unknown". The classifier must never
// be the thing that crashes the classification.

// ─── Failure taxonomy (r187, tightening r25's LiteLLM allowed_fails_policy) ──
//  - SOFT  (429 / 408 / rate-limit / quota): capacity noise — recorded, NEVER
//          demotes a hop. A healthy provider having a busy minute must keep
//          its place in the chain.
//  - HARD  (network, 5xx, everything unmatched): demotes for the short
//          cooldown — transient enough to re-try soon.
//  - DEAD  (isDeadlyRelayFailure — 401 auth, 403 region/permission,
//          tier paywall, maintenance): demotes for HOURS. These errors mean
//          the hop cannot answer no matter how many times we re-dial; the
//          r25 regex treated 401/403 as SOFT (matched by its 4xx class),
//          so dead hops were re-dialed every single turn.

export const SOFT_RE = /\b429\b|\b408\b|rate.?limit|quota|too many requests|slow down/i;
export const DEADLY_RE =
  /\b401\b|\b403\b|authentication|unauthorized|access denied|not available in your region|region.?block|upgrade your account|requires?.{0,24}(lite|pro|max|tier|plan)|maintenance|invalid.{0,16}key|check your (api )?key/i;
export const AUTH_RE = /\b401\b|authentication|unauthorized|invalid.{0,16}key|check your (api )?key/i;

/**
 * r194 (closes r188 risk 2): structured error CODES. Providers often bury
 * the verdict in the envelope's code/type field while the message text stays
 * uninformative — {"error":{"message":"Request failed","code":"model_not_found"}}
 * has no keyword the text regexes can see, so the corpse was misfiled "hard"
 * (5-min cooldown) and re-dialed every turn. Deliberately EXPLICIT lists:
 * generic envelope types like "invalid_request_error" (bad params, bad JSON)
 * must NOT stamp a hop dead. Every auth code is also a deadly code — the
 * engine gates auth on dead first (auth ⇒ whole key family sinks).
 * Quota exhaustion codes (insufficient_quota) stay SOFT per the r187 doctrine:
 * a drained window resets — the hop is healthy, the bucket is empty.
 */
const CODED_SOFT_RE =
  /"(?:code|type)"\s*:\s*"[^"]*(?:insufficient_quota|rate_limit|too_many_requests|overloaded|temporarily_unavailable|capacity|timeout)[^"]*"/i;
const CODED_DEADLY_RE =
  /"(?:code|type)"\s*:\s*"[^"]*(?:model_not_found|model_access_denied|permission_denied|access_denied|account_deactivated|account_suspended|authentication_error|invalid_api_key|incorrect_api_key|unsupported_region|region_not_supported|subscription_required|requires_[a-z_]*(?:tier|plan|upgrade))[^"]*"/i;
const CODED_AUTH_RE =
  /"(?:code|type)"\s*:\s*"[^"]*(?:invalid_api_key|incorrect_api_key|authentication_error|account_deactivated|account_suspended)[^"]*"/i;

/** Capacity noise — the hop is fine, the lane is busy. Never demotes. */
export function isSoftRelayFailure(error?: string): boolean {
  return !!error && (SOFT_RE.test(error) || CODED_SOFT_RE.test(error));
}

/** Auth-class death — the KEY is rejected, so every hop sharing it is equally
 * dead (r187 family stamping). Exported so the server can label the wire (r188). */
export function isAuthRelayFailure(error?: string): boolean {
  return !!error && (AUTH_RE.test(error) || CODED_AUTH_RE.test(error));
}

/** Permanent-for-this-hop rejection (auth / region / tier / maintenance).
 * These hops are dead until their cause changes — hours, not minutes. */
export function isDeadlyRelayFailure(error?: string): boolean {
  if (!error || isSoftRelayFailure(error)) return false;
  return DEADLY_RE.test(error) || CODED_DEADLY_RE.test(error);
}

export function isHardRelayFailure(error?: string): boolean {
  if (!error) return true;
  return !SOFT_RE.test(error);
}

/** One hop's persisted verdict shape (localStorage on the client; the server
 * only ever sees this type — the memory itself is client doctrine). */
export interface RelayHealthEntry {
  ok: number;
  fail: number;
  lastOkAt?: number;
  lastFailAt?: number;
  lastError?: string;
  /** Soft failures (429s, capacity) are recorded but NEVER demote a hop. */
  soft?: boolean;
  /** r187: dead = permanent-for-this-hop rejection (401 auth, 403 region /
   * permission, account-tier paywall, maintenance). Demoted for hours, not
   * minutes — re-dialing these burns a ladder rung on a corpse every turn
   * (live evidence: the same tier/region/auth errors recurred across the
   * user's turns at 02:15, 02:17 and 02:18). Absent on old entries → read
   * as plain hard (short cooldown), so persisted localStorage stays valid. */
  dead?: boolean;
}

// ─── r188: the relay status wire — one parser for every consumer ─────────────
// The server (agent-engine) classifies each rotation failure from the FULL
// upstream error and labels the line with a verdict marker; clients used to
// re-classify from the display text, which is a 90-char `shortError` fragment
// and can hide the tier/region/auth keyword inside a JSON error envelope.
// Markers: [hop:x] failed · [hopok:x] answered · [hopdead]/[hopauth]/[hopsoft].

/** Strip every relay marker from a status line — display / error-text form. */
export function stripRelayMarkers(m: string): string {
  return m.replace(/\s*\[hop[a-z]*(?::[^\]]+)?\]/g, "").trim();
}

export interface ParsedRelayStatus {
  ok: boolean;
  key: string;
  /** Display text minus all markers — the best error text available client-side. */
  error: string;
  /** Server's verdict from the full upstream error; undefined on legacy lines
   * without a marker → consumers fall back to display-text classification. */
  verdict?: "dead" | "auth" | "soft";
}

/** Parse one relay status line into a hop outcome. Returns null for non-relay
 * lines and for marker-less failures (nothing to record). */
export function parseRelayStatusLine(m: string): ParsedRelayStatus | null {
  if (!/Model relay:/i.test(m)) return null;
  const okHop = /\[hopok:([^\]]+)\]/.exec(m);
  if (okHop) return { ok: true, key: okHop[1], error: stripRelayMarkers(m) };
  const failHop = /\[hop:([^\]]+)\]/.exec(m);
  if (!failHop) return null;
  return {
    ok: false,
    key: failHop[1],
    error: stripRelayMarkers(m),
    verdict: /\[hopauth\]/.test(m)
      ? "auth"
      : /\[hopdead\]/.test(m)
        ? "dead"
        : /\[hopsoft\]/.test(m)
          ? "soft"
          : undefined,
  };
}
