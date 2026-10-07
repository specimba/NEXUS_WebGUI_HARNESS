// r332 probe: the user's exact Vyce balance-exhaustion paste + protective negatives.
// Mirrors classifyRunError (runner) and classifyUpstreamError (agent-engine) ordering.
const BILLING = /\b402\b|out of credits|insufficient (?:credits?|balance|funds)|(?:credits?|balance|funds) (?:is|are) insufficient|please recharge|credit.?gate|add credits|payment required/i;
const REGION = /blocked this network|region\/?IP block|datacenter|server-region|\b451\b/i;
const AUTH = /\b(401|403)\b|unauthorized|invalid.{0,12}(api )?key|invalid.?key|forbidden|permission denied/i;
const RATE = /\b429\b|rate.?limit|quota|too many requests/i;
// runner order: rate-limit → billing → region → auth
function runner(msg) {
  if (RATE.test(msg)) return "rate-limit";
  if (BILLING.test(msg)) return "billing";
  if (REGION.test(msg)) return "region";
  if (AUTH.test(msg)) return "auth";
  return "other";
}
// agent-engine order (from source): region → billing → rate-limit → auth
function engine(msg) {
  if (REGION.test(msg)) return "region";
  if (BILLING.test(msg)) return "billing";
  if (RATE.test(msg)) return "rate-limit";
  if (AUTH.test(msg)) return "auth";
  return "other";
}
const cases = [
  // [string, expectedRunnerKind]
  ["Access forbidden (check key/region): Your account balance is insufficient. Please recharge your account to continue using the API. (tid: 2026100716101581673504700234608)", "billing"],
  ["Your account balance is insufficient. Please recharge your account to continue using the API.", "billing"],
  ["Request failed (402): Payment required", "billing"],
  ["Access forbidden (check key/region): upstream refused the call", "auth"],
  ["HTTP 401 Unauthorized — invalid api key", "auth"],
  ["Rate limit exceeded, too many requests (429)", "rate-limit"],
  ["Request failed (502)", "other"],
  ["the model mistral-500 does not exist", "other"],
];
let fail = 0;
for (const [msg, want] of cases) {
  const got = runner(msg);
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} runner → ${got} (want ${want}) :: ${msg.slice(0, 72)}`);
}
// cross-surface: the exact paste must also be billing in the chat classifier
const paste = cases[0][0];
const engGot = engine(paste);
const engOk = engGot === "billing";
if (!engOk) fail++;
console.log(`${engOk ? "PASS" : "FAIL"} engine → ${engGot} (want billing) :: exact paste`);
// billing beats auth in the runner even though the message carries "forbidden"
const beatsAuth = runner("Access forbidden (check key/region): please recharge your account") === "billing";
if (!beatsAuth) fail++;
console.log(`${beatsAuth ? "PASS" : "FAIL"} billing beats auth on the combined paste shape`);
process.exit(fail ? 1 : 0);
