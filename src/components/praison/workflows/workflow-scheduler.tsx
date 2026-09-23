"use client";

import * as React from "react";
import { toast } from "sonner";
import { useSuitesStore, useWorkflowsStore } from "@/lib/stores";
import { executeWorkflowRun, isWorkflowRunning } from "@/lib/workflow-runner";
import { isSuiteRunning, runSuite } from "@/lib/suite-runner";
import { SUITE_REPEATS_MAX, SUITE_SCHEDULE_FAIL_BREAKER, SUITE_SCHEDULE_MIN_MS } from "@/lib/constants";
import { fmtIntervalShort } from "@/lib/helpers";
import { harnessById } from "@/lib/harness";
import type { SuiteAdoption } from "@/lib/types";

// ─── In-app workflow scheduler ───────────────────────────────────────────────
// Ticks every 10s and fires any enabled workflow schedule whose nextRunAt is
// due. Runs only fire while the app tab is open; runs missed while the app
// was closed are skipped (each due schedule simply runs once on the next
// tick and re-arms from "now").

const TICK_MS = 10_000;

/** Module-level singleton guard (StrictMode mounts effects twice). */
let ticking = false;

export function WorkflowScheduler() {
  React.useEffect(() => {
    const tick = () => {
      if (ticking || document.visibilityState === "hidden") return;
      ticking = true;
      try {
        const now = Date.now();
        const store = useWorkflowsStore.getState();
        const due = store.workflows.filter(
          (w) =>
            w.schedule?.enabled === true &&
            w.steps.length > 0 &&
            (w.schedule.nextRunAt == null || w.schedule.nextRunAt <= now) &&
            !isWorkflowRunning(w.id)
        );

        for (const wf of due) {
          const schedule = wf.schedule;
          if (!schedule) continue;
          const interval = Math.max(60_000, schedule.intervalMs);
          const task =
            schedule.task.trim() ||
            (wf.description.trim()
              ? `Scheduled run — ${wf.description.trim()}`
              : "Scheduled run — carry out this pipeline as designed.");
          const nextAt = now + interval;

          // Re-arm FIRST so a slow start can never double-fire on the next tick
          store.update(wf.id, {
            schedule: { ...schedule, lastRunAt: now, nextRunAt: nextAt },
          });

          toast(`Scheduled run started`, {
            icon: "⏰",
            description: `${wf.name} · every ${Math.round(interval / 60_000)}m`,
          });

          void executeWorkflowRun({
            workflow: { id: wf.id },
            task,
            source: "scheduled",
          }).catch(() => {
            /* runner already surfaces step errors in the run row + toasts */
          });
        }
      } finally {
        ticking = false;
      }
    };

    tick(); // catch any schedule that came due while unmounted
    const t = setInterval(tick, TICK_MS);
    return () => clearInterval(t);
  }, []);

  return null;
}

// ─── r37: Suite bake-off scheduler ───────────────────────────────────────────
// Same doctrine as the workflow scheduler, pointed at suites: a 10s tick fires
// any enabled suite schedule whose nextRunAt is due, RE-ARMING BEFORE the
// bake-off starts so a slow round can never double-fire. Quota discipline:
// never two suites at once (isSuiteRunning gate), 30-min cadence floor
// (SUITE_SCHEDULE_MIN_MS, clamped at arm time), and a failure breaker that
// auto-pauses a suite after repeated all-fail scheduled rounds.

/** Module-level singleton guard (StrictMode mounts effects twice). */
let suiteTicking = false;

