// r187/r188 QA — relay failure taxonomy: soft / hard / dead classification,
// cooldown windowing, provider-wide auth stamping, badge surfacing, and the
// r188 status WIRE (server-side verdict markers overriding 90-char display
// text, one shared parser for every consumer).
// Run: bun run scripts/qa-relay-taxonomy.ts

import {
  isSoftRelayFailure,
  isDeadlyRelayFailure,
  isHardRelayFailure,
  isAuthRelayFailure,
  relayHopBadge,
  relayHealthSnapshot,
  parseRelayStatusLine,
  recordRelayStatusLine,
  recordRelayHopResult,
  stripRelayMarkers,
  type RelayHealthEntry,
} from "../src/lib/relay";
import * as fs from "node:fs";

// Health memory lives in localStorage — stub it (in-memory) so the end-to-end
// stamping tests can run under bun, exactly as the browser would record.
const mem: Record<string, string> = {};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = v; },
  removeItem: (k: string) => { delete mem[k]; },
};

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (c) pass++; else fail++;
};
const relaySrc = fs.readFileSync("src/lib/relay.ts", "utf8");

console.log("K1 — SOFT: capacity noise never demotes, never dead");
for (const e of [
  "API request failed with status 429: too many requests",
  "Rate limit exceeded. Please wait before sending more requests.",
  "Too many requests. Please slow down and try again shortly.",
  "quota exceeded for this model",
  "status 408 request timeout",
]) {
  ok(isSoftRelayFailure(e), `soft: "${e.slice(0, 44)}"`);
  ok(!isDeadlyRelayFailure(e), `not dead: "${e.slice(0, 44)}"`);
  ok(!isHardRelayFailure(e), `not hard: "${e.slice(0, 44)}"`);
}

console.log("K2 — DEAD: the user's own paste (permanent rejections)");
const userPaste = [
  "This model requires lite tier or higher. Upgrade your account to access it.",
  "Access denied. This model is not available in your region.",
  "Authentication failed. Please check your API key and credentials.",
  "This model is currently in maintenance. Please try again later.",
];
for (const e of userPaste) {
  ok(isDeadlyRelayFailure(e), `dead: "${e.slice(0, 48)}"`);
  ok(isHardRelayFailure(e), `demotes: "${e.slice(0, 48)}"`);
  ok(!isSoftRelayFailure(e), `not soft: "${e.slice(0, 48)}"`);
}

console.log("K3 — HARD-but-not-dead: transient infra deaths stay short-cooldown");
for (const e of [
  "fetch failed",
  "socket connection terminated",
  "upstream stream error: The request timed out.",
  "API request failed with status 502",
  "",
]) {
  ok(isHardRelayFailure(e) || e === "status 408 request timeout", `hard: "${e || "(none)"}"`);
  ok(!isDeadlyRelayFailure(e), `not dead: "${e || "(none)"}"`);
}

console.log("K4 — r25 regression: the OLD regex classified 401/403 as soft; new one must not");
ok(/\b4(?:0\[13578\]|1\[02-9\])\b/.test(relaySrc) === false, "old 401-as-soft regex class is gone");
ok(isDeadlyRelayFailure("status 401 unauthorized") && isDeadlyRelayFailure("status 403 forbidden"), "401 + 403 are dead");

console.log("K5 — badge windowing: dead = blocked (6h), hard = sick (5m), soft = throttled");
const now = Date.now();
const mk = (p: Partial<RelayHealthEntry>): Record<string, RelayHealthEntry> => ({ "p::m": { ok: 0, fail: 1, ...p } as RelayHealthEntry });
ok(relayHopBadge("p", "m", mk({ lastFailAt: now - 10 * 60_000, soft: false, dead: true, lastError: "region" }))?.label === "blocked", "dead @10m → blocked (old window would have cleared it)");
ok(relayHopBadge("p", "m", mk({ lastFailAt: now - 10 * 60_000, soft: false }))?.label === "ok 0", "hard @10m → recovered (5m window)");
ok(relayHopBadge("p", "m", mk({ lastFailAt: now - 1_000, soft: true }))?.label === "throttled", "soft → throttled");
ok(relayHopBadge("p", "m", mk({ lastFailAt: now - 7 * 3600_000, dead: true }))?.label === "ok 0", "dead @7h → expired, back in chain");

