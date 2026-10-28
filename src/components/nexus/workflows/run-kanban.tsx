"use client";

// ─── Runs Kanban: every pipeline run across every workflow, grouped by state ─
// Inspired by Untrivial-ai/agent-orchestrator ("Needs you" attention column)
// and cft0808/edict's 军机处 board with health badges.

import * as React from "react";
import {
  ArrowRight,
  Ban,
  Check,
  Clock,
  Copy,
  Hourglass,
  Loader2,
  Minus,
  Undo2,
  X,
} from "lucide-react";
import {
  useUiStore,
  useWorkflowsStore,
} from "@/lib/stores";
import { fmtIn, fmtIntervalShort, fmtMs, fmtRel } from "@/lib/helpers";
import type { Workflow, WorkflowRun } from "@/lib/types";
import { cn } from "@/lib/utils";
// r486-a (Run Archive epic): the board's own poll lands server-lane rows in
// client state — they archive here too (shared dedupe lives in run-archive).
import { toast } from "sonner";
import { archiveServerLaneRun } from "@/lib/run-archive";
// r649 (TraceTrial slice 2b, arXiv 2610.32285): the same pure harness-layer
// adapter the run panel uses — the board is a second honest call site, not a
// reimplementation. No chip when every criterion is bypassed (no signal, no chip).
import { harnessChipForRun } from "@/lib/trace-trial";
// r660: the looped-depth outcome reaches the Runs board — same shared adapter
// as the run panel (single mapping, second honest call site, r649 doctrine).
import { loopedOutcomeChip } from "@/lib/looped-outcome";
import { GATE_MIN_CHARS } from "@/lib/systemone";
import { gateCensusOf } from "@/lib/gate-census";
import { familyTallyOf } from "@/lib/family-witness";

/** v24: one server-lane AutomationRun row (from /api/automation/sync GET). */
interface ServerRunRow {
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
  // v25: full Prisma row rides along — per-step outputs + final report feed the detail drawer.
  stepsJson?: string | null;
  finalReport?: string | null;
}

/** v25: one parsed entry of AutomationRun.stepsJson — [{label, output, ms, ok}].
 * r521: a wait step parks a sentinel entry carrying the durable checkpoint. */
interface ServerStepDetail {
  label?: string;
  output?: string;
  ms?: number;
  ok?: boolean;
  waiting?: { event: string; since: string; deadline: string };
}

function parseRunSteps(raw?: string | null): ServerStepDetail[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ServerStepDetail[]) : [];
  } catch {
    return [];
  }
}

interface BoardCard {
  key: string;
  workflowId: string;
  workflowName: string;
  run?: WorkflowRun;
  server?: ServerRunRow;
  /** epoch ms of run start — uniform sort key across lanes */
  sortAt: number;
  /** Scheduled cards represent a workflow's next firing, not a stored run. */
  scheduled?: { intervalMs: number; nextRunAt?: number; lastRunAt?: number };
}

interface Column {
  id: "running" | "attention" | "done" | "scheduled";
  label: string;
  hint: string;
  dotClass: string;
  ringClass: string;
}

const COLUMNS: Column[] = [
  {
    id: "running",
    label: "Working",
    hint: "Runs streaming right now",
    dotClass: "bg-violet-500",
    ringClass: "border-t-violet-500/60",
  },
  {
    id: "attention",
    label: "Needs you",
    hint: "Failed or stopped runs waiting for a decision",
    dotClass: "bg-amber-500",
    ringClass: "border-t-amber-500/60",
  },
  {
    id: "done",
    label: "Done",
    hint: "Recently completed runs",
    dotClass: "bg-emerald-500",
    ringClass: "border-t-emerald-500/60",
  },
  {
    id: "scheduled",
    label: "Scheduled",
    hint: "Pipelines on a recurring schedule",
    dotClass: "bg-pink-500",
    ringClass: "border-t-pink-500/60",
  },
];

const MAX_PER_COLUMN = 10;

