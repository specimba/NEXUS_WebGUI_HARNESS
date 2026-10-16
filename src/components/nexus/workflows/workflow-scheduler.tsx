"use client";

import * as React from "react";
import { toast } from "sonner";
import { useWorkflowsStore } from "@/lib/stores";
import { executeWorkflowRun, isWorkflowRunning } from "@/lib/workflow-runner";
import { closeScheduleDeferral, noteScheduleDeferred } from "@/lib/schedule-skips";
import {
  gatewayQuietUntil,
  gatewaySaturated,
  MAX_AUTO_RESUME_TRIPS,
  type SaturationSignal,
} from "@/lib/gateway-cadence";

// ─── In-app workflow scheduler ───────────────────────────────────────────────
// Ticks every 10s and fires any enabled workflow schedule whose nextRunAt is
// due — INCLUDING when the browser tab is in the background (r71: users run
// pipelines unattended; browsers throttle timers there to ~1/min, which the
// re-arm logic absorbs: each due schedule simply runs once on the next tick
// and re-arms from "now"). A fully CLOSED tab still cannot run anything —
// the engine is client-side by design.

const TICK_MS = 10_000;

// ─── v24: politeness governor (the 429-burst killer) ────────────────────────
// Live evidence 2026-09-29: Deep (9 steps) + RSIinFIELD (5 steps) fired on
// the SAME second (aligned 1h schedules, no spacing) and burst the shared
// free gateway into 429 exhaustion. Two rules fix it:
//   1. START SPACING — two scheduled runs never start within 75s of each
//      other; the loser is re-armed just past the window (never lost).
//   2. JITTER — re-armed intervals get ±10%, so equal intervals that align
//      once can never stay aligned forever.
// Plus gateway-cadence: a 429 ANYWHERE quiets all scheduled starts 90s.
const START_SPACING_MS = 75_000;
const jitter = (ms: number) => Math.round(ms * (0.9 + Math.random() * 0.2));
let lastScheduledStartAt = 0;

// ─── r181: persistent saturation gate (the wave killer) ─────────────────────
// The v24 quiet window is 90s of in-memory politeness; live evidence r180→r181
// shows congestion WAVES lasting tens of minutes (429s at 57m/40m/7m ago, 17
// in 24h) — after 90s the scheduler fired straight back into the same wave
// and the r171 breaker needed 3 doomed runs to react. Now a due fire first
// asks the server's persistent 429 ring (/api/gateway/pulse — the header
// chip's own signal) whether the wave is still active, and DEFERS at zero
// cost (no run, no step-1 quota burn, no red history row) until it passes.
const PULSE_TTL_MS = 30_000; // one fetch serves every due-fire check in that window
const PULSE_TIMEOUT_MS = 3_000; // a hung telemetry fetch must never stall the tick
const SAT_DEFER_MS = 60_000; // re-arm 1m past a saturated check — the wave decides the rest
const SAT_TOAST_THROTTLE_MS = 10 * 60_000; // one ambient toast per wave, not per minute
let pulseCache: { sig: SaturationSignal; at: number } | null = null;
let pulseFetching: Promise<SaturationSignal | null> | null = null;
let lastSatToastAt = 0;

/** Read the server's gateway pulse with a short TTL cache. Fail-open: a
 * telemetry outage must never stall schedules (same doctrine as the pulse
 * module's own "never crash a dial over telemetry"). */
async function readPulse(): Promise<SaturationSignal | null> {
  if (pulseCache && Date.now() - pulseCache.at < PULSE_TTL_MS) return pulseCache.sig;
  if (!pulseFetching) {
    pulseFetching = fetch("/api/gateway/pulse", {
      cache: "no-store",
      signal: AbortSignal.timeout(PULSE_TIMEOUT_MS),
    })
      .then(async (r) => {
        if (!r.ok) return null;
        const sig = (await r.json()) as SaturationSignal;
        // Shape guard — an error-shaped body must not be cached as signal.
        if (typeof sig?.last429At !== "number" && sig?.last429At !== null) return null;
        if (typeof sig?.count1h !== "number") return null;
        pulseCache = { sig, at: Date.now() };
        return sig;
      })
      .catch(() => null)
      .finally(() => {
        pulseFetching = null;
      });
  }
  return pulseFetching;
}

/** Module-level singleton guard (StrictMode mounts effects twice). */
let ticking = false;

