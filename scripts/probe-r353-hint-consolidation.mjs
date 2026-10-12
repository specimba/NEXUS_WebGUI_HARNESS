// r353 probe: the out-of-credits advice copy must live in ONE place.
// billing-classify exports OUT_OF_CREDITS_ADVICE; the runner's recovery-card
// hint imports it; the canned messages embed it. Behavioral checks run the
// REAL module (type-strip import); static pins cover the runner wiring.
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) pass++;
  else fails.push(label);
}

const { OUT_OF_CREDITS_ADVICE, classifyProviderError } = await import(
  `${ROOT}src/lib/billing-classify.ts`
);

// ── Behavioral: single source + honest canned messages ─────────────────────
ok(
  OUT_OF_CREDITS_ADVICE === "Daily free credits reset at 00:00 UTC",
  "advice constant has the canonical copy"
);
const m402 = classifyProviderError(402, "Payment Required");
ok(
  m402.kind === "out-of-credits" && m402.message.endsWith(`${OUT_OF_CREDITS_ADVICE}.`),
  "402 canned message embeds the shared advice"
);
const mBody = classifyProviderError(200, "error: insufficient credits for this key");
ok(
  mBody.kind === "out-of-credits" && mBody.message.endsWith(`${OUT_OF_CREDITS_ADVICE}.`),
  "billing-wording-in-200 message embeds the shared advice"
);
ok(
  !/quota/i.test(OUT_OF_CREDITS_ADVICE) && !/too many requests/i.test(OUT_OF_CREDITS_ADVICE),
  "advice stays classification-safe (no quota/rate vocabulary)"
);
ok(
  !/quota|too many requests/i.test(m402.message) &&
    !/quota|too many requests/i.test(mBody.message),
  "canned messages keep the r348 invariant (can never read as rate-limit)"
);

// ── Static: runner wiring ───────────────────────────────────────────────────
const runner = readFileSync(`${ROOT}src/lib/workflow-runner.ts`, "utf8");
ok(
  runner.includes('import { OUT_OF_CREDITS_ADVICE } from "@/lib/billing-classify";'),
  "runner imports the advice from the classifier module"
);
ok(
  runner.includes("${OUT_OF_CREDITS_ADVICE}. Top up, or switch provider"),
  "recovery-card hint is templated on the shared constant"
);
ok(
  !runner.includes("Wait for the daily reset (00:00 UTC)"),
  "old divergent hint copy is gone"
);

console.log(`probe-r353-hint-consolidation: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log("FAILED:\n - " + fails.join("\n - "));
  process.exit(1);
}