// v24: poll the server lane every 60s while the board is open — headless
// runs the tab never saw would otherwise stay invisible to the kanban.
function useServerRuns(enabled: boolean): ServerRunRow[] {
  const [serverRuns, setServerRuns] = React.useState<ServerRunRow[]>([]);
  React.useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch("/api/automation/sync");
        if (!res.ok) return;
        const json = (await res.json()) as { runs?: ServerRunRow[] };
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

function groupRuns(workflows: Workflow[], serverRuns: ServerRunRow[]): Record<Column["id"], BoardCard[]> {
  const cards: Record<Column["id"], BoardCard[]> = {
    running: [],
    attention: [],
    done: [],
    scheduled: [],
  };
  for (const wf of workflows) {
    for (const run of wf.runs) {
      const card: BoardCard = {
        key: run.id,
        workflowId: wf.id,
        workflowName: wf.name,
        run,
        sortAt: run.startedAt ?? 0,
      };
      if (run.status === "running") cards.running.push(card);
      else if (
        run.status === "error" ||
        run.status === "stopped" ||
        run.status === "partial" ||
        run.status === "blocked"
      )
        cards.attention.push(card);
      else cards.done.push(card);
    }
    if (wf.schedule?.enabled && wf.steps.length > 0) {
      cards.scheduled.push({
        key: `sched-${wf.id}`,
        workflowId: wf.id,
        workflowName: wf.name,
        sortAt: wf.schedule.nextRunAt ?? 0,
        scheduled: {
          intervalMs: wf.schedule.intervalMs,
          nextRunAt: wf.schedule.nextRunAt,
          lastRunAt: wf.schedule.lastRunAt,
        },
      });
    }
  }
  // v24: merge the server lane — headless runs fired while the tab was
  // closed (built-in engine, results in the local DB) now share the board.
  for (const r of serverRuns) {
    const card: BoardCard = {
      key: `srv-${r.id}`,
      workflowId: r.workflowId,
      workflowName: r.workflowName,
      server: r,
      sortAt: Date.parse(r.startedAt) || 0,
    };
    // r521: a "waiting" run still belongs in Working — it is paused on an
    // event, not finished; the amber hourglass card tells the two apart.
    if (r.status === "running" || r.status === "waiting") cards.running.push(card);
    else if (r.status === "error") cards.attention.push(card);
    else cards.done.push(card);
  }
  cards.running.sort((a, b) => a.sortAt - b.sortAt);
  cards.attention.sort((a, b) => b.sortAt - a.sortAt);
  cards.done.sort((a, b) => b.sortAt - a.sortAt);
  cards.scheduled.sort((a, b) => (a.scheduled!.nextRunAt ?? 0) - (b.scheduled!.nextRunAt ?? 0));
  // r227: the per-column cap is applied at RENDER time, not here — groupRuns
  // used to slice done/attention to MAX_PER_COLUMN before anything counted,
  // so a pipeline with 30 completed runs reported "Done 10" and its filter
  // chip said 10 as if the cap were the total (same truth-class as the
  // r224 search-counter bug). The board now shows 10 cards plus an honest
  // "+N older runs not shown" footer, and chips count the real total.
  return cards;
}

function RunCard({
  card,
  onSelect,
  onOpenServer,
}: {
  card: BoardCard;
  onSelect: (workflowId: string, runId?: string) => void;
  onOpenServer?: (row: ServerRunRow) => void;
}) {
  const highlightId = useUiStore((s) => s.highlightWorkflowId);
  const spotlighted = highlightId === card.workflowId;
  if (card.scheduled) {
    return (
      <button
        type="button"
        onClick={() => onSelect(card.workflowId)}
        data-wf-card={card.workflowId}
        className={cn(
          "group w-full rounded-xl border border-pink-500/25 bg-card/80 p-3 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-pink-500/50 hover:shadow-md hover:shadow-pink-500/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          spotlighted &&
            "ring-2 ring-violet-500/60 ring-offset-2 ring-offset-background"
        )}
      >
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0 text-pink-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">
            {card.workflowName}
          </span>
          <ArrowRight
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>every {fmtIntervalShort(card.scheduled.intervalMs)}</span>
          <span className="tabular-nums text-pink-600 dark:text-pink-400">
            next {fmtIn(card.scheduled.nextRunAt)}
          </span>
        </div>
        {card.scheduled.lastRunAt ? (
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            last run {fmtRel(card.scheduled.lastRunAt)}
          </p>
        ) : null}
      </button>
    );
  }

  // v24: server-lane card — cyan accent + ⇉ badge, shows DB-side progress.
  // v25: click opens the detail drawer (steps + final report) instead of navigating.
  if (card.server) {
    const s = card.server;
    return (
      <button
        type="button"
        onClick={() => (onOpenServer ? onOpenServer(s) : onSelect(card.workflowId))}
        data-wf-card={card.workflowId}
        className={cn(
          "group w-full rounded-xl border border-cyan-500/30 bg-card/80 p-3 text-left shadow-sm transition-all duration-200",
          "hover:-translate-y-0.5 hover:border-cyan-500/60 hover:shadow-md hover:shadow-cyan-500/10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          spotlighted && "ring-2 ring-violet-500/60 ring-offset-2 ring-offset-background"
        )}
      >
        <div className="flex items-center gap-1.5">
          {s.status === "running" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-400" aria-hidden />
          ) : s.status === "waiting" ? (
            <span title="Paused on a waitForEvent step — emit the event to resume" className="flex shrink-0">
              <Hourglass className="h-3.5 w-3.5 animate-pulse text-amber-500" aria-hidden />
            </span>
          ) : s.status === "error" ? (
            <X className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{card.workflowName}</span>
          <span
            title="Fired headlessly by the local server while the tab was closed — click to inspect steps & report"
            className="shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-600 dark:text-cyan-400"
          >
            ⇉ server
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
          <span className="tabular-nums">{fmtRel(Date.parse(s.startedAt))}</span>
          <span>
            · {s.status === "running"
              ? `step ${s.currentStep}/${s.stepsTotal}`
              : s.status === "waiting"
                ? "waiting for event"
                : `${s.stepsTotal} steps`}
          </span>
          {s.status === "waiting" ? (
            (() => {
              const evt = parseRunSteps(s.stepsJson).find((st) => st.waiting)?.waiting?.event;
              return (
                <span
                  title={evt ? `Waiting for event "${evt}" — emit it on this board to resume` : "Waiting for an event"}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-semibold text-amber-600 dark:text-amber-400"
                >
                  <Hourglass className="h-2.5 w-2.5 animate-pulse" aria-hidden />
                  {evt ? evt : "waiting"}
                </span>
              );
            })()
          ) : null}
          <span>· {s.trigger === "manual" ? "manual" : "schedule"}</span>
        </div>
        {s.error ? (
          <p className="mt-1 line-clamp-2 break-words font-mono text-[10px] text-red-400">{s.error}</p>
        ) : null}
      </button>
    );
  }

  const run = card.run!;
  const reworks = run.steps.filter((s) => s.verdict === "rework" || s.reworked).length;
  const degraded = run.steps.filter((s) => s.degraded).length;
  const doneSteps = run.steps.filter((s) => s.status === "done").length;
  // r649 (TraceTrial slice 2b): the harness layer judged SEPARATELY from the
  // task outcome on every board card — emerald "harness n/n" when every scored
  // criterion passes, amber with the failed criteria named in the tooltip.
  const harnessChip = harnessChipForRun(run.steps, run.status);
  // r660: first looped step on the card — the board card mirrors the run
  // panel's outcome-toned chip so a loop's verdict is legible at board scale.
  const loopedStep = run.steps.find((s) => s.looped);

  return (
    <button
      type="button"
      onClick={() => onSelect(card.workflowId, run.id)}
      data-wf-card={card.workflowId}
      className={cn(
        "card-in group w-full rounded-xl border bg-card/80 p-3 text-left shadow-sm transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        spotlighted &&
          "ring-2 ring-violet-500/60 ring-offset-2 ring-offset-background",
        "hover:-translate-y-0.5 hover:shadow-md",
        run.status === "running" &&
          "border-violet-500/30 hover:border-violet-500/60 hover:shadow-violet-500/10",
        run.status === "error" &&
          "border-red-500/30 hover:border-red-500/60 hover:shadow-red-500/10",
        (run.status === "stopped" || run.status === "partial" || run.status === "blocked") &&
          "border-amber-500/30 hover:border-amber-500/60 hover:shadow-amber-500/10",
        run.status === "done" &&
          "hover:border-emerald-500/60 hover:shadow-emerald-500/10"
      )}
    >
      <div className="flex items-center gap-1.5">
        {run.status === "running" ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-400" aria-hidden />
        ) : run.status === "error" ? (
          <X className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
        ) : run.status === "partial" ? (
          <Minus className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
        ) : run.status === "blocked" ? (
          <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
        ) : run.status === "stopped" ? (
          <Ban className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">
          {card.workflowName}
        </span>
        {run.novelty != null && (
          <span
            title={`Evolution novelty vs recent runs: ${run.novelty}%${run.novelty < 35 ? " — stall signal (near-duplicate output)" : ""}`}
            className={cn(
              "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tabular-nums",
              run.novelty < 35
                ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                : "border-emerald-500/30 bg-emerald-500/5 text-emerald-500"
            )}
          >
            🧬 {run.novelty}%
          </span>
        )}
        <ArrowRight
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      </div>

      <p className="mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
        {run.task || "No task text"}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
        <span className="tabular-nums">{fmtRel(run.startedAt)}</span>
        {run.finishedAt ? (
          <span className="tabular-nums">· {fmtMs(run.finishedAt - run.startedAt)}</span>
        ) : null}
        <span>
          · {run.status === "running" ? `${doneSteps}/${run.steps.length} steps` : `${run.steps.length} steps`}
        </span>
        {reworks > 0 ? (
          <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px font-semibold text-amber-600 dark:text-amber-400">
            <Undo2 className="h-2.5 w-2.5" aria-hidden />
            {reworks} rework{reworks === 1 ? "" : "s"}
          </span>
        ) : null}
        {degraded > 0 ? (
          <span
            title="Steps that hit their tool budget and ended on an auto-digest instead of a synthesized answer"
            className="inline-flex items-center rounded-full border border-orange-500/40 bg-orange-500/10 px-1.5 py-px font-semibold text-orange-600 dark:text-orange-400"
          >
            {degraded} auto-digest
          </span>
        ) : null}
        {run.degradedDeep && run.degradedDeep.skipped > 0 ? (
          <span
            title={`${run.degradedDeep.skipped} of the materialized deep-research passes was skipped after a transient ${run.degradedDeep.kinds.join("/")} error — the run continued without it; the final output is not deep-verified.`}
            className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px font-semibold text-amber-600 dark:text-amber-400 tabular-nums"
          >
            ↯ deep skipped ({run.degradedDeep.skipped})
          </span>
        ) : null}
        {loopedStep?.looped ? (
          (() => {
            const oc = loopedOutcomeChip(loopedStep.looped.reason);
            return (
              <span
                tabIndex={0}
                title={`Looped-depth: ${loopedStep.looped.k} tied pass(es) of ${loopedStep.looped.r} on "${loopedStep.label}", exit ${loopedStep.looped.reason} — ${oc.says} (arXiv 2610.31421 adaptation)`}
                className={cn(
                  "inline-flex cursor-help items-center rounded-full border px-1.5 py-px font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  oc.tone === "pass" &&
                    "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                  oc.tone === "warn" &&
                    "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  oc.tone === "muted" && "border-border bg-muted/40 text-muted-foreground"
                )}
              >
                ↻ looped {loopedStep.looped.k}/{loopedStep.looped.r}
              </span>
            );
          })()
        ) : null}
        {(() => {
          // r666: the gate-floor readiness census at board scale — the r664
          // panel chip's second honest call site (r649 doctrine), reading the
          // same GATE_MIN_CHARS constant the runner enforces. Length-only
          // claim: counts outputs that reach the floor, never a verdict —
          // the tooltip names what else a verdict needs (generate kind,
          // non-degraded stream, toggle, and a judge that answers).
          const steps = run.steps ?? [];
          const withOut = steps.filter((s) => (s.output ?? "").trim().length > 0);
          if (withOut.length === 0) return null;
          const met = withOut.filter((s) => s.output.trim().length >= GATE_MIN_CHARS).length;
          const all = met === withOut.length;
          return (
            <span
              title={`Gate-floor readiness: ${met} of ${withOut.length} output-bearing step(s) reach the decision gate's length floor (≥${GATE_MIN_CHARS} chars). Length only — a verdict also needs a generate kind, a non-degraded stream, the toggle on, and a judge that answers.`}
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-px font-semibold tabular-nums",
                all
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                  : "border-border bg-muted/40 text-muted-foreground"
              )}
            >
              ⌈floor {met}/{withOut.length}
            </span>
          );
        })()}
        {(() => {
          // r668: the r667 board census promoted to the shared gate-census
          // adapter (r649 doctrine) — same note prefixes, same shape, now also
          // read by the run panel's header. Data-layer truth, not rendered text.
          const census = gateCensusOf(run.callLog);
          // r677: per-run drift witness — how many of this run's judge notes
          // are family-disjoint (cross) vs same-family (same).
          const fam = familyTallyOf((run.callLog ?? []).map((c) => c.note));
          if (census.engaged === 0 && census.verdicts === 0) return null;
          return (
            <span
              tabIndex={0}
              title={`Decision gate engaged ${census.engaged} time(s) on this run; ${census.verdicts} confident verdict(s) landed — the rest fell through (no judge answered or judge errored; the full tried-ladder trace lives in the run's call log; the chip takes the LATEST verdict's color — emerald PASS, amber FAIL — so a failed gate never reads green).${fam.cross + fam.same > 0 ? ` Judge family witness: ◈ ${fam.cross} cross-family · ◇ ${fam.same} same-family.` : ""}`}
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-px font-semibold tabular-nums transition-colors cursor-help focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                census.verdictTone === "fail"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : census.verdictTone === "pass"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border bg-muted/40 text-muted-foreground"
              )}
            >
              ⚖ gate {census.engaged}·{census.verdicts}{census.verdictLine ? ` · ${census.verdictLine}` : ""}
            </span>
          );
        })()}
        {harnessChip ? (
          <span
            tabIndex={0}
            title={harnessChip.tooltip}
            aria-label={`Harness reliability ${harnessChip.label}`}
            className={cn(
              "inline-flex items-center rounded-full px-1.5 py-px font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              harnessChip.tone === "warn"
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            )}
          >
            {harnessChip.label}
          </span>
        ) : null}
      </div>
    </button>
  );
}

