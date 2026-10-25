"use client";

import * as React from "react";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  Copy,
  Download,
  FlaskConical,
  Hourglass,
  KeyRound,
  Radar as RadarIcon,
  RefreshCw,
  RadioTower,
  Search,
  Server,
  Sparkles,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useUiStore, useWorkflowsStore } from "@/lib/stores";
import { copyText } from "@/lib/helpers";
import {
  computeStaleRegistry,
  humanizeLaneReason,
  type ExecutorLaneState,
} from "@/lib/automation-lane";
import { cn } from "@/lib/utils";
import { classifyRunError, runErrorKindLabel, SELF_HEAL_KINDS } from "@/lib/workflow-runner";

// r397: transient = classified self-healable (network / timeout / rate-limit)
// via the production classifier — replacing the r116 TRANSIENT_RE mirror so
// runner, run panel and this surface share ONE "retrying helps" definition.
// These render as amber "↻ retried", NOT the terminal red "✗ error".
function isTransientRunError(error: string | null | undefined): boolean {
  if (!error) return false;
  return SELF_HEAL_KINDS.includes(classifyRunError(error).kind);
}

// TASK-101 slice 4 (r535): the server lane now RESUMES an errored run at
// its failed step on the next scheduled fire (memoized completed prefix —
// resumableErroredRunId + executeWorkflow). Any run that died through the
// executor's step-scoped failure path (`step N/M "…" …`) carries that
// semantics; rendered as amber "↻ resumes", subsuming the transient badge
// (resumption is the stronger, truer claim about the same next fire).
function isResumableStepFailure(error: string | null | undefined): boolean {
  if (!error) return false;
  return /^step \d+\/\d+ "/.test(error);
}

// ─── v20: Server autopilot panel (Workflow Studio) ───────────────────────────
// Surfaces the headless layer: whether the local server or the open browser
// tab is currently driving scheduled runs, what is registered, and recent
// server-side runs with live step progress.

type RegistryRow = {
  id: string;
  name: string;
  intervalMs: number;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  failStreak: number;
};
type RunRow = {
  id: string;
  workflowName: string;
  trigger: string;
  status: string;
  currentStep: number;
  stepsTotal: number;
  finalReport: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};
type SyncState = {
  serverDriving: boolean;
  lastSeenAt: string | null;
  registry: RegistryRow[];
  runs: RunRow[];
  // r205: the sync GET mirrors the executor's exact dial resolution — what
  // a due closed-tab run would do RIGHT NOW (first vault slot, registry
  // provider pairing, builtin skipped). Supersedes the r134 builtin-slot
  // read, which could claim a lane the executor would refuse.
  executorLane?: ExecutorLaneState;
};

const POLL_MS = 15_000;
// r497: the radar digest changes at most hourly (one row per UTC hour
// bucket) — a 60s poll keeps the panel honest without hammering the route.
const RADAR_POLL_MS = 60_000;
// r515: the AIE cycles every 10 minutes (idempotent per bucket) — the same
// 60s poll cadence keeps the moves/queue/log feed honest without hammering.
const AUTONOMY_POLL_MS = 60_000;

// r515: kind → glyph map for the next-moves list (kept tiny + local).
function MoveKindIcon({ kind, className }: { kind: string; className?: string }) {
  const props = { className: cn("h-3 w-3 shrink-0", className), "aria-hidden": true as const };
  switch (kind) {
    case "research-repo":
      return <Search {...props} />;
    case "import-seed":
      return <Download {...props} />;
    case "radar-followup":
      return <RadarIcon {...props} />;
    case "await-owner":
      return <Hourglass {...props} />;
    default:
      return <CircleDot {...props} />;
  }
}

// r515: honest status chips — violet = waiting, emerald = done, red = failed,
// amber = mid-flight, muted = honest skip.
function moveStatusClass(status: string): string {
  switch (status) {
    case "executed":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
    case "failed":
      return "border-red-500/40 bg-red-500/10 text-red-400";
    case "executing":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "skipped":
      return "border-muted-foreground/30 bg-muted/20 text-muted-foreground";
    default:
      return "border-violet-500/40 bg-violet-500/10 text-violet-300";
  }
}

// ── r497: Capability Radar view types (client mirror of the server digest) ──
type RadarFindingView = {
  severity: "critical" | "warning" | "info";
  area: string;
  title: string;
  evidence: string;
  tryable: string | null;
};
type RadarDigestView = {
  generatedAt: string;
  hourBucket: string;
  windowHours: number;
  runs: {
    total: number;
    done: number;
    error: number;
    blocked: number;
    toolCalls: number;
    failureRate: number;
    quietCycles: number;
    gatewayAuthFailures: number;
  };
  registry: { enabled: number; parked: string[]; overdue: string[] };
  vault: { slots: number; closedTabLane: string };
  catalog: { newModels48h: string[]; removed48h: number };
  gateway: {
    probe: {
      ok: boolean;
      ms: number;
      error: string | null;
      /** r500 class label — older persisted digests predate it, hence optional. */
      class?: "ok" | "congestion" | "auth" | "down";
      attempts?: number;
    };
  };
  experiments: { name: string; why: string }[];
  findings: RadarFindingView[];
  seeds: { label: string; prompt: string }[];
};
type RadarState = {
  ok: boolean;
  error?: string;
  latest: RadarDigestView | null;
  history: { id: string; findings: number; critical: number; warnings: number; tryables: number; updatedAt: string }[];
};

// ── r515: Autonomous Improvement Engine view types (client mirror) ──────────
type AutonomyLogView = {
  id: string;
  kind: string; // "cycle" | "report"
  summary: string;
  movesJson: string;
  statsJson: string;
  createdAt: string;
};
type AutonomyMoveView = {
  id: string;
  cycleId: string;
  rank: number;
  kind: string; // research-repo | import-seed | run-workflow | radar-followup | await-owner
  title: string;
  rationale: string;
  status: string; // proposed | executing | executed | failed | skipped
  result: string | null;
  createdAt: string;
};
type AutonomyState = {
  ok: boolean;
  error?: string;
  latestLog: AutonomyLogView | null;
  latestReport: AutonomyLogView | null;
  logs: AutonomyLogView[];
  queue: { queued: number; researched: number; failed: number; oldestQueuedAgeMin: number | null };
  moves: AutonomyMoveView[];
  moves24: { executed: number; failed: number; proposed: number };
  engine: { lastCycleAt: string | null; nextCycleInMin: number | null; enabled: boolean };
};
type EnqueueCounts = { ok: boolean; inserted: number; duplicates: number; invalid: number; capped?: boolean; error?: string };

