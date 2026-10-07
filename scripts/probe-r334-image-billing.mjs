// r334 probe: the images route's status/body classification — the r332
// disease's last un-migrated copy. The user's exact Vyce drained-wallet paste,
// wrapped in the shape the route actually produces (raw body + inner-parsed
// msg), must classify billing; bare 401/403 must stay auth; 429/5xx stay own.
const BILLING_BODY_RE =
  /\b402\b|out of credits|insufficient (?:credits?|balance|funds)|(?:credits?|balance|funds) (?:is|are) insufficient|please recharge|credit.?gate|add credits|payment required/i;

// Mirror of route.ts post-r336 classification (the else-if chain).
function classify(status, text, msg) {
  if (status === 402 || BILLING_BODY_RE.test(text) || BILLING_BODY_RE.test(msg)) return "billing";
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status === 503) return "maintenance"; // r334 live witness: Vyce 503 maintenance HTML
  if (status >= 500) return "provider-error"; // r336: their side, honest class
  return "other";
}

// Mirror of the route's msg construction: raw slice, then inner-JSON override.
function routeMsg(status, body) {
  let msg = `HTTP ${status}: ${String(body).slice(0, 200) || "image generation failed"}`;
  try {
    const parsed = JSON.parse(body);
    const inner = parsed?.error?.message ?? parsed?.message;
    if (inner) msg = `HTTP ${status}: ${inner}`;
  } catch {
    /* keep raw text */
  }
  return msg;
}

function runCase([status, body, want]) {
  const msg = routeMsg(status, body);
  const got = classify(status, body, msg);
  const ok = got === want;
  return { ok, got, want, msg };
}

const USER_PASTE =
  "Access forbidden (check key/region): Your account balance is insufficient. Please recharge your account to continue using the API. (tid: 2026100716101581673504700234608)";

const cases = [
  // [status, body, expected]
  [403, JSON.stringify({ error: { message: USER_PASTE } }), "billing"], // THE paste, image-route shape
  [403, `Access forbidden (check key/region): Your account balance is insufficient. Please recharge your account.`, "billing"], // same, non-JSON body
  [402, "Payment required", "billing"], // classic 402
  [402, JSON.stringify({ error: { message: "daily credit window exhausted" } }), "billing"], // daily-window 402, novel phrasing (status carries it)
  [401, JSON.stringify({ error: { message: "Invalid API key provided" } }), "auth"],
  [403, "Access forbidden (check key/region): upstream refused the call", "auth"], // bare forbidden stays auth (no over-reach)
  [403, `{"code":403,"error":"forbidden","tid":"2026100716101581673504700234608"}`, "auth"], // tid digit-run must NOT trip \b402\b
  [429, JSON.stringify({ error: { message: "too many requests" } }), "rate-limit"],
  [503, `<!DOCTYPE html>\n<html lang="en"><head><title>vyce.ai — Maintenance</title></head></html>`, "maintenance"], // r334 witnessed shape
  [500, "internal server error", "provider-error"],
  [502, "<html>cloudflare 502</html>", "provider-error"],
  [404, "model endpoint not found", "other"],
];

let fail = 0;
for (const c of cases) {
  const r = runCase(c);
  if (!r.ok) fail++;
  console.log(
    `${r.ok ? "PASS" : "FAIL"} ${r.got} (want ${r.want}) :: HTTP ${c[0]} :: ${String(c[1]).slice(0, 76)}`
  );
}
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
