"use client";

// ─── Dreaming-lite (r33) — Letta's "dreaming" doctrine, local-first edition ──
// During idle time a background consolidation pass distills recent run history
// into durable Reflexion lessons, using the built-in engine (zero keys, zero
// marginal cost to the user). One pending timer per workflow, hard rate limit
// (DREAM_COOLDOWN_MS), and suite runs stay silent (the Suites board owns that
// channel). Dreams never surface as errors — idle-time work either lands or
// evaporates quietly, and the run-written lessons always stay senior.

import { toast } from "sonner";
import { runAgentChat } from "./chat-client";
import {
  DREAM_COOLDOWN_MS,
  DREAM_DELAY_MS,
  DREAM_LESSON_MAX_CHARS,
  DREAM_MAX_ADD,
  DREAM_MIN_RUNS,
  LESSON_MAX_CHARS,
  MAX_LESSONS,
} from "./constants";
import { fmtMs, truncate } from "./helpers";
import { useWorkflowsStore } from "./stores";
import type { RunLesson, Workflow, WorkflowRun } from "./types";

const pending = new Map<string, ReturnType<typeof setTimeout>>();

function isRunningNow(workflowId: string): boolean {
  return (
    useWorkflowsStore
      .getState()
      .workflows.find((w) => w.id === workflowId)
      ?.runs.some((r) => r.status === "running") ?? false
  );
}

/** True when this workflow has earned a dream (enough fresh runs + cooldown). */
export function dreamDue(wf: Workflow): boolean {
  if (isRunningNow(wf.id)) return false;
  const last = wf.dream?.lastDreamAt;
  if (last == null) {
    // Never dreamed before: the runs threshold alone gates the first dream —
    // the hourly cooldown exists to rate-limit REPEAT dreams, not to delay
    // the first consolidation of a fresh pipeline.
    return wf.runs.length >= DREAM_MIN_RUNS;
  }
  if (Date.now() - last < DREAM_COOLDOWN_MS) return false;
  const runsSince = wf.runs.filter((r) => r.startedAt > last);
  return runsSince.length >= DREAM_MIN_RUNS;
}

export type DreamOutcome =
  | { ok: true; added: number; runsConsidered: number; note: string }
  | { ok: false; reason: "running" | "no-runs" | "engine" };

/** Compact, honest per-run outcome lines — no outputs, no keys, no transcripts. */
function buildDigest(runs: WorkflowRun[]): string {
  return runs
    .map((r, i) => {
      const tools = r.steps.reduce((n, s) => n + s.toolCalls.length, 0);
      const toolsOk = r.steps.reduce(
        (n, s) => n + s.toolCalls.filter((t) => t.ok).length,
        0
      );
      const bits = [
        r.status,
        `${r.steps.filter((s) => s.status === "done").length}/${r.steps.length} steps`,
        `${tools} tool calls (${toolsOk} ok)`,
        r.finishedAt ? fmtMs(r.finishedAt - r.startedAt) : "duration unknown",
      ];
      if (r.error) {
        bits.push(
          `failed at "${r.error.stepLabel}" [${r.error.kind}]: ${truncate(r.error.message, 110)}`
        );
      }
      const reworks = r.steps.filter((s) => s.reworked).length;
      if (reworks) bits.push(`${reworks} review rework${reworks === 1 ? "" : "s"}`);
      const degraded = r.steps.filter((s) => s.degraded).length;
      if (degraded) bits.push(`${degraded} auto-digest step${degraded === 1 ? "" : "s"}`);
      return `Run ${i + 1} — task: ${truncate(r.task, 80)}\n  ${bits.join(" · ")}`;
    })
    .join("\n");
}

/** Extract ≤ DREAM_MAX_ADD deduped, length-capped lessons from the reply. */
function parseLessons(raw: string, existing: string[]): string[] {
  const m = /\[[\s\S]*\]/.exec(raw);
  if (!m) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text.length < 12) continue;
    const low = text.toLowerCase();
    if (existing.some((e) => e === low || e.includes(low) || low.includes(e))) continue;
    out.push(truncate(text, DREAM_LESSON_MAX_CHARS));
    if (out.length >= DREAM_MAX_ADD) break;
  }
  return out;
}