function fmtIn(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "due";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function fmtAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  // r137: the heartbeat timestamp can land a hair AFTER this tab's clock
  // (server write vs client read skew) — the panel rendered "-5s ago" live.
  // Anything under 10s is "just now"; never render a negative duration.
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${(m / 60).toFixed(1)}h ago`;
}

// ─── r500: class-aware probe span ────────────────────────────────────────────
// The old span was binary ok/failing, so a 429 (the gateway ANSWERING — auth
// passed, bucket full) rendered in outage red and read as "auth broken again".
// The radar now labels the class server-side; this span colors by class:
// emerald = answered · amber = congested (429) · red = auth/down. Hover tells
// the owner which response each class wants (pause schedules vs space them).
function ProbeSpan({
  ok,
  ms,
  error,
  cls,
  attempts,
}: {
  ok: boolean;
  ms: number;
  error: string | null;
  cls?: "ok" | "congestion" | "auth" | "down";
  attempts?: number;
}) {
  const klass = cls ?? (ok ? "ok" : "down");
  const tone =
    ok || klass === "ok"
      ? "text-emerald-400"
      : klass === "congestion"
        ? "text-amber-400"
        : "text-red-400";
  const label =
    klass === "ok"
      ? `ok (${ms}ms)`
      : klass === "congestion"
        ? `rate-limited (429 · ${ms}ms)`
        : klass === "auth"
          ? `auth failing (${error ?? "unknown"})`
          : `failing (${error ?? "unknown"})`;
  const hint =
    klass === "ok"
      ? "The live search probe answered — the built-in gateway lane is up."
      : klass === "congestion"
        ? "429 = the gateway ANSWERED (auth passed, shared bucket full). Congestion, not an outage — keep schedules on, lean on fallbacks, only pause on a 401/403 probe."
        : klass === "auth"
          ? "401/403 = upstream auth is rejecting calls. Treat the search lane as down; pause research-heavy schedules until a probe passes."
          : "Timeout / network / empty answer — the gateway is not usable right now; lean on no-fetch fallback tools until it clears.";
  return (
    <span className={tone} title={hint}>
      {label}
      {attempts !== undefined && attempts > 1 ? ` · ${attempts} tries` : ""}
    </span>
  );
}

export function ServerAutopilot() {
  const [state, setState] = React.useState<SyncState | null>(null);
  const [openRun, setOpenRun] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [radar, setRadar] = React.useState<RadarState | null>(null);
  const [radarBusy, setRadarBusy] = React.useState(false);

  const [redactionHits, setRedactionHits] = React.useState(0);
  const poll = React.useCallback(async () => {
    try {
      const res = await fetch("/api/automation/sync", { cache: "no-store" });
      if (res.ok) setState((await res.json()) as SyncState);
    } catch {
      /* local server briefly unreachable — retry next tick */
    }
    try {
      const r = await fetch("/api/automation/redaction", { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { redaction?: { hits: number } };
        setRedactionHits(j.redaction?.hits ?? 0);
      }
    } catch {
      /* telemetry is best-effort */
    }
  }, []);

  // r141: the bare interval used to dial /api/automation/sync every 15s even
  // while the tab was hidden (user switches window for an hour → ~240 wasted
  // GETs against the local server), and on return the panel could sit on
  // up-to-15s stale state until the next tick. Poll only while the tab is
  // visible; refetch the moment it becomes visible again so the countdowns
  // and lane badges are fresh on return instead of one tick late.
  React.useEffect(() => {
    void poll();
    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const t = setInterval(() => {
      if (!document.hidden) void poll();
    }, POLL_MS);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll]);

  // ── r497: Capability Radar poll + actions ──────────────────────────────────
  const pollRadar = React.useCallback(async () => {
    try {
      const res = await fetch("/api/radar/hourly", { cache: "no-store" });
      if (res.ok) setRadar((await res.json()) as RadarState);
    } catch {
      /* local server briefly unreachable — retry next tick */
    }
  }, []);

  React.useEffect(() => {
    void pollRadar();
    const t = setInterval(() => {
      if (!document.hidden) void pollRadar();
    }, RADAR_POLL_MS);
    return () => clearInterval(t);
  }, [pollRadar]);

  // ── r515: Autonomous Improvement Engine — poll + actions ───────────────────
  const [autonomy, setAutonomy] = React.useState<AutonomyState | null>(null);
  const [cycleBusy, setCycleBusy] = React.useState(false);
  const [aieOpen, setAieOpen] = React.useState(true);
  const [queueText, setQueueText] = React.useState("");
  const [importBusy, setImportBusy] = React.useState(false);
  const [importSummary, setImportSummary] = React.useState<string | null>(null);
  const [openLog, setOpenLog] = React.useState<string | null>(null);

  const pollAutonomy = React.useCallback(async () => {
    try {
      const res = await fetch("/api/autonomy", { cache: "no-store" });
      if (res.ok) setAutonomy((await res.json()) as AutonomyState);
    } catch {
      /* local server briefly unreachable — retry next tick */
    }
  }, []);

  React.useEffect(() => {
    void pollAutonomy();
    const t = setInterval(() => {
      if (!document.hidden) void pollAutonomy();
    }, AUTONOMY_POLL_MS);
    return () => clearInterval(t);
  }, [pollAutonomy]);

  async function runCycleNow() {
    setCycleBusy(true);
    try {
      const res = await fetch("/api/autonomy", {
        method: "POST",
        headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
        body: JSON.stringify({ action: "cycle" }),
      });
      const json = (await res.json()) as AutonomyState & { alreadyRan?: boolean };
      if (json.ok) {
        setAutonomy(json);
        void pollAutonomy();
        if (json.alreadyRan) {
          toast.info("Cycle already ran this bucket", {
            description: `The engine is idempotent per 10-minute bucket (${json.latestLog?.id ?? "?"}) — re-arming fires at the next boundary.`,
          });
        } else {
          const s = json.latestLog ? (JSON.parse(json.latestLog.statsJson ?? "{}") as { executed?: number; proposed?: number; failed?: number }) : {};
          toast.success("Autonomy cycle complete", {
            description: `${s.proposed ?? 0} move${(s.proposed ?? 0) === 1 ? "" : "s"} proposed · ${s.executed ?? 0} executed${s.failed ? ` · ${s.failed} honest failure${s.failed === 1 ? "" : "s"}` : ""}`,
          });
        }
      } else {
        toast.error("Autonomy cycle failed", { description: json.error ?? "unknown error" });
      }
    } catch {
      toast.error("Autonomy cycle failed", { description: "the local server did not answer" });
    } finally {
      setCycleBusy(false);
    }
  }

  async function importQueue() {
    // r515: line-oriented import (the mini-panel's contract is "one per line")
    // — splitting on ANY whitespace would shred a malformed line into fake
    // per-word entries and blur the honest {invalid} count.
    const urls = queueText
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length === 0) {
      toast.error("Nothing to import", { description: "Paste one repo or URL per line first." });
      return;
    }
    setImportBusy(true);
    try {
      const res = await fetch("/api/autonomy", {
        method: "POST",
        headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
        body: JSON.stringify({ action: "enqueue", urls }),
      });
      const json = (await res.json()) as EnqueueCounts;
      if (json.ok) {
        const line = `last import: +${json.inserted} queued · ${json.duplicates} duplicate${json.duplicates === 1 ? "" : "s"} · ${json.invalid} invalid${json.capped ? " · capped at 500 rows" : ""}`;
        setImportSummary(line);
        setQueueText("");
        void pollAutonomy();
        toast.success(`Imported ${json.inserted} of ${urls.length}`, {
          description: `${json.duplicates} duplicate${json.duplicates === 1 ? "" : "s"} · ${json.invalid} invalid — github URLs normalize to gh:owner/repo and dedupe against every prior status.`,
        });
      } else {
        toast.error("Import failed", { description: json.error ?? "unknown error" });
      }
    } catch {
      toast.error("Import failed", { description: "the local server did not answer" });
    } finally {
      setImportBusy(false);
    }
  }

  function parseLogStats(json: string | undefined): Record<string, unknown> {
    try {
      const v = JSON.parse(json ?? "{}") as unknown;
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  async function checkNow() {
    setRadarBusy(true);
    try {
      const res = await fetch("/api/radar/hourly", { method: "POST" });
      const json = (await res.json()) as RadarState;
      if (json.ok) {
        setRadar(json);
        const n = json.latest?.findings.length ?? 0;
        const crit = json.latest?.findings.filter((f) => f.severity === "critical").length ?? 0;
        toast.success("Capability check complete", {
          description: `${n} finding${n === 1 ? "" : "s"}${crit > 0 ? ` (${crit} critical)` : ""} · bucket ${json.latest?.hourBucket ?? "?"} — same-hour re-checks are idempotent`,
        });
      } else {
        toast.error("Capability check failed", { description: json.error ?? "unknown error" });
      }
    } catch {
      toast.error("Capability check failed", { description: "the local server did not answer" });
    } finally {
      setRadarBusy(false);
    }
  }

  async function copySeed(prompt: string) {
    const ok = await copyText(prompt);
    if (ok) toast.success("Seed prompt copied", { description: "Paste it into a Workflow Studio step to turn the finding into a pipeline." });
    else toast.error("Copy failed");
  }

  function focusRadar() {
    document.getElementById("capability-radar")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function runNow(id: string, name: string) {
    setBusy(id);
    try {
      const res = await fetch("/api/automation/run-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: id }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (json.ok) {
        toast.success("Queued on the local server", {
          description: `${name} — the autopilot picks it up within 30s.`,
        });
        void poll();
      } else {
        toast.error("Run-now failed", { description: json.error ?? "unknown error" });
      }
    } finally {
      setBusy(null);
    }
  }

  const driving = state?.serverDriving === true;
  const active = state?.registry.filter((r) => r.enabled) ?? [];
  // r137: lane-true countdowns. The DB registry's nextRunAt only advances
  // when the EXTERNAL scheduler claims a due run — while the tab drives
  // (BYOK), it goes stale-past and the panel showed "due" on pipelines that
  // had run minutes ago (seen live 2026-09-30). The tab's own
  // schedule.nextRunAt is the truth for the active lane; the registry is the
  // truth once the server lane is driving.
  const workflows = useWorkflowsStore((s) => s.workflows);
  // r208: the evolution inbox lives in the client store — the pulse reads it
  // from the same source the Evolution Inbox renders from (no double truth).
  const proposals = useWorkflowsStore((s) => s.proposals);
  const localNextByWf = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workflows) {
      if (
        w.schedule?.enabled === true &&
        w.steps.length > 0 &&
        typeof w.schedule.nextRunAt === "number"
      ) {
        m.set(w.id, new Date(w.schedule.nextRunAt).toISOString());
      }
    }
    return m;
  }, [workflows]);
  const registryNextFire =
    active
      .map((r) => r.nextRunAt)
      .filter((v): v is string => typeof v === "string")
      .sort()[0] ?? null;
  const localNextFire = !driving
    ? ([...localNextByWf.values()].sort()[0] ?? null)
    : null;
  const nextFire = localNextFire ?? registryNextFire;
  // r205: lane truth from the executor's mirror, not the builtin slot.
  const lane = state?.executorLane ?? null;
  const laneBlocked = lane !== null && !lane.ready;
  const blockedReason: ExecutorLaneState["reason"] =
    lane && !lane.ready ? (lane.reason ?? "no-vault-key") : null;
  // r204 QA-incident shape: enabled rows overdue >24h with neither lane
  // driving (see computeStaleRegistry for the frozen-countdown trap).
  const staleRows = computeStaleRegistry(active, localNextByWf, Date.now());
  const dueQuietCount = driving
    ? active.filter((r) => r.nextRunAt && new Date(r.nextRunAt).getTime() <= Date.now()).length
    : 0;
  // r134: chip deep-links to the vault card (same r125 pattern the workflow
  // cards use) so the fix for a missing key is one click away.
  const openVault = React.useCallback(() => {
    useUiStore.getState().setView("settings");
    useUiStore.getState().setSettingsAnchor("vault");
  }, []);

  // ── r208: Automation pulse — the r192–r207 instruments, one glance ────────
  // Each number below is ALREADY rendered (and explained) by a dedicated
  // surface in this panel or the inbox; the pulse just aggregates them so a
  // returning user sees "is anything on fire?" without reading every strip.
  const openProposals = proposals.filter((p) => p.status === "open").length;
  const acceptedProposals = proposals.filter((p) => p.status === "accepted").length;
  const registryRows = state?.registry ?? [];
  // Breaker-parked (r192/r204 parity): disabled AFTER the 3-strike breaker,
  // not merely off (user toggle / orphan-guard — those were never failing).
  // r216: keep the ROWS, not just the count — the parked strip below renders
  // from this same array, so the pulse's number and its remediation surface
  // can never disagree (they are one data source).
  const parkedRows = registryRows.filter((r) => !r.enabled && r.failStreak >= 3);
  const parked = parkedRows.length;
  const off = registryRows.filter((r) => !r.enabled && r.failStreak < 3).length;
  // Server-run outcomes over the last day (the sync GET ships the 25 most
  // recent rows — the title says exactly that, no pretended completeness).
  const dayAgo = Date.now() - 24 * 3_600_000;
  const runs24 = (state?.runs ?? []).filter((r) => new Date(r.startedAt).getTime() >= dayAgo);
  const done24 = runs24.filter((r) => r.status === "done").length;
  const running24 = runs24.filter((r) => r.status === "running").length;
  const transient24 = runs24.filter((r) => r.status === "error" && isTransientRunError(r.error)).length;
  const failed24 = runs24.filter((r) => r.status === "error" && !isTransientRunError(r.error)).length;
  // Attention = the amber conditions the strips below already render, counted.
  const attention: string[] = [];
  if (staleRows.length > 0)
    attention.push(`${staleRows.length} schedule${staleRows.length === 1 ? "" : "s"} >24h with no lane driving`);
  if (parked > 0)
    attention.push(`${parked} schedule${parked === 1 ? "" : "s"} parked by the failure breaker`);
  if (driving && laneBlocked && dueQuietCount > 0)
    attention.push(`${dueQuietCount} due run${dueQuietCount === 1 ? "" : "s"} blocked: ${humanizeLaneReason(blockedReason ?? "no-vault-key")}`);

  // r212: the attention cell deep-links to the FIRST offender's remediation
  // surface — stale >24h scrolls to this panel's amber strip (it names the
  // rows + the advice), breaker-parked scrolls to THIS panel's parked strip
  // (r216 fix: it used to target the workflows view's local-schedule "Lane
  // degraded" Alert, but the pulse counts SERVER registry rows — a disjoint
  // population the local strip never renders, so the click could land on a
  // surface that does not exist; the strip below renders from the same array
  // as the count, so it is always there when the signal fires), and a
  // lane-blocked due run rides the r134 vault deep-link. Signal-driven
  // mapping, never string matching on the rendered sentences (the push order
  // above IS the priority order).
  const focusFirstAttention = React.useCallback(() => {
    if (staleRows.length > 0) {
      document.getElementById("automation-stale-strip")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (parked > 0) {
      document.getElementById("automation-parked-strip")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    openVault();
  }, [staleRows.length, parked, openVault]);

  return (
    <section
      aria-label="Server autopilot"
      className="rounded-xl border border-sky-500/25 bg-sky-500/[0.04] p-4"
    >
      {state ? (
        <div
          aria-label="Automation pulse"
          title="One-glance aggregation of the automation diagnostics: registry schedules, recent server-run outcomes, the evolution inbox, the capability radar's latest findings, and anything needing attention. Each number is explained by its dedicated surface below."
          className="mb-3 grid grid-cols-2 gap-1.5 lg:grid-cols-6"
        >
          <div
            title="Enabled schedules in the local registry. “Parked” = disabled by the 3-strike failure breaker; “off” = disabled by you or the orphan guard (never failing)."
            className="rounded-lg border border-sky-500/15 bg-background/40 px-2 py-1.5"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Schedules</p>
            <p className="mt-0.5 text-xs font-semibold tabular-nums text-sky-200">
              {active.length} active{parked > 0 ? ` · ${parked} parked` : ""}
              {off > 0 ? ` · ${off} off` : ""}
            </p>
          </div>
          <div
            title={`Server-lane run outcomes started in the last 24h (among the 25 most recent rows): ${done24} done, ${failed24} failed, ${transient24} transient-retried, ${running24} running.`}
            className="rounded-lg border border-sky-500/15 bg-background/40 px-2 py-1.5"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Server runs · 24h</p>
            <p className="mt-0.5 text-xs font-semibold tabular-nums text-sky-200">
              {runs24.length === 0
                ? "none yet"
                : `${done24}✓${failed24 > 0 ? ` ${failed24}✗` : ""}${transient24 > 0 ? ` ${transient24}↻` : ""}${running24 > 0 ? ` ${running24}⟳` : ""}`}
            </p>
          </div>
          <div
            title="Evolution-layer proposals: open = waiting in the inbox (spawned from low-novelty runs), accepted = became real pipelines."
            className="rounded-lg border border-violet-500/15 bg-background/40 px-2 py-1.5"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Evolution inbox</p>
            <p className="mt-0.5 text-xs font-semibold tabular-nums text-violet-300">
              {openProposals} open · {acceptedProposals} accepted
            </p>
          </div>
          <div
            title="The redaction choke (TASK-102): every outbound LLM dial body passes through one module that masks API-key patterns and exact vault values before leaving the process. Count = strings masked since server boot."
            className="rounded-lg border border-emerald-500/15 bg-background/40 px-2 py-1.5"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Redaction</p>
            <p className="mt-0.5 text-xs font-semibold tabular-nums text-emerald-300">
              {redactionHits === 0 ? "guard armed" : `${redactionHits} masked`}
            </p>
          </div>
          <button
            type="button"
            onClick={focusRadar}
            title="Capability radar — the hourly platform self-check. Click to jump to the full digest (findings, experiments, tryable adaptation seeds)."
            className="w-full rounded-lg border border-violet-500/15 bg-background/40 px-2 py-1.5 text-left transition-colors hover:bg-violet-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-500/50"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Capability radar</p>
            <p className="mt-0.5 text-xs font-semibold tabular-nums text-violet-300">
              {radar?.latest
                ? `${radar.latest.findings.length} finding${radar.latest.findings.length === 1 ? "" : "s"} · ${fmtAgo(radar.latest.generatedAt)}`
                : "arming…"}
            </p>
          </button>
          {attention.length > 0 ? (
            <button
              type="button"
              onClick={focusFirstAttention}
              title={`${attention.join("; ")}\nClick to jump to the first offender's remediation surface.`}
              aria-label={`Needs attention: ${attention.length} item${attention.length === 1 ? "" : "s"} — jump to the first offender`}
              className="w-full rounded-lg border border-amber-500/30 bg-background/40 px-2 py-1.5 text-left transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50"
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Needs attention</p>
              <p className="mt-0.5 text-xs font-semibold tabular-nums text-amber-300">
                {attention.length} item{attention.length === 1 ? "" : "s"} →
              </p>
            </button>
          ) : (
            <div
              title="No stale schedules, no breaker-parked pipelines, and the closed-tab lane is not blocking due runs."
              className="rounded-lg border border-emerald-500/25 bg-background/40 px-2 py-1.5"
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Needs attention</p>
              <p className="mt-0.5 text-xs font-semibold tabular-nums text-emerald-400">all clear</p>
            </div>
          )}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <RadioTower className="h-4 w-4 shrink-0 text-sky-400" aria-hidden />
        <h3 className="text-sm font-semibold leading-none">Server autopilot</h3>
        <Badge
          variant="outline"
          className={cn(
            "px-1.5 py-0 text-[10px]",
            driving
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : "border-violet-500/40 bg-violet-500/10 text-violet-300"
          )}
        >
          {driving ? (
            <>
              <CircleDot className="mr-1 h-2.5 w-2.5 animate-pulse" aria-hidden />
              server driving — tab closed/idle
            </>
          ) : (
            <>
              <CircleDot className="mr-1 h-2.5 w-2.5" aria-hidden />
              browser driving — schedules run in-tab (your keys)
            </>
          )}
        </Badge>
        <span
          title={
            driving
              ? "Last time the open tab synced its schedules; it went quiet and the server lane took over."
              : "Last time the open tab synced schedules + keys to the local server (every 60s)."
          }
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] transition-colors",
            driving
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-sky-500/40 bg-sky-500/10 text-sky-300"
          )}
        >
          <Clock className="h-2.5 w-2.5" aria-hidden />
          {driving ? "bridge silent" : "bridge sync"} {fmtAgo(state?.lastSeenAt ?? null)}
        </span>
        {nextFire ? (
          <span
            title={
              driving
                ? "Soonest scheduled fire across all registered pipelines (headless-lane claim view)"
                : "Soonest fire among this tab's enabled schedules (the active BYOK lane)"
            }
            className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/[0.06] px-1.5 py-0 text-[10px] text-sky-200/90 transition-colors hover:border-sky-500/40"
          >
            <Timer className="h-2.5 w-2.5" aria-hidden />
            next fire {fmtIn(nextFire)}
          </span>
        ) : null}
        {state && lane ? (
          <button
            type="button"
            onClick={openVault}
            title={
              lane.ready
                ? `Closed-tab runs dial ${lane.providerLabel} with your stored key ${lane.maskedKey} (Automation vault). Click to manage.`
                : lane.reason === "no-vault-key"
                  ? "The server executor dials ONLY with a key you store in the Automation vault (BYOK-preserving). No key: due schedules stay queued while the tab is closed. Click to store one."
                  : lane.reason === "billing-quarantined"
                    ? "Your stored key's provider is billing-quarantined (the wallet is drained — the rotation memory skips it so runs stop dying on the same lane). Recharge at the provider or store a second key; the quarantine lifts on the first successful dial. Click to manage."
                    : `No vault slot pairs with a server-side endpoint (${lane.slotCount} slot${lane.slotCount === 1 ? "" : "s"} scanned — the built-in gateway is client-side knowledge and unresolvable slots are skipped). Store a registry provider key so closed-tab runs can dial. Click to manage.`
            }
            aria-label="Headless lane key status"
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px] transition-colors",
              lane.ready
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:border-cyan-500/60 hover:bg-cyan-500/15"
                : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:border-amber-500/60 hover:bg-amber-500/15"
            )}
          >
            <KeyRound className="h-2.5 w-2.5" aria-hidden />
            {lane.ready
              ? `server lane: ${lane.providerLabel} ${lane.maskedKey}`
              : lane.reason === "no-vault-key"
                ? "server lane: no key — closed-tab runs wait"
                : lane.reason === "billing-quarantined"
                  ? "server lane: key quarantined (wallet drained) — runs wait"
                  : "server lane: needs a registry provider key"}
          </button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-xs transition-colors hover:text-sky-300"
          onClick={() => void poll()}
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          Refresh
        </Button>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        While the tab is open, schedules run in-browser with your own keys (BYOK — nothing
        leaves this machine). When the tab is closed, the local server claims due schedules
        itself — but dials only with a key stored in the Automation vault; without one,
        runs stay queued (nothing implicit dials). Results land here. Local-only: no
        telemetry, no cloud relay.
      </p>
      {driving && laneBlocked && dueQuietCount > 0 && blockedReason ? (
        <div className="mt-2.5 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2 text-[11px] leading-relaxed text-amber-300">
          <p>
            ⏸ {dueQuietCount} schedule{dueQuietCount === 1 ? "" : "s"} due while this tab is
            quiet, but the server lane can&apos;t dial: {humanizeLaneReason(blockedReason)}.{" "}
            {dueQuietCount === 1 ? "It stays" : "They stay"} queued — store a registry
            provider key in the Automation vault to let closed-tab runs fire.
          </p>
          {/* r402: the blocked strip used to be text-only — the fix it names
              (a vault key) had no affordance, so users had to know the path
              themselves. The anchor mechanism (settingsAnchor "vault",
              settings-view id="vault") already existed for #/providers-style
              links; this is the same journey, one click long. */}
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-6 gap-1 border-amber-500/40 px-2 text-[10px] font-medium text-amber-200 transition-colors hover:bg-amber-500/10 hover:text-amber-100"
            onClick={() => {
              const ui = useUiStore.getState();
              ui.setView("settings");
              ui.setSettingsAnchor("vault");
            }}
          >
            <KeyRound className="h-3 w-3" aria-hidden />
            Open the Automation vault
          </Button>
        </div>
      ) : null}

      {active.length > 0 ? (
        <ul className="mt-2.5 space-y-1">
          {active.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-medium">{r.name}</span>
              <span className="text-muted-foreground">
                every {Math.max(1, Math.round(r.intervalMs / 60_000))}m · next{" "}
                {fmtIn(localNextByWf.get(r.id) ?? r.nextRunAt)}
                {r.failStreak > 0 ? ` · ⚠ ${r.failStreak} fail${r.failStreak === 1 ? "" : "s"}` : ""}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy === r.id}
                onClick={() => void runNow(r.id, r.name)}
                className="ml-auto h-6 gap-1 border-sky-500/30 px-1.5 text-[10px] text-sky-300/90 transition-colors hover:bg-sky-500/10 hover:text-sky-200"
                title="Fire this pipeline on the local server now (headless lane)"
              >
                <Server className="h-3 w-3" aria-hidden />
                Run on server
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 text-xs text-muted-foreground">
          No schedules registered yet — enable a recurring schedule on any pipeline and it
          syncs here within a minute.
        </p>
      )}

      {staleRows.length > 0 ? (
        <div id="automation-stale-strip" className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2 text-[11px] leading-relaxed text-amber-300">
          <p className="font-medium">
            ⚠ {staleRows.length} registered schedule{staleRows.length === 1 ? "" : "s"} overdue
            &gt;24h with no lane driving {staleRows.length === 1 ? "it" : "them"}:
          </p>
          <p>
            {staleRows.slice(0, 3).map((r) => r.name).join(" · ")}
            {staleRows.length > 3 ? ` · +${staleRows.length - 3} more` : ""}
          </p>
          <p className="text-amber-300/80">
            Neither this tab&apos;s schedule nor the server lane has claimed{" "}
            {staleRows.length === 1 ? "it" : "them"} — re-enable the schedule in Workflow
            Studio, store a vault key for closed-tab runs, or use “Run on server” to force
            one fire.
          </p>
        </div>
      ) : null}

      {/* r216: server-parked schedules finally render somewhere — the pulse
          counts these rows but the workflows view's "Lane degraded" strip only
          renders LOCAL schedules, so a closed-tab breaker pause (exactly the
          scenario the server registry exists for) was invisible in the UI.
          Same array as the parked count above: count and cure cannot drift. */}
      {parkedRows.length > 0 ? (
        <div id="automation-parked-strip" className="mt-2 rounded-md border border-red-500/30 bg-red-500/[0.06] p-2 text-[11px] leading-relaxed text-red-300">
          <p className="font-medium">
            ⛔ {parkedRows.length} registered schedule{parkedRows.length === 1 ? "" : "s"} parked by the
            server-side failure breaker (3 straight failed closed-tab runs):
          </p>
          <p>
            {parkedRows.slice(0, 3).map((r) => r.name).join(" · ")}
            {parkedRows.length > 3 ? ` · +${parkedRows.length - 3} more` : ""}
          </p>
          <p className="text-red-300/80">
            The breaker paused them to stop quota burn. Fix the underlying failure — usually a
            missing or stale vault key — then resume the schedule from its workflow card; the next
            client heartbeat re-registers the row.
          </p>
        </div>
      ) : null}

      {/* r497: Capability Radar — the hourly self-check digest. Deterministic
          + vault-free by design: it must fire when nothing else can (tab
          closed, no keys). One idempotent row per UTC hour bucket. */}
      <div id="capability-radar" className="mt-3 rounded-lg border border-violet-500/20 bg-background/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <RadarIcon className="h-4 w-4 shrink-0 text-violet-400" aria-hidden />
          <h4 className="text-xs font-semibold leading-none">Capability radar</h4>
          <Badge
            variant="outline"
            className="px-1.5 py-0 text-[10px] border-violet-500/40 bg-violet-500/10 text-violet-300"
            title="The hourly check fires from the local server with or without this tab open — no vault key needed (deterministic scans + one built-in-gateway probe per pass)."
          >
            every 1h · works tab-closed
          </Badge>
          {radar?.latest ? (
            <span className="text-[10px] text-muted-foreground">
              last check {fmtAgo(radar.latest.generatedAt)} · bucket {radar.latest.hourBucket}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">no digest yet — first pass lands ~1 min after server boot</span>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={radarBusy}
            onClick={() => void checkNow()}
            className="ml-auto h-6 gap-1 border-violet-500/40 px-2 text-[10px] text-violet-300 transition-colors hover:bg-violet-500/10 hover:text-violet-200"
            title="Run the hourly self-check right now (idempotent within the current hour bucket)"
          >
            <RefreshCw className={cn("h-3 w-3", radarBusy ? "animate-spin" : "")} aria-hidden />
            Check now
          </Button>
        </div>

        {radar?.latest ? (
          <>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Last {radar.latest.windowHours}h: {radar.latest.runs.total} archived run{radar.latest.runs.total === 1 ? "" : "s"} ({radar.latest.runs.done}✓ {radar.latest.runs.error > 0 ? `${radar.latest.runs.error}✗ ` : ""}{radar.latest.runs.blocked > 0 ? `${radar.latest.runs.blocked}⛔ ` : ""}· {radar.latest.runs.toolCalls.toLocaleString()} tool calls)
              {radar.latest.runs.quietCycles > 0 ? ` · ${radar.latest.runs.quietCycles} quiet` : ""}
              {radar.latest.runs.gatewayAuthFailures > 0 ? ` · ${radar.latest.runs.gatewayAuthFailures} hit gateway-auth failures` : ""}
              {" · probe "}
              <ProbeSpan
                ok={radar.latest.gateway.probe.ok}
                ms={radar.latest.gateway.probe.ms}
                error={radar.latest.gateway.probe.error}
                cls={radar.latest.gateway.probe.class}
                attempts={radar.latest.gateway.probe.attempts}
              />
            </p>

            {radar.latest.findings.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {radar.latest.findings.map((f, i) => (
                  <li
                    key={`${f.area}-${i}`}
                    className={cn(
                      "rounded-md border p-2 text-[11px] leading-relaxed",
                      f.severity === "critical"
                        ? "border-red-500/30 bg-red-500/[0.06] text-red-300"
                        : f.severity === "warning"
                          ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-300"
                          : "border-sky-500/25 bg-sky-500/[0.05] text-sky-200/90",
                    )}
                  >
                    <p className="font-medium">
                      {f.severity === "critical" ? "✗" : f.severity === "warning" ? "⚠" : "ⓘ"} {f.title}
                    </p>
                    <p className="mt-0.5 text-muted-foreground">{f.evidence}</p>
                    {f.tryable ? (
                      <p className="mt-0.5 text-violet-300/90">
                        <span className="font-medium">→ try:</span> {f.tryable}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] p-2 text-[11px] text-emerald-400">
                ✓ All clear — no findings in this pass.
              </p>
            )}

            {radar.latest.experiments.length > 0 ? (
              <div className="mt-2">
                <p className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <FlaskConical className="h-3 w-3" aria-hidden />
                  Tryable experiments
                </p>
                <ul className="mt-1 space-y-1">
                  {radar.latest.experiments.map((x, i) => (
                    <li key={i} className="rounded-md border bg-background/60 p-2 text-[11px] leading-relaxed">
                      <p className="font-medium text-violet-300">{x.name}</p>
                      <p className="mt-0.5 text-muted-foreground">{x.why}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {radar.latest.seeds.length > 0 ? (
              <div className="mt-2">
                <p className="text-[11px] font-medium text-muted-foreground">Improvement seeds — paste into a Studio step</p>
                <ul className="mt-1 space-y-1">
                  {radar.latest.seeds.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 rounded-md border bg-background/60 p-2 text-[11px]">
                      <span className="min-w-0 flex-1 break-words font-medium">{s.label}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 shrink-0 gap-1 px-1.5 text-[10px] text-muted-foreground transition-colors hover:text-violet-300"
                        onClick={() => void copySeed(s.prompt)}
                        title="Copy the seed prompt"
                      >
                        <Copy className="h-2.5 w-2.5" aria-hidden />
                        copy
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {radar.history.length > 1 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-violet-500/15 pt-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">history</span>
                {radar.history
                  .slice(0, 12)
                  .reverse()
                  .map((h) => (
                    <span
                      key={h.id}
                      title={`${h.id} — ${h.findings} finding${h.findings === 1 ? "" : "s"} (${h.critical} critical · ${h.warnings} warning) · ${h.tryables} tryables`}
                      className={cn(
                        "rounded px-1 py-0.5 text-[9.5px] font-semibold tabular-nums",
                        h.critical > 0
                          ? "bg-red-500/15 text-red-300"
                          : h.warnings > 0
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-emerald-500/15 text-emerald-300",
                      )}
                    >
                      {h.id.slice(11, 16)}·{h.findings}
                    </span>
                  ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[11px] text-muted-foreground">
            The radar scans the run archive, registry, vault, model catalog and gateway pulse every hour and distills findings + tryable adaptations. Use “Check now” for the first digest.
          </p>
        )}
      </div>

      {/* r515: Autonomous Improvement Engine — the platform's OWN 10-minute
          autonomy loop (the external 15-min cron patrol kept getting purged,
          so autonomy now lives here). Deterministic + vault-free by doctrine:
          zero provider keys, works tab-closed, idempotent per 10-min bucket,
          safe moves only, honest no-ops over silent magic. */}
      <div id="autonomy-engine" className="mt-3 rounded-lg border border-emerald-500/20 bg-background/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAieOpen((o) => !o)}
            aria-expanded={aieOpen}
            aria-controls="autonomy-engine-body"
            title="Collapse or expand the Autonomous Improvement Engine card"
            className="flex items-center gap-1.5 rounded-md transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50"
          >
            {aieOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            )}
            <Sparkles className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
            <h4 className="text-xs font-semibold uppercase tracking-wide leading-none">Autonomous improvement engine</h4>
          </button>
          <Badge
            variant="outline"
            className="px-1.5 py-0 text-[10px] border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            title="The engine boots with the server (instrumentation) and cycles every 10 minutes — deterministic signal reads, ranked proposals, safe vault-free execution. No provider keys anywhere; the one optional rationale enricher rides the built-in no-key free lane with a 6s timeout and fails open."
          >
            every 10m · vault-free · works tab-closed
          </Badge>
          {autonomy?.engine ? (
            <>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0 text-[10px]",
                  autonomy.engine.enabled
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300",
                )}
                title={
                  autonomy.engine.enabled
                    ? "The 10-minute loop is armed inside the server process (first pass 15s after boot)."
                    : "The engine has not armed yet — it arms when the server boots its instrumentation hook."
                }
              >
                <CircleDot className={cn("h-2.5 w-2.5", autonomy.engine.enabled && "animate-pulse")} aria-hidden />
                {autonomy.engine.enabled ? "engine armed" : "arming…"}
              </span>
              <span className="text-[10px] text-muted-foreground">
                last cycle {fmtAgo(autonomy.engine.lastCycleAt)}
                {autonomy.engine.nextCycleInMin !== null ? ` · next in ${autonomy.engine.nextCycleInMin}m` : ""}
              </span>
            </>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={cycleBusy}
            onClick={() => void runCycleNow()}
            className="ml-auto h-6 gap-1 border-emerald-500/40 px-2 text-[10px] text-emerald-300 transition-colors hover:bg-emerald-500/10 hover:text-emerald-200"
            title="Propose + execute the top safe moves NOW (idempotent within the current 10-minute bucket — a repeat click honestly answers “already ran”)"
          >
            <RefreshCw className={cn("h-3 w-3", cycleBusy ? "animate-spin" : "")} aria-hidden />
            Execute top move
          </Button>
        </div>

        {aieOpen ? (
          <div id="autonomy-engine-body" className="mt-2">
            {autonomy ? (
              <>
              <div aria-label="Autonomy KPIs" className="grid grid-cols-2 gap-1.5 lg:grid-cols-4">
                <div
                  title="The research backlog: repos/URLs waiting for the engine's vault-free GitHub research (max 2 per 10-min cycle — the 60 req/h unauthenticated budget governs)."
                  className="rounded-lg border border-emerald-500/15 bg-background/40 px-2 py-1.5"
                >
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Queue depth</p>
                  <p className="mt-0.5 text-xs font-semibold tabular-nums text-emerald-200">
                    {autonomy.queue.queued} queued
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {autonomy.queue.researched} researched · {autonomy.queue.failed} failed
                    </span>
                  </p>
                </div>
                <div
                  title={`Move outcomes in the last 24h: ${autonomy.moves24.executed} executed, ${autonomy.moves24.failed} failed, ${autonomy.moves24.proposed} proposed.`}
                  className="rounded-lg border border-emerald-500/15 bg-background/40 px-2 py-1.5"
                >
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Moves · 24h</p>
                  <p className="mt-0.5 text-xs font-semibold tabular-nums text-emerald-200">
                    {autonomy.moves24.executed} executed
                    {autonomy.moves24.failed > 0 ? ` · ${autonomy.moves24.failed} failed` : ""}
                    <span className="font-normal text-muted-foreground"> · {autonomy.moves24.proposed} proposed</span>
                  </p>
                </div>
                <div
                  title="When the last idempotent 10-minute bucket ran (interval fire or a manual “Execute top move”)."
                  className="rounded-lg border border-emerald-500/15 bg-background/40 px-2 py-1.5"
                >
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Last cycle</p>
                  <p className="mt-0.5 text-xs font-semibold tabular-nums text-emerald-200">
                    {autonomy.engine.lastCycleAt ? fmtAgo(autonomy.engine.lastCycleAt) : "never"}
                    <span className="font-normal text-muted-foreground">
                      {autonomy.engine.nextCycleInMin !== null ? ` · next ${autonomy.engine.nextCycleInMin}m` : ""}
                    </span>
                  </p>
                </div>
                <div
                  title="Engine arm state inside the server process. Armed = the loop fires with zero keys and a closed tab — the whole point."
                  className="rounded-lg border border-emerald-500/15 bg-background/40 px-2 py-1.5"
                >
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Engine status</p>
                  <p className={cn("mt-0.5 text-xs font-semibold", autonomy.engine.enabled ? "text-emerald-400" : "text-amber-300")}>
                    {autonomy.engine.enabled ? "armed" : "arming…"}
                  </p>
                </div>
              </div>

              {/* Next moves — ranked, deterministic, status-honest */}
              <div className="mt-2">
                <p className="text-[11px] font-medium text-muted-foreground">Next moves (ranked)</p>
                {autonomy.moves.length > 0 ? (
                  <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto pr-1">
                    {autonomy.moves.map((m) => (
                      <li key={m.id} className="rounded-md border bg-background/60 p-2 text-[11px]">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[9.5px] font-semibold tabular-nums text-emerald-300">
                            #{m.rank}
                          </span>
                          <MoveKindIcon kind={m.kind} className="text-emerald-400/80" />
                          <span className="min-w-0 flex-1 truncate font-medium" title={m.title}>
                            {m.title}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn("px-1.5 py-0 text-[9.5px]", moveStatusClass(m.status))}
                            title={m.result ?? "status"}
                          >
                            {m.status}
                          </Badge>
                        </div>
                        <p className="mt-0.5 truncate text-muted-foreground" title={m.rationale}>
                          {m.rationale}
                        </p>
                        {m.result ? (
                          <p className="mt-0.5 truncate text-emerald-300/80" title={m.result ?? ""}>
                            → {m.result}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 rounded-md border bg-background/60 p-2 text-[11px] text-muted-foreground">
                    No moves yet — run a cycle (button above) or wait for the next 10-minute bucket.
                  </p>
                )}
              </div>

              {/* Research queue mini-panel — import + honest counts */}
              <div className="mt-2 rounded-md border border-emerald-500/15 bg-background/60 p-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Research queue — paste repo URLs (one per line; github URLs normalize to gh:owner/repo, dupes against
                  any prior status are skipped, cap 500)
                </p>
                <textarea
                  value={queueText}
                  onChange={(e) => setQueueText(e.target.value)}
                  rows={3}
                  aria-label="Research queue import URLs"
                  placeholder={"https://github.com/upstash/vector-js\nhttps://example.com/some-page"}
                  className="mt-1 w-full resize-y rounded-md border bg-background/80 p-2 font-mono text-[10.5px] leading-relaxed outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={importBusy}
                    onClick={() => void importQueue()}
                    className="h-6 gap-1 border-emerald-500/40 px-2 text-[10px] text-emerald-300 transition-colors hover:bg-emerald-500/10 hover:text-emerald-200"
                    title="Normalize + dedupe + enqueue these targets (honest {inserted, duplicates, invalid} counts back)"
                  >
                    <Download className={cn("h-3 w-3", importBusy ? "animate-bounce" : "")} aria-hidden />
                    Import
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    {autonomy.queue.queued} queued
                    {autonomy.queue.oldestQueuedAgeMin !== null
                      ? ` · oldest ${fmtAgo(new Date(Date.now() - autonomy.queue.oldestQueuedAgeMin * 60_000).toISOString())}`
                      : ""}
                  </span>
                </div>
                {importSummary ? <p className="mt-1 text-[10px] tabular-nums text-emerald-300/90">{importSummary}</p> : null}
              </div>

              {/* Logs feed — last 6 cycle/report rows, expandable stats */}
              <div className="mt-2">
                <p className="text-[11px] font-medium text-muted-foreground">Engine log (last {autonomy.logs.length})</p>
                {autonomy.logs.length > 0 ? (
                  <ul className="mt-1 max-h-56 space-y-1 overflow-y-auto pr-1">
                    {autonomy.logs.map((log) => {
                      const expanded = openLog === log.id;
                      const stats = parseLogStats(log.statsJson);
                      return (
                        <li key={log.id} className="text-[11px]">
                          <button
                            type="button"
                            onClick={() => setOpenLog(expanded ? null : log.id)}
                            aria-expanded={expanded}
                            className="flex w-full flex-wrap items-center gap-x-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent/60"
                            title="Expand the cycle/report stats"
                          >
                            <Badge
                              variant="outline"
                              className={cn(
                                "px-1.5 py-0 text-[9.5px]",
                                log.kind === "report"
                                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                              )}
                            >
                              {log.kind}
                            </Badge>
                            <span className="font-mono text-[10px] text-muted-foreground">{log.id}</span>
                            <span className="min-w-0 flex-1 truncate" title={log.summary}>
                              {log.summary}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{fmtAgo(log.createdAt)}</span>
                          </button>
                          {expanded ? (
                            <div className="mx-1.5 mt-1 rounded-md border bg-background/60 p-2">
                              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
                                {JSON.stringify({ moves: parseLogStats(log.movesJson), stats }, null, 2)}
                              </pre>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    No cycles yet — the first one lands ~15s after server boot (or on “Execute top move”).
                  </p>
                )}
              </div>

              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                Doctrine: deterministic signal reads → ranked proposals → at most 2 safe moves per cycle. Research uses
                the unauthenticated GitHub API (User-Agent set, README ≤200KB) and the queue row IS the cache —
                researched rows are never re-fetched. import-seed and radar-followup are honest no-ops; workflows are
                never mutated; LLM dials: none (the optional top-move rationale enricher rides the built-in no-key lane,
                6s timeout, fails open to the deterministic text).
              </p>
              </>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Connecting to the engine… (the snapshot endpoint answers within a second of the server being up)
              </p>
            )}
          </div>
        ) : null}
      </div>

      {state && state.runs.length > 0 ? (
        <div className="mt-3 border-t border-sky-500/15 pt-2.5">
          <p className="text-[11px] font-medium text-muted-foreground">
            Recent server runs (last {state.runs.length})
          </p>
          <ul className="mt-1.5 max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {state.runs.map((r) => {
              const expanded = openRun === r.id;
              // r397: production classifier (was the r116 TRANSIENT_RE
              // mirror) — self-healable kinds render as an amber
              // "↻ retried" (schedule survived, backoff armed) instead of
              // the red terminal "✗ error" reserved for hard failures.
              const cls = r.status === "error" && r.error ? classifyRunError(r.error) : null;
              // r535: resumable (memoized resume on the next fire) outranks
              // the transient badge — same amber family, truer message.
              const resumable = r.status === "error" && isResumableStepFailure(r.error);
              const transient = !resumable && cls != null && SELF_HEAL_KINDS.includes(cls.kind);
              return (
                <li key={r.id} className="text-xs">
                  <button
                    type="button"
                    onClick={() => setOpenRun(expanded ? null : r.id)}
                    className="flex w-full flex-wrap items-center gap-x-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent/60"
                    aria-expanded={expanded}
                  >
                    <span
                      className={cn(
                        "font-semibold",
                        r.status === "done"
                          ? "text-emerald-500"
                          : resumable || transient
                            ? "text-amber-400"
                            : r.status === "error"
                              ? "text-red-400"
                              : "text-violet-400"
                      )}
                    >
                      {r.status === "running"
                        ? `⟳ step ${r.currentStep}/${r.stepsTotal}`
                        : r.status === "done"
                          ? "✓ done"
                          : resumable
                            ? "↻ resumes"
                            : transient
                              ? "↻ retried"
                              : "✗ error"}
                    </span>
                    <span className="font-medium">{r.workflowName}</span>
                    <span className="text-muted-foreground">
                      {r.trigger === "manual" ? "manual" : "schedule"} · {fmtAgo(r.startedAt)}
                    </span>
                  </button>
                  {expanded ? (
                    <div
                      className={cn(
                        "mx-1.5 mt-1 rounded-md border bg-background/60 p-2",
                        resumable && "border-amber-400/30 bg-amber-400/5",
                      )}
                    >
                      {resumable ? (
                        <p className="mb-1 text-[10.5px] font-semibold text-amber-400">
                          ↻ Resumable — completed steps are memoized; the next scheduled fire re-enters at the failed step (failStreak still counts).
                        </p>
                      ) : null}
                      {cls ? (
                        <p className={cn("mb-1 text-[10.5px] font-semibold", transient ? "text-amber-400" : "text-red-400")}>
                          {runErrorKindLabel(cls.kind)}
                          {transient ? " — transient infra error; schedule stays enabled, retry backoff armed." : ""}
                        </p>
                      ) : null}
                      {cls?.hint ? (
                        <p className="mb-1 text-[10.5px] leading-snug text-muted-foreground">→ {cls.hint}</p>
                      ) : null}
                      {r.error ? (
                        <p className={cn("break-words font-mono text-[10.5px]", transient ? "text-amber-400/80" : "text-red-400")}>{r.error}</p>
                      ) : null}
                      {r.finalReport ? (
                        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                          {r.finalReport.slice(0, 4_000)}
                          {r.finalReport.length > 4_000 ? " …" : ""}
                        </p>
                      ) : !r.error ? (
                        <p className="text-[10.5px] text-muted-foreground">No output yet.</p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Bot className="h-3 w-3" aria-hidden />
          No server runs yet — they appear here after the first closed-tab fire (or a
          &ldquo;Run on server&rdquo; click).
        </p>
      )}
    </section>
  );
}