console.log("K6 — source wiring: verdict-aware stamping + success clears dead");
ok(/e\.dead = verdict === "dead" \|\| verdict === "auth" \|\| \(!verdict && isDeadlyRelayFailure\(error\)\)/.test(relaySrc), "recordRelayHopResult trusts the wire verdict, falls back to text");
ok(/e\.dead = false; \/\/ r187/.test(relaySrc), "success clears the dead flag");
ok(/verdict === "auth" \|\| \(error && AUTH_RE\.test\(error\)\)/.test(relaySrc), "auth deaths stamp the whole provider family (marker OR text)");
ok(/entry\.dead \? DEAD_COOLDOWN_MS : HEALTH_COOLDOWN_MS/.test(relaySrc), "recentlyFailed + badge both honor the 6h dead window");

console.log("K7 — r188 status WIRE: server verdict markers override the 90-char fragment");
const shortError = (m: string) => (m.length > 90 ? `${m.slice(0, 90)}…` : m); // agent-engine's display cut

// K7a — tier paywall buried past the 90-char cut inside a JSON envelope.
// OLD behavior: the client classified from the truncated fragment → "hard"
// (5-min cooldown) → the corpse was re-dialed every turn. That is the
// user's Vyce paste loop, byte for byte.
const tierErr =
  '{"error":{"message":"upstream call failed after 2 retries with status 500 — the organization for this key does not have access to gpt-5.6-terra (requires lite tier)","type":"invalid_request_error"}}';
