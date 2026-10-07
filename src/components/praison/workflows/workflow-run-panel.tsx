"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  GitCompareArrows,
  Hourglass,
  KeyRound,
  LifeBuoy,
  Lightbulb,
  Link2,
  Loader2,
  Minus,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
  Undo2,
  X,
  Server,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buildEvidenceLedger, formatCiters } from "@/lib/evidence-ledger";
import { truncate } from "@/lib/helpers";
import { angleOfProposal } from "@/lib/spawn-proposal-engine";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  downloadText,
  fmtIn,
  fmtIntervalShort,
  fmtMs,
  fmtRel,
  parseRolePrefix,
  resolveStepRole,
  roleMatchesAgent,
  summarizeRoleTagMismatches,
  runDiagnostics,
  runReportFileName,
  runToMarkdown,
  slugify,
} from "@/lib/helpers";
import {
  useAgentsStore,
  useSettingsStore,
  useUiStore,
  useWorkflowsStore,
} from "@/lib/stores";
import {
  describeRunShape,
  executeWorkflowRun,
  getRunController,
  runErrorKindLabel,
} from "@/lib/workflow-runner";
import { SCHEDULE_INTERVALS } from "@/lib/constants";
import type { SpawnProposal, Workflow, WorkflowRunStep } from "@/lib/types";
import { TOOL_META } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AgentAvatar, DepthChip } from "@/components/praison/atoms";
import { MarkdownRenderer } from "@/components/praison/markdown";
import { WorkflowCompareDialog } from "@/components/praison/workflows/workflow-compare-dialog";
import type {
  RunCallLogEntry,
  RunErrorKind,
  ToolCallInfo,
  ToolId,
  WorkflowRun,
} from "@/lib/types";

// ─── Pipeline run panel: task → live streaming step cards → run history ─────

const STEP_BORDER: Record<WorkflowRunStep["status"], string> = {
  pending: "border-l-zinc-700",
  running: "border-l-violet-500",
  done: "border-l-emerald-500",
  error: "border-l-red-500",
  stopped: "border-l-amber-500",
  skipped: "border-l-zinc-500",
};

// r228: every ended status the runner emits that owes the user a recovery
// affordance. The panel gate used to render RunRecoveryCard only for
// error|stopped, leaving "partial" (user-ended with preserved progress) and
// "blocked" (parked by congestion/network — auto-resumes) with NO card even
// though the card ships dedicated copy for both ("Run parked — auto-resume
// scheduled"). "running"/"done" correctly stay out.
const RECOVERY_STATUSES: ReadonlySet<WorkflowRun["status"]> = new Set([
  "error",
  "stopped",
  "partial",
  "blocked",
]);

// ── r130 call-log grouping ──────────────────────────────────────────────────
// After an outage, the flat call log drowns in repeated r126 resilience notes
// ("primary skipped — … (Ns left)") — one per later step of the pipeline.
// Two pure view-model helpers: consecutive per-step blocks for scannability,
// and a counted digest that collapses repeated resilience events to one line.

function groupCallLog(log: RunCallLogEntry[]) {
  const groups: {
    label: string | null;
    items: { c: RunCallLogEntry; idx: number }[];
    failed: number;
  }[] = [];
  log.forEach((c, idx) => {
    const label = c.stepLabel ?? null;
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push({ c, idx });
      if (!c.ok) last.failed += 1;
    } else {
      groups.push({ label, items: [{ c, idx }], failed: c.ok ? 0 : 1 });
    }
  });
  return groups;
}

function resilienceDigest(log: RunCallLogEntry[]) {
  let skips = 0;
  let subs = 0;
  let rotations = 0;
  for (const c of log) {
    const n = c.note ?? "";
    if (n.includes("primary skipped")) skips += 1;
    if (n.includes("model substitution")) subs += 1;
    if (n.includes("rotating to")) rotations += 1;
  }
  return { skips, subs, rotations };
}

// ── r131: shared grouped call-log renderer ──────────────────────────────
// One component for BOTH surfaces: the error recovery card (r130) and the
// run-history "N calls" expander (r131). Digest + grouping computed here so
// callers pass just the log; chronological #N numbering stays global.