export function WorkflowScheduler() {
  React.useEffect(() => {
    const tick = async () => {
      if (ticking) return;
      ticking = true;
      try {
        const now = Date.now();
        const store = useWorkflowsStore.getState();

        // r171: congestion auto-resume — a rate-limit-tripped breaker re-arms
        // ITSELF once its backoff elapses (the runner sets enabled:false +
        // autoResumeAt; this tick flips it back on). The failure streak is
        // deliberately preserved so a still-saturated gateway re-trips into a
        // LONGER backoff; a successful run resets both counters (runner).
        // Stale-flag safety: autoResumeAt is cleared on every other
        // enabled↔disabled transition (manual resume/pause), so a resurrected
        // schedule can only ever come from the congestion path.
        for (const wf of store.workflows) {
          const s = wf.schedule;
          if (s && !s.enabled && typeof s.autoResumeAt === "number" && s.autoResumeAt <= now) {
            store.update(wf.id, {
              schedule: { ...s, enabled: true, autoResumeAt: undefined, nextRunAt: now },
            });
            const left = Math.max(0, MAX_AUTO_RESUME_TRIPS - (s.autoResumeTrips ?? 0));
            toast("Gateway backoff elapsed — schedule auto-resumed", {
              icon: "⏰",
              description: `"${wf.name}" was parked by rate-limit backoff and is live again (streak ${s.failStreak ?? 0} preserved · ${left} auto-resume${left === 1 ? "" : "s"} left before a manual pause).`,
            });
          }
        }

        const due = store.workflows.filter(
          (w) =>
            w.schedule?.enabled === true &&
            w.steps.length > 0 &&
            (w.schedule.nextRunAt == null || w.schedule.nextRunAt <= now) &&
            !isWorkflowRunning(w.id)
        );

        // r77: audit the deliberate skips — a due schedule whose workflow is
        // already running is deferred (never lost; the first tick after the
        // run ends fires). Episodes are logged ONCE (noteScheduleDeferred is
        // idempotent per episode — no 10s-tick spam) and closed when the
        // schedule finally fires below.
        const blocked = store.workflows.filter(
          (w) =>
            w.schedule?.enabled === true &&
            w.steps.length > 0 &&
            (w.schedule.nextRunAt == null || w.schedule.nextRunAt <= now) &&
            isWorkflowRunning(w.id)
        );
        for (const wf of blocked) noteScheduleDeferred(wf.id, wf.name);

        // r181: saturation gate — one cached pulse read serves the whole due
        // set (due fires are rare; the 10s tick itself never fetches when
        // nothing is due). Checked BEFORE the fire loop so a saturated
        // gateway defers every due start at zero cost.
        let saturated = false;
        if (due.length > 0) {
          const sig = await readPulse();
          saturated = !!sig && gatewaySaturated(sig);
        }

        for (const wf of due) {
          const schedule = wf.schedule;
          if (!schedule) continue;
          const interval = Math.max(60_000, schedule.intervalMs);
          const task =
            schedule.task.trim() ||
            (wf.description.trim()
              ? `Scheduled run — ${wf.description.trim()}`
              : "Scheduled run — carry out this pipeline as designed.");

          // r181: wave gate — a saturated gateway defers the START instead of
          // launching a doomed run. The fire is never lost: nextRunAt re-arms
          // 1m out, the audit trail records the episode, and the first quiet
          // tick fires it. The r171 auto-resume wake (above) flows through
          // this same gate, so a still-saturated wake no longer burns runs.
          if (saturated) {
            store.update(wf.id, {
              schedule: {
                ...schedule,
                nextRunAt: now + SAT_DEFER_MS + Math.round(Math.random() * 10_000),
              },
            });
            noteScheduleDeferred(wf.id, wf.name, "gateway-saturated");
            if (now - lastSatToastAt > SAT_TOAST_THROTTLE_MS) {
              lastSatToastAt = now;
              toast("Scheduled fire deferred — gateway saturated", {
                icon: "⏳",
                description: `"${wf.name}" was due, but the gateway logged a 429 within the last 10 minutes (≥3 in the past hour). The fire is deferred, not lost — it launches on the first tick after the wave passes. Zero quota burned.`,
              });
            }
            continue;
          }

          // v24: cadence gate — wait for start-spacing AND the gateway's
          // 429 quiet window. The run is deferred (never lost): re-arm just
          // past the gate so it fires on a later tick, alone.
          const earliest = Math.max(lastScheduledStartAt + START_SPACING_MS, gatewayQuietUntil());
          if (now < earliest) {
            store.update(wf.id, {
              schedule: { ...schedule, nextRunAt: earliest + Math.round(Math.random() * 10_000) },
            });
            continue;
          }
          lastScheduledStartAt = now;
          const nextAt = now + jitter(interval);

          // Re-arm FIRST so a slow start can never double-fire on the next tick
          store.update(wf.id, {
            schedule: { ...schedule, lastRunAt: now, nextRunAt: nextAt },
          });

          // r77: if this fire ends a deferral episode, stamp it — the audit
          // line under the workflow card then reads "deferred X — fired Y".
          closeScheduleDeferral(wf.id, now);

          // r185 (user report: "0 progression getting worse and worse"): the
          // user's own board shows the pattern — the only never-completing
          // pipelines are DEEP ones on the unstable free lane (12 runs / 0
          // done, each burning 45min–2.3h and up to 73 tool calls before
          // dying at a deep pass), while Standard pipelines complete. Imp
          // (deepfates/imp, DSPy on the BEAM) doctrine applied at fire time:
          // run what the lane can actually sustain, measured. 2+ consecutive
          // failures on a Deep workflow fire Standard; the first completed
          // run resets failStreak and deep restores itself. Manual Run keeps
          // the authored depth — the user chooses their own risk.
          const degraded =
            (wf.schedule?.failStreak ?? 0) >= 2 && (wf.depth ?? "standard") === "deep";
          if (degraded) {
            // Audit trail: an episode that opens and closes at the same tick —
            // the card line reads "fired at standard depth … deep paused".
            noteScheduleDeferred(wf.id, wf.name, "depth-degraded");
            closeScheduleDeferral(wf.id, now);
          }

          toast(`Scheduled run started`, {
            icon: "⏰",
            description: `${wf.name} · every ${Math.round(interval / 60_000)}m${
              degraded ? " · standard depth (deep passes paused — lane unstable)" : ""
            }`,
          });

          void executeWorkflowRun({
            workflow: { id: wf.id },
            task,
            source: "scheduled",
            depthOverride: degraded ? "standard" : undefined,
          }).catch(() => {
            /* runner already surfaces step errors in the run row + toasts */
          });
        }
      } finally {
        ticking = false;
      }
    };

    void tick(); // catch any schedule that came due while unmounted
    const t = setInterval(tick, TICK_MS);
    return () => clearInterval(t);
  }, []);

  return null;
}
