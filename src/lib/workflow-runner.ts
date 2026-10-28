// ─── Shared workflow run engine (used by the run panel AND the scheduler) ────

import { toast } from "sonner";
import { runText, scoreNovelty } from "@/lib/evolution";
import {
  gatewayQuietUntil,
  jitteredBackoff,
  noteGateway429,
  rateLimitResumeDelayMs,
  MAX_AUTO_RESUME_TRIPS,
} from "@/lib/gateway-cadence";
import { buildAngleHistory, latestScoredNovelty, maybeProposeSpawn, withFrontierSeed, NOVELTY_SPAWN_THRESHOLD } from "@/lib/spawn-proposal-engine";
import { buildDefaultConstraints } from "@/lib/constraint-block";
import { LOOP_PASSES_CAP } from "@/lib/looped-icl";
// r652: precedent-exemplar lane — engine injection (slice 2). The same pure
// layer the r651 authoring preview uses; no second mapper, no drift.
import {
  archiveRowsToPrecedents,
  isConfidentTop,
  precedentRetrieval,
} from "@/lib/precedent-lane";
import type { FrontierSeedRef } from "@/lib/spawn-proposal-engine";
// r511 frontier seeding: the browser-side seed ledger the radar's Frontier tab
// writes — stall proposals get enriched with the freshest unused seed.
import { readFrontierSeeds } from "@/lib/frontier-scout";
import { isAbortError, runAgentChat } from "@/lib/chat-client";
import { archiveRun, engineStatusToArchiveStatus, listArchiveFull } from "@/lib/run-archive";
import { maxParks, parkDelayMs, resolvePark, type ParkKind } from "@/lib/park-policy";
import { safeErrorMessage } from "@/lib/error-message";
import {
  DEEP_PASSES,
  DEEP_RESEARCH_INSTRUCTION,
  deepPassSkipNote,
  isSyntheticDeepStep,
  isTransientErrorKind,
} from "@/lib/deep-pass";
// r306 reconciliation: the runner wires BOTH rotation halves — lane-rotation
// owns family-window demotion (wire ORDER + same-family retry pacing),
// provider-rotation owns registry-wide lane switching (LEAVING the family).
// Single note path: every mechanism reports through `relayNotes`.
import {
  nextRotation,
  noteProvider429,
  noteProviderBilling,
  noteProviderFailure,
  provider429CooldownLeftMs,
  resetProvider429,
  clearRescueLane,
  liveRescueLaneId,
  noteRescueLane,
  BILLING_DEAD_MS,
} from "@/lib/provider-rotation";
import {
  congestionCooldownMs,
  laneFamilyKey,
  laneSickUntil,
  noteLane429,
  noteLaneFailure,
  rotateHops,
  type LaneSaturation,
} from "@/lib/lane-rotation";
import { resolveExplicitLlm, resolveLlm, type ResolvedLlm } from "@/lib/llm-config";
import { decide, GATE_MIN_CHARS, SYSTEMONE_GATE_CONFIDENCE } from "@/lib/systemone";
import { gateEventsOf } from "@/lib/gate-census";
import {
  BLIND_REVIEW_QUESTION,
  buildBlindReviewInput,
  peerBlindNote,
  peerBlindShouldRevise,
} from "@/lib/peer-blind-score";
import { buildRelayWire, parseRelayStatusLine, recordRelayStatusLine, stripRelayMarkers, type RelayTaskFit, type RelayWireHop } from "@/lib/relay";
// r512 pinned-lane auto-retire: pins materialize against the adopted-lane
// registry's retirement state + the tracker removal mirror; a lane the
// catalog dropped never dials (falls through to rotation instead).
import { laneRetirementReason, noteRemovalStrike } from "@/lib/lane-adopt";
// r512 crew judge-gates: role definitions carry the gate question template
// + threshold; the runner derives the agent's role the same way the crew
// panel does (crewRoleIdForAgent keyword map — no roleId is stored).
import { CREW_ROLE_DEFS, crewRoleIdForAgent } from "@/lib/crew";
import {
  buildConversationalContext,
  buildReviewContext,
  buildSequentialContext,
  parseReviewVerdict,
  uid,
  type PrevStepOutput,
} from "@/lib/helpers";
import {
  useAgentsStore,
  useSettingsStore,
  useUiStore,
  useWorkflowsStore,
} from "@/lib/stores";
import { REWORK_LIMIT } from "@/lib/constants";
import type {
  Agent,
  PipelineDepth,
  RunCallLogEntry,
  RunErrorInfo,
  RunErrorKind,
  ToolCallInfo,
  AnyToolId,
  ToolId,
  Workflow,
  WorkflowRun,
  WorkflowRunStep,
} from "@/lib/types";

/** Workflows with a run currently streaming — guards concurrent triggers. */
const activeRuns = new Set<string>();

// ─── Run liveness (r71): every run is guaranteed to reach a terminal state ──
// A streaming fetch can hang forever (provider drops the connection without
// closing it, laptop sleep, heavy background-tab throttling) and the run row
// would sit at "running" for eternity. The watchdog aborts any active run
// with no store activity for STALL_TIMEOUT_MS; the run then finalizes as a
// RESUMABLE timeout error — never a silent hang.
const activeControllers = new Map<string, AbortController>();
const lastRunActivity = new Map<string, number>();
const stalledRuns = new Set<string>();
/** Stall watchdog threshold — runtime-tunable (r75): set localStorage
 * "nexus-stall-timeout-ms" and reload; clamped 20s–10min so an E2E can
 * force stalls in seconds WITHOUT a rebuild, while production keeps 4min.
 * Read live per watchdog tick (one localStorage read per tick). */
