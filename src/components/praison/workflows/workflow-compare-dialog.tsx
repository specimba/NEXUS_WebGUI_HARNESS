"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Download, GitCompareArrows, Loader2, Ban, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { comparisonToMarkdown, downloadText, fmtBytes, fmtMs, fmtRel, slugify } from "@/lib/helpers";
import type { RunComparison, RunStepDelta, Workflow, WorkflowRun, WorkflowRunStep } from "@/lib/types";

// ─── Run comparison: side-by-side diff of two pipeline runs ────────────────

function computeComparison(a: WorkflowRun, b: WorkflowRun): RunComparison {
  const len = Math.max(a.steps.length, b.steps.length);
  const rows: RunStepDelta[] = [];
  let aDone = 0;
  let bDone = 0;
  let totalA = 0;
  let totalB = 0;

  for (let i = 0; i < len; i++) {
    const sa = a.steps[i];
    const sb = b.steps[i];
    if (sa?.status === "done") {
      aDone += 1;
      totalA += sa.ms ?? 0;
    }
    if (sb?.status === "done") {
      bDone += 1;
      totalB += sb.ms ?? 0;
    }
    rows.push({
      stepIndex: i,
      label: sa?.label ?? sb?.label ?? `Step ${i + 1}`,
      aAgent: sa?.agentName ?? "—",
      bAgent: sb?.agentName ?? "—",
      aStatus: sa?.status ?? "missing",
      bStatus: sb?.status ?? "missing",
      aMs: sa?.ms,
      bMs: sb?.ms,
      aOutputLen: sa?.output.length ?? 0,
      bOutputLen: sb?.output.length ?? 0,
      aToolCalls: sa?.toolCalls.length ?? 0,
      bToolCalls: sb?.toolCalls.length ?? 0,
      sameAgent: (sa?.agentName ?? "") === (sb?.agentName ?? ""),
    });
  }

  return {
    a,
    b,
    sameTask: a.task.trim() === b.task.trim(),
    totalAms: a.finishedAt ? a.finishedAt - a.startedAt : undefined,
    totalBms: b.finishedAt ? b.finishedAt - b.startedAt : undefined,
    totalDeltaMs:
      a.finishedAt && b.finishedAt
        ? b.finishedAt - b.startedAt - (a.finishedAt - a.startedAt)
        : undefined,
    aDone,
    bDone,
    rows,
  };
}

const STATUS_ICON: Record<WorkflowRunStep["status"] | "missing", React.ReactNode> = {
  done: <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Done" />,
  running: <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-400" aria-label="Running" />,
  stopped: <Ban className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Stopped" />,
  error: <X className="h-3.5 w-3.5 shrink-0 text-red-500" aria-label="Failed" />,
  missing: <span className="text-[10px] text-muted-foreground" aria-label="Missing">n/a</span>,
};

