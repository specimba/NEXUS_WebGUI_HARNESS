// ─── Context budget (r52): the free-tier prompt-cap limiter ──────────────────
// OrcaRouter's free tier (and several other free lanes) cap the SIZE of a
// single request — "This prompt is longer than the free tier allows for a
// single request" — independently of the model's real context window. A deep
// research step that makes 38 tool calls at ≤8k chars each builds a ~300k-char
// transcript and dies on iteration 2+ with an unclassifiable error.
//
// Doctrine: this is a REQUEST-SHAPED failure, not a provider-health failure.
// The lane is fine — the request is fat. So the engine (a) keeps every
// transcript under a preventive budget, and (b) on a live prompt-cap error,
// shrinks the transcript and retries the SAME lane before the relay is ever
// allowed to rotate. The compaction is protocol-safe: messages are never
// deleted (every assistant tool_call keeps its tool response), only their
// contents shrink, newest-first survival.

/** Preventive floor (~27k tokens): above this, old tool results start shrinking. */
export const DEFAULT_CONTEXT_BUDGET_CHARS = 110_000;

/** The newest N tool results always stay verbatim. */
const KEEP_FULL_TOOL_RESULTS = 4;

/** Level 1: old tool results clipped to this many chars. */
const L1_TOOL_CLIP = 900;
/** Level 2: old tool results become stubs. */
const L2_TOOL_STUB = 160;
/** Level 2+: old assistant prose (intros, announcements) clipped to this. */
const L2_ASSISTANT_CLIP = 240;
/** Level 3: the original task/context user message is head+tail clipped. */
const L3_TASK_CLIP = 8_000;

/**
 * Vocabulary of per-request prompt-cap errors across providers. Checked BEFORE
 * rate-limit/credits patterns: "free tier allows" co-appears with "add
 * credits" wording, but the fix is compaction, not a credit top-up.
 */
export const PROMPT_TOO_LONG_RE =
  /prompt is longer|prompt too long|too long for (?:the )?free tier|free tier allows|context(?:_|\s)?length(?:_|\s)?exceeded|maximum context|context length limit|too many (?:input )?tokens|input tokens? exceed|prompt_tokens? exceed|reduce the (?:length|size) of (?:the )?prompt|request too large|payload too large/i;

export interface ShrinkResult {
  /** True when at least one message actually changed. */
  changed: boolean;
  /** How many tool results were shrunk/stubbed. */
  toolResultsShrunk: number;
  /** Estimated chars before → after. */
  before: number;
  after: number;
}

/** Sum of every message's content size — the request-fat proxy. */
export function estimateMessagesChars(msgs: Record<string, unknown>[]): number {
  let total = 0;
  for (const m of msgs) {
    const c = m.content;
    if (typeof c === "string") total += c.length;
    else if (c != null) total += String(c).length;
    const tc = m.tool_calls;
    if (Array.isArray(tc)) {
      for (const t of tc) {
        const fn = (t as { function?: { arguments?: string; name?: string } }).function;
        total += (fn?.name?.length ?? 0) + (fn?.arguments?.length ?? 0);
      }
    }
  }
  return total;
}

function msgChars(m: Record<string, unknown>): number {
  const c = m.content;
  return typeof c === "string" ? c.length : c != null ? String(c).length : 0;
}

