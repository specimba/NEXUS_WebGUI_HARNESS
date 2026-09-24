/**
 * r40 unit test — MRTR input gate + sticky adoption (scripts/test-mcp-input.ts)
 * Run: bun scripts/test-mcp-input.ts
 * Covers:
 *  A. parseMcpInputRequests — defensive shapes (id/message/prompt, garbage, caps)
 *  B. buildInputResponses — id echo + char cap
 *  C. gateMcpInput — headless decline, answer path, deadline auto-decline
 *  D. decideAdoption / mergeLastWinners — the sticky guard contract
 * (mcp-input.ts imports zustand — bundled by bun without a DOM, fine.)
 */
import {
  buildInputResponses,
  gateMcpInput,
  parseMcpInputRequests,
  useMcpGateStore,
} from "../src/lib/mcp-input";
import { decideAdoption, mergeLastWinners } from "../src/lib/suite-adoption";
import { MCP_INPUT_MAX_REQUESTS, MCP_INPUT_RESPONSE_MAX_CHARS } from "../src/lib/constants";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── A. parseMcpInputRequests ────────────────────────────────────────────────
console.log("A. parseMcpInputRequests");
const parsed = parseMcpInputRequests([
  { id: "r1", type: "text", message: "Which repo?" },
  { id: "r2", prompt: "Confirm the target branch" }, // alt field name
  { type: "confirm" }, // no text at all
  "garbage", // non-object — dropped
  null, // dropped
]);
check("keeps object-shaped requests", parsed.length === 3, `got ${parsed.length}`);
check("extracts message", parsed[0]?.message === "Which repo?");
check("falls back to prompt", parsed[1]?.message === "Confirm the target branch");
check("no-message request survives with raw echoed", !parsed[2]?.message && !!parsed[2]?.raw);
check("requestId alias honored", parseMcpInputRequests([{ requestId: "x" }])[0]?.id === "x");
check("non-array payload → []", parseMcpInputRequests("nope").length === 0);
check("null payload → []", parseMcpInputRequests(null).length === 0);
check(
  "cap honored",
  parseMcpInputRequests(Array.from({ length: 20 }, (_, i) => ({ id: `r${i}` }))).length === MCP_INPUT_MAX_REQUESTS
);
check("requests wrapper object accepted", parseMcpInputRequests({ requests: [{ id: "w" }] })[0]?.id === "w");

// ── B. buildInputResponses ──────────────────────────────────────────────────
console.log("B. buildInputResponses");
const reqs = parseMcpInputRequests([{ id: "a" }, { id: "b" }]);
const long = "x".repeat(MCP_INPUT_RESPONSE_MAX_CHARS + 500);
const responses = buildInputResponses(reqs, ["answer one", long]);
check("one response per request, same order", responses.length === 2);
check("id echoed", responses[0]?.id === "a" && responses[1]?.id === "b");
check("value carried", responses[0]?.value === "answer one");
check("value char-capped", (responses[1]?.value ?? "").length === MCP_INPUT_RESPONSE_MAX_CHARS);
check("missing answers degrade to empty string", buildInputResponses(reqs, [])[1]?.value === "");

// ── C. gateMcpInput ─────────────────────────────────────────────────────────
console.log("C. gateMcpInput");
// C1: headless lanes never open the gate
const gateReqs = parseMcpInputRequests([{ id: "g1", message: "Pick a lane" }]);
const headless = await gateMcpInput({ interactive: false, defName: "mcp__s__t", serverName: "s", toolName: "t", requests: gateReqs });
check("headless → null (honest decline), no dialog state", headless === null && useMcpGateStore.getState().pending === null);
check("empty requests → null even when interactive", await gateMcpInput({ interactive: true, defName: "d", serverName: "s", toolName: "t", requests: [] }) === null);

