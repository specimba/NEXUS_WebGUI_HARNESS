"use client";

// ─── Shared workflow run engine (used by the run panel AND the scheduler) ────

import { toast } from "sonner";
import { isAbortError, runAgentChat } from "@/lib/chat-client";
import { resolveExplicitLlm, resolveLlm } from "@/lib/llm-config";
import { decide, SYSTEMONE_GATE_CONFIDENCE } from "@/lib/systemone";
import { buildRelayChain, buildRelayWire, providerInCooldown, type RelayTaskFit } from "@/lib/relay";
import { recordFromStatusLine } from "@/lib/relay-events";
import { composeTaskFit, harnessById } from "@/lib/harness";
import {
  buildConversationalContext,
  buildLessonsBlock,
  buildReviewContext,
  buildSequentialContext,
  parseReviewVerdict,
  truncate,
  uid,
  type PrevStepOutput,
} from "@/lib/helpers";
import {
  useAgentsStore,
  useSettingsStore,
  useUiStore,
  useWorkflowsStore,
} from "@/lib/stores";
import { REWORK_LIMIT, LESSON_MAX_CHARS, MAX_LESSONS } from "@/lib/constants";
import { buildSkillsBlock } from "@/lib/skills";
import { mcpRunParams, mcpOfferedTools } from "@/lib/mcp";
import { scheduleDream } from "@/lib/dream";
import {
  pickVariantForRun,
  recordVariantOutcome,
  scheduleEvolution,
} from "@/lib/prompt-evolution";
import type {
  Agent,
  LlmCallTrace,
  PipelineDepth,
  RunCallLogEntry,
  RunErrorInfo,
  RunErrorKind,
  RunLesson,
  Settings,
  ToolCallInfo,
  ToolId,
  Workflow,
  WorkflowRun,
  WorkflowRunStep,
} from "@/lib/types";

/** Workflows with a run currently streaming — guards concurrent triggers. */
const activeRuns = new Set<string>();

/**
 * r40 tool-def audit receipt: exactly what the model was offered — the run's
 * built-in tool ids (step union) + every MCP def name (offer order), plus how
 * many MCP tools the per-run cap dropped. Empty pick when there is nothing to
 * record (pre-MCP runs without tools stay clean).
 */
function toolReceipt(
  steps: Pick<WorkflowRunStep, "tools">[],
  settings: Settings
): Pick<WorkflowRun, "toolsOffered" | "mcpToolsDropped"> {
  const builtIns = Array.from(new Set(steps.flatMap((s) => s.tools ?? [])));
  const mcp = mcpOfferedTools(settings);
  if (builtIns.length === 0 && mcp.names.length === 0) return {};
  return {
    toolsOffered: [...builtIns, ...mcp.names],
    ...(mcp.dropped > 0 ? { mcpToolsDropped: mcp.dropped } : {}),
  };
}

export function isWorkflowRunning(workflowId: string): boolean {
  return activeRuns.has(workflowId);
}

export function activeRunCount(): number {
  return activeRuns.size;
}

export interface ExecuteRunOptions {
  workflow: Pick<Workflow, "id">;
  task: string;
  /** "scheduled" runs toast with a clock icon; "suite" runs stay silent (the Suites board reports). */
  source?: "manual" | "scheduled" | "suite";
  /** Suite provenance (harness rank-①) — tags the run row for the Suites board. */
  suiteMeta?: { suiteId: string; caseId: string; runTag: string };
  /**
   * r36 A/B lab: explicit harness id that WINS over the workflow's own
   * selection and the global one (precedence: override > workflow > global).
   * Used by the suite runner so one case can be replayed under each preset.
   */
  harnessOverride?: string;
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
  /**
   * r35 branch-from-step-k: clone a finished run as a NEW row — steps before
   * the branch point keep their outputs verbatim, the original row stays
   * untouched (compare + history integrity). Mutually exclusive with `resume`.
   */
  branch?: { fromRunId: string; fromStepIndex: number };
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
  credits: {
    label: "Out of credits",
    hint:
      "This lane's provider account has no credits left (HTTP 402). The relay now skips the whole provider for 5 minutes and the automatic retry lands on another lane — or top up at the provider's console and retry the failed step.",
  },
  unknown: {
    label: "Unknown",
    hint: "The provider returned an error we couldn't classify. Copy the diagnostics below for details — retrying the failed step is still safe.",
  },
};

