"use client";

// ─── System-One decision tier (r27 — Jev grounding, elvis/omarsar0 doctrine) ─
// "Not everything requires a frontier model." Classification, judging and
// routing decisions inside the harness are System-One jobs: fast, cheap,
// deterministic, structured. This module is the NEXUS decision ladder:
//
//   ① Jev native  — POST api.typesafe.ai/v1/systemone (choice/score/noul,
//                   ~$0.042/Mtok input-only, 250K tok/s) when a key is set
//   ② Fast-model  — a strict JSON judge call against the BEST FAST lane in
//      JSON judge   the vault (relay taskFit "decision": flash lanes first,
//                   flagships demoted) — works today with existing keys
//   ③ none        — caller keeps its current behavior (worst case = status quo)
//
// Zero telemetry: every request goes from the user's browser straight to the
// provider they chose; nothing is logged anywhere else. Jev may reject browser
// CORS — the ladder simply falls through to ②, never breaks the harness.

import { buildRelayChain } from "./relay";
import type { Settings } from "./types";

const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const JEV_TIMEOUT_MS = 5_000;
const FAST_JUDGE_TIMEOUT_MS = 9_000;
/** Confidence bar for a PASS to actually skip a downstream flagship call. */
export const SYSTEMONE_GATE_CONFIDENCE = 0.75;

export type SystemOneQuestionType = "noul" | "choice";

export interface SystemOneQuestion {
  id: string;
  type: SystemOneQuestionType;
  prompt: string;
  /** choice only — ≤255 options per the Jev API. */
  options?: string[];
}

export interface SystemOneAnswer {
  answer: string;
  confidence: number;
}

export interface SystemOneVerdict {
  via: "jev" | "fast-model";
  /** Human label of the lane that answered ("Jev" or "Provider · model"). */
  judge: string;
  answer: string;
  /** Calibrated 0–1 confidence from the judge (Jev: version-sensitive — treat as a prior). */
  confidence: number;
  ms: number;
}

// ─── ① Jev native ─────────────────────────────────────────────────────────────

interface JevResponse {
  answers?: Record<string, { choice?: string; p?: number; confidence?: number }>;
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
          ? { type: "choice", prompt: q.prompt, options: (q.options ?? []).slice(0, 255) }
          : { type: "noul", prompt: q.prompt },
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
    out[q.id] = {
      answer: a.choice ?? (typeof a.p === "number" ? (a.p >= 0.5 ? "yes" : "no") : ""),
      confidence: typeof a.confidence === "number" ? a.confidence : (a.p ?? 0),
    };
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
  signal?: AbortSignal
): Promise<(SystemOneVerdict & { judge: string }) | null> {
  const chain = buildRelayChain(settings, { taskFit: "decision" }).filter(
    (h) => !!h.baseUrl // skip the built-in auto hop — it has no OpenAI-compatible surface here
  );
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
        body: JSON.stringify({
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
        }),
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
      return {
        via: "fast-model",
        judge: hop.label,
        answer: parsed.answer,
        confidence: Math.min(1, Math.max(0, parsed.confidence)),
        ms: 0,
      };
    } catch {
      // lane dead / timeout / CORS — try the next fast lane, then give up
      continue;
    }
  }
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
}

/**
 * Run one System-One decision through the ladder. Returns null when every
 * rung fails — callers MUST treat null as "no opinion" and keep their
 * existing behavior (the gate never blocks, it only saves work).
 */
export async function decide(opts: DecideOptions): Promise<SystemOneVerdict | null> {
  const { settings, state, question, signal } = opts;
  const started = Date.now();

  // ① Jev native — only when the user opted in with a key.
  const jevKey = settings.typesafeKey?.trim();
  if (jevKey) {
    try {
      const answers = await askJev(state, [question], jevKey, signal);
      const a = answers[question.id];
      if (a && a.answer) {
        return { via: "jev", judge: "Jev (jev-latest)", answer: a.answer, confidence: a.confidence, ms: Date.now() - started };
      }
    } catch {
      // CORS / timeout / quota → fall through to ②
    }
  }

  // ② Fast-model JSON judge over the vault.
  const judged = await fastJudge(settings, state, question, signal);
  if (judged) return { ...judged, ms: Date.now() - started };

  // ③ No opinion.
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
