"use client";

import * as React from "react";
import { toast } from "sonner";
import { ServerAutopilot } from "@/components/nexus/workflows/server-autopilot";
import { StrategyCard } from "@/components/nexus/workflows/strategy-card";
import { GatewayPulse } from "@/components/nexus/workflows/gateway-pulse-chip";
import {
  Archive,
  ChevronRight,
  Clock,
  Columns3,
  Copy,
  Download,
  KeyRound,
  Lightbulb,
  LayoutList,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  PauseCircle,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAgentsStore,
  useUiStore,
  useWorkflowsStore,
} from "@/lib/stores";
import type { SpawnProposal, Workflow, WorkflowRun, WorkflowSchedule, WorkflowStep } from "@/lib/types";
import { buildAngleHistory, buildVariationProposal, latestScoredNovelty, withFrontierSeed, NOVELTY_SPAWN_THRESHOLD } from "@/lib/spawn-proposal-engine";
import { buildDefaultConstraints, formatConstraintBlock, validateConstraintBlock } from "@/lib/constraint-block";
import type { FrontierSeedRef } from "@/lib/spawn-proposal-engine";
// r511 frontier seeding + lane experiments: the browser-side seed ledger and
// the radar-adopted lane registry are read client-side (BYOK intact).
import { readFrontierSeeds } from "@/lib/frontier-scout";
import { enabledAdoptedLanes } from "@/lib/lane-adopt";
import type { AdoptedLane } from "@/lib/lane-adopt";
import { useSettingsStore } from "@/lib/stores";
import { buildWorkflowExport, downloadJson, fmtBytes, fmtIn, fmtIntervalShort, fmtRel, IMPORT_RUNS_CAP, resolveStepRole, roleMatchesAgent, sanitizeImportedRun, stripUiChipArtifacts, summarizeRoleTagMismatches, truncateAtWord, uid } from "@/lib/helpers";
import { resolveLlm } from "@/lib/llm-config";
import { isWorkflowRunning } from "@/lib/workflow-runner";
import { deepPauseChip } from "@/lib/depth-chip";
import { readScheduleSkips } from "@/lib/schedule-skips";
import { cn } from "@/lib/utils";
import { AgentAvatar, DepthChip, EmptyState, PageHeader } from "@/components/nexus/atoms";
import { WorkflowEditorDialog } from "./workflow-editor-dialog";
import { WorkflowRunPanel } from "./workflow-run-panel";
import { RunKanban } from "./run-kanban";
import { RunArchivePanel } from "./run-archive-panel";

// ─── Workflow import/export helpers ─────────────────────────────────

function slugifyWf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workflow"
  );
}

function exportWorkflows(workflows: Workflow[], mode: "definitions" | "full") {
  // r496: two export modes. Definitions = the old portable file. Full pack =
  // definitions + run history (outputs, tool calls, LLM call log, novelty,
  // errors) + schedule intent — so a batch export finally outweighs a single
  // run report instead of the reverse.
  const agentNameById = new Map(
    useAgentsStore.getState().agents.map((a) => [a.id, a.name] as const)
  );
  const payload = buildWorkflowExport(workflows, mode, agentNameById);
  const runsTotal = workflows.reduce((n, w) => n + w.runs.length, 0);
  downloadJson(
    workflows.length === 1
      ? `nexus-workflow-${slugifyWf(workflows[0].name)}${mode === "full" ? "-full" : ""}.json`
      : mode === "full"
        ? "nexus-workflows-full.json"
        : "nexus-workflows.json",
    payload
  );
  if (mode === "full") {
    const bytes = new Blob([JSON.stringify(payload)]).size;
    toast.success(
      `Full pack exported — ${workflows.length} workflow${workflows.length === 1 ? "" : "s"} · ${runsTotal} run${runsTotal === 1 ? "" : "s"} · ${fmtBytes(bytes)}`,
      {
        description:
          "Definitions + run history + outputs + schedules. Schedules import paused — re-arm them after import.",
      }
    );
  } else {
    toast.success(
      `Exported ${workflows.length} workflow${workflows.length === 1 ? "" : "s"} — definitions only`,
      runsTotal > 0
        ? { description: "Run history not included — use “Full pack — with runs” for that." }
        : undefined
    );
  }
}

/** Validate an untrusted parsed value as a Workflow; returns null when unusable.
 * r448: also reports steps dropped during sanitizing (junk slots + steps whose
 * agent is not in the local roster). The caller must surface that count —
 * r270 doctrine: an action that silently dropped data must SAY so. It also
 * matters mechanically: the import fingerprint includes ordered step
 * identities, so a silently truncated import would fail to dedupe against
 * its own export file on re-import and spawn an "(imported)" twin instead.
 * r496: full packs (version 2) also carry run history — restored read-only
 * and capped — plus schedule intent, which imports PAUSED (a recurring
 * pipeline from another profile must be re-armed deliberately, never fire
 * as a surprise). Definitions-only files import exactly as before. */
function sanitizeWorkflow(
  raw: unknown,
  validAgentIds: Set<string>,
  agentNameIndex?: Map<string, string>
): { wf: Workflow; droppedSteps: number; reboundSteps: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

  const rawSteps = Array.isArray(r.steps) ? r.steps : [];
  const steps: WorkflowStep[] = [];
  let droppedSteps = 0;
  let reboundSteps = 0;
  for (const rs of rawSteps) {
    if (!rs || typeof rs !== "object") {
      droppedSteps++;
      continue;
    }
    const s = rs as Record<string, unknown>;
    let agentId = typeof s.agentId === "string" ? s.agentId : "";
    if (!agentId || !validAgentIds.has(agentId)) {
      // r495: portable packs carry `agentName` on each step (ids are
      // profile-local uid()s that never survive an export). Rebind by name
      // (case-insensitive) instead of silently dropping the step; the caller
      // reports the rebind count in the import receipt. Unresolvable steps
      // still drop with a visible count — no silent truncation.
      const nm = typeof s.agentName === "string" ? s.agentName.trim().toLowerCase() : "";
      const rebound = nm && agentNameIndex ? agentNameIndex.get(nm) : undefined;
      if (rebound && validAgentIds.has(rebound)) {
        agentId = rebound;
        reboundSteps++;
      } else {
        droppedSteps++; // r448: no longer silent — the caller reports the count
        continue;
      }
    }
    steps.push({
      id: uid("step"),
      agentId,
      // r343: file-import text keeps the caps but never tears mid-word.
      label: truncateAtWord(stripUiChipArtifacts(str(s.label, "Step")), 200) || "Step",
      instruction: s.instruction
        ? truncateAtWord(stripUiChipArtifacts(str(s.instruction)), 2000)
        : undefined,
      kind: s.kind === "review" ? ("review" as const) : ("generate" as const),
    });
  }
  if (steps.length === 0) return null;

  const now = Date.now();
  const id = uid("wf");
  const wfName = truncateAtWord(stripUiChipArtifacts(name), 80);
  // r496: run history rides in full packs — sanitize each row (junk rows drop
  // here; live "running" rows coerce to "stopped"; never-started steps become
  // "skipped" so imported history never promises phantom work), then cap to
  // the live per-workflow cap. Newest-first order matches addRun().
  const runs = (Array.isArray(r.runs) ? r.runs : [])
    .map((raw) => sanitizeImportedRun(raw, id, wfName))
    .filter((x): x is WorkflowRun => x !== null)
    .slice(0, IMPORT_RUNS_CAP);
  // r496: schedule intent imports PAUSED (mirror duplicate()): intervalMs +
  // task survive; runtime counters (failStreak/lastRunAt/nextRunAt) are
  // profile state and never cross profiles.
  const rawSchedule =
    r.schedule && typeof r.schedule === "object" ? (r.schedule as Record<string, unknown>) : null;
  const scheduleInterval =
    rawSchedule && typeof rawSchedule.intervalMs === "number" && rawSchedule.intervalMs >= 60_000
      ? rawSchedule.intervalMs
      : null;
  const schedule: WorkflowSchedule | undefined =
    rawSchedule && scheduleInterval
      ? {
          enabled: false,
          intervalMs: scheduleInterval,
          task: truncateAtWord(stripUiChipArtifacts(str(rawSchedule.task)), 500),
        }
      : undefined;
  return {
    wf: {
      id,
      name: wfName,
      description: truncateAtWord(stripUiChipArtifacts(str(r.description)), 300),
      steps,
      runs,
      createdAt: typeof r.createdAt === "number" && r.createdAt > 0 ? r.createdAt : now,
      updatedAt: now,
      ...(r.depth === "quick" || r.depth === "standard" || r.depth === "deep"
        ? { depth: r.depth as Workflow["depth"] }
        : {}),
      ...(schedule ? { schedule } : {}),
    },
    droppedSteps,
    reboundSteps,
  };
}

/** Stable identity of a workflow for import dedupe: name + ordered step identities + depth. */
function workflowFingerprint(name: string, steps: WorkflowStep[], depth?: Workflow["depth"]): string {
  const body = steps.map((s) => `${s.agentId}::${s.label}::${s.kind}`).join("|");
  return `${name.trim().toLowerCase()}#${body}#${depth ?? ""}`;
}

// ─── Evolution ledger · per-workflow novelty trajectory (r68 follow-up) ──────

/**
 * Compact novelty ledger over run history: one row per workflow that has done
 * runs, showing the last 6 done runs' novelty scores as a colored trail strip
 * (oldest → newest), a ▲/▼ delta vs the previous scored run, and the latest
 * score chip. Amber below-threshold = stall signal (Settings → Evolution, default 35%), matching the kanban 🧬 chip doctrine.
 * Self-hides when no workflow has finished a run yet.
 */
