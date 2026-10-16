"use client";

import * as React from "react";
import { useAgentsStore, useWorkflowsStore } from "@/lib/stores";

// ─── v20: Automation bridge (global) ─────────────────────────────────────────
// Mounted once at the app root. Every 60s it heartbeats the local server and
// pushes a snapshot of every enabled schedule (workflow + resolved step
// prompts). While this heartbeat is fresh the server-side autopilot stands
// down (the in-app scheduler drives with the user's own keys — BYOK lane);
// when the tab stays closed and the heartbeat goes stale, the server's
// headless scheduler takes over with the built-in engine.

const SYNC_INTERVAL_MS = 60_000;

export function AutomationBridge() {
  const workflows = useWorkflowsStore((s) => s.workflows);
  const agents = useAgentsStore((s) => s.agents);
  const workflowsRef = React.useRef(workflows);
  const agentsRef = React.useRef(agents);
  // Lint fix (react-hooks/refs): ref writes are banned during render — sync
  // them in an after-paint effect instead. Runs after EVERY render (no deps),
  // and before the sync effect below (effects fire in declaration order), so
  // the mount-time sync still sees hydrated stores.
  React.useEffect(() => {
    workflowsRef.current = workflows;
    agentsRef.current = agents;
  });

  React.useEffect(() => {
    let stopped = false;

    const buildPayload = () => {
      const agentMap = new Map(agentsRef.current.map((a) => [a.id, a]));
      return workflowsRef.current
        .filter((w) => w.schedule?.enabled === true && w.steps.length > 0)
        .map((w) => ({
          id: w.id,
          name: w.name,
          task:
            w.schedule?.task?.trim() ||
            w.description?.trim() ||
            `Scheduled run — carry out the "${w.name}" pipeline as designed.`,
          intervalMs: Math.max(60_000, w.schedule?.intervalMs ?? 900_000),
          enabled: true,
          steps: w.steps.map((st) => {
            const agent = agentMap.get(st.agentId);
            return {
              label: st.label,
              agentName: agent?.name,
              prompt: [agent?.instructions, st.instruction]
                .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
                .join("\n\n"),
            };
          }),
        }));
    };

    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let fastRetries = 0;

    const sync = async () => {
      try {
        const res = await fetch("/api/automation/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflows: buildPayload() }),
        });
        if (!res.ok) {
          // v21: surface the server's error body — a blind "sync failed: 500"
          // warning cost two QA rounds to root-cause (r109 + r110, both
          // mount-time sync racing the dev-server cold compile). Also: two
          // bounded 5s fast retries absorb that race without waiting the
          // full 60s heartbeat (reset on success, capped, HMR-safe).
          const detail = await res.text().catch(() => "");
          if (!stopped) console.warn("[automation-bridge] sync failed:", res.status, detail.slice(0, 200));
          if (!retryTimer && !stopped && fastRetries < 2) {
            fastRetries += 1;
            retryTimer = setTimeout(() => {
              retryTimer = null;
              void sync();
            }, 5_000);
          }
        } else {
          fastRetries = 0;
        }
      } catch {
        /* server briefly unreachable — the next heartbeat retries */
      }
    };

    void sync(); // register immediately on mount
    const t = setInterval(sync, SYNC_INTERVAL_MS);
    // r144: the hidden-tab heartbeat is INTENTIONALLY kept running — unlike
    // the r141 autopilot poll, this POST is a liveness claim ("tab alive →
    // server lane stands down"), and suppressing it while hidden would hand
    // schedules to the shared built-in gateway the moment the user merely
    // switches windows. What IS a real gap: on RETURN to a visible tab the
    // next fresh heartbeat can be up to 60s away, and in that window the
    // still-stale registration lets the headless lane claim a due run the
    // tab lane is about to fire itself. Resync the instant the tab becomes
    // visible again — lane handback lands when the user actually looks.
    const onVisibility = () => {
      if (!document.hidden) void sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  return null;
}
