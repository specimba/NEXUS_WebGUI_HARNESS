"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Ban,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  GitCompareArrows,
  KeyRound,
  LifeBuoy,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  downloadText,
  fmtIn,
  fmtIntervalShort,
  fmtMs,
  fmtRel,
  runDiagnostics,
  runToMarkdown,
  slugify,
} from "@/lib/helpers";
import {
  useAgentsStore,
  useSettingsStore,
  useUiStore,
  useWorkflowsStore,
} from "@/lib/stores";
import { executeWorkflowRun, runErrorKindLabel } from "@/lib/workflow-runner";
import { SCHEDULE_INTERVALS } from "@/lib/constants";
import type { Workflow, WorkflowRunStep } from "@/lib/types";
import { TOOL_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AgentAvatar, DepthChip } from "@/components/praison/atoms";
import { MarkdownRenderer } from "@/components/praison/markdown";
import { WorkflowCompareDialog } from "@/components/praison/workflows/workflow-compare-dialog";
import type {
  RunErrorKind,
  ToolCallInfo,
  ToolId,
  WorkflowRun,
} from "@/lib/types";

// ─── Pipeline run panel: task → live streaming step cards → run history ─────

const STEP_BORDER: Record<WorkflowRunStep["status"], string> = {
  running: "border-l-violet-500",
  done: "border-l-emerald-500",
  error: "border-l-red-500",
  stopped: "border-l-amber-500",
};

function StatusIndicator({ status, ms }: { status: WorkflowRunStep["status"]; ms?: number }) {
  if (status === "running") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-violet-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Running…
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-500">
        <Check className="h-3.5 w-3.5" aria-hidden />
        {fmtMs(ms)}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-red-500">
        <X className="h-3.5 w-3.5" aria-hidden />
        Failed
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-amber-500">
      <Ban className="h-3.5 w-3.5" aria-hidden />
      Stopped
    </span>
  );
}