// C2: interactive opens the gate; the dialog answers via the store
const gatePromise = gateMcpInput({
  interactive: true,
  defName: "mcp__deepwiki__ask_question",
  serverName: "DeepWiki",
  toolName: "ask_question",
  requests: gateReqs,
  timeoutMs: 5_000,
});
await new Promise((r) => setTimeout(r, 20)); // let the executor open the gate
const pending = useMcpGateStore.getState().pending;
check("gate opens with server/tool context", pending?.serverName === "DeepWiki" && pending?.toolName === "ask_question");
useMcpGateStore.getState().answer(["deepwiki"]);
const answered = await gatePromise;
check("answer resolves with responses", answered?.action === "answered" && answered.responses?.[0]?.value === "deepwiki");
check("gate clears after answering", useMcpGateStore.getState().pending === null);

// C3: deadline auto-declines (400ms test seam)
const t0 = Date.now();
const timedOut = await gateMcpInput({
  interactive: true,
  defName: "d",
  serverName: "s",
  toolName: "t",
  requests: gateReqs,
  timeoutMs: 400,
});
check("deadline resolves declined with honest reason", timedOut?.action === "declined" && /auto-declined/.test(timedOut.reason ?? ""));
check("deadline actually waited (~400ms)", Date.now() - t0 >= 380, `waited ${Date.now() - t0}ms`);
check("gate clears after deadline", useMcpGateStore.getState().pending === null);

// C4: user decline via the dialog's Decline button
const declinePromise = gateMcpInput({ interactive: true, defName: "d", serverName: "s", toolName: "t", requests: gateReqs, timeoutMs: 5_000 });
await new Promise((r) => setTimeout(r, 20));
useMcpGateStore.getState().decline("declined by user");
const declined = await declinePromise;
check("user decline resolves declined", declined?.action === "declined" && declined.reason === "declined by user");

// ── D. sticky adoption ──────────────────────────────────────────────────────
console.log("D. decideAdoption / mergeLastWinners");
const first = decideAdoption(undefined, "balanced");
check("first observation applies (baseline)", first.apply === true);
const agree = decideAdoption("balanced", "balanced");
check("agreeing verdict applies", agree.apply === true && agree.reason === undefined);
const flip = decideAdoption("balanced", "free-frontier");
check("single flip is HELD with a reason", flip.apply === false && /held|agrees/i.test(flip.reason ?? ""));
const flipHeld = decideAdoption("free-frontier", "balanced");
check("a counter-flip is also HELD (both directions guarded)", flipHeld.apply === false);
const confirmed = decideAdoption("free-frontier", "free-frontier");
check("the second agreeing round applies the verdict", confirmed.apply === true);
// Sequence: A (baseline) → B held → B again applies — a real shift lands on round 3.
check("sequence A→B held, then B→B applies", flip.apply === false && confirmed.apply === true);
const merged = mergeLastWinners({ w1: "balanced" }, { w1: "fast", w2: "worker" });
check("merge updates old + adds new cases", merged.w1 === "fast" && merged.w2 === "worker");
check("merge from undefined is safe", Object.keys(mergeLastWinners(undefined, { w: "fast" })).length === 1);

// ── E. r42 resolveGateMode — per-server MRTR kill switch ────────────────────
console.log("E. resolveGateMode (per-server input gates)");
import { resolveGateMode } from "../src/lib/mcp-input";
{
  const headless = resolveGateMode(false, undefined);
  check("headless lane → closed with autonomous-lane reason", headless.open === false && /autonomous lane/.test(headless.declineReason ?? ""));
  const headlessOff = resolveGateMode(false, false);
  check("headless + server-off → same closed mode", headlessOff.open === false && /autonomous lane/.test(headlessOff.declineReason ?? ""));
  const interactiveDefault = resolveGateMode(true, undefined);
  check("interactive + missing flag → open (r40 behavior)", interactiveDefault.open === true && interactiveDefault.declineReason === undefined);
  const interactiveTrue = resolveGateMode(true, true);
  check("interactive + explicit true → open", interactiveTrue.open === true);
  const serverOff = resolveGateMode(true, false);
  check("interactive + server-off → closed naming Settings → MCP", serverOff.open === false && /Settings → MCP/.test(serverOff.declineReason ?? ""));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
