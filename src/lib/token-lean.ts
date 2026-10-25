// ─── r533 — TASK-100: token-lean request shaping (the last 9router slice) ────
// 9router-style budget-aware shaping per hop class. The relay ladder itself
// (r504/r493: 429/403/5xx walk, health memory, provider breaker) already
// survives provider storms with zero manual toggles; this layer makes every
// retry CHEAPER: fallback hops dial leaner bodies — max_tokens scaled down,
// the oldest conversation turns trimmed — so a storm across the chain spends
// less budget per attempt and small free-tier lanes last longer.
//
// Hop classes (the whole contract):
//   primary (hop 0)   — spreads NOTHING: the happy path stays byte-identical.
//   first fallback    — max_tokens × 0.85, context window capped at 18 turns.
//   deep fallbacks    — max_tokens × 0.7,  context window capped at 10 turns.
//
// Honesty rules:
//   • max_tokens is never RAISED and never pushed below TOKEN_LEAN_FLOOR
//     unless the operator's own base was already below it (their explicit
//     budget wins over our floor).
//   • The trim only ever drops WHOLE oldest turns (the house EngineBody
//     carries NO system rows in messages — system rides body.system, a
//     separate field this module never touches — and no tool rows either;
//     those live inside the engine's wire loop, so no tool_call/tool_result
//     pairing can be orphaned here). A caller that DOES embed leading system
//     rows gets them respected as a walk floor (from ≥ sys): the cut never
//     lands inside the system block. The window walks back to a user-role row
//     first because the Anthropic wire rejects an assistant-first
//     conversation.
//   • Pure + isomorphic: no fetch, no storage — the same module shapes the
//     server lane and the browser-direct lane, and the redaction choke keeps
//     sitting in front of the dial after shaping (shaping only shrinks).

/** Engine default when the request carries no explicit budget (r529 parity). */
export const TOKEN_LEAN_BASE_MAX_TOKENS = 2048;
/** Never shape a fallback below this completion budget. */
export const TOKEN_LEAN_FLOOR = 512;

const SCALE_BY_HOP_CLASS = [1, 0.85, 0.7] as const;
const WINDOW_BY_HOP_CLASS = [Number.POSITIVE_INFINITY, 18, 10] as const;

/** Structural mirror of the house message row (keeps this module import-free). */
interface LeanRow {
  role: string;
  content: string;
}

export interface TokenLeanOverride<M> {
  maxTokens?: number;
  messages?: M[];
}

/** Cheap deterministic estimator (chars/4 + the completion budget) — the
 *  unit the qa script uses to WITNESS measured deltas, not a billing claim. */
export function estimateLeanTokens(
  msgs: readonly { content: string }[],
  maxTokens?: number
): number {
  let sum = 0;
  for (const m of msgs) sum += Math.ceil((m.content?.length ?? 0) / 4);
  return sum + (maxTokens ?? 0);
}

/**
 * Per-hop budget override. hopIndex 0 (the primary) returns an empty spread —
 * callers MUST spread the result so the primary dial stays byte-identical.
 */
export function tokenLeanOverride<M extends LeanRow>(
  body: { maxTokens?: number; messages?: readonly M[] },
  hopIndex: number
): TokenLeanOverride<M> {
  const cls = hopIndex <= 0 ? 0 : hopIndex === 1 ? 1 : 2;
  if (cls === 0) return {};

  // max_tokens: scale the operator's base (2048 when absent), never raise,
  // respect the floor only down to the operator's own explicit base.
  const base = typeof body.maxTokens === "number" && body.maxTokens > 0
    ? Math.floor(body.maxTokens)
    : TOKEN_LEAN_BASE_MAX_TOKENS;
  const scaled = Math.max(TOKEN_LEAN_FLOOR, Math.floor(base * SCALE_BY_HOP_CLASS[cls]));
  const maxTokens = Math.min(base, scaled);

  // Context trim: cap the tail window; walk back to a user-role row so no
  // wire ever opens on an assistant turn (Anthropic rejects assistant-first).
  let messages: M[] | undefined;
  const msgs = body.messages;
  const window = WINDOW_BY_HOP_CLASS[cls];
  if (Array.isArray(msgs) && msgs.length > window) {
    let sys = 0;
    while (sys < msgs.length && msgs[sys].role === "system") sys++;
    let from = Math.max(sys, msgs.length - window);
    while (from > sys && msgs[from]?.role !== "user") from--;
    if (from > sys || msgs[sys]?.role === "user") messages = msgs.slice(from);
  }

  return {
    ...(maxTokens < base ? { maxTokens } : {}),
    ...(messages ? { messages } : {}),
  };
}
