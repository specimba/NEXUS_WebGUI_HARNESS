// ─── System-One decision tier (r27 Jev doctrine · r510 free-lane rework) ─────
// "Not everything requires a frontier model." Classification, judging and
// routing decisions inside the harness are System-One jobs: fast, cheap,
// deterministic, structured. This module is the NEXUS decision ladder:
//
//   ① Intern       — POST discovery-api.intern-ai.org.cn/v1/systemone with
//      SystemOne     intern-decision-4b (书生 Decision 4B): choice/noul
//                    decisions, 200 RPM DECISION quota SEPARATE from the 50
//                    generative RPM — near-unlimited for gating. FREE on the
//                    TokenPlan grant; uses the intern-discovery vault key.
//                    Wire format live-probed r510 (both variants, HTTP 200).
//   ② Fast-model   — a strict JSON judge call against the BEST FAST lane in
//      JSON judge   the vault (relay taskFit "decision": flash lanes first,
//                   flagships demoted) — works today with existing keys.
//   ③ Jev (PAID)   — api.typesafe.ai/v1/systemone, ~$0.042/Mtok. DEMOTED to
//                    last per owner doctrine r510: "we do not need that paid
//                    option — use the providers' free decision models". Only
//                    dials when a typesafe.ai key is explicitly pasted.
//   ④ none         — caller keeps its current behavior (worst case = status quo)
//
// Zero telemetry: every request goes from the user's browser straight to the
// provider they chose; nothing is logged anywhere else. Jev may reject browser
// CORS — the ladder simply falls through, never breaks the harness.

import { buildRelayChain, type RelayHop } from "./relay";
import { laneFamilyKey } from "./lane-rotation";
import { redactDialBody } from "./redaction";
import type { Settings } from "./types";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_TIMEOUT_MS = 5_000;
const FAST_JUDGE_TIMEOUT_MS = 9_000;
/** Confidence bar for a PASS to actually skip a downstream flagship call. */
export const SYSTEMONE_GATE_CONFIDENCE = 0.75;
/** r664: the gate's output-length floor, named at last — it was inline `>= 200`
 * at two independent runner sites (generate-gate + peer blind-score), a drift
 * pair waiting to diverge. Single source: the panel's gate-floor chip reads the
 * same constant, so the UI can never describe a threshold the runner forgot. */
export const GATE_MIN_CHARS = 200;
/** r510: the free decision primitive — Shanghai AI Lab's 书生 Decision 4B. */
const INTERN_SYSTEMONE_MODEL = "intern-decision-4b";
const INTERN_SYSTEMONE_TIMEOUT_MS = 8_000;

export type SystemOneQuestionType = "noul" | "choice";

export interface SystemOneQuestion {
  id: string;
  type: SystemOneQuestionType;
  prompt: string;
  /** choice only — ≤255 options per the Jev API. */
  options?: string[];
  /** r510: optional calibration hints for the Intern noul wire
   * (criteria: {true,false}) — when omitted, generic wording is used. */
  criteriaTrue?: string;
  criteriaFalse?: string;
}

export interface SystemOneAnswer {
  answer: string;
  confidence: number;
}

export interface SystemOneVerdict {
  via: "intern-systemone" | "jev" | "fast-model";
  /** Human label of the lane that answered ("Intern SystemOne · intern-decision-4b", "Jev", …). */
  judge: string;
  answer: string;
  /** Calibrated 0–1 confidence from the judge (Jev: version-sensitive — treat as a prior). */
  confidence: number;
  ms: number;
  /** r673 (cross-family judge): the provider family the answering rung
   * dialed ("vyce", "zai", "intern-ai", "typesafe", …). Absent = unknown —
   * callers must render nothing rather than guess. */
  judgeFamily?: string;
  /** r673: true when the judge's family differs from the generator's — the
   * no-narcissistic-drift witness (a model grading its own family's output
   * is the weakest review shape; the verdict note says so honestly). */
  crossFamily?: boolean;
}

