"use client";

// ─── Task-suite executor (harness rank-①, r31) ────────────────────────────────
// Replays fixed cases over real workflows: sequential, abortable, rate-polite.
// Metrics are aggregates only (never outputs) — the localStorage discipline.
//
// r36 Harness A/B lab: a case may list several harness presets; the runner
// executes the SAME task under EACH preset (harness × repeats) and the board
// crowns an empirical winner — "which harness actually finishes this job?"

import { executeWorkflowRun, type ExecuteRunOptions } from "@/lib/workflow-runner";
import { useAgentsStore, useSettingsStore, useSuitesStore, useWorkflowsStore } from "@/lib/stores";
import { runAgentChat } from "@/lib/chat-client";
import { resolveExplicitLlm } from "@/lib/llm-config";
import { mcpRunParams } from "@/lib/mcp";
import { SUITE_GAP_MS, SUITE_HARNESSES_MAX } from "@/lib/constants";
import { uid } from "@/lib/helpers";
import { HARNESS_PRESETS, harnessById, isHarnessId } from "@/lib/harness";
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
  /** r36 A/B lab: which harness preset is driving the current run. */
  harness?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Aggregate one finished run row into suite metrics (no outputs kept). */
function collectRun(run: WorkflowRun, harness?: string): SuiteCaseRun {
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
    ...(harness ? { harness } : {}),
  };
}

/** executeWorkflowRun resolved via onSettled (its return value is just the id). */
function onceRun(opts: Omit<ExecuteRunOptions, "onSettled">): Promise<string | null> {
  return new Promise((resolve) => {
    void executeWorkflowRun({ ...opts, onSettled: (runId) => resolve(runId) });
  });
}

/** r36 A/B lab: per-harness aggregates + the winner for one case's runs. */
function aggregateByHarness(runs: SuiteCaseRun[]) {
  const groups = new Map<string, SuiteCaseRun[]>();
  for (const r of runs) {
    // r44: agent-vs-agent cases key their lanes by agentId.
    const key = r.agentId ?? r.harness ?? "inherit";
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }
  const byHarness = [...groups.entries()].map(([harness, rs]) => ({
    harness,
    doneRate: rs.filter((x) => x.status === "done").length / rs.length,
    runs: rs.length,
    meanMs: rs.reduce((a, x) => a + x.ms, 0) / rs.length,
    reworks: rs.reduce((a, x) => a + x.reworked, 0),
    toolCallsOk: rs.reduce((a, x) => a + x.toolCallsOk, 0),
  }));
  // Winner: highest done-rate; ties broken by lower mean latency. Only crowned
  // when at least one run actually finished (an all-fail bake-off has no winner).
  const best = [...byHarness].sort((a, b) =>
    b.doneRate !== a.doneRate ? b.doneRate - a.doneRate : a.meanMs - b.meanMs
  )[0];
  const winner = best && best.doneRate > 0 ? best.harness : undefined;
  return { byHarness, winner };
}

/**
 * r44 agent-vs-agent lane: run ONE task through ONE agent as a single chat
 * turn (the agent's own model, tools and instructions; headless — MCP input
 * gates decline, same doctrine as pipeline runs). Metrics only — the reply
 * text is discarded (localStorage discipline), so the verdict is honest
 * without storing outputs.
 */
async function runAgentTurn(
  agentId: string,
  task: string,
  signal: AbortSignal
): Promise<{ ok: boolean; ms: number; toolCallsOk: number; replyChars: number; error?: string }> {
  const started = Date.now();
  const agent = useAgentsStore.getState().agents.find((a) => a.id === agentId);
  if (!agent) return { ok: false, ms: 0, toolCallsOk: 0, replyChars: 0, error: "agent not found" };
  const settings = useSettingsStore.getState().settings;
  // r48: same absolute-lane semantics as the workflow runner.
  const llm = resolveExplicitLlm(settings, agent.model);
  let reply = "";
  let toolCallsOk = 0;
  let error: string | undefined;
  try {
    await runAgentChat(
      {
        provider: llm.provider,
        apiKey: llm.apiKey,
        baseUrl: llm.baseUrl,
        model: llm.model,
        providerId: llm.providerId,
        temperature: agent.temperature,
        maxIterations: agent.maxIterations,
        tools: agent.tools ?? [],
        // r38 MCP: enabled MCP tools join; headless lane — gates decline.
        ...mcpRunParams(settings),
        system: agent.instructions,
        messages: [{ role: "user", content: task }],
        signal,
      },
      {
        onToken: (t) => {
          reply += t;
        },
        onToolResult: (res) => {
          if (res.ok === true) toolCallsOk += 1;
        },
      }
    );
  } catch (err) {
    if (signal.aborted) throw err;
    // runAgentChat throws on the SSE error event — the lane dies honestly.
    error = err instanceof Error ? err.message : String(err);
  }
  return {
    ok: !error && reply.trim().length > 0,
    ms: Date.now() - started,
    toolCallsOk,
    replyChars: reply.length,
    ...(error ? { error } : {}),
  };
}