ok(!isDeadlyRelayFailure(shortError(tierErr)) && !isSoftRelayFailure(shortError(tierErr)), "K7a pre: truncated display text MISSES the tier keyword (the bug)");
ok(isDeadlyRelayFailure(tierErr), "K7a pre: the FULL error is deadly (server sees it)");
const tierWire = `Model relay: Vyce · gpt-5.6-terra failed (${shortError(tierErr)}) — rotating to Vyce · grok-4.6… [hop:vyce::gpt-5.6-terra] [hopdead]`;
const tierParsed = parseRelayStatusLine(tierWire);
ok(tierParsed?.key === "vyce::gpt-5.6-terra" && tierParsed.ok === false, "K7a: hop key parsed, marked as failure");
ok(tierParsed?.verdict === "dead", "K7a: [hopdead] verdict parsed");
ok(!/\[hop/.test(tierParsed?.error ?? "x"), "K7a: error text is marker-free");
recordRelayStatusLine(tierWire);
ok(relayHealthSnapshot()["vyce::gpt-5.6-terra"]?.dead === true, "K7a: END-TO-END — hop stamped dead from the wire");

// K7b — auth envelope past the cut: the [hopauth] marker stamps the WHOLE
// provider family even though the visible fragment has no auth keyword.
const authErr =
  '{"error":{"message":"The upstream gateway rejected this request after 3 attempts across fallback lanes: authentication failed for the supplied key","type":"auth_error","code":401}}';
ok(!isAuthRelayFailure(shortError(authErr)), "K7b pre: truncated fragment MISSES the auth keyword");
ok(isAuthRelayFailure(authErr) && isDeadlyRelayFailure(authErr), "K7b pre: full error is auth-class dead");
const authWire = `Model relay: DeepSeek · v4-pro failed (${shortError(authErr)}) — rotating to Agnes · 3.0-flash… [hop:deepseek::v4-pro] [hopauth]`;
recordRelayHopResult("deepseek::v4-flash", true); // sibling was healthy before
recordRelayStatusLine(authWire);
ok(relayHealthSnapshot()["deepseek::v4-pro"]?.dead === true, "K7b: END-TO-END — auth hop dead");
ok(relayHealthSnapshot()["deepseek::v4-flash"]?.dead === true, "K7b: END-TO-END — sibling stamped dead by family rule");
ok(relayHealthSnapshot()["deepseek::v4-flash"]?.lastError === "shared key rejected (auth)", "K7b: sibling carries the family note");

// K7c — soft marker: capacity noise never demotes, and the orcarouter
// workspace-wide stamp fires on the verdict alone (keyword past the cut).
const softErr =
  '{"error":{"message":"the lane answered with a body the router could not accept this hour because the shared bucket for this workspace is exhausted right now","code":"rate_limited"}}';
ok(!isSoftRelayFailure(shortError(softErr)), "K7c pre: truncated fragment MISSES the rate-limit keyword");
recordRelayHopResult("orcarouter::lane-2", true); // sibling known to the rotator (stamp flips EXISTING lanes only, by design)
const softWire = `Model relay: Orca · lane-1 failed (${shortError(softErr)}) — rotating to Orca · lane-2… [hop:orcarouter::lane-1] [hopsoft]`;
recordRelayStatusLine(softWire);
ok(relayHealthSnapshot()["orcarouter::lane-1"]?.soft === true && relayHealthSnapshot()["orcarouter::lane-1"]?.dead === false, "K7c: END-TO-END — soft, never demoted");
ok(relayHealthSnapshot()["orcarouter::lane-2"]?.soft === true, "K7c: workspace-wide soft stamp fires on the verdict");

// K7d — legacy lines (no verdict marker) still classify from display text.
const legacyWire = "Model relay: Vyce · grok-4.6 failed (This model is currently in maintenance) — rotating to Vyce · gpt-6-luna… [hop:vyce::grok-4.6]";
const legacyParsed = parseRelayStatusLine(legacyWire);
ok(legacyParsed?.verdict === undefined, "K7d: legacy line has no verdict");
recordRelayStatusLine(legacyWire);
ok(relayHealthSnapshot()["vyce::grok-4.6"]?.dead === true, "K7d: END-TO-END — text classification still stamps maintenance dead");

// K7e — success clears dead; parse edges hold.
recordRelayStatusLine("Model relay: Vyce · gpt-5.6-terra answered ✓ [hopok:vyce::gpt-5.6-terra]");
ok(relayHealthSnapshot()["vyce::gpt-5.6-terra"]?.dead === false, "K7e: hopok clears the dead flag (rejoin the chain)");
ok(parseRelayStatusLine("Model relay: x failed (boom)") === null, "K7e: marker-less failure → nothing to record");
ok(parseRelayStatusLine("Tool call finished ok") === null, "K7e: non-relay line ignored");
ok(parseRelayStatusLine("Model relay: a failed (x) [hop:bad key] [hopsoft]")?.verdict === "soft", "K7e: [hop: does not swallow [hopok: (distinct prefixes)");
ok(stripRelayMarkers("Model relay: a failed (x) [hop:p::m] [hopdead]") === "Model relay: a failed (x)", "K7e: stripper removes every marker form");

console.log("K8 — r188 source wiring: one parser, no parallel truth");
const engineSrc = fs.readFileSync("src/lib/agent-engine.ts", "utf8");
const runnerSrc = fs.readFileSync("src/lib/workflow-runner.ts", "utf8");
const chatSrc = fs.readFileSync("src/components/praison/chat/chat-view.tsx", "utf8");
ok(/" \[hopauth\]" : dead \? " \[hopdead\]" : soft \? " \[hopsoft\]"/.test(engineSrc), "agent-engine emits all three verdict markers");
ok(
  /isAuthRelayFailure,\s*isDeadlyRelayFailure,\s*isSoftRelayFailure\s*\} from "\.\/relay-core"/.test(engineSrc),
  "agent-engine classifies from the FULL error server-side (isomorphic relay-core module — r309)"
);
ok(!/from "\.\/relay";/.test(engineSrc), "agent-engine no longer imports the client-only relay module");
ok(/recordRelayStatusLine\(m\)/.test(runnerSrc) && /recordRelayStatusLine\(m\)/.test(chatSrc), "both consumers use the shared wire parser");
ok(!runnerSrc.includes("recordRelayHopResult") && !chatSrc.includes("recordRelayHopResult"), "no consumer re-implements the regexes (old dual parsers gone)");
ok(/stripRelayMarkers\(m\)/.test(runnerSrc) && /stripRelayMarkers\(m\)/.test(chatSrc), "notes + status lines stay marker-free");