// v25: detail drawer for headless server runs — the DB-side stepsJson (per-step
// output/ms/ok) + finalReport are invisible on the board card; this surfaces them.
function ServerRunDrawer({
  row,
  onClose,
  onOpenWorkflow,
}: {
  row: ServerRunRow;
  onClose: () => void;
  onOpenWorkflow: (workflowId: string) => void;
}) {
  // r429 a11y: the overlay used to leave focus wherever it was (behind the
  // backdrop), and Tab leaked to the page underneath. Move focus in on open,
  // cycle Tab within the panel, restore focus on close (WCAG 2.4.3 focus order).
  // r431 hardening: the trap lives on WINDOW, not in a React onKeyDown — React
  // delegates at the root container, so a keydown whose target is <body> (focus
  // lost to a click on non-interactive panel text) never reached the handler and
  // Tab escaped behind the overlay. The window listener catches every target and
  // re-enters focus into the panel when activeElement has left it.
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => prev?.focus();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      const inPanel = active instanceof Node && panelRef.current.contains(active);
      if (!inPanel) {
        // focus fell out (body / detached) — route it back in instead of
        // letting the browser Tab to the first focusable BEHIND the overlay.
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const steps = React.useMemo(() => parseRunSteps(row.stepsJson), [row.stepsJson]);
  const duration = row.finishedAt ? Date.parse(row.finishedAt) - Date.parse(row.startedAt) : null;
  // r523: one-click operator export — paste a run's honest story into bug
  // reports / handoffs without screenshotting the drawer.
  const [copied, setCopied] = React.useState(false);
  const copyReport = React.useCallback(() => {
    const report = [
      `Run ${row.id} — ${row.workflowName}`,
      `status: ${row.status} · trigger: ${row.trigger} · started ${row.startedAt}${row.finishedAt ? ` · finished ${row.finishedAt}` : ""}`,
      row.error ? `error: ${row.error}` : null,
      ...steps.map(
        (st, i) =>
          `${i + 1}. ${st.label || "step"} — ${
            st.waiting
              ? `waiting for event "${st.waiting.event}"`
              : st.ok === false
                ? "FAILED"
                : st.output || "no output captured"
          }`,
      ),
      row.finalReport ? `report: ${row.finalReport}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    void navigator.clipboard
      ?.writeText(report)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {
        // r610 audit: the last fully-muted catch on a user-facing wire —
        // clipboard failure (blocked context / denied permission) now says
        // so, same honest fallback as the run panel's copy buttons.
        toast.error("Clipboard blocked", {
          description:
            "The browser refused clipboard access — open the run and copy from the report body instead.",
        });
      });
  }, [row, steps]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Server run detail: ${row.workflowName}`}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-cyan-500/30 bg-card shadow-2xl shadow-cyan-500/10"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-2 border-b border-border/60 p-4">
          {row.status === "running" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-400" aria-hidden />
          ) : row.status === "waiting" ? (
            <span title="Paused on a waitForEvent step — emit the event to resume" className="flex shrink-0">
              <Hourglass className="h-4 w-4 animate-pulse text-amber-500" aria-hidden />
            </span>
          ) : row.status === "error" ? (
            <X className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
          ) : (
            <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
          )}
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{row.workflowName}</h3>
          <span className="shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-semibold text-cyan-600 dark:text-cyan-400">
            ⇉ server · {row.trigger === "manual" ? "manual" : "schedule"}
          </span>
          <button
            type="button"
            onClick={copyReport}
            aria-label="Copy run report to clipboard"
            title="Copy the full run report (status, steps, outputs) to the clipboard"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-500" aria-hidden />
            ) : (
              <Copy className="h-4 w-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close server run detail"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="tabular-nums">started {fmtRel(Date.parse(row.startedAt))}</span>
            {duration != null && duration >= 0 ? (
              <span className="tabular-nums">· took {fmtMs(duration)}</span>
            ) : null}
            <span className="tabular-nums">
              · {row.status === "running"
                ? `step ${row.currentStep}/${row.stepsTotal}`
                : row.status === "waiting"
                  ? "waiting for event"
                  : `${row.stepsTotal} steps`}
            </span>
          </div>

          {row.error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-red-500">Error</p>
              <p className="mt-1 break-words font-mono text-[10px] leading-relaxed text-red-400">{row.error}</p>
            </div>
          ) : null}

          {steps.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-600 dark:text-cyan-400">
                Steps ({steps.length})
              </p>
              {steps.map((st, i) => (
                <div key={i} className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                  <div className="flex items-center gap-1.5">
                    {st.ok === false ? (
                      <X className="h-3 w-3 shrink-0 text-red-400" aria-hidden />
                    ) : (
                      <Check className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                      {i + 1}. {st.label || `Step ${i + 1}`}
                    </span>
                    {typeof st.ms === "number" && st.ms > 0 ? (
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{fmtMs(st.ms)}</span>
                    ) : null}
                  </div>
                  {st.waiting ? (
                    <p className="mt-1.5 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                      <Hourglass className="h-3 w-3 shrink-0 animate-pulse" aria-hidden />
                      waiting for event “{st.waiting.event}” — resumes automatically when it lands
                    </p>
                  ) : null}
                  {st.output ? (
                    <pre className="mt-1.5 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                      {st.output}
                    </pre>
                  ) : (
                    <p className="mt-1 text-[10px] italic text-muted-foreground/60">No output captured for this step.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] italic text-muted-foreground/70">
              No step detail stored for this run yet{row.status === "running" ? " — still streaming" : ""}.
            </p>
          )}

          {row.finalReport ? (
            <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-600 dark:text-cyan-400">
                Final report
              </p>
              <pre className="mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-foreground/90">
                {row.finalReport}
              </pre>
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border/60 px-4 py-3">
          <p className="text-[10px] leading-snug text-muted-foreground/70">
            Headless server lane — results land in the local DB, your keys never leave this machine.
          </p>
          <button
            type="button"
            onClick={() => onOpenWorkflow(row.workflowId)}
            className="shrink-0 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-600 transition-colors hover:bg-cyan-500/20 dark:text-cyan-400"
          >
            Open pipeline →
          </button>
        </footer>
      </div>
    </div>
  );
}

/** r521 (TASK-101 slice 3): the operator event lane — emit a named event to
 * resume any server-lane step parked on a waitForEvent checkpoint. The board
 * refreshes within one 60s poll; the claim loop resumes the run on its next
 * 15s tick after the event lands. */
function EventEmitBar() {
  const [name, setName] = React.useState("");
  const [state, setState] = React.useState<"idle" | "busy" | "ok" | "err">("idle");
  const emit = async () => {
    const trimmed = name.trim();
    if (!trimmed || state === "busy") return;
    setState("busy");
    try {
      const res = await fetch("/api/automation/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: trimmed }),
      });
      setState(res.ok ? "ok" : "err");
      if (res.ok) setName("");
    } catch {
      setState("err");
    }
    setTimeout(() => setState("idle"), 2500);
  };
  return (
    <div
      role="group"
      aria-label="Emit automation event"
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5"
    >
      <Hourglass className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
      <span className="text-[10px] font-medium text-muted-foreground">
        Resume a waiting step — emit event
      </span>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void emit();
        }}
        placeholder="event name (e.g. deploy-done)"
        aria-label="Event name to emit"
        className="min-w-0 flex-1 rounded-md border border-border bg-background/60 px-2 py-1 text-[11px] outline-none placeholder:text-muted-foreground/50 focus:border-amber-500/50 focus-visible:ring-2 focus-visible:ring-violet-500/40"
      />
      <button
        type="button"
        onClick={() => void emit()}
        disabled={!name.trim() || state === "busy"}
        className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-600 transition-colors hover:bg-amber-500/20 disabled:opacity-40 dark:text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        {state === "busy" ? "…" : state === "ok" ? "emitted ✓" : state === "err" ? "failed" : "Emit"}
      </button>
    </div>
  );
}

export function RunKanban({
  onSelect,
}: {
  onSelect: (workflowId: string, runId?: string) => void;
}) {
  const workflows = useWorkflowsStore((s) => s.workflows);
  const boardOpen = useUiStore((s) => s.workflowBoardOpen);
  const serverRuns = useServerRuns(boardOpen);
  // v25: which server-lane run's detail drawer is open (null = closed).
  const [serverDetail, setServerDetail] = React.useState<ServerRunRow | null>(null);
  // Keep countdowns honest
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!boardOpen) return;
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [boardOpen, tick]);

  const columns = React.useMemo(() => groupRuns(workflows, serverRuns), [workflows, serverRuns]);
  // r672: durable RSI ledger census (GET /api/evals) — the training corpus
  // accumulating in SQLite (KICK corpus interaction_logs adaptation).
  // Best-effort on mount; a muted corpus stays silent (no signal, no chip,
  // the r648 doctrine). Unreachable ledger → no chip, never an error.
  const [ledger, setLedger] = React.useState<{
    total: number;
    verdicts: number;
    fails: number;
    family?: { cross: number; same: number };
    // r684: the census GET has shipped its newest events since r672 — the
    // board finally keeps them (freshness at a glance, zero API change).
    latest?: Array<{
      workflow?: string;
      kind?: string;
      verdict?: string | null;
      confidence?: number | null;
      createdAt?: string;
    }>;
  } | null>(null);
  // r681: failed-census attempts — the honest silence marker below renders
  // only after real, REPEATED fetch failures (never for an empty corpus).
  const [ledgerMisses, setLedgerMisses] = React.useState(0);
  // r683: the ghost chip is clickable — bumping this nonce re-arms the whole
  // 6×3s retry loop without a remount (the r681 marker gets a recovery path;
  // before this, exhausted tries silenced the chip until a coincidental
  // navigation remounted the board).
  const [ledgerRetry, setLedgerRetry] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      tries += 1;
      void fetch("/api/evals")
        .then(async (res) => {
          if (!res.ok) throw new Error(`ledger census HTTP ${res.status}`);
          const j = (await res.json()) as {
            total?: number;
            verdicts?: number;
            fails?: number;
            family?: { cross?: number; same?: number };
            latest?: Array<{
              workflow?: string;
              kind?: string;
              verdict?: string | null;
              confidence?: number | null;
              createdAt?: string;
            }>;
          };
          if (
            !(
              typeof j.total === "number" &&
              typeof j.verdicts === "number" &&
              typeof j.fails === "number"
            )
          ) {
            throw new Error("ledger census shape");
          }
          if (!alive) return;
          setLedger({
            total: j.total,
            verdicts: j.verdicts,
            fails: j.fails,
            family:
              j.family && typeof j.family.cross === "number" && typeof j.family.same === "number"
                ? { cross: j.family.cross, same: j.family.same }
                : undefined,
            // r684: defensive — a junk row renders as nothing (the r670
            // fixture lesson), never as a fake fresh event.
            latest: Array.isArray(j.latest) ? j.latest.slice(0, 3) : undefined,
          });
          setLedgerMisses(0);
        })
        .catch(() => {
          /* the ledger census is best-effort — the board renders without it.
             r681: but "without it" no longer means FOREVER — a cold compile
             or a bundle-recompile window once silenced the chip for a whole
             session (the r681 P4 witness). Retry inside the session window. */
          if (alive) {
            setLedgerMisses((m) => Math.max(m, tries));
            if (tries < 6) timer = setTimeout(load, 3_000);
          }
        });
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [ledgerRetry]);
  // r684: corpus freshness — compact age token for the ⧉ chip ("now" /
  // "4m" / "3h" / "2d"), null when the timestamp is missing or unreadable:
  // an honest absence, never a fake "now". Clock skew clamps to "now".
  const ledgerAgeOf = (iso: string | undefined | null): string | null => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return "now";
    if (s < 3_600) return `${Math.floor(s / 60)}m`;
    if (s < 172_800) return `${Math.floor(s / 3_600)}h`;
    return `${Math.floor(s / 86_400)}d`;
  };
  const ledgerLatest = ledger?.latest?.[0];
  const ledgerAge = ledgerAgeOf(ledgerLatest?.createdAt);
  // Pipeline filter lives in the ui store (persisted): it survives layout
  // switches (grid <-> board) and reloads instead of resetting on unmount.
  const filter = useUiStore((s) => s.boardWorkflowFilter);
  const setFilter = useUiStore((s) => s.setBoardWorkflowFilter);
  const unfilteredTotal = Object.values(columns).reduce((n, c) => n + c.length, 0);
  const visible = React.useMemo(() => {
    if (!filter) return columns;
    const out = {} as Record<Column["id"], BoardCard[]>;
    (Object.keys(columns) as Column["id"][]).forEach((k) => {
      out[k] = columns[k].filter((c) => c.workflowId === filter);
    });
    return out;
  }, [columns, filter]);
  const total = Object.values(visible).reduce((n, c) => n + c.length, 0);
  // r649 (TraceTrial slice 2b): the F3 census belongs on the board too —
  // runs that SUCCEEDED while violating >=1 harness criterion, counted across
  // every VISIBLE card (scheduled cards carry no run — honestly skipped).
  // Green icons must not mask red underneath, on any surface.
  const boardHarness = React.useMemo(() => {
    let runs = 0;
    let debts = 0;
    (Object.values(visible) as BoardCard[][]).forEach((cards) =>
      cards.forEach((c) => {
        if (!c.run) return;
        runs += 1;
        if (harnessChipForRun(c.run.steps, c.run.status)?.successDespiteViolation === true)
          debts += 1;
      })
    );
    return { runs, debts };
  }, [visible]);
  // r671: board-level gate health beside the F3 census — of the runs visible
  // on the board, how many called the judge ladder, how many verdicts landed,
  // and how many runs' LATEST verdict is a FAIL (amber at scan level — the
  // same tone contract the r670 card chips carry, aggregated).
  const boardGates = React.useMemo(() => {
    let engaged = 0;
    let verdictRuns = 0;
    let verdicts = 0;
    let failRuns = 0;
    // r682: witness tally over the SAME visible set — the corpus ledger may
    // hold more (server-side finalization POSTs after the browser is gone);
    // the digest makes the visible-vs-corpus gap legible instead of silent.
    const notes: Array<string | null | undefined> = [];
    (Object.values(visible) as BoardCard[][]).forEach((cards) =>
      cards.forEach((c) => {
        if (!c.run) return;
        const census = gateCensusOf(c.run.callLog);
        if (census.engaged === 0 && census.verdicts === 0) return;
        engaged += 1;
        verdicts += census.verdicts;
        notes.push(...(c.run.callLog ?? []).map((row) => row?.note));
        if (census.verdicts > 0) {
          verdictRuns += 1;
          if (census.verdictTone === "fail") failRuns += 1;
        }
      })
    );
    return { engaged, verdictRuns, verdicts, failRuns, witness: familyTallyOf(notes) };
  }, [visible]);
  // Chip choices: every pipeline that currently has at least one card, busiest first.
  const filterChoices = React.useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>();
    (Object.keys(columns) as Column["id"][]).forEach((k) =>
      columns[k].forEach((c) => {
        const e = counts.get(c.workflowId) ?? { name: c.workflowName, n: 0 };
        e.n += 1;
        counts.set(c.workflowId, e);
      })
    );
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [columns]);

  if (unfilteredTotal === 0) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed text-center text-sm text-muted-foreground">
        Nothing on the board yet — run a pipeline and its cards land here.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <EventEmitBar />
      {boardHarness.runs > 0 ? (
        <p
          className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[10px] tabular-nums text-muted-foreground"
          title="TraceTrial F3 (arXiv 2610.32285): runs that finished green while violating at least one harness criterion — success is not reliable. Judged separately from the task outcome. The ⚖ chip aggregates the Decision gate's call-log census across visible runs — amber when any run's latest verdict is a FAIL, emerald when verdicts landed clean, muted while judges stay unanswered. The ◈/◇ witness count covers the VISIBLE runs' call-log notes only; the ⧉ ledger chip's tally covers every archived event in SQLite — including runs whose client record never landed, because server-side finalization POSTs after the browser is gone (the corpus outlives the trimmed store)."
        >
          <span>
            {boardHarness.runs} run{boardHarness.runs === 1 ? "" : "s"} on the board
          </span>
          {boardHarness.debts > 0 ? (
            <span className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px font-semibold text-amber-600 dark:text-amber-400">
              {boardHarness.debts} harness debt{boardHarness.debts === 1 ? "" : "s"}
            </span>
          ) : null}
          {boardGates.engaged > 0 ? (
            <span
              tabIndex={0}
              title={`Visible runs' Decision gate census: ${boardGates.engaged} gate call${boardGates.engaged === 1 ? "" : "s"} · ${boardGates.verdicts} verdict${boardGates.verdicts === 1 ? "" : "s"}${boardGates.failRuns > 0 ? ` · ${boardGates.failRuns} latest-FAIL` : ""} — amber while a run's latest verdict is a FAIL, emerald when verdicts landed clean, muted while judges stay unanswered. Counts only what the browser's own run records still hold; the ⧉ ledger chip beside it covers the durable corpus (server-side finalization POSTs after the browser is gone — the visible-vs-corpus split).${boardGates.witness.cross + boardGates.witness.same > 0 ? ` Drift witness: ◈ ${boardGates.witness.cross} cross-family · ◇ ${boardGates.witness.same} same-family.` : ""}`}
              className={cn(
                "inline-flex cursor-help items-center rounded-full border px-1.5 py-px font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                boardGates.failRuns > 0
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : boardGates.verdictRuns > 0
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border bg-muted/40 text-muted-foreground"
              )}
            >
              ⚖ {boardGates.engaged} gate call{boardGates.engaged === 1 ? "" : "s"} · {boardGates.verdicts} verdict{boardGates.verdicts === 1 ? "" : "s"}
              {boardGates.failRuns > 0 ? ` · ${boardGates.failRuns} latest-FAIL` : ""}
              {boardGates.witness.cross > 0 ? (
                <span className="ml-1 text-violet-600 dark:text-violet-400">◈{boardGates.witness.cross}</span>
              ) : null}
              {boardGates.witness.same > 0 ? (
                <span className="ml-1 text-muted-foreground">◇{boardGates.witness.same}</span>
              ) : null}
            </span>
          ) : null}
          {ledger !== null && ledger.total > 0 ? (
            <span
              tabIndex={0}
              title={`RSI eval ledger (durable SQLite): ${ledger.total} gate event${ledger.total === 1 ? "" : "s"} archived from finished runs — ${ledger.verdicts} verdict${ledger.verdicts === 1 ? "" : "s"}, ${ledger.fails} FAIL${ledger.fails === 1 ? "" : "s"}, ${ledger.total - ledger.verdicts} engaged without a confident verdict (uncertain / no judge answered / judge errored — the r659/r660 honest-trace family, never counted as a pass). The training corpus outlives the browser's trimmed localStorage store (the KICK corpus's interaction_logs pattern, adapted).${ledger.family && ledger.family.cross + ledger.family.same > 0 ? ` Drift witness: ◈ ${ledger.family.cross} cross-family · ◇ ${ledger.family.same} same-family judge note(s) — narcissistic-drift avoidance, self-reported by the corpus.` : ""}${typeof ledgerLatest?.kind === "string" && ledgerAge !== null ? ` Latest event: ${ledgerLatest.kind}${typeof ledgerLatest.verdict === "string" && ledgerLatest.verdict ? ` ${ledgerLatest.verdict}` : ""}${typeof ledgerLatest.confidence === "number" ? ` ${ledgerLatest.confidence}%` : ""}${typeof ledgerLatest.workflow === "string" && ledgerLatest.workflow ? ` on ${ledgerLatest.workflow}` : ""} — ${ledgerAge === "now" ? "just now" : `${ledgerAge} ago`}.` : ""}`}
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-px font-semibold tabular-nums transition-colors cursor-help focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                ledger.fails > 0
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : ledger.verdicts > 0
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border bg-muted/40 text-muted-foreground"
              )}
            >
              ⧉ ledger {ledger.total}·{ledger.verdicts}
              {/* r679: FAIL health joins the glance line — the chip already
              turns amber when a run's gate failed; the count itself now reads
              without opening the ledger or hovering. */}
              {ledger.fails > 0 ? <span className="ml-1 font-bold">✕{ledger.fails}</span> : null}
              {/* r680: the honest-trace family completes the glance line —
              engaged-without-a-confident-verdict (uncertain / no judge /
              judge errored) is the r659/r660 doctrine's third outcome; the
              muted ∅K keeps an unanswered gate from masquerading as health. */}
              {ledger.total - ledger.verdicts > 0 ? (
                <span className="ml-1 text-muted-foreground">∅{ledger.total - ledger.verdicts}</span>
              ) : null}
              {/* r678: drift counts leave the tooltip — cross/same-family
              tallies read at a glance on the digest line itself. */}
              {ledger.family && ledger.family.cross > 0 ? (
                <span className="ml-1 text-violet-600 dark:text-violet-400">◈{ledger.family.cross}</span>
              ) : null}
              {ledger.family && ledger.family.same > 0 ? (
                <span className="ml-1 text-muted-foreground">◇{ledger.family.same}</span>
              ) : null}
              {/* r684: freshness at a glance — the corpus outlives the browser;
              the age token says whether it is still breathing, no hover. */}
              {ledgerAge ? (
                <span className="ml-1 font-normal opacity-70">· {ledgerAge}</span>
              ) : null}
            </span>
          ) : null}
          {ledger === null && ledgerMisses >= 2 ? (
            <button
              type="button"
              onClick={() => {
                // r683: a retry is not a failure — the ghost honestly steps
                // aside while the fresh loop runs; it returns only if the
                // new attempts keep missing too (misses re-accumulate).
                setLedgerMisses(0);
                setLedgerRetry((n) => n + 1);
              }}
              title={`RSI eval ledger census UNREACHABLE — ${ledgerMisses} fetch attempt${ledgerMisses === 1 ? "" : "s"} failed (best-effort, retried in-session). Click to re-arm the retry loop now. This is an honest silence marker, not a census: no chip is faked for an empty corpus (the r648 doctrine), and an unreachable ledger is never a verdict — the r659/r660 trace doctrine just refuses to let an infra failure vanish without a trace.`}
              className="inline-flex items-center rounded-full border border-dashed border-border bg-muted/40 px-1.5 py-px text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              ⧉ ledger …
            </button>
          ) : null}
        </p>
      ) : null}
      {filterChoices.length > 1 && (
        <div
          role="group"
          aria-label="Board filter by pipeline"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            onClick={() => setFilter(null)}
            aria-pressed={filter === null}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors",
              filter === null
                ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
            )}
          >
            All pipelines
          </button>
          {filterChoices.map(([id, e]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(filter === id ? null : id)}
              aria-pressed={filter === id}
              title={`Show only cards from "${e.name}"`}
              className={cn(
                "max-w-52 truncate rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors",
                filter === id
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                  : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
              )}
            >
              {e.name} <span className="tabular-nums opacity-70">{e.n}</span>
            </button>
          ))}
        </div>
      )}
      {filter && total === 0 ? (
        <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed text-center text-sm text-muted-foreground">
          No cards match this filter — the selected pipeline has nothing on the board right now.
        </div>
      ) : (
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Runs kanban board"
      >
      {COLUMNS.map((col) => {
        // r227: cap at render — the raw array keeps the true total so the
        // badge, the aria label and the "+N older" footer can tell the truth.
        const rawCards = visible[col.id];
        const cards = rawCards.slice(0, MAX_PER_COLUMN);
        const older = rawCards.length - cards.length;
        return (
          <section
            key={col.id}
            aria-label={`${col.label} column, ${rawCards.length} card${rawCards.length === 1 ? "" : "s"}`}
            className={cn(
              "flex min-h-32 flex-col gap-2 rounded-2xl border border-t-4 bg-muted/20 p-2.5",
              col.ringClass
            )}
          >
            <header className="flex items-center gap-2 px-1 pt-0.5">
              <span className={cn("h-2 w-2 rounded-full", col.dotClass)} aria-hidden />
              <h3 className="text-xs font-semibold uppercase tracking-wide">
                {col.label}
              </h3>
              <span
                title={older > 0 ? `${older} older ${col.id === "scheduled" ? "pipelines" : "runs"} beyond the ${MAX_PER_COLUMN}-card cap` : undefined}
                className="rounded-full bg-muted px-1.5 py-px text-[10px] font-semibold tabular-nums text-muted-foreground"
              >
                {cards.length}
                {older > 0 ? `/${rawCards.length}` : ""}
              </span>
              <span className="sr-only">{col.hint}</span>
            </header>
            <div className="flex flex-col gap-2">
              {cards.map((c) => (
                <RunCard
                  key={c.key}
                  card={c}
                  onSelect={onSelect}
                  onOpenServer={setServerDetail}
                />
              ))}
              {older > 0 ? (
                <p className="px-1 py-1 text-[10px] leading-relaxed text-muted-foreground/70">
                  +{older} older {col.id === "scheduled" ? "pipelines" : "runs"} not shown
                </p>
              ) : null}
              {cards.length === 0 ? (
                <p className="px-1 py-3 text-[11px] leading-relaxed text-muted-foreground/70">
                  {col.id === "running" && "No runs streaming — start one from a pipeline card."}
                  {col.id === "attention" && "Nothing needs attention. 🎉"}
                  {col.id === "done" && "Finished runs will pile up here."}
                  {col.id === "scheduled" && "Enable a recurring schedule on a pipeline."}
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
      </div>
      )}
      {serverDetail ? (
        <ServerRunDrawer
          // r454: the drawer used to render the row snapshot captured at
          // CLICK time — while the 60s poll kept refreshing the BOARD, an
          // open drawer on a running run froze at "step 3/9" and its step
          // detail / final report never appeared even after the poll had
          // delivered them. Re-resolve the row by id from the latest poll;
          // the click-time snapshot stays only as the fallback for a run
          // that has since left the payload (cap, board closed).
          row={serverRuns.find((r) => r.id === serverDetail.id) ?? serverDetail}
          onClose={() => setServerDetail(null)}
          onOpenWorkflow={(id) => {
            setServerDetail(null);
            onSelect(id);
          }}
        />
      ) : null}
    </div>
  );
}
