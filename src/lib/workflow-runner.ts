"use client";

// ─── Shared workflow run engine (used by the run panel AND the scheduler) ────

import { toast } from "sonner";
import { isAbortError, runAgentChat } from "@/lib/chat-client";
import { resolveLlm } from "@/lib/llm-config";
import {
  buildConversationalContext,
  buildReviewContext,
  buildSequentialContext,
  parseReviewVerdict,
  uid,
  type PrevStepOutput,
} from "@/lib/helpers";
import {
  useAgentsStore,
  useSettingsStore,
  useUiStore,
  useWorkflowsStore,
} from "@/lib/stores";
import { REWORK_LIMIT } from "@/lib/constants";
import type {
  ToolCallInfo,
  Workflow,
  WorkflowRun,
  WorkflowRunStep,
} from "@/lib/types";

/** Workflows with a run currently streaming — guards concurrent triggers. */
const activeRuns = new Set<string>();

export function isWorkflowRunning(workflowId: string): boolean {
  return activeRuns.has(workflowId);
}

export function activeRunCount(): number {
  return activeRuns.size;
}

export interface ExecuteRunOptions {
  workflow: Pick<Workflow, "id">;
  task: string;
  /** "scheduled" runs toast with a clock icon and a distinct message. */
  source?: "manual" | "scheduled";
  /** Called right after the run row is created (panel uses it to view + wire Stop). */
  onStarted?: (runId: string, controller: AbortController) => void;
  /** Called with the final status whether done, stopped or errored. */
  onSettled?: (runId: string, status: WorkflowRun["status"]) => void;
  /** Optional external stop handle — defaults to the runner's own controller. */
  signal?: AbortSignal;
}

/**
 * Run a workflow pipeline end-to-end: creates the run row in the store,
 * streams each step through the agent chain, patches statuses live.
 * Steps marked kind:"review" act as quality gates — they audit the previous
 * step's output and may send it back for a rework pass (up to REWORK_LIMIT).
 * Returns the run id, or null when the run could not start.
 */