function RunPicker({
  runs,
  value,
  otherValue,
  onChange,
  label,
}: {
  runs: WorkflowRun[];
  value: string;
  otherValue: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className="h-9 min-w-0 flex-1 gap-2 rounded-xl bg-card/70 text-xs sm:text-sm"
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {runs.map((r, i) => (
          <SelectItem
            key={r.id}
            value={r.id}
            disabled={r.id === otherValue}
            className="text-xs sm:text-sm"
          >
            <span className="mr-1.5 inline-block rounded bg-muted px-1 font-mono text-[10px]">
              #{runs.length - i}
            </span>
            {fmtRel(r.startedAt)} · {r.task}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DeltaBadge({ delta }: { delta: number }) {
  const abs = Math.abs(delta);
  if (abs < 50) {
    return (
      <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
        ~same speed
      </span>
    );
  }
  return delta < 0 ? (
    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500">
      ▼ B faster by {fmtMs(abs)}
    </span>
  ) : (
    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-500">
      ▲ A faster by {fmtMs(abs)}
    </span>
  );
}

function StepRow({ row }: { row: RunStepDelta }) {
  const msDelta =
    row.aStatus === "done" && row.bStatus === "done" && row.aMs != null && row.bMs != null
      ? row.bMs - row.aMs
      : null;

  return (
    <div className="rounded-xl border bg-card/60 p-3 transition-colors hover:border-violet-500/25">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px] text-muted-foreground">
          {row.stepIndex + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.label}</span>
        {!row.sameAgent && (
          <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500">
            agent changed
          </span>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-3">
        {/* Run A */}
        <div className="space-y-1 rounded-lg border bg-background/50 p-2">
          <div className="flex items-center gap-1.5 text-xs">
            {STATUS_ICON[row.aStatus]}
            <span className="truncate font-medium">{row.aAgent}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
            {row.aMs != null && <span>⏱ {fmtMs(row.aMs)}</span>}
            <span>{fmtBytes(row.aOutputLen)} out</span>
            {row.aToolCalls > 0 && <span>🛠 {row.aToolCalls}×</span>}
          </div>
        </div>
        {/* Run B */}
        <div className="space-y-1 rounded-lg border bg-background/50 p-2">
          <div className="flex items-center gap-1.5 text-xs">
            {STATUS_ICON[row.bStatus]}
            <span className="truncate font-medium">{row.bAgent}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
            {row.bMs != null && <span>⏱ {fmtMs(row.bMs)}</span>}
            <span>{fmtBytes(row.bOutputLen)} out</span>
            {row.bToolCalls > 0 && <span>🛠 {row.bToolCalls}×</span>}
          </div>
        </div>
      </div>

      {msDelta != null && Math.abs(msDelta) >= 50 && (
        <div className="mt-1.5 text-right text-[10px] tabular-nums">
          {msDelta < 0 ? (
            <span className="text-emerald-500">B faster by {fmtMs(-msDelta)}</span>
          ) : (
            <span className="text-amber-500">B slower by {fmtMs(msDelta)}</span>
          )}
        </div>
      )}
    </div>
  );
}

export interface WorkflowCompareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: Workflow | null;
  /** Run pre-selected as side A when the dialog opens. */
  initialRunId?: string | null;
}

export function WorkflowCompareDialog({
  open,
  onOpenChange,
  workflow,
  initialRunId,
}: WorkflowCompareDialogProps) {
  const [aId, setAId] = React.useState<string>("");
  const [bId, setBId] = React.useState<string>("");

  const runs = React.useMemo(
    () => (workflow ? [...workflow.runs].sort((x, y) => y.startedAt - x.startedAt) : []),
    [workflow]
  );

  // Seed A/B each time the dialog opens (A = requested run, B = next different)
  React.useEffect(() => {
    if (!open || runs.length === 0) return;
    const seedA = initialRunId && runs.some((r) => r.id === initialRunId) ? initialRunId : runs[0].id;
    const seedB = runs.find((r) => r.id !== seedA)?.id ?? "";
    setAId(seedA);
    setBId(seedB);
  }, [open, initialRunId, runs]);

  const a = runs.find((r) => r.id === aId);
  const b = runs.find((r) => r.id === bId);
  const comparison: RunComparison | null =
    a && b ? computeComparison(a, b) : null;

  const aFaster =
    comparison?.totalDeltaMs != null && comparison.totalDeltaMs > 50 ? comparison.a : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-violet-400" aria-hidden />
            Compare runs
          </DialogTitle>
          <DialogDescription>
            {workflow?.name ?? "Workflow"} · pick any two runs to diff duration, output size and
            tool usage
          </DialogDescription>
        </DialogHeader>

        {runs.length < 2 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
            <GitCompareArrows className="h-7 w-7 opacity-40" aria-hidden />
            Run this pipeline at least twice to unlock comparison.
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
            {/* Pickers + export */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <RunPicker
                runs={runs}
                value={aId}
                otherValue={bId}
                onChange={setAId}
                label="Run A"
              />
              <ArrowRight
                className="hidden h-4 w-4 shrink-0 rotate-90 text-muted-foreground sm:block"
                aria-hidden
              />
              <RunPicker
                runs={runs}
                value={bId}
                otherValue={aId}
                onChange={setBId}
                label="Run B"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Export comparison report as Markdown"
                title="Export comparison report (Markdown)"
                disabled={!comparison}
                onClick={() => {
                  if (!comparison || !workflow) return;
                  downloadText(
                    `praison-compare-${slugify(workflow.name)}.md`,
                    comparisonToMarkdown(workflow, comparison),
                    "text/markdown"
                  );
                  toast.success("Comparison report exported", {
                    description: `${comparison.rows.length} steps diffed as Markdown.`,
                  });
                }}
                className="h-9 w-9 shrink-0 self-end rounded-xl text-muted-foreground transition-colors hover:text-violet-400 sm:self-auto"
              >
                <Download className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            {comparison && (
              <>
                {/* Summary tiles */}
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div className="rounded-xl border bg-card/60 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Run A total
                    </p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums">
                      {comparison.totalAms != null ? fmtMs(comparison.totalAms) : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {comparison.aDone}/{comparison.rows.length} steps done
                    </p>
                  </div>
                  <div className="rounded-xl border bg-card/60 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Run B total
                    </p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums">
                      {comparison.totalBms != null ? fmtMs(comparison.totalBms) : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {comparison.bDone}/{comparison.rows.length} steps done
                    </p>
                  </div>
                  <div className="rounded-xl border bg-card/60 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Duration delta
                    </p>
                    <div className="mt-1">
                      {comparison.totalDeltaMs != null ? (
                        <DeltaBadge delta={comparison.totalDeltaMs} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border bg-card/60 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Tool usage
                    </p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums">
                      {comparison.rows.reduce((n, r) => n + r.aToolCalls, 0)}
                      <span className="mx-1 text-[10px] font-normal text-muted-foreground">vs</span>
                      {comparison.rows.reduce((n, r) => n + r.bToolCalls, 0)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">A vs B</p>
                  </div>
                </div>

                {/* Task contexts */}
                {!comparison.sameTask && (
                  <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                    ⚠️ Different tasks: A ran “{comparison.a.task}” · B ran “{comparison.b.task}”
                  </div>
                )}
                {aFaster && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    🏆 Run A finished {fmtMs(comparison.totalDeltaMs ?? 0)} faster overall.
                  </p>
                )}

                {/* Per-step rows */}
                <div className="mt-4 space-y-2">
                  {comparison.rows.map((row) => (
                    <StepRow key={row.stepIndex} row={row} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
