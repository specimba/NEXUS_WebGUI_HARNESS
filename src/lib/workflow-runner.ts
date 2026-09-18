"use client";

// ─── Shared workflow run engine (used by the run panel AND the scheduler) ────

import { toast } from "sonner";
import { isAbortError, runAgentChat } from "@/lib/chat-client";
import { resolveLlm } from "@/lib/llm-config";
import { buildRelayWire, recordRelayHopResult, type RelayTaskFit } from "@/lib/relay";
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
  RunCallLogEntry,
  RunErrorInfo,
  RunErrorKind,
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
  /**
   * Resume an existing errored/stopped run instead of creating a new row:
   * completed step outputs are preserved, execution restarts at fromStepIndex.
   * When set, `task` is ignored (the run's original task is reused).
   */
  resume?: { runId: string; fromStepIndex: number };
}

// ─── Failure classification (powers the non-silent recovery card) ───────────

const ERROR_KIND_META: Record<RunErrorKind, { label: string; hint: string }> = {
  network: {
    label: "Network",
    hint: "The connection to the model provider dropped mid-run. This is usually transient — retrying the failed step keeps every completed step's output.",
  },
  region: {
    label: "Region block",
    hint: "The provider refuses datacenter IPs — this is a network-location block, NOT a key problem. Browser-direct mode (on by default) calls from your own network and avoids it; if you still see this, the relay already rotated to another lane — retry the step.",
  },
  auth: {
    label: "Auth",
    hint: "The API key was rejected (expired, revoked or wrong). Fix the key in Settings → Free frontier providers, then retry the failed step.",
  },
  "rate-limit": {
    label: "Rate limit",
    hint: "The provider's free-tier quota tripped (429). Wait a minute — or switch to another free provider in the header picker — then retry the failed step.",
  },
  timeout: {
    label: "Timeout",
    hint: "The provider took too long to answer. Retry usually helps; if it keeps happening, try a smaller/faster model for this step.",
  },
  model: {
    label: "Model",
    hint: "The model id no longer exists on this provider (renamed or decommissioned). Open Settings → the provider card → “Refresh models” to pull the current roster, pick a live model, then retry. The relay already skipped past it.",
  },
  unknown: {
    label: "Unknown",
    hint: "The provider returned an error we couldn't classify. Copy the diagnostics below for details — retrying the failed step is still safe.",
  },
};

const ERROR_PATTERNS: { kind: RunErrorKind; re: RegExp }[] = [
  { kind: "rate-limit", re: /\b429\b|rate.?limit|quota|too many requests/i },
  {
    // BEFORE auth: a 403 with block-page signatures is a location block, not
    // a key problem — "Access forbidden (check key/region)" alone stays auth.
    kind: "region",
    re: /blocked this network|region\/?IP block|datacenter|server-region|\b451\b/i,
  },
  { kind: "auth", re: /\b(401|403)\b|unauthorized|invalid.{0,12}(api )?key|invalid.?key|forbidden|permission denied/i },
  { kind: "model", re: /\b404\b|no such model|model.?not.?found|model (.{0,40} )?does not exist|not found|decommissioned|does not exist or is not supported/i },
  { kind: "timeout", re: /timeout|timed? ?out|etimedout|deadline/i },
  {
    kind: "network",
    re: /network|fetch failed|failed to fetch|could not reach|socket|econn|enotfound|eai_again|dns|connection (refused|reset|closed|error)|load failed|premature close|stream ended without|upstream|http 5\d\d|bad gateway|service unavailable/i,
  },
];

/** Failure kinds the runner heals by itself (one automatic step retry). */
const SELF_HEAL_KINDS: RunErrorKind[] = ["network", "timeout"];

/** Classify an engine error message → kind + copy used by the recovery card. */
export function classifyRunError(message: string): {
  kind: RunErrorKind;
  hint: string;
} {
  for (const { kind, re } of ERROR_PATTERNS) {
    if (re.test(message)) return { kind, hint: ERROR_KIND_META[kind].hint };
  }
  return { kind: "unknown", hint: ERROR_KIND_META.unknown.hint };
}

export function runErrorKindLabel(kind: RunErrorKind): string {
  return ERROR_KIND_META[kind].label;
}

