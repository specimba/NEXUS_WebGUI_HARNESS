"use client";

import * as React from "react";
// r486-a (Run Archive epic): server-lane runs archive at the moment they land
// in client state (trigger "server") — closed-tab runs must not evaporate.
import { archiveServerLaneRun } from "@/lib/run-archive";
import { apiJson } from "@/lib/api-fetch";

// ─── r375: shared server-lane run poll (extracted from the runs kanban) ──────
// v24 doctrine, now in one place both consumers use: poll the headless lane
// every 60s while the consumer is open — server runs the tab never saw would
// otherwise stay invisible to it. Consumers: the runs kanban board (v24) and
// the run panel history (r375, "Server lane — closed-tab runs" group).

/** One server-lane AutomationRun row (from /api/automation/sync GET). */
export interface ServerRunRow {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger: string;
  status: string;
  currentStep: number;
  stepsTotal: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  // v25: full Prisma row rides along — per-step outputs + final report feed
  // the kanban's detail drawer.
  stepsJson?: string | null;
  finalReport?: string | null;
}

export function useServerRuns(enabled: boolean): ServerRunRow[] {
  const [serverRuns, setServerRuns] = React.useState<ServerRunRow[]>([]);
  React.useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const load = async () => {
      try {
        // r782: apiJson death-window guard on the sync poll - idempotent
        // read, retry-safe; a gateway HTML 502 page can no longer hit the
        // raw res.json() parse on the board's 60s poll.
        const { res, json } = await apiJson<{ runs?: ServerRunRow[] }>("/api/automation/sync");
        if (!res.ok) return;
        if (!stopped && Array.isArray(json.runs)) {
          setServerRuns(json.runs);
          // r486-a: land each settled server run into the local archive
          // (dedupe by id inside; "running" rows skipped until they settle).
          for (const row of json.runs) archiveServerLaneRun(row);
        }
      } catch {
        /* server briefly unreachable — next poll retries */
      }
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [enabled]);
  return serverRuns;
}
