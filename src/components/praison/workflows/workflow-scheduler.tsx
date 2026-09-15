"use client";

import * as React from "react";
import { toast } from "sonner";
import { useWorkflowsStore } from "@/lib/stores";
import { executeWorkflowRun, isWorkflowRunning } from "@/lib/workflow-runner";

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
