// ─── QA — TASK-102 slice 1: redaction choke unit verify (dial-free) ─────────
// Proves: pattern classes masked, vault exact-values masked, headers untouched
// by construction (module never sees them), last4 survives, clone safety.
// Run: bun scripts/qa-redaction.ts

import { redactDialBody, redactionStats } from "../src/lib/server/redaction";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const FAKE_VAULT_KEY = "vx-live-9f8e7d6c5b4a3210fedcba9876543210";
const body = {
  model: "qwen3.8-max-free",
  messages: [
    { role: "system", content: "You are executing one step. Be concise." },
    {
      role: "user",
      content:
        `my key is ${FAKE_VAULT_KEY} and also sk-proj-abcdefghijklmnopqrs1234567890 ` +
        "jwt eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk " +
        "pat ghp_0123456789abcdefghijklmnopqrstuv",
    },
  ],
  max_tokens: 2000,
};

const out = redactDialBody(body, [FAKE_VAULT_KEY]) as typeof body;
const userOut = (out.messages[1] as { content: string }).content;

check("original body untouched (clone safety)", (body.messages[1] as { content: string }).content.includes(FAKE_VAULT_KEY));
check("vault exact-value masked", !userOut.includes(FAKE_VAULT_KEY) && userOut.includes("[REDACTED:vault-value:"), "");
check("vault mask keeps last4", userOut.includes("…3210"), "policy mask: last4");
check("openai-like key masked", !userOut.includes("sk-proj-abcdefghijklmnopqrs1234567890") && userOut.includes("[REDACTED:openai-like-key:"));
check("jwt masked", !userOut.includes("eyJhbGciOiJIUzI1NiIs") && userOut.includes("[REDACTED:jwt:"));
check("github pat masked", !userOut.includes("ghp_0123456789") && userOut.includes("[REDACTED:github-pat:"));
check("system prompt untouched", (out.messages[0] as { content: string }).content === "You are executing one step. Be concise.");
check("non-string fields pass through", out.max_tokens === 2000 && out.model === "qwen3.8-max-free");
const stats = redactionStats();
check("telemetry counted hits", stats.hits >= 4, `hits=${stats.hits} byClass=${JSON.stringify(stats.byClass)}`);

console.log(failed === 0 ? "\nALL REDACTION CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