// ─── r673 cross-family judge (KB-1-a #1 adaptation) ──────────────────────────
// The KICK corpus's RSI doctrine: a judge from the SAME provider family as
// the generator drifts narcissistic (shared blind spots, shared training
// biases). The ladder now KNOWS each rung's family and, when the caller
// names the generator's family, prefers family-disjoint hops — without ever
// blocking (same-family answers still land, honestly tagged).

/** Known provider families by model-name substring (hop keys carry the
 * provider id directly, so this table is only for bare model names — the
 * intern/jev constants and any name-shaped fallback). */
const NAME_FAMILIES: [RegExp, string][] = [
  [/glm|chatglm|z\.ai/i, "zai"],
  [/deepseek/i, "deepseek"],
  [/qwen/i, "qwen"],
  [/kimi|moonshot/i, "moonshot"],
  [/intern/i, "intern-ai"],
  [/jev/i, "typesafe"],
  [/grok/i, "xai"],
  [/gemini/i, "google"],
  [/claude/i, "anthropic"],
  [/llama/i, "meta"],
  [/mercury/i, "mercury"],
  [/mistral|mixtral/i, "mistral"],
  [/gpt|openai/i, "openai"],
];

/** Provider family of a hop key ("vyce::deepseek-v4.1" → "vyce") or a bare
 * model name ("glm-4.7-air" → "zai"). Empty/junk → "" (unknown, never
 * guessed); never throws. */
export function judgeFamilyOf(keyOrModel: string): string {
  const s = (keyOrModel ?? "").trim();
  if (!s) return "";
  const keyFam = laneFamilyKey(s);
  if (keyFam !== "" && keyFam !== s) return keyFam; // "providerId::model" form
  for (const [re, fam] of NAME_FAMILIES) if (re.test(s)) return fam;
  return keyFam; // bare unknown name → itself as a coarse family
}

/** r673: reorder the fast-judge chain so family-disjoint hops answer FIRST
 * when the generator's family is known. Honest degradation: with no disjoint
 * hop (single-provider vault, unknown families) the chain is returned
 * unchanged — the gate never blocks on family, it only prefers diversity. */
export function orderJudgeChain(chain: RelayHop[], generatorFamily?: string): RelayHop[] {
  if (!generatorFamily || chain.length === 0) return chain;
  const fam = (h: RelayHop) => judgeFamilyOf(h.key || h.model);
  const disjoint = chain.filter((h) => {
    const f = fam(h);
    return f !== "" && f !== generatorFamily;
  });
  if (disjoint.length === 0) return chain;
  const rest = chain.filter((h) => !disjoint.includes(h));
  return [...disjoint, ...rest];
}

/** The verdict-note suffix for the family witness: " · cross-family" when a
 * family-disjoint rung answered, " · same-family" when only the generator's
 * own family could, "" when family is unknown (pre-r673 verdicts). */
export function crossFamilyTag(v: { judgeFamily?: string; crossFamily?: boolean } | null | undefined): string {
  if (!v || v.judgeFamily == null || v.crossFamily == null) return "";
  return v.crossFamily ? " · cross-family" : " · same-family";
}

// ─── ① Intern SystemOne (FREE — intern-decision-4b on the decision quota) ────

// Wire format verified LIVE r510 against discovery-api.intern-ai.org.cn:
//   noul:   questions[q] = { type:"noul", instructions, criteria:{true,false} }
//           → answers[q] = { type:"noul", noul: 0.963 }
//   choice: questions[q] = { type:"choice", instructions, criteria:{opt:desc} }
//           → answers[q] = { type:"choice", choice, probabilities, confidence }
// NOTE: criteria is REQUIRED on both — noul wants the true/false object,
// choice wants an options OBJECT (not an array; the array form 400s).
interface InternSystemOneResponse {
  answers?: Record<
    string,
    { type?: string; choice?: string; noul?: number; confidence?: number }
  >;
}

/** One decision round-trip against the free Intern decision primitive.
 * Throws on anything non-2xx (caller falls through the ladder). */