function clipHead(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…[clipped ${s.length - n} chars]`;
}

function clipHeadTail(s: string, n: number): string {
  if (s.length <= n) return s;
  const head = Math.floor(n * 0.7);
  const tail = n - head;
  return `${s.slice(0, head)}\n[…${s.length - n} chars clipped — middle omitted]…\n${s.slice(-tail)}`;
}

function stubFor(m: Record<string, unknown>, cap: number): string {
  const len = msgChars(m);
  const name =
    (m as { tool_call_id?: string }).tool_call_id ?? "tool";
  const body =
    cap <= L2_TOOL_STUB
      ? ""
      : `\n${clipHead(typeof m.content === "string" ? m.content : String(m.content ?? ""), cap)}`;
  return `[context compacted: ${name} result was ${len} chars — dropped to fit the provider's per-request prompt cap; the digest of gathered material is preserved elsewhere in this conversation]${body}`;
}

/**
 * Shrink the transcript IN PLACE at an escalating level:
 *  1 — tool results older than the newest KEEP_FULL become 900-char clips
 *  2 — those become 160-char stubs; old assistant prose clipped
 *  3 — additionally the original task user-message is head+tail clipped
 * Protocol-safe: nothing is deleted; assistant tool_calls keep their tool
 * responses; the system message is untouched.
 */
export function shrinkMessages(
  msgs: Record<string, unknown>[],
  level: 1 | 2 | 3,
  keepFull: number = KEEP_FULL_TOOL_RESULTS
): ShrinkResult {
  const before = estimateMessagesChars(msgs);
  let changed = false;
  let toolResultsShrunk = 0;

  // Newest tool messages (by array order) stay verbatim.
  const toolIdx: number[] = [];
  for (let i = 0; i < msgs.length; i++) if (msgs[i].role === "tool") toolIdx.push(i);
  const keepFrom = Math.max(0, toolIdx.length - keepFull);
  const keepSet = new Set(toolIdx.slice(keepFrom));

  const toolCap = level === 1 ? L1_TOOL_CLIP : L2_TOOL_STUB;
  for (const i of toolIdx) {
    if (keepSet.has(i)) continue;
    const m = msgs[i];
    if (msgChars(m) <= toolCap) continue;
    m.content = stubFor(m, toolCap);
    changed = true;
    toolResultsShrunk += 1;
  }

  if (level >= 2) {
    // Old assistant prose — the "I'll research this in parallel batches…"
    // announcements that pad long loops. Never the last few messages (they
    // carry the live exchange).
    for (let i = 0; i < msgs.length - 6; i++) {
      const m = msgs[i];
      if (m.role !== "assistant") continue;
      if (typeof m.content === "string" && m.content.length > L2_ASSISTANT_CLIP) {
        m.content = clipHead(m.content, L2_ASSISTANT_CLIP);
        changed = true;
      }
    }
  }

  if (level >= 3) {
    // The original task/context message: keep head (the task) + tail (the
    // freshest handed-down context), drop the middle.
    for (let i = 1; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role !== "user") continue;
      if (typeof m.content === "string" && m.content.length > L3_TASK_CLIP) {
        m.content = clipHeadTail(m.content, L3_TASK_CLIP);
        changed = true;
      }
      break; // only the FIRST user message (the task) — nudges stay intact
    }
  }

  return { changed, toolResultsShrunk, before, after: estimateMessagesChars(msgs) };
}

export interface CompactOutcome extends ShrinkResult {
  /** Highest shrink level applied (0 = nothing needed). */
  level: 0 | 1 | 2 | 3;
}

/**
 * Preventive compaction: escalate 1→2→3 until under budget (or fully shrunk).
 * Cheap no-op when the transcript is already small.
 */
export function compactToBudget(
  msgs: Record<string, unknown>[],
  budgetChars: number
): CompactOutcome {
  let out: CompactOutcome = { changed: false, toolResultsShrunk: 0, before: estimateMessagesChars(msgs), after: 0, level: 0 };
  out.after = out.before;
  if (out.before <= budgetChars) return out;
  for (const level of [1, 2, 3] as const) {
    const r = shrinkMessages(msgs, level);
    out = { ...r, level };
    if (r.after <= budgetChars) break;
  }
  return out;
}

/** One human line for the run log / status feed. */
export function describeCompaction(o: CompactOutcome, budget: number): string {
  if (o.level === 0) return "";
  const verb = o.level === 1 ? "clipped" : o.level >= 2 ? "compacted" : "clipped hard";
  return `Context budget: transcript was ${Math.round(o.before / 1000)}k chars (budget ${Math.round(budget / 1000)}k) — ${verb} ${o.toolResultsShrunk} old tool result${o.toolResultsShrunk === 1 ? "" : "s"} to ${Math.round(o.after / 1000)}k chars`;
}