console.log("K9 — r194 structured error-code mapping (r188 risk 2 closed)");
ok(
  isDeadlyRelayFailure('{"error":{"message":"Request failed","code":"model_not_found"}}'),
  "K9: code model_not_found with keyword-less message → DEAD (was hard: corpse re-dialed)"
);
ok(
  isDeadlyRelayFailure('{"error":{"type":"authentication_error"}}') && isAuthRelayFailure('{"error":{"type":"authentication_error"}}'),
  "K9: type authentication_error → DEAD+AUTH (family stamp fires)"
);
ok(
  isDeadlyRelayFailure('{"error":{"message":"Request failed","code":"account_deactivated"}}') &&
    isAuthRelayFailure('{"error":{"message":"Request failed","code":"account_deactivated"}}'),
  "K9: code account_deactivated → DEAD+AUTH"
);
ok(
  isDeadlyRelayFailure('{"code":"permission_denied"}') && !isAuthRelayFailure('{"code":"permission_denied"}'),
  "K9: code permission_denied → DEAD but not AUTH (hop-scoped, key is fine)"
);
ok(
  isDeadlyRelayFailure('{"code": "region_not_supported"}'),
  "K9: code region_not_supported (space after colon) → DEAD"
);
ok(
  isSoftRelayFailure('{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}') &&
    !isDeadlyRelayFailure('{"error":{"code":"insufficient_quota"}}'),
  "K9: quota-exhaustion codes stay SOFT (r187 doctrine: drained window resets, never demotes)"
);
ok(
  isSoftRelayFailure('{"code": "rate_limit_exceeded"}'),
  "K9: code rate_limit_exceeded → SOFT"
);
ok(
  !isDeadlyRelayFailure('{"type":"invalid_request_error","message":"Missing required parameter: model"}') &&
    !isSoftRelayFailure('{"type":"invalid_request_error","message":"Missing required parameter: model"}'),
  "K9: generic invalid_request_error stays HARD (bad params are re-dialable, never a corpse)"
);
ok(
  !isAuthRelayFailure('{"code":"invalid_request_error"}') && !isDeadlyRelayFailure('{"code":"invalid_request_error"}'),
  "K9: the generic type must NOT sink the key family (explicit-list discipline)"
);
ok(
  !isDeadlyRelayFailure('{"code":"method_not_allowed"}') && !isSoftRelayFailure('{"code":"method_not_allowed"}'),
  "K9: codes outside the vocabulary stay HARD (no over-reach)"
);
ok(isDeadlyRelayFailure("This model is currently in maintenance"), "K9: text-keyword classification unregressed");

console.log("K10 — r309 server-lane hardening: client-only vault calls are window-guarded");
ok(/let relayHops: RelayWireHop\[\] = \[\];/.test(runnerSrc), "runner builds no relay hops on the server lane (no client-reference call)");
ok(/typeof window !== "undefined"\) \{[^}]*?recordRelayStatusLine\(m\);/.test(runnerSrc), "runner guards the wire recorder + note stripper behind the window check");
const oneSrc = fs.readFileSync("src/lib/systemone.ts", "utf8");
ok(
  /let chain: RelayHop\[\] = \[\];/.test(oneSrc) && /typeof window !== "undefined"/.test(oneSrc),
  "systemone fastJudge skips the vault chain on the server lane"
);
ok(!fs.existsSync("src/lib/relay-taxonomy.ts"), "no duplicate taxonomy module — relay-core is the single truth");

console.log(`\nK-series (relay taxonomy): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