function stallTimeoutMs(): number {
  const DEF = 4 * 60_000;
  try {
    const raw = localStorage.getItem("nexus-stall-timeout-ms");
    if (!raw) return DEF;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 20_000), 600_000) : DEF;
  } catch {
    return DEF;
  }
}
/** Human label for timeout messages, so tuned timeouts don't lie in the UI. */
function stallTimeoutLabel(): string {
  const ms = stallTimeoutMs();
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`;
}
/** Bounded self-recovery (r72): a watchdog-stalled run auto-resumes from its
 * failed step up to MAX_AUTO_RESUMES times (shared budget with manual resumes
 * — both bump resumeCount) before falling back to the manual-resume card. */
import { clearWorkerInterval, setWorkerInterval, setWorkerTimeout } from "@/lib/worker-timer";

const MAX_AUTO_RESUMES = 3;

// ─── r158 (user report, 2nd occurrence): rate-limit PARK-AND-RESUME ─────────
// Live evidence: the user's hourly Continuous Research pipeline died at step
// 1/11 AGAIN with kind=rate-limit — 3 LLM calls, 3 failed. The self-heal
// ladder's cooldowns (20s + 45s ≈ 65s of waiting) are far shorter than the
// minutes-long saturation window of the shared free gateway, so every attempt
// lands inside the same 429 window and the step — then the whole run — dies.
// Schedule-level backoff (r156) only helps scheduled runs; a manual run just
// burns into the wall. Doctrine shift: a rate-limit-dead STEP no longer kills
// the RUN while park budget remains — the run finalizes honestly ("error",
// recovery card, r157 history chip, breaker) and then AUTO-RESUMES after a
// long, escalating wait (5m → 10m → 20m) that outlives the quota window.
// Completed steps are preserved by the normal resume path. Budget is a
// dedicated parkCount (NOT resumeCount — stalls and manual resumes share that
// one; a flaky-gateway deep run could plausibly need both). Parks are live
// only while the app tab is open (worker timers die with the tab) — the
// headless lane keeps its own independent backoff, so nothing is lost.
// r171: budget extended 3→4 parks, cap 20m→30m — 5+10+20+30 = 65m of parked
// waiting, which for the first time outlives a FULL hourly congestion wave
// (pulse-verified: the global free gateway saturates in on-the-hour bursts).
// Each delay is ±20% jittered so concurrent parked runs don't re-dial in
// lockstep with the very cron wave they're hiding from.
// r178: park curves + budgets for BOTH kinds moved to src/lib/park-policy.ts
// (pure, unit-testable); network/timeout deaths now park too — the user's
// r177 report died at "Error: network error" and stayed dead, because the
// r158 park covered quota congestion only. PARK_REARM_MS/MAX_PARK_REARMS
// below are re-arm mechanics shared by both kinds.
const PARK_REARM_MS = 60_000;
const MAX_PARK_REARMS = 5;

// r305 (user directive: "why is there no model or provider rotation while we
// have dozens of them?"): per-FAMILY 429 saturation memory, module-scoped so
// it outlives single runs — a lane that just ate a 429 is demoted for every
// later step and retry (in ANY run of this tab) until its window passes.
// Pure rules live in lib/lane-rotation.ts; this map is the tab-wide memory
// they operate on. The "auto" family is intentionally never noted here —
// gateway-cadence owns the built-in engine's politeness.
const laneSaturation = new Map<string, LaneSaturation>();
const STALL_CHECK_MS = 15_000;
const STALL_WATCHDOG_KEY = "nexus-stall-watchdog";
let stallWatchdog: ReturnType<typeof setInterval> | null = null;

/** Live controller for a workflow's active run — lets the UI re-acquire Stop after a remount. */
export function getRunController(workflowId: string): AbortController | undefined {
  return activeControllers.get(workflowId);
}

function stopStallWatchdog(): void {
  clearWorkerInterval(STALL_WATCHDOG_KEY);
  if (stallWatchdog != null) {
    clearInterval(stallWatchdog);
    stallWatchdog = null;
  }
}

function ensureStallWatchdog(): void {
  if (stallWatchdog) return;
  const tick = () => {
    const now = Date.now();
    for (const wfId of [...activeRuns]) {
      if (now - (lastRunActivity.get(wfId) ?? 0) > stallTimeoutMs()) {
        // Mark + abort: the pending fetch rejects with an AbortError, the
        // runner's abort handlers check stalledRuns and finalize as timeout.
        stalledRuns.add(wfId);
        activeControllers
          .get(wfId)
          ?.abort(
            new Error(
              `no model output for over ${stallTimeoutLabel()} — the stream stalled`
            )
          );
      }
    }
    if (activeRuns.size === 0) {
      stopStallWatchdog();
    }
  };
  const ms = Math.min(STALL_CHECK_MS, Math.floor(stallTimeoutMs() / 4));
  // v20: run the cadence on the worker clock when possible — background tabs
  // clamp main-thread timers to ~1/min (intensive throttling), which turned
  // stall detection into multi-minute hangs. Fallback keeps old behavior.
  if (!setWorkerInterval(STALL_WATCHDOG_KEY, ms, tick)) {
    stallWatchdog = setInterval(tick, ms);
  }
}

export function isWorkflowRunning(workflowId: string): boolean {
  return activeRuns.has(workflowId);
}

export function activeRunCount(): number {
  return activeRuns.size;
}

/**
 * Bounded stall self-recovery (r72): ~1.2s after a watchdog-aborted run has
 * been finalized, re-enter executeWorkflowRun through the normal resume path
 * (completed steps preserved, execution restarts at the failed step).
 * The delay is load-bearing: the dying invocation's `finally` wipes the module
 * registries (activeRuns/activeControllers) and the resumed call re-registers
 * them SYNCHRONOUSLY — firing immediately would let that finally delete the
 * NEW registration. Guarded re-entry: skipped when the run vanished, a user
 * already resumed/stopped it, or another run holds the engine.
 */
function scheduleAutoResume(
  workflowId: string,
  runId: string,
  fromStepIndex: number,
  previousResumes: number
): void {
  const fireAutoResume = () => {
    const wf = useWorkflowsStore
      .getState()
      .workflows.find((w) => w.id === workflowId);
    const run = wf?.runs.find((r) => r.id === runId);
    if (!wf || !run || run.status === "running") return; // user resumed/stopped
    if (activeRuns.has(workflowId)) return; // engine busy with another run
    toast("Stall auto-recovery engaged", {
      icon: "⏱️",
      description: `"${run.steps[fromStepIndex]?.label ?? "Failed step"}" went silent for 4+ minutes — resuming "${wf.name}" from there (auto-resume ${previousResumes + 1}/${MAX_AUTO_RESUMES}, completed steps preserved).`,
    });
    executeWorkflowRun({
      workflow: wf,
      task: run.task,
      resume: { runId, fromStepIndex },
      source: "scheduled",
    }).catch((err) => {
      // v23: a rejected auto-resume used to surface as an unhandled rejection
      // ("Runtime Error: undefined"). The runner is resolve-only now; this
      // guard is the belt to those suspenders.
      console.error("[workflow-runner] auto-resume failed", err);
    });
  };
  // v20: worker-clock delay — a backgrounded tab clamps main-thread timers,
  // which stretched the 1.2s re-entry into minutes right after a stall abort.
  if (!setWorkerTimeout(`auto-resume-${runId}`, 1200, fireAutoResume)) {
    setTimeout(fireAutoResume, 1200);
  }
}

/**
 * r158: long-delay sibling of scheduleAutoResume for parks (rate-limit; r178
 * adds the network/timeout sibling via `parkKind`).
 * Re-enters the run through the normal resume path after parkDelayMs(parkKind,
 * parkIndex) — 5m → 10m → 20m → 30m for quota parks, 2m → 4m → 8m for network
 * parks — long enough to outlive the failure window that the 65s self-heal
 * ladder cannot. Differences from the stall path, per the
 * adversarial design review:
 *  - guards run BEFORE any toast (a park whose run row was evicted/deleted
 *    must die silently, never announce a resume that can't happen);
 *  - busy/gateway-quiet collisions RE-ARM (+60s, bounded) instead of silently
 *    dropping the park — at 5-minute scale the schedule firing a fresh run
 *    into the lane during the wait is LIKELY, and a silent drop would strand
 *    the parked run forever;
 *  - only an "error" row is resumed — a row the user stopped (or already
 *    resumed) is theirs now;
 *  - originSource is passed through: a manual run's parks stay manual, so a
 *    manual fire into a saturated gateway can never trip the r156 schedule
 *    breaker (2-strike auto-pause) on the schedule lane's behalf;
 *  - on a done settle, an overdue schedule is re-armed from now (+jitter) —
 *    without this, the scheduler's r77 deferral fires a fresh duplicate
 *    full-pipeline run minutes after the parked one completes.
 * HMR caveat: dev reloads drop pending worker timers (same class as the stall
 * timer) — a dev-only park loss, accepted.
 */
function scheduleParkResume(
  workflowId: string,
  runId: string,
  fromStepIndex: number,
  parkIndex: number,
  originSource: "manual" | "scheduled",
  parkKind: ParkKind,
  rearms = 0
): void {
  const reArm = (extraDelay: number, nextRearms: number) => {
    if (!setWorkerTimeout(`park-resume-${runId}`, extraDelay, () =>
      scheduleParkResume(workflowId, runId, fromStepIndex, parkIndex, originSource, parkKind, nextRearms)
    )) {
      setTimeout(
        () => scheduleParkResume(workflowId, runId, fromStepIndex, parkIndex, originSource, parkKind, nextRearms),
        extraDelay
      );
    }
  };
  const fire = () => {
    const wf = useWorkflowsStore
      .getState()
      .workflows.find((w) => w.id === workflowId);
    const run = wf?.runs.find((r) => r.id === runId);
    if (!wf || !run) return; // deleted / evicted (runs 12-cap) — drop silently
    if (run.status !== "error") return; // user resumed/stopped it — theirs now
    if (activeRuns.has(workflowId) || Date.now() < gatewayQuietUntil()) {
      // Engine busy (e.g. the schedule fired a fresh run during the wait) or
      // other workflows are still eating 429s — re-arm, never silent-drop.
      if (rearms < MAX_PARK_REARMS) reArm(PARK_REARM_MS, rearms + 1);
      return;
    }
    // r171 rotation (user report: "rotation wise strategies"): a parked resume
    // never re-dials the lane that just proved saturated — it rotates to the
    // server relay (forceServer), whose health-ordered hop chain (r25: wire
    // rebuilt per attempt, sick primaries demoted, dead hops skipped) ends in
    // the built-in engine's own quota family. Same machinery as the manual
    // "Retry via relay" button — triggered by congestion history instead of a
    // human noticing. If the whole chain is saturated the park ladder simply
    // continues with its growing waits.
    toast(
      parkKind === "network"
        ? "Network unreachable — resuming parked run via relay rotation"
        : "Gateway congested — resuming parked run via relay rotation",
      {
        icon: "⏳",
        description: `"${run.steps[fromStepIndex]?.label ?? "Failed step"}" was parked on a ${parkKind === "network" ? "network failure" : "429"} — resuming "${wf.name}" from there through the model relay lane (park ${parkIndex + 1}/${maxParks(parkKind)}, completed steps preserved).`,
      }
    );
    const resumed = executeWorkflowRun({
      workflow: wf,
      task: run.task,
      resume: { runId, fromStepIndex },
      source: originSource,
      forceServer: true,
      onSettled: (_settledId, status) => {
        if (status !== "done") return;
        // Companion fix: a parked-then-completed run must not trigger the
        // scheduler's r77 deferral into a duplicate full-pipeline fire.
        try {
          const st = useWorkflowsStore.getState();
          const sched = st.workflows.find((w) => w.id === workflowId)?.schedule;
          if (sched?.enabled && (sched.nextRunAt == null || sched.nextRunAt <= Date.now())) {
            const interval = Math.max(60_000, sched.intervalMs);
            st.update(workflowId, {
              schedule: {
                ...sched,
                nextRunAt: Date.now() + Math.round(interval * (0.9 + Math.random() * 0.2)),
              },
            });
          }
        } catch {
          /* cadence restore is best-effort */
        }
      },
    });
    resumed
      ?.catch((err) => {
        console.error("[workflow-runner] park-resume failed", err);
      });
  };
  if (!setWorkerTimeout(`park-resume-${runId}`, parkDelayMs(parkKind, parkIndex), fire)) {
    setTimeout(fire, parkDelayMs(parkKind, parkIndex));
  }
}

export interface ExecuteRunOptions {
  workflow: Pick<Workflow, "id">;
  task: string;
  /** "scheduled" runs toast with a clock icon and a distinct message. */
  source?: "manual" | "scheduled";
  /** r185 (user report: "0 progression"): scheduled fires of a DEEP workflow
   * with a failing streak downgrade to "standard" — the deep passes are the
   * steps that never survive an unstable lane. The authored workflow is
   * untouched; failStreak resets on the next done run, restoring deep. */
  depthOverride?: PipelineDepth;
  /** Called right after the run row is created (panel uses it to view + wire Stop). */
  onStarted?: (runId: string, controller: AbortController) => void;
  /** Called with the final status whether done, stopped or errored. */
  onSettled?: (runId: string, status: WorkflowRun["status"]) => void;
  /** Optional external stop handle — defaults to the runner's own controller. */
  signal?: AbortSignal;
  /**
   * v11 "Retry via relay": when true, every model call in this execution skips
   * the browser-direct lane and runs through the server relay (/api/chat).
   * Recovery-card escape hatch for steps whose DIRECT lane died mid-stream
   * (sawTokens deaths rethrow by design — the auto-fallback only covers
   * pre-stream failures), or whose direct provider is otherwise unusable.
   */
  forceServer?: boolean;
  /**
   * Resume an existing errored/stopped run instead of creating a new row:
   * completed step outputs are preserved, execution restarts at fromStepIndex.
   * When set, `task` is ignored (the run's original task is reused).
   */
  resume?: { runId: string; fromStepIndex: number };
}

// ─── Failure classification (powers the non-silent recovery card) ───────────

const ERROR_KIND_META: Record<RunErrorKind, { label: string; hint: string }> = {
  network: {
    label: "Network",
    hint: "The connection to the model provider dropped mid-run. This is usually transient — retrying the failed step keeps every completed step's output.",
  },
  region: {
    label: "Region block",
    hint: "The provider refuses datacenter IPs — this is a network-location block, NOT a key problem. Browser-direct mode (on by default) calls from your own network and avoids it; if you still see this, the relay already rotated to another lane — retry the step.",
  },
  auth: {
    label: "Auth",
    hint: "The API key was rejected (expired, revoked or wrong). Fix the key in Settings → Free frontier providers, then retry the failed step.",
  },
  "rate-limit": {
    label: "Rate limit",
    hint: "The provider's free-tier quota tripped (429). Wait a minute — or switch to another free provider in the header picker — then retry the failed step.",
  },
  billing: {
    label: "Out of credits",
    hint: "The provider's credit balance is drained — re-dialing cannot fix a wallet at $0.00 (HTTP 402, or a 403 whose body says the balance is insufficient). Add credits on the provider's billing console, or save a second provider key so the rotation has another lane to dial; this lane is quarantined for 6 hours and the relay already skips it.",
  },
  timeout: {
    label: "Timeout",
    hint: "The provider took too long to answer. Retry usually helps; if it keeps happening, try a smaller/faster model for this step.",
  },
  model: {
    label: "Model",
    hint: "The model id no longer exists on this provider (renamed or decommissioned). Open Settings → the provider card → “Refresh models” to pull the current roster, pick a live model, then retry. The relay already skipped past it.",
  },
  unknown: {
    label: "Unknown",
    hint: "The provider returned an error we couldn't classify. Copy the diagnostics below for details — retrying the failed step is still safe.",
  },
};

const ERROR_PATTERNS: { kind: RunErrorKind; re: RegExp }[] = [
  { kind: "rate-limit", re: /\b429\b|rate.?limit|quota|too many requests/i },
  {
    // r310: prepaid credit gates (HTTP 402) are billing deaths — the wallet
    // needs a HUMAN top-up, so the lane is a corpse until then (r187 DEAD,
    // not the 5-minute hard window that kept re-dialing it all run long).
    // r332 (user report): Vyce phrases the same death on a 403 — "Your
    // account balance is insufficient. Please recharge…" — REVERSED word
    // order plus recharge phrasing. Both were invisible to this pattern,
    // so the message fell through to kind "auth" ("fix your key" advice
    // for a healthy key) with no rotation memory fed.
    kind: "billing",
    re: /\b402\b|out of credits|insufficient (?:credits?|balance|funds)|(?:credits?|balance|funds) (?:is|are) insufficient|please recharge|credit.?gate|add credits|payment required/i,
  },
  {
    // BEFORE auth: a 403 with block-page signatures is a location block, not
    // a key problem — "Access forbidden (check key/region)" alone stays auth.
    kind: "region",
    re: /blocked this network|region\/?IP block|datacenter|server-region|\b451\b/i,
  },
  { kind: "auth", re: /\b(401|403)\b|unauthorized|invalid.{0,12}(api )?key|invalid.?key|forbidden|permission denied/i },
  { kind: "model", re: /\b404\b|no such model|model.?not.?found|model (.{0,40} )?does not exist|model_not_found|endpoint not found|decommissioned|does not exist or is not supported/i },
  { kind: "timeout", re: /timeout|timed? ?out|etimedout|deadline|did not respond|no first token|upstream deadline|stream stalled/i },
  {
    kind: "network",
    // r330: a BARE 5xx status ("Request failed (502)" — the fetch wrapper's
    // phrasing: no "http " prefix, no "bad gateway" text) used to fall through
    // to kind "unknown" = terminal card with NO park and NO relay rotation.
    // A gateway 5xx is the same transient server-side death the r158/r178
    // doctrine parks and rotates — classify it network (self-heal +
    // park-eligible) instead. Word-boundary + exact-3-digits keeps it off
    // numbers embedded in larger tokens.
    re: /network|fetch failed|failed to fetch|could not reach|socket|econn|enotfound|eai_again|dns|connection (refused|reset|closed|error)|load failed|premature close|stream ended without|upstream|http 5\d\d|\b5\d\d\b|bad gateway|service unavailable/i,
  },
];

/** Failure kinds the runner heals by itself (one automatic step retry).
 * Exported so UI surfaces share the exact same "retrying helps" envelope. */
export const SELF_HEAL_KINDS: RunErrorKind[] = ["network", "timeout", "rate-limit"];

/**
 * r126: how long a mid-stream-dropped primary stays demoted for the REST of
 * the run. Matches the providers' own 5-minute telemetry windows (Vyce's
 * status page reports "Avg Latency (5m)" — a bad window typically outlives a
 * single step, so per-step demotion re-learned the same sickness 11 times).
 */
const PRIMARY_SICK_MS = 5 * 60_000;

/** Classify an engine error message → kind + copy used by the recovery card. */
export function classifyRunError(message: string): {
  kind: RunErrorKind;
  hint: string;
} {
  for (const { kind, re } of ERROR_PATTERNS) {
    if (re.test(message)) return { kind, hint: ERROR_KIND_META[kind].hint };
  }
  return { kind: "unknown", hint: ERROR_KIND_META.unknown.hint };
}

export function runErrorKindLabel(kind: RunErrorKind): string {
  return ERROR_KIND_META[kind].label;
}

// ─── Pipeline depth (r26): synthetic passes injected at materialization ──────
// r654: DEEP_RESEARCH_INSTRUCTION + DEEP_PASSES moved verbatim to the pure
// module src/lib/deep-pass.ts (QA-importable; the runner re-imports them) —
// the non-fatality predicates and the pass definitions can never drift apart.

const VERIFICATION_INSTRUCTION =
  "VERIFICATION PASS (final pipeline step — your reply IS the deliverable): silently check the " +
  "conversation context for unsupported claims, missing citations, and gaps. Use the tools " +
  "available (web_search / arxiv_search) to verify load-bearing facts where needed. Then output " +
  "the FULL corrected, tightened version of the previous step's output — never a plan, never an " +
  "announcement of what you are about to do, never a summary of changes alone. If you called " +
  "tools, continue after their results and still deliver the complete final output in this same " +
  "reply. End with a one-line 'Verification:' note listing what you checked.";

/**
 * Fresh-run step materialization with depth control (r26).
 * - quick:    exactly as authored (no injection)
 * - standard: + one synthetic "Verification & synthesis" pass at the end when
 *             the pipeline has NO review-gate step (a real review gate already
 *             provides verification semantics)
 * - deep:     + 2 deep-research passes cloned from the FIRST step's agent
 *             (inserted right after it), then the same verification pass
 *             Missing depth reads as "standard" (pre-r26 workflows keep working).
 *
 * Resume is deliberately NOT routed through here: resumed runs re-use their
 * already-materialized step rows, so old runs stay byte-identical.
 */
export function materializeRunSteps(wf: Workflow, agentsNow: Agent[], depthOverride?: PipelineDepth): WorkflowRunStep[] {
  const base: WorkflowRunStep[] = wf.steps.map((s) => {
    const agent = agentsNow.find((a) => a.id === s.agentId);
    return {
      stepId: s.id,
      agentId: s.agentId,
      agentName: agent?.name ?? "Unknown agent",
      agentEmoji: agent?.emoji ?? "🤖",
      label: s.label || "Untitled step",
      // r182: explicit role travels with the run so run rows prefer it over
      // the parsed "[Tag]" label prefix (directive item (a) completion).
      roleId: s.roleId,
      // r644: looped-depth opt-in travels with the run (absent = legacy).
      loopedPasses: s.loopedPasses,
      // r503: the lane this step dials — step pin wins, pipeline default
      // second, absent = follow the agent/global (chip shows only when set).
      lane: s.lane?.trim() ? s.lane.trim() : wf.lane?.trim() ? wf.lane.trim() : undefined,
      output: "",
      toolCalls: [],
      // r80: honest queue state — the engine loop flips the executing step to
      // "running" via its start-of-step patch (workflow-runner line ~772).
      status: "pending" as const,
      kind: s.kind ?? "generate",
    };
  });

  // r185: an explicit depthOverride (scheduler degradation) wins over the
  // authored depth; authored depth remains the default for manual runs.
  const depth: PipelineDepth = depthOverride ?? wf.depth ?? "standard";
  if (depth === "quick" || base.length === 0) return base;

  let steps = base;

  // Deep: clone the FIRST step's agent into 2 extra research passes.
  if (depth === "deep") {
    const first = steps[0];
    const firstAgent = agentsNow.find((a) => a.id === first.agentId);
    // arXiv fits research — grant the merged tool set only when the base agent
    // already has any tools (an agent authored without tools stays tool-free).
    const baseTools = firstAgent?.tools ?? [];
    const passTools: AnyToolId[] | undefined =
      baseTools.length > 0
        ? Array.from(new Set<AnyToolId>([...baseTools, "web_search", "arxiv_search"]))
        : undefined;
    const passes: WorkflowRunStep[] = DEEP_PASSES.map(({ label }) => ({
      stepId: uid("deep"),
      agentId: first.agentId,
      agentName: firstAgent?.name ?? first.agentName,
      agentEmoji: firstAgent?.emoji ?? first.agentEmoji,
      label,
      // r182: deep passes clone the first step's worker — its explicit role
      // travels too, so the clone rows stay honest about who is working.
      roleId: first.roleId,
      // r503: deep passes inherit the first step's lane pin as well — the
      // clone IS that step's agent, it dials the same lane.
      lane: first.lane,
      output: "",
      toolCalls: [],
      status: "pending" as const,
      kind: "generate" as const,
      instruction: DEEP_RESEARCH_INSTRUCTION,
      ...(passTools ? { tools: passTools } : {}),
    }));
    steps = [first, ...passes, ...steps.slice(1)];
  }

  // Standard + deep: synthetic verification pass when no review gate exists.
  const hasReviewSemantics = steps.some((s) => s.kind === "review");
  if (!hasReviewSemantics) {
    const last = steps[steps.length - 1];
    const lastAgent = agentsNow.find((a) => a.id === last.agentId);
    steps = [
      ...steps,
      {
        stepId: uid("verify"),
        agentId: last.agentId,
        agentName: lastAgent?.name ?? last.agentName,
        agentEmoji: lastAgent?.emoji ?? last.agentEmoji,
        label: "Verification & synthesis",
        // r503: the verify pass audits the last step — it dials the last
        // step's lane too (one consistent brain for the audit).
        lane: last.lane,
        output: "",
        toolCalls: [],
        status: "pending" as const,
        kind: "generate" as const,
        instruction: VERIFICATION_INSTRUCTION,
      },
    ];
  }
  return steps;
}

/**
 * r298: honest run-shape copy for UI surfaces. Depth injection (r26) makes a
 * run's materialized step count differ from the authored count — the run
 * panel quoted the authored count one screen above a run banner counting
 * materialized rows ("9 steps" vs "3/11"), the user-reported discontinuity.
 * Returns the step count a FRESH run of this workflow would materialize plus
 * a noun phrase for the delta ("2 deep-research passes"), or null when the
 * counts agree (quick depth, no injection, or no authored steps). Uses the
 * workflow's OWN depth: a scheduler degradation can still override an
 * individual run, and that run's banner reports its own rows.
 */
export function describeRunShape(
  wf: Workflow,
  agentsNow: Agent[]
): { effective: number; note: string } | null {
  const authored = wf.steps.length;
  if (authored === 0) return null;
  const depth: PipelineDepth = wf.depth ?? "standard";
  if (depth === "quick") return null;
  const effective = materializeRunSteps(wf, agentsNow).length;
  if (effective === authored) return null;
  const hasReview = wf.steps.some((s) => s.kind === "review");
  const parts: string[] = [];
  if (depth === "deep") parts.push("2 deep-research passes");
  if (!hasReview) parts.push("1 verification pass");
  return { effective, note: parts.join(" + ") };
}

/**
 * Run a workflow pipeline end-to-end: creates the run row in the store,
 * streams each step through the agent chain, patches statuses live.
 * Steps marked kind:"review" act as quality gates — they audit the previous
 * step's output and may send it back for a rework pass (up to REWORK_LIMIT).
 * With `options.resume` it continues an existing errored/stopped run from a
 * step index, preserving every completed step's output (non-destructive).
 * Returns the run id, or null when the run could not start.
 */
// ─── r457: prior-knowledge digest from the durable archive ──────────────────
// One GET at fresh-run start (server-local, ~ms): the latest archived report
// for this workflow, rendered as a bounded synthetic prior step. Bounded by
// construction — per-step 1200 chars, total 4000 — so a ballooning archive
// can never balloon the prompt. Client-side module: relative fetch +
// best-effort catch, same doctrine as the r455 archive POST (never affects
// the run). This is the "proceed further, evaluate, and integrate" half of
// the user's archive ask (r455): new runs build on past research instead of
// repeating it.
const PRIOR_STEP_CAP = 1200;
const PRIOR_TOTAL_CAP = 4000;

async function loadPriorReportDigest(workflowId: string): Promise<PrevStepOutput | null> {
  try {
    const res = await fetch(
      `/api/runs/archive?workflowId=${encodeURIComponent(workflowId)}&latest=1`
    );
    if (!res.ok) return null; // no archive yet, or archive unavailable
    const json = (await res.json()) as {
      report?: {
        task?: string | null;
        startedAt?: string | null;
        status?: string | null;
        steps?: { label?: string; agentName?: string; output?: string }[];
      };
    };
    const rep = json.report;
    const status = (rep?.status ?? "").toLowerCase();
    // Only completed prior runs inject — a failed run's partial outputs are
    // noise, not knowledge (the r457 latest=1 route returns any status; the
    // caller-side filter keeps the route general for agents).
    if (!rep || !(status === "completed" || status === "done") || !rep.steps?.length) return null;

    let total = 0;
    const parts: string[] = [];
    let omitted = 0;
    for (const s of rep.steps) {
      const out = (s.output ?? "").trim();
      if (!out) continue;
      if (total >= PRIOR_TOTAL_CAP) {
        omitted++;
        continue;
      }
      const budget = Math.min(PRIOR_STEP_CAP, PRIOR_TOTAL_CAP - total);
      const clipped = out.length > budget ? `${out.slice(0, budget)}…` : out;
      total += clipped.length;
      parts.push(`### ${s.label ?? "step"}${s.agentName ? ` — ${s.agentName}` : ""}\n${clipped}`);
    }
    if (parts.length === 0) return null;

    const when = rep.startedAt ? new Date(rep.startedAt).toLocaleString() : "an unknown date";
    const header =
      `PRIOR RUN DIGEST — this workflow ran before (${when}). Its task was: "${rep.task ?? ""}". ` +
      `Treat the following as PRIOR KNOWLEDGE: build on it, verify its load-bearing claims against your fresh ` +
      `findings, integrate what is still relevant, and avoid redoing identical work. Do not copy it blindly.\n\n`;
    const tail = omitted > 0 ? `\n\n(${omitted} more step(s) omitted to fit the context budget.)` : "";
    return {
      label: "Prior run digest (archived report)",
      agentName: "durable archive",
      output: `${header}${parts.join("\n\n")}${tail}`,
    };
  } catch {
    return null; // best-effort — run proceeds without prior context
  }
}