const DREAM_SYSTEM =
  "You are the consolidation pass (\"dreaming\") of a local multi-agent harness. " +
  "You read pipeline run outcomes and distill durable, actionable lessons. " +
  "Reply with ONLY a JSON array of strings — no prose, no markdown fence.";

/**
 * Run one consolidation pass for a workflow: digest the runs since the last
 * dream, ask the built-in engine for ≤2 new lessons, merge into the lesson
 * budget (oldest-dropped, same as run-written lessons) and stamp DreamState.
 */
export async function runDream(workflowId: string): Promise<DreamOutcome | null> {
  const wf = useWorkflowsStore.getState().workflows.find((w) => w.id === workflowId);
  if (!wf) return null;
  if (isRunningNow(workflowId)) return { ok: false, reason: "running" };
  const last = wf.dream?.lastDreamAt;
  const runs = (last ? wf.runs.filter((r) => r.startedAt > last) : wf.runs).slice(-8);
  if (runs.length < DREAM_MIN_RUNS) return { ok: false, reason: "no-runs" };
  const runsConsidered = runs.length;

  const existing = (wf.lessons ?? []).map((l) => l.text.toLowerCase());
  const prompt = [
    `PIPELINE: ${wf.name}${wf.description ? ` — ${truncate(wf.description, 160)}` : ""}`,
    wf.steps.length ? `STEP CHAIN: ${wf.steps.map((s) => s.label).join(" → ")}` : "",
    "",
    `RUN OUTCOMES since the last consolidation (${runsConsidered} runs):`,
    buildDigest(runs),
    "",
    `EXISTING LESSONS (do not repeat these):`,
    (wf.lessons ?? []).length ? (wf.lessons ?? []).map((l) => `- ${l.text}`).join("\n") : "(none)",
    "",
    `Distill at most ${DREAM_MAX_ADD} NEW durable lessons for the NEXT runs of this pipeline. Rules:`,
    `- Each lesson ≤ ${DREAM_LESSON_MAX_CHARS} chars and starts with "Try: " — one concrete strategy change (tool budget, model lane, step order, prompt strategy, scope), never generic advice.`,
    `- Base it ONLY on the outcomes above.`,
    `- Return [] if nothing new is worth adding.`,
    "JSON array of strings only.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { content } = await runAgentChat({
      provider: "auto",
      maxIterations: 1,
      system: DREAM_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const fresh = parseLessons(content, existing);
    const now = Date.now();
    const note =
      fresh.length > 0
        ? `Distilled ${fresh.length} new lesson${fresh.length === 1 ? "" : "s"} from ${runsConsidered} runs`
        : `Reviewed ${runsConsidered} runs — nothing new worth adding`;
    const lessons: RunLesson[] = [
      ...(wf.lessons ?? []),
      ...fresh.map<RunLesson>((text) => ({ text, at: now, kind: "dream" })),
    ].slice(-MAX_LESSONS);
    useWorkflowsStore.getState().update(workflowId, {
      lessons,
      dream: { lastDreamAt: now, runsConsidered, added: fresh.length, note },
    });
    return { ok: true, added: fresh.length, runsConsidered, note };
  } catch {
    return { ok: false, reason: "engine" };
  }
}

/**
 * Called by the runner after any run settles: cancel any pending dream for
 * this workflow, then re-check DREAM_DELAY_MS later (the workflow may have
 * started another run by then — dreamDue re-verifies at fire time).
 */
export function scheduleDream(workflowId: string, opts?: { silent?: boolean }): void {
  const prev = pending.get(workflowId);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(async () => {
    pending.delete(workflowId);
    const wf = useWorkflowsStore.getState().workflows.find((w) => w.id === workflowId);
    if (!wf || !dreamDue(wf)) return;
    const out = await runDream(workflowId);
    if (!out || !out.ok || out.added === 0) return;
    if (opts?.silent) return; // suite runs report through the Suites board
    toast("Dreamed new lessons", {
      icon: "🌙",
      description: `${wf.name} · ${out.note} — the next run starts smarter (see the editor).`,
    });
  }, DREAM_DELAY_MS);
  pending.set(workflowId, timer);
}

/** Lesson budget guard shared with the editor (dream lessons are ≤220 chars). */
export function dreamLessonCeiling(): number {
  return Math.min(DREAM_LESSON_MAX_CHARS, LESSON_MAX_CHARS);
}
