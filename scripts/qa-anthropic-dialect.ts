// r528 — TASK-102 slice 4 verify: dial-free proof for the Anthropic-dialect
// adapter and its executor gate. No network dials — pure shaping + the real
// registry/resolver path.
// Run: bun scripts/qa-anthropic-dialect.ts
import {
  isAnthropicStyleEndpoint,
  anthropicDialectUrl,
  anthropicAuthHeaders,
  openaiBodyToAnthropic,
  anthropicResponseToHouse,
} from "@/lib/anthropic-dialect";
import { redactDialBody } from "@/lib/redaction";
import { resolveServerDialFromSlots } from "@/lib/server/automation-executor";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

// 1. endpoint gate
check("vyce /v1/messages is anthropic-style", isAnthropicStyleEndpoint("https://vyceai.com/v1/messages"));
check("api.anthropic.com is anthropic-style", isAnthropicStyleEndpoint("https://api.anthropic.com/v1/messages"));
check("chat/completions is NOT anthropic-style", !isAnthropicStyleEndpoint("https://vyceai.com/v1/chat/completions"));
check("unparseable URL is NOT anthropic-style", !isAnthropicStyleEndpoint("not a url"));
check("anthropicDialectUrl derives /v1/messages", anthropicDialectUrl("https://vyceai.com/v1") === "https://vyceai.com/v1/messages");

// 2. auth headers: x-api-key + anthropic-version, never Bearer
const h = anthropicAuthHeaders("sk-ant-test-abcdefghijklmnop");
check("x-api-key header carries the key", h["x-api-key"] === "sk-ant-test-abcdefghijklmnop");
check("anthropic-version header present", h["anthropic-version"] === "2023-06-01");
check("no Bearer authorization header", !("authorization" in h));

// 3. body shaping: system extraction, roles, required max_tokens
const shaped = openaiBodyToAnthropic({
  model: "claude-sonnet-4-6",
  messages: [
    { role: "system", content: "You are executing one step." },
    { role: "user", content: "Do the thing." },
  ],
  max_tokens: 2000,
  temperature: 0.7,
});
check("system moved to top-level", shaped.system === "You are executing one step.");
const shapedMsgs = shaped.messages as { role: string; content: string }[];
check("only user/assistant roles remain", shapedMsgs.length === 1 && shapedMsgs[0].role === "user");
check("max_tokens honored", shaped.max_tokens === 2000);
check("model passthrough", shaped.model === "claude-sonnet-4-6");
const shapedDefault = openaiBodyToAnthropic({ model: "m", messages: [] });
check("max_tokens defaulted (wire requires it)", shapedDefault.max_tokens === 4096);

// 4. response translation: text blocks joined, tool_use → house tool_calls
const house = anthropicResponseToHouse({
  content: [
    { type: "text", text: "Step done. " },
    { type: "text", text: "Nothing else." },
    { type: "tool_use", id: "tu_1", name: "search", input: { q: "x" } },
  ],
});
check("text blocks joined+trimmed", house.text === "Step done. Nothing else.");
check("tool_use → house tool_calls", house.toolCalls.length === 1 && house.toolCalls[0].name === "search" && house.toolCalls[0].arguments === '{"q":"x"}');
const empty = anthropicResponseToHouse({ content: [] });
check("empty content → empty text", empty.text === "" && empty.toolCalls.length === 0);

// 5. redaction choke over the SHAPED body (dialect-agnostic invariant)
const leaky = openaiBodyToAnthropic({
  model: "m",
  messages: [
    { role: "user", content: "note my key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ123456 and go" },
  ],
});
const redacted = redactDialBody(leaky) as { messages: { content: string }[] };
const rc = JSON.stringify(redacted);
check("choke masks sk-ant keys in the shaped body", !rc.includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456") && rc.includes("[REDACTED:anthropic-key:"));

// 6. THE GATE, through the REAL resolver: a vault slot for an
// anthropic-dialect provider must resolve to /v1/messages (not chat/completions)
const resolved = resolveServerDialFromSlots([{ provider: "vyce", key: "sk-test-vyce-slot-key" }]);
check("vyce slot resolves a dial", !!resolved.dial, JSON.stringify(resolved).slice(0, 120));
if (resolved.dial) {
  // EXACT equality — endsWith("/v1/messages") masked a real /v1/v1/messages bug.
  check("vyce dial URL is exactly https://vyceai.com/v1/messages", resolved.dial.url === "https://vyceai.com/v1/messages", resolved.dial.url);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