const ERROR_PATTERNS: { kind: RunErrorKind; re: RegExp }[] = [
  // r43 BEFORE everything: a 402 body can embed other status words (request
  // ids contain "402"-like digit runs are boundary-safe, but "quota" may
  // co-appear with credit-gate text) — credits is the truest kind.
  { kind: "credits", re: /\b402\b|out of credits|insufficient (?:credits?|funds|balance)|credit.{0,16}(?:exhausted|balance)/i },
  { kind: "rate-limit", re: /\b429\b|rate.?limit|quota|too many requests/i },
  {
    // BEFORE auth: a 403 with block-page signatures is a location block, not
    // a key problem — "Access forbidden (check key/region)" alone stays auth.
    kind: "region",
    re: /blocked this network|region\/?IP block|datacenter|server-region|\b451\b/i,
  },
  { kind: "auth", re: /\b(401|403)\b|unauthorized|invalid.{0,12}(api )?key|invalid.?key|forbidden|permission denied/i },
  { kind: "model", re: /\b404\b|no such model|model.?not.?found|model (.{0,40} )?does not exist|model_not_found|endpoint not found|decommissioned|does not exist or is not supported/i },
  { kind: "timeout", re: /timeout|timed? ?out|etimedout|deadline/i },
  {
    kind: "network",
    re: /network|fetch failed|failed to fetch|could not reach|socket|econn|enotfound|eai_again|dns|connection (refused|reset|closed|error)|load failed|premature close|stream ended without|upstream|http 5\d\d|bad gateway|service unavailable/i,
  },
];

/** Failure kinds the runner heals by itself (one automatic step retry). */
const SELF_HEAL_KINDS: RunErrorKind[] = ["network", "timeout", "rate-limit", "credits"];

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

// ─── Pipeline depth (r26): synthetic passes injected at materialization ──────

const DEEP_RESEARCH_INSTRUCTION =
  "This is a DEEP-RESEARCH pass. Search for information that previous passes did not cover: " +
  "different sources, missing numbers, contradicting viewpoints, primary sources. Verify the " +
  "key claims you see in the conversation context and correct them.";

const VERIFICATION_INSTRUCTION =
  "VERIFICATION PASS (final pipeline step — your reply IS the deliverable): silently check the " +
  "conversation context for unsupported claims, missing citations, and gaps. Use the tools " +
  "available (web_search / arxiv_search) to verify load-bearing facts where needed. Then output " +
  "the FULL corrected, tightened version of the previous step's output — never a plan, never an " +
  "announcement of what you are about to do, never a summary of changes alone. If you called " +
  "tools, continue after their results and still deliver the complete final output in this same " +
  "reply. End with a one-line 'Verification:' note listing what you checked.";

const DEEP_PASSES: { n: 2 | 3; label: string }[] = [
  { n: 2, label: "Deep research pass 2 — verify & broaden" },
  { n: 3, label: "Deep research pass 3 — cross-check sources" },
];

/**
 * Fresh-run step materialization with depth control (r26).
 * - quick:    exactly as authored (no injection)
 * - standard: + one synthetic "Verification & synthesis" pass at the end when
 *             the pipeline has NO review-gate step (a real review gate already
 *             provides verification semantics)
 * - deep:     + 2 deep-research passes cloned from the FIRST step's agent
 *             (inserted right after it), then the same verification pass
 *             Missing depth reads as "standard" (pre-r26 workflows keep working).
 *
 * Resume is deliberately NOT routed through here: resumed runs re-use their
 * already-materialized step rows, so old runs stay byte-identical.
 */
