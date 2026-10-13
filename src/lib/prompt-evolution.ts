"use client";

// ─── Prompt evolution (r35) — GEPA doctrine, local-first edition ─────────────
// GEPA (reflective prompt evolution) borrows cleanly as an idea: instruction
// variants for a step, empirical win rates, mutations generated from the
// step's OWN failure feedback (review-gate verdicts, error messages). No
// framework import, no server, no keys — mutations run on the built-in engine
// exactly like the dream consolidation pass. Every knob is inspectable:
// variants, scores and the "what changed & why" note live in the editor.

import { toast } from "sonner";
import { runAgentChat } from "./chat-client";
import {
  EVOLVE_COOLDOWN_MS,
  MAX_PROMPT_VARIANTS,
  VARIANT_INSTRUCTION_MAX_CHARS,
} from "./constants";
import { truncate, uid } from "./helpers";
import { useWorkflowsStore } from "./stores";
import type { PromptVariant, WorkflowStep } from "./types";

// ─── Selection: which instruction runs THIS time? ────────────────────────────

/**
 * Clean-pass rate with a Laplace-ish prior so 1/1 doesn't beat 9/10, minus a
 * half-point penalty per rework (a step that completes but keeps getting sent
 * back should not outrank one that survives its gate first try).
 */
export function variantScore(v: PromptVariant): number {
  if (v.runs === 0) return -1; // unproven — tried only when nothing better exists
  return (v.wins - 0.5 * v.reworks + 1) / (v.runs + 2);
}

export function variantWinRate(v: PromptVariant): number {
  return v.runs === 0 ? 0 : v.wins / v.runs;
}

/**
 * Pick the instruction a step should run with: pinned variant beats
 * score-based selection; the best-scoring proven variant beats the authored
 * text; unproven variants get tried only when nothing has a record yet.
 * Returns null → the runner uses the authored instruction as-is.
 */
export function pickVariantForRun(step: WorkflowStep): PromptVariant | null {
  const variants = step.promptVariants ?? [];
  if (variants.length === 0) return null;
  if (step.pinnedVariantId) {
    const pinned = variants.find((v) => v.id === step.pinnedVariantId);
    if (pinned) return pinned;
  }
  const proven = variants.filter((v) => v.runs > 0);
  if (proven.length === 0) return variants[0] ?? null; // give the newest a first try
  const best = proven.reduce((b, v) => (variantScore(v) > variantScore(b) ? v : b));
  // Exploration when struggling: if even the best variant is losing more than
  // it wins, an unproven variant gets its trial instead of looping the loser.
  if (variantScore(best) < 0.6) {
    const unproven = variants.find((v) => v.runs === 0);
    if (unproven) return unproven;
  }
  return best;
}

/** The authored (original) variant row for a step, if one was snapshotted. */
export function authoredVariant(step: WorkflowStep): PromptVariant | undefined {
  return (step.promptVariants ?? []).find((v) => v.origin === "authored");
}

// ─── Outcome recording: the empirical half of the loop ───────────────────────

export type VariantOutcome = "win" | "rework" | "fail";

/**
 * Record one step outcome against the variant that ran. Fire-and-forget —
 * score-keeping must never break a run. Prunes nothing here; evolution owns
 * the budget.
 */
export function recordVariantOutcome(
  workflowId: string,
  stepDefId: string,
  variantId: string | undefined,
  outcome: VariantOutcome
): void {
  if (!variantId) return;
  try {
    const wf = useWorkflowsStore
      .getState()
      .workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    let touched = false;
    const steps = wf.steps.map((s) => {
      if (s.id !== stepDefId) return s;
      const variants = (s.promptVariants ?? []).map((v) =>
        v.id === variantId
          ? {
              ...v,
              runs: v.runs + 1,
              wins: v.wins + (outcome === "win" ? 1 : 0),
              reworks: v.reworks + (outcome === "rework" ? 1 : 0),
              fails: v.fails + (outcome === "fail" ? 1 : 0),
            }
          : v
      );
      touched = true;
      return { ...s, promptVariants: variants };
    });
    if (touched) useWorkflowsStore.getState().update(workflowId, { steps });
  } catch {
    /* never break a run over bookkeeping */
  }
}

// ─── Evolution: mutate an instruction from its own failure feedback ──────────

const EVOLVE_SYSTEM =
  "You evolve pipeline step instructions from failure feedback (GEPA-style " +
  "reflective prompt evolution). Reply with ONLY a JSON object: " +
  '{"instruction": "<improved instruction>", "note": "<≤160 chars: what you changed and why>"} ' +
  "— no markdown fence, no prose.";

const lastEvolveAt = new Map<string, number>();
const evolving = new Set<string>();

function stepKey(workflowId: string, stepId: string): string {
  return `${workflowId}:${stepId}`;
}

/** True when this step is allowed to auto-evolve right now (rate limits). */
export function evolutionDue(workflowId: string, step: WorkflowStep): boolean {
  const key = stepKey(workflowId, step.id);
  if (evolving.has(key)) return false;
  const last = lastEvolveAt.get(key);
  return last == null || Date.now() - last >= EVOLVE_COOLDOWN_MS;
}

/** Compact outcome history for the mutation prompt — numbers, not essays. */
function variantDigest(step: WorkflowStep): string {
  const rows = (step.promptVariants ?? []).map((v) => {
    const label =
      v.origin === "authored"
        ? "authored"
        : `evolved (${truncate(v.note ?? "no note", 80)})`;
    return `- [${label}] runs:${v.runs} clean:${v.wins} rework:${v.reworks} fail:${v.fails} — "${truncate(v.instruction, 140)}"`;
  });
  return rows.length > 0 ? rows.join("\n") : "(no variants recorded yet)";
}