function EvolutionLedger({ workflows }: { workflows: Workflow[] }) {
  const addProposal = useWorkflowsStore((s) => s.addProposal);
  const proposals = useWorkflowsStore((s) => s.proposals);
  // r511 Tryable experiments: launcher state + the store action.
  const createLaneExperiment = useWorkflowsStore((s) => s.createLaneExperiment);
  const requestHighlight = useUiStore((s) => s.requestHighlightWorkflow);
  const [expDialogOpen, setExpDialogOpen] = React.useState(false);
  const rows = React.useMemo(
    () =>
      workflows
        .map((wf) => ({ wf, done: wf.runs.filter((r) => r.status === "done") }))
        .filter((r) => r.done.length > 0),
    [workflows]
  );

  const allScored = React.useMemo(
    () => rows.flatMap((r) => r.done.filter((x) => x.novelty != null)),
    [rows]
  );
  const avg = allScored.length
    ? Math.round(allScored.reduce((s, r) => s + (r.novelty ?? 0), 0) / allScored.length)
    : null;
  const threshold =
    useSettingsStore((s) => s.settings.noveltySpawnThreshold) ??
    NOVELTY_SPAWN_THRESHOLD;
  const stalled = allScored.filter((r) => (r.novelty ?? 0) < threshold).length;
  const isCustom = threshold !== NOVELTY_SPAWN_THRESHOLD;

  if (rows.length === 0) return null;

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden>🧬</span>
          <h3 className="text-sm font-semibold">Evolution ledger</h3>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            output novelty vs recent done runs · &lt;{threshold}% = stall
          </span>
        </div>
        {(allScored.length > 0 || isCustom) && (
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-medium">
            {isCustom && (
              <span
                title={`Custom stall rule set in Settings → Evolution (default ${NOVELTY_SPAWN_THRESHOLD}%) — stall detection and variation proposals use ${threshold}%`}
                className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-600 dark:text-violet-400"
              >
                stall &lt;{threshold}%
              </span>
            )}
            {allScored.length > 0 && (
            <span
              title={`${allScored.length} run${allScored.length === 1 ? "" : "s"} scored by the Evolution Layer (runs finish with a novelty score vs their workflow's recent output)`}
              className="rounded-full border bg-muted/40 px-2 py-0.5 text-muted-foreground"
            >
              {allScored.length} scored
            </span>
            )}
            {allScored.length > 0 && (
            <span
              title={`Average novelty across all scored runs${avg != null ? `: ${avg}%` : ""}`}
              className={cn(
                "rounded-full border px-2 py-0.5",
                avg != null && avg < threshold
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              )}
            >
              avg {avg}%
            </span>
            )}
            {allScored.length > 0 && stalled > 0 && (
              <span
                title={`${stalled} near-duplicate run${stalled === 1 ? "" : "s"} — the pipeline is treading water; widen the task or vary instructions`}
                className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-600 dark:text-amber-400"
              >
                {stalled} stalled
              </span>
            )}
          </div>
        )}
      </div>

      {/* r511 Tryable experiments launcher — header action (see dialog below). */}
      <button
        type="button"
        onClick={() => setExpDialogOpen(true)}
        title="Clone a pipeline with every step pinned to ONE fresh radar lane — run one research cycle and compare novelty against the usual lane"
        className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
      >
        <span aria-hidden>🧪</span>
        New lane experiment
      </button>

      <div className="mt-3 space-y-1.5">
        {rows.map(({ wf, done }) => {
          const latest = done[0];
          const n = latest.novelty;
          const prevScored = done.slice(1).find((r) => r.novelty != null);
          const delta =
            n != null && prevScored?.novelty != null ? n - prevScored.novelty : null;
          const trail = done.slice(0, 6).reverse(); // oldest → newest
          // ── r511 Tryable experiments: provenance chip + Δ vs the source ──
          const exp = wf.experiment;
          const expSource = exp
            ? workflows.find((w) => w.id === exp.sourceWorkflowId)
            : undefined;
          // Order-agnostic latest scored novelty (r215 doctrine) for BOTH
          // sides — the delta must not depend on insertion order.
          const expNovelty = exp ? latestScoredNovelty(wf.runs) : undefined;
          const srcNovelty = expSource ? latestScoredNovelty(expSource.runs) : undefined;
          const expDelta =
            exp != null && expNovelty != null && srcNovelty != null
              ? expNovelty - srcNovelty
              : null;
          return (
            <div
              key={wf.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{wf.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {done.length} done run{done.length === 1 ? "" : "s"}
                  {latest.finishedAt ? ` · last ${fmtRel(latest.finishedAt)}` : ""}
                </div>
                {exp && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span
                      title={`Tryable experiment pinned to ${exp.lane} — one research cycle vs the usual lane${expSource ? ` of “${expSource.name}”` : ""}`}
                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                    >
                      <span aria-hidden>🧪</span>
                      <span className="max-w-48 truncate sm:max-w-64">
                        experiment of {expSource ? expSource.name : exp.lane} · {exp.label}
                      </span>
                    </span>
                    {expDelta != null && (
                      <span
                        title="experiment vs source novelty"
                        className={cn(
                          "rounded-full border px-1.5 py-px text-[10px] font-semibold tabular-nums",
                          expDelta > 0
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : expDelta < 0
                              ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "border-stone-500/30 bg-stone-500/10 text-stone-600 dark:text-stone-400"
                        )}
                      >
                        Δ {expDelta > 0 ? "+" : ""}{expDelta}%
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {trail.map((r) => {
                  const v = r.novelty;
                  return (
                    <span
                      key={r.id}
                      title={`${fmtRel(r.startedAt)}${v != null ? ` · novelty ${v}%${v < threshold ? " — stall signal" : ""}` : " · not scored (finished before the Evolution Layer landed; re-run to score)"}`}
                      className={cn(
                        "flex h-5 min-w-8 items-center justify-center rounded px-1 text-[10px] font-medium tabular-nums",
                        v == null
                          ? "bg-muted text-muted-foreground/60"
                          : v < threshold
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      )}
                    >
                      {v != null ? v : "·"}
                    </span>
                  );
                })}
                {delta != null && delta !== 0 && (
                  <span
                    title={`${delta > 0 ? "+" : ""}${delta}% vs the previous scored run`}
                    className={cn(
                      "text-[10px] font-semibold",
                      delta > 0
                        ? "text-emerald-500"
                        : "text-amber-500"
                    )}
                  >
                    {delta > 0 ? "▲" : "▼"}
                  </span>
                )}
                <span
                  title={
                    n != null
                      ? `Evolution novelty vs recent runs: ${n}%${n < threshold ? " — stall signal (near-duplicate output)" : ""}`
                      : "Latest run finished before the Evolution Layer landed — re-run to score"
                  }
                  className={cn(
                    "ml-1 inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-semibold",
                    n == null
                      ? "text-muted-foreground"
                      : n < threshold
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  )}
                >
                  {n != null ? `🧬 ${n}%` : "not scored"}
                </span>
                {n != null && n < threshold && !proposals.some((p) => p.status === "open" && p.sourceWorkflowId === wf.id) && (
                  <button
                    title={`Propose a variation of "${wf.name}" to the Evolution Inbox — latest run stalled at ${n}%`}
                    onClick={() => {
                      // r190: feed the branch router the pipeline's proposal
                      // history so manual suggestions rotate angles too.
                      // r191: accepted proposals join their spawned pipeline's
                      // latest scored novelty (exploitation branch gets data).
                      const scoredNovelty = new Map<string, number>();
                      for (const w of workflows) {
                        const sn = latestScoredNovelty(w.runs);
                        if (sn != null) scoredNovelty.set(w.id, sn);
                      }
                      const angleHistory = buildAngleHistory(proposals, wf.id, scoredNovelty);
                      // r511 frontier seeding (manual path): same enrichment as
                      // the automatic runner path — stamp the proposal with the
                      // highest-judged seed no open proposal uses yet.
                      let proposal = buildVariationProposal({
                        sourceWorkflowId: wf.id,
                        sourceWorkflowName: wf.name,
                        sourceRunId: latest.id,
                        taskExcerpt:
                          wf.steps[0]?.instruction ||
                          wf.steps.map((s) => s.label).join(" → ") ||
                          wf.name,
                        novelty: n,
                        threshold,
                        manual: true,
                        angleHistory,
                        // r581: nexent constraint block derived from the source
                        // pipeline's own shape — the editor re-validates on spawn.
                        constraints: buildDefaultConstraints(wf.steps.length),
                      });
                      try {
                        const usedTitles = new Set(
                          proposals
                            .filter((p) => p.status === "open" && p.frontierRef)
                            .map((p) => p.frontierRef!.title)
                        );
                        // r590: AWorld eligibility — the ledger's verdict chips
                        // and census promise "Evolution embeds only reproducible
                        // seeds" (r582 doctrine), but this picker ranked by
                        // score alone and could hand Evolution a NOT-reproduced
                        // seed. Only a seed whose 4-check verdict is "reproduced"
                        // is eligible now; a plain proposal degrades otherwise.
                        const seed = readFrontierSeeds()
                          .filter((s) => s.reproduction?.verdict === "reproduced")
                          .filter((s) => !usedTitles.has(s.title))
                          .sort((a, b) => b.total - a.total)[0];
                        if (seed) {
                          const ref: FrontierSeedRef = {
                            title: seed.title,
                            url: seed.url,
                            kind: seed.kind,
                            directive: seed.seed,
                            total: seed.total,
                          };
                          proposal = withFrontierSeed(proposal, ref);
                        }
                      } catch {
                        /* seeds empty or ledger unreadable — plain proposal */
                      }
                      addProposal(proposal);
                      toast.success(
                        proposal.frontierRef
                          ? "Frontier-seeded variation proposed — waiting in the Evolution Inbox"
                          : "Variation proposed — waiting in the Evolution Inbox",
                        {
                          description: `${wf.name} · spawn it into a real pipeline with one click`,
                        }
                      );
                    }}
                    className="ml-1 inline-flex h-6 items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 text-[10px] font-semibold text-violet-600 transition-colors hover:bg-violet-500/20 dark:text-violet-400"
                  >
                    <Sparkles className="h-3 w-3" />
                    Suggest variation
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* r511 Tryable experiments launcher dialog. */}
      <LaneExperimentDialog
        open={expDialogOpen}
        onOpenChange={setExpDialogOpen}
        workflows={workflows}
      />
    </Card>
  );
}

// ─── r511 · Lane experiment launcher (owner: "Tryable experiments: pin it,
// run one research cycle through it, and compare novelty scores against the
// usual lane") ────────────────────────────────────────────────────────────

/** Store guard, mirrored for honest toasts — keep in sync with stores.ts. */
const LANE_EXPERIMENT_RE = /^[\w.\/:-]+::[\w.\/:-]+$/;
const LANE_EXPERIMENT_CAP = 3;

function LaneExperimentDialog({
  open,
  onOpenChange,
  workflows,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workflows: Workflow[];
}) {
  const createLaneExperiment = useWorkflowsStore((s) => s.createLaneExperiment);
  const requestHighlight = useUiStore((s) => s.requestHighlightWorkflow);
  // Freshest radar lanes — lane-adopt.ts reads the localStorage registry the
  // radar's auto-adopt pipeline maintains (client-side, BYOK intact).
  const [lanes, setLanes] = React.useState<AdoptedLane[]>([]);
  const [laneChoice, setLaneChoice] = React.useState(""); // "" = unset | "__custom__" | lane key
  const [customLane, setCustomLane] = React.useState("");
  const [sourceId, setSourceId] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [labelTouched, setLabelTouched] = React.useState(false);

  // (Re)hydrate on open: top-5 freshest ENABLED adopted lanes + the best
  // default source (the workflow with the most done runs — its scored trail
  // is the baseline the experiment will be compared against).
  // NOTE: intentionally depends on `open` ONLY — workflows changes identity on
  // every store patch (a live streaming run patches steps several times a
  // second), which would reset the dialog mid-typing. The default source is
  // read from the store snapshot at open-time; staleness after that is
  // harmless (it is just a default).
  React.useEffect(() => {
    if (!open) return;
    let nextLanes: AdoptedLane[] = [];
    try {
      nextLanes = enabledAdoptedLanes().slice(0, 5);
    } catch {
      /* registry unreadable — free-text fallback below */
    }
    setLanes(nextLanes);
    setLaneChoice("");
    setCustomLane("");
    setLabel("");
    setLabelTouched(false);
    const candidates = useWorkflowsStore
      .getState()
      .workflows.filter((w) => w.runs.length > 0);
    const best = candidates.reduce<Workflow | null>((acc, w) => {
      if (!acc) return w;
      const doneA = w.runs.filter((r) => r.status === "done").length;
      const doneB = acc.runs.filter((r) => r.status === "done").length;
      return doneA > doneB ? w : acc;
    }, null);
    setSourceId(best?.id ?? candidates[0]?.id ?? "");
  }, [open]);

  const runSources = workflows.filter((w) => w.runs.length > 0);
  const isCustom = laneChoice === "__custom__";
  const lane = lanes.length === 0 ? customLane.trim() : isCustom ? customLane.trim() : laneChoice;

  /** Derive the experiment label from a lane key's model segment. */
  const labelFromLane = (l: string): string => (l.split("::")[1] ?? l).trim().slice(0, 24);

  const create = () => {
    if (!lane || !sourceId) return;
    const finalLabel = (labelTouched ? label.trim() : labelFromLane(lane)) || "fresh lane";
    const id = createLaneExperiment(sourceId, lane, finalLabel);
    if (id == null) {
      // r270 doctrine: a guard that did nothing says WHICH guard failed.
      if (workflows.filter((w) => w.experiment).length >= LANE_EXPERIMENT_CAP) {
        toast.error(
          `Lane-experiment cap reached (${LANE_EXPERIMENT_CAP}) — delete or finish one of the running experiments first`
        );
      } else if (lane !== "auto::builtin" && !LANE_EXPERIMENT_RE.test(lane)) {
        toast.error(
          "That lane doesn't look like providerId::model — paste a fresh radar lane (Settings → Model relay shows your adopted chain)"
        );
      } else {
        toast.error("Source pipeline not found — pick a workflow with at least one run");
      }
      return;
    }
    const src = workflows.find((w) => w.id === sourceId);
    toast.success(
      `Lane experiment created — run it once to compare novelty vs “${src?.name ?? "the source"}”`,
      {
        description: `Every step is pinned to ${lane} · the Evolution ledger will show Δ vs the source's latest score.`,
      }
    );
    requestHighlight(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span aria-hidden>🧪</span>
            New lane experiment
          </DialogTitle>
          <DialogDescription>
            Clone a pipeline with every step pinned to ONE fresh radar lane —
            run a single research cycle and compare its novelty against the
            usual lane in the Evolution ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lane-exp-lane">Lane to try</Label>
            {lanes.length > 0 ? (
              <>
                <Select
                  value={laneChoice || undefined}
                  onValueChange={(v) => {
                    setLaneChoice(v);
                    if (!labelTouched && v !== "__custom__") setLabel(labelFromLane(v));
                  }}
                >
                  <SelectTrigger id="lane-exp-lane" className="w-full">
                    <SelectValue placeholder="Pick a fresh radar lane" />
                  </SelectTrigger>
                  <SelectContent>
                    {lanes.map((l) => (
                      <SelectItem key={l.key} value={l.key}>
                        <span className="block max-w-56 truncate sm:max-w-64" title={l.key}>
                          {l.key}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value="auto::builtin">auto::builtin — the built-in engine</SelectItem>
                    <SelectItem value="__custom__">Custom lane — paste providerId::model</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  provider::model — freshest radar lanes
                </p>
              </>
            ) : (
              <Input
                id="lane-exp-lane"
                value={customLane}
                onChange={(e) => {
                  setCustomLane(e.target.value);
                  if (!labelTouched) setLabel(labelFromLane(e.target.value));
                }}
                placeholder="providerId::model (e.g. kilo::kilo-auto/free)"
                className="w-full font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
            )}
            {(lanes.length === 0 || isCustom) && (
              <p className="text-xs text-muted-foreground">
                Paste a fresh radar lane — Settings → Model relay shows your
                adopted chain.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="lane-exp-source">Source pipeline</Label>
            <Select value={sourceId || undefined} onValueChange={setSourceId}>
              <SelectTrigger id="lane-exp-source" className="w-full">
                <SelectValue placeholder="Pick a workflow with runs" />
              </SelectTrigger>
              <SelectContent>
                {runSources.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    <span className="block max-w-56 truncate sm:max-w-64" title={w.name}>
                      {w.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {runSources.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No pipeline has a run yet — run one first; the comparison needs
                a scored baseline.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="lane-exp-label">Experiment label</Label>
            <Input
              id="lane-exp-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setLabelTouched(true);
              }}
              placeholder="e.g. mercury-3"
              maxLength={24}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Shown on the ledger row — defaults to the lane&apos;s model id.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!lane || !sourceId}>
            <span aria-hidden>🧪</span>
            Create experiment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Plan → Pipeline · one-click composer (paste a plan, get a workflow) ─────

/**
 * First line = goal; the rest = steps (bullet/numbered markers stripped).
 * r343: every line passes stripUiChipArtifacts (text copied back from our own
 * run panel carries "tag [X] ≠ worker" chips inline) and the goal is
 * word-truncated — persisted text is never torn mid-word.
 */
function parsePlan(text: string): {
  goal: string;
  steps: string[];
  overflow: number;
} {
  const lines = text
    .split("\n")
    .map((l) => stripUiChipArtifacts(l.trim()))
    .filter(Boolean);
  if (lines.length === 0) return { goal: "", steps: [], overflow: 0 };
  // r570: the goal gets the same prefix hygiene as step lines — pasting
  // "Step 1: …" as the opener used to name the workflow literally "Step 1: …".
  const goal = truncateAtWord(
    lines[0]
      .replace(/^#+\s*/, "")
      .replace(/^step\s*\d+\s*[:.]\s*/i, "")
      .trim(),
    200
  );
  const cleaned = lines
    .slice(1)
    .map((l) =>
      l
        .replace(/^(?:[-*•·]|\d+[.)])\s*/, "")
        .replace(/^step\s*\d+\s*[:.]\s*/i, "")
        .trim()
    )
    .filter(Boolean);
  // r569: the 8-step cap stops being silent — the dialog counts what the cap
  // drops, so a long plan warns instead of quietly losing its tail.
  const overflow = Math.max(0, cleaned.length - 8);
  const steps = cleaned.slice(0, 8);
  return { goal, steps, overflow };
}

function PlanPipelineDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const agents = useAgentsStore((s) => s.agents);
  const addWf = useWorkflowsStore((s) => s.add);
  const [planText, setPlanText] = React.useState("");
  const [reviewGate, setReviewGate] = React.useState(true);
  const [selected, setSelected] = React.useState<string[]>([]);

  // Default-select the whole roster (order stable) each time the dialog opens.
  React.useEffect(() => {
    if (open) setSelected(agents.map((a) => a.id));
  }, [open, agents]);

  const {
    goal,
    steps: planSteps,
    overflow: planOverflow,
  } = parsePlan(planText);
  const scaffold = planSteps.length === 0;
  const stepLines = scaffold
    ? ["Research the goal and gather context", "Draft the deliverable"]
    : planSteps;
  const canCreate = goal.length > 0 && selected.length > 0;

  // r563: concrete rotation preview — "mapped to agents in order" now NAMES
  // the agents. create() maps step i to selected[i % selected.length]; the
  // preview shows the same round-robin for the first min(steps, 3) steps,
  // with an ellipsis when the rotation continues past the preview.
  const rosterNames = selected
    .map((id) => agents.find((a) => a.id === id)?.name ?? "")
    .filter(Boolean);
  const previewCount = Math.min(stepLines.length, 3);
  // r565: the preview now NUMBERS its names — step i maps to
  // selected[i % selected.length], so the echo says which index each name
  // answers to ("1 Nexus Assistant → 2 Research Scout → …"); a long plan's
  // Owner reads the mapping without counting arrows. Indices are
  // tabular-nums + dimmed so the names stay the loudest thing in the line.
  const rotationEcho: React.ReactNode =
    rosterNames.length > 0 && planSteps.length > 0 ? (
      <>
        {" ("}
        {rosterNames.slice(0, previewCount).map((n, i) => (
          <span key={`${i}-${n}`}>
            {i > 0 ? " → " : ""}
            <span className="tabular-nums opacity-70">{i + 1}</span>{" "}
            {n}
          </span>
        ))}
        {stepLines.length > previewCount ? " → …" : ""}
        {")"}
      </>
    ) : (
      ""
    );

  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );

  const create = () => {
    if (!canCreate) return;
    const steps: WorkflowStep[] = stepLines.map((label, i) => ({
      id: uid("step"),
      agentId: selected[i % selected.length],
      label: truncateAtWord(label, 120) || `Step ${i + 1}`,
      instruction: goal,
      kind: "generate" as const,
    }));
    if (reviewGate) {
      steps.push({
        id: uid("step"),
        agentId: selected[selected.length - 1],
        label: "Review & refine",
        instruction: `Audit the final output against the goal — ${goal}. Force a rework if it falls short.`,
        kind: "review" as const,
      });
    }
    addWf({
      name: truncateAtWord(goal, 80),
      description: scaffold
        ? `Auto-composed scaffold · ${steps.length} steps`
        : `From pasted plan · ${steps.length} steps`,
      steps,
      depth: "standard",
      runs: [],
    });
    toast.success(
      `Pipeline created with ${steps.length} step${steps.length === 1 ? "" : "s"} — ready to run`
    );
    setPlanText("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-violet-400" aria-hidden />
            Plan → Pipeline
          </DialogTitle>
          <DialogDescription>
            Paste a goal or plan — the first line becomes the workflow, each
            further line becomes a step mapped across your agents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            {/* r560: live char count — long pastes (8k+ chars are the realistic
                Owner case) get an amber badge so scale is visible at a glance. */}
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="plan-text">Plan or goal</Label>
              {planText.length > 0 ? (
                <span
                  data-testid="plan-char-count"
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums transition-colors",
                    planText.length >= 4000
                      ? "border-amber-400/30 bg-amber-400/5 text-amber-400"
                      : "border-border bg-muted/40 text-muted-foreground"
                  )}
                >
                  {planText.length.toLocaleString()} chars
                </span>
              ) : null}
            </div>
            <textarea
              id="plan-text"
              value={planText}
              onChange={(e) => setPlanText(e.target.value)}
              rows={6}
              placeholder={
                "Launch a niche SaaS blog\n- Research competitor positioning\nDraft the first 3 articles\nBuild a publishing calendar"
              }
              className="w-full resize-y rounded-lg border bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground/50 focus-visible:border-violet-500/40 focus-visible:ring-2 focus-visible:ring-violet-500/20"
            />
            {goal ? (
              <p
                data-testid="plan-goal-preview"
                className="truncate text-xs text-muted-foreground"
              >
                <span className="font-medium text-violet-500/90 dark:text-violet-400/90">
                  Workflow name ·{" "}
                </span>
                {goal}
              </p>
            ) : null}
            <p
              className={cn(
                "text-xs",
                goal
                  ? planSteps.length
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                  : "text-muted-foreground/60"
              )}
            >
              {goal
                ? planSteps.length
                    ? <>✓ {planSteps.length} step{planSteps.length === 1 ? "" : "s"} detected — mapped to agents in order{rotationEcho}</>
                  : "No step lines — a Research → Draft scaffold will be composed for you"
                : "Tip: one step per line; bullets and numbering are stripped automatically"}
            </p>
            {planOverflow > 0 ? (
              <p
                data-testid="plan-step-cap"
                className="text-xs text-amber-600 dark:text-amber-400"
              >
                8-step cap — {planOverflow} more pasted{" "}
                {planOverflow === 1 ? "line" : "lines"} will not run; split the
                plan into two workflows.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>
              Agents in rotation ({selected.length}/{agents.length})
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {agents.map((a) => {
                const on = selected.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggle(a.id)}
                    aria-pressed={on}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 transition",
                      on
                        ? "border-violet-500/40 bg-violet-500/10"
                        : "border bg-muted/40 opacity-50 hover:opacity-80"
                    )}
                  >
                    <AgentAvatar agent={a} size="xs" />
                    <span className="max-w-28 truncate text-xs font-medium">
                      {a.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="review-gate"
              checked={reviewGate}
              onCheckedChange={(v) => setReviewGate(v === true)}
            />
            <Label
              htmlFor="review-gate"
              className="cursor-pointer text-sm font-normal text-muted-foreground"
            >
              Append a review gate step (audits the final output, forces rework)
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!canCreate}>
            <Wand2 className="h-4 w-4" />
            Create pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Evolution Inbox · pipeline-born spawn proposals ───────────────────────

/** Compact relative time for inbox rows ("just now", "5m ago", "3h ago", date fallback). */
function proposalAge(ts: number): string {
  const dt = Date.now() - ts;
  if (dt < 60_000) return "just now";
  if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function EvolutionInbox() {
  const proposals = useWorkflowsStore((s) => s.proposals);
  const setProposalStatus = useWorkflowsStore((s) => s.setProposalStatus);
  const agents = useAgentsStore((s) => s.agents);
  const addWf = useWorkflowsStore((s) => s.add);
  const clearProposals = useWorkflowsStore((s) => s.clearProposals);
  const requestHighlight = useUiStore((s) => s.requestHighlightWorkflow);
  const threshold =
    useSettingsStore((s) => s.settings.noveltySpawnThreshold) ??
    NOVELTY_SPAWN_THRESHOLD;
  const [showArchive, setShowArchive] = React.useState(false);
  const [archiveFilter, setArchiveFilter] = React.useState<"all" | "accepted" | "dismissed">("all");
  const [confirmClear, setConfirmClear] = React.useState(false);

  const open = proposals.filter((p) => p.status === "open");
  const acceptedCount = proposals.filter((p) => p.status === "accepted").length;
  const dismissedCount = proposals.filter((p) => p.status === "dismissed").length;

  // Inbox clear? Keep a muted cycle summary instead of vanishing — the strip
  // teaches the loop and expands into an archive of handled proposals.
  if (open.length === 0) {
    if (acceptedCount + dismissedCount === 0)
      // r574: the true-zero state used to VANISH the card entirely — a fresh
      // install saw nothing where the inbox lives. The empty state now always
      // explains itself (census family: dashed = empty state).
      return (
        <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.03] p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Lightbulb className="h-4 w-4 shrink-0 text-violet-500" />
            <span className="text-sm font-medium">Evolution Inbox</span>
            <span className="rounded-md border border-violet-500/30 bg-violet-500/5 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-violet-600 dark:text-violet-400">
              0 proposals
            </span>
            <span className="text-xs text-muted-foreground">
              pipelines suggested by your workflows — spawn or dismiss
            </span>
          </div>
          <div
            data-testid="evo-inbox-empty"
            className="rounded-md border border-dashed border-violet-500/30 bg-violet-500/5 px-2.5 py-2"
          >
            <p className="text-[10.5px] text-muted-foreground">
              No open proposals — Suggest variation on any workflow card seeds
              one; decided spawns live in Evolution history.
            </p>
          </div>
        </div>
      );
    const handled = proposals
      .filter((p) => p.status !== "open")
      .sort((a, b) => b.createdAt - a.createdAt);
    const history =
      archiveFilter === "all"
        ? handled
        : handled.filter((p) => p.status === archiveFilter);
    return (
      <div className="mb-4 rounded-xl border border-violet-500/15 bg-violet-500/[0.03] p-3">
        <button
          onClick={() => setShowArchive((v) => !v)}
          aria-expanded={showArchive}
          aria-label="Toggle Evolution proposal archive"
          className="flex w-full items-center gap-2 text-left"
        >
          <Lightbulb className="h-3.5 w-3.5 shrink-0 text-violet-500/70" />
          <span className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
            Evolution cycle:{" "}
            <span className="font-medium text-foreground/80">
              {acceptedCount} spawned
            </span>
            {dismissedCount > 0 && <> · {dismissedCount} dismissed</>} — inbox
            clear. New proposals appear here automatically when runs stall
            (&lt;{threshold}% novelty) or via{" "}
            <span className="font-medium text-foreground/80">
              Suggest variation
            </span>{" "}
            in the ledger.
          </span>
          <span className="shrink-0 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 transition-colors hover:bg-violet-500/20 dark:text-violet-400">
            {showArchive ? "Hide history" : `History (${handled.length})`}
          </span>
        </button>
        {showArchive && (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {(
                [
                  ["all", `All (${handled.length})`],
                  ["accepted", `Spawned (${acceptedCount})`],
                  ["dismissed", `Dismissed (${dismissedCount})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setArchiveFilter(key)}
                  aria-pressed={archiveFilter === key}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                    archiveFilter === key
                      ? "border-violet-500/40 bg-violet-500/15 text-violet-600 dark:text-violet-400"
                      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
                  )}
                >
                  {label}
                </button>
              ))}
              <span className="flex-1" />
              <button
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true);
                    return;
                  }
                  clearProposals();
                  setConfirmClear(false);
                  setShowArchive(false);
                  toast.success("Evolution history cleared — open proposals (if any) are kept");
                }}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                  confirmClear
                    ? "border-red-500/40 bg-red-500/15 text-red-600 dark:text-red-400"
                    : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/60"
                )}
              >
                {confirmClear ? "Really clear?" : "Clear history"}
              </button>
            </div>
            <div className="mt-1.5 space-y-1.5">
              {history.length === 0 ? (
                <p className="rounded-lg border bg-background/60 px-2.5 py-2 text-xs text-muted-foreground">
                  Nothing here for this filter yet.
                </p>
              ) : (
                history.slice(0, 8).map((p) => {
                  const spawnedId = p.spawnedWorkflowId;
                  const linkable = p.status === "accepted" && !!spawnedId;
                  const rowInner = (
                    <>
                      {p.status === "accepted" ? (
                        <Sparkles className="h-3 w-3 shrink-0 text-violet-500" aria-hidden />
                      ) : (
                        <X className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-hidden />
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs">{p.goal}</span>
                      {(p.planLines?.length ?? 0) > 0 ? (
                        <span
                          data-testid="proposal-plan-size"
                          className={cn(
                            "shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums",
                            (p.planLines?.length ?? 0) > 8
                              ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
                              : "border-violet-500/30 bg-violet-500/5 text-violet-600 dark:text-violet-400"
                          )}
                        >
                          {p.planLines?.length} lines
                        </span>
                      ) : null}
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        from {p.sourceWorkflowName} · {proposalAge(p.createdAt)}
                      </span>
                      {linkable && (
                        <span
                          className="shrink-0 text-[10px] font-semibold text-violet-400/80"
                          aria-hidden
                        >
                          ↗
                        </span>
                      )}
                    </>
                  );
                  return linkable ? (
                    <button
                      key={p.id}
                      title="Jump to the spawned pipeline"
                      onClick={() => {
                        if (spawnedId) requestHighlight(spawnedId);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg border bg-background/60 px-2.5 py-1.5 text-left transition-colors hover:border-violet-500/40 hover:bg-violet-500/[0.06]"
                    >
                      {rowInner}
                    </button>
                  ) : (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 rounded-lg border bg-background/60 px-2.5 py-1.5"
                    >
                      {rowInner}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  const accept = (p: SpawnProposal) => {
    const roster = agents.map((a) => a.id);
    if (roster.length === 0) {
      toast.error("No agents in the roster — create an agent first");
      return;
    }
    const parsed = parsePlan([p.goal, ...(p.planLines ?? [])].join("\n"));
    // r571: the spawn path had the same silent 8-step cap the paste dialog
    // outgrew in r569 — a proposal with more than 8 plan lines lost its tail
    // without a word. The spawn now reads the overflow and says so.
    const overflow = parsed.overflow;
    const capNote =
      overflow > 0
        ? ` · 8-step cap — ${overflow} more proposal line${overflow === 1 ? "" : "s"} will not run`
        : "";
    // r581: the editor VALIDATES the proposal's nexent constraint block before
    // spawning — a stale/tampered block (persisted localStorage, older schema)
    // refuses to spawn with the first violation cited. A valid block bounds the
    // WHOLE spawned pipeline, review gate included: generated lines are sliced
    // to leave room for the review step, so the spawn never exceeds the cap.
    let constraintCap: number | null = null;
    if (p.constraints != null) {
      const v = validateConstraintBlock(p.constraints);
      if (!v.ok) {
        toast.error(`Constraint block failed validation — not spawning: ${v.violations[0]}`);
        return;
      }
      constraintCap = v.block?.stepCap ?? null;
    }
    const baseLines = parsed.steps.length
      ? parsed.steps
      : ["Research the goal and gather context", "Draft the deliverable"];
    const stepLines =
      constraintCap != null
        ? baseLines.slice(0, Math.max(1, constraintCap - 1))
        : baseLines;
    const constraintNote =
      constraintCap != null && baseLines.length > stepLines.length
        ? ` · constraint cap ${constraintCap} steps — ${baseLines.length - stepLines.length} more line${baseLines.length - stepLines.length === 1 ? "" : "s"} not run`
        : "";
    const steps: WorkflowStep[] = stepLines.map((label, i) => ({
      id: uid("step"),
      agentId: roster[i % roster.length],
      label: truncateAtWord(label, 120) || `Step ${i + 1}`,
      instruction: parsed.goal,
      kind: "generate" as const,
    }));
    steps.push({
      id: uid("step"),
      agentId: roster[roster.length - 1],
      label: "Review & refine",
      instruction: `Audit the final output against the goal — ${parsed.goal}. Force a rework if it falls short.`,
      kind: "review" as const,
    });
    const spawnedId = uid("wf");
    // (parsed.goal is already chip-stripped and word-truncated by parsePlan.)
    addWf({
      id: spawnedId,
      name: truncateAtWord(parsed.goal, 80),
      description: `Evolution spawn · from "${p.sourceWorkflowName}" · ${p.reason}${capNote}${constraintNote}`,
      steps,
      depth: "standard",
      runs: [],
      // r203: structured lineage — the accept-time decision evidence
      // (router reason with numbers) travels with the workflow, so the
      // card chip can cite it long after the inbox row is gone.
      evolution: {
        proposalId: p.id,
        sourceWorkflowId: p.sourceWorkflowId,
        sourceWorkflowName: p.sourceWorkflowName,
        reason: p.reason,
        acceptedAt: Date.now(),
      },
    });
    setProposalStatus(p.id, "accepted", spawnedId);
    if (overflow > 0) {
      toast.warning(
        `Spawned "${parsed.goal.slice(0, 80)}" with ${steps.length} steps — the 8-step cap dropped ${overflow} more proposal line${overflow === 1 ? "" : "s"}`
      );
    } else {
      toast.success(
        `Spawned "${parsed.goal.slice(0, 80)}" with ${steps.length} steps — review gate included`
      );
    }
  };

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Lightbulb className="h-4 w-4 shrink-0 text-violet-500" />
        <span className="text-sm font-medium">Evolution Inbox</span>
        <span className="rounded-md border border-violet-500/30 bg-violet-500/5 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-violet-600 dark:text-violet-400">
          {open.length} proposal{open.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-muted-foreground">
          pipelines suggested by your workflows — spawn or dismiss
        </span>
      </div>
      <div className="space-y-2">
        {open.map((p) => (
          <div
            key={p.id}
            className="flex items-start gap-3 rounded-lg border bg-background/60 p-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">{p.goal}</p>
                {(p.planLines?.length ?? 0) > 0 ? (
                  <span
                    data-testid="proposal-plan-size"
                    className={cn(
                      "shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums",
                      (p.planLines?.length ?? 0) > 8
                        ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
                        : "border-violet-500/30 bg-violet-500/5 text-violet-600 dark:text-violet-400"
                    )}
                  >
                    {p.planLines?.length} lines
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {p.reason} · from{" "}
                <span className="font-medium text-foreground/80">
                  {p.sourceWorkflowName}
                </span>{" "}
                ·{" "}
                <span
                  className="ml-0.5 inline-flex items-center rounded-md border border-violet-500/30 bg-violet-500/5 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-violet-600 dark:text-violet-400"
                  title={new Date(p.createdAt).toLocaleString()}
                >
                  {proposalAge(p.createdAt)}
                </span>
              </p>
              {/* r581: the nexent constraint block, visible — a valid block renders
                  its bounds as one emerald chip; a stale/tampered one renders an
                  honest amber refusal BEFORE the Spawn button is trusted. */}
              {p.constraints != null &&
                (() => {
                  const v = validateConstraintBlock(p.constraints);
                  return v.ok && v.block ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span
                        data-testid="proposal-constraints"
                        className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                        title={`nexent constraint block — the editor validates this before spawning · ${formatConstraintBlock(v.block)}`}
                      >
                        bound · {formatConstraintBlock(v.block)}
                      </span>
                      <span className="text-[10px] text-stone-500 dark:text-stone-400">constraint-bound</span>
                    </div>
                  ) : (
                    <div className="mt-1 flex min-w-0 items-center gap-1.5">
                      <span
                        data-testid="proposal-constraints-invalid"
                        className="inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-600 dark:text-amber-400"
                        title={v.violations.join("; ")}
                      >
                        constraints invalid — spawn refused
                      </span>
                    </div>
                  );
                })()}
              {/* r511: a frontier-seeded proposal cites its source paper/repo —
                  one compact link line, the row stays spawn-first. */}
              {p.frontierRef && (
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px]">
                  <a
                    href={p.frontierRef.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open the ${p.frontierRef.kind} this proposal was inspired by: ${p.frontierRef.title}`}
                    className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border bg-muted/40 px-1.5 py-px font-medium text-foreground/80 transition-colors hover:bg-muted/70"
                  >
                    <span aria-hidden>🔬</span>
                    <span className="max-w-48 truncate sm:max-w-72">{p.frontierRef.title}</span>
                  </a>
                  <span className="shrink-0 text-stone-500 dark:text-stone-400">
                    frontier-seeded
                  </span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="sm"
                onClick={() => accept(p)}
                aria-label={`Spawn pipeline from proposal: ${p.goal}`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Spawn
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Dismiss proposal: ${p.goal}`}
                onClick={() => {
                  setProposalStatus(p.id, "dismissed");
                  toast("Proposal dismissed — archived in Evolution history");
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Workflow Studio · grid of pipelines, editor dialog + run panel ─────────

export function WorkflowsView() {
  const workflows = useWorkflowsStore((s) => s.workflows);
  const agents = useAgentsStore((s) => s.agents);
  const addWf = useWorkflowsStore((s) => s.add);
  const duplicateWf = useWorkflowsStore((s) => s.duplicate);
  const removeWf = useWorkflowsStore((s) => s.remove);
  const updateWf = useWorkflowsStore((s) => s.update);

  // Keep schedule countdowns honest (cheap re-render every 30s when needed)
  const hasSchedules = workflows.some((w) => w.schedule?.enabled);
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!hasSchedules) return;
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [hasSchedules, tick]);

  const activeSchedules = workflows.filter(
    (w) => w.schedule?.enabled && w.steps.length > 0
  ).length;

  // r81: live-run visibility. Scheduled runs execute entirely outside this
  // view (the scheduler calls the runner fire-and-forget), so cards looked
  // stale/dead while their pipelines ran — the user had no way to see a
  // scheduled run in flight without opening run history. The runner writes
  // addRun/patchRunStep to the store reactively, so deriving from runs[]
  // gives live badges for ANY trigger; r25's zombie cleanup keeps reload
  // orphans from faking a live state.
  const liveRunCount = workflows.filter((w) =>
    w.runs.some((r) => r.status === "running")
  ).length;

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [planOpen, setPlanOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Workflow | null>(null);
  const [runOpen, setRunOpen] = React.useState(false);
  const [running, setRunning] = React.useState<Workflow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Workflow | null>(null);
  const [pendingRunFocus, setPendingRunFocus] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Grid ↔ board layout toggle (persisted in the ui store)
  const boardOpen = useUiStore((s) => s.workflowBoardOpen);
  const setBoardOpen = useUiStore((s) => s.setWorkflowBoardOpen);
  // r486-a: the third tab — Run Archive (localStorage tier, browsable/exportable).
  const [archiveOpen, setArchiveOpen] = React.useState(false);

  const agentById = React.useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents]
  );

  // r237: pipeline search — the studio had no way to find a pipeline beyond
  // eyeballing cards (the only filters lived inside the Evolution inbox).
  // One lowercase needle matches name, description, step labels, step
  // instructions, the resolved agent names and — since r238 — the schedule
  // task text; the memo keeps typing cheap even with large rosters, and an
  // empty needle short-circuits to the full list so the grid identity is
  // stable when search is idle.
  const [query, setQuery] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const filteredWorkflows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workflows;
    return workflows.filter((wf) => {
      if (
        wf.name.toLowerCase().includes(q) ||
        wf.description.toLowerCase().includes(q) ||
        // r238: a recurring pipeline's "what it does" lives in
        // schedule.task ("routine every 1 hour for improved reports…"),
        // which no other field carries — search it so a schedule is
        // findable by intent, not just by its name.
        (wf.schedule?.task ?? "").toLowerCase().includes(q)
      )
        return true;
      return wf.steps.some((s) => {
        const agentName = agentById.get(s.agentId)?.name ?? "";
        return (
          s.label.toLowerCase().includes(q) ||
          (s.instruction ?? "").toLowerCase().includes(q) ||
          agentName.toLowerCase().includes(q)
        );
      });
    });
  }, [workflows, query, agentById]);

  // "/" focuses the search box while Workflow Studio is on screen. This view
  // mounts only when active (page.tsx renders it conditionally), so the
  // window listener can't leak into Chat/Agents — and the target guard keeps
  // typing inside any input, textarea, select or contenteditable from
  // triggering it.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // r125: provider health — resolve the active brain ONCE per view (every card
  // runs through the same engine). The resolver is the single source of truth,
  // so the chip can never drift from what a run will actually do: a selected
  // provider without a key shows the amber fallback the resolver will take,
  // custom-with-key shows freshness from validatedAt, auto shows Built-in.
  const settings = useSettingsStore((s) => s.settings);
  const llm = React.useMemo(() => resolveLlm(settings), [settings]);
  const openProviders = React.useCallback(() => {
    useUiStore.getState().setView("settings");
    useUiStore.getState().setSettingsAnchor("providers");
  }, []);
  const openVault = React.useCallback(() => {
    useUiStore.getState().setView("settings");
    useUiStore.getState().setSettingsAnchor("vault");
  }, []);

  // Headless-lane readiness: only relevant while schedules exist (closed-tab
  // runs dial the server lane). One masked GET — no keys cross the wire.
  const [builtinVaultReady, setBuiltinVaultReady] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    if (activeSchedules === 0) return;
    let alive = true;
    fetch("/api/vault", { headers: { "x-nexus-csrf": "1" } })
      .then((r) => r.json())
      .then((j: { vault?: { provider: string }[] }) => {
        if (alive)
          setBuiltinVaultReady(
            Array.isArray(j.vault) && j.vault.some((s) => s.provider === "builtin")
          );
      })
      .catch(() => {
        if (alive) setBuiltinVaultReady(null); // server briefly down — show nothing
      });
    return () => {
      alive = false;
    };
  }, [activeSchedules]);

  // Evolution archive rows can spotlight the pipeline a proposal spawned
  const highlightId = useUiStore((s) => s.highlightWorkflowId);
  // Active stall rule for card-level novelty trails (Settings → Evolution).
  const noveltyThreshold =
    useSettingsStore((s) => s.settings.noveltySpawnThreshold) ??
    NOVELTY_SPAWN_THRESHOLD;
  const clearHighlight = useUiStore((s) => s.clearHighlightWorkflow);
  React.useEffect(() => {
    if (!highlightId) return;
    document
      .querySelector(`[data-wf-card="${highlightId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => clearHighlight(), 2600);
    return () => clearTimeout(t);
  }, [highlightId, clearHighlight]);

  // The command palette (⌘K) can request a workflow run from anywhere
  const pendingRunId = useUiStore((s) => s.pendingRunWorkflowId);
  const clearPendingRun = useUiStore((s) => s.clearPendingRunWorkflow);
  React.useEffect(() => {
    if (!pendingRunId) return;
    const wf = useWorkflowsStore.getState().workflows.find((w) => w.id === pendingRunId);
    clearPendingRun();
    if (wf && wf.steps.length > 0) {
      setRunning(wf);
      setRunOpen(true);
    } else if (wf) {
      toast.error(`“${wf.name}” has no steps yet — add agents first.`, {
        action: {
          label: "Edit",
          onClick: () => {
            setEditing(wf);
            setEditorOpen(true);
          },
        },
      });
    }
  }, [pendingRunId, clearPendingRun]);

  const openNew = React.useCallback(() => {
    setEditing(null);
    setEditorOpen(true);
  }, []);

  const openEdit = React.useCallback((wf: Workflow) => {
    setEditing(wf);
    setEditorOpen(true);
  }, []);

  const openRun = React.useCallback((wf: Workflow) => {
    setRunning(wf);
    setPendingRunFocus(null);
    setRunOpen(true);
  }, []);

  /** Kanban card → open the run panel on that specific run. */
  const openRunFromBoard = React.useCallback((workflowId: string, runId?: string) => {
    const wf = useWorkflowsStore.getState().workflows.find((w) => w.id === workflowId);
    if (!wf) {
      // Stale kanban card (workflow deleted elsewhere between render and
      // click) — r270 doctrine: an action that did nothing must SAY so,
      // never a silent no-op. Re-applies r286's fix (lost to the rollback).
      toast.error("That pipeline no longer exists — refresh to sync the board.");
      return;
    }
    setRunning(wf);
    setPendingRunFocus(runId ?? null);
    setRunOpen(true);
  }, []);

  // ── r197 directive (d): scheduler health backed by event IDs ──────────
  // The green badge states the schedule's PROMISE ("next in 5m"). This
  // helper derives the EVIDENCE from run events: when the last scheduled
  // fire actually happened and whether it succeeded. A schedule promising a
  // fire every 15m whose newest scheduled event is 4h old has a stalled
  // lane (background-tab HMR death, system sleep) — the exact silent
  // failure class r189-r192 fight, now visible from the card itself.
  type ScheduleEvidence = {
    tone: "missed" | "failing" | "ok";
    label: string;
    detail: string;
  };

  function scheduleEvidence(wf: Workflow, now: number): ScheduleEvidence | null {
    const sched = wf.schedule;
    if (!sched || !sched.enabled) return null;
    // Runs are newest-first (store caps at 12) — the first source-stamped
    // scheduled run is the newest scheduled event.
    const lastFire = wf.runs.find((r) => r.source === "scheduled");
    const interval = Math.max(sched.intervalMs, 60_000);
    const missedAfter = Math.max(interval * 3, 15 * 60_000);
    const lastFireAt = lastFire?.startedAt ?? sched.lastRunAt;
    const age = lastFireAt != null ? now - lastFireAt : null;
    const agoLabel =
      age == null
        ? null
        : (age >= 120 * 60_000
            ? `${Math.round(age / 3_600_000)}h`
            : `${Math.max(0, Math.round(age / 60_000))}m`);
    if (age != null && age > missedAfter) {
      return {
        tone: "missed",
        label: `no fire in ${agoLabel}`,
        detail: `Interval promises a fire every ${fmtIntervalShort(interval)} but the newest scheduled event is ${agoLabel} old${
          lastFire
            ? ` (run ${lastFire.id} · ${new Date(lastFire.startedAt).toLocaleTimeString()} · ${lastFire.status})`
            : " (schedule.lastRunAt only — pre-r197 history carries no event provenance)"
        }. If this tab is open, the scheduler lane is stalled: background-tab HMR death, system sleep, or a run blocking the queue. Check the amber App-updated pill and refresh.`,
      };
    }
    if (lastFire) {
      const failed = lastFire.status === "error" || lastFire.status === "blocked";
      const when = `run ${lastFire.id} · ${new Date(lastFire.startedAt).toLocaleTimeString()} · ${lastFire.status}`;
      if (failed) {
        return {
          tone: "failing",
          label: `last fire ${agoLabel} ago · ${lastFire.status}`,
          detail: `Evidence: ${when}.${
            lastFire.error?.message ? ` ${lastFire.error.message.slice(0, 140)}` : ""
          }${(sched.failStreak ?? 0) >= 2 ? ` ${sched.failStreak} consecutive failures.` : ""}`,
        };
      }
      return {
        tone: "ok",
        label: `last fire ${agoLabel} ago · ${lastFire.status}`,
        detail: `Evidence: ${when}. The schedule's promise ("next ${fmtIn(sched.nextRunAt)}") is backed by a real event.`,
      };
    }
    return null; // no evidence at all — freshly scheduled or history wiped
  }

  /** One-click resume for an auto-paused schedule (inverse of the runner's failStreak auto-pause). */
  const resumeSchedule = (wf: Workflow) => {
    if (!wf.schedule) return;
    updateWf(wf.id, {
      // r171: clearing autoResumeAt here is the stale-flag safety half of the
      // congestion auto-resume — a manual resume must never be later
      // resurrected by a leftover backoff timestamp.
      schedule: { ...wf.schedule, enabled: true, failStreak: 0, autoResumeAt: undefined, autoResumeTrips: 0, nextRunAt: undefined },
    });
    toast.success(`Schedule resumed — "${wf.name}" fires on the next tick`, {
      description: "Failure counter reset · the scheduler re-arms from now",
    });
  };

  // r192: board-level breaker visibility — the per-card red chip is easy to
  // miss when a relay lane goes down and parks several schedules at once; the
  // board then "stops working" with no top-level explanation. The banner is
  // self-limiting: it exists only while a breaker pause is real, and any
  // resume (chip or bulk) clears it — no dismiss button hiding live state.
  const breakerPaused = workflows.filter(
    (wf) => wf.schedule && !wf.schedule.enabled && wf.schedule.autoResumeAt == null && (wf.schedule.failStreak ?? 0) >= 2
  );
  const congestionBackoff = workflows.filter(
    (wf) => wf.schedule && !wf.schedule.enabled && wf.schedule.autoResumeAt != null
  );
  const resumeAllPaused = () => {
    const n = breakerPaused.length;
    breakerPaused.forEach((wf) => {
      if (!wf.schedule) return;
      updateWf(wf.id, {
        schedule: { ...wf.schedule, enabled: true, failStreak: 0, autoResumeAt: undefined, autoResumeTrips: 0, nextRunAt: undefined },
      });
    });
    toast.success(`Resumed ${n} schedule${n === 1 ? "" : "s"} — failure counters reset, firing on the next tick`);
  };

  // r77: schedule deferral audit — the historical half of the amber
  // "blocked by run" chip (see lib/schedule-skips.ts). Parsed per render;
  // the trail is ≤20 tiny entries, so this is cheaper than memo plumbing.
  const lastSkipFor = (id: string) => {
    const list = readScheduleSkips().filter((e) => e.id === id);
    return list.length > 0 ? list[list.length - 1] : undefined;
  };

  const handleDuplicate = (wf: Workflow) => {
    // duplicateWf returns null when the workflow is already gone from the
    // store (another tab deleted it between render and click) — r270 doctrine:
    // an action that did nothing must SAY so. Re-applies r286's fix (lost to
    // the sandbox rollback); mirrors the r287 agents duplicate toast verbatim.
    const id = duplicateWf(wf.id);
    if (id) toast.success(`Duplicated "${wf.name}"`);
    else
      toast.error(
        `Could not duplicate "${wf.name}" — it no longer exists. Refresh to sync.`
      );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    removeWf(deleteTarget.id);
    toast.success(`Deleted "${deleteTarget.name}"`);
    setDeleteTarget(null);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { workflows?: unknown }).workflows)
          ? (parsed as { workflows: unknown[] }).workflows
          : null;
      // Structural validation only — no `kind` gate, so both NEXUS exports
      // (kind "nexus-workflows") and legacy pre-rebrand exports (kind
      // "praison-workflows" / praisonai-export.json) import unchanged.
      if (!list) {
        toast.error("Invalid workflow file", {
          description: "Expected a workflows array or a NEXUS export.",
        });
        return;
      }
      const validAgentIds = new Set(useAgentsStore.getState().agents.map((a) => a.id));
      // r495: name→id index for portable-pack rebinds (pack steps carry agentName).
      const agentNameIndex = new Map(
        useAgentsStore.getState().agents.map((a) => [a.name.trim().toLowerCase(), a.id] as const)
      );
      const results = list.map((w) => sanitizeWorkflow(w, validAgentIds, agentNameIndex));
      const imported = results.filter(
        (x): x is { wf: Workflow; droppedSteps: number; reboundSteps: number } => x !== null
      );
      const wfs = imported.map((x) => x.wf);
      // r448: steps dropped inside surviving workflows are part of the import
      // receipt now — silent truncation also defeated fingerprint dedupe.
      const droppedSteps = imported.reduce((n, x) => n + x.droppedSteps, 0);
      const reboundSteps = imported.reduce((n, x) => n + x.reboundSteps, 0);
      if (imported.length === 0) {
        toast.error("No usable workflows found", {
          description: "Workflows need a name and at least one step whose agent exists in your roster.",
        });
        return;
      }
      // r88: dedupe against the roster and within the file itself. An identical
      // twin (same name + same ordered steps + same depth) is skipped; a name
      // collision with different content imports as "<name> (imported)".
      const existing = useWorkflowsStore.getState().workflows;
      const seenFingerprints = new Set(
        existing.map((w) => workflowFingerprint(w.name, w.steps, w.depth))
      );
      const takenNames = new Set(existing.map((w) => w.name.toLowerCase()));
      const renameCounters = new Map<string, number>();
      let dupes = 0;
      let renamed = 0;
      const toAdd: Workflow[] = [];
      for (const w of wfs) {
        const fp = workflowFingerprint(w.name, w.steps, w.depth);
        if (seenFingerprints.has(fp)) {
          dupes++;
          continue;
        }
        seenFingerprints.add(fp);
        if (takenNames.has(w.name.toLowerCase())) {
          const base = w.name;
          let n = renameCounters.get(base.toLowerCase()) ?? 0;
          let candidate = `${base} (imported${n > 0 ? ` ${n + 1}` : ""})`;
          while (takenNames.has(candidate.toLowerCase())) {
            n++;
            candidate = `${base} (imported ${n + 1})`;
          }
          renameCounters.set(base.toLowerCase(), n);
          toAdd.push({ ...w, name: candidate.slice(0, 80) });
          takenNames.add(candidate.toLowerCase());
          renamed++;
        } else {
          toAdd.push(w);
          takenNames.add(w.name.toLowerCase());
        }
      }
      for (const w of toAdd) addWf(w);
      // r496: the receipt counts what the full pack actually restored — run
      // history and paused schedules are the payload the owner asked for.
      const restoredRuns = toAdd.reduce((n, w) => n + w.runs.length, 0);
      const pausedSchedules = toAdd.filter((w) => w.schedule).length;
      const skipped = list.length - imported.length;
      if (toAdd.length === 0 && dupes > 0) {
        toast.info(
          `All ${dupes} workflow${dupes === 1 ? "" : "s"} already exist — nothing imported.`
        );
      } else {
        toast.success(
          `Imported ${toAdd.length} workflow${toAdd.length === 1 ? "" : "s"}` +
            (restoredRuns > 0
              ? ` · ${restoredRuns} run${restoredRuns === 1 ? "" : "s"} restored`
              : "") +
            (pausedSchedules > 0
              ? ` · ${pausedSchedules} schedule${pausedSchedules === 1 ? "" : "s"} imported paused`
              : "") +
            (dupes > 0 ? ` · ${dupes} duplicate${dupes === 1 ? "" : "s"} skipped` : "") +
            (renamed > 0 ? ` · ${renamed} renamed to avoid a clash` : "") +
            (droppedSteps > 0
              ? ` · ${droppedSteps} step${droppedSteps === 1 ? "" : "s"} skipped (no usable agent)`
              : "") +
            (reboundSteps > 0
              ? ` · ${reboundSteps} step${reboundSteps === 1 ? "" : "s"} rebound by agent name`
              : "") +
            (skipped > 0 ? ` (${skipped} skipped — unusable)` : "")
        );
      }
    } catch {
      toast.error("Could not read that file as JSON.");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Workflow Studio"
        description="Chain agents into sequential multi-agent pipelines"
      >
        {activeSchedules > 0 && (
          <span
            title={`${activeSchedules} workflow${activeSchedules === 1 ? "" : "s"} on a recurring schedule`}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {activeSchedules} scheduled
          </span>
        )}
        {liveRunCount > 0 && (
          <span
            title={`${liveRunCount} pipeline${liveRunCount === 1 ? "" : "s"} executing right now (manual or scheduled trigger)`}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
          >
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {liveRunCount} running
          </span>
        )}
        <div
          role="radiogroup"
          aria-label="Layout"
          className="flex overflow-hidden rounded-lg border"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!boardOpen && !archiveOpen}
            aria-label="Card grid layout"
            title="Card grid"
            onClick={() => {
              setBoardOpen(false);
              setArchiveOpen(false);
            }}
            className={cn(
              "flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors",
              !boardOpen && !archiveOpen
                ? "bg-violet-500/15 text-violet-500 dark:text-violet-400"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <LayoutList className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Pipelines</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={boardOpen && !archiveOpen}
            aria-label="Runs board layout"
            title="Runs board"
            onClick={() => {
              setBoardOpen(true);
              setArchiveOpen(false);
            }}
            className={cn(
              "flex h-8 items-center gap-1.5 border-l px-2.5 text-xs font-medium transition-colors",
              boardOpen && !archiveOpen
                ? "bg-violet-500/15 text-violet-500 dark:text-violet-400"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <Columns3 className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Runs board</span>
          </button>
          {/* r486-a: Run Archive — every settled run's full step log lands here
              automatically; browse, search, batch-export, prune. */}
          <button
            type="button"
            role="radio"
            aria-checked={archiveOpen}
            aria-label="Run archive"
            title="Run archive — browse and batch-download every run's conversation log"
            onClick={() => setArchiveOpen(true)}
            className={cn(
              "flex h-8 items-center gap-1.5 border-l px-2.5 text-xs font-medium transition-colors",
              archiveOpen
                ? "bg-violet-500/15 text-violet-500 dark:text-violet-400"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <Archive className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Archive</span>
          </button>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={agents.length === 0}
          onClick={() => setPlanOpen(true)}
          aria-label="Create a pipeline from a pasted plan"
          title="Paste a plan — one click composes a pipeline across your agents"
        >
          <Wand2 className="h-4 w-4" />
          <span className="hidden md:inline">Plan → Pipeline</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Import workflows"
        >
          <Upload className="h-4 w-4" />
          <span className="hidden sm:inline">Import</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={workflows.length === 0}
              aria-label="Export workflows"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onClick={() => exportWorkflows(workflows, "definitions")}>
              <Download className="h-4 w-4" />
              <span className="flex min-w-0 flex-col">
                <span>Definitions only</span>
                <span className="text-xs text-muted-foreground">
                  Portable pipeline JSON — small, no history
                </span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportWorkflows(workflows, "full")}>
              <Archive className="h-4 w-4" />
              <span className="flex min-w-0 flex-col">
                <span>Full pack — with runs</span>
                <span className="text-xs text-muted-foreground">
                  History, outputs, schedules — one archive file
                </span>
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" onClick={openNew} aria-label="New Workflow">
          <Plus className="h-4 w-4" />
          New Workflow
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void handleImportFile(e)}
          aria-hidden
          tabIndex={-1}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <GatewayPulse />
        <div className="mb-4">
          <ServerAutopilot />
        </div>
        <div className="mb-4">
          <StrategyCard />
        </div>
        {agents.length === 0 ? (
          <Alert className="mb-4 border-violet-500/30 bg-violet-500/5">
            <Users className="h-4 w-4 text-violet-400" />
            <AlertTitle>You need at least one agent to build workflows</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-muted-foreground">
                Agents are the workers of a pipeline — create them first, then compose steps.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => useUiStore.getState().setView("agents")}
              >
                Go to Agents
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <EvolutionInbox />
        <EvolutionLedger workflows={workflows} />

        {!boardOpen && !archiveOpen && workflows.length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  // r245 IME parity: don't clear the query while a CJK
                  // composition is active — that Escape cancels the IME.
                  if (e.key === "Escape" && query && !e.nativeEvent.isComposing) setQuery("");
                }}
                placeholder="Search pipelines, agents, steps, schedules…"
                aria-label="Search pipelines"
                className="h-8 pl-8 pr-8 text-xs"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear pipeline search"
                  title="Clear search (Esc)"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : (
                <kbd
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground"
                  aria-hidden
                >
                  /
                </kbd>
              )}
            </div>
            {query.trim() !== "" && (
              <span
                aria-live="polite"
                className="shrink-0 text-xs text-muted-foreground"
              >
                {filteredWorkflows.length} of {workflows.length} pipeline{workflows.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {archiveOpen ? (
          <RunArchivePanel />
        ) : boardOpen ? (
          <RunKanban onSelect={openRunFromBoard} />
        ) : workflows.length === 0 ? (
          <EmptyState
            emoji="🧩"
            title="No workflows yet"
            description="Compose agents into a pipeline — e.g. Researcher → Planner → Writer."
            action={
              <Button size="sm" onClick={openNew}>
                <Plus className="h-4 w-4" />
                New Workflow
              </Button>
            }
          />
        ) : filteredWorkflows.length === 0 ? (
          <EmptyState
            emoji="🔍"
            title={`No pipelines match “${query.trim()}”`}
            description="Try a shorter needle — search covers names, descriptions, step labels, instructions, agent names and schedule task text."
            action={
              <Button size="sm" variant="outline" onClick={() => setQuery("")}>
                <X className="h-4 w-4" />
                Clear search
              </Button>
            }
          />
        ) : (
          <>
          {breakerPaused.length > 0 && (
            <Alert id="breaker-paused-strip" className="border-red-500/30 bg-red-500/5">
              <ShieldAlert className="h-4 w-4 text-red-500" />
              <AlertTitle className="text-red-600 dark:text-red-400">
                Lane degraded — {breakerPaused.length} schedule{breakerPaused.length === 1 ? "" : "s"} auto-paused by the failure breaker
              </AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2 text-red-600/90 dark:text-red-400/90">
                <span>
                  {/* r308: per-schedule streaks — a shared max across schedules misattributed failures */}
                  {breakerPaused.slice(0, 3).map((wf) => `“${wf.name}” ×${wf.schedule?.failStreak ?? 0} in a row`).join(" · ")}
                  {breakerPaused.length > 3 ? ` +${breakerPaused.length - 3} more` : ""} — the breaker paused them instead of burning more quota. Fix each card's error, or resume straight away.
                  {congestionBackoff.length > 0 ? ` ${congestionBackoff.length} more in 429 backoff (self-resuming).` : ""}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  onClick={resumeAllPaused}
                >
                  <RotateCcw className="mr-1 h-3 w-3" />
                  Resume all
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filteredWorkflows.map((wf) => {
              const lastRun = wf.runs[0];
              // r81: live state for ANY run (manual or scheduled) — see the
              // liveRunCount note. Only one run per workflow can be active
              // (the runner guards on activeRuns), so the first "running"
              // entry is the live one.
              const liveRun = wf.runs.find((r) => r.status === "running");
              const liveSteps = liveRun?.steps ?? [];
              const liveDone = liveSteps.filter((s) => s.status === "done").length;
              const liveCurrent = liveSteps.find((s) => s.status === "running");
              const liveNextLabel =
                liveCurrent?.label ||
                liveCurrent?.agentName ||
                liveSteps.find((s) => s.status === "pending")?.label ||
                "";
              return (
                <Card
                  key={wf.id}
                  data-wf-card={wf.id}
                  className={cn(
                    "card-lift gap-3 p-4",
                    highlightId === wf.id &&
                      "ring-2 ring-violet-500/60 ring-offset-2 ring-offset-background",
                    liveRun && "ring-1 ring-emerald-500/40"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 truncate text-sm font-semibold md:text-[15px]">
                      {wf.name}
                    </h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label={`Actions for ${wf.name}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => openRun(wf)}>
                          <Play className="h-4 w-4" />
                          Run
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(wf)}>
                          <Pencil className="h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(wf)}>
                          <Copy className="h-4 w-4" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => exportWorkflows([wf], "definitions")}>
                          <Download className="h-4 w-4" />
                          Export definitions
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => exportWorkflows([wf], "full")}>
                          <Archive className="h-4 w-4" />
                          Export full pack
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(wf)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {wf.description ? (
                    <p className="line-clamp-1 text-sm text-muted-foreground">
                      {wf.description}
                    </p>
                  ) : null}

                  {/* r239: show the schedule's task text on the card. Search
                      can now find a pipeline by its recurring intent (r238),
                      but the card never displayed that intent — the hit was
                      invisible. Shown only when it differs from the
                      description (schedule.task falls back to it anyway). */}
                  {wf.schedule?.task && wf.schedule.task !== wf.description ? (
                    <p
                      className="line-clamp-1 text-xs text-muted-foreground/80"
                      title={`Schedule task — what each scheduled run asks for: ${wf.schedule.task}`}
                    >
                      <Clock className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden />
                      {wf.schedule.task}
                    </p>
                  ) : null}

                  {liveRun ? (
                    <div
                      role="status"
                      aria-label={`${wf.name} running: step ${Math.min(liveDone + 1, Math.max(liveSteps.length, 1))} of ${Math.max(liveSteps.length, 1)}`}
                      className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.07] px-2.5 py-1.5 text-[11px]"
                    >
                      <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                      </span>
                      <span className="shrink-0 font-medium text-emerald-600 dark:text-emerald-400">
                        Running
                      </span>
                      <span className="min-w-0 truncate text-muted-foreground">
                        {liveSteps.length > 0
                          ? `step ${Math.min(liveDone + 1, liveSteps.length)}/${liveSteps.length}${liveCurrent ? ` · ${liveNextLabel}` : " · queued"}`
                          : "starting…"}
                      </span>
                      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/80">
                        {fmtRel(liveRun.startedAt)}
                      </span>
                    </div>
                  ) : null}

                  <div
                    className="flex flex-wrap items-center gap-1.5"
                    aria-label={`${wf.steps.length} steps`}
                  >
                    {wf.steps.map((step, i) => {
                      const agent = agentById.get(step.agentId);
                      const isReview = (step.kind ?? "generate") === "review";
                      // r180/r182 role honesty (card chip = authored state):
                      // effective role prefers explicit step.roleId; the parsed
                      // "[Tag]" prefix is the legacy fallback.
                      const roleInfo = resolveStepRole(step.roleId, step.label || "");
                      const roleMismatch =
                        roleInfo.role != null &&
                        agent?.name != null &&
                        !roleMatchesAgent(roleInfo.role, agent.name);
                      // r311: universal mismatch (every tagged step wrong for its
                      // worker — imported-plan legacy) de-ambers the chain; the
                      // card shows one summary note below instead.
                      const roleUniversal = summarizeRoleTagMismatches(
                        wf.steps.map((s) => ({
                          label: s.label,
                          roleId: s.roleId,
                          agentName: agentById.get(s.agentId)?.name ?? null,
                        }))
                      ).universal;
                      return (
                        <React.Fragment key={step.id}>
                          {i > 0 ? (
                            <ChevronRight
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                          ) : null}
                          <span
                            title={
                              roleMismatch
                                ? `${step.label || agent?.name} — ⚠ ${roleInfo.source === "explicit" ? "role" : "role tag"} "${roleInfo.role}" ≠ worker "${agent?.name}" (routing follows the assigned agent)`
                                : step.label || agent?.name
                            }
                            className={cn(
                              "flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5",
                              isReview
                                ? "border-amber-500/40 bg-amber-500/10"
                                : roleMismatch && !roleUniversal
                                  ? "border-amber-500/40 bg-amber-500/[0.06]"
                                  : "border bg-muted/40"
                            )}
                          >
                            {isReview ? (
                              <ShieldAlert
                                className="ml-1 h-3 w-3 shrink-0 text-amber-500"
                                aria-hidden
                              />
                            ) : null}
                            <AgentAvatar agent={agent} size="xs" />
                            <span className="max-w-32 truncate text-xs font-medium">
                              {agent?.name ?? step.label ?? "Unassigned"}
                            </span>
                            {roleMismatch && !roleUniversal ? (
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                            ) : null}
                          </span>
                        </React.Fragment>
                      );
                    })}
                    {wf.steps.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No steps yet — edit to add some
                      </span>
                    ) : null}
                  </div>

                  {(() => {
                    // r311: one summary line when the whole chain's tags are
                    // source-plan legacy (universal mismatch) — replaces the
                    // per-chip amber noise.
                    const summary = summarizeRoleTagMismatches(
                      wf.steps.map((s) => ({
                        label: s.label,
                        roleId: s.roleId,
                        agentName: agentById.get(s.agentId)?.name ?? null,
                      }))
                    );
                    if (!summary.universal) return null;
                    return (
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        All {summary.tagged} step labels carry source-plan role tags that don&apos;t match their
                        assigned workers — routing follows the assigned agents, never the titles.
                      </p>
                    );
                  })()}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {wf.evolution ? (
                        <span
                          title={`Spawned by Evolution ${new Date(
                            wf.evolution.acceptedAt,
                          ).toLocaleString()} — ${wf.evolution.reason} (source: ${wf.evolution.sourceWorkflowName})`}
                          className="inline-flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400"
                        >
                          <Lightbulb className="h-3 w-3 shrink-0" />
                          Evolution spawn
                        </span>
                      ) : null}
                      <DepthChip depth={wf.depth} />
                      {(() => {
                        // r125 provider health chip — mirrors resolveLlm 1:1.
                        if (llm.fallbackNote) {
                          return (
                            <button
                              type="button"
                              onClick={openProviders}
                              title={`${llm.fallbackNote} Click to open Settings → Providers.`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              No key — Auto fallback
                            </button>
                          );
                        }
                        if (llm.providerId === "auto") {
                          return (
                            <span
                              title="Runs on the built-in gateway — zero config. Add your own provider key in Settings → Providers to dial your own quota."
                              className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-violet-500/70" />
                              Built-in
                            </span>
                          );
                        }
                        const vAt = settings.providerKeys?.[llm.providerId]?.validatedAt;
                        return (
                          <button
                            type="button"
                            onClick={openProviders}
                            title={`${llm.label}${llm.model ? ` · ${llm.model}` : ""} — key stored locally${vAt ? `, validated ${fmtRel(vAt)}` : ""}. Click to manage.`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {llm.label}
                          </button>
                        );
                      })()}
                      {wf.steps.some((st) => !agentById.has(st.agentId)) ? (
                        <button
                          type="button"
                          onClick={() => openEdit(wf)}
                          title={`${wf.steps.filter((st) => !agentById.has(st.agentId)).length} step(s) reference a missing agent — the run will fail at that step ("Agent not found"). Click to fix the pipeline.`}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                        >
                          <ShieldAlert className="h-3 w-3" aria-hidden />
                          {wf.steps.filter((st) => !agentById.has(st.agentId)).length} unassigned
                        </button>
                      ) : null}
                      {wf.schedule?.enabled && wf.steps.length > 0 && builtinVaultReady === false ? (
                        <button
                          type="button"
                          onClick={openVault}
                          title="Closed-tab schedules dial the shared built-in gateway — prone to 429 throttling. Store your own key in Settings → Vault (local-only) to give the headless lane a dedicated quota."
                          className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                        >
                          <KeyRound className="h-3 w-3" aria-hidden />
                          headless: shared key
                        </button>
                      ) : null}
                      <span
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                        title={lastRun ? `Last run: ${lastRun.status}` : undefined}
                      >
                        {lastRun ? (
                          <>
                            <span
                              aria-hidden
                              className={cn(
                                "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                                lastRun.status === "done" && "bg-emerald-500",
                                lastRun.status === "error" && "bg-red-500",
                                lastRun.status === "stopped" && "bg-zinc-400",
                                lastRun.status === "running" &&
                                  "animate-pulse bg-emerald-500"
                              )}
                            />
                            {`${wf.runs.length} run${wf.runs.length === 1 ? "" : "s"} · last ${fmtRel(lastRun.startedAt)}`}
                          </>
                        ) : (
                          "Never run"
                        )}
                      </span>
                      {(() => {
                        // r82: run-history sparkline — up to 10 bars, oldest →
                        // newest left-to-right, colored by terminal status.
                        // Fixed-height bars read as cadence; duration lives in
                        // the tooltip (height-normalizing skews hard against
                        // 692s deep runs). Hidden below 2 runs — the outcome
                        // dot already tells that story.
                        const trail = wf.runs.slice(0, 10).reverse();
                        if (trail.length < 2) return null;
                        return (
                          <span
                            role="img"
                            aria-label={`Last ${trail.length} runs, oldest to newest: ${trail.map((r) => r.status).join(", ")}`}
                            className="flex items-end gap-[3px]"
                          >
                            {trail.map((r) => (
                              <span
                                key={r.id}
                                title={`${fmtRel(r.startedAt)} · ${r.status}${r.finishedAt ? ` · ${Math.max(1, Math.round((r.finishedAt - r.startedAt) / 1000))}s` : " · in flight"}`}
                                className={cn(
                                  "w-[3px] rounded-sm",
                                  r.status === "done" && "h-3 bg-emerald-500/80",
                                  r.status === "error" && "h-3 bg-red-500/80",
                                  r.status === "stopped" && "h-3 bg-zinc-400/80",
                                  r.status === "running" &&
                                    "h-3 animate-pulse bg-emerald-500"
                                )}
                              />
                            ))}
                          </span>
                        );
                      })()}
                      {(() => {
                        const scored = wf.runs
                          .filter((r) => r.status === "done" && r.novelty != null)
                          .slice(0, 6)
                          .reverse();
                        if (scored.length === 0) return null;
                        return (
                          <span
                            aria-label={`Novelty trail: ${scored.map((r) => r.novelty).join(", ")}`}
                            title={`Recent novelty scores (oldest to newest): ${scored.map((r) => r.novelty).join("%, ")}% — amber dots scored below the ${noveltyThreshold}% stall rule (Settings → Evolution)`}
                            className="flex items-center gap-0.5"
                          >
                            {scored.map((r) => (
                              <span
                                key={r.id}
                                aria-hidden
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  (r.novelty ?? 0) < noveltyThreshold
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                                )}
                              />
                            ))}
                          </span>
                        );
      })()}
                    </div>
                    <div className="flex items-center gap-2">
                      {wf.schedule?.enabled && wf.steps.length > 0 && (() => {
                        // r76: honest skip-surface. The scheduler's due-filter
                        // EXCLUDES workflows with an active run (deliberate —
                        // no double-fire; the first tick after the run ends
                        // fires immediately, so nothing is lost). That hidden
                        // state is now visible: a due schedule whose run is
                        // still going shows an amber "due — blocked by run"
                        // chip instead of a green countdown pretending all is
                        // nominal. Derived live at render — run start/end are
                        // store updates, so the flip is reactive for free.
                        const scheduleDue =
                          wf.schedule.nextRunAt == null ||
                          wf.schedule.nextRunAt <= Date.now();
                        const blockedByRun = scheduleDue && isWorkflowRunning(wf.id);
                        if (blockedByRun) {
                          return (
                            <span
                              title="Schedule is due, but a run of this workflow is already active — it fires on the first scheduler tick after the run ends. Nothing is lost; the schedule never double-fires."
                              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              {fmtIntervalShort(wf.schedule.intervalMs)} · due — blocked by run
                            </span>
                          );
                        }
                        return (
                          <span
                            title={`Recurring schedule · next ${fmtIn(wf.schedule.nextRunAt)}${wf.schedule.failStreak ? ` · ${wf.schedule.failStreak} consecutive failure${wf.schedule.failStreak === 1 ? "" : "s"}` : ""}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                          >
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            </span>
                            {fmtIntervalShort(wf.schedule.intervalMs)} · next {fmtIn(wf.schedule.nextRunAt)}
                          </span>
                        );
                       })()}
                      {(() => {
                        // r197 (directive d): event-evidence chip — sits beside
                        // the promise badge and states what actually happened,
                        // citing the run event that backs the claim.
                        const ev = scheduleEvidence(wf, Date.now());
                        if (!ev) return null;
                        const toneCls =
                          ev.tone === "missed"
                            ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
                            : ev.tone === "failing"
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "border-border bg-muted/40 text-muted-foreground";
                        const dotCls =
                          ev.tone === "missed"
                            ? "bg-red-500"
                            : ev.tone === "failing"
                              ? "bg-amber-500"
                              : "bg-emerald-500";
                        return (
                          <span
                            title={ev.detail}
                            data-testid="schedule-evidence-chip"
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${toneCls}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
                            {ev.label}
                          </span>
                        );
                      })()}
                      {wf.schedule && !wf.schedule.enabled && wf.schedule.autoResumeAt != null && (
                        // r171: congestion backoff chip — distinct from the red
                        // manual-pause chip because this state heals itself.
                        // Click still resumes early (same handler).
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            resumeSchedule(wf);
                          }}
                          title={`Rate-limit backoff: the schedule parked itself after consecutive 429s and will re-arm automatically ${fmtIn(wf.schedule.autoResumeAt)}. Click to resume now instead.`}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                        >
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-60" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
                          </span>
                          backoff · auto-resume {fmtIn(wf.schedule.autoResumeAt)}
                        </button>
                      )}
                      {(() => {
                        // r304: chip state comes from lib/depth-chip (one pure
                        // rule shared with the runner's degrade semantics). A
                        // PAUSED schedule now renders "deep paused" only — it
                        // fires nothing, so the old firing claim was a lie
                        // while the breaker or a 429 backoff had it parked
                        // (witnessed stacked on the auto-paused chip).
                        const chip = deepPauseChip(wf);
                        if (!chip) return null;
                        return (
                          <span
                            title={chip.title}
                            data-testid="deep-pause-chip"
                            className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400"
                          >
                            <PauseCircle className="h-3 w-3" />
                            {chip.label}
                          </span>
                        );
                      })()}
                      {wf.schedule && !wf.schedule.enabled && wf.schedule.autoResumeAt == null && (wf.schedule.failStreak ?? 0) >= 2 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            resumeSchedule(wf);
                          }}
                          title="Auto-paused after consecutive failed runs. Click to re-enable the schedule and reset the failure counter — it fires on the next 10s tick while the tab is open."
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
                        >
                          <RotateCcw className="h-3 w-3" />
                          auto-paused · click to resume
                        </button>
                      )}
                      {wf.schedule && !wf.schedule.enabled && wf.schedule.autoResumeAt == null && (wf.schedule.failStreak ?? 0) < 2 && (
                        // r313: the USER-stopped state — disabled with no
                        // self-heal path and no breaker trip. Before this chip
                        // the card was silent here: nothing distinguished
                        // "stopped on purpose" from "is this broken?", and
                        // resuming meant Edit → toggle. Same one-click resume
                        // handler as the backoff/auto-paused chips; neutral
                        // slate tone = intentional human state, not a
                        // malfunction (amber self-heals, red is the breaker).
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            resumeSchedule(wf);
                          }}
                          title="Stopped — this schedule is disabled and nothing fires until you resume it. Click to resume: it re-enables and fires on the next 10s tick while the tab is open."
                          data-testid="stopped-schedule-chip"
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-zinc-500/40 bg-zinc-500/10 px-2 py-0.5 text-[10px] font-medium text-zinc-600 transition-colors hover:bg-zinc-500/20 dark:text-zinc-300"
                        >
                          <PauseCircle className="h-3 w-3" />
                          stopped · click to resume
                        </button>
                      )}
{(wf.schedule?.enabled === true && wf.steps.length > 0) && (
                        <span
                          data-testid="server-lane-armed-chip"
                          title="This pipeline is schedule-armed — the bridge registers it on the server lane every heartbeat (60s), so run-now and the headless scheduler both reach it."
                          className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-600 dark:text-teal-400"
                        >
                          {/* r600: the registration contract now reads BOTH ways — r597's chip marks the unregistered side (muted); this marks the armed side (teal) so the contract is visible on the card without consulting either error path. Passive chip: no fake affordance. */}
                          server lane: armed
                        </span>
                      )}
{!(wf.schedule?.enabled === true && wf.steps.length > 0) && (
                        <span
                          data-testid="server-lane-unregistered-chip"
                          title="Only schedule-armed pipelines register on the server lane — arm a schedule in Edit to make server runs reachable. The in-tab Run works regardless."
                          className="inline-flex items-center gap-1.5 rounded-full border border-muted-foreground/20 bg-muted-foreground/5 px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {/* r597: registration contract visible BEFORE the failed click — buildPayload syncs schedule-armed pipelines only (bridge:36); schedule-less cards 404 run-now (r596 error copy explains it). Passive chip: no fake affordance. */}
                          server lane: not registered
                        </span>
                      )}
                      <Button size="sm" onClick={() => openRun(wf)}>
                        <Play className="h-3.5 w-3.5" />
                        Run
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(wf)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                      {(() => {
                        // r77: deferral audit line — live while an episode is
                        // open ("since HH:MM"), historical once it closes
                        // ("deferred X — fired Y", shown for 6h).
                        const skip = lastSkipFor(wf.id);
                        if (!skip) return null;
                        const since = new Date(skip.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                        if (!skip.firedAt) {
                          return (
                            <div className="text-[10px] text-muted-foreground/80">
                              ⏳ schedule deferred since {since} — {skip.reason === "gateway-saturated" ? "waiting for the gateway congestion wave to pass" : "waiting for the active run to finish"}
                            </div>
                          );
                        }
                        if (Date.now() - skip.firedAt < 6 * 60 * 60_000) {
                          return (
                            <div className="text-[10px] text-muted-foreground/70">
                              ⏳ {skip.reason === "depth-degraded" ? (
                                <>fired at standard depth {fmtRel(skip.firedAt)} — deep passes paused after consecutive incomplete runs; a completed run restores deep</>
                              ) : (
                                <>deferred {fmtRel(skip.at)} {skip.reason === "gateway-saturated" ? "while the gateway was saturated" : "while a run was active"} — fired {fmtRel(skip.firedAt)}</>
                              )}
                            </div>
                          );
                        }
                        return null;
                       })()}
                  </div>
                </Card>
              );
            })}
          </div>
          </>
        )}
      </div>

      <WorkflowEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        workflow={editing}
      />

      <PlanPipelineDialog open={planOpen} onOpenChange={setPlanOpen} />

      <WorkflowRunPanel
        open={runOpen}
        onOpenChange={(v) => {
          setRunOpen(v);
          if (!v) setPendingRunFocus(null);
        }}
        workflow={running}
        initialRunId={pendingRunFocus}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the workflow and its run history. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "bg-red-600 text-white hover:bg-red-600/90 focus-visible:ring-red-600/40"
              )}
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
