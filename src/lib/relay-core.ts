// ─── Relay failure taxonomy — ISOMORPHIC core (r309) ─────────────────────────
// r309 ROOT-CAUSE FIX: these pure classifiers used to live in lib/relay.ts, a
// "use client" module. agent-engine.ts (deliberately ISOMORPHIC — it runs both
// server-side inside /api/chat and browser-direct via chat-client) imported
// them, so on the server each export of relay.ts is a client-reference proxy
// and the first classification threw:
//   "Attempted to call isDeadlyRelayFailure() from the server but
//    isDeadlyRelayFailure is on the client."
// …which the runner recorded as the step error — the relay ladder died at its
// FIRST hop failure instead of rotating (live evidence: the Continuous
// Research run dying at step 1 with exactly that message, 3 LLM calls failed).
// Pure text logic belongs in a directive-free module that BOTH graphs execute
// natively. Doctrine unchanged (r187 hard/soft/dead, r188 verdicts, r194
// coded envelopes) — see lib/relay.ts for the health-memory half.

/** Capacity noise — 429 / 408 / rate-limit / quota keywords in the text. */
const SOFT_RE = /\b429\b|\b408\b|rate.?limit|quota|too many requests|slow down/i;
const DEADLY_RE =
  /\b401\b|\b403\b|authentication|unauthorized|access denied|not available in your region|region.?block|upgrade your account|requires?.{0,24}(lite|pro|max|tier|plan)|maintenance|invalid.{0,16}key|check your (api )?key/i;
const AUTH_RE = /\b401\b|authentication|unauthorized|invalid.{0,16}key|check your (api )?key/i;

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

/** Auth-class text regex — shared with relay.ts's family-stamping path (the
 * one regex relay.ts still needs beyond the functions). */
export { AUTH_RE };

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

/** Everything the SOFT taxonomy does not excuse is hard (network / 5xx /
 * unmatched): demote for the short cooldown, re-dial soon. */
export function isHardRelayFailure(error?: string): boolean {
  if (!error) return true;
  return !SOFT_RE.test(error);
}