// ─── r652: precedent-exemplar lane, engine injection (slice 2) ─────────────
// The r651 authoring preview mirrored this contract; the engine now fulfils
// it: the run archive is the precedent store — top-2 similar past-successful
// outputs, two-occurrence layout, injected as a synthetic prior step so the
// block sits closest to the generation point of every step context. Honesty
// first: the SAME archiveRowsToPrecedents mapper the preview uses and the
// SAME eligiblePrecedents filter; a dial-free confidence gate (both retrieval
// legs agreeing on the top match) decides whether the block rides at all —
// a single-leg top is honest noise, and the refusal still lands in the
// call-log note so even the negative case is O1-observable. Best-effort:
// any failure runs without it, same doctrine as the r457 digest.
async function loadPrecedentInjection(
  task: string
): Promise<{ injection: PrevStepOutput | null; note: string }> {
  try {
    const entries = await listArchiveFull();
    const rows = archiveRowsToPrecedents(entries);
    const lane = precedentRetrieval(task, rows, 2);
    if (!lane.promptBlock) {
      // Nothing eligible (or no task text) — no signal, no note (no theatre).
      return { injection: null, note: "" };
    }
    if (!isConfidentTop(lane)) {
      const legs = lane.exemplars[0]?.legs ?? "none";
      return {
        injection: null,
        note: `${lane.note} — top match ${legs}, below the both-legs confidence gate; block not injected`,
      };
    }
    return {
      injection: {
        label: "Precedent lane (two-occurrence exemplars)",
        agentName: "run archive",
        output: lane.promptBlock,
      },
      note: `${lane.note} — block injected into this run's step contexts (closest to each generation point)`,
    };
  } catch {
    return { injection: null, note: "" };
  }
}

