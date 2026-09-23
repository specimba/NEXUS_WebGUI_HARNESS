"use client";

// ─── Task-suite executor (harness rank-①, r31) ────────────────────────────────
// Replays fixed cases over real workflows: sequential, abortable, rate-polite.
// Metrics are aggregates only (never outputs) — the localStorage discipline.

import { executeWorkflowRun, type ExecuteRunOptions } from "@/lib/workflow-runner";
import { useSuitesStore, useWorkflowsStore } from "@/lib/stores";
import { SUITE_GAP_MS } from "@/lib/constants";
import { uid } from "@/lib/helpers";
import type { SuiteCaseResult, SuiteCaseRun, SuiteResult, WorkflowRun } from "@/lib/types";

let activeController: AbortController | null = null;

export function isSuiteRunning(): boolean {
  return activeController != null;
}

/** Abort the current suite run (finishes the in-flight pipeline run too). */
export function stopSuite(): void {
  activeController?.abort();
}

export interface SuiteProgress {
  caseIndex: number;
  caseTotal: number;
  workflowName: string;
  repeat: number;
  repeats: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Aggregate one finished run row into suite metrics (no outputs kept). */
function collectRun(run: WorkflowRun): SuiteCaseRun {
  return {
    runId: run.id,
    status: run.status,
    stepsDone: run.steps.filter((s) => s.status === "done").length,
    stepsTotal: run.steps.length,
    ms: (run.finishedAt ?? Date.now()) - run.startedAt,
    degraded: run.steps.filter((s) => s.degraded).length,
    reworked: run.steps.filter((s) => s.reworked).length,
    toolCallsOk: run.steps.reduce(
      (acc, s) => acc + s.toolCalls.filter((t) => t.ok === true).length,
      0
    ),
  };
}

/** executeWorkflowRun resolved via onSettled (its return value is just the id). */
function onceRun(opts: Omit<ExecuteRunOptions, "onSettled">): Promise<string | null> {
  return new Promise((resolve) => {
    void executeWorkflowRun({ ...opts, onSettled: (runId) => resolve(runId) });
  });
}

/**
 * Run every case of a suite sequentially, `repeats` times each, collecting
 * done-rates + quality counters. A stopped suite keeps partial results and
 * is recorded with status "stopped" — nothing is silently discarded.
 */
export async function runSuite(
  suiteId: string,
  repeats: number,
  onProgress?: (p: SuiteProgress) => void
): Promise<SuiteResult | null> {
  const suite = useSuitesStore.getState().suites.find((s) => s.id === suiteId);
  if (!suite || activeController) return null;
  const controller = new AbortController();
  activeController = controller;

  const result: SuiteResult = {
    id: uid("suitrun"),
    suiteId,
    startedAt: Date.now(),
    repeats,
    results: [],
    status: "complete",
  };

  try {
    for (let ci = 0; ci < suite.cases.length; ci++) {
      const c = suite.cases[ci];
      const wf = useWorkflowsStore
        .getState()
        .workflows.find((w) => w.id === c.workflowId);
      if (!wf) {
        const skipped: SuiteCaseResult = {
          caseId: c.id,
          workflowId: c.workflowId,
          workflowName: "(missing workflow)",
          task: c.task,
          expect: c.expect,
          runs: "skipped",
          doneRate: 0,
        };
        result.results.push(skipped);
        continue;
      }
      onProgress?.({ caseIndex: ci, caseTotal: suite.cases.length, workflowName: wf.name, repeat: 0, repeats });

      const runs: SuiteCaseRun[] = [];
      for (let r = 0; r < repeats; r++) {
        if (controller.signal.aborted) break;
        onProgress?.({ caseIndex: ci, caseTotal: suite.cases.length, workflowName: wf.name, repeat: r + 1, repeats });
        const runId = await onceRun({
          workflow: { id: wf.id },
          task: c.task,
          source: "suite",
          suiteMeta: { suiteId, caseId: c.id, runTag: result.id },
          signal: controller.signal,
        });
        if (runId) {
          const run = useWorkflowsStore
            .getState()
            .workflows.find((w) => w.id === wf.id)
            ?.runs.find((x) => x.id === runId);
          if (run) runs.push(collectRun(run));
        }
        // Rate-polite gap between repeats (never after the last one).
        if (r < repeats - 1 && !controller.signal.aborted) await sleep(SUITE_GAP_MS);
      }

      result.results.push({
        caseId: c.id,
        workflowId: c.workflowId,
        workflowName: wf.name,
        task: c.task,
        expect: c.expect,
        runs,
        doneRate: runs.length > 0 ? runs.filter((x) => x.status === "done").length / runs.length : 0,
      });
    }
    result.finishedAt = Date.now();
    if (controller.signal.aborted) result.status = "stopped";
    useSuitesStore.getState().recordResult(suiteId, result);
    return result;
  } finally {
    activeController = null;
  }
}

/**
 * Verdict of the latest result vs the previous one (the roadmap's diff card):
 * done-rate Δ per case → improved / flat / regressed / new.
 */
export function suiteDiff(result: SuiteResult, previous?: SuiteResult): Map<string, "improved" | "flat" | "regressed" | "new"> {
  const diff = new Map<string, "improved" | "flat" | "regressed" | "new">();
  if (!previous) {
    for (const r of result.results) diff.set(r.caseId, "new");
    return diff;
  }
  for (const r of result.results) {
    const prev = previous.results.find((p) => p.caseId === r.caseId);
    if (!prev) {
      diff.set(r.caseId, "new");
      continue;
    }
    const delta = r.doneRate - prev.doneRate;
    diff.set(r.caseId, delta > 0 ? "improved" : delta < 0 ? "regressed" : "flat");
  }
  return diff;
}