/**
 * Generate ONE evolved instruction for a step from concrete feedback
 * (review-gate verdict text or an error message) plus the variant table,
 * and merge it into the step's variant budget (worst-dropped when full).
 * Returns the new variant, or null when the engine / budget said no.
 */
export async function evolveStepPrompt(
  workflowId: string,
  stepDefId: string,
  feedback: string
): Promise<PromptVariant | null> {
  const key = stepKey(workflowId, stepDefId);
  if (evolving.has(key)) return null;
  evolving.add(key);
  lastEvolveAt.set(key, Date.now());
  try {
    const wf = useWorkflowsStore
      .getState()
      .workflows.find((w) => w.id === workflowId);
    const step = wf?.steps.find((s) => s.id === stepDefId);
    if (!wf || !step) return null;

    const authored =
      step.instruction?.trim() ||
      "(no authored instruction — the step relies on its agent's system prompt)";
    const prompt = [
      `PIPELINE: ${wf.name}${wf.description ? ` — ${truncate(wf.description, 120)}` : ""}`,
      `STEP: "${step.label}" (kind: ${step.kind ?? "generate"})`,
      ``,
      `AUTHORED INSTRUCTION:`,
      authored,
      ``,
      `VARIANT TABLE (empirical record):`,
      variantDigest(step),
      ``,
      `FAILURE FEEDBACK that triggered this evolution:`,
      truncate(feedback, 700),
      ``,
      `Write ONE improved instruction for this step. Rules:`,
      `- Address the concrete failure mode in the feedback — add a guard, a constraint, a format requirement or a strategy change; never generic advice.`,
      `- ≤ ${VARIANT_INSTRUCTION_MAX_CHARS} chars, imperative mood, self-contained (it replaces the authored instruction at run time).`,
      `- "note" must say WHAT changed and WHY, ≤ 160 chars.`,
      `JSON object only.`,
    ].join("\n");

    const { content } = await runAgentChat({
      provider: "auto",
      maxIterations: 1,
      system: EVOLVE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const m = /\{[\s\S]*\}/.exec(content);
    if (!m) return null;
    let parsed: { instruction?: unknown; note?: unknown };
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
    const instruction =
      typeof parsed.instruction === "string" ? parsed.instruction.trim() : "";
    const note = typeof parsed.note === "string" ? parsed.note.trim() : "";
    if (instruction.length < 12) return null;

    const variant: PromptVariant = {
      id: uid("pv"),
      instruction: truncate(instruction, VARIANT_INSTRUCTION_MAX_CHARS),
      origin: "evolved",
      ...(note ? { note: truncate(note, 160) } : {}),
      runs: 0,
      wins: 0,
      reworks: 0,
      fails: 0,
      createdAt: Date.now(),
      from: truncate(feedback, 160),
    };

    const live = useWorkflowsStore
      .getState()
      .workflows.find((w) => w.id === workflowId);
    const liveStep = live?.steps.find((s) => s.id === stepDefId);
    if (!live || !liveStep) return null;

    // Budget: authored variants never dropped; worst evolved row pruned at cap.
    let variants = [...(liveStep.promptVariants ?? [])];
    // First evolution on this step: snapshot the authored instruction so it
    // competes on real data (and the user can pin it back if evolution drifts).
    const authoredText = liveStep.instruction?.trim();
    if (authoredText && !variants.some((v) => v.origin === "authored")) {
      variants.unshift({
        id: uid("pv"),
        instruction: authoredText,
        origin: "authored",
        runs: 0,
        wins: 0,
        reworks: 0,
        fails: 0,
        createdAt: Date.now(),
      });
    }
    const evolvedRows = variants.filter((v) => v.origin === "evolved");
    if (variants.length >= MAX_PROMPT_VARIANTS && evolvedRows.length > 0) {
      const worst = evolvedRows.reduce((a, b) =>
        variantScore(b) < variantScore(a) ? b : a
      );
      variants = variants.filter((v) => v.id !== worst.id);
    }
    variants.push(variant);

    useWorkflowsStore.getState().update(workflowId, {
      steps: live.steps.map((s) =>
        s.id === stepDefId ? { ...s, promptVariants: variants } : s
      ),
    });
    return variant;
  } catch {
    return null;
  } finally {
    evolving.delete(key);
  }
}

/**
 * Auto-evolve trigger used by the runner: schedule one mutation pass shortly
 * after a rework/failure settles (the run UI stays untouched; failures are
 * reported by the recovery card — this is the quiet improvement half).
 */
const pendingEvolve = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleEvolution(
  workflowId: string,
  stepDefId: string,
  feedback: string,
  opts?: { silent?: boolean }
): void {
  const key = stepKey(workflowId, stepDefId);
  const prev = pendingEvolve.get(key);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(async () => {
    pendingEvolve.delete(key);
    const wf = useWorkflowsStore
      .getState()
      .workflows.find((w) => w.id === workflowId);
    const step = wf?.steps.find((s) => s.id === stepDefId);
    if (!wf || !step || !evolutionDue(workflowId, step)) return;
    const created = await evolveStepPrompt(workflowId, stepDefId, feedback);
    if (!created || opts?.silent) return;
    toast("Step prompt evolved", {
      icon: "🧬",
      description: `${wf.name} · "${step.label}" — ${created.note ?? "new variant ready"} (see the editor).`,
    });
  }, 20_000);
  pendingEvolve.set(key, timer);
}