export async function executeWorkflowRun(
  options: ExecuteRunOptions
): Promise<string | null> {
  const { source = "manual", onStarted, onSettled } = options;
  // v11: recovery-card "Retry via relay" escape hatch (see ExecuteRunOptions).
  const forceServer = options.forceServer === true;
  const wf = useWorkflowsStore
    .getState()
    .workflows.find((w) => w.id === options.workflow.id);
  if (!wf || wf.steps.length === 0) return null;
  if (activeRuns.has(wf.id)) return null;

  const store = useWorkflowsStore.getState();
  const settings = useSettingsStore.getState();
  const agentsNow = useAgentsStore.getState().agents;

  // ─── Fresh run vs resume of an existing errored/stopped row ─────────────
  let runId: string;
  let task: string;
  let steps: WorkflowRunStep[];
  let startIndex = 0;
  let attempts = 0;

  if (options.resume) {
    const run = wf.runs.find((r) => r.id === options.resume!.runId);
    if (!run || run.status === "running") return null;
    runId = run.id;
    task = run.task;
    attempts = run.error?.attempts ?? 0;
    startIndex = Math.min(
      Math.max(0, options.resume.fromStepIndex),
      run.steps.length - 1
    );
    // r80: resumed tail steps start "pending" — the engine loop flips the
    // resumed-from step to "running" at its start-of-step patch.
    steps = run.steps.map((s, i) =>
      i >= startIndex
        ? { ...s, output: "", toolCalls: [], status: "pending" as const, ms: undefined, verdict: undefined, reworked: undefined, backoffUntil: undefined, backoffKind: undefined }
        : s
    );
    store.patchRun(wf.id, runId, {
      status: "running",
      finishedAt: undefined,
      error: undefined,
      steps,
      resumeCount: (run.resumeCount ?? 0) + 1,
    });
  } else {
    if (options.task.trim() === "") return null;
    runId = uid("run");
    task = options.task.trim();
    // r26 depth control: quick = as authored · standard = + verification pass ·
    // deep = + 2 research passes + verification. Resume (above) is untouched.
    // r186 (user report: "same !" — a fresh scheduled fire still materialized
    // deep): the r185 scheduler-side computation is kept for its toast + audit
    // disclosure, but ENFORCEMENT now lives here, at the single choke point
    // every fire path shares. A scheduled fire of a Deep workflow whose
    // failStreak ≥ 2 degrades to Standard no matter which call site launched
    // it (stale-tab bundles, future paths). Manual runs keep the authored
    // depth — the user chooses their own risk. The effective depth is stamped
    // on the run row so history is self-diagnosing.
    const runnerDegraded =
      options.depthOverride === undefined &&
      source === "scheduled" &&
      (wf.depth ?? "standard") === "deep" &&
      (wf.schedule?.failStreak ?? 0) >= 2;
    steps = materializeRunSteps(wf, agentsNow, runnerDegraded ? "standard" : options.depthOverride);
    store.addRun(wf.id, {
      id: runId,
      workflowId: wf.id,
      workflowName: wf.name,
      task,
      status: "running",
      startedAt: Date.now(),
      depth: runnerDegraded ? "standard" : (options.depthOverride ?? wf.depth),
      // r197 (directive d): event provenance — the board's schedule-evidence
      // chip derives health from these stamped events, not from the badge.
      source,
      steps,
    });
  }

  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  activeRuns.add(wf.id);
  activeControllers.set(wf.id, controller);
  lastRunActivity.set(wf.id, Date.now());
  ensureStallWatchdog();
  useUiStore.getState().setBusy(true);
  onStarted?.(runId, controller);

  const patchRunStep = (
    stepId: string,
    patch: Partial<WorkflowRunStep>
  ) => {
    lastRunActivity.set(wf.id, Date.now());
    useWorkflowsStore.getState().patchRunStep(wf.id, runId, stepId, patch);
  };
  const patchRun = (patch: Partial<WorkflowRun>) => {
    lastRunActivity.set(wf.id, Date.now());
    useWorkflowsStore.getState().patchRun(wf.id, runId, patch);
  };

  /** Append one LLM-call record to the run's call log (harness rank-② slice). */
  const pushCall = (entry: Omit<RunCallLogEntry, "at">) => {
    try {
      const run = useWorkflowsStore
        .getState()
        .workflows.find((w) => w.id === wf.id)
        ?.runs.find((r) => r.id === runId);
      const log = [...(run?.callLog ?? []), { at: Date.now(), ...entry } as RunCallLogEntry].slice(-60);
      patchRun({ callLog: log });
    } catch {
      /* logging must never break a run */
    }
  };

  const stopRemaining = (fromIndex: number) => {
    for (let j = fromIndex + 1; j < steps.length; j++) {
      // r177 (user report): these rows read "Stopped" with empty output —
      // indistinguishable from a user stop and alarming in the timeline.
      // They never ran; say so honestly regardless of why the run ended.
      // r183: dedicated "skipped" step status — never-ran rows must not
      // share a status with steps the user actually stopped mid-flight.
      patchRunStep(steps[j].stepId, {
        status: "skipped",
        output: "(not run — the run ended before reaching this step)",
      });
    }
  };

  // v23: idempotency flag — the escaped-error outer catch may finalize after a
  // partial finish(); never double-patch or double-toast.
  let finalized = false;
  const finish = (
    status: WorkflowRun["status"],
    toastMsg: string,
    errorInfo?: RunErrorInfo
  ) => {
    if (finalized) return;
    finalized = true;
    // r183 (directive item b): a user stop that preserved completed steps is
    // PARTIAL — distinct from a zero-progress stop (which keeps "stopped").
    // The store row is authoritative (same lesson as the r119 novelty fix:
    // the local `steps` closure misses patched statuses).
    if (status === "stopped") {
      const storeRow = useWorkflowsStore
        .getState()
        .workflows.find((w) => w.id === wf.id)
        ?.runs.find((r) => r.id === runId);
      if ((storeRow?.steps ?? steps).some((s) => s.status === "done")) {
        status = "partial";
      }
    }
    // Evolution Layer (r68): novelty % vs this workflow's recent done runs —
    // best-effort; a scoring failure must never affect run finalization.
    let novelty: number | undefined;
    if (status === "done") {
      try {
        const liveWf = useWorkflowsStore.getState().workflows.find((w) => w.id === wf.id);
        const prevOutputs = (liveWf?.runs ?? [])
          .filter((r) => r.id !== runId && r.status === "done")
          .map((r) => runText(r.steps));
        // r119: read THIS run's steps from the STORE row — step outputs land
        // only in the store (patchRunStep); the local `steps` closure still
        // holds empty strings at finish, so scoreNovelty saw empty text and
        // returned null for EVERY real run (the ledger showed "not scored"
        // for all of them). Store row is the authoritative source.
        const storeRow = (liveWf?.runs ?? []).find((r) => r.id === runId);
        const score = scoreNovelty(
          runText(storeRow?.steps?.some((s) => (s.output ?? "").length > 0) ? storeRow.steps : steps),
          prevOutputs
        );
        if (score != null) novelty = score;
      } catch {
        /* novelty is best-effort */
      }
    }
    // Evolution Layer (r70): a done run with low novelty = the pipeline keeps
    // producing near-duplicates. Best-effort: propose a variation to the
    // spawn inbox (max ONE open proposal per source workflow — anti-spam).
    // Threshold is user-configurable (Settings → Evolution); read best-effort
    // so a settings-store failure can never affect run finalization.
    const spawnThreshold = (() => {
      try {
        return (
          useSettingsStore.getState().settings.noveltySpawnThreshold ??
          NOVELTY_SPAWN_THRESHOLD
        );
      } catch {
        return NOVELTY_SPAWN_THRESHOLD;
      }
    })();
    if (
      status === "done" &&
      novelty !== undefined &&
      novelty < spawnThreshold
    ) {
      try {
        const st = useWorkflowsStore.getState();
        const openSourceIds = st.proposals
          .filter((p) => p.status === "open")
          .map((p) => p.sourceWorkflowId);
        const liveWf2 = st.workflows.find((w) => w.id === wf.id);
        const taskExcerpt =
          liveWf2?.steps[0]?.instruction ||
          liveWf2?.steps.map((s) => s.label).join(" → ") ||
          wf.name;
        // r190 branch router (arXiv:2609.37834): every past proposal for this
        // source is a search-history sample — the router rotates to a
        // complementary angle instead of hashing the same one forever.
        // r191: accepted proposals join their spawned pipeline's latest
        // scored novelty, arming the router's exploitation branch.
        const scoredNovelty = new Map<string, number>();
        for (const w of st.workflows) {
          const n = latestScoredNovelty(w.runs);
          if (n != null) scoredNovelty.set(w.id, n);
        }
        const angleHistory = buildAngleHistory(st.proposals, wf.id, scoredNovelty);
        const proposal = maybeProposeSpawn({
          status,
          novelty,
          threshold: spawnThreshold,
          openSourceIds,
          sourceWorkflowId: wf.id,
          sourceWorkflowName: wf.name,
          sourceRunId: runId,
          taskExcerpt,
          angleHistory,
          // r581: automatic stall proposals carry the same nexent constraint
          // block as the manual path — bounds derived from the source pipeline.
          constraints: buildDefaultConstraints(wf.steps.length),
        });
        if (proposal) {
          // ── r511 frontier seeding (owner: "self-development automation with
          // the newest trend papers / GitHub repos"): stamp the stall proposal
          // with the highest-judged seed the Evolution Inbox has NOT already
          // used. Best-effort INSIDE the same try/catch — a seeding failure
          // degrades to the plain proposal, never affects finalization.
          let seeded = proposal;
          try {
            const usedTitles = new Set(
              st.proposals
                .filter((p) => p.status === "open" && p.frontierRef)
                .map((p) => p.frontierRef!.title)
            );
            // r590: AWorld eligibility — mirror of the manual propose picker
            // (workflows-view): only seeds whose 4-check verdict is
            // "reproduced" may seed an automatic Evolution proposal; the
            // ledger's census promises exactly this, score alone must not
            // smuggle a not-reproduced seed into Evolution.
            const seed = readFrontierSeeds()
              .filter((s) => s.reproduction?.verdict === "reproduced")
              .filter((s) => !usedTitles.has(s.title))
              .sort((a, b) => b.total - a.total)[0];
            if (seed) {
              const ref: FrontierSeedRef = {
                title: seed.title,
                url: seed.url,
                kind: seed.kind, // "paper" | "repo" — a FrontierSeedRef subset
                directive: seed.seed,
                total: seed.total,
              };
              seeded = withFrontierSeed(proposal, ref);
            }
          } catch {
            /* seeds empty or ledger unreadable — plain proposal, current behavior */
          }
          st.addProposal(seeded);
          toast("Evolution proposal added to the inbox", {
            icon: "🧬",
            description: seeded.frontierRef
              ? `${wf.name} keeps producing similar output (novelty ${Math.round(novelty)}%) — a frontier-seeded variation was suggested`
              : `${wf.name} keeps producing similar output (novelty ${Math.round(novelty)}%) — a variation was suggested`,
          });
        }
      } catch {
        /* spawn proposals are best-effort — never affect run finalization */
      }
    }
    patchRun({
      status,
      finishedAt: Date.now(),
      ...(novelty !== undefined ? { novelty } : {}),
      ...(errorInfo ? { error: errorInfo } : status === "done" ? { error: undefined } : {}),
      // r654: honest run-level degradation — N synthetic deep passes were
      // skipped after transient failures and the run continued without them.
      // Stamped ONLY on done runs (an errored run's `error` already tells the
      // story); absent when every deep pass ran — no phantom field.
      ...(status === "done" && deepSkips.count > 0
        ? { degradedDeep: { skipped: deepSkips.count, kinds: [...deepSkips.kinds] } }
        : {}),
    });
    // r455 (user ask: reports "need to be archived, available for agents to
    // maintain"): every settled LOCAL-lane run archives its full steps to the
    // durable DB tier (/api/runs/archive → SQLite RunReport). localStorage
    // keeps only the r414 TRIMMED live state, so without this the full
    // reports lived in RAM alone. Fire-and-forget, best-effort — the archive
    // must never affect the run (same doctrine as spawn proposals above).
    // Upsert by run id: a resumed run re-archives over its earlier snapshot.
    try {
      const st0 = useWorkflowsStore.getState();
      const run0 = st0.workflows.find((w) => w.id === wf.id)?.runs.find((r) => r.id === runId);
      if (run0 && run0.status !== "running") {
        // r672 (RSI ledger slice): the run's gate outcomes land in the durable
        // SQLite ledger (EvalEvent) — the KICK corpus's interaction_logs
        // pattern, adapted: the training corpus outlives the browser's trimmed
        // localStorage. Fire-and-forget, never-throw (same doctrine as the
        // archive below); empty logs POST nothing.
        try {
          const gateEvts = gateEventsOf(run0.callLog);
          if (gateEvts.length > 0) {
            void fetch("/api/evals", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                runId: run0.id,
                workflow: wf.name,
                events: gateEvts.map((e) => ({
                  ...(e.stepId != null ? { stepId: e.stepId } : {}),
                  kind: e.kind,
                  ...(e.verdict != null ? { verdict: e.verdict } : {}),
                  ...(e.confidence != null ? { confidence: e.confidence } : {}),
                  note: e.note,
                })),
              }),
            }).catch(() => {
              /* the ledger is best-effort — never affect run finalization */
            });
          }
        } catch {
          /* extraction itself is never-throw; belt and braces */
        }
        const stepsPayload = run0.steps.map((st) => ({
          stepId: st.stepId,
          agentName: st.agentName,
          label: st.label,
          output: st.output,
          status: st.status,
          ms: st.ms,
          toolCalls: (st.toolCalls ?? []).map((tc) => ({
            name: tc.name,
            args: tc.args,
            result: tc.result,
            ok: tc.ok,
            ms: tc.ms,
          })),
        }));
        void fetch("/api/runs/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: run0.id,
            workflowId: wf.id,
            workflowName: wf.name,
            task: run0.task,
            source,
            status: run0.status,
            depth: run0.depth,
            error: run0.error ? JSON.stringify(run0.error) : null,
            steps: stepsPayload,
            toolCalls: stepsPayload.reduce((n, s) => n + (s.toolCalls?.length ?? 0), 0),
            durationMs: run0.finishedAt ? run0.finishedAt - run0.startedAt : null,
            startedAt: run0.startedAt,
            finishedAt: run0.finishedAt ?? null,
          }),
        })
          .then(async (res) => {
            // r609 stack capture: a 500 RESPONSE is not a fetch rejection —
            // the route's honest {error} body used to die here unseen (why
            // the archiver-500 left zero diagnostics anywhere). Surface it;
            // still best-effort — never throws into the run.
            if (!res.ok) {
              const body = await res.text().catch(() => "");
              console.warn(
                `[run-archive] DB tier failed HTTP ${res.status} — ${body.slice(0, 300)}`
              );
            }
          })
          .catch((e: unknown) => {
            // best-effort — never affect the run, but never mute the reason
            // (r654: safeErrorMessage — an object rejection must not read "[object Object]")
            console.warn("[run-archive] DB tier unreachable —", safeErrorMessage(e));
          });
      }
    } catch {
      /* archive is best-effort */
    }
    // r486-a (Run Archive epic): every settled run ALSO lands in the local
    // localStorage archive ("nexus.run-archive.v1", src/lib/run-archive.ts)
    // — the DB tier above needs the server, this tier is offline-first and is
    // what the Workflows → Archive tab browses and batch-exports. Upsert by
    // run id, so a resumed run re-archives over its earlier snapshot.
    // Best-effort try/catch — archiving must never break or alter a run.
    try {
      const stLocal = useWorkflowsStore.getState();
      const runLocal = stLocal.workflows
        .find((w) => w.id === wf.id)
        ?.runs.find((r) => r.id === runId);
      if (runLocal && runLocal.status !== "running") {
        const model =
          runLocal.callLog?.find((c) => typeof c.model === "string" && c.model.length > 0)?.model;
        archiveRun({
          id: runLocal.id,
          workflowId: wf.id,
          workflowName: wf.name,
          trigger: source === "scheduled" ? "schedule" : "manual",
          status: engineStatusToArchiveStatus(
            runLocal.status,
            runLocal.steps.some((s) => s.status === "done")
          ),
          startedAt: new Date(runLocal.startedAt).toISOString(),
          finishedAt: new Date(runLocal.finishedAt ?? Date.now()).toISOString(),
          ...(runLocal.finishedAt ? { totalMs: runLocal.finishedAt - runLocal.startedAt } : {}),
          ...(model ? { model } : {}),
          steps: runLocal.steps.map((s) => ({
            name: s.label,
            agent: s.agentName,
            output: s.output,
            ...(s.ms != null ? { ms: s.ms } : {}),
          })),
        });
      }
    } catch {
      /* archiving must never break or alter a run */
    }
    if (source === "scheduled") {
      // r29 scheduled-run autonomy (Temporal/Circuit-Breaker doctrine):
      // failures feed a consecutive-fail streak — 1-2 re-arm SOONER than the
      // full interval (10m/30m quick retries); 3 trips the breaker and
      // auto-pauses the schedule so a broken pipeline stops burning slots.
      // Success resets the streak. A half-open probe = the user re-enabling.
      const live = useWorkflowsStore.getState().workflows.find((w) => w.id === wf.id);
      const sched = live?.schedule;
      if (sched && (status === "done" || status === "error" || status === "blocked")) {
        if (status === "done" && (sched.failStreak || sched.autoResumeTrips || sched.autoResumeAt != null)) {
          // r171: success also refills the congestion budget — a healthy
          // pipeline always keeps its full 5 auto-resumes.
          useWorkflowsStore.getState().update(wf.id, { schedule: { ...sched, failStreak: 0, autoResumeTrips: 0, autoResumeAt: undefined } });
        } else if ((status === "error" || status === "blocked") && sched.enabled) {
          const streak = (sched.failStreak ?? 0) + 1;
          // r156 (user report: hourly pipeline 0/11 for 19h): a rate-limit
          // failure is the SHARED gateway saying "back off" — the whole lane
          // is throttling (repro: 3×429 "Too many requests" → step dies →
          // stopRemaining → 0-1/11). The old ladder re-fired in 10-30m and
          // burned more quota against a saturated lane. Now: rate-limit
          // failures trip the breaker at 2 consecutive (vs 3 for other
          // kinds) and back off exponentially (2× interval per streak,
          // capped 6h) so the schedule stops feeding the congestion.
          const rateLimited = errorInfo?.kind === "rate-limit";
          if (streak >= (rateLimited ? 2 : 3)) {
            // r171 (user report: "job stopping itself"): a rate-limit trip is
            // congestion, not breakage — the old hard disable silently killed
            // the pipeline until a human noticed (RSIinFIELD sat auto-paused
            // for a day). Now the breaker trip parks the schedule with a
            // SELF-HEALING backoff (45m → 1.5h → 3h → 6h, ±20% jitter) and
            // the scheduler re-arms it automatically. Only after 5 consecutive
            // congestion trips (≈ a day of saturation) does it degrade to the
            // honest manual pause. Non-rate-limit trips (auth/model/etc.) keep
            // the manual pause — real breakage deserves a human.
            const trips = rateLimited ? (sched.autoResumeTrips ?? 0) : 0;
            if (rateLimited && trips < MAX_AUTO_RESUME_TRIPS) {
              const resumeIn = jitteredBackoff(rateLimitResumeDelayMs(streak));
              useWorkflowsStore.getState().update(wf.id, {
                schedule: {
                  ...sched,
                  failStreak: streak,
                  autoResumeTrips: trips + 1,
                  autoResumeAt: Date.now() + resumeIn,
                  nextRunAt: Date.now() + resumeIn,
                  enabled: false,
                },
              });
              toast.warning("Schedule backing off — gateway saturated (auto-resumes)", {
                icon: "⏳",
                description: `${wf.name} parked itself after ${streak} rate-limited runs — it re-arms automatically in ~${Math.max(1, Math.round(resumeIn / 60_000))}m (congestion trip ${trips + 1}/${MAX_AUTO_RESUME_TRIPS}). Completed steps of the failed run are preserved.`,
              });
            } else {
              useWorkflowsStore.getState().update(wf.id, { schedule: { ...sched, failStreak: streak, enabled: false, autoResumeAt: undefined } });
              toast.warning(rateLimited ? "Schedule auto-paused — gateway saturated all day" : "Schedule auto-paused after 3 consecutive failures", {
                icon: "🛑",
                description: `${wf.name} — ${rateLimited ? `${MAX_AUTO_RESUME_TRIPS} automatic backoffs all landed in 429s; this looks like a persistent outage, so it stays paused. ` : ""}The pipeline keeps failing at "${errorInfo?.stepLabel ?? "a step"}". Fix it, then re-enable the schedule.`,
              });
            }
          } else {
            // r171: jittered ±20% — an unjittered +2h re-fire stays collinear
            // with the hourly cron wave that caused the 429 in the first place.
            const retryIn = jitteredBackoff(
              rateLimited
                ? Math.min(sched.intervalMs * 2 ** streak, 6 * 60 * 60_000)
                : Math.min(Math.max(60_000, sched.intervalMs), streak === 1 ? 10 * 60_000 : 30 * 60_000)
            );
            useWorkflowsStore.getState().update(wf.id, { schedule: { ...sched, failStreak: streak, nextRunAt: Date.now() + retryIn } });
          }
        }
      }
      if (status === "done") toast.success("Scheduled run finished", { icon: "⏰", description: `${wf.name} · ${steps.length} steps` });
      else if (status === "error" || status === "blocked") {
        const sched2 = useWorkflowsStore.getState().workflows.find((w) => w.id === wf.id)?.schedule;
        // r171 honesty fix: the note used to hardcode "~10m/~30m" even when the
        // rate-limit ladder had armed a 2h backoff — read the real re-arm time.
        const retryNote =
          sched2?.enabled && sched2.nextRunAt != null && sched2.nextRunAt > Date.now()
            ? ` — auto-retry in ~${Math.max(1, Math.round((sched2.nextRunAt - Date.now()) / 60_000))}m`
            : sched2?.enabled && sched2.autoResumeAt != null
              ? ` — auto-resume in ~${Math.max(1, Math.round((sched2.autoResumeAt - Date.now()) / 60_000))}m`
              : "";
        toast.error(status === "blocked" ? "Scheduled run parked — auto-resumes" : "Scheduled run failed", { icon: "⏰", description: errorInfo ? `${errorInfo.stepLabel} · ${ERROR_KIND_META[errorInfo.kind].label.toLowerCase()}${retryNote} — open the run to recover` : wf.name });
      }
    } else {
      if (status === "done") toast.success(toastMsg);
      else if ((status === "error" || status === "blocked") && errorInfo) {
        // Non-silent failure: tell the user WHERE to recover, not just that it broke.
        toast.error(status === "blocked" ? `Run parked at "${errorInfo.stepLabel}"` : `Run failed at "${errorInfo.stepLabel}"`, {
          icon: "🛟",
          description: `${ERROR_KIND_META[errorInfo.kind].label} issue · ${errorInfo.stepsDone}/${steps.length} steps done — recovery options are in the run panel.`,
        });
      }
    }
    onSettled?.(runId, status);
  };

  /**
   * Build the full RunErrorInfo for a failed step and finish the run.
   * `opts.stallOwned` marks the r72 watchdog path — it schedules its own
   * bounded auto-resume, so the r178 park ladder must not also engage.
   */
  const failRun = (
    fallbackIndex: number,
    err: Error,
    opts?: { stallOwned?: boolean }
  ) => {
    // v23: a rejection reason that is not an Error (undefined, a string) used
    // to leak a literal `undefined` into the error row and the dev overlay.
    // r654: String({}) leaked "[object Object]" into PERSISTED run rows (the
    // Owner's export carried them) — safeErrorMessage renders the object
    // honestly instead (message/error envelope → JSON → capped).
    const safeMessage = safeErrorMessage(err);
    const meta = err as Error & { stepId?: string; toolCallsOk?: number; autoRetried?: boolean };
    const found = steps.findIndex((s) => s.stepId === meta.stepId);
    const failedIndex = found === -1 ? fallbackIndex : found;
    const step = steps[failedIndex] ?? steps[fallbackIndex];
    const { kind, hint } = classifyRunError(safeMessage);
    const llm = resolveLlm(settings.settings);
    const info: RunErrorInfo = {
      stepIndex: failedIndex,
      stepId: step.stepId,
      stepLabel: step.label,
      agentName: step.agentName,
      message: safeMessage,
      kind,
      hint,
      toolCallsOk: meta.toolCallsOk ?? 0,
      stepsDone: steps.slice(0, failedIndex).filter((s) => s.status === "done").length,
      llmLabel: llm.label,
      attempts: attempts + 1,
      autoRetried: meta.autoRetried === true || undefined,
    };
    // r158 park-and-resume: a rate-limit death is congestion, not breakage.
    // While park budget remains, annotate + park instead of terminally failing:
    // the run still finalizes "error" (honest state, recovery card, r157
    // history chip, schedule breaker), but a long-delay auto-resume brings it
    // back once the quota window has passed. NOTE the ordering: the park note
    // must be appended to info BEFORE finish() — finish copies the object into
    // the store row, so later edits never reach the UI.
    // r178: park decision now covers BOTH transient families via park-policy.
    const liveRun = useWorkflowsStore
      .getState()
      .workflows.find((w) => w.id === wf.id)
      ?.runs.find((r) => r.id === runId);
    const parkKind = resolvePark(
      kind,
      { parkCount: liveRun?.parkCount, netParkCount: liveRun?.netParkCount },
      opts
    );
    if (parkKind !== null) {
      const parkIndex = parkKind === "network" ? (liveRun?.netParkCount ?? 0) : (liveRun?.parkCount ?? 0);
      const waitMs = parkDelayMs(parkKind, parkIndex);
      info.message +=
        parkKind === "network"
          ? ` — parked: network unreachable, auto-resume in ~${Math.max(1, Math.round(waitMs / 60_000))}m (network park ${parkIndex + 1}/${maxParks(parkKind)}; completed steps preserved; resume rotates to the relay lane)`
          : ` — parked: gateway saturated, auto-resume in ~${Math.max(1, Math.round(waitMs / 60_000))}m (park ${parkIndex + 1}/${maxParks(parkKind)}; resume rotates to the relay lane)`;
      patchRun(parkKind === "network" ? { netParkCount: parkIndex + 1 } : { parkCount: parkIndex + 1 });
      // Live countdown on the failed step row — reuses the r128 "⏳ Cooldown"
      // chip machinery so the park wait is visible, not a silent hang.
      patchRunStep(step.stepId, { backoffUntil: Date.now() + waitMs, backoffKind: "cooldown" });
    }
    stopRemaining(failedIndex);
    // r186 (user report: "same !" — the paste shows an all-429 death rendered
    // as red "Failed"): the park ladder is FINITE (r178). Once exhausted,
    // resolvePark returns null and the run used to fall through to "error" —
    // a congestion death indistinguishable from a genuine pipeline defect.
    // r183's doctrine: blocked by an external condition ≠ failed on its
    // merits. A congestion-class death with no park budget left finalizes
    // "blocked" with an honest note; the schedule-level r171 auto-resume
    // (which counts blocked runs too) still owns the retry, so breaker
    // behavior, streaks and recovery cards are unchanged.
    const congestionExhausted =
      parkKind === null &&
      !opts?.stallOwned &&
      (kind === "rate-limit" || kind === "network" || kind === "timeout");
    if (congestionExhausted) {
      info.message +=
        " — park ladder exhausted: the gateway/network condition persisted past all parks; " +
        "the schedule's congestion backoff owns the retry (auto-resume pending)";
    }
    // r183 (directive item b): a parked run did not fail on its own merits —
    // an external condition (gateway saturation / network) blocked it and it
    // will auto-resume. Give it "blocked", not "error". The r171 streak gate
    // below counts blocked runs too, so the congestion breaker still trips.
    finish(
      parkKind !== null || congestionExhausted ? "blocked" : "error",
      `Step "${step.label}" failed`,
      info
    );
    if (parkKind !== null) {
      scheduleParkResume(wf.id, runId, failedIndex, parkKind === "network" ? (liveRun?.netParkCount ?? 0) : (liveRun?.parkCount ?? 0), source, parkKind);
    }
  };

  // r126 run-scoped sick memory: a mid-stream drop on the primary marks it
  // sick for the WHOLE RUN (5m window). Later steps start demoted — they skip
  // re-dialing the dead provider first instead of replaying the same failure
  // once per step (the user's 11-step pipeline re-learned one outage 11×).
  // ─── r654: deep-pass non-fatality bookkeeping (function scope — finish()
  // stamps the honest run-level marker when a transient-class death hit a
  // SYNTHETIC deep pass and the run continued without it).
  const deepSkips = { count: 0, kinds: [] as string[] };

  let primarySickUntil = 0;
  // r305: the rotation lane this run currently rides. Set when a 429 marks
  // the current lane exhausted; persists across steps so a long pipeline
  // doesn't re-dial the exhausted lane once per step (r126 doctrine: stable
  // continuation, not per-step re-learning).
  let rotatedLlm: ResolvedLlm | null = null;

  /**
   * Stream one agent call for a run step; returns the final content + duration.
   * Self-healing (r19): a transient engine failure (network drop / timeout —
   * e.g. a gateway 502 after several tool calls) is retried ONCE automatically
   * with a clean slate so scheduled runs survive upstream hiccups instead of
   * dying at 7am. Every attempt is recorded in the run's call log.
   */
  // ─── r652: precedent lane state (function scope — streamStep carries the
  // note on the first executed step's dials). "" when the lane has nothing
  // to say (fresh install, no eligible precedents, or below the gate).
  let precedentNote = "";
  let firstExecutedStepId = "";
  const streamStep = async (
    runStep: WorkflowRunStep,
    agentId: string,
    system: string,
    context: string
  ): Promise<{ content: string; ms: number }> => {
    const agent = useAgentsStore.getState().agents.find((a) => a.id === agentId);
    if (!agent) throw new Error(`Agent for step "${runStep.label}" not found`);
    const stepStart = Date.now();
    let draft = "";
    let localToolCalls: ToolCallInfo[] = [];
    // r503: step-level lane pins resolve FIRST (explicit "providerId::model"
    // or "auto::builtin"), then the agent's own model, then the global
    // provider — the owner's lane-spread directive. resolveExplicitLlm never
    // dead-ends: unknown/keyless pins fall back with an honest note.
    const llm = resolveExplicitLlm(settings.settings, runStep.lane, agent.model);
    // ─── r512 pinned-lane auto-retire: when the step's (or the pipeline
    // default's) lane pin points at a lane the tracker — or 2 dial strikes —
    // proved removed from its provider catalog, the pin is DEAD: never dial
    // the corpse. The dial falls through to the EXACT sick-hop demote path
    // (rescue lane → nextRotation healthy external lane → built-in engine
    // last rung, r509 doctrine) with an honest relayNotes line, and the pin
    // lane is kept off the wire's tail too (it used to be re-appended as the
    // last hop on substituted dials).
    const pinKey = runStep.lane?.trim() ?? "";
    const pinRetireReason =
      typeof window !== "undefined" && pinKey ? laneRetirementReason(pinKey) : null;
    const pinDead = pinRetireReason != null;
    const pinRetiredNote = pinDead
      ? `lane pin retired (${pinRetireReason}) → fell through to rotation`
      : null;
    // Synthetic deep-research passes carry a merged tool set (base tools +
    // web_search + arxiv_search) materialized on the run step itself.
    const effectiveTools: AnyToolId[] = runStep.tools ?? agent.tools ?? [];
    // Task fit (Genius-rotator doctrine): research steps with search tools
    // prefer fast models first (many quick tool rounds); review/writing steps
    // prefer flagships first (one excellent pass matters most).
    const taskFit: RelayTaskFit =
      runStep.kind === "review"
        ? "quality"
        : effectiveTools.some((t) => t === "web_search" || t === "read_url" || t === "arxiv_search")
          ? "research"
          : "any";
    // Model Relay (Genius-rotator doctrine): when this step's brain fails
    // before streaming anything, the server rotates down the vault's fallback
    // chain instead of dying — the exact 7am-scheduled-run failure mode.
    let relayNotes: string[] = [];
    const MAX_STEP_ATTEMPTS = 3; // 1 real attempt + 2 automatic self-heal retries (r83: 2→3 — forensics from two independent failed deep runs (user's Continuous Research 08:xx, QA-profile dossier 07:xx) showed attempt-2-on-a-fresh-lane ALSO dying during the same provider outage window; a third lane dial is the difference between a saved 457s research pass and a terminal error. Each attempt is bounded by the engine's upstream deadlines, so a dead lane costs minutes, not the run.)

    // v22 (mid-stream primary demotion): a provider that dies MID-STREAM —
    // tool rounds streamed, then the socket dropped — is provably sick, but
    // the old ladder re-dialed it FIRST on every attempt (the user's
    // Continuous Research run burned ~26 minutes on one dead Vyce endpoint:
    // 4/5 dials died at 104–731s each). Attempts 2/3 now demote the primary:
    // lead with the built-in engine and park the sick primary at the BACK of
    // the hop chain (its own key rides along, so it stays reachable). BYOK
    // intact — the auto lane needs no key and touches none of the vault.
    // r305: the primary is ALSO demoted when its provider family is inside a
    // 429 saturation window (tab-wide memory — any earlier step or run may
    // have marked it), not only after this run's own mid-stream drop.
    const primaryFamilyKey = laneFamilyKey(llm.providerId);
    const primaryFamilySick =
      primaryFamilyKey !== "" &&
      primaryFamilyKey !== "auto" &&
      laneSickUntil(laneSaturation, primaryFamilyKey, Date.now()) > Date.now();
    let demotePrimary = Date.now() < primarySickUntil || primaryFamilySick || pinDead;

    for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
      // Rebuild the relay wire PER ATTEMPT (r25): attempt 1's failures were
      // recorded into the rotator's health memory as they happened, so the
      // self-heal retry now starts on a DIFFERENT lane instead of re-dialing
      // the same dead primary — the actual "auto-retry hits the same dead
      // hop" fix.
      // v22: when the PREVIOUS attempt died mid-stream on the primary, stop
      // leading with it — dial the built-in engine instead.
      // r437: when the demotion fires and a RESCUE lane is live (a
      // non-primary lane that fully answered a recent dial), THAT lane leads
      // — before the built-in engine. Forensics (run012-20261011-2128, the
      // user's pasted parked run): attempt-3 registry rotation rescued step
      // 7 via AIHubMix (512s pass ✓), then the next step's three dials all
      // led with the saturated built-in engine (429 ×4, one in 1.2s) and
      // parked — a proven-healthy lane sat ready while the ladder re-learned
      // the congestion from scratch. The rescue pick below goes through
      // nextRotation (which prefers the live rescue lane) and is only
      // applied when it actually returned the rescue lane — otherwise the
      // ladder falls through to the plain built-in demotion unchanged.
      let dialLlm = llm;
      let rotationNote: string | null = null;
      // r126: sick memory lets attempt 1 demote too — a step opening during
      // another step's outage window leads with the built-in engine from the
      // first dial (attempt > 1 alone would still re-dial the dead primary).
      if (
        demotePrimary &&
        (attempt > 1 || Date.now() < primarySickUntil || primaryFamilySick || pinDead) &&
        !forceServer
      ) {
        const rescueId = liveRescueLaneId();
        if (
          rescueId &&
          rescueId !== llm.providerId &&
          provider429CooldownLeftMs(rescueId) <= 0
        ) {
          const pick = nextRotation(settings.settings, llm.providerId);
          if (pick && pick.llm.providerId === rescueId) {
            dialLlm = {
              ...llm,
              provider: pick.llm.provider,
              apiKey: pick.llm.apiKey,
              baseUrl: pick.llm.baseUrl,
              model: pick.llm.model,
              providerId: pick.llm.providerId,
              label: `${llm.label} → ${pick.llm.label} (rescue lane leads)`,
            };
            rotationNote = `rescue lane — ${pick.llm.label} led this dial (it answered the last congestion rescue; proven lane preferred over the built-in engine)`;
          }
        }
        if (dialLlm === llm) {
          // r509 (owner directive): the built-in engine is a LOCAL sandbox
          // privilege (the z-ai SDK gateway) — other deployments don't have
          // it, and dev.log proves it 429-saturates under the schedule
          // fleet's own load ("Too many requests" ×3 behind a 200 SSE). A
          // demoted primary now LEADS with the healthiest EXTERNAL lane
          // (rescue-lane + 429-cooldown aware) and reserves the built-in
          // engine as the LAST rung — it is dialed only when no external
          // lane exists at all.
          const pick = nextRotation(settings.settings, llm.providerId);
          if (pick && pick.llm.providerId && pick.llm.providerId !== "auto") {
            if (pick.waitMs > 0) {
              // The picked lane is cooling — wait exactly its remaining
              // window (the r306 final-attempt pattern) instead of burning
              // this attempt on a 429ing built-in engine.
              patchRunStep(runStep.stepId, {
                backoffUntil: Date.now() + pick.waitMs,
                backoffKind: "cooldown",
              });
              toast.info(
                `"${runStep.label}" rotating to ${pick.llm.label} — waiting ${Math.round(pick.waitMs / 1000)}s for its quota window…`,
                {
                  icon: "🔁",
                  description:
                    "External lanes lead — the built-in engine is the last rung, not the default.",
                }
              );
              await new Promise((r) => setTimeout(r, pick.waitMs));
              if (signal.aborted) {
                throw new DOMException("Aborted during rotation wait", "AbortError");
              }
            }
            dialLlm = {
              ...llm,
              provider: pick.llm.provider,
              apiKey: pick.llm.apiKey,
              baseUrl: pick.llm.baseUrl,
              model: pick.llm.model,
              providerId: pick.llm.providerId,
              label: `${llm.label} → ${pick.llm.label} (healthy lane leads — built-in reserved)`,
            };
            rotationNote = `healthy-lane lead — ${pick.llm.label} dialed instead of the built-in engine (external lanes first; built-in is the last rung)`;
          } else {
            const auto = resolveLlm(settings.settings, "auto");
            dialLlm = {
              ...llm,
              provider: auto.provider,
              apiKey: undefined,
              baseUrl: undefined,
              model: undefined,
              providerId: "auto",
              label: `${llm.label} → auto (primary demoted)`,
            };
          }
        }
      }
      // r306 registry rotation (the reconciliation half): on the FINAL attempt,
      // a still-saturated primary family is left ENTIRELY — the dial switches
      // to a different READY provider from the registry, or the soonest
      // available one (waiting exactly its remaining cooldown). Family-window
      // demotion only reorders the relay wire; in keyless profiles that wire
      // is short and lands on the SAME shared gateway, so leaving the family
      // needs a registry-wide switch. The ladder becomes: primary → built-in
      // engine → registry rotation. The gateway-wide "auto" congestion stays
      // with gateway-cadence (untracked here by design). r437: nextRotation
      // prefers the live rescue lane, so this final-attempt escape lands on
      // the lane that last proved healthy instead of registry order.
      if (
        attempt === MAX_STEP_ATTEMPTS &&
        !forceServer &&
        primaryFamilyKey !== "" &&
        laneSickUntil(laneSaturation, primaryFamilyKey, Date.now()) > Date.now()
      ) {
        const pick = nextRotation(settings.settings, llm.providerId);
        if (pick) {
          if (pick.waitMs > 0) {
            // Harness pacing: the whole roster is cooling — wait the soonest
            // window instead of blind-retrying into a fourth 429.
            patchRunStep(runStep.stepId, {
              backoffUntil: Date.now() + pick.waitMs,
              backoffKind: "cooldown",
            });
            toast.info(
              `"${runStep.label}" rotating to ${pick.llm.label} — waiting ${Math.round(pick.waitMs / 1000)}s for its quota window…`,
              {
                icon: "🔁",
                description:
                  "Every roster lane is cooling — the rotation waits exactly the soonest window instead of hammering a fourth 429.",
              }
            );
            await new Promise((r) => setTimeout(r, pick.waitMs));
            if (signal.aborted) {
              throw new DOMException("Aborted during rotation wait", "AbortError");
            }
          }
          dialLlm = {
            ...llm,
            provider: pick.llm.provider,
            apiKey: pick.llm.apiKey,
            baseUrl: pick.llm.baseUrl,
            model: pick.llm.model,
            providerId: pick.llm.providerId,
            label: `${llm.label} → ${pick.llm.label} (registry rotation)`,
          };
          rotationNote = `registry rotation — ${pick.llm.label} dialed instead of the saturated ${primaryFamilyKey} family`;
        }
      }
      // r309: the relay chain is a browser-vault construct (keys live client-side;
      // lib/relay is "use client"). On the server lane there is no vault — send no
      // relay hops rather than crash calling a client-reference function.
      let relayHops: RelayWireHop[] = [];
      if (typeof window !== "undefined") {
        relayHops = [
          ...buildRelayWire(
            settings.settings,
            { providerId: dialLlm.providerId, model: dialLlm.model },
            { taskFit }
          ),
          ...(dialLlm !== llm && llm.providerId !== "auto" && !pinDead
            ? [
                {
                  key: `${llm.providerId}::${llm.model ?? ""}`,
                  ...(llm.baseUrl ? { baseUrl: llm.baseUrl } : {}),
                  ...(llm.apiKey ? { apiKey: llm.apiKey } : {}),
                  model: llm.model ?? "",
                  label: llm.label,
                },
              ]
            : []),
        ];
      }
      try {
        draft = "";
        localToolCalls = [];
        relayNotes = [];
        // r652: the precedent lane's O1 note rides the FIRST executed step's
        // dials — one countable "Precedent lane" line per run, attached to
        // real telemetry (never a synthetic call row).
        if (precedentNote && runStep.stepId === firstExecutedStepId) {
          relayNotes.push(precedentNote);
        }
        // r512: a retired lane pin leads the notes (the WHY), then whatever
        // rotation reason this attempt picked (rescue / healthy lane).
        if (pinRetiredNote) {
          relayNotes.push(pinRetiredNote);
        }
        if (rotationNote) {
          relayNotes.push(rotationNote);
        }
        // r305 congestion rotation: hops whose provider family recently ate a
        // 429 move to the BACK of the wire (demoted, never dropped) so the
        // retry leads with healthy lanes instead of re-dialing the wave.
        const rotation = rotateHops(relayHops, laneSaturation, Date.now());
        if (rotation.demoted.length > 0) {
          relayHops = rotation.hops;
          relayNotes.push(
            `congestion rotation — ${rotation.demoted.join(", ")} demoted to the back of the wire (recent 429s or mid-stream drops)`
          );
        }
        // r126 model substitution: on the FINAL attempt, stop dials inside
        // the failing family — drop every hop from the primary's provider and
        // lead with whatever healthy alternate families the relay chain
        // offers (the user's ask: "similar, reliable model substitution").
        // Guarded: if the chain is ONLY same-family hops, keep the original
        // wire (a reachable same-family hop beats an empty one).
        if (attempt === MAX_STEP_ATTEMPTS && llm.providerId !== "auto") {
          const filtered = relayHops.filter(
            (h) => !h.key?.startsWith(`${llm.providerId}::`)
          );
          if (filtered.length > 0 && filtered.length < relayHops.length) {
            relayHops = filtered;
            relayNotes.push(
              `model substitution — ${llm.label} family deprioritized on the final attempt; leading with alternate lanes`
            );
          }
        }
        if (dialLlm !== llm && !rotationNote && !pinDead) {
          const sickLeft = Math.max(
            0,
            Math.ceil(
              (Math.max(
                primarySickUntil,
                laneSickUntil(laneSaturation, primaryFamilyKey, Date.now())
              ) -
                Date.now()) /
                1000
            )
          );
          relayNotes.push(
            attempt === 1
              ? `primary skipped — sick window active (${sickLeft}s left; mid-stream drop, 429 saturation or billing quarantine)`
              : `primary demoted — no external lane ready; built-in engine leads, ${llm.label} parked as last hop (mid-stream drop, 429 saturation or billing quarantine)`
          );
        }
        const res = await runAgentChat(
          {
            provider: dialLlm.provider,
            apiKey: dialLlm.apiKey,
            baseUrl: dialLlm.baseUrl,
            model: dialLlm.model,
            providerId: dialLlm.providerId,
            temperature: agent.temperature,
            maxIterations: agent.maxIterations,
            tools: effectiveTools,
            system,
            messages: [{ role: "user", content: context }],
            ...(relayHops.length > 0 ? { relay: relayHops } : {}),
            ...(forceServer ? { forceServer: true } : {}),
            // r513 gap closure: pipeline steps now carry the cortex config too
            // (BYOK, per run) — scheduled/server-lane deep_scrape, cortex_memory
            // and sandbox_exec calls get the same lane ladder chat has.
            ...(settings.settings.cortex &&
            (settings.settings.cortex.url ||
              settings.settings.cortex.hbKey ||
              settings.settings.cortex.vectorUrl ||
              settings.settings.cortex.vectorToken ||
              settings.settings.cortex.qstashToken ||
              settings.settings.cortex.boxApiKey)
              ? { cortex: settings.settings.cortex }
              : {}),
            signal,
          },
          {
            onStatus: (m) => {
              if (/Model relay:/i.test(m)) {
                // r188: one shared wire parser — the server's verdict marker
                // ([hopdead]/[hopauth]/[hopsoft]) overrides the 90-char
                // display-text guess, and notes stay marker-free.
                if (typeof window !== "undefined") {
                  // r309 hardening: these touch client-only surfaces (localStorage
                  // health memory via a "use client" module) — the server lane must
                  // never call through a client-reference proxy. No relay hops are
                  // sent server-side, so this branch is de-facto browser-only; the
                  // guard makes that structural, not incidental.
                  recordRelayStatusLine(m);
                  relayNotes.push(stripRelayMarkers(m));
                  // r512 dial-time backstop (wire hops): a hop that died with a
                  // missing-model body is catalog rot the tracker mirror may have
                  // missed — feed the lane's strike counter (2 strikes → retire).
                  const hopLine = parseRelayStatusLine(m);
                  if (
                    hopLine &&
                    !hopLine.ok &&
                    hopLine.key !== "auto::builtin" &&
                    classifyRunError(hopLine.error).kind === "model"
                  ) {
                    noteRemovalStrike(hopLine.key, hopLine.error);
                  }
                }
              }
            },
            onToken: (t) => {
              draft += t;
              patchRunStep(runStep.stepId, { output: draft });
            },
            onToolCall: (c) => {
              localToolCalls.push({ id: c.id, name: c.name, args: c.args });
              patchRunStep(runStep.stepId, { toolCalls: [...localToolCalls] });
            },
            onToolResult: (r) => {
              const idx = localToolCalls.findIndex((tc) => tc.id === r.id);
              if (idx !== -1) {
                localToolCalls[idx] = {
                  ...localToolCalls[idx],
                  result: r.content,
                  ok: r.ok,
                  ms: r.ms,
                };
              }
              patchRunStep(runStep.stepId, { toolCalls: [...localToolCalls] });
            },
          }
        );
        // r511 Praison L4: surface non-goal loop endings in the call note
        // (doom_loop / max_iterations / no_tool_calls) — rides relayNotes so
        // every note branch carries it.
        if (res.completionReason && res.completionReason !== "goal") {
          relayNotes.push(`loop: ${res.completionReason}`);
        }
        pushCall({
          stepId: runStep.stepId,
          stepLabel: runStep.label,
          agentName: agent.name,
          engine: dialLlm.label,
          model: dialLlm.model,
          ms: Date.now() - stepStart,
          ok: true,
          attempt,
          // r656 lineage hardening: the lane family rides as STRUCTURED data
          // (lane, stamped from res.transport — the actual dial wire), so the
          // run surface stops parsing prose prefixes; the note string stays
          // for humans. Absent when the transport is neither — never guessed.
          ...(res.transport === "browser-direct"
            ? { lane: "browser-direct" as const, note: ["browser-direct — key stayed in your browser", ...relayNotes].join(" → ") }
            : res.transport === "server"
              ? // v11b: lane attribution for EVERY relay-served call (incl. the
                // v10 auto-fallback and v11 forced retries) — previously only
                // browser-direct and hop-note runs were labelled, so a quiet
                // relay win was indistinguishable from a direct win.
                { lane: "server-relay" as const, note: [forceServer ? "server relay (forced retry — direct lane skipped)" : "server relay — routed through the app's vault chain", ...relayNotes].join(" → ") }
              : relayNotes.length > 0
                ? { note: relayNotes.join(" → ") }
                : {}),
        });
        if (dialLlm.providerId && dialLlm.providerId !== "auto") {
          // r306: a full successful dial proves the lane recovered — its
          // registry cooldown clears so later rotation picks may use it
          // immediately. (The family window keeps sliding by design: a 5m
          // cautious tail beats flip-flopping demotion.)
          resetProvider429(dialLlm.providerId);
        }
        if (dialLlm !== llm && dialLlm.providerId && dialLlm.providerId !== "auto") {
          // r437: a SUBSTITUTED dial that fully succeeded is a PROVEN rescue
          // lane — remember it so the next congested dial leads with it
          // instead of re-learning the saturation (the positive half of
          // rotation memory; run012-2128 lost three dials to exactly this).
          noteRescueLane(dialLlm.providerId);
        }
        patchRunStep(runStep.stepId, {
          output: res.content,
          toolCalls: res.toolCalls.length > 0 ? res.toolCalls : localToolCalls,
          status: "done",
          ms: Date.now() - stepStart,
          // r29: budget-sentinel answers are marked degraded — the UI shows an
          // "auto-digest" chip and downstream steps can tell material is thin.
          degraded: /^_The model ended/.test(res.content) || undefined,
        });
        return { content: res.content, ms: Date.now() - stepStart };
      } catch (err) {
        if (isAbortError(err)) {
          pushCall({
            stepId: runStep.stepId,
            stepLabel: runStep.label,
            agentName: agent.name,
            engine: dialLlm.label,
            model: dialLlm.model,
            ms: Date.now() - stepStart,
            ok: false,
            error: "aborted by user",
            attempt,
          });
          patchRunStep(runStep.stepId, {
            status: "stopped",
            output: draft || "(stopped)",
          });
          throw err;
        }
        const message = (err as Error).message ?? "unknown error";
        // r437: the rescue lane just failed a dial — its "proven healthy"
        // proof is spent. Only a matching id clears, so an unrelated lane's
        // failure never erases another lane's evidence.
        if (dialLlm.providerId) {
          clearRescueLane(dialLlm.providerId);
        }
        pushCall({
          stepId: runStep.stepId,
          stepLabel: runStep.label,
          agentName: agent.name,
          engine: dialLlm.label,
          model: dialLlm.model,
          ms: Date.now() - stepStart,
          ok: false,
          error: message,
          attempt,
          ...(relayNotes.length > 0 ? { note: relayNotes.join(" → ") } : {}),
        });
        // ─── Self-heal: up to two clean retries for transient engine failures ──────
        // r25: the engine now ships a structured `kind` on server errors —
        // use it when present; the message-regex stays as the fallback for
        // browser-direct errors.
        const kind =
          ((err as { kind?: RunErrorKind }).kind ?? classifyRunError(message).kind);
        // r512 dial-time backstop (primary dial): a 404/503 whose body matches
        // the existing missing-model classification is a removal the tracker
        // mirror missed — record a strike on the exact lane; at 2 strikes the
        // lane retires (lane-adopt) and the next lazy pass excludes it from
        // every rotation build and pin materialization.
        if (
          typeof window !== "undefined" &&
          kind === "model" &&
          dialLlm.providerId &&
          dialLlm.providerId !== "auto" &&
          dialLlm.model
        ) {
          noteRemovalStrike(`${dialLlm.providerId}::${dialLlm.model}`, message);
        }
        // v22: tool rounds streamed this attempt → the drop was MID-STREAM.
        // Demote the primary so the next attempt leads with the built-in
        // engine instead of re-dialing the provably sick endpoint first.
        // r505 SILENT-PRIMARY DOCTRINE: a PRE-STREAM timeout/network death
        // (0 tokens, 0 tool rounds — the Vyce-class corpse: connection
        // accepted, then silence for the whole first-token budget) is ALSO
        // proven lane sickness. Before this, only mid-stream drops demoted —
        // so every retry, every later step and every resume re-dialed the
        // silent corpse FIRST and burned 60s+ before the wire's healthy hops
        // got their turn (witnessed: "✗4 failed dials (Vyce AI ×4)" across a
        // parked run's whole life). rate-limit keeps its own saturation path
        // below; billing/auth keep theirs.
        if (
          SELF_HEAL_KINDS.includes(kind) &&
          (localToolCalls.length > 0 ||
            (draft.length === 0 && (kind === "timeout" || kind === "network")))
        ) {
          demotePrimary = true;
          // r126: promote to run scope — every later step starts demoted until
          // the window passes (stable continuation, not per-step re-learning).
          primarySickUntil = Date.now() + PRIMARY_SICK_MS;
          // r307: a mid-stream drop is PROVEN lane sickness — the connection
          // died after real tool rounds streamed. Feed the SAME saturation
          // memory 429s use: the wire demotes this family, every later step
          // and run opens demoted (tab-wide), and the final-attempt registry
          // escape can rotate off it. Before this, network/timeout deaths fed
          // ONLY the per-run demotion — the dominant live failure kind (Vyce
          // streams dying after tool calls) never reached rotation.
          const droppedFamily = laneFamilyKey(dialLlm.providerId);
          if (droppedFamily !== "" && droppedFamily !== "auto") {
            noteLaneFailure(laneSaturation, droppedFamily, Date.now());
            noteProviderFailure(dialLlm.providerId, Date.now());
          }
        }
        // r332 (user report): a billing death — "Your account balance is
        // insufficient. Please recharge…", Vyce's 403-phrased wallet-empty —
        // fed NO rotation memory before: every later step and every scheduled
        // fire re-dialed the corpse first. Quarantine the provider for 6h
        // (the r310 relay doctrine — same memory the relay side uses), demote
        // the primary for the rest of this run (later attempts/steps lead
        // with the built-in engine), and the final-attempt registry rotation
        // lands on a live lane because nextRotation reads the quarantine.
        if (
          kind === "billing" &&
          dialLlm.providerId &&
          dialLlm.providerId !== "auto"
        ) {
          noteProviderBilling(dialLlm.providerId, Date.now());
          demotePrimary = true;
          primarySickUntil = Date.now() + BILLING_DEAD_MS;
        }
        if (attempt < MAX_STEP_ATTEMPTS && SELF_HEAL_KINDS.includes(kind) && !signal.aborted) {
          // v23: a 429 is congestion, not flakiness — re-dialing within seconds
          // burns the whole ladder inside the same quota window (the user's
          // Continuous Research run recorded 3 failed 429 dials back-to-back;
          // v21b's server-side lesson now mirrored client-side).
          if (kind === "rate-limit") {
            // v24: congestion is shared fate — every scheduled START anywhere
            // in the app quiets down for 90s (gateway-cadence), not just this
            // step's own retry ladder. Stops pipeline pile-ups from feeding
            // the same quota window.
            noteGateway429();
            // r305: remember WHICH lane family is exhausted — sliding 5m
            // window, tab-wide (module memory). The retry below rotates off
            // it (primary demotion + hop demotion) and every later step in
            // any run opens demoted instead of re-learning the same 429.
            const saturatedFamily = laneFamilyKey(dialLlm.providerId);
            const saturatedNow =
              saturatedFamily !== "" && saturatedFamily !== "auto"
                ? noteLane429(laneSaturation, saturatedFamily, Date.now())
                : null;
            // r306: registry-wide exhaustion memory — the dialed provider's own
            // exponential cooldown (60s → 2m → … cap 15m) gates REGISTRY
            // rotation picks (nextRotation skips cooling lanes). Distinct role
            // from the family window above: that one paces SAME-family retries
            // and hop order; this one paces whether a provider may serve as a
            // rotation TARGET.
            if (dialLlm.providerId && dialLlm.providerId !== "auto") {
              noteProvider429(dialLlm.providerId, Date.now());
            }
            // r306: a pre-stream 429 on the primary itself demotes it for the
            // next attempt — before this only MID-STREAM deaths set
            // demotePrimary, so attempt 2 re-dialed the saturated primary
            // first (the recorded "3 failed 429 dials back-to-back").
            if (dialLlm === llm && llm.providerId !== "auto") {
              demotePrimary = true;
            }
            // r171+r305: the cooldown OUTLIVES the shared quiet window, and
            // its base now scales with provider exhaustion — the family's
            // consecutive 429 strikes (20s → 45s → 90s, tab-wide memory)
            // instead of a fixed per-attempt ladder. Jitter desynchronizes
            // concurrent steps the same way the scheduler desynchronizes
            // starts.
            const cooldown = jitteredBackoff(
              congestionCooldownMs(
                Math.max(saturatedNow?.strikes ?? 1, attempt),
                gatewayQuietUntil(),
                Date.now()
              )
            );
            // r128: surface the wait in the step row (backoffUntil drives the
            // live "⏳ Cooldown Ns" chip) — waits were toast-only before.
            patchRunStep(runStep.stepId, {
              backoffUntil: Date.now() + cooldown,
              backoffKind: "cooldown",
            });
            toast.info(`"${runStep.label}" is rate-limited — cooling down ${Math.round(cooldown / 1000)}s before retry ${attempt + 1}/${MAX_STEP_ATTEMPTS}…`, {
              icon: "⏳",
              description: "Free-tier quota windows refill — hammering them just burns attempts.",
            });
            await new Promise((r) => setTimeout(r, cooldown));
            if (signal.aborted) {
              throw new DOMException("Aborted during rate-limit cool-down", "AbortError");
            }
          }
          // r126: escalating backoff for network/timeout — the old ladder
          // re-dialed instantly, so ALL attempts landed inside the same
          // provider bad-window (forensics: 3 failed dials back-to-back during
          // a Vyce latency spike; their dashboard showed the 5m window
          // elevated the whole time). Jitter desynchronizes concurrent
          // scheduled runs so they don't re-dial in a stampede.
          if (kind === "network" || kind === "timeout") {
            const wait = Math.round(
              (attempt === 1 ? 8_000 : 25_000) * (0.85 + Math.random() * 0.3)
            );
            // r128: surface the wait in the step row (backoffUntil drives the
            // live "⏳ Backoff Ns" chip) — a 25s provider wait used to be
            // indistinguishable from a hang in the UI.
            patchRunStep(runStep.stepId, {
              backoffUntil: Date.now() + wait,
              backoffKind: "backoff",
            });
            toast.info(`"${runStep.label}" lost the provider — waiting ${Math.round(wait / 1000)}s before retry ${attempt + 1}/${MAX_STEP_ATTEMPTS}…`, {
              icon: "⏳",
              description: "Escalating backoff rides out the provider's bad window instead of burning every attempt inside it.",
            });
            await new Promise((r) => setTimeout(r, wait));
            if (signal.aborted) {
              throw new DOMException("Aborted during network backoff", "AbortError");
            }
          }
          toast.info(`"${runStep.label}" hit a ${kind} hiccup — auto-retry ${attempt + 1}/${MAX_STEP_ATTEMPTS} on a fresh lane…`, {
            icon: "🛟",
            description: demotePrimary
              ? "Primary demoted — this retry leads with the best available lane (external lanes first, the built-in engine stays the last rung). Tool results already gathered are re-run safely."
              : "The engine dropped the call mid-step. Tool results already gathered are re-run safely.",
          });
          patchRunStep(runStep.stepId, {
            status: "running",
            output: "",
            toolCalls: [],
            backoffUntil: undefined,
            backoffKind: undefined,
          });
          continue;
        }
        // Attach recovery metadata so failRun can attribute the failure precisely.
        const meta = err as Error & { stepId?: string; toolCallsOk?: number; autoRetried?: boolean };
        meta.stepId = runStep.stepId;
        meta.toolCallsOk = localToolCalls.filter((tc) => tc.ok === true).length;
        meta.autoRetried = attempt > 1;
        patchRunStep(runStep.stepId, {
          status: "error",
          output: `${draft ? `${draft}\n\n` : ""}**Error:** ${message}`,
        });
        throw err;
      }
    }
    // Unreachable (loop either returns or throws) — kept for the type checker.
    throw new Error(`Step "${runStep.label}" exhausted its attempts.`);
  };

  try {
    // Resume: rebuild the conversation context from every completed step
    // before the resume point — nothing the user already paid for is lost.
    const prev: PrevStepOutput[] =
      startIndex > 0
        ? steps
            .slice(0, startIndex)
            .filter((s) => s.status === "done" && s.output.trim() !== "")
            .map((s) => ({ label: s.label, agentName: s.agentName, output: s.output, degraded: s.degraded }))
        : [];
    const framework = settings.settings.framework;

    // ─── r457: prior-knowledge injection — on a FRESH run of a workflow that
    // has an archived completed report, prepend a bounded digest of it as a
    // synthetic prior step so every step's context carries the prior run's
    // knowledge (user ask r455). Best-effort: any failure just runs without
    // it. Resume runs (startIndex > 0) skip this — their context is already
    // rebuilt from completed steps.
    // The first EXECUTED step carries the lane's O1 note on its dials.
    firstExecutedStepId = steps[startIndex]?.stepId ?? "";
    if (startIndex === 0 && wf.id) {
      const prior = await loadPriorReportDigest(wf.id);
      if (prior) prev.push(prior);
      // ─── r652: precedent-exemplar lane, engine injection (slice 2) ──────
      // The block rides LAST in prev — closest to every generation point
      // (induction-head importance grows with token position, the paper's
      // own finding — the two-occurrence rule wants the exemplar NEAR the
      // generation ask). Best-effort: any failure runs without it, exactly
      // like the r457 digest above.
      try {
        const lane = await loadPrecedentInjection(task);
        if (lane.injection) prev.push(lane.injection);
        precedentNote = lane.note;
      } catch {
        /* the lane never affects the run */
      }
    }

    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i];
      const def = wf.steps.find((s) => s.id === step.stepId);
      const kind = def?.kind ?? "generate";
      // Authored steps take their instruction from the definition; synthetic
      // depth passes (no def) carry their appended focus on the run row itself.
      const instruction = def ? def.instruction : step.instruction;
      const baseSystem = instruction
        ? `${useAgentsStore.getState().agents.find((a) => a.id === step.agentId)?.instructions ?? ""}\n\nFOCUS FOR THIS STEP: ${instruction}`
        : useAgentsStore.getState().agents.find((a) => a.id === step.agentId)?.instructions ?? "";

      const agentRow = useAgentsStore
        .getState()
        .agents.find((a) => a.id === step.agentId);
      if (!agentRow) {
        patchRunStep(step.stepId, { status: "error", output: "Agent not found" });
        failRun(i, new Error(`Agent "${step.agentName}" was deleted — re-add it to this workflow, then resume.`));
        return runId;
      }

      // ─── Review gate: audit the previous step, may force one rework pass ───
      if (kind === "review" && i > 0) {
        const reviewed = steps[i - 1];
        const context = buildReviewContext(
          task,
          prev[prev.length - 1] ?? {
            label: reviewed.label,
            agentName: reviewed.agentName,
            output: reviewed.output,
          }
        );

        let reworks = 0;
        // Bounded loop: review → (rework previous → review again) → continue
        for (;;) {
          try {
            const { content, ms } = await streamStep(step, step.agentId, baseSystem, context);
            const verdict = parseReviewVerdict(content);

            if (verdict === "pass" || reworks >= REWORK_LIMIT) {
              patchRunStep(step.stepId, {
                status: "done",
                output: content,
                verdict: verdict === "pass" ? "pass" : "rework",
                kind: "review",
                ms,
              });
              prev.push({
                label: step.label,
                agentName: agentRow.name,
                degraded: /^_The model ended/.test(content) || undefined,
                output:
                  verdict === "pass"
                    ? content
                    : `${content}\n\n(Note: the reviewer still wanted changes after ${REWORK_LIMIT} rework pass${REWORK_LIMIT === 1 ? "" : "es"} — pipeline continued.)`,
              });
              break;
            }

            // ─── Rework: re-run the previous generate step with feedback ───
            reworks++;
            const feedback = content;
            patchRunStep(step.stepId, {
              status: "done",
              output: feedback,
              verdict: "rework",
              kind: "review",
              ms,
            });
            toast.warning("Review gate sent the step back for rework", {
              icon: "↻",
              description: `${step.label} → ${reviewed.label} (pass ${reworks}/${REWORK_LIMIT + 1})`,
            });

            const genAgent = useAgentsStore
              .getState()
              .agents.find((a) => a.id === reviewed.agentId);
            if (!genAgent) {
              patchRunStep(reviewed.stepId, { status: "error", output: "Agent not found" });
              failRun(i, new Error(`Agent "${reviewed.agentName}" was deleted — re-add it to this workflow, then resume.`));
              return runId;
            }
            const reviewedDef = wf.steps.find((s) => s.id === reviewed.stepId);
            const genBase = reviewedDef?.instruction
              ? `${genAgent.instructions}\n\nFOCUS FOR THIS STEP: ${reviewedDef.instruction}`
              : genAgent.instructions;
            const reworkSystem = `${genBase}\n\nREWORK REQUIRED — your previous attempt was rejected by the review gate. Reviewer feedback: ${feedback}\nAddress every point and deliver an improved result.`;

            // Rebuild the context WITHOUT the reviewed step's stale output
            prev.pop();
            const genContext =
              framework === "sequential"
                ? buildSequentialContext(task, prev)
                : buildConversationalContext(task, prev);

            patchRunStep(reviewed.stepId, { status: "running", reworked: true });
            const gen = await streamStep(
              reviewed,
              reviewed.agentId,
              reworkSystem,
              genContext
            );
            prev.push({
              label: reviewed.label,
              agentName: genAgent.name,
              degraded: /^_The model ended/.test(gen.content) || undefined,
              output: gen.content,
            });
            // Loop → the review gate runs again on the improved output
          } catch (err) {
            if (isAbortError(err)) {
              if (stalledRuns.has(wf.id)) {
                // Watchdog abort: bounded auto-resume, else manual-resume card.
                stalledRuns.delete(wf.id);
                const stalledRun = useWorkflowsStore
                  .getState()
                  .workflows.find((w) => w.id === wf.id)
                  ?.runs.find((r) => r.id === runId);
                if ((stalledRun?.resumeCount ?? 0) < MAX_AUTO_RESUMES) {
                  failRun(
                    i,
                    new Error(
                      `Step timed out — no model output for over ${stallTimeoutLabel()}. Auto-resuming (attempt ${(stalledRun?.resumeCount ?? 0) + 1}/${MAX_AUTO_RESUMES})…`
                    ),
                    { stallOwned: true } // r178: watchdog path resumes itself — park ladder must not double-schedule
                  );
                  scheduleAutoResume(wf.id, runId, i, stalledRun?.resumeCount ?? 0);
                  return runId;
                }
                failRun(
                  i,
                  new Error(
                    `Step timed out — no model output for over ${stallTimeoutLabel()}. The stream stalled (background tab throttling or a dropped connection). Every completed step is preserved — resume from here.`
                  ),
                  { stallOwned: true } // r72 contract: budget exhausted → manual-resume card, not more machine waiting
                );
                return runId;
              }
              stopRemaining(i);
              finish("stopped", "Pipeline stopped");
              return runId;
            }
            failRun(i, err as Error);
            return runId;
          }
        }
        continue;
      }

      // ─── Regular generate step ────────────────────────────────────────────
      const context =
        framework === "sequential"
          ? buildSequentialContext(task, prev)
          : buildConversationalContext(task, prev);

      try {
        // ─── r27 SYSTEM-ONE GATE (Jev doctrine: not everything requires a
        // frontier model): a cheap calibrated judge decides whether the
        // flagship verification pass is even needed. A confident PASS skips
        // the extra frontier call entirely; FAIL, low confidence or "no
        // judge available" keeps the full pass — worst case = status quo.
        // ─── r512 crew judge-gates WIRED: when the agent under verification
        // maps to a CrewRoleDef whose gate is enabled (judge / implementer /
        // reviewer), the gate QUESTION is that role's own template
        // instantiated with the step output, and the pass mark is the role's
        // threshold — still through the EXISTING free-first SystemOne ladder
        // (decide(), no paid Jev in the default path). The role is derived
        // exactly the way the crew panel does it (crewRoleIdForAgent keyword
        // map — agents do not store a roleId).
        if (step.instruction === VERIFICATION_INSTRUCTION) {
          const draft = prev[prev.length - 1]?.output ?? "";
          const crewRole = CREW_ROLE_DEFS[crewRoleIdForAgent(agentRow)];
          const roleGate = crewRole.gate.enabled ? crewRole : null;
          const gateQuestion = roleGate
            ? roleGate.gate.question.replace(
                /\{\{output\}\}/g,
                // The template names the artifact; the excerpt stays bounded
                // (the full draft already rides the state block below).
                draft.slice(0, 600).trim() || "(empty output)"
              )
            : "Is this draft a COMPLETE final deliverable for the task — on-topic, no placeholder text, no unanswered sub-questions, and no obviously unsupported load-bearing claims? Minor polish issues do not count against it.";
          const gateThreshold = roleGate ? roleGate.gate.threshold : SYSTEMONE_GATE_CONFIDENCE;
          const gate = await decide({
            settings: settings.settings,
            signal,
            state: `TASK:\n${task}\n\nDRAFT OUTPUT (the previous step's deliverable):\n${draft.slice(0, 6000)}`,
            question: {
              id: "verify-gate",
              type: "noul",
              prompt: gateQuestion,
            },
          });
          if (gate && gate.answer === "yes" && gate.confidence >= gateThreshold) {
            patchRunStep(step.stepId, {
              output: draft,
              toolCalls: [],
              status: "done",
              ms: gate.ms,
            });
            pushCall({
              stepId: step.stepId,
              stepLabel: step.label,
              agentName: agentRow.name,
              engine: gate.judge,
              model: gate.via,
              ms: gate.ms,
              ok: true,
              attempt: 1,
              // r512: role gates are distinguishable on the wire — the crew
              // panel's alignment math counts these notes.
              note: roleGate
                ? `System-One gate PASS ${(gate.confidence * 100).toFixed(0)}% (${gate.via} · role:${roleGate.id}) — flagship verification pass skipped`
                : `System-One gate PASS ${(gate.confidence * 100).toFixed(0)}% (${gate.via}) — flagship verification pass skipped`,
            });
            toast("System-One gate passed", {
              icon: "✓",
              description: `${(gate.confidence * 100).toFixed(0)}% confident via ${
                gate.via === "intern-systemone" ? "free Intern SystemOne" : gate.via === "jev" ? "Jev" : "fast judge"
              } — verification pass skipped`,
            });
            prev.push({ label: step.label, agentName: agentRow.name, degraded: /^_The model ended/.test(draft) || undefined, output: draft });
            continue;
          }
          // r512: an actual FAIL verdict now leaves an honest callLog entry —
          // the crew panel's gate pass-rate reads /System-One gate (?:fail|rework)/
          // and previously had nothing to count (a FAIL fell through silently).
          // Control flow is UNCHANGED: the full verification pass runs below,
          // exactly like the generic gate's failure semantics.
          if (gate && gate.answer !== "yes") {
            pushCall({
              stepId: step.stepId,
              stepLabel: step.label,
              agentName: agentRow.name,
              engine: gate.judge,
              model: gate.via,
              ms: gate.ms,
              ok: true,
              attempt: 1,
              note: `System-One gate FAIL ${(gate.confidence * 100).toFixed(0)}%${roleGate ? ` (role:${roleGate.id})` : ""} — rework → full verification pass runs`,
            });
          }
          // FAIL / uncertain / no judge available → run the full verification pass.
        }
        const { content } = await streamStep(step, step.agentId, baseSystem, context);

        // ─── r516 PER-STEP DECISION GATE (owner directive: "decision models
        // should be used in our workflows to improve our LLM's capabilities").
        // After every regular generate step, the FREE System-One ladder
        // (Intern Decision-4B on its separate 200 RPM decision quota → fast
        // flash judge → paid Jev only if ever keyed) reviews the output
        // against the step assignment:
        //   • confident PASS  → accepted, a witness line lands in the call log;
        //   • confident FAIL  → ONE bounded free rework pass, then accept;
        //   • uncertain/no judge/gate off → accept unchanged (never blocks;
        //     worst case = the exact pre-r516 behavior).
        // Skipped for short drafts (<200 chars) and degraded streams — a
        // three-line answer has no output worth a judge round-trip.
        let finalOutput = content;
        const gateEnabled = settings.settings.decisionGates !== false;
        const gateWorthy =
          gateEnabled &&
          content.trim().length >= GATE_MIN_CHARS &&
          !/^_The model ended/.test(content) &&
          kind === "generate";
        if (gateWorthy) {
          // r662: declared OUTSIDE the try — the judge-errored catch below
          // composes the same trace into its note.
          const gateAttempts: string[] = [];
          try {
            const gate = await decide({
              settings: settings.settings,
              signal,
              // r662: per-rung attempt trace — when no judge answers, the
              // witness note can say WHY (which rungs were tried and how
              // they fell through) instead of a bare "no judge answered".
              onAttempt: (line) => {
                if (gateAttempts.length < 6) gateAttempts.push(line);
              },
              state: `TASK:\n${task}\n\nSTEP: ${step.label}\nSTEP ASSIGNMENT: ${instruction ?? "(the agent's standing instructions)"}\n\nOUTPUT UNDER REVIEW:\n${content.slice(0, 5000)}`,
              question: {
                id: "step-gate",
                type: "noul",
                prompt:
                  "Does this output fulfill the step assignment — substantive, on-topic, no placeholder text, and no obviously unfinished sections?",
                criteriaTrue: "the output fulfills the step assignment",
                criteriaFalse:
                  "the output is incomplete, off-topic, placeholder, or clearly unfinished",
              },
            });
            if (gate?.answer === "yes" && gate.confidence >= SYSTEMONE_GATE_CONFIDENCE) {
              pushCall({
                stepId: step.stepId,
                stepLabel: step.label,
                agentName: agentRow.name,
                engine: gate.judge,
                model: gate.via,
                ms: gate.ms,
                ok: true,
                attempt: 1,
                note: `Decision gate PASS ${(gate.confidence * 100).toFixed(0)}% (${gate.via}) — output accepted`,
              });
            } else if (gate?.answer === "no" && gate.confidence >= SYSTEMONE_GATE_CONFIDENCE) {
              pushCall({
                stepId: step.stepId,
                stepLabel: step.label,
                agentName: agentRow.name,
                engine: gate.judge,
                model: gate.via,
                ms: gate.ms,
                ok: true,
                attempt: 1,
                note: `Decision gate FAIL ${(gate.confidence * 100).toFixed(0)}% (${gate.via}) — one free rework pass runs`,
              });
              const rCap = Math.min(Math.max(Math.floor(step.loopedPasses ?? 0), 0), LOOP_PASSES_CAP);
              if (rCap >= 2) {
                // ─── r644 LOOPED DEPTH (paper adaptation slice 2, arXiv
                // 2610.31421): the FAIL branch becomes a verdict-gated loop —
                // the TIED rework block (byte-identical prompt, the looped
                // invariant) re-runs up to rCap passes, each pass RE-JUDGED by
                // the same free gate; loopExit semantics: pass exits,
                // consecutive fail exhausts, unsure iterates toward the cap.
                // Opt-in only (step.loopedPasses); default steps take the
                // legacy single-rework path below, byte-identical.
                const tiedBlock = `${baseSystem}\n\nREWORK REQUIRED — the quality judge rejected the previous output as incomplete or off-topic for this step. Deliver a complete, substantive result.`;
                let loopK = 0;
                let loopReason = "cap-reached";
                for (let i = 1; i <= rCap; i++) {
                  loopK = i;
                  patchRunStep(step.stepId, { status: "running", reworked: true });
                  const lp = await streamStep(step, step.agentId, tiedBlock, context);
                  finalOutput = lp.content;
                  pushCall({
                    stepId: step.stepId,
                    stepLabel: step.label,
                    agentName: agentRow.name,
                    engine: gate.judge,
                    model: gate.via,
                    ms: lp.ms,
                    ok: true,
                    attempt: i + 1,
                    note: `Looped pass ${i}/${rCap} delivered (tied block) — re-judging`,
                  });
                  try {
                    const v2 = await decide({
                      settings: settings.settings,
                      signal,
                      state: `TASK:\n${task}\n\nSTEP: ${step.label}\nSTEP ASSIGNMENT: ${instruction ?? "(the agent's standing instructions)"}\n\nOUTPUT UNDER REVIEW:\n${finalOutput.slice(0, 5000)}`,
                      question: {
                        id: "step-gate-looped",
                        type: "noul",
                        prompt:
                          "Does this output fulfill the step assignment — substantive, on-topic, no placeholder text, and no obviously unfinished sections?",
                        criteriaTrue: "the output fulfills the step assignment",
                        criteriaFalse:
                          "the output is incomplete, off-topic, placeholder, or clearly unfinished",
                      },
                    });
                    if (v2?.answer === "yes" && v2.confidence >= SYSTEMONE_GATE_CONFIDENCE) {
                      loopReason = "pass-verdict";
                      pushCall({ stepId: step.stepId, stepLabel: step.label, agentName: agentRow.name, engine: v2.judge, model: v2.via, ms: v2.ms, ok: true, attempt: i + 1, note: `Looped exit at pass ${loopK}/${rCap} (pass-verdict) — output accepted` });
                      break;
                    }
                    if (v2?.answer === "no" && v2.confidence >= SYSTEMONE_GATE_CONFIDENCE) {
                      loopReason = "rework-exhausted";
                      pushCall({ stepId: step.stepId, stepLabel: step.label, agentName: agentRow.name, engine: v2.judge, model: v2.via, ms: v2.ms, ok: true, attempt: i + 1, note: `Looped exit at pass ${loopK}/${rCap} (rework-exhausted) — best attempt kept` });
                      break;
                    }
                  } catch {
                    /* judge error on a looped pass → stop iterating honestly */
                    loopReason = "judge-unavailable";
                    break;
                  }
                }
                patchRunStep(step.stepId, { looped: { k: loopK, r: rCap, reason: loopReason } });
              } else {
                patchRunStep(step.stepId, { status: "running", reworked: true });
                const rework = await streamStep(
                  step,
                  step.agentId,
                  `${baseSystem}\n\nREWORK REQUIRED — the quality judge rejected the previous output as incomplete or off-topic for this step. Deliver a complete, substantive result.`,
                  context
                );
                finalOutput = rework.content;
                pushCall({
                  stepId: step.stepId,
                  stepLabel: step.label,
                  agentName: agentRow.name,
                  engine: gate.judge,
                  model: gate.via,
                  ms: rework.ms,
                  ok: true,
                  attempt: 2,
                  note: `Rework pass delivered after Decision gate FAIL (${gate.via}) — output replaced`,
                });
              }
            }
            // r659 + r660: an UNCERTAIN verdict (below gate confidence either
            // way) — or NO JUDGE AT ALL (decide() resolves null when the free
            // ladder answers nothing; hit live in the r660 witness run under
            // congestion) — no longer vanish. The gate ENGAGED and the user
            // is entitled to see that it ran.
            else {
              pushCall({
                stepId: step.stepId,
                stepLabel: step.label,
                agentName: agentRow.name,
                engine: gate ? gate.judge : "gate",
                model: gate ? gate.via : "no-judge-available",
                ms: gate ? gate.ms : 0,
                ok: true,
                attempt: 1,
                note: gate
                  ? `Decision gate uncertain ${(gate.confidence * 100).toFixed(0)}% (${gate.via}) — no confident verdict; output accepted unchanged`
                  : `Decision gate engaged but no judge answered${gateAttempts.length ? ` (tried: ${gateAttempts.join("; ")})` : ""} — output accepted unchanged (verdict not possible, not a pass)`,
              });
            }
          } catch {
            /* the gate NEVER blocks a run — judge errors fall through */
            // r659: a judge ERROR is an honest witness too — the gate ran,
            // no verdict arrived; an infra stop, not a quality verdict.
            pushCall({
              stepId: step.stepId,
              stepLabel: step.label,
              agentName: agentRow.name,
              engine: "gate",
              model: "judge-errored",
              ms: 0,
              ok: true,
              attempt: 1,
              note: `Decision gate judge errored — no verdict arrived; output accepted unchanged (infra stop, not quality)${gateAttempts.length ? ` (tried: ${gateAttempts.join("; ")})` : ""}`,
            });
          }
        }
        // ─── r578 PEER BLIND SCORE (P2 experiment slice 1): a SECOND,
        // deliberately blind cheap-lane reviewer for gate-worthy steps — it
        // sees ONLY the output (no task/assignment) and rates universal
        // quality (substance, coherence, completeness). Confident FAIL → ONE
        // bounded blind-revise pass (max two rework dials per step across
        // both gates). Same economics as the r516 gate: ≥200 chars,
        // non-degraded, toggleable, never blocks a run.
        if (
          gateEnabled &&
          settings.settings.peerBlindScore !== false &&
          finalOutput.trim().length >= GATE_MIN_CHARS &&
          !/^_The model ended/.test(finalOutput)
        ) {
          try {
            const peer = await decide({
              settings: settings.settings,
              signal,
              state: buildBlindReviewInput(finalOutput),
              question: BLIND_REVIEW_QUESTION,
            });
            if (peer) {
              pushCall({
                stepId: step.stepId,
                stepLabel: step.label,
                agentName: agentRow.name,
                engine: peer.judge,
                model: peer.via,
                ms: peer.ms,
                ok: true,
                attempt: 1,
                note: peerBlindNote(peer),
              });
              if (peerBlindShouldRevise(peer)) {
                patchRunStep(step.stepId, { status: "running", reworked: true });
                const revise = await streamStep(
                  step,
                  step.agentId,
                  `${baseSystem}\n\nINDEPENDENT REVIEW REQUIRED — a blind second reviewer (no task context) found this output thin or incomplete. Deliver a stronger, complete result.`,
                  context
                );
                finalOutput = revise.content;
                pushCall({
                  stepId: step.stepId,
                  stepLabel: step.label,
                  agentName: agentRow.name,
                  engine: peer.judge,
                  model: peer.via,
                  ms: revise.ms,
                  ok: true,
                  attempt: 2,
                  note: `Blind-revise pass delivered after Peer blind score FAIL (${peer.via}) — output replaced`,
                });
              }
            }
          } catch {
            /* the peer NEVER blocks a run — judge errors fall through */
          }
        }
        prev.push({ label: step.label, agentName: agentRow.name, degraded: /^_The model ended/.test(finalOutput) || undefined, output: finalOutput });
      } catch (err) {
        if (isAbortError(err)) {
          if (stalledRuns.has(wf.id)) {
            // Watchdog abort: bounded auto-resume, else manual-resume card.
            stalledRuns.delete(wf.id);
            const stalledRun = useWorkflowsStore
              .getState()
              .workflows.find((w) => w.id === wf.id)
              ?.runs.find((r) => r.id === runId);
            if ((stalledRun?.resumeCount ?? 0) < MAX_AUTO_RESUMES) {
              failRun(
                i,
                new Error(
                  `Step timed out — no model output for over ${stallTimeoutLabel()}. Auto-resuming (attempt ${(stalledRun?.resumeCount ?? 0) + 1}/${MAX_AUTO_RESUMES})…`
                ),
                { stallOwned: true } // r178: watchdog path resumes itself — park ladder must not double-schedule
              );
              scheduleAutoResume(wf.id, runId, i, stalledRun?.resumeCount ?? 0);
              return runId;
            }
            failRun(
              i,
              new Error(
                `Step timed out — no model output for over ${stallTimeoutLabel()}. The stream stalled (background tab throttling or a dropped connection). Every completed step is preserved — resume from here.`
              ),
              { stallOwned: true } // r72 contract: budget exhausted → manual-resume card, not more machine waiting
            );
            return runId;
          }
          stopRemaining(i);
          finish("stopped", "Pipeline stopped");
          return runId;
        }
        // ─── r654: deep-pass NON-FATALITY (the loop saver). A SYNTHETIC deep
        // pass is an optional enhancement, not the pipeline: one congestion
        // death on "Deep research pass 2/3" used to stopRemaining every
        // downstream AUTHORED step — the Owner's 6h RSI cycle never reached
        // its own final "schedule next cycle" step (forensics: 7 done / 3
        // blocked / 2 partial, every non-done run dead at a deep pass).
        // Transient-class deaths (rate-limit / network / timeout — the exact
        // family resolvePark parks and SELF_HEAL_KINDS heals) now skip the
        // pass honestly and CONTINUE; aborts were handled above; auth/model/
        // billing/region/unknown stay fatal (real breakage deserves a human).
        // The failed pass contributes nothing to prev[] by construction (it
        // is pushed on success only), so later steps simply build context
        // without it — no context surgery, no phantom evidence.
        {
          const deepMsg = safeErrorMessage(err);
          const deepKind = classifyRunError(deepMsg).kind;
          if (
            isSyntheticDeepStep(step.stepId, step.instruction) &&
            isTransientErrorKind(deepKind)
          ) {
            deepSkips.count += 1;
            if (!deepSkips.kinds.includes(deepKind)) deepSkips.kinds.push(deepKind);
            patchRunStep(step.stepId, {
              status: "skipped",
              output: `(deep pass skipped — transient ${deepKind}: ${deepMsg.slice(0, 200)})`,
            });
            pushCall({
              stepId: step.stepId,
              stepLabel: step.label,
              agentName: agentRow.name,
              engine: resolveLlm(settings.settings).label,
              ms: 0,
              ok: false,
              error: deepMsg.slice(0, 200),
              note: deepPassSkipNote(deepKind, deepMsg),
            });
            toast.warning("Deep pass skipped — cycle continues", {
              icon: "↯",
              description: `${step.label} · ${ERROR_KIND_META[deepKind].label.toLowerCase()} — remaining steps keep running; the run finishes with a "deep skipped" mark.`,
            });
            continue;
          }
        }
        failRun(i, err as Error);
        return runId;
      }
    }

    finish("done", startIndex > 0 ? "Pipeline resumed & finished" : "Pipeline finished");
    return runId;
  } catch (err) {
    // v23: the loop's inner catches own step errors; anything landing here
    // escaped through a gap (context builders, finalizer internals, callbacks)
    // and used to reject the run promise — the user-visible result was the
    // Next.js overlay's "Runtime Error: undefined". Finalize honestly instead:
    // mark the run error, keep partial output, log the escaped cause.
    console.error("[workflow-runner] escaped run error", err);
    try {
      failRun(startIndex, err instanceof Error ? err : new Error(safeErrorMessage(err)));
    } catch (finalizerErr) {
      console.error("[workflow-runner] finalizer itself failed", finalizerErr);
    }
    return runId;
  } finally {
    activeRuns.delete(wf.id);
    activeControllers.delete(wf.id);
    lastRunActivity.delete(wf.id);
    stalledRuns.delete(wf.id);
    useUiStore.getState().setBusy(false);
  }
}