export function SuiteScheduler() {
  React.useEffect(() => {
    const tick = () => {
      if (suiteTicking || document.visibilityState === "hidden") return;
      suiteTicking = true;
      try {
        const now = Date.now();
        const store = useSuitesStore.getState();
        const due = store.suites.filter(
          (s) =>
            s.schedule?.enabled === true &&
            s.cases.length > 0 &&
            (s.schedule.nextRunAt == null || s.schedule.nextRunAt <= now) &&
            !isSuiteRunning()
        );

        for (const suite of due) {
          const schedule = suite.schedule;
          if (!schedule) continue;
          const interval = Math.max(SUITE_SCHEDULE_MIN_MS, schedule.intervalMs);
          const repeats = Math.min(Math.max(1, schedule.repeats || 1), SUITE_REPEATS_MAX);

          // Re-arm FIRST — a slow bake-off can never double-fire on the next tick.
          store.update(suite.id, {
            schedule: { ...schedule, lastRunAt: now, nextRunAt: now + interval, repeats },
          });

          toast(`Scheduled bake-off started`, {
            icon: "🔬",
            description: `${suite.name} · every ${fmtIntervalShort(interval)} · ${repeats} repeat${repeats === 1 ? "" : "s"} per case — real quota spend`,
          });

          void runSuite(suite.id, repeats).then((result) => {
            if (!result) return; // aborted by a manual run taking over, etc.
            // Failure breaker: an all-fail scheduled round (overall done-rate
            // 0 across executed cases) counts toward the streak; any round
            // with a completed case resets it. ≥3 → auto-pause honestly.
            const executed = result.results.filter((r) => r.runs !== "skipped" && r.runs.length > 0);
            const overall = executed.length > 0
              ? executed.reduce((a, r) => a + r.doneRate, 0) / executed.length
              : 0;
            const fresh = useSuitesStore.getState().suites.find((s) => s.id === suite.id);
            const sched = fresh?.schedule;
            if (!sched?.enabled) return; // disarmed while running — leave it be
            const streak = overall > 0 ? 0 : (sched.failStreak ?? 0) + 1;
            if (streak >= SUITE_SCHEDULE_FAIL_BREAKER) {
              useSuitesStore.getState().update(suite.id, {
                schedule: { ...sched, enabled: false, failStreak: streak },
              });
              toast.warning("Scheduled bake-off paused by failure breaker", {
                icon: "🛑",
                description: `${suite.name} finished 0% done ${streak} rounds in a row — schedule disarmed to protect quota. Re-arm it from the Suites board.`,
                duration: 12_000,
              });
            } else {
              useSuitesStore.getState().update(suite.id, {
                schedule: { ...sched, failStreak: streak > 0 ? streak : 0 },
              });
            }

            // ── r39 auto-adoption (opt-in) ────────────────────────────────
            // The nightly bake-off applies its own verdict: a scheduled
            // round's case winners become the workflows' default harnesses
            // without asking. Manual board runs never adopt — you clicked
            // run, you keep control. Every applied change (and the honest
            // no-op when nothing changed) lands in suite.lastAdoption.
            if (sched.autoAdopt && result.status === "complete") {
              const winnerByWorkflow = new Map<string, string>();
              for (const r of result.results) {
                if (r.runs === "skipped" || !r.winner) continue;
                winnerByWorkflow.set(r.workflowId, r.winner);
              }
              const wfStore = useWorkflowsStore.getState();
              const entries: SuiteAdoption["entries"] = [];
              for (const [workflowId, harness] of winnerByWorkflow) {
                const wf = wfStore.workflows.find((w) => w.id === workflowId);
                if (!wf) continue; // deleted behind the case — nothing to adopt onto
                if (wf.harness === harness) continue; // already defaulting to the winner
                wfStore.update(workflowId, { harness });
                entries.push({
                  workflowId,
                  workflowName: wf.name,
                  ...(wf.harness ? { from: wf.harness } : {}),
                  to: harness,
                });
              }
              useSuitesStore.getState().update(suite.id, {
                lastAdoption: { at: Date.now(), entries },
              });
              if (entries.length > 0) {
                toast.success("Bake-off verdicts applied automatically", {
                  icon: "⚖️",
                  description: entries
                    .map((e) => `“${e.workflowName}” → ${harnessById(e.to).name}`)
                    .join(" · "),
                  duration: 10_000,
                });
              }
            }
          });
        }
      } finally {
        suiteTicking = false;
      }
    };

    tick();
    const t = setInterval(tick, TICK_MS);
    return () => clearInterval(t);
  }, []);

  return null;
}
