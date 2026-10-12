#!/usr/bin/env node
/**
 * r349 probe — consumer #3: an honest out-of-credits RUN_ERROR kind.
 * Pins: (1) RunErrorKind + UpstreamErrorKind unions carry "out-of-credits";
 * (2) the runner's billing pattern sits BEFORE rate-limit (the /quota/ trap);
 * (3) ERROR_KIND_META has honest copy (label, 00:00 UTC reset — r353: via
 * the shared OUT_OF_CREDITS_ADVICE constant imported from billing-classify —
 * switch provider, no "quota", no accusatory tone); (4) billing NEVER self-heals
 * (SELF_HEAL_KINDS untouched) and never park-and-resumes (rateLimited check
 * untouched); (5) the SSE structured-kind ingestion is untouched;
 * (6) BEHAVIORAL: the REAL canned messages (type-stripped module import)
 * classify through the runner's AND the engine's extracted billing regexes —
 * billing pattern catches every out-of-credits message, rate pattern does
 * not match any canned part, engine branch precedes rate and agrees.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

const read = (p) => readFileSync(p, "utf8");
let pass = 0, fail = 0;
const ok = (cond, name) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (cond) { pass++; } else { fail++; }
};

const types = read("src/lib/types.ts");
const eng = read("src/lib/agent-engine.ts");
const runner = read("src/lib/workflow-runner.ts");

// ── unions ──
ok(/export type RunErrorKind = "network" \| "auth" \| "rate-limit" \| "timeout" \| "model" \| "region" \| "out-of-credits" \| "unknown";/.test(types),
  "RunErrorKind union carries out-of-credits");
ok(/\| "out-of-credits"\s*\n\s*\| "unknown";/.test(eng),
  "UpstreamErrorKind union carries out-of-credits");

// ── ordering (the trap) ──
const iRunBill = runner.indexOf('kind: "out-of-credits",\n    re:');
const iRunRate = runner.indexOf('{ kind: "rate-limit", re:');
ok(iRunBill > -1 && iRunBill < iRunRate,
  "runner billing pattern sits BEFORE the rate-limit pattern");
const iEngBill = eng.indexOf('return "out-of-credits";');
const iEngRate = eng.indexOf('return "rate-limit";');
ok(iEngBill > -1 && iEngBill < iEngRate,
  "engine classifyUpstreamError billing branch precedes rate-limit");

// ── meta honesty ──
const bcls = read("src/lib/billing-classify.ts");
const metaBlock = runner.slice(runner.indexOf('"out-of-credits": {'), runner.indexOf('"out-of-credits": {') + 300);
ok(/label: "Out of credits"/.test(metaBlock), "META label is 'Out of credits'");
// r353: the reset note moved behind the shared OUT_OF_CREDITS_ADVICE constant
// (single source of truth — hint can no longer drift from the classifier's
// canned messages), so the probe pins the WIRING: the hint references the
// constant, the escape hatch stays local, and the constant itself names the
// reset time. Assert the contract, not prose fragments.
ok(
  /OUT_OF_CREDITS_ADVICE/.test(metaBlock) &&
    /switch provider/.test(metaBlock) &&
    /OUT_OF_CREDITS_ADVICE = "Daily free credits reset at 00:00 UTC"/.test(bcls),
  "META hint names the reset time and the escape hatch"
);
ok(!/quota/.test(metaBlock) && !/Invalid/.test(metaBlock) && !/wrong/.test(metaBlock),
  "META hint stays classification-safe and non-accusatory");

// ── no self-heal / no park for billing ──
ok(/const SELF_HEAL_KINDS: RunErrorKind\[\] = \["network", "timeout", "rate-limit"\];/.test(runner),
  "SELF_HEAL_KINDS unchanged — billing never self-heals");
ok(!/SELF_HEAL_KINDS[^;]*out-of-credits/.test(runner),
  "billing absent from the self-heal list");
ok(/const rateLimited = errorInfo\?\.kind === "rate-limit";/.test(runner),
  "park-and-resume gate unchanged (billing kind skips the park ladder naturally)");
ok(/\(\(err as \{ kind\?: RunErrorKind \}\)\.kind \?\? classifyRunError\(message\)\.kind\)/.test(runner),
  "SSE structured-kind ingestion unchanged (server lane now carries billing natively)");
const panel = read("src/components/praison/workflows/workflow-run-panel.tsx");
ok(/"out-of-credits": "border-amber-500\/40/.test(panel),
  "recovery-card badge map covers out-of-credits (amber = waitable, not broken)");

// ── extract the SHIPPED regexes ──
function extractRe(src, anchorRe) {
  const m = src.match(anchorRe);
  if (!m) return null;
  try { return new RegExp(m[1], "i"); } catch { return null; }
}
const RUN_BILL = extractRe(runner, /kind: "out-of-credits",\s*re: \/([\s\S]+?)\/i,/);
const RUN_RATE = extractRe(runner, /kind: "rate-limit", re: \/([^\n]+?)\/i/);
const ENG_BILL = extractRe(eng, /if \(\/(out of credits[\s\S]+?)\/i\.test\(msg\)\)/);
ok(RUN_BILL instanceof RegExp && RUN_RATE instanceof RegExp && ENG_BILL instanceof RegExp,
  "all three shipped billing/rate regexes compile (no escape mangling)");

// ── behavioral: REAL canned messages from the REAL module ──
let js = read("src/lib/billing-classify.ts")
  .replace(/^export type [\s\S]*?;\n/m, "")
  .replace(/^export interface [\s\S]*?\n\}\n/m, "")
  .replace(/as \{[\s\S]*?\};/, ";")
  .replace(/: ClassifiedProviderError/g, "")
  .replace(/: string \| undefined/g, "")
  .replace(/: string/g, "")
  .replace(/: number/g, "");
const tmp = "scripts/.tmp-billing-classify-r349.mjs";
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

if (classify && RUN_BILL && RUN_RATE && ENG_BILL) {
  const canned = (m) => m.split(" — the provider said: ")[0];
  const billRes = [[402, ""], [200, "Insufficient credits"],
    [500, '{"error":{"message":"insufficient quota"}}']].map(([s, b]) => classify(s, b));
  const billMsgs = billRes.map((r) => r.message);
  ok(billRes.length === 3 && billRes.every((r) => r.kind === "out-of-credits"),
    "three real out-of-credits classifications (status + body + buried-500)");
  ok(billMsgs.every((m) => RUN_BILL.test(m)),
    "RUNNER billing pattern catches every real out-of-credits message");
  ok(billMsgs.every((m) => ENG_BILL.test(m)),
    "ENGINE billing branch catches every real out-of-credits message");
  ok(billMsgs.every((m) => !RUN_RATE.test(canned(m))),
    "RATE pattern never matches the canned part (quota only inside quotes)");
  // raw provider vocabulary (browser-direct, no canned wrapper)
  ok(["402 Payment Required", "you have a negative balance", "Insufficient funds"]
    .every((s) => RUN_BILL.test(s) && ENG_BILL.test(s)),
    "raw provider billing vocabulary classifies as out-of-credits");
  // non-billing classes stay put
  const rateMsg = canned(classify(429, "").message);
  const maintMsg = canned(classify(503, "").message);
  ok(RUN_RATE.test(rateMsg) && !RUN_BILL.test(rateMsg),
    "congestion prose still classifies rate-limit (not stolen by billing)");
  ok(!RUN_BILL.test(maintMsg) && !ENG_BILL.test(maintMsg),
    "maintenance prose stays maintenance (not stolen by billing)");
  ok(!RUN_RATE.test(maintMsg),
    "maintenance prose does not fall into rate-limit either (503 literal absent, wording clean)");
}

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
