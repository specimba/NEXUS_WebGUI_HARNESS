"use client";

// ─── Suites board (harness rank-①, r31) ──────────────────────────────────────
// Replayable task suites over real workflows: run cases × repeats, show
// done-rate diff cards, export aggregate markdown. Aggregates only — the
// suite store never keeps pipeline outputs.

import * as React from "react";
import { toast } from "sonner";
import { Download, FlaskConical, Play, Plus, Square, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSuitesStore, useUiStore, useWorkflowsStore } from "@/lib/stores";
import { downloadText, fmtRel, slugify, suiteResultToMarkdown } from "@/lib/helpers";
import { isSuiteRunning, runSuite, stopSuite, suiteDiff, type SuiteProgress } from "@/lib/suite-runner";
import { SUITE_REPEATS_MAX } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { SuiteCaseRun, SuiteResult } from "@/lib/types";

const STATUS_DOT: Record<SuiteCaseRun["status"], string> = {
  done: "bg-emerald-500",
  error: "bg-red-500",
  stopped: "bg-amber-500",
  running: "bg-violet-500 animate-pulse",
};

function CaseRow({
  c,
  index,
  diff,
  onRemove,
}: {
  c: SuiteResult["results"][number];
  index: number;
  diff: "improved" | "flat" | "regressed" | "new" | undefined;
  onRemove?: () => void;
}) {
  const diffMeta: Record<NonNullable<typeof diff>, { label: string; cls: string }> = {
    improved: { label: "improved", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    flat: { label: "flat", cls: "border-muted-foreground/30 bg-muted text-muted-foreground" },
    regressed: { label: "regressed", cls: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400" },
    new: { label: "new", cls: "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  };
  return (
    <div className="rounded-lg border bg-background/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">#{index + 1}</span>
            <span className="truncate text-sm font-medium">{c.workflowName}</span>
            {c.runs !== "skipped" && c.runs.length > 0 ? (
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold",
                  c.doneRate === 1
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : c.doneRate === 0
                      ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                )}
              >
                {Math.round(c.doneRate * 100)}% done
              </span>
            ) : null}
            {diff ? (
              <span className={cn("rounded-full border px-1.5 py-0.5 text-[10px] font-semibold", diffMeta[diff].cls)}>
                {diffMeta[diff].label}
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.task}</p>
          {c.expect ? <p className="mt-0.5 text-[11px] italic text-muted-foreground/80">expect: {c.expect}</p> : null}
        </div>
        {onRemove ? (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-500"
            onClick={onRemove}
            aria-label="Remove case"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      {c.runs === "skipped" ? (
        <p className="mt-2 text-xs italic text-muted-foreground">skipped — workflow missing</p>
      ) : c.runs.length === 0 ? (
        <p className="mt-2 text-xs italic text-muted-foreground">could not start (pipeline busy?)</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {c.runs.map((r) => (
            <li key={r.runId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[r.status])} aria-hidden />
                <span className="font-medium text-foreground">{r.status}</span>
              </span>
              <span>
                steps {r.stepsDone}/{r.stepsTotal}
              </span>
              <span>{(r.ms / 1000).toFixed(1)}s</span>
              <span>{r.toolCallsOk} tool ok</span>
              {r.degraded > 0 ? <span className="text-amber-600 dark:text-amber-400">{r.degraded} auto-digest</span> : null}
              {r.reworked > 0 ? <span className="text-violet-500">{r.reworked} reworked</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SuitesBoard() {
  const suites = useSuitesStore((s) => s.suites);
  const addCase = useSuitesStore((s) => s.addCase);
  const removeCase = useSuitesStore((s) => s.removeCase);
  const workflows = useWorkflowsStore((s) => s.workflows);
  const setBoardOpen = useUiStore((s) => s.setWorkflowBoardOpen);

  const [runningId, setRunningId] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<SuiteProgress | null>(null);
  const [repeats, setRepeats] = React.useState("1");
  const [addWfId, setAddWfId] = React.useState("");
  const [addTask, setAddTask] = React.useState("");

  // A suite may finish while this component unmounts — poll the running flag
  // so the Stop button state stays truthful.
  React.useEffect(() => {
    if (!runningId) return;
    const t = setInterval(() => {
      if (!isSuiteRunning()) {
        setRunningId(null);
        setProgress(null);
      }
    }, 700);
    return () => clearInterval(t);
  }, [runningId]);

  const handleRun = async (suiteId: string) => {
    if (isSuiteRunning()) return;
    const n = Math.min(Math.max(1, Number(repeats) || 1), SUITE_REPEATS_MAX);
    setRunningId(suiteId);
    try {
      const result = await runSuite(suiteId, n, setProgress);
      if (result) {
        const done = result.results.filter((r) => r.runs !== "skipped" && r.runs.length > 0);
        const overall =
          done.length > 0 ? Math.round((done.reduce((a, r) => a + r.doneRate, 0) / done.length) * 100) : 0;
        if (result.status === "stopped") {
          toast.warning("Suite stopped — partial results kept", { icon: "⏹", description: `Done-rate so far: ${overall}%` });
        } else {
          toast.success(`Suite finished — overall done-rate ${overall}%`, { icon: "🧪" });
        }
      }
    } finally {
      setRunningId(null);
      setProgress(null);
    }
  };

  const handleExport = (suiteId: string) => {
    const suite = suites.find((s) => s.id === suiteId);
    if (!suite?.lastResult) return;
    downloadText(
      `praison-suite-${slugify(suite.name)}-${new Date().toISOString().slice(0, 10)}.md`,
      suiteResultToMarkdown(suite, suite.lastResult),
      "text/markdown"
    );
  };

  const handleAddCase = (suiteId: string) => {
    if (!addWfId || addTask.trim() === "") {
      toast.error("Pick a pipeline and write the fixed task text first.");
      return;
    }
    addCase(suiteId, {
      id: `case_${Date.now().toString(36)}`,
      workflowId: addWfId,
      task: addTask.trim().slice(0, 500),
    });
    setAddTask("");
    toast.success("Case added");
  };

  if (suites.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-center">
        <FlaskConical className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <h3 className="mt-3 text-sm font-semibold">No suites yet</h3>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Suites replay fixed tasks against your pipelines — n≥1 repeats per case with done-rate, latency and
          tool-call metrics, so harness changes become experiments instead of vibes. The baseline suite seeds
          automatically on first launch.
        </p>
        <Button size="sm" variant="outline" className="mt-4" onClick={() => setBoardOpen(true)}>
          Back to runs board
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {suites.map((suite) => {
        const isRunning = runningId === suite.id;
        const last = suite.lastResult;
        const prev = suite.history && suite.history.length >= 2 ? suite.history[suite.history.length - 2] : undefined;
        const diff = last ? suiteDiff(last, prev) : undefined;
        return (
          <Card key={suite.id} className="gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-violet-500" aria-hidden />
                  <h3 className="text-sm font-semibold">{suite.name}</h3>
                  <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                    {suite.cases.length} case{suite.cases.length === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{suite.description}</p>
                {last ? (
                  <p className="mt-1 text-[11px] text-muted-foreground/80">
                    last run {fmtRel(last.startedAt)} · {last.status} · {last.repeats} repeat{last.repeats === 1 ? "" : "s"} per case
                    {prev ? " · diff vs previous shown" : ""}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Select value={repeats} onValueChange={setRepeats} disabled={isRunning}>
                  <SelectTrigger className="h-8 w-[118px] text-xs" aria-label="Repeats per case">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: SUITE_REPEATS_MAX }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} repeat{n === 1 ? "" : "s"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isRunning ? (
                  <Button size="sm" variant="outline" className="h-8 border-red-500/40 text-red-500 hover:bg-red-500/10" onClick={() => stopSuite()}>
                    <Square className="h-3.5 w-3.5" /> Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="h-8 bg-violet-600 text-white hover:bg-violet-700"
                    onClick={() => void handleRun(suite.id)}
                    disabled={workflows.length === 0}
                  >
                    <Play className="h-3.5 w-3.5" /> Run suite
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  onClick={() => handleExport(suite.id)}
                  disabled={!last}
                  aria-label="Export suite report"
                  title={last ? "Export latest suite report (markdown)" : "Run the suite first"}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {isRunning && progress ? (
              <div
                role="status"
                aria-live="polite"
                className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-xs text-violet-600 dark:text-violet-400"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" aria-hidden />
                Case {progress.caseIndex + 1}/{progress.caseTotal} · {progress.workflowName} · repeat {progress.repeat}/{progress.repeats}
                — running REAL pipelines, quota is being spent
              </div>
            ) : null}
            {!isRunning ? (
              <p className="text-[11px] text-muted-foreground/80">
                Suites run REAL pipelines and spend provider quota — repeats trade statistical confidence for cost.
              </p>
            ) : null}

            {last ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest result</h4>
                </div>
                {last.results.map((c, i) => (
                  <CaseRow key={c.caseId} c={c} index={i} diff={diff?.get(c.caseId)} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cases</h4>
                {suite.cases.map((c, i) => (
                  <CaseRow
                    key={c.id}
                    index={i}
                    diff={undefined}
                    c={{
                      caseId: c.id,
                      workflowId: c.workflowId,
                      workflowName: workflows.find((w) => w.id === c.workflowId)?.name ?? "(missing workflow)",
                      task: c.task,
                      expect: c.expect,
                      runs: "skipped",
                      doneRate: 0,
                    }}
                    onRemove={isRunning ? undefined : () => removeCase(suite.id, c.id)}
                  />
                ))}
              </div>
            )}

            {!isRunning ? (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-center">
                <div className="shrink-0 sm:w-56">
                  <Select value={addWfId} onValueChange={setAddWfId}>
                    <SelectTrigger className="h-8 text-xs" aria-label="Pipeline for the new case">
                      <SelectValue placeholder="Pick pipeline…" />
                    </SelectTrigger>
                    <SelectContent>
                      {workflows.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  value={addTask}
                  onChange={(e) => setAddTask(e.target.value)}
                  placeholder="Fixed task text for the new case…"
                  className="h-8 flex-1 text-xs"
                  maxLength={500}
                />
                <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => handleAddCase(suite.id)}>
                  <Plus className="h-3.5 w-3.5" /> Add case
                </Button>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