/**
 * Run a workflow pipeline end-to-end: creates the run row in the store,
 * streams each step through the agent chain, patches statuses live.
 * Steps marked kind:"review" act as quality gates — they audit the previous
 * step's output and may send it back for a rework pass (up to REWORK_LIMIT).
 * With `options.resume` it continues an existing errored/stopped run from a
 * step index, preserving every completed step's output (non-destructive).
 * Returns the run id, or null when the run could not start.
 */
export async function executeWorkflowRun(
  options: ExecuteRunOptions
): Promise<string | null> {
  const { source = "manual", onStarted, onSettled } = options;
  const wf = useWorkflowsStore
    .getState()
    .workflows.find((w) => w.id === options.workflow.id);
  if (!wf || wf.steps.length === 0) return null;
  if (activeRuns.has(wf.id)) return null;

  const store = useWorkflowsStore.getState();
  const settings = useSettingsStore.getState();
  const agentsNow = useAgentsStore.getState().agents;

  // ─── Fresh run vs resume of an existing errored/stopped row ─────────────
  let runId: string;
  let task: string;
  let steps: WorkflowRunStep[];
  let startIndex = 0;
  let attempts = 0;

  if (options.resume) {
    const run = wf.runs.find((r) => r.id === options.resume!.runId);
    if (!run || run.status === "running") return null;
    runId = run.id;
    task = run.task;
    attempts = run.error?.attempts ?? 0;
    startIndex = Math.min(
      Math.max(0, options.resume.fromStepIndex),
      run.steps.length - 1
    );
    steps = run.steps.map((s, i) =>
      i >= startIndex
        ? { ...s, output: "", toolCalls: [], status: "running" as const, ms: undefined, verdict: undefined, reworked: undefined }
        : s
    );
    store.patchRun(wf.id, runId, {
      status: "running",
      finishedAt: undefined,
      error: undefined,
      steps,
      resumeCount: (run.resumeCount ?? 0) + 1,
    });
  } else {
    if (options.task.trim() === "") return null;
    runId = uid("run");
    task = options.task.trim();
    steps = wf.steps.map((s) => {
      const agent = agentsNow.find((a) => a.id === s.agentId);
      return {
        stepId: s.id,
        agentId: s.agentId,
        agentName: agent?.name ?? "Unknown agent",
        agentEmoji: agent?.emoji ?? "🤖",
        label: s.label || "Untitled step",
        output: "",
        toolCalls: [],
        status: "running" as const,
        kind: s.kind ?? "generate",
      };
    });
    store.addRun(wf.id, {
      id: runId,
      workflowId: wf.id,
      workflowName: wf.name,
      task,
      status: "running",
      startedAt: Date.now(),
      steps,
    });
  }

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

  /** Append one LLM-call record to the run's call log (harness rank-② slice). */
  const pushCall = (entry: Omit<RunCallLogEntry, "at">) => {
    try {
      const run = useWorkflowsStore
        .getState()
        .workflows.find((w) => w.id === wf.id)
        ?.runs.find((r) => r.id === runId);
      const log = [...(run?.callLog ?? []), { at: Date.now(), ...entry } as RunCallLogEntry].slice(-60);
      patchRun({ callLog: log });
    } catch {
      /* logging must never break a run */
    }
  };

  const stopRemaining = (fromIndex: number) => {
    for (let j = fromIndex + 1; j < steps.length; j++) {
      patchRunStep(steps[j].stepId, { status: "stopped", output: "" });
    }
  };

  const finish = (
    status: WorkflowRun["status"],
    toastMsg: string,
    errorInfo?: RunErrorInfo
  ) => {
    patchRun({ status, finishedAt: Date.now(), ...(errorInfo ? { error: errorInfo } : status === "done" ? { error: undefined } : {}) });
    if (source === "scheduled") {
      if (status === "done") toast.success("Scheduled run finished", { icon: "⏰", description: `${wf.name} · ${steps.length} steps` });
      else if (status === "error") toast.error("Scheduled run failed", { icon: "⏰", description: errorInfo ? `${errorInfo.stepLabel} · ${ERROR_KIND_META[errorInfo.kind].label.toLowerCase()} — open the run to recover` : wf.name });
    } else {
      if (status === "done") toast.success(toastMsg);
      else if (status === "error" && errorInfo) {
        // Non-silent failure: tell the user WHERE to recover, not just that it broke.
        toast.error(`Run failed at "${errorInfo.stepLabel}"`, {
          icon: "🛟",
          description: `${ERROR_KIND_META[errorInfo.kind].label} issue · ${errorInfo.stepsDone}/${steps.length} steps done — recovery options are in the run panel.`,
        });
      }
    }
    onSettled?.(runId, status);
  };

  /** Build the full RunErrorInfo for a failed step and finish the run. */
  const failRun = (fallbackIndex: number, err: Error) => {
    const meta = err as Error & { stepId?: string; toolCallsOk?: number; autoRetried?: boolean };
    const found = steps.findIndex((s) => s.stepId === meta.stepId);
    const failedIndex = found === -1 ? fallbackIndex : found;
    const step = steps[failedIndex] ?? steps[fallbackIndex];
    const { kind, hint } = classifyRunError(err.message);
    const llm = resolveLlm(settings.settings);
    const info: RunErrorInfo = {
      stepIndex: failedIndex,
      stepId: step.stepId,
      stepLabel: step.label,
      agentName: step.agentName,
      message: err.message,
      kind,
      hint,
      toolCallsOk: meta.toolCallsOk ?? 0,
      stepsDone: steps.slice(0, failedIndex).filter((s) => s.status === "done").length,
      llmLabel: llm.label,
      attempts: attempts + 1,
      autoRetried: meta.autoRetried === true || undefined,
    };
    stopRemaining(failedIndex);
    finish("error", `Step "${step.label}" failed`, info);
  };

  /**
   * Stream one agent call for a run step; returns the final content + duration.
   * Self-healing (r19): a transient engine failure (network drop / timeout —
   * e.g. a gateway 502 after several tool calls) is retried ONCE automatically
   * with a clean slate so scheduled runs survive upstream hiccups instead of
   * dying at 7am. Every attempt is recorded in the run's call log.
   */
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
    let localToolCalls: ToolCallInfo[] = [];
    const llm = resolveLlm(settings.settings, agent.model);
    // Task fit (Genius-rotator doctrine): research steps with search tools
    // prefer fast models first (many quick tool rounds); review/writing steps
    // prefer flagships first (one excellent pass matters most).
    const taskFit: RelayTaskFit =
      runStep.kind === "review"
        ? "quality"
        : (agent.tools ?? []).some((t) => t === "web_search" || t === "read_url")
          ? "research"
          : "any";
    // Model Relay (Genius-rotator doctrine): when this step's brain fails
    // before streaming anything, the server rotates down the vault's fallback
    // chain instead of dying — the exact 7am-scheduled-run failure mode.
    const relayHops = buildRelayWire(
      settings.settings,
      { providerId: llm.providerId, model: llm.model },
      { taskFit }
    );
    let relayNotes: string[] = [];
    const MAX_STEP_ATTEMPTS = 2; // 1 real attempt + 1 automatic self-heal retry

    for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
      try {
        draft = "";
        localToolCalls = [];
        relayNotes = [];
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
            ...(relayHops.length > 0 ? { relay: relayHops } : {}),
            signal,
          },
          {
            onStatus: (m) => {
              if (/Model relay:/i.test(m)) {
                relayNotes.push(m);
                // Feed the rotator's health memory: [hop:x] = x failed,
                // [hopok:x] = x answered after a rotation.
                const failHop = /\[hop:([^\]]+)\]/.exec(m);
                if (failHop) recordRelayHopResult(failHop[1], false, m.replace(/\s*\[hop:[^\]]+\]\s*$/, ""));
                const okHop = /\[hopok:([^\]]+)\]/.exec(m);
                if (okHop) recordRelayHopResult(okHop[1], true);
              }
            },
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
        pushCall({
          stepId: runStep.stepId,
          stepLabel: runStep.label,
          agentName: agent.name,
          engine: llm.label,
          model: llm.model,
          ms: Date.now() - stepStart,
          ok: true,
          attempt,
          ...(relayNotes.length > 0 || res.transport === "browser-direct"
            ? { note: [...(res.transport === "browser-direct" ? ["browser-direct — key stayed in your browser"] : []), ...relayNotes].join(" → ") }
            : {}),
        });
        patchRunStep(runStep.stepId, {
          output: res.content,
          toolCalls: res.toolCalls.length > 0 ? res.toolCalls : localToolCalls,
          status: "done",
          ms: Date.now() - stepStart,
        });
        return { content: res.content, ms: Date.now() - stepStart };
      } catch (err) {
        if (isAbortError(err)) {
          pushCall({
            stepId: runStep.stepId,
            stepLabel: runStep.label,
            agentName: agent.name,
            engine: llm.label,
            model: llm.model,
            ms: Date.now() - stepStart,
            ok: false,
            error: "aborted by user",
            attempt,
          });
          patchRunStep(runStep.stepId, {
            status: "stopped",
            output: draft || "(stopped)",
          });
          throw err;
        }
        const message = (err as Error).message ?? "unknown error";
        pushCall({
          stepId: runStep.stepId,
          stepLabel: runStep.label,
          agentName: agent.name,
          engine: llm.label,
          model: llm.model,
          ms: Date.now() - stepStart,
          ok: false,
          error: message,
          attempt,
          ...(relayNotes.length > 0 ? { note: relayNotes.join(" → ") } : {}),
        });
        // ─── Self-heal: one clean retry for transient engine failures ──────
        const kind = classifyRunError(message).kind;
        if (attempt < MAX_STEP_ATTEMPTS && SELF_HEAL_KINDS.includes(kind) && !signal.aborted) {
          toast.info(`"${runStep.label}" hit a ${kind} hiccup — retrying once automatically…`, {
            icon: "🛟",
            description: "The engine dropped the call mid-step. Tool results already gathered are re-run safely.",
          });
          patchRunStep(runStep.stepId, { status: "running", output: "", toolCalls: [] });
          continue;
        }
        // Attach recovery metadata so failRun can attribute the failure precisely.
        const meta = err as Error & { stepId?: string; toolCallsOk?: number; autoRetried?: boolean };
        meta.stepId = runStep.stepId;
        meta.toolCallsOk = localToolCalls.filter((tc) => tc.ok === true).length;
        meta.autoRetried = attempt > 1;
        patchRunStep(runStep.stepId, {
          status: "error",
          output: `${draft ? `${draft}\n\n` : ""}**Error:** ${message}`,
        });
        throw err;
      }
    }
    // Unreachable (loop either returns or throws) — kept for the type checker.
    throw new Error(`Step "${runStep.label}" exhausted its attempts.`);
  };

  try {
    // Resume: rebuild the conversation context from every completed step
    // before the resume point — nothing the user already paid for is lost.
    const prev: PrevStepOutput[] =
      startIndex > 0
        ? steps
            .slice(0, startIndex)
            .filter((s) => s.status === "done" && s.output.trim() !== "")
            .map((s) => ({ label: s.label, agentName: s.agentName, output: s.output }))
        : [];
    const framework = settings.settings.framework;

    for (let i = startIndex; i < steps.length; i++) {
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
        failRun(i, new Error(`Agent "${step.agentName}" was deleted — re-add it to this workflow, then resume.`));
        return runId;
      }

      // ─── Review gate: audit the previous step, may force one rework pass ───
      if (kind === "review" && i > 0) {
        const reviewed = steps[i - 1];
        const context = buildReviewContext(
          task,
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
              failRun(i, new Error(`Agent "${reviewed.agentName}" was deleted — re-add it to this workflow, then resume.`));
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
                ? buildSequentialContext(task, prev)
                : buildConversationalContext(task, prev);

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
            failRun(i, err as Error);
            return runId;
          }
        }
        continue;
      }

      // ─── Regular generate step ────────────────────────────────────────────
      const context =
        framework === "sequential"
          ? buildSequentialContext(task, prev)
          : buildConversationalContext(task, prev);

      try {
        const { content } = await streamStep(step, step.agentId, baseSystem, context);
        prev.push({ label: step.label, agentName: agentRow.name, output: content });
      } catch (err) {
        if (isAbortError(err)) {
          stopRemaining(i);
          finish("stopped", "Pipeline stopped");
          return runId;
        }
        failRun(i, err as Error);
        return runId;
      }
    }

    finish("done", startIndex > 0 ? "Pipeline resumed & finished" : "Pipeline finished");
    return runId;
  } finally {
    activeRuns.delete(wf.id);
    useUiStore.getState().setBusy(false);
  }
}