export async function executeWorkflowRun(
  options: ExecuteRunOptions
): Promise<string | null> {
  const { task, source = "manual", onStarted, onSettled } = options;
  const wf = useWorkflowsStore
    .getState()
    .workflows.find((w) => w.id === options.workflow.id);
  if (!wf || wf.steps.length === 0 || task.trim() === "") return null;
  if (activeRuns.has(wf.id)) return null;

  const store = useWorkflowsStore.getState();
  const settings = useSettingsStore.getState();
  const agentsNow = useAgentsStore.getState().agents;
  const runId = uid("run");
  const now = Date.now();
  const trimmed = task.trim();

  const steps: WorkflowRunStep[] = wf.steps.map((s) => {
    const agent = agentsNow.find((a) => a.id === s.agentId);
    return {
      stepId: s.id,
      agentId: s.agentId,
      agentName: agent?.name ?? "Unknown agent",
      agentEmoji: agent?.emoji ?? "🤖",
      label: s.label || "Untitled step",
      output: "",
      toolCalls: [],
      status: "running",
      kind: s.kind ?? "generate",
    };
  });

  store.addRun(wf.id, {
    id: runId,
    workflowId: wf.id,
    workflowName: wf.name,
    task: trimmed,
    status: "running",
    startedAt: now,
    steps,
  });

  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  activeRuns.add(wf.id);
  useUiStore.getState().setBusy(true);
  onStarted?.(runId, controller);

  const patchRunStep = (
    stepId: string,
    patch: Partial<WorkflowRunStep>
  ) => useWorkflowsStore.getState().patchRunStep(wf.id, runId, stepId, patch);
  const patchRun = (patch: Partial<WorkflowRun>) =>
    useWorkflowsStore.getState().patchRun(wf.id, runId, patch);

  const stopRemaining = (fromIndex: number) => {
    for (let j = fromIndex + 1; j < steps.length; j++) {
      patchRunStep(steps[j].stepId, { status: "stopped", output: "" });
    }
  };

  const finish = (status: WorkflowRun["status"], toastMsg: string) => {
    patchRun({ status, finishedAt: Date.now() });
    if (source === "scheduled") {
      if (status === "done") toast.success("Scheduled run finished", { icon: "⏰", description: `${wf.name} · ${steps.length} steps` });
      else if (status === "error") toast.error("Scheduled run failed", { icon: "⏰", description: wf.name });
    } else {
      if (status === "done") toast.success(toastMsg);
    }
    onSettled?.(runId, status);
  };

  /** Stream one agent call for a run step; returns the final content + duration. */
  const streamStep = async (
    runStep: WorkflowRunStep,
    agentId: string,
    system: string,
    context: string
  ): Promise<{ content: string; ms: number }> => {
    const agent = useAgentsStore.getState().agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Agent for step "${runStep.label}" not found`);
    const stepStart = Date.now();
    let draft = "";
    const localToolCalls: ToolCallInfo[] = [];
    try {
      const llm = resolveLlm(settings.settings, agent.model);
      const res = await runAgentChat(
        {
          provider: llm.provider,
          apiKey: llm.apiKey,
          baseUrl: llm.baseUrl,
          model: llm.model,
          temperature: agent.temperature,
          maxIterations: agent.maxIterations,
          tools: agent.tools,
          system,
          messages: [{ role: "user", content: context }],
          signal,
        },
        {
          onToken: (t) => {
            draft += t;
            patchRunStep(runStep.stepId, { output: draft });
          },
          onToolCall: (c) => {
            localToolCalls.push({ id: c.id, name: c.name, args: c.args });
            patchRunStep(runStep.stepId, { toolCalls: [...localToolCalls] });
          },
          onToolResult: (r) => {
            const idx = localToolCalls.findIndex((tc) => tc.id === r.id);
            if (idx !== -1) {
              localToolCalls[idx] = {
                ...localToolCalls[idx],
                result: r.content,
                ok: r.ok,
                ms: r.ms,
              };
            }
            patchRunStep(runStep.stepId, { toolCalls: [...localToolCalls] });
          },
        }
      );
      patchRunStep(runStep.stepId, {
        output: res.content,
        toolCalls: res.toolCalls.length > 0 ? res.toolCalls : localToolCalls,
        status: "done",
        ms: Date.now() - stepStart,
      });
      return { content: res.content, ms: Date.now() - stepStart };
    } catch (err) {
      if (isAbortError(err)) {
        patchRunStep(runStep.stepId, {
          status: "stopped",
          output: draft || "(stopped)",
        });
      } else {
        patchRunStep(runStep.stepId, {
          status: "error",
          output: `${draft ? `${draft}\n\n` : ""}**Error:** ${(err as Error).message}`,
        });
      }
      throw err;
    }
  };

  try {
    const prev: PrevStepOutput[] = [];
    const framework = settings.settings.framework;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const def = wf.steps.find((s) => s.id === step.stepId);
      const kind = def?.kind ?? "generate";
      const instruction = def?.instruction;
      const baseSystem = instruction
        ? `${useAgentsStore.getState().agents.find((a) => a.id === step.agentId)?.instructions ?? ""}\n\nFOCUS FOR THIS STEP: ${instruction}`
        : useAgentsStore.getState().agents.find((a) => a.id === step.agentId)?.instructions ?? "";

      const agentRow = useAgentsStore
        .getState()
        .agents.find((a) => a.id === step.agentId);
      if (!agentRow) {
        patchRunStep(step.stepId, { status: "error", output: "Agent not found" });
        stopRemaining(i);
        finish("error", `Step "${step.label}" failed`);
        return runId;
      }

      // ─── Review gate: audit the previous step, may force one rework pass ───
      if (kind === "review" && i > 0) {
        const reviewed = steps[i - 1];
        const context = buildReviewContext(
          trimmed,
          prev[prev.length - 1] ?? {
            label: reviewed.label,
            agentName: reviewed.agentName,
            output: reviewed.output,
          }
        );

        let reworks = 0;
        // Bounded loop: review → (rework previous → review again) → continue
        for (;;) {
          try {
            const { content, ms } = await streamStep(step, step.agentId, baseSystem, context);
            const verdict = parseReviewVerdict(content);

            if (verdict === "pass" || reworks >= REWORK_LIMIT) {
              patchRunStep(step.stepId, {
                status: "done",
                output: content,
                verdict: verdict === "pass" ? "pass" : "rework",
                kind: "review",
                ms,
              });
              prev.push({
                label: step.label,
                agentName: agentRow.name,
                output:
                  verdict === "pass"
                    ? content
                    : `${content}\n\n(Note: the reviewer still wanted changes after ${REWORK_LIMIT} rework pass${REWORK_LIMIT === 1 ? "" : "es"} — pipeline continued.)`,
              });
              break;
            }

            // ─── Rework: re-run the previous generate step with feedback ───
            reworks++;
            const feedback = content;
            patchRunStep(step.stepId, {
              status: "done",
              output: feedback,
              verdict: "rework",
              kind: "review",
              ms,
            });
            toast.warning("Review gate sent the step back for rework", {
              icon: "↻",
              description: `${step.label} → ${reviewed.label} (pass ${reworks}/${REWORK_LIMIT + 1})`,
            });

            const genAgent = useAgentsStore
              .getState()
              .agents.find((a) => a.id === reviewed.agentId);
            if (!genAgent) {
              patchRunStep(reviewed.stepId, { status: "error", output: "Agent not found" });
              stopRemaining(i);
              finish("error", `Step "${reviewed.label}" failed`);
              return runId;
            }
            const reviewedDef = wf.steps.find((s) => s.id === reviewed.stepId);
            const genBase = reviewedDef?.instruction
              ? `${genAgent.instructions}\n\nFOCUS FOR THIS STEP: ${reviewedDef.instruction}`
              : genAgent.instructions;
            const reworkSystem = `${genBase}\n\nREWORK REQUIRED — your previous attempt was rejected by the review gate. Reviewer feedback: ${feedback}\nAddress every point and deliver an improved result.`;

            // Rebuild the context WITHOUT the reviewed step's stale output
            prev.pop();
            const genContext =
              framework === "sequential"
                ? buildSequentialContext(trimmed, prev)
                : buildConversationalContext(trimmed, prev);

            patchRunStep(reviewed.stepId, { status: "running", reworked: true });
            const gen = await streamStep(
              reviewed,
              reviewed.agentId,
              reworkSystem,
              genContext
            );
            prev.push({
              label: reviewed.label,
              agentName: genAgent.name,
              output: gen.content,
            });
            // Loop → the review gate runs again on the improved output
          } catch (err) {
            if (isAbortError(err)) {
              stopRemaining(i);
              finish("stopped", "Pipeline stopped");
              return runId;
            }
            stopRemaining(i);
            finish("error", `Step "${step.label}" failed`);
            return runId;
          }
        }
        continue;
      }

      // ─── Regular generate step ────────────────────────────────────────────
      const context =
        framework === "sequential"
          ? buildSequentialContext(trimmed, prev)
          : buildConversationalContext(trimmed, prev);

      try {
        const { content } = await streamStep(step, step.agentId, baseSystem, context);
        prev.push({ label: step.label, agentName: agentRow.name, output: content });
      } catch (err) {
        if (isAbortError(err)) {
          stopRemaining(i);
          finish("stopped", "Pipeline stopped");
          return runId;
        }
        stopRemaining(i);
        finish("error", `Step "${step.label}" failed`);
        return runId;
      }
    }

    finish("done", "Pipeline finished");
    return runId;
  } finally {
    activeRuns.delete(wf.id);
    useUiStore.getState().setBusy(false);
  }
}