/**
 * Run every case of a suite sequentially, `repeats` times each — under EACH
 * harness the case lists (r36 A/B lab) — collecting done-rates + quality
 * counters. A stopped suite keeps partial results and is recorded with status
 * "stopped" — nothing is silently discarded.
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

      // ── r44 agent-vs-agent lane ────────────────────────────────────────
      // Cases with ≥2 valid agentIds pit AGENTS against each other on the
      // same single-turn task. No workflow, no run rows — metrics land
      // straight in the suite result (reply text is never stored).
      const agentLane = (c.agentIds ?? [])
        .map((id) => useAgentsStore.getState().agents.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .slice(0, SUITE_HARNESSES_MAX);
      if (agentLane.length >= 2) {
        onProgress?.({
          caseIndex: ci,
          caseTotal: suite.cases.length,
          workflowName: "Agent bake-off",
          repeat: 0,
          repeats,
        });
        const runs: SuiteCaseRun[] = [];
        outerAgents: for (const agent of agentLane) {
          for (let r = 0; r < repeats; r++) {
            if (controller.signal.aborted) break outerAgents;
            onProgress?.({
              caseIndex: ci,
              caseTotal: suite.cases.length,
              workflowName: "Agent bake-off",
              repeat: r + 1,
              repeats,
            });
            const turn = await runAgentTurn(agent.id, c.task, controller.signal);
            runs.push({
              runId: uid("agentrun"),
              status: turn.ok ? "done" : "error",
              stepsDone: turn.ok ? 1 : 0,
              stepsTotal: 1,
              ms: turn.ms,
              degraded: 0,
              reworked: 0,
              toolCallsOk: turn.toolCallsOk,
              agentId: agent.id,
            });
            if (r < repeats - 1 && !controller.signal.aborted) await sleep(SUITE_GAP_MS);
          }
          if (agent !== agentLane[agentLane.length - 1] && !controller.signal.aborted) {
            await sleep(SUITE_GAP_MS);
          }
        }
        const agentResult: SuiteCaseResult = {
          caseId: c.id,
          workflowId: "",
          workflowName: "(agent bake-off)",
          task: c.task,
          expect: c.expect,
          runs,
          doneRate: runs.length > 0 ? runs.filter((x) => x.status === "done").length / runs.length : 0,
          mode: "agents",
          agents: agentLane.map((a) => ({ id: a.id, name: a.name })),
        };
        const agg = aggregateByHarness(runs);
        agentResult.byHarness = agg.byHarness;
        agentResult.winner = agg.winner;
        result.results.push(agentResult);
        continue;
      }

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
      // r36 A/B lab: sanitize the case's harness rotation — unknown ids (old
      // persisted state, renamed presets) drop out; the list is capped. An
      // empty rotation = a single pass under the workflow's own inheritance.
      const rotation = (c.harnesses ?? []).filter(isHarnessId).slice(0, SUITE_HARNESSES_MAX);
      const lanes: (string | undefined)[] = rotation.length > 0 ? rotation : [undefined];
      onProgress?.({ caseIndex: ci, caseTotal: suite.cases.length, workflowName: wf.name, repeat: 0, repeats });

      const runs: SuiteCaseRun[] = [];
      outer: for (const lane of lanes) {
        const laneHarness = lane ? harnessById(lane) : undefined;
        for (let r = 0; r < repeats; r++) {
          if (controller.signal.aborted) break outer;
          onProgress?.({
            caseIndex: ci,
            caseTotal: suite.cases.length,
            workflowName: wf.name,
            repeat: r + 1,
            repeats,
            ...(laneHarness ? { harness: laneHarness.name } : {}),
          });
          const runId = await onceRun({
            workflow: { id: wf.id },
            task: c.task,
            source: "suite",
            suiteMeta: { suiteId, caseId: c.id, runTag: result.id },
            ...(lane ? { harnessOverride: lane } : {}),
            signal: controller.signal,
          });
          if (runId) {
            const run = useWorkflowsStore
              .getState()
              .workflows.find((w) => w.id === wf.id)
              ?.runs.find((x) => x.id === runId);
            if (run) runs.push(collectRun(run, lane));
          }
          // Rate-polite gap between repeats (never after the last one).
          if (r < repeats - 1 && !controller.signal.aborted) await sleep(SUITE_GAP_MS);
        }
        // Also pause between A/B lanes — free providers feel bursts.
        if (lane !== lanes[lanes.length - 1] && !controller.signal.aborted) await sleep(SUITE_GAP_MS);
      }

      const base: SuiteCaseResult = {
        caseId: c.id,
        workflowId: c.workflowId,
        workflowName: wf.name,
        task: c.task,
        expect: c.expect,
        runs,
        doneRate: runs.length > 0 ? runs.filter((x) => x.status === "done").length / runs.length : 0,
      };
      // A/B verdict only when the case actually rotated multiple presets —
      // single-lane cases keep the pre-r36 report shape.
      if (lanes.length > 1) {
        const { byHarness, winner } = aggregateByHarness(runs);
        base.byHarness = byHarness;
        base.winner = winner;
      }
      result.results.push(base);
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

/** r36: preset lookup exposed for board rendering (glyphs + names). */
export const SUITE_HARNESS_PRESETS = HARNESS_PRESETS;
