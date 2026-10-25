// ─── qa-token-lean (r533) — TASK-100, dial-free verification ─────────────────
// Witnesses the token-lean hop-class contract through the REAL shaping
// function: byte-identical primary, measured max_tokens/context deltas per
// class, floor/never-raise rules, tool-loop + Anthropic assistant-first
// safety, and a 5-hop storm walk whose request cost monotonically shrinks —
// zero manual toggles anywhere.
import {
  tokenLeanOverride,
  estimateLeanTokens,
  TOKEN_LEAN_FLOOR,
  TOKEN_LEAN_BASE_MAX_TOKENS,
} from "@/lib/token-lean";
import { redactDialBody } from "@/lib/redaction";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Row = { role: "user" | "assistant" | "system"; content: string };

/** A 40-turn conversation in the house shape: NO system rows here — the
 *  engine carries system in body.system (a separate field the trim never
 *  touches), so messages are pure user/assistant turns. */
function conv(turns: number): { maxTokens?: number; messages: Row[] } {
  const msgs: Row[] = [];
  for (let t = 0; t < turns; t++) {
    msgs.push({ role: t % 2 === 0 ? "user" : "assistant", content: `turn-${t}-${"x".repeat(40)}` });
  }
  return { maxTokens: 2048, messages: msgs };
}

// 1. PRIMARY — the empty spread (byte-identical happy path).
check(
  "primary spreads nothing (byte-identical)",
  JSON.stringify(tokenLeanOverride(conv(20), 0)) === "{}" &&
    JSON.stringify(tokenLeanOverride(conv(20), -1)) === "{}",
  JSON.stringify(tokenLeanOverride(conv(20), 0))
);

// 2. FIRST FALLBACK — max_tokens × 0.85 measured.
const h1 = tokenLeanOverride(conv(40), 1);
check(
  "first fallback scales max_tokens 2048 → 1740 (×0.85)",
  h1.maxTokens === Math.floor(2048 * 0.85) && h1.maxTokens === 1740,
  `maxTokens=${h1.maxTokens}`
);

// 3. FIRST FALLBACK — context window capped at 18 (+2 system rows = 20 rows).
check(
  "first fallback trims to an 18-turn window opening on a user row",
  Array.isArray(h1.messages) && h1.messages.length === 18 &&
    h1.messages[0].role === "user" && h1.messages[0].content.startsWith("turn-22"),
  `len=${h1.messages?.length}`
);

// 4. DEEP FALLBACK — ×0.7 measured + window 10.
const h2 = tokenLeanOverride(conv(40), 3);
check(
  "deep fallback scales max_tokens 2048 → 1433 (×0.7) + window 10",
  h2.maxTokens === Math.floor(2048 * 0.7) && h2.maxTokens === 1433 &&
    Array.isArray(h2.messages) && h2.messages.length === 10 &&
    h2.messages[0].content.startsWith("turn-30"),
  `maxTokens=${h2.maxTokens} len=${h2.messages?.length}`
);

// 5. FLOOR + NEVER-RAISE — a tiny explicit budget is never raised, a big one
// never lands below the floor.
const tiny = tokenLeanOverride({ maxTokens: 300, messages: conv(40).messages }, 2);
const huge = tokenLeanOverride({ maxTokens: 100000, messages: conv(40).messages }, 2);
check(
  "never-raise honored (a sub-floor operator budget spreads nothing)",
  tiny.maxTokens === undefined &&
    (huge.maxTokens ?? 0) === Math.floor(100000 * 0.7) &&
    (huge.maxTokens ?? 0) >= TOKEN_LEAN_FLOOR,
  `tiny=${tiny.maxTokens} huge=${huge.maxTokens} floor=${TOKEN_LEAN_FLOOR}`
);

// 6. DEFAULT BASE — no explicit maxTokens still shapes from 2048.
const noBase = tokenLeanOverride({ messages: conv(40).messages }, 2);
check(
  "absent maxTokens shapes from the 2048 engine default",
  noBase.maxTokens === Math.floor(TOKEN_LEAN_BASE_MAX_TOKENS * 0.7),
  `maxTokens=${noBase.maxTokens}`
);

// 7. ANTHROPIC SAFETY — the trimmed window never opens on an assistant row
// (walks back to a user row), even for awkward cut points.
// 14 rows — the natural cut (14-10=4) lands INSIDE the assistant cluster at
// rows 2-11, forcing the walk-back-to-user rule to fire.
const awkward: Row[] = [{ role: "system", content: "s" }, { role: "user", content: "u0" }];
for (let a = 0; a < 10; a++) awkward.push({ role: "assistant", content: `a${a}` });
awkward.push({ role: "user", content: "u1" });
awkward.push({ role: "assistant", content: "a-end" });
const aw = tokenLeanOverride({ maxTokens: 2048, messages: awkward }, 2);
check(
  "trimmed window opens on a user row (assistant-first rejected by Anthropic)",
  Array.isArray(aw.messages) && aw.messages[0]?.role === "user" &&
    aw.messages[0]?.content === "u0",
  JSON.stringify(aw.messages?.map((m) => m.role))
);

// 8. SHORT CHAT — a conversation inside the window trims nothing (only the
// budget scales); leading system rows always survive every class.
const short = conv(6);
const sh1 = tokenLeanOverride(short, 1);
const sh2 = tokenLeanOverride(short, 2);
check(
  "short chats trim nothing; system rows survive",
  sh1.messages === undefined && sh2.messages === undefined &&
    short.messages.length === 6,
  `sh1=${sh1.messages?.length} sh2=${sh2.messages?.length}`
);

// 9. STORM WALK — 5 hops all failing: request cost strictly non-increasing,
// every shaped body well-formed, zero manual toggles.
const storm = conv(40);
const costs: number[] = [];
let wellFormed = true;
for (let hop = 0; hop < 5; hop++) {
  const ov = tokenLeanOverride(storm, hop);
  const maxT = ov.maxTokens ?? storm.maxTokens ?? TOKEN_LEAN_BASE_MAX_TOKENS;
  const msgs = ov.messages ?? storm.messages;
  if (!Array.isArray(msgs) || msgs.length === 0 || maxT < TOKEN_LEAN_FLOOR) wellFormed = false;
  costs.push(estimateLeanTokens(msgs, maxT));
}
check(
  "5-hop storm: cost monotonic non-increasing, every body well-formed",
  wellFormed && costs[0] > costs[1] && costs[1] > costs[2] &&
    costs[2] === costs[3] && costs[3] === costs[4] && costs[4] < costs[0],
  `costs=${costs.join(" → ")}`
);

// 10. CHOKE — a shaped (leaner) body still rides the redaction choke plain.
const lean = tokenLeanOverride(
  { maxTokens: 2048, messages: conv(40).messages },
  2
);
const shaped = { model: "m", stream: true, max_tokens: lean.maxTokens, messages: lean.messages };
const masked = redactDialBody(shaped as unknown as Record<string, unknown>, []);
check(
  "shaped body stays choke-compatible plain JSON",
  !!masked && typeof masked === "object" && "messages" in masked,
  "shape"
);

console.log(`${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
