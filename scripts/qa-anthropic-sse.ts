// r529 — TASK-102 slice 5 verification: the ENGINE streaming lane speaks Anthropic.
// Dial-free (no network, no keys): a canned /v1/messages SSE byte stream runs
// through the REAL consumeUpstreamSSE parser (not a mock), and the shaped
// engine body is asserted against the /v1/messages wire rules. Persisted per
// the round doctrine — rerun anytime with: bun scripts/qa-anthropic-sse.ts

import { consumeUpstreamSSE } from "../src/lib/agent-engine";
import {
  anthropicDialectUrl,
  AnthropicSSETranslator,
  isAnthropicStyleEndpoint,
  openaiBodyToAnthropic,
} from "../src/lib/anthropic-dialect";

let pass = 0;
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (cond: boolean, msg: string) => {
  if (!cond) fail(msg);
  pass += 1;
  console.log(`✓ ${msg}`);
};

// ── SSE bytes → house deltas through the REAL parser ────────────────────────
const sse = [
  'data: {"type":"message_start","message":{"model":"claude-vyce"}}',
  "",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  "",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"plan: "}}',
  "",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  "",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
  "",
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"get_weather"}}',
  "",
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}',
  "",
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":" \\"Oslo\\"}"}}',
  "",
  'data: {"type":"content_block_stop","index":1}',
  "",
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":12}}',
  "",
  'data: {"type":"message_stop"}',
  "",
].join("\n");

const encoder = new TextEncoder();
const stream = new ReadableStream<Uint8Array>({
  start(c) {
    c.enqueue(encoder.encode(sse));
    c.close();
  },
});

type Sent = { type: string; text?: string };
const sent: Sent[] = [];
const outcome = await consumeUpstreamSSE(stream, (e) => sent.push(e as Sent), new AbortController().signal);

ok(outcome.content === "Hello world", `text_delta events join into house content (got ${JSON.stringify(outcome.content)})`);
ok(outcome.reasoning === "plan: ", "thinking_delta → house reasoning");
ok(
  outcome.toolCalls.length === 1 && outcome.toolCalls[0]?.id === "toolu_01" && outcome.toolCalls[0]?.name === "get_weather",
  "tool_use block (start/stop) → house tool call",
);
let parsedArgs: unknown;
try {
  parsedArgs = JSON.parse(outcome.toolCalls[0]?.args ?? "not-json");
} catch {
  parsedArgs = null;
}
ok(
  JSON.stringify(parsedArgs) === '{"city":"Oslo"}',
  "input_json_delta partials reassemble into the full args JSON (parsed equality)",
);
ok(outcome.truncated !== true, "message_stop closes the stream honestly (NOT truncated)");
ok(sent.some((s) => s.type === "token" && s.text === " world"), "token events streamed live");
ok(sent.some((s) => s.type === "reasoning" && s.text === "plan: "), "reasoning events streamed live");

// ── in-band error event fails the stream honestly (shared contract) ────────
const errStream = new ReadableStream<Uint8Array>({
  start(c) {
    c.enqueue(encoder.encode('data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n'));
    c.close();
  },
});
let threw = "";
try {
  await consumeUpstreamSSE(errStream, () => {}, new AbortController().signal);
} catch (e) {
  threw = String((e as Error)?.message ?? e);
}
ok(threw.includes("Upstream stream error") && threw.includes("Overloaded"), "anthropic error event → honest stream failure");

// ── engine tool-loop body shaping: loop shapes survive the boundary ─────────
const engineMsgs: Record<string, unknown>[] = [
  { role: "system", content: "be brief" },
  { role: "user", content: "weather in Oslo?" },
  {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_1", function: { name: "get_weather", arguments: '{"city":"Oslo"}' } }],
  },
  { role: "tool", tool_call_id: "call_1", content: "12°C, clear" },
];
const shaped = openaiBodyToAnthropic({
  model: "vyce-claude",
  messages: engineMsgs,
  max_tokens: 512,
  temperature: 0.7,
  stream: true,
  tools: [
    { type: "function", function: { name: "get_weather", description: "d", parameters: { type: "object", properties: {} } } },
  ],
});

ok(shaped.system === "be brief", "system extracted to the top-level field");
ok(Array.isArray(shaped.messages) && shaped.messages.length === 3, "system row removed, 3 tool-loop turns remain");
const turns = shaped.messages as Record<string, unknown>[];
const asstBlocks = turns[1]?.content as { type: string; id?: string; name?: string; input?: unknown }[];
ok(
  Array.isArray(asstBlocks) &&
    asstBlocks[0]?.type === "tool_use" &&
    asstBlocks[0]?.id === "call_1" &&
    asstBlocks[0]?.name === "get_weather" &&
    JSON.stringify(asstBlocks[0]?.input) === '{"city":"Oslo"}',
  'assistant tool_calls turn → tool_use content blocks',
);
const toolTurn = turns[2];
const toolBlocks = toolTurn?.content as { type: string; tool_use_id?: string; content?: string }[];
ok(
  toolTurn?.role === "user" &&
    Array.isArray(toolBlocks) &&
    toolBlocks[0]?.type === "tool_result" &&
    toolBlocks[0]?.tool_use_id === "call_1" &&
    toolBlocks[0]?.content === "12°C, clear",
  'role:"tool" result row → user tool_result block (the wire has no tool role)',
);
ok(shaped.stream === true, "stream flag rides to the wire");
const wireTools = shaped.tools as { name: string; input_schema: unknown }[];
ok(
  Array.isArray(wireTools) &&
    wireTools[0]?.name === "get_weather" &&
    wireTools[0]?.input_schema != null &&
    (shaped.tool_choice as { type?: string } | undefined)?.type === "auto",
  "function tool defs → input_schema defs + auto tool_choice (loop NOT de-tooled)",
);
ok(shaped.max_tokens === 512, "explicit max_tokens kept (wire-required)");
ok(
  openaiBodyToAnthropic({ model: "m", messages: [] }).max_tokens === 4096,
  "absent max_tokens defaults to 4096 (r528 invariant kept)",
);

// ── gate + URL regression (the r528 /v1/v1 catch) ───────────────────────────
ok(isAnthropicStyleEndpoint("https://api.anthropic.com/v1/messages"), "gate: anthropic host accepted");
ok(anthropicDialectUrl("https://vyceai.com/v1") === "https://vyceai.com/v1/messages", "URL: /v1 base → /v1/messages (no double prefix)");
ok(!isAnthropicStyleEndpoint("https://vyceai.com/v1"), "gate: openai-style /v1 base NOT claimed (honest gate)");

// ── translator inertness on non-delta events ────────────────────────────────
const t = new AnthropicSSETranslator();
ok(t.feed({ type: "ping" }) === null && t.feed({ type: "message_start", message: {} }) === null, "ping/message_start emit no house delta");

console.log(`\n${pass}/${pass} checks passed`);