export function materializeRunSteps(wf: Workflow, agentsNow: Agent[]): WorkflowRunStep[] {
  const base: WorkflowRunStep[] = wf.steps.map((s) => {
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

  const depth: PipelineDepth = wf.depth ?? "standard";
  if (depth === "quick" || base.length === 0) return base;

  let steps = base;

  // Deep: clone the FIRST step's agent into 2 extra research passes.
  if (depth === "deep") {
    const first = steps[0];
    const firstAgent = agentsNow.find((a) => a.id === first.agentId);
    // arXiv fits research — grant the merged tool set only when the base agent
    // already has any tools (an agent authored without tools stays tool-free).
    const baseTools = firstAgent?.tools ?? [];
    const passTools: ToolId[] | undefined =
      baseTools.length > 0
        ? Array.from(new Set<ToolId>([...baseTools, "web_search", "arxiv_search"]))
        : undefined;
    const passes: WorkflowRunStep[] = DEEP_PASSES.map(({ label }) => ({
      stepId: uid("deep"),
      agentId: first.agentId,
      agentName: firstAgent?.name ?? first.agentName,
      agentEmoji: firstAgent?.emoji ?? first.agentEmoji,
      label,
      output: "",
      toolCalls: [],
      status: "running" as const,
      kind: "generate" as const,
      instruction: DEEP_RESEARCH_INSTRUCTION,
      ...(passTools ? { tools: passTools } : {}),
    }));
    steps = [first, ...passes, ...steps.slice(1)];
  }

  // Standard + deep: synthetic verification pass when no review gate exists.
  const hasReviewSemantics = steps.some((s) => s.kind === "review");
  if (!hasReviewSemantics) {
    const last = steps[steps.length - 1];
    const lastAgent = agentsNow.find((a) => a.id === last.agentId);
    steps = [
      ...steps,
      {
        stepId: uid("verify"),
        agentId: last.agentId,
        agentName: lastAgent?.name ?? last.agentName,
        agentEmoji: lastAgent?.emoji ?? last.agentEmoji,
        label: "Verification & synthesis",
        output: "",
        toolCalls: [],
        status: "running" as const,
        kind: "generate" as const,
        instruction: VERIFICATION_INSTRUCTION,
      },
    ];
  }
  return steps;
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
  } else if (options.branch) {
    // ─── r35 branch-from-step-k: the original row is NEVER touched ─────────
    const source = wf.runs.find((r) => r.id === options.branch!.fromRunId);
    if (!source || source.status === "running") return null;
    startIndex = Math.min(
      Math.max(0, options.branch.fromStepIndex),
      source.steps.length - 1
    );
    steps = source.steps.map((s, i) =>
      i >= startIndex
        ? { ...s, output: "", toolCalls: [], status: "running" as const, ms: undefined, verdict: undefined, reworked: undefined }
        : { ...s, status: "done" as const }
    );
    runId = uid("run");
    task = source.task;
    store.addRun(wf.id, {
      id: runId,
      workflowId: wf.id,
      workflowName: wf.name,
      task,
      status: "running",
      startedAt: Date.now(),
      steps,
      schemaVersion: 2,
      branchOf: { runId: source.id, fromStepIndex: startIndex },
      harness: options.harnessOverride ?? wf.harness ?? settings.settings.activeHarness,
      ...toolReceipt(steps, settings.settings),
    });
  } else {
    if (options.task.trim() === "") return null;
    runId = uid("run");
    task = options.task.trim();
    // r26 depth control: quick = as authored · standard = + verification pass ·
    // deep = + 2 research passes + verification. Resume (above) is untouched.
    steps = materializeRunSteps(wf, agentsNow);
    store.addRun(wf.id, {
      id: runId,
      workflowId: wf.id,
      workflowName: wf.name,
      task,
      status: "running",
      startedAt: Date.now(),
      steps,
      // Harness rank-①: version the trace shape so the suite/diagnostics can
      // evolve without silently breaking pre-r31 runs (absent = v1).
      schemaVersion: 2,
      ...(options.suiteMeta
        ? { suiteCaseId: options.suiteMeta.caseId, suiteRunId: options.suiteMeta.runTag }
        : {}),
      // r36: record the harness that actually drives this run (override wins).
      harness: options.harnessOverride ?? wf.harness ?? settings.settings.activeHarness,
      // r40: tool-def audit receipt — what the model was offered, honestly.
      ...toolReceipt(steps, settings.settings),
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

  /**
   * Reflexion lessons (harness rank-3): write a short verbal lesson into the
   * workflow's living memory. Failed episodes stop being wasted — the block
   * is injected into the next run's / resume's first-step context. Budgeted
   * (MAX_LESSONS × LESSON_MAX_CHARS) and user-editable in the editor.
   */
  const writeLesson = (lesson: Omit<RunLesson, "at">) => {
    try {
      const live = useWorkflowsStore.getState().workflows.find((w) => w.id === wf.id);
      if (!live) return;
      const lessons = [...(live.lessons ?? []), { ...lesson, at: Date.now() }].slice(-MAX_LESSONS);
      useWorkflowsStore.getState().update(wf.id, { lessons });
    } catch {
      /* lessons must never break a run */
    }
  };


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

  // r35 prompt evolution: which variant ran each step index (outcome +
  // rework attribution). Indexed parallel to `steps`; set at generate start.
  const variantIds: (string | undefined)[] = new Array(steps.length);

  const finish = (
    status: WorkflowRun["status"],
    toastMsg: string,
    errorInfo?: RunErrorInfo
  ) => {
    patchRun({ status, finishedAt: Date.now(), ...(errorInfo ? { error: errorInfo } : status === "done" ? { error: undefined } : {}) });
    if (source === "scheduled") {
      // r29 scheduled-run autonomy (Temporal/Circuit-Breaker doctrine):
      // failures feed a consecutive-fail streak — 1-2 re-arm SOONER than the
      // full interval (10m/30m quick retries); 3 trips the breaker and
      // auto-pauses the schedule so a broken pipeline stops burning slots.
      // Success resets the streak. A half-open probe = the user re-enabling.
      const live = useWorkflowsStore.getState().workflows.find((w) => w.id === wf.id);
      const sched = live?.schedule;
      if (sched && (status === "done" || status === "error")) {
        if (status === "done" && sched.failStreak) {
          useWorkflowsStore.getState().update(wf.id, { schedule: { ...sched, failStreak: 0 } });
        } else if (status === "error" && sched.enabled) {
          const streak = (sched.failStreak ?? 0) + 1;
          if (streak >= 3) {
            useWorkflowsStore.getState().update(wf.id, { schedule: { ...sched, failStreak: streak, enabled: false } });
            toast.warning("Schedule auto-paused after 3 consecutive failures", {
              icon: "🛑",
              description: `${wf.name} — the pipeline keeps failing at "${errorInfo?.stepLabel ?? "a step"}". Fix it, then re-enable the schedule.`,
            });
          } else {
            const retryIn = Math.min(Math.max(60_000, sched.intervalMs), streak === 1 ? 10 * 60_000 : 30 * 60_000);
            useWorkflowsStore.getState().update(wf.id, { schedule: { ...sched, failStreak: streak, nextRunAt: Date.now() + retryIn } });
          }
        }
      }
      if (status === "done") toast.success("Scheduled run finished", { icon: "⏰", description: `${wf.name} · ${steps.length} steps` });
      else if (status === "error") {
        const sched2 = useWorkflowsStore.getState().workflows.find((w) => w.id === wf.id)?.schedule;
        const retryNote = sched2?.enabled && sched2.failStreak && sched2.failStreak < 3
          ? ` — auto-retry ${sched2.failStreak === 1 ? "in ~10m" : "in ~30m"}`
          : "";
        toast.error("Scheduled run failed", { icon: "⏰", description: errorInfo ? `${errorInfo.stepLabel} · ${ERROR_KIND_META[errorInfo.kind].label.toLowerCase()}${retryNote} — open the run to recover` : wf.name });
      }
    } else {
      // Suite runs stay silent — the Suites board reports aggregate results.
      if (source !== "suite") {
        if (status === "done") toast.success(toastMsg);
        else if (status === "error" && errorInfo) {
          // Non-silent failure: tell the user WHERE to recover, not just that it broke.
          toast.error(`Run failed at "${errorInfo.stepLabel}"`, {
            icon: "🛟",
            description: `${ERROR_KIND_META[errorInfo.kind].label} issue · ${errorInfo.stepsDone}/${steps.length} steps done — recovery options are in the run panel.`,
          });
        }
      }
    }
    onSettled?.(runId, status);
    // r33 dreaming-lite: real activity just landed — re-arm the idle
    // consolidation check (fire-time re-verifies due-ness + running guards).
    // r34 harness knob: the “fast” harness opts the pipeline out of dream
    // overhead entirely (latency-critical turns never pay for consolidation).
    if (harnessById(options.harnessOverride ?? wf.harness ?? settings.settings.activeHarness).knobs.dreamEligible) {
      scheduleDream(wf.id, { silent: source === "suite" });
    }
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
    // Reflexion (rank-3): a failed episode becomes a verbal lesson for the
    // next attempt — failure kind + what happened + the recovery hint.
    const firstSentence = (info.hint.split(". ")[0] ?? info.hint).trim();
    writeLesson({
      text: truncate(
        `${info.stepLabel} failed (${ERROR_KIND_META[kind].label.toLowerCase()}): ${truncate(info.message, 140)} → Try: ${firstSentence}.`,
        LESSON_MAX_CHARS
      ),
      runId,
      kind,
    });
    // r35 prompt evolution: the failing variant takes the loss and (unless the
    // step died for non-prompt reasons like a deleted agent) feeds one
    // mutation pass — scheduled, rate-limited, never blocking the run UI.
    const failedVariantId = variantIds[failedIndex];
    recordVariantOutcome(wf.id, step.stepId, failedVariantId, "fail");
    if (!/was deleted/.test(err.message)) {
      scheduleEvolution(wf.id, step.stepId, err.message, { silent: source === "suite" });
    }
    stopRemaining(failedIndex);
    finish("error", `Step "${step.label}" failed`, info);
  };

  // r34 harness selection: explicit override (suite A/B lab) wins, then the
  // per-workflow editor Select, then the global active harness. One object
  // retunes relay ordering, tool budget, stall resilience, lessons injection
  // and dreams for EVERY step of this run.
  const harness = harnessById(options.harnessOverride ?? wf.harness ?? settings.settings.activeHarness);

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
    context: string,
    opts?: { reasoningEffort?: WorkflowRunStep["reasoningEffort"] }
  ): Promise<{ content: string; ms: number }> => {
    const agent = useAgentsStore.getState().agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Agent for step "${runStep.label}" not found`);
    const stepStart = Date.now();
    let draft = "";
    let localToolCalls: ToolCallInfo[] = [];
    // Harness rank-② second slice: per-iteration trace from the engine's
    // existing `iteration` events — honest about what the runner can see.
    const llmTrace: LlmCallTrace[] = [];
    // r48: agents are resolved like composer overrides — a '::'-carrying
    // model is an absolute lane (resolveExplicitLlm) instead of being sent
    // verbatim to the active provider; bare ids ride the active provider
    // exactly as before.
    const llm = resolveExplicitLlm(settings.settings, agent.model);
    // Synthetic deep-research passes carry a merged tool set (base tools +
    // web_search + arxiv_search) materialized on the run step itself.
    const effectiveTools: ToolId[] = runStep.tools ?? agent.tools ?? [];
    // Task fit (Genius-rotator doctrine): research steps with search tools
    // prefer fast models first (many quick tool rounds); review/writing steps
    // prefer flagships first (one excellent pass matters most). r34: a
    // specialized harness overrides the step-derived fit; a neutral harness
    // defers to it.
    const stepFit: RelayTaskFit =
      runStep.kind === "review"
        ? "quality"
        : effectiveTools.some((t) => t === "web_search" || t === "read_url" || t === "arxiv_search")
          ? "research"
          : "any";
    const taskFit: RelayTaskFit = composeTaskFit(harness, stepFit);
    // Model Relay (Genius-rotator doctrine): when this step's brain fails
    // before streaming anything, the server rotates down the vault's fallback
    // chain instead of dying — the exact 7am-scheduled-run failure mode.
    let relayNotes: string[] = [];
    const MAX_STEP_ATTEMPTS = 2; // 1 real attempt + 1 automatic self-heal retry
    // r43 step-over: the primary lane is resolved ONCE (the agent's pin / the
    // active provider) — but the relay's health memory may already know it is
    // DEAD (402 credits are account-wide; the previous run recorded it). The
    // step then STARTS on the chain's top healthy lane from another provider
    // instead of burning a doomed call every step. And when attempt 1 dies
    // with a fresh hard error, the self-heal retry swaps the primary too —
    // making the r25 comment above finally true for the primary itself.
    let attemptLlm = llm;
    let steppedOver = false;
    if (settings.settings.relayEnabled !== false && providerInCooldown(llm.providerId)) {
      const candidate = buildRelayChain(settings.settings, {
        taskFit,
        freeFirst: harness.knobs.freeFirst,
      }).find(
        (h) => h.providerId !== llm.providerId && h.providerId !== "auto" && h.baseUrl && h.apiKey
      );
      if (candidate) {
        attemptLlm = {
          provider: "custom",
          apiKey: candidate.apiKey,
          baseUrl: candidate.baseUrl,
          model: candidate.model,
          label: candidate.label,
          providerId: candidate.providerId,
        };
        steppedOver = true;
      }
    }

    for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
      // Rebuild the relay wire PER ATTEMPT (r25): attempt 1's failures were
      // recorded into the rotator's health memory as they happened, so the
      // self-heal retry now starts on a DIFFERENT lane instead of re-dialing
      // the same dead primary — the actual "auto-retry hits the same dead
      // hop" fix.
      const relayHops = buildRelayWire(
        settings.settings,
        { providerId: attemptLlm.providerId, model: attemptLlm.model },
        { taskFit, freeFirst: harness.knobs.freeFirst }
      );
      try {
        draft = "";
        localToolCalls = [];
        relayNotes = [];
        llmTrace.length = 0;
        if (steppedOver) {
          relayNotes.push(
            `Model relay: primary ${llm.label} recently failed hard — starting on ${attemptLlm.label}`
          );
        }
        const res = await runAgentChat(
          {
            provider: attemptLlm.provider,
            apiKey: attemptLlm.apiKey,
            baseUrl: attemptLlm.baseUrl,
            model: attemptLlm.model,
            providerId: attemptLlm.providerId,
            temperature: agent.temperature,
            maxIterations: agent.maxIterations + harness.knobs.maxIterationsBonus,
            ...(harness.knobs.stallResumes !== 2 ? { stallResumes: harness.knobs.stallResumes } : {}),
            tools: effectiveTools,
            // r38 MCP: enabled MCP-server tools join this pipeline run.
            ...mcpRunParams(settings.settings),
            system,
            messages: [{ role: "user", content: context }],
            ...(relayHops.length > 0 ? { relay: relayHops } : {}),
            ...(opts?.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
            signal,
          },
          {
            onStatus: (m) => {
              // r49: the shared recorder feeds health memory + the failover
              // event log ([req:…] correlation ids) and returns clean prose.
              const clean = recordFromStatusLine(m, "browser");
              if (clean !== null && /Model relay:/i.test(m)) relayNotes.push(clean);
            },
            onIteration: (n) => {
              // Record at each loop boundary: iteration 1 carries the assembled
              // context length (the prompt the model actually saw).
              llmTrace.push({
                iter: n,
                msAt: Date.now() - stepStart,
                contentChars: draft.length,
                ...(n === 1 ? { promptChars: context.length } : {}),
              });
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
          // r29: budget-sentinel answers are marked degraded — the UI shows an
          // "auto-digest" chip and downstream steps can tell material is thin.
          degraded: /^_The model ended/.test(res.content) || undefined,
          // r31 harness rank-②: persist the per-iteration timeline (capped).
          ...(llmTrace.length > 0 ? { llmCalls: llmTrace.slice(-60) } : {}),
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
        // r25: the engine now ships a structured `kind` on server errors —
        // use it when present; the message-regex stays as the fallback for
        // browser-direct errors.
        const kind =
          ((err as { kind?: RunErrorKind }).kind ?? classifyRunError(message).kind);
        if (attempt < MAX_STEP_ATTEMPTS && SELF_HEAL_KINDS.includes(kind) && !signal.aborted) {
          // r43 credits step-over: 402 is account-wide — attempt 2 must not
          // re-dial the same provider. Swap the primary to the chain's top
          // healthy lane from a DIFFERENT provider (health-sorted, so the
          // already-failed provider's hops sink on their own too).
          // r49: capacity errors (429) step over the same way — re-dialing a
          // lane that JUST answered 429 is the exact dead-end the failover
          // state machine forbids. The funnel's cooldown already sank the
          // throttled provider's hops in the rebuilt chain.
          if (
            (kind === "credits" || kind === "rate-limit") &&
            settings.settings.relayEnabled !== false
          ) {
            const candidate = buildRelayChain(settings.settings, {
              taskFit,
              freeFirst: harness.knobs.freeFirst,
            }).find(
              (h) =>
                h.providerId !== llm.providerId &&
                h.providerId !== "auto" &&
                h.baseUrl &&
                h.apiKey
            );
            if (candidate) {
              attemptLlm = {
                provider: "custom",
                apiKey: candidate.apiKey,
                baseUrl: candidate.baseUrl,
                model: candidate.model,
                label: candidate.label,
                providerId: candidate.providerId,
              };
              steppedOver = true;
              toast.info(`"${runStep.label}" is switching providers`, {
                icon: "🔁",
                description:
                  kind === "credits"
                    ? `${llm.label} is out of credits — the retry lands on ${candidate.label}.`
                    : `${llm.label} is at capacity — the retry lands on ${candidate.label}.`,
              });
            }
          }
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
          // The iteration timeline UP TO the failure is exactly what the
          // logging triad is for — persist it on the failed step too.
          ...(llmTrace.length > 0 ? { llmCalls: llmTrace.slice(-60) } : {}),
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
            .map((s) => ({ label: s.label, agentName: s.agentName, output: s.output, degraded: s.degraded }))
        : [];
    const framework = settings.settings.framework;
    // Reflexion (rank-③): inject the workflow's lessons into the FIRST step
    // executed by this run — fresh runs learn from past failures, resumes
    // learn from the failure being resumed past. r34: the “fast” harness
    // skips lesson injection to keep the prompt lean.
    const lessonsBlock = harness.knobs.lessonsInject ? buildLessonsBlock(wf.lessons) : "";
    // r36 Skills (PraisonAI SKILL.md doctrine): enabled skills ride along in
    // the first step's context, same budget pattern as lessons. Always on —
    // the user curated them explicitly. r37: the run's task steers relevance
    // ranking, so the most on-topic skill wins the budget race.
    const skillsBlock = buildSkillsBlock(settings.settings.skills, task);

    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i];
      const def = wf.steps.find((s) => s.id === step.stepId);
      const kind = def?.kind ?? "generate";
      // Authored steps take their instruction from the definition; synthetic
      // depth passes (no def) carry their appended focus on the run row itself.
      // r35 prompt evolution: an authored GENERATE step with variants runs its
      // pinned/best-scoring variant instead of the raw authored text — the
      // run step is tagged with the variant id for outcome attribution.
      // Review gates keep their authored instruction (their verdicts drive
      // evolution of the step they audit, not of themselves).
      const variant =
        def && kind !== "review" ? pickVariantForRun(def) : null;
      if (variant) variantIds[i] = variant.id;
      const instruction = def
        ? variant?.instruction ?? def.instruction
        : step.instruction;
      const baseSystem = instruction
        ? `${useAgentsStore.getState().agents.find((a) => a.id === step.agentId)?.instructions ?? ""}\n\nFOCUS FOR THIS STEP: ${instruction}`
        : useAgentsStore.getState().agents.find((a) => a.id === step.agentId)?.instructions ?? "";
      // r35: mirror the definition's knobs onto the run row (chips + engine).
      if (variant || def?.reasoningEffort) {
        patchRunStep(step.stepId, {
          ...(variant ? { variantId: variant.id } : {}),
          ...(def?.reasoningEffort ? { reasoningEffort: def.reasoningEffort } : {}),
        });
      }

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
                degraded: /^_The model ended/.test(content) || undefined,
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
            // Reflexion (rank-③): the gate's feedback becomes a lesson too —
            // the next run should address these points up front.
            writeLesson({
              text: truncate(
                `Review gate sent "${reviewed.label}" back: ${truncate(feedback, 180)} — address reviewer feedback in the first attempt.`,
                LESSON_MAX_CHARS
              ),
              runId,
              kind: "rework",
            });
            // r35 prompt evolution: the reworked variant takes the rework
            // penalty and feeds one scheduled mutation pass from the verdict.
            recordVariantOutcome(wf.id, reviewed.stepId, variantIds[i - 1], "rework");
            scheduleEvolution(wf.id, reviewed.stepId, feedback, {
              silent: source === "suite",
            });
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
            // r35: rework regeneration mutates the SAME instruction that
            // produced the rejected output (variant or authored), so the
            // reviewer feedback lands on the prompt that needs fixing.
            // (variantIds[i-1] is unset when resuming INTO a review gate —
            // the persisted run row carries the original attribution.)
            const reviewedVariant = reviewedDef?.promptVariants?.find(
              (v) => v.id === (variantIds[i - 1] ?? reviewed.variantId)
            );
            const effReviewedInstruction =
              reviewedVariant?.instruction ?? reviewedDef?.instruction;
            const genBase = effReviewedInstruction
              ? `${genAgent.instructions}\n\nFOCUS FOR THIS STEP: ${effReviewedInstruction}`
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
              degraded: /^_The model ended/.test(gen.content) || undefined,
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
      const baseContext =
        framework === "sequential"
          ? buildSequentialContext(task, prev)
          : buildConversationalContext(task, prev);
      const firstStepBlocks = [
        i === startIndex ? skillsBlock : "",
        i === startIndex && lessonsBlock ? lessonsBlock : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const context = firstStepBlocks ? `${baseContext}\n\n${firstStepBlocks}` : baseContext;

      try {
        // ─── r27 SYSTEM-ONE GATE (Jev doctrine: not everything requires a
        // frontier model): a cheap calibrated judge decides whether the
        // flagship verification pass is even needed. A confident PASS skips
        // the extra frontier call entirely; FAIL, low confidence or "no
        // judge available" keeps the full pass — worst case = status quo.
        if (step.instruction === VERIFICATION_INSTRUCTION) {
          const draft = prev[prev.length - 1]?.output ?? "";
          const gate = await decide({
            settings: settings.settings,
            signal,
            state: `TASK:\n${task}\n\nDRAFT OUTPUT (the previous step's deliverable):\n${draft.slice(0, 6000)}`,
            question: {
              id: "verify-gate",
              type: "noul",
              prompt:
                "Is this draft a COMPLETE final deliverable for the task — on-topic, no placeholder text, no unanswered sub-questions, and no obviously unsupported load-bearing claims? Minor polish issues do not count against it.",
            },
          });
          if (gate && gate.answer === "yes" && gate.confidence >= SYSTEMONE_GATE_CONFIDENCE) {
            patchRunStep(step.stepId, {
              output: draft,
              toolCalls: [],
              status: "done",
              ms: gate.ms,
            });
            pushCall({
              stepId: step.stepId,
              stepLabel: step.label,
              agentName: agentRow.name,
              engine: gate.judge,
              model: gate.via,
              ms: gate.ms,
              ok: true,
              attempt: 1,
              note: `System-One gate PASS ${(gate.confidence * 100).toFixed(0)}% (${gate.via}) — flagship verification pass skipped`,
            });
            toast("System-One gate passed", {
              icon: "✓",
              description: `${(gate.confidence * 100).toFixed(0)}% confident via ${gate.via === "jev" ? "Jev" : "fast judge"} — verification pass skipped`,
            });
            prev.push({ label: step.label, agentName: agentRow.name, degraded: /^_The model ended/.test(draft) || undefined, output: draft });
            continue;
          }
          // FAIL / uncertain / no judge available → run the full verification pass.
        }
        const { content } = await streamStep(step, step.agentId, baseSystem, context, {
          reasoningEffort: def?.reasoningEffort,
        });
        // r35: a clean completion is a data point for the variant that ran.
        recordVariantOutcome(wf.id, step.stepId, variant?.id, "win");
        prev.push({ label: step.label, agentName: agentRow.name, degraded: /^_The model ended/.test(content) || undefined, output: content });
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