function CallLogList({ log }: { log: RunCallLogEntry[] }) {
  const groups = groupCallLog(log);
  const d = resilienceDigest(log);
  const parts: string[] = [];
  if (d.skips > 0) parts.push(`↻ primary skipped ×${d.skips}`);
  if (d.subs > 0) parts.push(`⇄ model substitution ×${d.subs}`);
  if (d.rotations > 0) parts.push(`⇄ relay rotation ×${d.rotations}`);
  const digestText = parts.join(" · ");
  return (
    <>
      {digestText ? (
        <div className="mb-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-2 py-1 font-mono text-[10px] text-amber-300/90">
          resilience · {digestText}
        </div>
      ) : null}
      <ul className="space-y-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
        {groups.map((g, gi) => (
          <li key={`g-${gi}`} className="space-y-1">
            <div className="flex items-center gap-2 border-b border-border/50 pb-0.5 text-[10px] text-foreground/60">
              <span className="truncate">{g.label ? `“${g.label}”` : "calls"}</span>
              <span className="ml-auto shrink-0">
                {g.items.length} {g.items.length === 1 ? "call" : "calls"}
                {g.failed > 0 ? (
                  <span className="text-red-400"> · {g.failed} failed</span>
                ) : null}
              </span>
            </div>
            <ul className="space-y-1">
              {g.items.map(({ c, idx }) => (
                <li key={`${c.at}-${idx}`} className="break-words">
                  <span className="text-foreground/70">#{idx + 1}</span>{" "}
                  {c.engine}
                  {c.model ? ` · ${c.model}` : ""} · {(c.ms / 1000).toFixed(1)}s{" "}
                  {c.ok ? (
                    <span className="text-emerald-500">✓</span>
                  ) : (
                    <span className="text-red-400">✗ {c.error ?? "failed"}</span>
                  )}
                  {c.attempt && c.attempt > 1 ? ` (attempt ${c.attempt})` : ""}
                  {c.note ? (
                    <span
                      className={
                        "mt-0.5 block font-mono text-[10px] " +
                        (c.note.startsWith("server relay")
                          ? "text-sky-300/90"
                          : "text-amber-300/90")
                      }
                    >
                      {c.note.startsWith("server relay") ? "⇄ " : "↻ "}
                      {c.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}

function StatusIndicator({
  status,
  ms,
  backoffUntil,
  backoffKind,
}: {
  status: WorkflowRunStep["status"];
  ms?: number;
  backoffUntil?: number;
  backoffKind?: "backoff" | "cooldown";
}) {
  if (status === "pending") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-500">
        <span className="h-2 w-2 shrink-0 rounded-full border border-zinc-500" aria-hidden />
        Queued
      </span>
    );
  }
  if (status === "running") {
    // r128: the self-heal ladder's deliberate waits were toast-only — the
    // step row just sat on a generic spinner, so a 25s provider backoff was
    // indistinguishable from a hang. Countdown is live (1s tick upstream).
    if (backoffUntil != null && backoffUntil > Date.now()) {
      const secs = Math.max(1, Math.ceil((backoffUntil - Date.now()) / 1000));
      const cooldown = backoffKind === "cooldown";
      return (
        <span
          role="timer"
          aria-label={`${cooldown ? "Quota cooldown" : "Provider backoff"}: ${secs} seconds remaining`}
          title={cooldown
            ? "Rate-limited — the self-heal ladder is cooling down before the retry. Quota windows refill; hammering them just burns attempts."
            : "The provider dropped mid-step — the self-heal ladder is riding out the bad window (escalating backoff with jitter) before re-dialing. Completed step output is preserved."}
          className="flex shrink-0 items-center gap-1 text-xs text-amber-500"
        >
          <Hourglass className="h-3.5 w-3.5 animate-pulse" aria-hidden />
          {cooldown ? `Cooldown ${secs}s` : `Backoff ${secs}s`}
        </span>
      );
    }
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-violet-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Running…
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-500">
        <Check className="h-3.5 w-3.5" aria-hidden />
        {fmtMs(ms)}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-red-500">
        <X className="h-3.5 w-3.5" aria-hidden />
        Failed
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-amber-500">
      <Ban className="h-3.5 w-3.5" aria-hidden />
      Stopped
    </span>
  );
}

function ToolCallChips({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  if (toolCalls.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {toolCalls.map((tc) => {
        const meta = TOOL_META[tc.name as ToolId];
        return (
          <span
            key={tc.id}
            title={tc.result ? `${tc.name} → ${tc.result.slice(0, 200)}` : tc.args}
            className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            <span aria-hidden>{meta?.emoji ?? "🛠️"}</span>
            <span className="truncate">{meta?.label ?? tc.name}</span>
            {tc.ok === true ? (
              <Check className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
            ) : tc.ok === false ? (
              <X className="h-3 w-3 shrink-0 text-red-500" aria-hidden />
            ) : (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-violet-400" aria-hidden />
            )}
            {tc.ms != null ? (
              <span className="shrink-0 tabular-nums">{fmtMs(tc.ms)}</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

// ─── Recovery card: non-silent failure fallback with user options ───────────

const ERROR_KIND_BADGE: Record<RunErrorKind, string> = {
  network: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  region: "border-orange-500/40 bg-orange-500/10 text-orange-500",
  auth: "border-red-500/40 bg-red-500/10 text-red-500",
  "rate-limit": "border-amber-500/40 bg-amber-500/10 text-amber-500",
  billing: "border-rose-500/40 bg-rose-500/10 text-rose-500",
  timeout: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  model: "border-rose-500/40 bg-rose-500/10 text-rose-500",
  unknown: "border-border bg-muted text-muted-foreground",
};

function RunRecoveryCard({
  run,
  workflow,
  busy,
  onResume,
  onRestart,
}: {
  run: WorkflowRun;
  workflow: Workflow;
  busy: boolean;
  onResume: (fromStepIndex: number, opts?: { forceServer?: boolean }) => void;
  onRestart: () => void;
}) {
  const [dismissed, setDismissed] = React.useState(false);
  const [msgOpen, setMsgOpen] = React.useState(false);
  const [callsOpen, setCallsOpen] = React.useState(false);
  const err = run.error;
  const lastAttempt = React.useRef<number>(-1);

  // A NEW failure (attempts changed) always re-opens the card, even if the
  // user had dismissed the previous one — never hide fresh information.
  React.useEffect(() => {
    if (err && err.attempts !== lastAttempt.current) {
      lastAttempt.current = err.attempts;
      setDismissed(false);
    }
  }, [err]);

  const firstPending = run.steps.findIndex((s) => s.status !== "done");
  const hasOutput = run.steps.some((s) => s.output.trim().length > 0);
  // r183: partial (user stop with preserved progress) and blocked (parked by
  // congestion/network) share the calm amber chrome — neither is a failure —
  // but the header copy below distinguishes all three.
  const stopped =
    run.status === "stopped" || run.status === "partial" || run.status === "blocked";
  const settings = useSettingsStore((s) => s.settings);
  const preferRelay = settings.preferRelay === true;
  // r330 (user paste: a resumed run re-dialed Vyce/auto with ⇄0 relay): the
  // park message promises "resume rotates to the relay lane", but the plain
  // resume button only rotated when the global preferRelay SETTING was on —
  // a promise the default settings broke. When the run's CURRENT failure is
  // a transient lane death (the parkable classes), the plain resume now
  // honors the promise and dials the relay first — the same forceServer
  // rotation the r171 auto park-resume already applies.
  const parkedTransient =
    err?.kind === "rate-limit" || err?.kind === "network" || err?.kind === "timeout";
  const resumeRotates = preferRelay || parkedTransient;
  // r84: live recovery math. The frozen err.stepsDone/err.stepIndex snapshot was
  // built at failure time with the resumed loop's LOCAL index (the resume tail
  // restarts at 0), so an auto-resumed run displayed "0/11 steps done" while
  // steps 1–2 were done. run.steps is the authoritative status-honest array
  // (r80 persistence) — derive from it live; frozen values stay as fallback.
  const doneCount = run.steps.filter((s) => s.status === "done").length;
  const failedIdx = run.steps.findIndex((s) => s.status === "error");

  // v13 lane-health: direct/relay split over this run's recorded LLM calls,
  // derived from the v11b note prefixes — pure UI, no store changes needed.
  const laneRelay = (run.callLog ?? []).filter((c) => (c.note ?? "").startsWith("server relay")).length;
  const laneDirect = (run.callLog ?? []).filter((c) => (c.note ?? "").startsWith("browser-direct")).length;
  const laneChip =
    laneRelay + laneDirect > 0
      ? ` · ⇄${laneRelay} relay / ⊙${laneDirect} direct`
      : "";
  // r320 failed-dial lane witness: the headline tally counts only SUCCESSFUL
  // lanes (note prefixes), so a run where every dial 429'd read "⇄0 relay"
  // even when the rotator HAD walked the free lanes — indistinguishable from
  // a stale bundle that never rotated. Failed calls already record the exact
  // engine label they dialed; group them so the card answers "did rotation
  // run, and onto which lanes?" at a glance. Pure UI — no store shape change.
  const laneOf = (raw: string): string => {
    // rotation/demotion dials label as "A → B (…)" — the dialed lane is the
    // last arrow segment; a plain dial is already the lane itself. Trailing
    // parentheticals ("(registry rotation)", "(primary demoted)") are ladder
    // mechanics, not lane identity — strip before grouping.
    const seg = (raw.includes("→") ? raw.split("→").pop()! : raw).trim();
    return seg.replace(/\s*\([^)]*\)\s*$/, "").trim() || "unknown lane";
  };
  const failedLanes = new Map<string, number>();
  let failedDials = 0;
  for (const c of run.callLog ?? []) {
    if (c.ok !== false) continue;
    failedDials += 1;
    const lane = laneOf(c.engine ?? "");
    failedLanes.set(lane, (failedLanes.get(lane) ?? 0) + 1);
  }
  // r342 (user report "so this is not matching I have lots of credits ready
  // to use"): a multi-lane failure showed ONE lane's error as the whole
  // verdict — the user's funded Vyce key ($236.40, webgui1, checked live
  // minutes after) sat next to "Please recharge" that actually came from
  // AIHubMix three lanes deep in the rotation. Each callLog entry carries
  // its OWN error text; when more than one distinct lane refused the run,
  // attribute every message to its lane before the generic hint. A
  // single-lane failure needs no strip — err.message IS that lane's message.
  const laneFailures = (() => {
    const map = new Map<string, { lane: string; message: string; count: number }>();
    for (const c of run.callLog ?? []) {
      if (c.ok !== false) continue;
      const lane = laneOf(c.engine ?? "");
      const message = (c.error ?? "").trim();
      const prev = map.get(lane);
      if (!prev) map.set(lane, { lane, message, count: 1 });
      else {
        prev.count += 1;
        // keep the most informative message seen for this lane
        if (message.length > prev.message.length) prev.message = message;
      }
    }
    return [...map.values()];
  })();
  // "auto" is the built-in gateway lane — name it as such in attribution.
  const laneLabel = (l: string) => (l === "auto" ? "built-in gateway" : l);
  const failedChip =
    failedDials > 0
      ? ` · ✗${failedDials} failed dials (${[...failedLanes.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([lane, n]) => `${lane} ×${n}`)
          .join(", ")}${failedLanes.size > 3 ? ", …" : ""})`
      : "";

  if (dismissed) return null;

  function savePartialReport() {
    downloadText(
      runReportFileName(workflow.name, run, workflow.runs ?? []),
      runToMarkdown(workflow, run),
      "text/markdown"
    );
    toast.success("Partial report saved", {
      description: `${run.steps.filter((s) => s.status === "done").length}/${run.steps.length} steps captured as Markdown.`,
    });
  }

  function copyDiagnostics() {
    const text = runDiagnostics(workflow, run);
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Diagnostics copied", { description: "Paste it into an issue or chat — contains no keys." }))
      .catch(() => {
        toast.error("Clipboard blocked", { description: "Select and copy from the browser console instead." });
        console.info(text);
      });
  }

  return (
    <Card
      className={cn(
        "gap-3 border-l-4 border-l-red-500 border-red-500/30 bg-red-500/[0.03] p-4",
        !stopped && "shadow-[0_0_28px_-10px_rgb(239_68_68/0.45)]"
      )}
    >
      <div className="flex items-start gap-3">
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10" aria-hidden>
          <LifeBuoy className="h-4 w-4 text-red-400" />
          {!stopped ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-400" />
            </span>
          ) : null}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold leading-tight">
            {run.status === "blocked"
              ? "Run parked — auto-resume scheduled"
              : stopped
                ? "Run stopped — resume anytime"
                : "Run failed — pick a recovery option"}
          </p>
          {err ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Failed at <span className="font-medium text-foreground">step {(failedIdx === -1 ? err.stepIndex : failedIdx) + 1}/{run.steps.length}</span>
              {" "}· {err.agentName}
              {" "}
              <Badge variant="outline" className={cn("mx-0.5 px-1.5 py-0 text-[10px]", ERROR_KIND_BADGE[err.kind])}>
                {runErrorKindLabel(err.kind)}
              </Badge>
              · <span className={cn("font-medium", doneCount > 0 && "text-emerald-500")}>{doneCount}/{run.steps.length}</span> steps done
              {err.toolCallsOk > 0 ? ` · ${err.toolCallsOk} tool call${err.toolCallsOk === 1 ? "" : "s"} succeeded first` : ""}
              {err.autoRetried ? (
                <Badge variant="outline" className="mx-0.5 px-1.5 py-0 text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-500">
                  auto-retried
                </Badge>
              ) : null}
              {hasOutput ? " · partial output preserved" : ""}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              You stopped this run — every completed step is kept. Resuming continues from
              {" "}<span className="font-medium text-foreground">step {(firstPending === -1 ? run.steps.length : firstPending) + 1}</span>{" "}
              without re-running what already succeeded.
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dismiss recovery options"
          title="Dismiss"
          onClick={() => setDismissed(true)}
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {err ? (
        <>
          <div className="rounded-lg border bg-background/60 p-2.5">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-red-400/80">error</span>
              <button
                type="button"
                aria-label="Copy raw error message"
                title="Copy raw error message"
                onClick={() => {
                  navigator.clipboard
                    .writeText(err.message)
                    .then(() => toast.success("Error copied", { description: "Raw message on the clipboard — no keys included." }))
                    .catch(() => toast.error("Clipboard blocked", { description: "Select the text and copy manually instead." }));
                }}
                className="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Copy className="h-3 w-3" aria-hidden />
                copy
              </button>
            </div>
            <p className={cn("break-words font-mono text-xs text-muted-foreground", !msgOpen && "line-clamp-2")}>
              {err.message}
            </p>
            {err.message.length > 110 ? (
              <button
                type="button"
                onClick={() => setMsgOpen((o) => !o)}
                className="mt-1 text-[11px] text-violet-400 transition-colors hover:text-violet-300"
              >
                {msgOpen ? "Show less" : "Show full error"}
              </button>
            ) : null}
          </div>
          {laneFailures.length >= 2 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5">
              <p className="mb-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                All {failedDials} dials failed across {laneFailures.length} lanes — each lane reported its own error:
              </p>
              <ul className="space-y-0.5">
                {laneFailures.map((f) => (
                  <li
                    key={f.lane}
                    className="break-words font-mono text-[10.5px] leading-relaxed text-muted-foreground"
                  >
                    <span className="font-sans font-medium text-foreground">{laneLabel(f.lane)}</span>
                    {f.count > 1 ? ` ×${f.count}` : ""}
                    {f.message ? ` — ${truncate(f.message, 110)}` : " — (no message recorded)"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="flex items-start gap-2 rounded-lg border border-violet-500/25 bg-violet-500/5 p-2.5 text-xs leading-relaxed">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" aria-hidden />
            <span>{err.hint}</span>
          </p>
          {run.callLog && run.callLog.length > 0 ? (
            <div className="rounded-lg border bg-background/60 p-2.5">
              <button
                type="button"
                onClick={() => setCallsOpen((o) => !o)}
                className="flex w-full items-center justify-between text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                aria-expanded={callsOpen}
              >
                <span>
                  LLM calls · {run.callLog.length} recorded
                  {run.callLog.some((c) => !c.ok) ? ` · ${run.callLog.filter((c) => !c.ok).length} failed` : " · all ok"}
                  {laneChip}{failedChip}
                </span>
                <span>{callsOpen ? "hide" : "show"}</span>
              </button>
              {callsOpen ? (
                <div className="mt-2">
                  <CallLogList log={run.callLog ?? []} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || firstPending === -1}
          onClick={() => onResume(firstPending, resumeRotates ? { forceServer: true } : undefined)}
          title={
            resumeRotates
              ? preferRelay
                ? "Lane preference is ON — this resume dials through the server relay first"
                : `Parked on a ${err?.kind === "rate-limit" ? "rate-limit" : "network/timeout"} failure — this resume rotates to the relay lane first (the park's promise), same as the auto-resume`
              : undefined
          }
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          {resumeRotates ? <Server className="h-3.5 w-3.5 text-sky-300" aria-hidden /> : null}
          {stopped
            ? `Resume from step ${firstPending + 1}`
            : firstPending === err?.stepIndex
              ? "Retry failed step"
              : "Resume from failed step"}
        </Button>
        {!stopped && err ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || firstPending === -1}
            onClick={() => onResume(firstPending, { forceServer: true })}
            title="Re-run this step through the app relay instead of the direct provider — the escape hatch for mid-stream stalls the direct lane can't recover from"
            className="border-sky-500/40 bg-sky-500/10 text-sky-300 transition-colors hover:bg-sky-500/20 hover:text-sky-200"
          >
            <Server className="h-3.5 w-3.5" aria-hidden />
            Retry via relay
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRestart}>
          <Play className="h-3.5 w-3.5" aria-hidden />
          Restart from scratch
        </Button>
        {hasOutput ? (
          <Button type="button" variant="ghost" size="sm" onClick={savePartialReport}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Partial report
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={copyDiagnostics}>
          <Copy className="h-3.5 w-3.5" aria-hidden />
          Copy diagnostics
        </Button>
        {err?.kind === "auth" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => useUiStore.getState().setView("settings")}
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden />
            Fix key in Settings
          </Button>
        ) : null}
      </div>

      {run.resumeCount || (err && err.attempts > 1) ? (
        <p className="text-[11px] text-muted-foreground">
          Resumed ×{run.resumeCount ?? 0}
          {err && err.attempts > 1 ? ` · ${err.attempts} attempts on this run` : ""}
          {" "}· a fresh run row is never duplicated, completed work is never re-billed.
        </p>
      ) : null}
    </Card>
  );
}

// ─── r206/r209: the router-decision chip, one composition two placements ────
// Rendered when a SpawnProposal links back to a run via sourceRunId. The
// r206 placement is the run-history row; r209 adds the panel HEADER so the
// decision is visible the moment the panel opens for the triggering run —
// no history expansion needed. Shared here so the two can never drift.
function RunRouterChip({
  prop,
  workflows,
}: {
  prop: SpawnProposal;
  workflows: Workflow[];
}) {
  const angle = angleOfProposal(prop.goal);
  const spawnedName = prop.spawnedWorkflowId
    ? workflows.find((w) => w.id === prop.spawnedWorkflowId)?.name
    : undefined;
  const statusLine =
    prop.status === "accepted"
      ? `accepted → "${spawnedName ?? prop.spawnedWorkflowId}"`
      : prop.status === "dismissed"
        ? "dismissed in the spawn inbox"
        : "open in the spawn inbox";
  return (
    <span
      title={`This run's low novelty triggered an Evolution variation.\nRouter: ${prop.reason}\nBranch: ${angle ? `"${angle}"` : "embedded in the proposal goal"}\nStatus: ${statusLine}`}
      aria-label="This run triggered an Evolution variation proposal"
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        prop.status === "dismissed"
          ? "bg-muted text-muted-foreground"
          : "bg-violet-500/15 text-violet-600 dark:text-violet-400"
      )}
    >
      🧬 → variation
    </span>
  );
}

// ─── r213: the per-workflow variation aggregate badge ───────────────────────
// RunRouterChip answers "what did THIS run trigger?"; this badge answers
// "how much variation came out of this pipeline overall?" — aggregating every
// SpawnProposal sourced from the workflow (stalled runs + manual suggestions),
// visible from any run the panel is open for. Click deep-links to the
// Evolution section that owns the spawn inbox (same doctrine as r212: signal
// → remediation surface). Violet while the inbox holds undecided rows.
function VariationBadge({
  count,
  openCount,
  acceptedCount,
  dismissedCount,
  onOpen,
}: {
  count: number;
  openCount: number;
  acceptedCount: number;
  dismissedCount: number;
  onOpen: () => void;
}) {
  const attention = openCount > 0;
  const statusLine = [
    openCount ? `${openCount} open in the inbox` : null,
    acceptedCount ? `${acceptedCount} accepted` : null,
    dismissedCount ? `${dismissedCount} dismissed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const noun = count === 1 ? "variation" : "variations";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${count} ${noun} sourced from this pipeline\n${statusLine}\nClick to open the Evolution section`}
      aria-label={`${count} ${noun} sourced from this pipeline — open the Evolution section`}
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold transition-colors",
        attention
          ? "bg-violet-500/15 text-violet-600 hover:bg-violet-500/25 dark:text-violet-400"
          : "bg-muted text-muted-foreground hover:bg-accent",
      )}
    >
      🧬 {count} {noun}
    </button>
  );
}

interface WorkflowRunPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: Workflow | null;
  /** Open the panel already viewing this run (kanban deep-link). */
  initialRunId?: string | null;
}

export function WorkflowRunPanel({
  open,
  onOpenChange,
  workflow,
  initialRunId,
}: WorkflowRunPanelProps) {
  // Subscribe to workflows so streamed patches re-render this panel
  const workflows = useWorkflowsStore((s) => s.workflows);
  // r206: spawn proposals link back to the run that triggered them via
  // sourceRunId — the run panel renders each run's router decision chip.
  const proposals = useWorkflowsStore((s) => s.proposals);
  const agents = useAgentsStore((s) => s.agents);

  const [task, setTask] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [viewingRunId, setViewingRunId] = React.useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [compareRunId, setCompareRunId] = React.useState<string | null>(null);
  // r131: which history row's call-log expander is open (one at a time).
  const [callsOpenRunId, setCallsOpenRunId] = React.useState<string | null>(null);
  // r184 (directive item c): per-history-row evidence ledger toggle.
  const [evidenceOpenRunId, setEvidenceOpenRunId] = React.useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [, scheduleTick] = React.useReducer((n: number) => n + 1, 0);
  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  // r228: the run the auto-follow effect has already followed for THIS panel
  // open — lets a manual history selection win over the follow (see below).
  const followedRunIdRef = React.useRef<string | null>(null);

  const liveWorkflow = workflow
    ? workflows.find((w) => w.id === workflow.id) ?? workflow
    : null;
  const viewedRun = viewingRunId
    ? liveWorkflow?.runs.find((r) => r.id === viewingRunId)
    : undefined;
  // r209: header variant — the router decision for the run the panel is
  // OPEN on, visible without expanding history.
  const viewedProposal = viewedRun
    ? proposals.find((p) => p.sourceRunId === viewedRun.id) ?? null
    : null;
  // r213: per-workflow variation aggregate — the r209 chip names the decision
  // for ONE run (and only when the panel is opened on that exact run); this
  // aggregation answers "how many variations has this pipeline produced?"
  // across every run plus manual suggestions, visible from ANY run.
  const wfVariations = liveWorkflow
    ? proposals.filter((p) => p.sourceWorkflowId === liveWorkflow.id)
    : [];
  const wfVarOpen = wfVariations.filter((p) => p.status === "open").length;
  const wfVarAccepted = wfVariations.filter(
    (p) => p.status === "accepted",
  ).length;
  const wfVarDismissed = wfVariations.length - wfVarOpen - wfVarAccepted;
  // Stop must survive navigation: after a remount the local abort handle is
  // gone, so derive "in flight" from the followed run and fall back to the
  // runner's live controller registry when stopping.
  const runInFlight = running || viewedRun?.status === "running";
  const stopActiveRun = () => {
    if (abortRef.current) abortRef.current.abort();
    else if (liveWorkflow) getRunController(liveWorkflow.id)?.abort();
  };
  const schedule = liveWorkflow?.schedule;

  // Reset the panel state whenever it opens for a workflow
  React.useEffect(() => {
    if (!open) return;
    setTask("");
    setRunning(false);
    setViewingRunId(initialRunId ?? null);
    setHistoryOpen(false);
    abortRef.current = null;
    followedRunIdRef.current = null;
  }, [open, workflow, initialRunId]);

  // Auto-scroll the output area to the bottom while a run streams
  const outputLen =
    viewedRun?.steps.reduce((n, s) => n + s.output.length, 0) ?? 0;
  const stepCount = viewedRun?.steps.length ?? 0;
  React.useEffect(() => {
    if (!running) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [outputLen, stepCount, running]);

  // Follow a run started elsewhere (e.g. the scheduler) for the open workflow.
  // r228: follow each running run exactly ONCE per panel-open. The old effect
  // re-fired on every viewingRunId change, so while a scheduled run streamed,
  // clicking ANY history row snapped the view straight back — the user could
  // not inspect past runs until the stream ended. The ref remembers what was
  // followed; manual selections always win afterwards, and a NEW running run
  // (new id) still pulls focus once, as before.
  const latestRun = liveWorkflow?.runs[0];
  React.useEffect(() => {
    if (!open || running || !latestRun) return;
    if (latestRun.status === "running" && followedRunIdRef.current !== latestRun.id) {
      followedRunIdRef.current = latestRun.id;
      setViewingRunId(latestRun.id);
    }
  }, [open, running, latestRun]);

  // Keep the schedule countdown honest while the panel is open
  const scheduleEnabled = schedule?.enabled === true;
  React.useEffect(() => {
    if (!open || !scheduleEnabled) return;
    const t = setInterval(scheduleTick, 5_000);
    return () => clearInterval(t);
  }, [open, scheduleEnabled, scheduleTick]);

  // r128: 1s tick while a step is mid-backoff so the "⏳ backoff Ns" chip
  // counts down live. Only runs while a wait is actually active — zero idle
  // cost, and the interval self-clears when the ladder dials again.
  const anyWaiting = (viewedRun?.steps ?? []).some(
    (s) => s.backoffUntil != null && s.backoffUntil > Date.now()
  );
  React.useEffect(() => {
    if (!anyWaiting) return;
    const t = setInterval(scheduleTick, 1_000);
    return () => clearInterval(t);
  }, [anyWaiting, scheduleTick]);

  // v23: the runner is resolve-only by design, but a throw before its main
  // try (store drift, HMR edge) would escape as an unhandled rejection — the
  // exact "Runtime Error: undefined" the user reported. Guard the boundary.
  const safeRun = (opts: Parameters<typeof executeWorkflowRun>[0]) =>
    executeWorkflowRun(opts).catch((err) => {
      console.error("[run-panel] run invocation failed", err);
      toast.error("Run could not start", {
        description: err instanceof Error ? err.message : "unknown error",
      });
      return null;
    });

  async function runWorkflow() {
    const wf = workflow;
    if (!wf || running) return;
    const trimmed = task.trim();
    if (!trimmed) return;

    await safeRun({
      workflow: { id: wf.id },
      task: trimmed,
      source: "manual",
      onStarted: (runId, controller) => {
        setViewingRunId(runId);
        setRunning(true);
        abortRef.current = controller;
      },
      onSettled: () => {
        setRunning(false);
        abortRef.current = null;
      },
    });
  }

  /** Continue an errored/stopped run from a step — completed outputs preserved. */
  async function resumeRun(fromStepIndex: number, opts?: { forceServer?: boolean }) {
    const wf = liveWorkflow;
    const run = viewedRun;
    if (!wf || !run || running) return;
    await safeRun({
      workflow: { id: wf.id },
      task: run.task,
      resume: { runId: run.id, fromStepIndex },
      source: "manual",
      forceServer: opts?.forceServer === true,
      onStarted: (runId, controller) => {
        setViewingRunId(runId);
        setRunning(true);
        abortRef.current = controller;
      },
      onSettled: () => {
        setRunning(false);
        abortRef.current = null;
      },
    });
  }

  /** Fresh run with the same task as a failed/stopped one. */
  async function restartRun() {
    const wf = liveWorkflow;
    const run = viewedRun;
    if (!wf || !run || running || !run.task.trim()) return;
    await safeRun({
      workflow: { id: wf.id },
      task: run.task,
      source: "manual",
      onStarted: (runId, controller) => {
        setViewingRunId(runId);
        setRunning(true);
        abortRef.current = controller;
      },
      onSettled: () => {
        setRunning(false);
        abortRef.current = null;
      },
    });
  }

  // ─── Schedule editing (patches the store immediately) ──────────────────────
  const patchSchedule = (patch: Partial<NonNullable<Workflow["schedule"]>>) => {
    if (!liveWorkflow) return;
    const current = liveWorkflow.schedule ?? {
      enabled: false,
      intervalMs: 15 * 60_000,
      task: "",
    };
    const next = { ...current, ...patch };
    // (Re-)arm nextRunAt whenever the schedule turns on or its interval changes
    if (next.enabled && (!current.enabled || next.intervalMs !== current.intervalMs)) {
      next.nextRunAt = Date.now() + next.intervalMs;
    }
    useWorkflowsStore.getState().update(liveWorkflow.id, { schedule: next });
    scheduleTick();
  };

  const hasSteps = (liveWorkflow?.steps.length ?? 0) > 0;
  // r298: the meta line must agree with the rows a run actually shows. Depth
  // injection (r26) materializes extra passes per run, so quoting the authored
  // count here read as "9 steps" one screen above a "Failed at step 3/11" run
  // banner — the user-reported discontinuity. When the counts differ, say the
  // delta out loud instead of silently contradicting the run below.
  const runShape = React.useMemo(
    () =>
      liveWorkflow
        ? describeRunShape(liveWorkflow, useAgentsStore.getState().agents)
        : null,
    [liveWorkflow]
  );

  // Run history list — reachable from BOTH the empty state and the run view,
  // so past runs can be re-opened, compared and exported anytime.
  const historySection = (
    <Collapsible open={historyOpen} onOpenChange={setHistoryOpen} className="pt-2">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-between text-muted-foreground"
          aria-label="Toggle run history"
        >
          Run history ({liveWorkflow?.runs.length ?? 0})
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              historyOpen && "rotate-180"
            )}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1 pt-2">
          {(liveWorkflow?.runs ?? []).map((r) => (
            <React.Fragment key={r.id}>
            <div
              className={cn(
                "flex items-center gap-0.5 rounded-lg border pr-0.5 transition",
                r.id === viewingRunId
                  ? "border-violet-500/40 bg-violet-500/5"
                  : "border-transparent"
              )}
            >
              <button
                type="button"
                onClick={() => setViewingRunId(r.id)}
                aria-label={`View run from ${fmtRel(r.startedAt)}: ${r.task}`}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-muted/50"
              >
                {r.status === "done" ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                ) : r.status === "error" ? (
                  <X className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
                ) : r.status === "partial" ? (
                  <Minus className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                ) : r.status === "blocked" ? (
                  <Hourglass className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                ) : r.status === "stopped" ? (
                  <Ban className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-400" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate text-xs">{r.task}</span>
                {r.steps.length > 0 ? (() => {
                  // r85: per-step tick strip — the card sparkline's language
                  // echoed per history row: how far the run got, at a glance.
                  const d = r.steps.filter((s) => s.status === "done").length;
                  return (
                    <span
                      className="flex shrink-0 items-center gap-[3px]"
                      role="img"
                      aria-label={`${d} of ${r.steps.length} steps done`}
                    >
                      {r.steps.slice(0, 12).map((s, si) => (
                        <span
                          key={si}
                          title={`Step ${si + 1} · ${s.status}`}
                          className={cn(
                            "h-1.5 w-1 rounded-sm",
                            s.status === "done" && "bg-emerald-500",
                            s.status === "error" && "bg-red-500",
                            s.status === "stopped" && "bg-zinc-400 dark:bg-zinc-600",
                            s.status === "skipped" && "bg-zinc-400 dark:bg-zinc-600",
                            s.status === "running" && "animate-pulse bg-violet-400",
                            s.status === "pending" && "bg-zinc-300 dark:bg-zinc-700"
                          )}
                        />
                      ))}
                      {d < r.steps.length ? (
                        <span className="ml-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {d}/{r.steps.length}
                        </span>
                      ) : null}
                    </span>
                  );
                })() : null}
                {r.status === "error" && r.error ? (
                  // r157 (user report: 12× 0/11 runs, cause invisible in the
                  // list): the failure reason lived only inside the run view —
                  // the user had to paste the whole UI to report it. Every
                  // errored history row now carries a compact WHY chip: which
                  // step died and the error kind; the tooltip holds the
                  // verbatim message + the actionable hint.
                  <span
                    title={`Failed at "${r.error.stepLabel}" (${r.error.kind})\n${r.error.message}${r.error.hint ? `\n→ ${r.error.hint}` : ""}`}
                    aria-label={`Run failed at step ${r.error.stepLabel}: ${r.error.kind}`}
                    className="flex min-w-0 shrink items-center gap-1 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="max-w-[9rem] truncate">{r.error.stepLabel}</span>
                    <span className="hidden shrink-0 opacity-75 sm:inline">· {r.error.kind}</span>
                  </span>
                ) : null}
                {r.status === "done" && r.novelty != null && (
                  <span
                    title={`Evolution novelty vs recent runs: ${r.novelty}%${r.novelty < 35 ? " — stall signal (near-duplicate output)" : ""}`}
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      r.novelty < 35
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    )}
                  >
                    🧬 {r.novelty}%
                  </span>
                )}
                {(() => {
                  // r206: the router's decision follows the run in BOTH
                  // directions — the spawned card carries the lineage chip
                  // (r203); the SOURCE run gets this chip citing the same
                  // evidence (composition shared with the r209 header chip).
                  const prop = proposals.find((p) => p.sourceRunId === r.id);
                  if (!prop) return null;
                  return <RunRouterChip prop={prop} workflows={workflows} />;
                })()}
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {fmtRel(r.startedAt)}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {r.finishedAt ? fmtMs(r.finishedAt - r.startedAt) : "—"}
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Compare this run with another`}
                title="Compare with another run"
                disabled={running || (liveWorkflow?.runs.length ?? 0) < 2}
                onClick={() => {
                  setCompareRunId(r.id);
                  setCompareOpen(true);
                }}
                className="h-7 w-7 shrink-0 rounded-lg text-muted-foreground transition-colors hover:text-violet-400"
              >
                <GitCompareArrows className="h-3.5 w-3.5" aria-hidden />
              </Button>
              {r.callLog && r.callLog.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${r.callLog.length} recorded LLM calls — toggle call log`}
                  aria-expanded={callsOpenRunId === r.id}
                  title={`${r.callLog.length} recorded LLM calls · ${r.callLog.filter((c) => !c.ok).length} failed — click to inspect lanes, notes and durations`}
                  onClick={() => setCallsOpenRunId((id) => (id === r.id ? null : r.id))}
                  className={cn(
                    "h-7 shrink-0 gap-1 rounded-lg px-2 font-mono text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-violet-400",
                    callsOpenRunId === r.id && "text-violet-400"
                  )}
                >
                  <Server className="h-3.5 w-3.5" aria-hidden />
                  {r.callLog.length}
                </Button>
              ) : null}
              {(() => {
                // r184: claim-to-source evidence ledger — cite count chip.
                const n = buildEvidenceLedger(r.steps).length;
                if (n === 0) return null;
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${n} cited source${n === 1 ? "" : "s"} — toggle evidence ledger`}
                    aria-expanded={evidenceOpenRunId === r.id}
                    title={`${n} distinct source${n === 1 ? "" : "s"} referenced by this run's outputs and tool calls — click to inspect`}
                    onClick={() => setEvidenceOpenRunId((id) => (id === r.id ? null : r.id))}
                    className={cn(
                      "h-7 shrink-0 gap-1 rounded-lg px-2 font-mono text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-violet-400",
                      evidenceOpenRunId === r.id && "text-violet-400"
                    )}
                  >
                    <Link2 className="h-3.5 w-3.5" aria-hidden />
                    {n}
                  </Button>
                );
              })()}
            </div>
            {callsOpenRunId === r.id && r.callLog && r.callLog.length > 0 ? (
              <div className="rounded-lg border bg-background/60 p-2.5">
                <CallLogList log={r.callLog} />
              </div>
            ) : null}
            {evidenceOpenRunId === r.id
              ? (() => {
                  const ledger = buildEvidenceLedger(r.steps);
                  return (
                    <div className="rounded-lg border border-violet-500/25 bg-violet-500/[0.03] p-2.5">
                      <p className="mb-1.5 text-[11px] font-medium">
                        Evidence ledger · {ledger.length} distinct source{ledger.length === 1 ? "" : "s"}
                      </p>
                      {ledger.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          No external sources referenced in this run's outputs or tool calls.
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {ledger.map((e) => (
                            <li key={e.url} className="min-w-0 text-[11px] leading-relaxed">
                              <span className="font-medium">{e.domain}</span>
                              {" "}
                              <a
                                href={e.url}
                                target="_blank"
                                rel="noreferrer"
                                className="break-all text-violet-400 hover:underline"
                              >
                                {e.url}
                              </a>
                              <span className="block text-muted-foreground">
                                cited by {formatCiters(e)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()
              : null}
            </React.Fragment>
          ))}
          {(liveWorkflow?.runs.length ?? 0) === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No runs yet — completed runs land here with compare + report exports.
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="right"
        overlay={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        /* Docked-panel behavior: clicking/typing elsewhere in the app must
         * NOT dismiss the run panel — users watch a live run while writing.
         * Dismissal stays available via the X button or Escape. */
        onInteractOutside={(e) => e.preventDefault()}
        className="flex w-full flex-col gap-0 border-l bg-background p-0 shadow-2xl sm:max-w-2xl"
      >
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="truncate">{liveWorkflow?.name ?? "Workflow"}</SheetTitle>
          <div className="flex items-center gap-2">
            <SheetDescription>Pipeline run</SheetDescription>
            {/* r186: the chip shows the depth this run ACTUALLY materialized
                with (stamped by the runner) — a degraded fire reads "Standard"
                here instead of lying with the workflow's authored "Deep". */}
            <DepthChip depth={viewedRun?.depth ?? liveWorkflow?.depth} />
            {/* r209: the header router chip — same evidence as the history-row
                chip, surfaced the moment the panel opens for this run. */}
            {viewedProposal && (
              <RunRouterChip prop={viewedProposal} workflows={workflows} />
            )}
            {/* r213: per-workflow aggregate — how many variations this pipeline
                has sourced overall, clickable into the Evolution inbox. */}
            {liveWorkflow && wfVariations.length > 0 && (
              <VariationBadge
                count={wfVariations.length}
                openCount={wfVarOpen}
                acceptedCount={wfVarAccepted}
                dismissedCount={wfVarDismissed}
                onOpen={() => {
                  useUiStore.getState().setView("settings");
                  useUiStore.getState().setSettingsAnchor("evolution");
                }}
              />
            )}
            {scheduleEnabled && (
              <span
                title={`Recurring schedule · next ${fmtIn(schedule?.nextRunAt)}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                Every {fmtIntervalShort(schedule?.intervalMs ?? 900_000)} · next{" "}
                {fmtIn(schedule?.nextRunAt)}
              </span>
            )}
          </div>
        </SheetHeader>

        {/* Task input */}
        <div className="border-b p-4">
          <Textarea
            rows={2}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe the task for this pipeline…"
            aria-label="Pipeline task"
            className="resize-none"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="truncate text-[11px] text-muted-foreground">
              {hasSteps
                ? runShape
                  ? `${runShape.effective} steps per run · ${liveWorkflow?.steps.length} authored + ${runShape.note} · agents hand outputs down the chain`
                  : `${liveWorkflow?.steps.length} step${liveWorkflow?.steps.length === 1 ? "" : "s"} · agents hand outputs down the chain`
                : "This workflow has no steps yet — edit it first."}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {viewedRun && !running && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Export run report as Markdown"
                  title="Export run report as Markdown"
                  onClick={() => {
                    if (!viewedRun || !liveWorkflow) return;
                    downloadText(
                      runReportFileName(liveWorkflow.name, viewedRun, liveWorkflow.runs ?? []),
                      runToMarkdown(liveWorkflow, viewedRun),
                      "text/markdown"
                    );
                    toast.success("Run report exported", {
                      description: `${viewedRun.steps.length} steps saved as Markdown.`,
                    });
                  }}
                  className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors hover:text-violet-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  Report
                </Button>
              )}
              {/* Recurring schedule */}
              <Popover
                open={scheduleOpen}
                onOpenChange={(v) => {
                  setScheduleOpen(v);
                  scheduleTick();
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Recurring schedule"
                    title="Recurring schedule"
                    disabled={!hasSteps}
                    className={cn(
                      "h-8 gap-1.5 px-2.5 text-xs text-muted-foreground transition-colors hover:text-violet-400",
                      scheduleEnabled &&
                        "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
                    )}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {scheduleEnabled ? fmtIntervalShort(schedule?.intervalMs ?? 900_000) : "Schedule"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 space-y-3.5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold leading-none">Recurring schedule</p>
                      <p className="text-xs text-muted-foreground">
                        Re-runs this pipeline automatically while the app is open.
                      </p>
                    </div>
                    <Switch
                      aria-label="Enable recurring schedule"
                      checked={scheduleEnabled}
                      onCheckedChange={(v) => patchSchedule({ enabled: v })}
                    />
                  </div>

                  {scheduleEnabled && (
                    <>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">Interval</p>
                        <Select
                          value={String(schedule?.intervalMs ?? 900_000)}
                          onValueChange={(v) => patchSchedule({ intervalMs: Number(v) })}
                        >
                          <SelectTrigger aria-label="Schedule interval" className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SCHEDULE_INTERVALS.map((iv) => (
                              <SelectItem key={iv.ms} value={String(iv.ms)}>
                                {iv.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          Task for scheduled runs
                        </p>
                        <Textarea
                          rows={3}
                          value={schedule?.task ?? ""}
                          onChange={(e) => patchSchedule({ task: e.target.value })}
                          placeholder={
                            liveWorkflow?.description
                              ? `Defaults to: ${liveWorkflow.description.slice(0, 60)}${liveWorkflow.description.length > 60 ? "…" : ""}`
                              : "Defaults to the workflow description"
                          }
                          aria-label="Scheduled task"
                          className="resize-none text-sm"
                        />
                      </div>

                      <div className="rounded-xl border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between">
                          <span>Last run</span>
                          <span className="font-medium text-foreground">
                            {schedule?.lastRunAt ? fmtRel(schedule.lastRunAt) : "not yet"}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <span>Next run</span>
                          <span className="font-medium tabular-nums text-violet-400">
                            {fmtIn(schedule?.nextRunAt)}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </PopoverContent>
              </Popover>
              {runInFlight ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                  onClick={stopActiveRun}
                >
                  <Square className="h-3.5 w-3.5" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={!task.trim() || !hasSteps}
                  onClick={runWorkflow}
                >
                  <Play className="h-3.5 w-3.5" />
                  Run
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Steps output + history */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {!viewedRun ? (
            <>
              <div className="flex min-h-32 items-center justify-center px-6 pt-6 text-center text-sm text-muted-foreground">
                Describe a task above and hit Run — agents execute one by one, each
                building on the previous output.
              </div>
              {historySection}
            </>
          ) : (
            <>
              {viewedRun.task ? (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Task:</span>{" "}
                  {viewedRun.task}
                </p>
              ) : null}
              {/* Non-silent failure fallback: options + information, never just a dead end */}
              {!running && RECOVERY_STATUSES.has(viewedRun.status) && liveWorkflow ? (
                <RunRecoveryCard
                  key={viewedRun.id}
                  run={viewedRun}
                  workflow={liveWorkflow}
                  busy={running}
                  onResume={resumeRun}
                  onRestart={restartRun}
                />
              ) : null}
              {viewedRun.steps.length > 0 ? (() => {
                // r86: step-list header echo of the r85 history-row tick strip —
                // the run's own progress at the top of the step cards, same r80
                // status semantics, one notch larger (primary view). >12-step
                // runs show the first 12 ticks plus the true k/n count.
                const d = viewedRun.steps.filter((s) => s.status === "done").length;
                const truncated = viewedRun.steps.length > 12;
                return (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Steps
                    </span>
                    <span
                      className="flex items-center gap-[4px]"
                      role="img"
                      aria-label={`${d} of ${viewedRun.steps.length} steps done`}
                    >
                      {viewedRun.steps.slice(0, 12).map((s, si) => (
                        <span
                          key={`${viewedRun.id}-tick-${si}`}
                          title={`Step ${si + 1} · ${s.status}`}
                          className={cn(
                            "h-2 w-1.5 rounded-sm",
                            s.status === "done" && "bg-emerald-500",
                            s.status === "error" && "bg-red-500",
                            s.status === "stopped" && "bg-zinc-400 dark:bg-zinc-600",
                            s.status === "skipped" && "bg-zinc-400 dark:bg-zinc-600",
                            s.status === "running" && "animate-pulse bg-violet-400",
                            s.status === "pending" && "bg-zinc-300 dark:bg-zinc-700"
                          )}
                        />
                      ))}
                    </span>
                    {d < viewedRun.steps.length || truncated ? (
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {d}/{viewedRun.steps.length}
                      </span>
                    ) : null}
                    {truncated ? (
                      <span className="text-[10px] text-muted-foreground">
                        (first 12 shown)
                      </span>
                    ) : null}
                  </div>
                );
              })() : null}
              {(() => {
                // r311: universal tag-vs-worker mismatch (imported plans) gets
                // ONE honest note instead of an identical chip on every row.
                const summary = summarizeRoleTagMismatches(
                  viewedRun.steps.map((s) => ({
                    label: s.label,
                    roleId: s.roleId,
                    agentName: agents.find((a) => a.id === s.agentId)?.name ?? s.agentName ?? null,
                  }))
                );
                if (!summary.universal) return null;
                return (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground">
                    All {summary.tagged} step labels carry "[role]" tags from the source plan and none match their
                    assigned workers — routing follows the assigned agents (shown per step), never the titles.
                  </p>
                );
              })()}
              {viewedRun.steps.map((step, i) => {
                const agent = agents.find((a) => a.id === step.agentId);
                // r180/r182 role honesty: routing is agentId, never the title.
                // The EFFECTIVE role signal prefers an explicit step.roleId
                // (authorable since r182); the parsed "[Tag]" prefix is the
                // legacy fallback. Mismatch → amber chip, phrased by source.
                const roleInfo = resolveStepRole(step.roleId, step.label);
                const roleTag = parseRolePrefix(step.label);
                const roleMismatch =
                  roleInfo.role != null &&
                  !roleMatchesAgent(roleInfo.role, agent?.name ?? step.agentName);
                // r311: when EVERY tagged step mismatches (imported-plan legacy),
                // the per-step chips are summarized above — repetition is not
                // information. Partial mismatches keep their chips.
                const roleUniversal = summarizeRoleTagMismatches(
                  viewedRun.steps.map((s) => ({
                    label: s.label,
                    roleId: s.roleId,
                    agentName: agents.find((a) => a.id === s.agentId)?.name ?? s.agentName ?? null,
                  }))
                ).universal;
                return (
                  <Card
                    key={`${viewedRun.id}-${step.stepId}-${i}`}
                    className={cn(
                      "gap-2 border-l-4 p-4",
                      STEP_BORDER[step.status],
                      step.kind === "review" && "bg-amber-500/[0.035]"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <AgentAvatar
                        agent={
                          agent ?? {
                            emoji: step.agentEmoji,
                            color: "violet",
                            name: step.agentName,
                          }
                        }
                        size="xs"
                      />
                      <div className="min-w-0 flex-1 text-sm font-medium">
                        <span className="truncate">{step.agentName}</span>
                        <span className="text-muted-foreground"> · </span>
                        <span className="truncate text-muted-foreground">
                          {roleTag.cleanLabel}
                        </span>
                        {roleMismatch && !roleUniversal ? (
                          <span
                            className="ml-1.5 shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-px align-middle text-[10px] font-medium text-amber-600 dark:text-amber-400"
                            title={
                              roleInfo.source === "explicit"
                                ? `The step's explicit role is "${roleInfo.role}", but the actual worker is "${step.agentName}" — routing is decided by the assigned agent, never by the role field.`
                                : `The label carries a "[${roleTag.role}]" role tag, but the actual worker is "${step.agentName}" — routing is decided by the assigned agent, never by the title.`
                            }
                          >
                            {roleInfo.source === "explicit" ? "role" : "tag"} [{roleInfo.role}] ≠ worker
                          </span>
                        ) : null}
                      </div>
                      {/* Review-gate verdict + rework badges */}
                      {step.kind === "review" && step.status === "done" && step.verdict ? (
                        <span
                          title={
                            step.verdict === "pass"
                              ? "The review gate accepted the previous step's output"
                              : "The review gate requested a rework of the previous step"
                          }
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                            step.verdict === "pass"
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          )}
                        >
                          {step.verdict === "pass" ? (
                            <ShieldCheck className="h-3 w-3" aria-hidden />
                          ) : (
                            <Undo2 className="h-3 w-3" aria-hidden />
                          )}
                          {step.verdict === "pass" ? "passed" : "rework"}
                        </span>
                      ) : null}
                      {step.degraded ? (
                        <span
                          title="This step hit its tool budget mid-research — the output below is an auto-digest of the tool results, not a full synthesis. Retry the step for a fuller answer."
                          className="inline-flex shrink-0 items-center rounded-full border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-orange-600 dark:text-orange-400"
                        >
                          auto-digest
                        </span>
                      ) : null}
                      {step.reworked ? (
                        <span
                          title="This step was redone after the review gate rejected its first attempt"
                          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
                        >
                          <Undo2 className="h-3 w-3" aria-hidden />
                          redone
                        </span>
                      ) : null}
                      <StatusIndicator
                        status={step.status}
                        ms={step.ms}
                        backoffUntil={step.backoffUntil}
                        backoffKind={step.backoffKind}
                      />
                      {step.output ? (
                        <button
                          type="button"
                          title="Copy this step's output"
                          aria-label={`Copy output of step ${i + 1} — ${step.agentName}`}
                          onClick={() => {
                            navigator.clipboard
                              .writeText(step.output)
                              .then(() =>
                                toast.success("Step output copied", {
                                  description: `${step.agentName} · ${step.output.length} chars`,
                                })
                              )
                              .catch(() => {
                                toast.error("Clipboard blocked", {
                                  description: "Select the output text and copy manually.",
                                });
                              });
                          }}
                          className="shrink-0 rounded p-1 text-muted-foreground/60 transition hover:bg-muted/50 hover:text-foreground"
                        >
                          <Copy className="h-3 w-3" aria-hidden />
                        </button>
                      ) : null}
                    </div>

                    <div className="min-h-6 text-sm">
                      {step.output ? (
                        <MarkdownRenderer content={step.output} />
                      ) : step.status === "running" ? (
                        <div
                          className="flex items-center gap-1 py-1.5"
                          role="status"
                          aria-label="Agent is thinking"
                        >
                          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-violet-400" />
                          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-violet-400" />
                          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-violet-400" />
                        </div>
                      ) : step.status === "pending" ? (
                        <p className="py-1.5 text-xs italic text-zinc-500">
                          Waiting for the previous step to finish…
                        </p>
                      ) : null}
                    </div>

                    <ToolCallChips toolCalls={step.toolCalls} />
                  </Card>
                );
              })}

              {historySection}
            </>
          )}
        </div>
      </SheetContent>

      {/* Side-by-side diff of two runs */}
      <WorkflowCompareDialog
        open={compareOpen}
        onOpenChange={setCompareOpen}
        workflow={liveWorkflow}
        initialRunId={compareRunId}
      />
    </Sheet>
  );
}
