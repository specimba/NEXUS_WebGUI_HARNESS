#!/usr/bin/env node
/**
 * r348 probe — wire the SECOND consumer: chat (agent-engine.upstreamErrorMessage
 * now speaks the canonical observation-truth copy from billing-classify).
 * Pins: (1) region-block honesty path (r23) still runs FIRST; (2) 404 model
 * prose preserved (the workflow self-heal keys on it); (3) the accusatory
 * per-status copy is gone; (4) r25's classifyUpstreamError machinery intact;
 * (5) BEHAVIORAL: the real classifyProviderError (type-stripped + imported)
 * answers every class correctly, and — the integration invariant — its
 * CANNED prose never re-classifies as rate-limit through the workflow/
 * agent-engine fallback regexes (quota only ever appears inside the
 * provider's quoted words, which the old prose leaked identically).
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

const read = (p) => readFileSync(p, "utf8");
let pass = 0, fail = 0;
const ok = (cond, name) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (cond) { pass++; } else { fail++; }
};

const eng = read("src/lib/agent-engine.ts");
const mod = read("src/lib/billing-classify.ts");

// ── textual: wiring + ordering ──
ok(/import \{ classifyProviderError \} from "\.\/billing-classify";/.test(eng),
  "agent-engine imports the shared classifier (relative, local style)");
const fnStart = eng.indexOf("export function upstreamErrorMessage");
const fnEnd = eng.indexOf("\n}", eng.indexOf("return classifyProviderError(status, text).message;"));
const fn = fnStart > -1 && fnEnd > fnStart ? eng.slice(fnStart, fnEnd) : "";
ok(fn.includes("looksLikeRegionBlock(status, text)") &&
   fn.indexOf("looksLikeRegionBlock") < fn.indexOf("classifyProviderError"),
  "region-block branch (r23) still runs BEFORE classification");
ok(/if \(msg && status === 404\) return `Model or endpoint not found: \$\{msg\}`;/.test(fn),
  "404 model prose preserved (self-heal keys on it)");
ok(!eng.includes("Invalid API key: ") && !eng.includes("Access forbidden (check key/region)") &&
   !eng.includes("Rate limit exceeded: ") && !eng.includes("Out of credits (HTTP 402): "),
  "accusatory per-status copy fully removed from the engine");
ok(!eng.includes("`Upstream HTTP ${status}: `"), "5xx prefix removed (classifier message carries the status)");
ok(/return classifyProviderError\(status, text\)\.message;/.test(fn),
  "every other failure speaks the canonical classified message");
// ── textual: r25 machinery untouched ──
ok(/export function classifyUpstreamError\(err: unknown\): UpstreamErrorKind/.test(eng) &&
   /"network"\s*\|\s*"auth"\s*\|\s*"rate-limit"/.test(eng),
  "r25 structured kinds + classifier intact (workflow self-heal contract)");
ok(/export function isTransientNetworkError/.test(eng) && /http 5\\d\\d/i.test(eng),
  "isTransientNetworkError untouched (retry contract)");

// ── textual: the quota reword landed ──
ok(/credit balance is exhausted/.test(mod) && !/balance\/quota/.test(mod),
  "out-of-credits canned prose no longer contains the word quota");

// ── behavioral: strip types, import the REAL classifier ──
let js = mod
  .replace(/^export type [\s\S]*?;\n/m, "")      // ProviderErrorKind union
  .replace(/^export interface [\s\S]*?\n\}\n/m, "") // ClassifiedProviderError
  .replace(/as \{[\s\S]*?\};/, ";")               // the JSON.parse `as {...}` cast
  .replace(/: ClassifiedProviderError/g, "")
  .replace(/: string \| undefined/g, "")
  .replace(/: string/g, "")
  .replace(/: number/g, "");
const tmp = "scripts/.tmp-billing-classify.mjs";
let classify = null;
try {
  writeFileSync(tmp, js);
  classify = (await import(pathToFileURL(tmp).href)).classifyProviderError;
} catch (e) {
  console.log("strip/import error:", e?.message ?? e);
} finally {
  try { unlinkSync(tmp); } catch {}
}
ok(typeof classify === "function", "real classifyProviderError imported (type-strip clean)");

if (classify) {
  const RATE_PROSE = /\b429\b|rate.?limit|quota|too many requests/i;      // agent-engine 358 + runner 394
  const AUTH_PROSE = /\b(401|403)\b|unauthorized|invalid.{0,12}(api )?key|forbidden/i;
  const NET_PROSE = /network|failed to fetch|upstream|http 5\d\d|bad gateway|service unavailable/i;
  const TRANSIENT = /network error|fetch failed|ENOTFOUND|ETIMEDOUT|timeout|\bupstream\b|deadline|bad gateway|service unavailable|http 5\d\d|load failed/i;
  /** the canned verdict = message minus the provider's quoted words */
  const canned = (m) => m.split(" — the provider said: ")[0];

  ok(classify(401, "").kind === "auth" && /real key problem/.test(classify(401, "").message),
    "BEHAV 401 → auth, honestly named a key problem");
  ok(classify(403, "").kind === "auth", "BEHAV 403 → auth");
  ok(AUTH_PROSE.test(canned(classify(401, "").message)),
    "BEHAV auth prose re-classifies as auth through the fallback regexes");
  ok(classify(402, "").kind === "out-of-credits" && /00:00 UTC/.test(classify(402, "").message),
    "BEHAV 402 → out-of-credits with the reset note");
  ok(classify(200, "Insufficient credits").kind === "out-of-credits",
    "BEHAV billing wording in a 200 shell → out-of-credits (body outranks status)");
  ok(classify(500, '{"error":{"message":"insufficient quota"}}').kind === "out-of-credits",
    "BEHAV billing refusal buried in a 500 shell → out-of-credits");
  ok(classify(429, "").kind === "rate-limit" && RATE_PROSE.test(classify(429, "").message),
    "BEHAV 429 → rate-limit, prose matches the fallback regexes");
  ok(classify(503, "").kind === "maintenance" && NET_PROSE.test(canned(classify(503, "").message)),
    "BEHAV 503 → maintenance, prose still network-class through fallbacks (old parity)");
  ok(classify(200, "service unavailable").kind === "maintenance",
    "BEHAV maintenance wording in a lying 200 → maintenance");
  ok(classify(500, "").kind === "provider-side" && /not your key/.test(classify(500, "").message),
    "BEHAV 5xx → provider-side, explicitly not the user's key");
  ok(TRANSIENT.test(canned(classify(500, "").message)),
    "BEHAV 5xx prose stays transient-retryable (isTransientNetworkError parity)");
  ok(classify(418, "weird refusal").kind === "unknown",
    "BEHAV unclassified status → unknown, non-accusatory");
  ok(/the provider said: "disk full on shard 7"/.test(
    classify(500, '{"error":{"message":"disk full on shard 7"}}').message),
    "BEHAV the provider's own sentence is quoted (observation truth)");
  // THE integration invariant: no canned prose leaks rate/quota/429 wording.
  const leaks = ["out-of-credits", "auth", "maintenance", "provider-side", "unknown"]
    .filter((k) => [ [402, ""], [401, ""], [503, ""], [500, ""], [418, "no details"] ]
      .some(([s, b]) => classify(s, b).kind === k && RATE_PROSE.test(canned(classify(s, b).message))));
  ok(leaks.length === 0,
    "INVARIANT no canned message re-classifies as rate-limit (quota/429 only in quotes)");
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
