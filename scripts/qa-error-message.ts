/**
 * r654 QA — safeErrorMessage (the "[object Object]" killer, K-series).
 * Run: bun scripts/qa-error-message.ts
 * Covers: Error/string/envelope extraction, name fallback, JSON with cycle
 * guard, caps, never-throw on hostile inputs (throwing getters, patched
 * stringify), and the source-level Tier-1 wiring (runner, engine, executor).
 */
import { readFileSync } from "node:fs";
import { SAFE_ERROR_CAP, safeErrorMessage } from "../src/lib/error-message";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. The defect class this helper exists to kill ──────────────────────────
const plainObject = { irrelevant: true, code: 500 };
check("plain object rejection is NOT '[object Object]'",
  safeErrorMessage(plainObject) !== "[object Object]" && safeErrorMessage(plainObject).includes("500"),
  safeErrorMessage(plainObject));
check("Error carries its message", safeErrorMessage(new Error("boom")) === "boom");
check("empty-message Error falls back to its name", safeErrorMessage(new Error("")) === "Error");
check("string passes through", safeErrorMessage("plain") === "plain");
check("null → unknown error", safeErrorMessage(null) === "unknown error");
check("undefined → unknown error", safeErrorMessage(undefined) === "unknown error");
check("number → string", safeErrorMessage(42) === "42");
check("boolean → string", safeErrorMessage(false) === "false");

// ── 2. Non-Error envelopes (provider gateways love these) ───────────────────
check("{message} envelope extracts", safeErrorMessage({ message: "quota exceeded" }) === "quota exceeded");
check("{error} envelope extracts", safeErrorMessage({ error: "rate limited" }) === "rate limited");
check("empty message falls through to JSON path",
  safeErrorMessage({ message: "" }) === JSON.stringify({ message: "" }));
check("non-string message refused → JSON path",
  safeErrorMessage({ message: 42 }) === JSON.stringify({ message: 42 }));

// ── 3. Cycle guard + stringify failures ─────────────────────────────────────
const a: Record<string, unknown> = { name: "loop" };
a.self = a;
check("circular object never throws, marks the loop",
  safeErrorMessage(a).includes("[circular]") && !safeErrorMessage(a).includes("[object Object]"));
const withMsg: Record<string, unknown> = { message: "m" };
withMsg.self = withMsg;
check("message wins before stringify even when circular", safeErrorMessage(withMsg) === "m");
const hostile = { get bad(): string { throw new Error("getter bomb"); } };
check("throwing getter never propagates", safeErrorMessage(hostile) === "[unserializable error]");
check("JSON.stringify patched to throw → honest fallback",
  (() => {
    const orig = JSON.stringify;
    JSON.stringify = (() => {
      throw new Error("nope");
    }) as typeof JSON.stringify;
    try {
      return safeErrorMessage({ a: 1 }) === "[unserializable error]";
    } finally {
      JSON.stringify = orig;
    }
  })());

// ── 4. Caps ──────────────────────────────────────────────────────────────────
check("long strings are capped with an ellipsis",
  safeErrorMessage("x".repeat(10_000)).length === SAFE_ERROR_CAP + 1 &&
    safeErrorMessage("x".repeat(10_000)).endsWith("…"));
check("long objects are capped too",
  safeErrorMessage({ blob: "y".repeat(10_000) }).length <= SAFE_ERROR_CAP + 1);

// ── 5. Source-level wiring (Tier-1 sites) ────────────────────────────────────
const runner = readFileSync("src/lib/workflow-runner.ts", "utf8");
check("failRun uses safeErrorMessage",
  runner.includes("const safeMessage = safeErrorMessage(err);"));
check("failRun's String(err ?? ...) defect is gone",
  !runner.includes('String(err ?? "unknown error")'));
check("outer catch wraps escapes with safeErrorMessage",
  runner.includes("new Error(safeErrorMessage(err))"));
check("runner imports the helper", runner.includes('from "@/lib/error-message"'));
const engine = readFileSync("src/lib/agent-engine.ts", "utf8");
check("agent-engine normalizers use safeErrorMessage",
  (engine.match(/safeErrorMessage\(err\)/g) ?? []).length >= 5,
  String((engine.match(/safeErrorMessage\(err\)/g) ?? []).length));
check("agent-engine has no residual String(err) in normalizers",
  !engine.includes(": String(err)"));
const executor = readFileSync("src/lib/server/automation-executor.ts", "utf8");
check("automation-executor error paths use safeErrorMessage",
  (executor.match(/safeErrorMessage\(err\)/g) ?? []).length >= 4);
check("automation-executor has no residual X?message:String(err) pattern",
  !executor.includes("instanceof Error ? err.message : String(err)"));

console.log(`\nqa-error-message: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