function ToolCallChips({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  if (toolCalls.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {toolCalls.map((tc) => {
        const meta = TOOL_META[tc.name as ToolId];
        return (
          <span
            key={tc.id}
            title={tc.result ? `${tc.name} → ${tc.result.slice(0, 200)}` : tc.args}
            className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            <span aria-hidden>{meta?.emoji ?? "🛠️"}</span>
            <span className="truncate">{meta?.label ?? tc.name}</span>
            {tc.ok === true ? (
              <Check className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
            ) : tc.ok === false ? (
              <X className="h-3 w-3 shrink-0 text-red-500" aria-hidden />
            ) : (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-violet-400" aria-hidden />
            )}
            {tc.ms != null ? (
              <span className="shrink-0 tabular-nums">{fmtMs(tc.ms)}</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

// ─── Recovery card: non-silent failure fallback with user options ───────────

const ERROR_KIND_BADGE: Record<RunErrorKind, string> = {
  network: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  region: "border-orange-500/40 bg-orange-500/10 text-orange-500",
  auth: "border-red-500/40 bg-red-500/10 text-red-500",
  "rate-limit": "border-amber-500/40 bg-amber-500/10 text-amber-500",
  timeout: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  model: "border-rose-500/40 bg-rose-500/10 text-rose-500",
  unknown: "border-border bg-muted text-muted-foreground",
};

function RunRecoveryCard({
  run,
  workflow,
  busy,
  onResume,
  onRestart,
}: {
  run: WorkflowRun;
  workflow: Workflow;
  busy: boolean;
  onResume: (fromStepIndex: number) => void;
  onRestart: () => void;
}) {
  const [dismissed, setDismissed] = React.useState(false);
  const [msgOpen, setMsgOpen] = React.useState(false);
  const [callsOpen, setCallsOpen] = React.useState(false);
  const err = run.error;
  const lastAttempt = React.useRef<number>(-1);

  // A NEW failure (attempts changed) always re-opens the card, even if the
  // user had dismissed the previous one — never hide fresh information.
  React.useEffect(() => {
    if (err && err.attempts !== lastAttempt.current) {
      lastAttempt.current = err.attempts;
      setDismissed(false);
    }
  }, [err]);

  const firstPending = run.steps.findIndex((s) => s.status !== "done");
  const hasOutput = run.steps.some((s) => s.output.trim().length > 0);
  const stopped = run.status === "stopped";

  if (dismissed) return null;

  function savePartialReport() {
    downloadText(
      `praison-run-partial-${slugify(workflow.name)}.md`,
      runToMarkdown(workflow, run),
      "text/markdown"
    );
    toast.success("Partial report saved", {
      description: `${run.steps.filter((s) => s.status === "done").length}/${run.steps.length} steps captured as Markdown.`,
    });
  }

  function copyDiagnostics() {
    const text = runDiagnostics(workflow, run);
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Diagnostics copied", { description: "Paste it into an issue or chat — contains no keys." }))
      .catch(() => {
        toast.error("Clipboard blocked", { description: "Select and copy from the browser console instead." });
        console.info(text);
      });
  }

  return (
    <Card className="gap-3 border-l-4 border-l-red-500 border-red-500/30 bg-red-500/[0.03] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10" aria-hidden>
          <LifeBuoy className="h-4 w-4 text-red-400" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold leading-tight">
            {stopped ? "Run stopped — resume anytime" : "Run failed — pick a recovery option"}
          </p>
          {err ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Failed at <span className="font-medium text-foreground">step {err.stepIndex + 1}/{run.steps.length}</span>
              {" "}· {err.agentName}
              {" "}
              <Badge variant="outline" className={cn("mx-0.5 px-1.5 py-0 text-[10px]", ERROR_KIND_BADGE[err.kind])}>
                {runErrorKindLabel(err.kind)}
              </Badge>
              · {err.stepsDone}/{run.steps.length} steps done
              {err.toolCallsOk > 0 ? ` · ${err.toolCallsOk} tool call${err.toolCallsOk === 1 ? "" : "s"} succeeded first` : ""}
              {err.autoRetried ? (
                <Badge variant="outline" className="mx-0.5 px-1.5 py-0 text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-500">
                  auto-retried
                </Badge>
              ) : null}
              {hasOutput ? " · partial output preserved" : ""}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              You stopped this run — every completed step is kept. Resuming continues from
              {" "}<span className="font-medium text-foreground">step {(firstPending === -1 ? run.steps.length : firstPending) + 1}</span>{" "}
              without re-running what already succeeded.
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dismiss recovery options"
          title="Dismiss"
          onClick={() => setDismissed(true)}
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {err ? (
        <>
          <div className="rounded-lg border bg-background/60 p-2.5">
            <p className={cn("break-words font-mono text-xs text-muted-foreground", !msgOpen && "line-clamp-2")}>
              {err.message}
            </p>
            {err.message.length > 110 ? (
              <button
                type="button"
                onClick={() => setMsgOpen((o) => !o)}
                className="mt-1 text-[11px] text-violet-400 transition-colors hover:text-violet-300"
              >
                {msgOpen ? "Show less" : "Show full error"}
              </button>
            ) : null}
          </div>
          <p className="rounded-lg border border-violet-500/25 bg-violet-500/5 p-2.5 text-xs leading-relaxed">
            {err.hint}
          </p>
          {run.callLog && run.callLog.length > 0 ? (
            <div className="rounded-lg border bg-background/60 p-2.5">
              <button
                type="button"
                onClick={() => setCallsOpen((o) => !o)}
                className="flex w-full items-center justify-between text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                aria-expanded={callsOpen}
              >
                <span>
                  LLM calls · {run.callLog.length} recorded
                  {run.callLog.some((c) => !c.ok) ? ` · ${run.callLog.filter((c) => !c.ok).length} failed` : " · all ok"}
                </span>
                <span>{callsOpen ? "hide" : "show"}</span>
              </button>
              {callsOpen ? (
                <ul className="mt-2 space-y-1 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                  {run.callLog.map((c, i) => (
                    <li key={`${c.at}-${i}`} className="break-words">
                      <span className="text-foreground/70">#{i + 1}</span>{" "}
                      {c.stepLabel ? `“${c.stepLabel}” · ` : ""}
                      {c.engine}
                      {c.model ? ` · ${c.model}` : ""} · {(c.ms / 1000).toFixed(1)}s{" "}
                      {c.ok ? (
                        <span className="text-emerald-500">✓</span>
                      ) : (
                        <span className="text-red-400">✗ {c.error ?? "failed"}</span>
                      )}
                      {c.attempt && c.attempt > 1 ? ` (attempt ${c.attempt})` : ""}
                      {c.note ? (
                        <span className="mt-0.5 block font-mono text-[10px] text-amber-300/90">
                          ↻ {c.note}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || firstPending === -1}
          onClick={() => onResume(firstPending)}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          {stopped
            ? `Resume from step ${firstPending + 1}`
            : firstPending === err?.stepIndex
              ? "Retry failed step"
              : "Resume from failed step"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRestart}>
          <Play className="h-3.5 w-3.5" aria-hidden />
          Restart from scratch
        </Button>
        {hasOutput ? (
          <Button type="button" variant="ghost" size="sm" onClick={savePartialReport}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Partial report
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={copyDiagnostics}>
          <Copy className="h-3.5 w-3.5" aria-hidden />
          Copy diagnostics
        </Button>
        {err?.kind === "auth" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => useUiStore.getState().setView("settings")}
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden />
            Fix key in Settings
          </Button>
        ) : null}
      </div>

      {run.resumeCount || (err && err.attempts > 1) ? (
        <p className="text-[11px] text-muted-foreground">
          Resumed ×{run.resumeCount ?? 0}
          {err && err.attempts > 1 ? ` · ${err.attempts} attempts on this run` : ""}
          {" "}· a fresh run row is never duplicated, completed work is never re-billed.
        </p>
      ) : null}
    </Card>
  );
}

interface WorkflowRunPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: Workflow | null;
  /** Open the panel already viewing this run (kanban deep-link). */
  initialRunId?: string | null;
}

export function WorkflowRunPanel({
  open,
  onOpenChange,
  workflow,
  initialRunId,
}: WorkflowRunPanelProps) {
  // Subscribe to workflows so streamed patches re-render this panel
  const workflows = useWorkflowsStore((s) => s.workflows);
  const agents = useAgentsStore((s) => s.agents);

  const [task, setTask] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [viewingRunId, setViewingRunId] = React.useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [compareRunId, setCompareRunId] = React.useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [, scheduleTick] = React.useReducer((n: number) => n + 1, 0);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const liveWorkflow = workflow
    ? workflows.find((w) => w.id === workflow.id) ?? workflow
    : null;
  const viewedRun = viewingRunId
    ? liveWorkflow?.runs.find((r) => r.id === viewingRunId)
    : undefined;
  const schedule = liveWorkflow?.schedule;

  // Reset the panel state whenever it opens for a workflow
  React.useEffect(() => {
    if (!open) return;
    setTask("");
    setRunning(false);
    setViewingRunId(initialRunId ?? null);
    setHistoryOpen(false);
    abortRef.current = null;
  }, [open, workflow, initialRunId]);

  // Auto-scroll the output area to the bottom while a run streams
  const outputLen =
    viewedRun?.steps.reduce((n, s) => n + s.output.length, 0) ?? 0;
  const stepCount = viewedRun?.steps.length ?? 0;
  React.useEffect(() => {
    if (!running) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [outputLen, stepCount, running]);

  // Follow a run started elsewhere (e.g. the scheduler) for the open workflow
  const latestRun = liveWorkflow?.runs[0];
  React.useEffect(() => {
    if (!open || running || !latestRun) return;
    if (latestRun.status === "running" && viewingRunId !== latestRun.id) {
      setViewingRunId(latestRun.id);
    }
  }, [open, running, latestRun, viewingRunId]);

  // Keep the schedule countdown honest while the panel is open
  const scheduleEnabled = schedule?.enabled === true;
  React.useEffect(() => {
    if (!open || !scheduleEnabled) return;
    const t = setInterval(scheduleTick, 5_000);
    return () => clearInterval(t);
  }, [open, scheduleEnabled, scheduleTick]);

  async function runWorkflow() {
    const wf = workflow;
    if (!wf || running) return;
    const trimmed = task.trim();
    if (!trimmed) return;

    await executeWorkflowRun({
      workflow: { id: wf.id },
      task: trimmed,
      source: "manual",
      onStarted: (runId, controller) => {
        setViewingRunId(runId);
        setRunning(true);
        abortRef.current = controller;
      },
      onSettled: () => {
        setRunning(false);
        abortRef.current = null;
      },
    });
  }

  /** Continue an errored/stopped run from a step — completed outputs preserved. */
  async function resumeRun(fromStepIndex: number) {
    const wf = liveWorkflow;
    const run = viewedRun;
    if (!wf || !run || running) return;
    await executeWorkflowRun({
      workflow: { id: wf.id },
      task: run.task,
      resume: { runId: run.id, fromStepIndex },
      source: "manual",
      onStarted: (runId, controller) => {
        setViewingRunId(runId);
        setRunning(true);
        abortRef.current = controller;
      },
      onSettled: () => {
        setRunning(false);
        abortRef.current = null;
      },
    });
  }

  /** Fresh run with the same task as a failed/stopped one. */
  async function restartRun() {
    const wf = liveWorkflow;
    const run = viewedRun;
    if (!wf || !run || running || !run.task.trim()) return;
    await executeWorkflowRun({
      workflow: { id: wf.id },
      task: run.task,
      source: "manual",
      onStarted: (runId, controller) => {
        setViewingRunId(runId);
        setRunning(true);
        abortRef.current = controller;
      },
      onSettled: () => {
        setRunning(false);
        abortRef.current = null;
      },
    });
  }

  // ─── Schedule editing (patches the store immediately) ──────────────────────
  const patchSchedule = (patch: Partial<NonNullable<Workflow["schedule"]>>) => {
    if (!liveWorkflow) return;
    const current = liveWorkflow.schedule ?? {
      enabled: false,
      intervalMs: 15 * 60_000,
      task: "",
    };
    const next = { ...current, ...patch };
    // (Re-)arm nextRunAt whenever the schedule turns on or its interval changes
    if (next.enabled && (!current.enabled || next.intervalMs !== current.intervalMs)) {
      next.nextRunAt = Date.now() + next.intervalMs;
    }
    useWorkflowsStore.getState().update(liveWorkflow.id, { schedule: next });
    scheduleTick();
  };

  const hasSteps = (liveWorkflow?.steps.length ?? 0) > 0;

  // Run history list — reachable from BOTH the empty state and the run view,
  // so past runs can be re-opened, compared and exported anytime.
  const historySection = (
    <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="pt-2">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-muted-foreground"
          aria-label="Toggle run history"
        >
          Run history ({liveWorkflow?.runs.length ?? 0})
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              historyOpen && "rotate-180"
            )}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1 pt-2">
          {(liveWorkflow?.runs ?? []).map((r) => (
            <div
              key={r.id}
              className={cn(
                "flex items-center gap-0.5 rounded-lg border pr-0.5 transition",
                r.id === viewingRunId
                  ? "border-violet-500/40 bg-violet-500/5"
                  : "border-transparent"
              )}
            >
              <button
                type="button"
                onClick={() => setViewingRunId(r.id)}
                aria-label={`View run from ${fmtRel(r.startedAt)}: ${r.task}`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-muted/50"
              >
                {r.status === "done" ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                ) : r.status === "error" ? (
                  <X className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
                ) : r.status === "stopped" ? (
                  <Ban className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-400" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-xs">{r.task}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {fmtRel(r.startedAt)}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {r.finishedAt ? fmtMs(r.finishedAt - r.startedAt) : "—"}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Compare this run with another`}
                title="Compare with another run"
                disabled={running || (liveWorkflow?.runs.length ?? 0) < 2}
                onClick={() => {
                  setCompareRunId(r.id);
                  setCompareOpen(true);
                }}
                className="h-7 w-7 shrink-0 rounded-lg text-muted-foreground transition-colors hover:text-violet-400"
              >
                <GitCompareArrows className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          ))}
          {(liveWorkflow?.runs.length ?? 0) === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No runs yet — completed runs land here with compare + report exports.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="truncate">{liveWorkflow?.name ?? "Workflow"}</SheetTitle>
          <div className="flex items-center gap-2">
            <SheetDescription>Pipeline run</SheetDescription>
            <DepthChip depth={liveWorkflow?.depth} />
            {scheduleEnabled && (
              <span
                title={`Recurring schedule · next ${fmtIn(schedule?.nextRunAt)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Every {fmtIntervalShort(schedule?.intervalMs ?? 900_000)} · next{" "}
                {fmtIn(schedule?.nextRunAt)}
              </span>
            )}
          </div>
        </SheetHeader>

        {/* Task input */}
        <div className="border-b p-4">
          <Textarea
            rows={2}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe the task for this pipeline…"
            aria-label="Pipeline task"
            className="resize-none"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="truncate text-[11px] text-muted-foreground">
              {hasSteps
                ? `${liveWorkflow?.steps.length} step${liveWorkflow?.steps.length === 1 ? "" : "s"} · agents hand outputs down the chain`
                : "This workflow has no steps yet — edit it first."}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {viewedRun && !running && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Export run report as Markdown"
                  title="Export run report as Markdown"
                  onClick={() => {
                    if (!viewedRun || !liveWorkflow) return;
                    downloadText(
                      `praison-run-${slugify(liveWorkflow.name)}.md`,
                      runToMarkdown(liveWorkflow, viewedRun),
                      "text/markdown"
                    );
                    toast.success("Run report exported", {
                      description: `${viewedRun.steps.length} steps saved as Markdown.`,
                    });
                  }}
                  className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors hover:text-violet-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  Report
                </Button>
              )}
              {/* Recurring schedule */}
              <Popover
                open={scheduleOpen}
                onOpenChange={(v) => {
                  setScheduleOpen(v);
                  scheduleTick();
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Recurring schedule"
                    title="Recurring schedule"
                    disabled={!hasSteps}
                    className={cn(
                      "h-8 gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors hover:text-violet-400",
                      scheduleEnabled &&
                        "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
                    )}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {scheduleEnabled ? fmtIntervalShort(schedule?.intervalMs ?? 900_000) : "Schedule"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 space-y-3.5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold leading-none">Recurring schedule</p>
                      <p className="text-xs text-muted-foreground">
                        Re-runs this pipeline automatically while the app is open.
                      </p>
                    </div>
                    <Switch
                      aria-label="Enable recurring schedule"
                      checked={scheduleEnabled}
                      onCheckedChange={(v) => patchSchedule({ enabled: v })}
                    />
                  </div>

                  {scheduleEnabled && (
                    <>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Interval</p>
                        <Select
                          value={String(schedule?.intervalMs ?? 900_000)}
                          onValueChange={(v) => patchSchedule({ intervalMs: Number(v) })}
                        >
                          <SelectTrigger aria-label="Schedule interval" className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SCHEDULE_INTERVALS.map((iv) => (
                              <SelectItem key={iv.ms} value={String(iv.ms)}>
                                {iv.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          Task for scheduled runs
                        </p>
                        <Textarea
                          rows={3}
                          value={schedule?.task ?? ""}
                          onChange={(e) => patchSchedule({ task: e.target.value })}
                          placeholder={
                            liveWorkflow?.description
                              ? `Defaults to: ${liveWorkflow.description.slice(0, 60)}${liveWorkflow.description.length > 60 ? "…" : ""}`
                              : "Defaults to the workflow description"
                          }
                          aria-label="Scheduled task"
                          className="resize-none text-sm"
                        />
                      </div>

                      <div className="rounded-xl border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between">
                          <span>Last run</span>
                          <span className="font-medium text-foreground">
                            {schedule?.lastRunAt ? fmtRel(schedule.lastRunAt) : "not yet"}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span>Next run</span>
                          <span className="font-medium tabular-nums text-violet-400">
                            {fmtIn(schedule?.nextRunAt)}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </PopoverContent>
              </Popover>
              {running ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!task.trim() || !hasSteps}
                  onClick={runWorkflow}
                >
                  <Play className="h-3.5 w-3.5" />
                  Run
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Steps output + history */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {!viewedRun ? (
            <>
              <div className="flex min-h-32 items-center justify-center px-6 pt-6 text-center text-sm text-muted-foreground">
                Describe a task above and hit Run — agents execute one by one, each
                building on the previous output.
              </div>
              {historySection}
            </>
          ) : (
            <>
              {viewedRun.task ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Task:</span>{" "}
                  {viewedRun.task}
                </p>
              ) : null}
              {/* Non-silent failure fallback: options + information, never just a dead end */}
              {!running && (viewedRun.status === "error" || viewedRun.status === "stopped") && liveWorkflow ? (
                <RunRecoveryCard
                  key={viewedRun.id}
                  run={viewedRun}
                  workflow={liveWorkflow}
                  busy={running}
                  onResume={resumeRun}
                  onRestart={restartRun}
                />
              ) : null}
              {viewedRun.steps.map((step, i) => {
                const agent = agents.find((a) => a.id === step.agentId);
                return (
                  <Card
                    key={`${viewedRun.id}-${step.stepId}-${i}`}
                    className={cn(
                      "gap-2 border-l-4 p-4",
                      STEP_BORDER[step.status],
                      step.kind === "review" && "bg-amber-500/[0.035]"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <AgentAvatar
                        agent={
                          agent ?? {
                            emoji: step.agentEmoji,
                            color: "violet",
                            name: step.agentName,
                          }
                        }
                        size="xs"
                      />
                      <div className="min-w-0 flex-1 text-sm font-medium">
                        <span className="truncate">{step.agentName}</span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="truncate text-muted-foreground">
                          {step.label}
                        </span>
                      </div>
                      {/* Review-gate verdict + rework badges */}
                      {step.kind === "review" && step.status === "done" && step.verdict ? (
                        <span
                          title={
                            step.verdict === "pass"
                              ? "The review gate accepted the previous step's output"
                              : "The review gate requested a rework of the previous step"
                          }
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            step.verdict === "pass"
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          )}
                        >
                          {step.verdict === "pass" ? (
                            <ShieldCheck className="h-3 w-3" aria-hidden />
                          ) : (
                            <Undo2 className="h-3 w-3" aria-hidden />
                          )}
                          {step.verdict === "pass" ? "passed" : "rework"}
                        </span>
                      ) : null}
                      {step.degraded ? (
                        <span
                          title="This step hit its tool budget mid-research — the output below is an auto-digest of the tool results, not a full synthesis. Retry the step for a fuller answer."
                          className="inline-flex shrink-0 items-center rounded-full border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-orange-600 dark:text-orange-400"
                        >
                          auto-digest
                        </span>
                      ) : null}
                      {step.llmCalls && step.llmCalls.length > 0 ? (
                        <span
                          title={
                            "Per-iteration trace (harness rank-2): " +
                            step.llmCalls
                              .slice(-6)
                              .map((c) => `iter ${c.iter} · ${(c.msAt / 1000).toFixed(1)}s · ${c.contentChars} chars${c.promptChars ? ` · prompt ${c.promptChars}` : ""}`)
                              .join(" | ")
                          }
                          className="inline-flex shrink-0 items-center rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-600 dark:text-sky-400"
                        >
                          {step.llmCalls.length} call{step.llmCalls.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      {step.reworked ? (
                        <span
                          title="This step was redone after the review gate rejected its first attempt"
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
                        >
                          <Undo2 className="h-3 w-3" aria-hidden />
                          redone
                        </span>
                      ) : null}
                      <StatusIndicator status={step.status} ms={step.ms} />
                    </div>

                    <div className="min-h-6 text-sm">
                      {step.output ? (
                        <MarkdownRenderer content={step.output} />
                      ) : step.status === "running" ? (
                        <div
                          className="flex items-center gap-1 py-1.5"
                          role="status"
                          aria-label="Agent is thinking"
                        >
                          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-violet-400" />
                          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-violet-400" />
                          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-violet-400" />
                        </div>
                      ) : null}
                    </div>

                    <ToolCallChips toolCalls={step.toolCalls} />
                  </Card>
                );
              })}

              {historySection}
            </>
          )}
        </div>
      </SheetContent>

      {/* Side-by-side diff of two runs */}
      <WorkflowCompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        workflow={liveWorkflow}
        initialRunId={compareRunId}
      />
    </Sheet>
  );
}