export async function askInternSystemOne(
  state: string,
  questions: SystemOneQuestion[],
  apiKey: string,
  signal?: AbortSignal
): Promise<Record<string, SystemOneAnswer>> {
  const body = {
    model: INTERN_SYSTEMONE_MODEL,
    state,
    questions: Object.fromEntries(
      questions.map((q) => {
        if (q.type === "choice") {
          const opts = (q.options ?? []).slice(0, 255);
          return [
            q.id,
            {
              type: "choice",
              instructions: q.prompt,
              // object of options — descriptions default to the option itself
              criteria: Object.fromEntries(opts.map((o) => [o, o])),
            },
          ];
        }
        return [
          q.id,
          {
            type: "noul",
            instructions: q.prompt,
            criteria: {
              true: q.criteriaTrue ?? "the statement holds for the given state",
              false: q.criteriaFalse ?? "the statement does not hold for the given state",
            },
          },
        ];
      })
    ),
  };
  const res = await fetch("https://discovery-api.intern-ai.org.cn/v1/systemone", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: composeTimeout(signal, INTERN_SYSTEMONE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Intern SystemOne ${res.status}`);
  const json = (await res.json()) as InternSystemOneResponse;
  const out: Record<string, SystemOneAnswer> = {};
  for (const q of questions) {
    const a = json.answers?.[q.id];
    if (!a) continue;
    if (q.type === "noul") {
      const n = typeof a.noul === "number" ? a.noul : null;
      if (n === null) continue;
      out[q.id] = { answer: n >= 0.5 ? "yes" : "no", confidence: n };
    } else {
      if (!a.choice) continue;
      out[q.id] = {
        answer: a.choice,
        confidence: typeof a.confidence === "number" ? a.confidence : 0,
      };
    }
  }
  return out;
}

// ─── ③ Jev native (PAID — demoted to the legacy rung, r510 owner doctrine) ────

// Wire shape per docs.typesafe.ai (r26.2 verified): questions map to
// { type, instructions, criteria } and answers come back as
// { choice, probabilities, confidence } for choice questions or
// { noul: 0–1 } for noul questions. (r27 shipped `prompt`/`options`/`p` —
// the Jev rung was silently dead and always fell through to the fast judge.)
interface JevResponse {
  answers?: Record<string, { choice?: string; noul?: number; confidence?: number }>;
}

/** One decision round-trip against Jev. Throws on anything non-2xx. */
export async function askJev(
  state: string,
  questions: SystemOneQuestion[],
  apiKey: string,
  signal?: AbortSignal
): Promise<Record<string, SystemOneAnswer>> {
  const body = {
    model: "jev-latest",
    state,
    questions: Object.fromEntries(
      questions.map((q) => [
        q.id,
        q.type === "choice"
          ? { type: "choice", instructions: q.prompt, criteria: (q.options ?? []).slice(0, 255) }
          : { type: "noul", instructions: q.prompt },
      ])
    ),
  };
  const res = await fetch(JEV_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: composeTimeout(signal, JEV_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Jev ${res.status}`);
  const json = (await res.json()) as JevResponse;
  const out: Record<string, SystemOneAnswer> = {};
  for (const q of questions) {
    const a = json.answers?.[q.id];
    if (!a) continue;
    if (q.type === "noul") {
      // noul questions answer with a calibrated 0–1 score, not a choice.
      const n = typeof a.noul === "number" ? a.noul : null;
      if (n === null) continue;
      out[q.id] = { answer: n >= 0.5 ? "yes" : "no", confidence: n };
    } else {
      if (!a.choice) continue;
      out[q.id] = {
        answer: a.choice,
        confidence: typeof a.confidence === "number" ? a.confidence : 0,
      };
    }
  }
  return out;
}

// ─── ② Fast-model JSON judge (via the vault's decision-fit lanes) ─────────────

interface ChatChoice {
  choices?: { message?: { content?: string } }[];
}

async function fastJudge(
  settings: Settings,
  state: string,
  question: SystemOneQuestion,
  signal?: AbortSignal,
  onAttempt?: (line: string) => void,
  generatorFamily?: string
): Promise<(SystemOneVerdict & { judge: string }) | null> {
  // r309: the vault chain is client-side (lib/relay is "use client") — on the
  // server lane skip ①'s relay hop entirely; the ladder falls through to ②
  // unchanged (never breaks the harness).
  let chain: RelayHop[] = [];
  if (typeof window !== "undefined") {
    chain = buildRelayChain(settings, { taskFit: "decision" }).filter(
      (h) => !!h.baseUrl // skip the built-in auto hop — it has no OpenAI-compatible surface here
    );
  }
  // r673: when the generator's family is known, family-disjoint hops lead
  // (no narcissistic drift); same-family hops stay as honest fallbacks.
  chain = orderJudgeChain(chain, generatorFamily);
  const asked = state.slice(0, 8_000);
  const prompt =
    `${question.prompt}\n\nAnswer with ONLY a raw JSON object (no markdown fences):\n` +
    (question.type === "choice"
      ? `{"answer":"<one of: ${(question.options ?? []).join(" | ")}>","confidence":<0-1>}`
      : `{"answer":"yes"|"no","confidence":<0-1>}`) +
    `\n\n=== STATE ===\n${asked}`;

  for (const hop of chain.slice(0, 2)) {
    try {
      const res = await fetch(`${hop.baseUrl!.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(hop.apiKey ? { Authorization: `Bearer ${hop.apiKey}` } : {}),
        },
        body: JSON.stringify(
          redactDialBody(
            {
              model: hop.model,
              temperature: 0,
              max_tokens: 80,
              messages: [
                {
                  role: "system",
                  content:
                    "You are a strict, calibrated judge. Reply with ONLY the raw JSON object — no prose, no markdown.",
                },
                { role: "user", content: prompt },
              ],
            },
            hop.apiKey ? [hop.apiKey] : [],
          ),
        ),
        signal: composeTimeout(signal, FAST_JUDGE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`judge ${res.status}`);
      const json = (await res.json()) as ChatChoice;
      const raw = json.choices?.[0]?.message?.content ?? "";
      const parsed = parseJudgeJson(raw);
      if (!parsed) throw new Error("judge returned unparseable JSON");
      if (question.type === "choice" && question.options && !question.options.includes(parsed.answer)) {
        throw new Error("judge answered outside the closed option set");
      }
      const hopFam = judgeFamilyOf(hop.key || hop.model);
      return {
        via: "fast-model",
        judge: hop.label,
        answer: parsed.answer,
        confidence: Math.min(1, Math.max(0, parsed.confidence)),
        ms: 0,
        judgeFamily: hopFam,
        ...(generatorFamily ? { crossFamily: hopFam !== generatorFamily } : {}),
      };
    } catch {
      // lane dead / timeout / CORS — try the next fast lane, then give up
      // r662: the dead hop is honest too — the note can name it.
      onAttempt?.(`fast-judge ${hop.label} (${hop.model}) — no answer`);
      continue;
    }
  }
  onAttempt?.(
    chain.length
      ? "fast-judge — relay chain exhausted (top 2 hops, no verdict)"
      : "fast-judge — no decision hop available (empty relay chain)"
  );
  return null;
}

function parseJudgeJson(raw: string): { answer: string; confidence: number } | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const m = /\{[^{}]*\}/.exec(cleaned);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { answer?: unknown; confidence?: unknown };
    if (typeof j.answer !== "string") return null;
    const c = typeof j.confidence === "number" ? j.confidence : 0.5;
    return { answer: j.answer.trim().toLowerCase(), confidence: c };
  } catch {
    return null;
  }
}

// ─── The ladder ───────────────────────────────────────────────────────────────

export interface DecideOptions {
  settings: Settings;
  /** The context the decision is ABOUT (task + artifact under judgment). */
  state: string;
  question: SystemOneQuestion;
  signal?: AbortSignal;
  /**
   * r662 (witness-arc): optional per-rung attempt trace — decide() tries
   * intern → fast-judge → jev and every fall-through used to be silent, so
   * a null verdict could not say WHY no judge answered (0/8 live gate
   * engagements during the r659-r661 witness runs were all congestion, but
   * the note could not prove it). Each honest line names the rung and its
   * shape; the caller composes them into the no-judge witness note.
   */
  onAttempt?: (line: string) => void;
  /** r673 (cross-family judge): the provider family of the engine that
   * PRODUCED the artifact under judgment (laneFamilyKey of the generator's
   * dialed provider). When set, the fast-judge chain prefers family-disjoint
   * hops and every verdict carries the cross-family witness. */
  generatorFamily?: string;
}

/** The intern-discovery vault key, when the owner saved one. */
function internSystemOneKey(settings: Settings): string {
  return settings.providerKeys?.["intern-discovery"]?.key?.trim() ?? "";
}

/**
 * Run one System-One decision through the ladder. Returns null when every
 * rung fails — callers MUST treat null as "no opinion" and keep their
 * existing behavior (the gate never blocks, it only saves work).
 *
 * r510 order: FREE rungs first (Intern SystemOne → vault fast judge); the
 * PAID typesafe Jev dials LAST and only when its key was explicitly pasted
 * (owner doctrine: "we do not need that paid option — use the providers'
 * free decision models").
 */
export async function decide(opts: DecideOptions): Promise<SystemOneVerdict | null> {
  const { settings, state, question, signal } = opts;
  const started = Date.now();

  // ① Intern SystemOne — FREE decision primitive, 200 RPM decision quota.
  const internKey = internSystemOneKey(settings);
  if (internKey) {
    try {
      const answers = await askInternSystemOne(state, [question], internKey, signal);
      const a = answers[question.id];
      if (a && a.answer) {
        const internFam = judgeFamilyOf(INTERN_SYSTEMONE_MODEL);
        return {
          via: "intern-systemone",
          judge: `Intern SystemOne · ${INTERN_SYSTEMONE_MODEL}`,
          answer: a.answer,
          confidence: a.confidence,
          ms: Date.now() - started,
          judgeFamily: internFam,
          ...(opts.generatorFamily ? { crossFamily: internFam !== opts.generatorFamily } : {}),
        };
      }
    } catch {
      // offline / quota / wire drift → fall through to ②
    }
    // r662: the rung was armed but produced nothing — say so.
    opts.onAttempt?.("intern-systemone — no answer (dial failed or empty)");
  } else {
    opts.onAttempt?.("intern-systemone — not armed (no intern-discovery key)");
  }

  // ② Fast-model JSON judge over the vault.
  const judged = await fastJudge(settings, state, question, signal, opts.onAttempt, opts.generatorFamily);
  if (judged) return { ...judged, ms: Date.now() - started };

  // ③ Jev (PAID) — legacy rung, only when explicitly opted in.
  const jevKey = settings.typesafeKey?.trim();
  if (jevKey) {
    try {
      const answers = await askJev(state, [question], jevKey, signal);
      const a = answers[question.id];
      if (a && a.answer) {
        const jevFam = judgeFamilyOf("jev-latest");
        return {
          via: "jev",
          judge: "Jev (jev-latest)",
          answer: a.answer,
          confidence: a.confidence,
          ms: Date.now() - started,
          judgeFamily: jevFam,
          ...(opts.generatorFamily ? { crossFamily: jevFam !== opts.generatorFamily } : {}),
        };
      }
    } catch {
      // CORS / timeout / quota → no opinion
    }
    opts.onAttempt?.("jev — no answer (dial failed or empty)");
  } else {
    opts.onAttempt?.("jev (paid rung) — not armed (no key)");
  }

  // ④ No opinion.
  return null;
}

/** Parent signal + a hard per-decision deadline, whichever fires first. */
function composeTimeout(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error("decision timeout")), timeoutMs);
  const onParentAbort = () => ctrl.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) onParentAbort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }
  const clear = () => clearTimeout(t);
  ctrl.signal.addEventListener("abort", clear, { once: true });
  return ctrl.signal;
}
