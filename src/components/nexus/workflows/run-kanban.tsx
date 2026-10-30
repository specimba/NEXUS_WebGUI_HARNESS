"use client";

// ─── Runs Kanban: every pipeline run across every workflow, grouped by state ─
// Inspired by Untrivial-ai/agent-orchestrator ("Needs you" attention column)
// and cft0808/edict's 军机处 board with health badges.

import * as React from "react";
import {
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
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
import { ledgerAgeIsStale, ledgerAgeOf } from "@/lib/ledger-freshness";
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
import { GateSuffix } from "@/components/nexus/workflows/gate-suffix";
import { familyTallyOf } from "@/lib/family-witness";
import { apiJson } from "@/lib/api-fetch";

// r695: one focus-ring home for the board's focusable chip family — the
// digest ⧉/⚖ pair, the per-run ⚖/↻/harness chips, and the r683 ghost button
// all carry the same ring, so the affordance can never drift apart.
const CHIP_FOCUS_RING = "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

/** r726: parse a ledger createdAt (epoch-ms number/string or ISO) to ms; 0 when absent or unreadable — an honest zero, never a fake time. */
function evAtMs(v?: string | number | null): number {
  if (v == null || v === "") return 0;
  const asNum = typeof v === "number" ? v : Number(v);
  const n = Number.isFinite(asNum) && asNum > 0 ? asNum : Date.parse(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** r726: compact HH:MM:SS wall clock for a ledger event; an honest dash when the row carries no readable time. */
function fmtEventAt(v?: string | number | null): string {
  const n = evAtMs(v);
  return n > 0 ? new Date(n).toLocaleTimeString([], { hour12: false }) : "—";
}

/** r726: one durable event row in the corpus detail panel — tone and label
 * come from the SAME gateCensusOf classifier (the r649 doctrine: card
 * callLog, server lane, digest rows, now per-row panels — never a rival
 * vocabulary), and the note renders VERBATIM, so the judge dial trace
 * ("tried: intern-systemone — no answer; fast-judge …") rides inside it. */
/** r731: the per-row label — ONE derivation shared by the rendered row and
 * the copied ladder (r649: the same classifier, never a rival vocabulary). */
function eventLabelOf(c: ReturnType<typeof gateCensusOf>): string {
  return c.verdicts > 0
    ? c.verdictTone === "fail"
      ? "verdict · FAIL"
      : "verdict · PASS"
    : c.uncertain > 0
      ? "uncertain"
      : c.noJudge > 0
        ? "no judge"
        : "gate event";
}

/** r736: WHICH lanes are failing — from the ledger's own verbatim
 * tried-trace notes ("tried: LANE — no answer (...); LANE2 — ..."),
 * classified through the same gateCensusOf adapter (r649: one
 * vocabulary), surfaced as the nj token's title so the judge-lane
 * distress is glanceable without opening ladders one by one. */
function laneDistressOf(corpus: { rows: { note: string }[] }[]): string {
  const lanes: string[] = [];
  for (const entry of corpus) {
    for (const row of entry.rows) {
      const c = gateCensusOf([{ note: row.note }]);
      if (c.noJudge <= 0) continue;
      const re = /(?:tried:|;)\s*([^—;]+?)\s*—/g;
      let m: RegExpExecArray | null = re.exec(row.note || "");
      while (m) {
        const lane = m[1].trim();
        if (lane && lanes.indexOf(lane) === -1) lanes.push(lane);
        m = re.exec(row.note || "");
      }
    }
  }
  return lanes.join("; ");
}

/** r751: HOW OFTEN each lane failed - the same verbatim tried-trace
 * scan as laneDistressOf (same regex, same noJudge gate), but
 * tallying every match instead of deduping: the legend chips carry a
 * per-lane dial-attempt count so the distress driver is measurable,
 * not just nameable. Counts are trace ENTRIES - a step that tried
 * three lanes contributes three - so the sum can exceed the no-judge
 * step count; the legend title states that, it is not hidden. */
function laneCountsOf(corpus: { rows: { note: string }[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of corpus) {
    for (const row of entry.rows) {
      const c = gateCensusOf([{ note: row.note }]);
      if (c.noJudge <= 0) continue;
      const re = /(?:tried:|;)\s*([^—;]+?)\s*—/g;
      let m: RegExpExecArray | null = re.exec(row.note || "");
      while (m) {
        const lane = m[1].trim();
        if (lane) counts[lane] = (counts[lane] || 0) + 1;
        m = re.exec(row.note || "");
      }
    }
  }
  return counts;
}

/** r766: per-run route letter - which middle-tier routes a single run
 * touched, from the same verbatim tried-trace extraction laneCountsOf
 * uses, classified by the same laneTierOf heuristic (q = qwen-only,
 * g = glm-only, m = both). Shown on the corpus run cards: during the
 * alternation era the run list itself becomes the wave-route history,
 * and an m run = a genuine both-routes run (investigate signal). */
function laneRunLetterOf(rows: { note: string }[]): string {
  let q = 0;
  let g = 0;
  for (const row of rows) {
    const c = gateCensusOf([{ note: row.note }]);
    if (c.noJudge <= 0) continue;
    const re = /(?:tried:|;)\s*([^—;]+?)\s*—/g;
    let m: RegExpExecArray | null = re.exec(row.note || "");
    while (m) {
      const tier = laneTierOf(m[1].trim());
      if (tier === "middle · qwen route") q += 1;
      else if (tier === "middle · glm route") g += 1;
      m = re.exec(row.note || "");
    }
  }
  if (q > 0 && g > 0) return "m";
  if (q > 0) return "q";
  if (g > 0) return "g";
  return "";
}

/** r755: WHEN each lane was first seen - the same verbatim tried-trace
 * scan as laneCountsOf, but tracking the earliest row timestamp naming
 * each lane (UTC): on a growth wave, first-seen spread across lanes
 * shows whether the whole ladder lit up together (near-uniform - the
 * predicted full-ladder witness) or a lane joined late (the broadening
 * signal the r751 handoff defined). Bounded by the fetched corpus
 * window (newest 400 rows); the bound is disclosed in the chip titles.
 * createdAt is read structurally (optional) so a missing field degrades
 * to no date, never an error. */
function laneFirstSeenOf(corpus: { rows: { note: string; createdAt?: string | null }[] }[]): Record<string, number> {
  const first: Record<string, number> = {};
  for (const entry of corpus) {
    for (const row of entry.rows) {
      const t = row.createdAt ? Date.parse(row.createdAt) : NaN;
      if (Number.isNaN(t)) continue;
      const c = gateCensusOf([{ note: row.note }]);
      if (c.noJudge <= 0) continue;
      const re = /(?:tried:|;)\s*([^—;]+?)\s*—/g;
      let m: RegExpExecArray | null = re.exec(row.note || "");
      while (m) {
        const lane = m[1].trim();
        if (lane && (first[lane] === undefined || t < first[lane])) first[lane] = t;
        m = re.exec(row.note || "");
      }
    }
  }
  return first;
}

/** r756: WHEN each lane was last seen - the mirror of laneFirstSeenOf
 * (same verbatim tried-trace scan, tracking the LATEST row timestamp
 * naming each lane): first/last-seen pairs bracket each growth wave, and
 * a lane whose last-seen lags the others while they jump together is the
 * PARTIAL-LADDER signal (some steps found an answering judge while the
 * rest still dialed the whole ladder). Same newest-400-rows window bound
 * as first-seen, disclosed in the panel title. */
function laneLastSeenOf(corpus: { rows: { note: string; createdAt?: string | null }[] }[]): Record<string, number> {
  const last: Record<string, number> = {};
  for (const entry of corpus) {
    for (const row of entry.rows) {
      const t = row.createdAt ? Date.parse(row.createdAt) : NaN;
      if (Number.isNaN(t)) continue;
      const c = gateCensusOf([{ note: row.note }]);
      if (c.noJudge <= 0) continue;
      const re = /(?:tried:|;)\s*([^—;]+?)\s*—/g;
      let m: RegExpExecArray | null = re.exec(row.note || "");
      while (m) {
        const lane = m[1].trim();
        if (lane && (last[lane] === undefined || t > last[lane])) last[lane] = t;
        m = re.exec(row.note || "");
      }
    }
  }
  return last;
}

/** r757: the dials-over-time mini-strip - per-lane dial attempts AND
 * corpus-wide no-judge rows bucketed into 15-minute UTC slots. At the
 * current burst cadence (waves at 20:16, ~21:0x, ~21:28 UTC on 10-29)
 * 15-minute slots resolve each wave separately where hour buckets would
 * merge the last two. r759 SHAPE NOTE: rows name a 5-lane chain whose
 * middle tier alternates routes (qwen free pair vs glm-5.3 pair), so
 * per-lane bucket profiles DIVERGE when the route preference shifts -
 * the laneSpread figure below makes the composition visible on-page.
 * Same newest-400-rows window bound, disclosed in the strip title. */
function laneBucketsOf(corpus: { rows: { note: string; createdAt?: string | null }[] }[]): { lanes: Record<string, Record<string, number>>; corpusRows: Record<string, number>; laneSpread: Record<string, number>; bucketBounds: Record<string, { min: number; max: number }> } {
  const lanes: Record<string, Record<string, number>> = {};
  const corpusRows: Record<string, number> = {};
  const bucketBounds: Record<string, { min: number; max: number }> = {};
  for (const entry of corpus) {
    for (const row of entry.rows) {
      const c = gateCensusOf([{ note: row.note }]);
      if (c.noJudge <= 0) continue;
      const t = row.createdAt ? Date.parse(row.createdAt) : NaN;
      if (Number.isNaN(t)) continue;
      const d = new Date(t);
      const q = String(Math.floor(d.getUTCMinutes() / 15) * 15).padStart(2, "0");
      const key = d.toISOString().slice(5, 10) + " " + d.toISOString().slice(11, 13) + ":" + q;
      corpusRows[key] = (corpusRows[key] ?? 0) + 1;
      const bb = bucketBounds[key] ?? (bucketBounds[key] = { min: t, max: t });
      if (t < bb.min) bb.min = t;
      if (t > bb.max) bb.max = t;
      const re = /(?:tried:|;)\s*([^—;]+?)\s*—/g;
      let m: RegExpExecArray | null = re.exec(row.note || "");
      while (m) {
        const lane = m[1].trim();
        if (lane) {
          if (!lanes[lane]) lanes[lane] = {};
          lanes[lane][key] = (lanes[lane][key] ?? 0) + 1;
        }
        m = re.exec(row.note || "");
      }
    }
  }
  const laneSpread: Record<string, number> = {};
  for (const key of Object.keys(corpusRows)) {
    laneSpread[key] = Object.values(lanes).filter((lb) => (lb[key] ?? 0) > 0).length;
  }
  return { lanes, corpusRows, laneSpread, bucketBounds };
}

/** r760: the route-tier classifier - every lane in the verbatim
 * tried-trace belongs to a rung of the dial ladder (r759 finding: the
 * chain is 5 lanes wide with a middle tier that ALTERNATES routes,
 * qwen free pair vs glm-5.3 pair, never all four). Name-heuristic on
 * purpose, not a hardcoded lane list: an eighth lane still classifies
 * (as "unrouted"), which keeps the eighth-lane watch honest. The
 * legend groups the middle tier by route and shows per-route state
 * (ACTIVE = the route answered in the newest corpus bucket). */
function laneTierOf(lane: string): string {
  if (lane === "intern-systemone") return "entry";
  if (/paid rung/.test(lane)) return "paid";
  if (/^fast-judge$/.test(lane)) return "verify";
  if (/qwen/.test(lane)) return "middle · qwen route";
  if (/glm/.test(lane)) return "middle · glm route";
  return "unrouted";
}

/** r758: the divergence auto-highlight - compares each lane 15-min
 * bucket profile against the corpus strip over the LAST 3 buckets.
 * r759 SEMANTICS (post the wave-2/4 trace diff): every row names a
 * 5-lane chain whose middle tier ALTERNATES routes (the qwen free pair
 * vs the glm-5.3 pair), so a lag fires on route-preference shifts as
 * well as on genuine partial ladders - check the laggard lanes before
 * interpreting. Ships pre-armed in a steady slot: an instrument must
 * exist before the wave it watches for. */
function laneDivergenceOf(buckets: { lanes: Record<string, Record<string, number>>; corpusRows: Record<string, number> }): Record<string, string> {
  const keys = Object.keys(buckets.corpusRows).sort().slice(-3);
  const out: Record<string, string> = {};
  for (const lane of Object.keys(buckets.lanes)) {
    const laneB = buckets.lanes[lane];
    const lags = keys.filter((k) => (laneB[k] ?? 0) < (buckets.corpusRows[k] ?? 0));
    if (lags.length) {
      out[lane] = lags.map((k) => k + " (×" + (laneB[k] ?? 0) + " of ×" + buckets.corpusRows[k] + ")").join(", ");
    }
  }
  return out;
}

/** r753: HOW MANY RUNS each lane touched - the same verbatim
 * tried-trace scan as laneCountsOf, but tallying DISTINCT run ids per
 * lane (a run with several no-judge events on one lane counts once):
 * dial attempts (xN) and runs affected answer different questions -
 * one lane may dominate dials while touching few runs. */
function laneRunCountsOf(corpus: { runId: string; rows: { note: string }[] }[]): Record<string, number> {
  const perLane: Record<string, Set<string>> = {};
  for (const entry of corpus) {
    for (const row of entry.rows) {
      const c = gateCensusOf([{ note: row.note }]);
      if (c.noJudge <= 0) continue;
      const re = /(?:tried:|;)\s*([^—;]+?)\s*—/g;
      let m: RegExpExecArray | null = re.exec(row.note || "");
      while (m) {
        const lane = m[1].trim();
        if (lane) {
          if (!perLane[lane]) perLane[lane] = new Set();
          perLane[lane].add(entry.runId);
        }
        m = re.exec(row.note || "");
      }
    }
  }
  const out: Record<string, number> = {};
  for (const k of Object.keys(perLane)) out[k] = perLane[k].size;
  return out;
}

function CorpusEventRow({ row }: { row: LedgerRunRow }) {
  const c = gateCensusOf([{ note: row.note }]);
  const label = eventLabelOf(c);
  const tone =
    c.verdictTone === "fail" || c.uncertain > 0
      ? "text-amber-600 dark:text-amber-400"
      : c.verdictTone === "pass"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";
  return (
    <li className="rounded-md border border-border/40 bg-background/60 px-2 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{fmtEventAt(row.createdAt)}</span>
        <span className={cn("text-[10px] font-semibold uppercase tracking-wide", tone)}>{label}</span>
        {/* r730: the durable step key — the step-level join for triage SQL
        (EvalEvent.stepId). Honest absence when the runner posted none
        (r648: no token is faked); truncates, never wraps the row. */}
        {row.stepId ? (
          <code
            className="ml-auto min-w-0 truncate font-mono text-[9px] text-muted-foreground/80"
            title="Durable step key — the join key for triage SQL against the corpus (EvalEvent.stepId). Absent on rows the runner posted without a step."
          >
            {row.stepId}
          </code>
        ) : null}
      </div>
      <p className="mt-1 break-words text-[10px] leading-relaxed text-muted-foreground">{row.note}</p>
    </li>
  );
}

/** r728: copy-run-id affordance on the corpus detail panel header — the
 * panel is built from ledger rows alone, so the full id is the only key a
 * follow-up (DB query, Cortex triage) can act on. One click puts it on the
 * clipboard; the icon swaps to a check and reverts (honest, no permanent
 * state), with a toast as the second signal. Errors toast, never lie. */
function CopyRunIdButton({ runId }: { runId: string }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  const onCopy = () => {
    const done = () => {
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(runId)
        .then(() => {
          done();
          toast.success("Run id copied");
        })
        .catch(() => toast.error("Clipboard refused the run id — copy it from the panel header"));
    } else {
      toast.error("Clipboard unavailable in this browser");
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={"Copy run id " + runId + " to the clipboard"}
      title="Copy the full run id — this panel is built from ledger rows alone, so the id is the key for any follow-up."
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        CHIP_FOCUS_RING,
        copied && "text-emerald-600 dark:text-emerald-400"
      )}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
    </button>
  );
}

/** r729: copy-all-run-ids beside the ⧉ digest chip — the digest census is
 * glanceable, but its KEYS weren't takeable: triage scripts (SQLite IN(...)
 * queries, Cortex batches) want the corpus's whole id list at once. One
 * click puts the DISTINCT run ids on the clipboard as a comma list; same
 * Copy→Check + toast vocabulary as the r728 panel button (one id at a
 * time there, the full key set here). Honest error toasts — never a fake
 * success. The caller gates rendering on corpus coverage (the r724
 * honesty bound): a partial census payload never poses as the full set. */
function CopyAllRunIdsButton({ ids }: { ids: string[] }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  const onCopy = () => {
    const done = () => {
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(ids.join(","))
        .then(() => {
          done();
          toast.success(ids.length + " run ids copied");
        })
        .catch(() => toast.error("Clipboard refused the run id list — copy them from the strip headers"));
    } else {
      toast.error("Clipboard unavailable in this browser");
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={"Copy all " + ids.length + " corpus run ids to the clipboard as a comma list"}
      title="Copy every distinct run id in the durable corpus as a comma list — the key set for triage scripts (SQLite IN(...) queries, Cortex batches). Sits beside the ⧉ digest chip; the panel header's copy button carries one id at a time."
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        CHIP_FOCUS_RING,
        copied && "text-emerald-600 dark:text-emerald-400"
      )}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
    </button>
  );
}

/** r731: copy-ladder affordance on the corpus detail panel header — the
 * panel already SHOWS a run's whole decision ladder (time · label · step
 * key · note, the judge dial trace verbatim); one click puts that exact
 * view on the clipboard as text so a triage ticket or Cortex batch gets
 * the full tried-trace without retyping. The copied text is built from
 * the SAME rows and the SAME per-row classifier the panel renders (r649:
 * never a rival vocabulary) — what lands on the clipboard is what the
 * screen shows. Copy→Check + toast vocabulary of the r728/r729 buttons;
 * honest error toasts — never a fake success. */
function CopyLadderButton({
  runId,
  rows,
  census,
}: {
  runId: string;
  rows: LedgerRunRow[];
  census: ReturnType<typeof gateCensusOf>;
}) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  const ladderText = () => {
    const head =
      runId +
      " · " + rows.length + " events" +
      " · engaged " + census.engaged +
      " · " + census.verdicts + " verdicts" +
      " · " + census.uncertain + "u · " + census.noJudge + "nj";
    const lines = rows.map((row) => {
      const c = gateCensusOf([{ note: row.note }]);
      const step = row.stepId ? " (step " + row.stepId + ")" : "";
      return fmtEventAt(row.createdAt) + " [" + eventLabelOf(c) + "]" + step + " " + row.note;
    });
    return [head].concat(lines).join("\n");
  };
  const onCopy = () => {
    const done = () => {
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(ladderText())
        .then(() => {
          done();
          toast.success("Run ladder copied");
        })
        .catch(() => toast.error("Clipboard refused the ladder — copy the rows from the panel"));
    } else {
      toast.error("Clipboard unavailable in this browser");
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={"Copy the full decision ladder for run " + runId + " as text"}
      title="Copy this run's whole decision ladder as text — the same rows, labels and verbatim notes the panel renders, one line per event. For triage tickets and Cortex batches."
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        CHIP_FOCUS_RING,
        copied && "text-emerald-600 dark:text-emerald-400"
      )}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
    </button>
  );
}

/** r733: copy-VISIBLE-run-ids beside the filter count chip — the r732
 * filter made a SUBSET real, so the subset's key set is now takeable:
 * one click copies exactly the runs the filter is showing (the count chip
 * states the same truth). Rendered ONLY while a filter is active and at
 * least one pill is visible — unfiltered, r729's copy-all already owns
 * the whole-corpus job, and an empty visible set has nothing to copy
 * (r648: no fake affordances). Same Copy→Check + toast vocabulary;
 * honest error toasts — never a fake success. */
function CopyVisibleRunIdsButton({ ids }: { ids: string[] }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  const onCopy = () => {
    const done = () => {
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(ids.join(","))
        .then(() => {
          done();
          toast.success(ids.length + (ids.length === 1 ? " visible run id copied" : " visible run ids copied"));
        })
        .catch(() => toast.error("Clipboard refused the visible id list — copy them from the pill headers"));
    } else {
      toast.error("Clipboard unavailable in this browser");
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={"Copy the visible " + ids.length + (ids.length === 1 ? " run id" : " run ids") + " to the clipboard as a comma list"}
      title="Copy exactly the runs the filter is showing as a comma list — the visible subset's key set for triage scripts. Only offered while a filter is active; the unfiltered corpus has its own copy-all."
      className={cn(
        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        CHIP_FOCUS_RING,
        copied && "text-emerald-600 dark:text-emerald-400"
      )}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
    </button>
  );
}

/** r722: one durable ledger row shaped for the per-run gate chip (the r683 read). */
interface LedgerRunRow {
  runId: string;
  note: string;
  createdAt?: string | null;
  /** r730: the durable step key when the runner posted one (nullable —
   * uncertain rows often carry none); the panel renders it as the
   * step-level triage join (EvalEvent.stepId). */
  stepId?: string | null;
}

/** r723: the durable per-run chip for runs this board holds NO card for —
 * the "corpus-only" strip's chip (attempt #16's witness surface). Same
 * gateCensusOf adapter, same tonal system; the title names the honest
 * source: the corpus outlives the store. Zero gate rows render nothing
 * (the r648 doctrine — no chip is faked for an empty corpus). */
function CorpusRunChip({ rows, tabbable = true }: { rows: LedgerRunRow[]; tabbable?: boolean }) {
  const mapped = rows.map((r) => {
    const at = r.createdAt ? Date.parse(r.createdAt) : NaN;
    return { note: r.note, ...(Number.isFinite(at) ? { at } : {}) };
  });
  const census = gateCensusOf(mapped);
  if (census.engaged === 0 && census.verdicts === 0) return null;
  const fam = familyTallyOf(rows.map((r) => r.note));
  // r726: the tried-ladder trace surfaces in the chip title — the judge
  // dial failures (the nj distress) become readable on hover, per run,
  // without opening anything. Bounded to 220 chars; an honest absence
  // when no row ever failed to dial (a healthy lane shows nothing).
  const triedNote = rows.map((r) => r.note).find((n) => n.includes("tried:")) ?? "";
  const triedAt = triedNote.indexOf("tried:");
  const dialTrace =
    triedAt >= 0
      ? " First judge dial trace: " + triedNote.slice(triedAt, triedAt + 220) + (triedNote.length > triedAt + 220 ? "…" : "")
      : "";
  return (
    <span
      tabIndex={tabbable ? 0 : undefined}
      title={`Decision gate census counted from the DURABLE ledger — this board holds no card for this run (the run row lives only in the browser that ran it; the server lane carries no AutomationRun row for it). The corpus outlives the store, so it renders here instead of vanishing. Engaged ${census.engaged} time(s), ${census.verdicts} confident verdict(s) landed — the rest fell through (no judge answered or judge errored).${dialTrace}${fam.cross + fam.same > 0 ? ` Judge family witness: ◈ ${fam.cross} cross-family · ◇ ${fam.same} same-family.` : ""}`}
      aria-label={`Durable gate census for a corpus-only run: engaged ${census.engaged}, ${census.verdicts} confident verdicts landed`}
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-px font-semibold tabular-nums transition-colors cursor-help",
        tabbable && CHIP_FOCUS_RING,
        census.verdictTone === "fail"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:border-amber-500/60 dark:text-amber-400"
          : census.verdictTone === "pass"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:border-emerald-500/60 dark:text-emerald-400"
            : "border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/40"
      )}
    >
      ⚖ gate {census.engaged}·{census.verdicts}{census.verdictLine ? ` · ${census.verdictLine}` : ""}<GateSuffix census={census} />
    </span>
  );
}

function RunCard({
  card,
  onSelect,
  onOpenServer,
  ledgerRuns,
}: {
  card: BoardCard;
  onSelect: (workflowId: string, runId?: string) => void;
  onOpenServer?: (row: ServerRunRow) => void;
  /** r722: durable gate rows for the server-lane per-run chip (r683 landed). */
  ledgerRuns?: LedgerRunRow[];
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
          {(() => {
            // r722 — attempt #15 LANDED: the per-run ⚖ gate chip finally mounts
            // on server-lane cards. The local-run chip (below) reads
            // run.callLog, but a server-lane card carries NO client call log
            // (ServerRunRow is stepsJson only) — the r713→r721 witness debt
            // was exactly this: Owner-launched headless runs could never mount
            // the chip, however alive their durable corpus. The r683 per-run
            // ledger read now feeds the SAME gateCensusOf adapter from the
            // durable rows for this runId (one classifier, two sources — the
            // r649 doctrine). Zero census renders nothing (r648: no chip is
            // faked for an empty corpus).
            const rows = (ledgerRuns ?? [])
              .filter((r) => r.runId === s.id)
              .map((r) => {
                const at = r.createdAt ? Date.parse(r.createdAt) : NaN;
                return { note: r.note, ...(Number.isFinite(at) ? { at } : {}) };
              });
            const census = gateCensusOf(rows);
            if (census.engaged === 0 && census.verdicts === 0) return null;
            const fam = familyTallyOf(rows.map((r) => r.note));
            return (
              <span
                tabIndex={0}
                title={`Decision gate on this server-lane run, counted from the DURABLE ledger (the card carries no client call log; the runner POSTs gate outcomes to SQLite at finalization): engaged ${census.engaged} time(s), ${census.verdicts} confident verdict(s) landed — the rest fell through (no judge answered or judge errored; the full tried-ladder trace lives in the run's call log). The u suffix counts judges that answered below confidence (uncertain); nj counts steps no judge answered — the step ran ungated.${fam.cross + fam.same > 0 ? ` Judge family witness: ◈ ${fam.cross} cross-family · ◇ ${fam.same} same-family.` : ""}`}
                aria-label={`Decision gate on this server-lane run, from the durable ledger: engaged ${census.engaged} ${census.engaged === 1 ? "time" : "times"}, ${census.verdicts} confident ${census.verdicts === 1 ? "verdict" : "verdicts"} landed${fam.cross + fam.same > 0 ? `, drift ${fam.cross} cross-family, ${fam.same} same-family` : ""}`}
                className={cn(
                  "inline-flex items-center rounded-full border px-1.5 py-px font-semibold tabular-nums transition-colors cursor-help",
                  CHIP_FOCUS_RING,
                  census.verdictTone === "fail"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:border-amber-500/60 dark:text-amber-400"
                    : census.verdictTone === "pass"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:border-emerald-500/60 dark:text-emerald-400"
                      : "border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/40"
                )}
              >
                ⚖ gate {census.engaged}·{census.verdicts}{census.verdictLine ? ` · ${census.verdictLine}` : ""}<GateSuffix census={census} />
              </span>
            );
          })()}
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
            className="inline-flex cursor-help items-center rounded-full border border-orange-500/40 bg-orange-500/10 px-1.5 py-px font-semibold text-orange-600 dark:text-orange-400"
          >
            {degraded} auto-digest
          </span>
        ) : null}
        {run.degradedDeep && run.degradedDeep.skipped > 0 ? (
          <span
            title={`${run.degradedDeep.skipped} of the materialized deep-research passes was skipped after a transient ${run.degradedDeep.kinds.join("/")} error — the run continued without it; the final output is not deep-verified.`}
            className="inline-flex cursor-help items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px font-semibold text-amber-600 dark:text-amber-400 tabular-nums"
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
                aria-label={`Looped depth on "${loopedStep.label}": ${loopedStep.looped.k} tied ${loopedStep.looped.k === 1 ? "pass" : "passes"} of ${loopedStep.looped.r}, exit ${loopedStep.looped.reason}`}
                className={cn(
                  "inline-flex cursor-help items-center rounded-full border px-1.5 py-px font-semibold tabular-nums",
                  CHIP_FOCUS_RING,
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
          // r700: the pointer promise now answers the pointer — the chip's own
          // tone channel brightens on hover (border arm), over transition-colors.
          const steps = run.steps ?? [];
          const withOut = steps.filter((s) => (s.output ?? "").trim().length > 0);
          if (withOut.length === 0) return null;
          const met = withOut.filter((s) => s.output.trim().length >= GATE_MIN_CHARS).length;
          const all = met === withOut.length;
          return (
            <span
              title={`Gate-floor readiness: ${met} of ${withOut.length} output-bearing step(s) reach the decision gate's length floor (≥${GATE_MIN_CHARS} chars). Length only — a verdict also needs a generate kind, a non-degraded stream, the toggle on, and a judge that answers.`}
              className={cn(
                "inline-flex cursor-help items-center rounded-full border px-1.5 py-px font-semibold tabular-nums transition-colors",
                all
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-600 hover:border-violet-500/70 dark:text-violet-400"
                  : "border-border bg-muted/40 text-muted-foreground hover:border-muted-foreground/40"
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
          let census = gateCensusOf(run.callLog);
          // r722: durable fallback — the r713→r721 debt ran DEEPER than the
          // server-lane branch: runs landed from the server lane into the
          // local archive (archiveServerLaneRun) keep row.id but carry NO
          // callLog (ServerRunRow is stepsJson only), so the client census
          // above reads zero for them however alive their durable corpus.
          // The r683 per-run read fills exactly that hole — same adapter,
          // durable rows for run.id, and ONLY when the client census is
          // empty (the client log stays the first source; the ledger never
          // overwrites a live census).
          const durableRows = (ledgerRuns ?? [])
            .filter((r) => r.runId === run.id)
            .map((r) => {
              const at = r.createdAt ? Date.parse(r.createdAt) : NaN;
              return { note: r.note, ...(Number.isFinite(at) ? { at } : {}) };
            });
          const usedDurable = census.engaged === 0 && census.verdicts === 0 && durableRows.length > 0;
          if (usedDurable) census = gateCensusOf(durableRows);
          // r677: per-run drift witness — how many of this run's judge notes
          // are family-disjoint (cross) vs same-family (same). r722: the
          // durable rows contribute their notes when the census rode the
          // ledger (the witness describes the counted rows).
          const fam = familyTallyOf(
            usedDurable
              ? [...(run.callLog ?? []).map((c) => c.note ?? ""), ...durableRows.map((r) => r.note)]
              : (run.callLog ?? []).map((c) => c.note)
          );
          if (census.engaged === 0 && census.verdicts === 0) return null;
          return (
            <span
              tabIndex={0}
              title={`Decision gate engaged ${census.engaged} time(s) on this run; ${census.verdicts} confident verdict(s) landed — the rest fell through (no judge answered or judge errored; the full tried-ladder trace lives in the run's call log; the chip takes the LATEST verdict's color — emerald PASS, amber FAIL — so a failed gate never reads green).${usedDurable ? " Counted from the DURABLE ledger — this run landed from the server lane without a client call log." : ""} The u suffix counts judges that answered below confidence (uncertain); nj counts steps no judge answered — the step ran ungated.${fam.cross + fam.same > 0 ? ` Judge family witness: ◈ ${fam.cross} cross-family · ◇ ${fam.same} same-family.` : ""}`}
              aria-label={`Decision gate on this run: engaged ${census.engaged} ${census.engaged === 1 ? "time" : "times"}, ${census.verdicts} confident ${census.verdicts === 1 ? "verdict" : "verdicts"} landed${fam.cross + fam.same > 0 ? `, drift ${fam.cross} cross-family, ${fam.same} same-family` : ""}`}
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-px font-semibold tabular-nums transition-colors cursor-help",
                CHIP_FOCUS_RING,
                census.verdictTone === "fail"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : census.verdictTone === "pass"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border bg-muted/40 text-muted-foreground"
              )}
            >
              ⚖ gate {census.engaged}·{census.verdicts}{census.verdictLine ? ` · ${census.verdictLine}` : ""}<GateSuffix census={census} />
            </span>
          );
        })()}
        {harnessChip ? (
          <span
            tabIndex={0}
            title={harnessChip.tooltip}
            aria-label={`Harness reliability ${harnessChip.label}`}
            className={cn(
              "inline-flex cursor-help items-center rounded-full px-1.5 py-px font-semibold tabular-nums transition-colors",
              CHIP_FOCUS_RING,
              harnessChip.tone === "warn"
                ? "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-400"
                : "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 dark:text-emerald-400"
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
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/5 px-2.5 py-1.5 transition-colors focus-within:border-amber-500/45 focus-within:ring-1 focus-within:ring-amber-500/25"
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
  // r750: the lane legend — the LD lane trace lived in a hover-only title
  // (invisible on touch); the judge-lane distress instrument deserves a
  // click. Toggled by the nj tally button in the strip header.
  const [lanesOpen, setLanesOpen] = React.useState(false);
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
    // r722: the per-run ledger read (r683 landed) — newest 400 rows'
    // { runId, note, createdAt }; server-lane cards classify their runId's
    // rows through gateCensusOf for the per-run ⚖ chip.
    runs?: LedgerRunRow[];
  } | null>(null);
  // r681: failed-census attempts — the honest silence marker below renders
  // only after real, REPEATED fetch failures (never for an empty corpus).
  const [ledgerMisses, setLedgerMisses] = React.useState(0);
  // r683: the ghost chip is clickable — bumping this nonce re-arms the whole
  // 6×3s retry loop without a remount (the r681 marker gets a recovery path;
  // before this, exhausted tries silenced the chip until a coincidental
  // navigation remounted the board).
  const [ledgerRetry, setLedgerRetry] = React.useState(0);
  // r691: session growth baseline — the first successful census of this
  // page. The ▲ badge shows the DELTA (landed since the page opened), the
  // board-visible form of the auto-growth the worklog has tracked since
  // r677: the corpus breathing is now glanceable, not just census numbers.
  // State, not a ref: the delta is read during render (the react-hooks/refs
  // gate forbids ref reads there), and one extra render per session is free.
  const [ledgerBaseline, setLedgerBaseline] = React.useState<number | null>(null);
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
            runs?: Array<{ runId?: string; note?: string; createdAt?: string | null }>;
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
          const landedTotal: number = j.total;
          setLedgerBaseline((b) => (b === null ? landedTotal : b));
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
            // r722: defensive — rows without a string runId or note are
            // skipped (tolerant input, the never-throw doctrine).
            runs: Array.isArray(j.runs)
              ? (j.runs as LedgerRunRow[]).filter(
                  (r) =>
                    r &&
                    typeof r === "object" &&
                    typeof r.runId === "string" &&
                    typeof r.note === "string"
                )
              : undefined,
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
  // r723: corpus-only runs — durable ledger rows whose runId matches NO card
  // on this board (neither the workflows store's runs nor the server lane).
  // The r722 diag proved the gap is REAL: Owner runs POST their gate events
  // to the ledger but exist as run rows ONLY in the browser that ran them
  // (sync-runs: 0; this store holds sample runs) — the corpus outlives the
  // store, so the board now RENDERS what it cannot see, per run, instead of
  // silently dropping it. Zero-gate runs still render nothing (r648 kept:
  // CorpusRunChip returns null for an empty census).
  const cardRunIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const r of serverRuns) ids.add(r.id);
    for (const wf of workflows) for (const r of wf.runs) ids.add(r.id);
    return ids;
  }, [serverRuns, workflows]);
  const corpusOnly = React.useMemo(() => {
    const byRun = new Map<string, LedgerRunRow[]>();
    for (const r of ledger?.runs ?? []) {
      if (cardRunIds.has(r.runId)) continue;
      const list = byRun.get(r.runId) ?? [];
      list.push(r);
      byRun.set(r.runId, list);
    }
    return [...byRun.entries()].map(([runId, rows]) => ({ runId, rows }));
  }, [ledger, cardRunIds]);
  // r724: the ⧉ chip's u/nj split — the durable corpus classified through
  // the SAME gateCensusOf adapter (one classifier, a third source: card
  // callLog, server lane, digest-level ledger rows — the r649 doctrine).
  // HONESTY BOUND: /api/evals ships the newest 400 rows, so the split
  // renders only when the payload covers the whole corpus (runs.length
  // >= total) AND the split fully accounts for the honest ∅ lump — a
  // partial sample never masquerades as a full census.
  const corpusCensus = React.useMemo(() => {
    const rows = (ledger?.runs ?? []).map((r) => {
      const at = r.createdAt ? Date.parse(r.createdAt) : NaN;
      return { note: r.note, ...(Number.isFinite(at) ? { at } : {}) };
    });
    return gateCensusOf(rows);
  }, [ledger]);
  const corpusCovered =
    (ledger?.runs?.length ?? 0) >= (ledger?.total ?? 0) && (ledger?.total ?? 0) > 0;
  const corpusSplitHonest =
    corpusCovered &&
    corpusCensus.uncertain + corpusCensus.noJudge > 0 &&
    corpusCensus.uncertain + corpusCensus.noJudge >= (ledger?.total ?? 0) - (ledger?.verdicts ?? 0);
  // r729: the digest copy-all button's key set — DISTINCT run ids in
  // payload order (newest first). Rendered only when corpusCovered gates
  // it (the r724 honesty bound): a partial census payload never poses as
  // the full key set.
  const corpusRunIds = React.useMemo(() => {
    const seen: string[] = [];
    for (const r of ledger?.runs ?? []) if (!seen.includes(r.runId)) seen.push(r.runId);
    return seen;
  }, [ledger]);
  // r724: the corpus strip's own glance tally — runs · events · verdicts
  // · u/nj, aggregated over the strip's rows through the same adapter, so
  // the judge-lane signal (nj) reads without scanning per-run chips.
  const stripCensus = React.useMemo(
    () => gateCensusOf(corpusOnly.flatMap((c) => c.rows)),
    [corpusOnly]
  );
  const stripEvents = corpusOnly.reduce((n, c) => n + c.rows.length, 0);
  // r726: corpus click-through — the strip pills become buttons (focus
  // ring + aria-expanded) opening a per-run detail panel built from the
  // durable ledger rows ALONE (no card, no store): every event note
  // verbatim — the judge dial trace included — each classified per row
  // through the SAME gateCensusOf adapter (the r649 doctrine).
  const [openCorpusRun, setOpenCorpusRun] = React.useState<string | null>(null);
  // r732: type-to-find on the corpus strip — the corpus grew +2-3 LIVE rows
  // per patrol slot (14 runs and climbing), and the copy roads (r728/r729/
  // r731) hand over ids and ladder text that want an instant way to ISOLATE
  // one run. Substring match on the run id; an honest ghost when nothing
  // matches (r648 — never a fake empty success); the tally keeps describing
  // the WHOLE corpus while an "n of N shown" chip states the filter truth.
  const [pillFilter, setPillFilter] = React.useState("");
  // r752: lane-filter on the legend chips - the r751 magnitude answers
  // "how often"; this answers "WHERE": clicking a lane chip isolates the
  // runs whose ledger rows name that lane (row-level scan, since the
  // pill filter matches runId substrings only). The strip tally keeps
  // describing the WHOLE corpus; the shown-count chip states the filter
  // truth, and an active filter stays visible and clearable even when
  // the legend is closed.
  const [laneFilter, setLaneFilter] = React.useState<string | null>(null);
  const pillQuery = pillFilter.trim().toLowerCase();
  // r736: the failing lanes named on the nj token's title (see laneDistressOf).
  const laneDistress = React.useMemo(() => laneDistressOf(corpusOnly), [corpusOnly]);
  // r751: per-lane dial-attempt counts for the legend chips - the same
  // scan as laneDistressOf, tallying instead of deduping (laneCountsOf).
  const laneCounts = React.useMemo(() => laneCountsOf(corpusOnly), [corpusOnly]);
  // r753: distinct runs affected per lane - the driver-first sort and
  // the runs figure ride this same corpus re-aggregation.
  const laneRunCounts = React.useMemo(() => laneRunCountsOf(corpusOnly), [corpusOnly]);
  // r755: first-seen per lane (UTC) - the cadence instrument the r754
  // handoff armed; it ships into the r754->r755 growth wave.
  const laneFirstSeen = React.useMemo(() => laneFirstSeenOf(corpusOnly), [corpusOnly]);
  // r756: last-seen per lane (UTC) - the mirror instrument; the first/last
  // pair brackets each wave (shipped mid-round as the wave pivot).
  const laneLastSeen = React.useMemo(() => laneLastSeenOf(corpusOnly), [corpusOnly]);
  // r757: dials-over-time buckets - 15-minute UTC slots per lane and
  // corpus-wide; the mini-strip the r756 handoff queued, shipped into the
  // THIRD consecutive growth slot (the first three-wave burst).
  const laneBuckets = React.useMemo(() => laneBucketsOf(corpusOnly), [corpusOnly]);
  const waveStrip = React.useMemo(() => {
    const src = laneFilter ? laneBuckets.lanes[laneFilter] : laneBuckets.corpusRows;
    const keys = Object.keys(src).sort();
    // r763: per-bucket route letter - which middle-tier routes answered in
    // the bucket (q = qwen-only, g = glm-only, m = both). Corpus-wide by
    // design (it documents the relay's route state for that slot) and
    // rendered only in corpus mode - a lane-filtered strip is about one
    // lane, not the relay. Same single laneBuckets dependency.
    const route: Record<string, string> = {};
    // r773: per-bucket named-lane list - the lanes with at least one dial
    // row in the slot, the same scan the route letters read. The r772
    // both-silent investigation hit the gap: a letterless chip hover
    // carried the span but no lane names. The list closes that on-page.
    const named: Record<string, string[]> = {};
    const gap: Record<string, number> = {};
    let prevKey: string | null = null;
    for (const k of keys) {
      let q = 0;
      let g = 0;
      for (const lane of Object.keys(laneBuckets.lanes)) {
        const tier = laneTierOf(lane);
        if (tier !== "middle · qwen route" && tier !== "middle · glm route") continue;
        const n = laneBuckets.lanes[lane]?.[k] ?? 0;
        if (tier === "middle · qwen route") q += n;
        else g += n;
      }
      if (q > 0 && g > 0) route[k] = "m";
      else if (q > 0) route[k] = "q";
      else if (g > 0) route[k] = "g";
      named[k] = Object.keys(laneBuckets.lanes).filter((lane) => (laneBuckets.lanes[lane]?.[k] ?? 0) > 0);
      if (prevKey && laneBuckets.bucketBounds[k] && laneBuckets.bucketBounds[prevKey]) gap[k] = Math.round((laneBuckets.bucketBounds[k].max - laneBuckets.bucketBounds[prevKey].max) / 60000);
      prevKey = k;
    }
    return { src, shown: keys.slice(-6), total: keys.length, spread: laneBuckets.laneSpread, bounds: laneBuckets.bucketBounds, route, named, gap };
  }, [laneBuckets, laneFilter]);
  // r758: divergence auto-highlight per lane - the recent-bucket lag
  // signal, amber-flagged on the chips; ships pre-armed (steady slot).
  const laneDivergence = React.useMemo(() => laneDivergenceOf(laneBuckets), [laneBuckets]);
  // r760: per-route state for the middle tier - which routes answered in
  // the newest corpus bucket. Derived from laneBuckets alone (its lane set
  // is the same scan as laneCounts), so the dependency stays single.
  const laneTiers = React.useMemo(() => {
    const keys = Object.keys(laneBuckets.corpusRows).sort();
    const lastKey = keys[keys.length - 1] ?? "";
    const routes: Record<string, { lanes: string[]; active: string[] }> = {};
    for (const lane of Object.keys(laneBuckets.lanes)) {
      const tier = laneTierOf(lane);
      if (!tier.startsWith("middle")) continue;
      if (!routes[tier]) routes[tier] = { lanes: [], active: [] };
      routes[tier].lanes.push(lane);
      if (lastKey && (laneBuckets.lanes[lane]?.[lastKey] ?? 0) > 0) routes[tier].active.push(lane);
    }
    return { lastKey, routes };
  }, [laneBuckets]);
  // r767: qwen-lean counter - the trailing run of identical route letters
  // across the shown strip window (last 6 corpus buckets), newest backward.
  // Reads the SAME route map the strip letters use - no new data source;
  // an absent letter (a bucket without middle-tier rows) breaks the run and
  // the window caps it at 6. r776: the memo also returns the pre-break run
  // (broken) so the tier-state line can witness the break instead of
  // silently dropping the tag. Corpus-scoped like the strip letters.
  const laneLean = React.useMemo(() => {
    const route = waveStrip.route;
    const keys = [...waveStrip.shown].reverse();
    let letter = "";
    let run = 0;
    let broken: { letter: string; run: number } | null = null;
    let i = 0;
    while (i < keys.length && !route[keys[i]]) i += 1;
    for (; i < keys.length; i++) {
      const cur = route[keys[i]];
      if (run === 0 || cur === letter) {
        letter = cur;
        run += 1;
      } else break;
    }
    const newestKey = waveStrip.shown[waveStrip.shown.length - 1] ?? "";
    if (newestKey && !route[newestKey] && run >= 2) broken = { letter, run };
    if (newestKey && !route[newestKey]) return { letter: "", run: 0, broken };
    return { letter, run, broken };
  }, [waveStrip]);
  // r768: interval readout - minutes between the newest corpus-row
  // timestamps of the two newest 15-min buckets (bucketBounds max-to-max,
  // the same pair the manual cadence track used). The cadence-band watch
  // made on-page: a gap far outside the band, or a zero-growth stretch
  // past its ceiling, is the interval-break signal. Corpus-scoped; reads
  // the bounds the strip hover already shows - no new data source.
  const laneGap = React.useMemo(() => {
    const keys = waveStrip.shown;
    const last = keys[keys.length - 1] ?? "";
    const prior = keys[keys.length - 2] ?? "";
    const b = waveStrip.bounds;
    if (!last || !prior || !b[last] || !b[prior]) return null;
    return Math.round((b[last].max - b[prior].max) / 60000);
  }, [waveStrip]);
  // r769: quiet readout - minutes elapsed since the newest corpus row of
  // the newest shown bucket (bounds max-to-now). The half of the cadence
  // watch laneGap cannot state: a zero-growth stretch past the band
  // ceiling is the burst-ended signal, and this read shows it without
  // arithmetic. Clock read at render, gated behind mount so SSR and
  // hydration agree (no mismatched timestamp on first paint); corpus-
  // scoped, reads the same bounds the strip hover shows - no new data
  // source.
  const [nowMounted, setNowMounted] = React.useState(false);
  const [quietTick, setQuietTick] = React.useState(0);
  // r770: live tick - the quiet value re-ticks every 30s while the board
  // is open, so the staleness meter stays honest on a quiet board (the
  // exact scenario it monitors); the interval is cleaned up on unmount.
  React.useEffect(() => {
    setNowMounted(true);
    const id = window.setInterval(() => setQuietTick((t) => t + 1), 30000);
    return () => window.clearInterval(id);
  }, []);
  // r770: amber signal tone - past the recorded plateau ceiling (62, the max
  // of the pre-burst 13/16/41/58/13/42/62/57/61 track; wave 11 then landed
  // at +70m, first data point of the post-burst band) the quiet tag takes
  // the amber signal tone: the burst-ended witness, same convention as the
  // divergence diamonds - a signal, not a fault (amber-tone doctrine).
  const QUIET_CEILING = 62;
  const laneQuiet = React.useMemo(() => {
    if (!nowMounted) return null;
    const keys = waveStrip.shown;
    const last = keys[keys.length - 1] ?? "";
    const b = waveStrip.bounds;
    if (!last || !b[last]) return null;
    const dt = Math.round((Date.now() - b[last].max) / 60000);
    return dt >= 0 ? dt : null;
  }, [waveStrip, nowMounted, quietTick]);
  const visibleCorpus = React.useMemo(() => {
    let out = corpusOnly;
    if (pillQuery) out = out.filter((c) => c.runId.toLowerCase().includes(pillQuery));
    if (laneFilter) out = out.filter((c) => c.rows.some((r) => (r.note || "").includes(laneFilter)));
    return out;
  }, [corpusOnly, pillQuery, laneFilter]);
  const detailRun = openCorpusRun
    ? corpusOnly.find((c) => c.runId === openCorpusRun) ?? null
    : null;
  const detailRows = React.useMemo(
    () => (detailRun ? [...detailRun.rows].sort((a, b) => evAtMs(a.createdAt) - evAtMs(b.createdAt)) : []),
    [detailRun]
  );
  const detailCensus = React.useMemo(
    () =>
      gateCensusOf(
        detailRows.map((r) => {
          const at = evAtMs(r.createdAt);
          return { note: r.note, ...(at > 0 ? { at } : {}) };
        })
      ),
    [detailRows]
  );
  const detailFam = React.useMemo(() => familyTallyOf(detailRows.map((r) => r.note)), [detailRows]);
  // r684 corpus freshness, r689 lifted to src/lib/ledger-freshness.ts —
  // one contract, one home (the r677 family-witness precedent); the chip
  // imports the same helper the fixture freezes. Compact age token for the
  // ⧉ chip ("now" / "4m" / "3h" / "2d"), null when the timestamp is missing
  // or unreadable: an honest absence, never a fake "now". Clock skew
  // clamps to "now". A corpus quiet >= 1h reads stale (amber token).
  const ledgerLatest = ledger?.latest?.[0];
  const ledgerAge = ledgerAgeOf(ledgerLatest?.createdAt);
  const ledgerStale = ledgerAgeIsStale(ledgerLatest?.createdAt);
  // r691: corpus growth since this page opened (null baseline -> 0; the
  // badge renders only positive deltas — a hygiene trim can read negative
  // and is honestly shown as nothing, never as a fake decline or growth).
  const ledgerGrowth = ledger !== null && ledgerBaseline !== null ? ledger.total - ledgerBaseline : 0;
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
    let uncertain = 0;
    let noJudge = 0;
    // r682: witness tally over the SAME visible set — the corpus ledger may
    // hold more (server-side finalization POSTs after the browser is gone);
    // the digest makes the visible-vs-corpus gap legible instead of silent.
    const notes: Array<string | null | undefined> = [];
    // r692: visible-run gate freshness — the newest census-counted `at`
    // across the visible set (the ⚖ chip's own age token; the ⧉ token's
    // visible-vs-corpus counterpart).
    const gateStamps: number[] = [];
    (Object.values(visible) as BoardCard[][]).forEach((cards) =>
      cards.forEach((c) => {
        if (!c.run) return;
        const census = gateCensusOf(c.run.callLog);
        if (census.engaged === 0 && census.verdicts === 0) return;
        engaged += 1;
        verdicts += census.verdicts;
        uncertain += census.uncertain;
        noJudge += census.noJudge;
        notes.push(...(c.run.callLog ?? []).map((row) => row?.note));
        if (typeof census.latestAt === "number") gateStamps.push(census.latestAt);
        if (census.verdicts > 0) {
          verdictRuns += 1;
          if (census.verdictTone === "fail") failRuns += 1;
        }
      })
    );
    const latestAt = gateStamps.length > 0 ? Math.max(...gateStamps) : undefined;
    return { engaged, verdictRuns, verdicts, failRuns, uncertain, noJudge, witness: familyTallyOf(notes), latestAt };
  }, [visible]);
  // r692: the ⚖ chip's own freshness — visible-run gate activity (callLog
  // `at`, read through the same ledger-freshness home) beside the corpus's
  // (⧉ token). Divergence is glanceable: a fresh corpus beside a stale
  // visible set — or the reverse — reads without hovering.
  const gateAge = ledgerAgeOf(boardGates.latestAt);
  const gateStale = ledgerAgeIsStale(boardGates.latestAt);
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
        <div className="max-w-md space-y-1">
          <p>Nothing on the board yet — run a pipeline and its cards land here.</p>
          {/* r694: the r648 doctrine renders no census chip for an empty
          corpus — the silence stays, but on a fresh database it now explains
          itself in words on the empty-state surface the board already owns
          (conditioned on the ledger actually reading zero, never guessed). */}
          {ledger !== null && ledger.total === 0 ? (
            <p className="text-xs opacity-80">
              The eval ledger is empty so far — it grows as finished runs
              finalize server-side, and the census chip appears with the first
              archived gate event.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <EventEmitBar />
      {boardHarness.runs > 0 ? (
        <p
          className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[10px] tabular-nums text-muted-foreground"
          title="TraceTrial F3 (arXiv 2610.32285): runs that finished green while violating at least one harness criterion — success is not reliable. Judged separately from the task outcome. The ⚖ chip aggregates the Decision gate's call-log census across visible runs — amber when any run's latest verdict is a FAIL, emerald when verdicts landed clean, muted while judges stay unanswered. The u/nj suffixes decode the ungated side: u = the judge answered below confidence (uncertain), nj = no judge answered — that step ran ungated. The ◈/◇ witness count covers the VISIBLE runs' call-log notes only; the ⧉ ledger chip's tally covers every archived event in SQLite — including runs whose client record never landed, because server-side finalization POSTs after the browser is gone (the corpus outlives the trimmed store)."
        >
          <span>
            {boardHarness.runs} run{boardHarness.runs === 1 ? "" : "s"} on the board
          </span>
          <span className="text-muted-foreground/60">
            · ⚖ legend: verdict = confident judge call · u = judge answered below confidence · nj = no judge answered — that step ran ungated
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
              aria-label={`Visible runs' gate census: ${boardGates.engaged} gate calls, ${boardGates.verdicts} verdicts${boardGates.failRuns > 0 ? `, ${boardGates.failRuns} latest-FAIL` : ""}, chip ${boardGates.failRuns > 0 ? "amber, a run's latest verdict is a FAIL" : boardGates.verdictRuns > 0 ? "emerald, verdicts landed clean" : "muted, judges unanswered"}${boardGates.witness.cross + boardGates.witness.same > 0 ? `, drift ${boardGates.witness.cross} cross-family, ${boardGates.witness.same} same-family` : ""}. The ledger chip beside it covers the durable corpus.`}
              className={cn(
                "inline-flex cursor-help items-center rounded-full border px-1.5 py-px font-semibold tabular-nums transition-colors",
                CHIP_FOCUS_RING,
                boardGates.failRuns > 0
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : boardGates.verdictRuns > 0
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border bg-muted/40 text-muted-foreground"
              )}
            >
              ⚖ {boardGates.engaged} gate call{boardGates.engaged === 1 ? "" : "s"} · {boardGates.verdicts} verdict{boardGates.verdicts === 1 ? "" : "s"}
              {boardGates.failRuns > 0 ? ` · ${boardGates.failRuns} latest-FAIL` : ""}
              <GateSuffix census={boardGates} />
              {boardGates.witness.cross > 0 ? (
                <span className="ml-1 text-violet-600 dark:text-violet-400">◈{boardGates.witness.cross}</span>
              ) : null}
              {boardGates.witness.same > 0 ? (
                <span className="ml-1 text-muted-foreground">◇{boardGates.witness.same}</span>
              ) : null}
              {/* r692: the ⚖ chip's own freshness token — visible-run gate
              activity beside the corpus's (⧉ token). Same family styling:
              muted, font-normal, amber when stale; own title + pointer-honest
              per the family contract; hover-only (the chip is the
              focusable surface). r695: stale also gains a dotted underline —
              on a FAIL-toned amber chip the amber text alone would vanish
              against itself. r696: the underline is structural (transparent
              while fresh) and its color fades in with the amber — the shift
              obeys the r690 fade doctrine, never snaps. r697: hover brightens
              (opacity 70→100) and the transition set widens to cover it. */}
              {gateAge ? (
                <span
                  title={`Visible runs' newest gate activity is ${gateAge === "now" ? "moments" : gateAge} old${gateStale ? " — quiet for over an hour (amber): the visible set's gate story is stale even if the durable corpus is not (they see different runs — the visible-vs-corpus split)." : " — the corpus token (⧉) covers every archived event; this one covers only the browser's visible runs."}`}
                  className={cn("ml-1 cursor-help font-normal opacity-70 transition duration-500 hover:opacity-100 underline decoration-dotted underline-offset-2 decoration-transparent", gateStale && "text-amber-600 dark:text-amber-400 decoration-amber-600 dark:decoration-amber-400")}
                >
                  · {gateAge}
                </span>
              ) : null}
            </span>
          ) : null}
          {ledger !== null && ledger.total > 0 ? (
            <span
              tabIndex={0}
              title={`RSI eval ledger (durable SQLite): ${ledger.total} gate event${ledger.total === 1 ? "" : "s"} archived from finished runs — ${ledger.verdicts} verdict${ledger.verdicts === 1 ? "" : "s"}, ${ledger.fails} FAIL${ledger.fails === 1 ? "" : "s"}, ${ledger.total - ledger.verdicts} engaged without a confident verdict (uncertain / no judge answered / judge errored — the r659/r660 honest-trace family, never counted as a pass). The chip reads amber while a FAIL verdict sits in the corpus (the bold ✕F beside the tally), emerald once verdicts have landed clean, muted before the first confident verdict. The training corpus outlives the browser's trimmed localStorage store (the KICK corpus's interaction_logs pattern, adapted).${ledger.family && ledger.family.cross + ledger.family.same > 0 ? ` Drift witness: ◈ ${ledger.family.cross} cross-family · ◇ ${ledger.family.same} same-family judge note(s) — narcissistic-drift avoidance, self-reported by the corpus.` : ""}${typeof ledgerLatest?.kind === "string" && ledgerAge !== null ? ` Latest event: ${ledgerLatest.kind}${typeof ledgerLatest.verdict === "string" && ledgerLatest.verdict ? ` ${ledgerLatest.verdict}` : ""}${typeof ledgerLatest.confidence === "number" ? ` ${ledgerLatest.confidence}%` : ""}${typeof ledgerLatest.workflow === "string" && ledgerLatest.workflow ? ` on ${ledgerLatest.workflow}` : ""} — ${ledgerAge === "now" ? "just now" : `${ledgerAge} ago`}${ledgerStale ? " — corpus quiet for over an hour (amber staleness signal)" : ""}.` : ""}${corpusCovered ? ` The u/nj split classifies the archived gate notes through the shared census adapter — one classifier, a third source: card callLog, server lane, digest rows.` : ` The u/nj split stays hidden — the census payload (newest 400 rows) does not yet cover the whole corpus, so the honest ∅ lump remains.`}`}
              aria-label={`Eval ledger, durable corpus: ${ledger.total} archived gate events, ${ledger.verdicts} verdicts, ${ledger.fails} failures, ${ledger.total - ledger.verdicts} engaged without a confident verdict, chip ${ledger.fails > 0 ? "amber, a FAIL verdict sits in the corpus" : ledger.verdicts > 0 ? "emerald, verdicts landed clean" : "muted, no confident verdict yet"}${ledger.family ? `, drift ${ledger.family.cross} cross-family, ${ledger.family.same} same-family` : ""}${typeof ledgerLatest?.kind === "string" && ledgerAge !== null ? `. Latest event ${ledgerLatest.kind}${typeof ledgerLatest.verdict === "string" && ledgerLatest.verdict ? ` ${ledgerLatest.verdict}` : ""}${typeof ledgerLatest.workflow === "string" && ledgerLatest.workflow ? ` on ${ledgerLatest.workflow}` : ""}, ${ledgerAge === "now" ? "just now" : `${ledgerAge} ago`}${ledgerStale ? ", corpus quiet for over an hour" : ""}` : ""}${corpusCovered ? " The tally splits into uncertain and no-judge through the shared census adapter." : " The u/nj split stays hidden until the census payload covers the whole corpus."}`}
              className={cn(
                "inline-flex items-center rounded-full border px-1.5 py-px font-semibold tabular-nums transition-colors cursor-help",
                CHIP_FOCUS_RING,
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
              muted ∅K keeps an unanswered gate from masquerading as health.
              r724: when the census payload covers the whole corpus and the
              split fully accounts for the lump, ∅ gives way to the shared
              u/nj tokens (GateSuffix — the same component as every ⚖ chip,
              the r649 render doctrine); otherwise the honest lump stays. */}
              {corpusSplitHonest ? (
                <GateSuffix census={corpusCensus} />
              ) : ledger.total - ledger.verdicts > 0 ? (
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
              {/* r691: auto-growth leaves the worklog — the session delta of
              the durable total reads at a glance (emerald ▲N), the same
              vocabulary as the family tone spans. Hover for the doctrine. */}
              {ledgerGrowth > 0 ? (
                <span
                  title={`▲ ${ledgerGrowth} gate event${ledgerGrowth === 1 ? "" : "s"} landed in the durable corpus since this page opened — the board's own runs finalizing server-side (the r672 fire-and-forget wiring). The badge is this session's delta of the total, never a live stream; a ledger hygiene trim can only read as nothing here, not as a decline.`}
                  className="ml-1 cursor-help font-semibold text-emerald-600 dark:text-emerald-400"
                >
                  ▲{ledgerGrowth}
                </span>
              ) : null}
              {/* r684/r690: freshness at a glance — the corpus outlives the
              browser; the age token says whether it is still breathing, no
              hover. r690 makes staleness multi-channel: amber tone (r689),
              the token's own hover doctrine, a spoken sentence in the chip's
              aria-label, and a transition so the shift fades rather than
              snaps. The token stays hover-only (the parent ⧉ chip is the
              focusable surface) and pointer-honest per the family contract.
              r695 adds a fourth channel that survives every chip tone: a
              dotted underline — a FAIL-led census turns the whole chip amber,
              and amber-on-amber would hide the shift. r696: the underline is
              structural (transparent while fresh) and fades in with the
              color — transition-colors covers text-decoration-color. r697:
              the transition widens to the full default set (opacity aboard)
              and hover brightens the token 70→100 — the cursor-help promise
              gets a visual answer. */}
              {ledgerAge ? (
                <span
                  title={`Newest corpus event is ${ledgerAge === "now" ? "moments" : ledgerAge} old${ledgerStale ? " — quiet for over an hour (amber): a stalled-runner signal; investigate the runner (free-ladder congestion / judge availability), not the chip. Missing timestamps never alarm, and clock skew clamps to now." : " — still breathing; the token turns amber past one hour."}`}
                  className={cn("ml-1 cursor-help font-normal opacity-70 transition duration-500 hover:opacity-100 underline decoration-dotted underline-offset-2 decoration-transparent", ledgerStale && "text-amber-600 dark:text-amber-400 decoration-amber-600 dark:decoration-amber-400")}
                >
                  · {ledgerAge}
                </span>
              ) : null}
            </span>
          ) : null}
          {/* r729: copy-all-run-ids beside the ⧉ digest chip — the census is
          glanceable but its KEYS weren't takeable; triage scripts (SQLite
          IN(...) queries, Cortex batches) want the whole id list at once.
          HONESTY BOUND: renders only when the census payload covers the
          whole corpus (the r724 bound) — a partial sample never poses as
          the full key set; nothing renders for an empty corpus (r648). */}
          {corpusCovered && corpusRunIds.length > 0 ? (
            <CopyAllRunIdsButton ids={corpusRunIds} />
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
              className={cn(
                "inline-flex items-center rounded-full border border-dashed border-border bg-muted/40 px-1.5 py-px text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
                CHIP_FOCUS_RING
              )}
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
                  ledgerRuns={ledger?.runs}
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
      {corpusOnly.length > 0 ? (
        <div
          data-testid="corpus-only-runs"
          className="mb-4 rounded-xl border border-border/60 bg-muted/20 p-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              title="Keyboard: arrow keys move between the run pills, Enter toggles the detail panel, Escape closes it."
            >
              ⧉ In the corpus, not on this board
            </span>
            {/* r724: the strip's aggregate glance tally — the per-run chips
            stay, but the header now sums them (runs · ev · verdicts · u/nj)
            through the same gateCensusOf adapter; tones follow the r718
            family contract (u amber, nj muted), never a rival vocabulary. */}
            <span
              className="text-[10px] tabular-nums text-muted-foreground cursor-help"
              title={`The strip's aggregate census: ${corpusOnly.length} run${corpusOnly.length === 1 ? "" : "s"} · ${stripEvents} archived gate event${stripEvents === 1 ? "" : "s"} · ${stripCensus.verdicts} confident verdict${stripCensus.verdicts === 1 ? "" : "s"}${stripCensus.uncertain > 0 ? ` · ${stripCensus.uncertain} uncertain (the judge answered below confidence)` : ""}${stripCensus.noJudge > 0 ? ` · ${stripCensus.noJudge} step${stripCensus.noJudge === 1 ? "" : "s"} no judge answered — the judge-lane distress signal; check relay health` : ""}. Classified through the same gateCensusOf adapter as every chip on this board (the r649 doctrine).`}
            >
              {corpusOnly.length} run{corpusOnly.length === 1 ? "" : "s"} · {stripEvents} ev · {stripCensus.verdicts} verdict{stripCensus.verdicts === 1 ? "" : "s"}
              {stripCensus.uncertain > 0 ? (
                <span className="mx-1 text-amber-600 dark:text-amber-400">· {stripCensus.uncertain}u</span>
              ) : null}
              {stripCensus.noJudge > 0 ? (
                <button
                  type="button"
                  onClick={() => setLanesOpen((v) => !v)}
                  aria-expanded={lanesOpen}
                  aria-controls="corpus-lane-legend"
                  className="mx-1 text-[10px] tabular-nums text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                  title={
                    laneDistress
                      ? "Lanes tried in these " + stripCensus.noJudge + " no-judge failures (the ledger's verbatim tried-trace, deduped): " + laneDistress + " — click for the on-page legend."
                      : undefined
                  }
                >
                  · {stripCensus.noJudge}nj
                </button>
              ) : null}
            </span>
            {/* r732: type-to-find — shrink the pill set to a run-id substring;
            Escape clears. The tally keeps describing the whole corpus; the
            count chip (while filtering) states the visible truth honestly. */}
            <input
              type="text"
              value={pillFilter}
              onChange={(e) => setPillFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setPillFilter("");
                }
              }}
              placeholder="filter run ids…"
              aria-label="Filter corpus run pills by run id substring"
              title="Type a run-id substring to shrink the pill set — pairs with the copy roads: paste a copied run id or ladder key here to isolate its run. Escape clears."
              spellCheck={false}
              className={cn(
                "h-6 w-36 shrink-0 rounded-md border border-border/60 bg-background/60 px-2 font-mono text-[10px] text-foreground placeholder:text-muted-foreground/60",
                "focus:border-violet-500/50 focus:outline-none",
                CHIP_FOCUS_RING
              )}
            />
            {pillQuery || laneFilter ? (
              <span
                className="text-[10px] tabular-nums text-muted-foreground"
                title="Visible pills vs the whole corpus while a filter is active — the tally keeps describing the full corpus."
              >
                {visibleCorpus.length} of {corpusOnly.length} shown
              </span>
            ) : null}
            {laneFilter && !(lanesOpen && laneDistress) ? (
              <button
                type="button"
                onClick={() => setLaneFilter(null)}
                aria-label={"Clear the lane filter: " + laneFilter}
                title="A lane filter is active but the legend is closed — this chip keeps it visible and clearable. Click to clear."
                className="inline-flex max-w-44 items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400"
              >
                <span className="truncate">lane: {laneFilter}</span>
                <span aria-hidden>✕</span>
              </button>
            ) : null}
            {/* r735: the matching-state exit — with the filter active AND pills
                showing, clearing used to demand refocus + select-all + delete;
                the r734 ghost button only covers the no-match dead end. Same one
                mechanism as Escape (setPillFilter("")); the two affordances are
                mutually exclusive by state (matches → this chip, dead end → the
                ghost's Clear button), so the vocabulary never doubles. */}
            {pillQuery && visibleCorpus.length > 0 ? (
              <button
                type="button"
                onClick={() => setPillFilter("")}
                aria-label="Clear the corpus run filter"
                title="Clear the filter and restore every corpus pill — the mouse path beside Escape (the ghost's Clear button covers the no-match dead end)."
                className={
                  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background font-mono text-[10px] leading-none text-foreground/70 transition-colors hover:border-violet-400/60 hover:text-foreground " +
                  CHIP_FOCUS_RING
                }
              >
                ✕
              </button>
            ) : null}
            {pillQuery && visibleCorpus.length > 0 ? (
              <CopyVisibleRunIdsButton ids={visibleCorpus.map((c) => c.runId)} />
            ) : null}
            <span className="h-px flex-1 bg-border/60" aria-hidden />
          </div>
          {lanesOpen && laneDistress ? (
            <div
              id="corpus-lane-legend"
              data-testid="corpus-lane-legend"
              title="Per-lane dial-attempt counts from the ledger's verbatim tried-trace (the same scan as the nj token's title, tallying instead of deduping). Counts are trace entries: a step that tried several lanes counts each, so the sum can exceed the no-judge step count. First-seen dates (r755) are the earliest fetched row naming the lane, UTC, bounded by the newest-400-rows window. Last-seen (r756) is the latest such row - the first/last pair brackets each wave; a lane whose last-seen lags the others is the partial-ladder signal. The wave strip (r757) buckets no-judge rows - or the filtered lane's dials - into 15-minute UTC slots; per-lane bucket lists live in each lane chip title, and since r773 each strip bucket chip names its lanes on hover too (r774: with per-lane dial counts) - a letterless bucket states why it carries no letter. The divergence diamond (r758) ambers a lane whose last-3-bucket profile lags the corpus strip, auto-highlighted on the chip face; r759 semantics: a lag fires on middle-tier route shifts too (the chain's middle tier alternates the qwen free pair and the glm-5.3 pair) - check the laggard lanes before interpreting. The tier-state line (r760) groups the middle tier by route: ACTIVE = the route answered in the newest corpus bucket; silent = the route is currently unpicked (the route-shift witness standing watch both ways - a silent->ACTIVE flip on the qwen routes = the free routes returning)."
              className="mb-2 flex flex-wrap items-center gap-1 rounded-md border border-border/60 bg-muted/20 p-2"
            >
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                lanes tried ({stripCensus.noJudge} no-judge)
              </span>
              {Object.keys(laneTiers.routes).length ? (
                <span
                  data-testid="corpus-tier-state"
                  className="mr-1 text-[10px] tabular-nums text-muted-foreground/70 cursor-help"
                  title={"Route-state (r760): the middle tier grouped by route against the newest corpus bucket (" + laneTiers.lastKey + ") - " + Object.entries(laneTiers.routes).map(([tier, r]) => tier + ": " + r.lanes.length + " lane(s), " + (r.active.length ? "ACTIVE" : "none answered")).join(" · ") + ". ACTIVE = the route answered in the newest corpus bucket; silent = the route is unpicked (route-shift witness, r759 finding). Silent lanes are named inline after the count (r772) - the both-silent and partial-bucket investigations read without opening the chips. The letter (r764) is the newest-bucket route composition from the wave strip: q = qwen-only, g = glm-only, m = both; absent = no middle-tier rows in that bucket. Letter history (r765) of the shown strip buckets, oldest first: " + (waveStrip.shown.map((k) => k + " " + (waveStrip.route[k] ?? "-")).join(" - ") || "none") + " (a dash = no middle-tier rows there). Lean counter (r767): the trailing run of identical route letters across the shown strip window (last 6 buckets), newest backward - an absent letter (a bucket without middle-tier rows) breaks the run, capped at the window; a run of 2+ renders the lean tag in this line - the on-page read of the relay lean watched since r766 (three straight qwen waves, 00:03/01:05/02:02, ended the wave-by-wave alternation). Interval readout (r768): minutes between the newest corpus-row timestamps of the two newest strip buckets (bounds max-to-max) - the cadence band (13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58 so far - the 70 opened the post-burst band, the 6 is the wave-12 readout, the 73 is the wave-13 readout (bucket 05:00 to 06:15 maxes), the 55 is the wave-14 readout, the 59 is the wave-15 readout (a letterless bucket - the cadence counts it, the r767 lean run breaks), the 62 is the wave-16 readout, the 57 is the wave-17 readout (bucket 09:00 to 10:00 maxes, landed mid-r779), the 58 is the wave-18 readout (bucket 10:00 to 11:00 maxes, landed mid-r780)) made on-page; a gap far outside the band, or a zero-growth stretch past its ceiling, is the interval-break signal. Quiet readout (r769/r770): minutes elapsed since the newest corpus row of the newest shown bucket, as of this render (mount-gated clock read so SSR and hydration agree; the value re-ticks every 30s while the board is open) - the zero-growth half of the cadence watch; past the 62-minute ceiling the tag takes the amber signal tone - the burst-ended witness (r768 band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58 - the 70 opened the post-burst band, the 6 is the wave-12 readout, the 73 is the wave-13 readout, the 55 is the wave-14 readout, the 59 is the wave-15 readout (letterless), the 57 is the wave-17 readout (landed mid-r779), the 58 is the wave-18 readout (landed mid-r780); same convention as the divergence diamonds, not a fault)."}
                >
                  {waveStrip.route[laneTiers.lastKey] ? <span className="font-medium text-foreground/70">{"bucket " + laneTiers.lastKey + " · " + waveStrip.route[laneTiers.lastKey] + " — "}</span> : null}{!laneFilter && laneLean.run >= 2 ? <span className="font-medium text-foreground/70" title={"Lean counter (r767): " + laneLean.run + " straight " + (laneLean.letter === "q" ? "qwen-route" : laneLean.letter === "g" ? "glm-route" : "both-routes") + " buckets ending at the shown window's newest lettered bucket; the trailing run of identical route letters (q = qwen-only, g = glm-only, m = both) within the shown strip window (last 6 buckets) - a bucket without middle-tier rows breaks the run. Watched since r766: three straight qwen waves (00:03, 01:05, 02:02) ended the wave-by-wave alternation."}>{" " + laneLean.letter + "-lean ×" + laneLean.run + " — "}</span> : null}{!laneFilter && laneLean.broken ? <span className="font-medium text-muted-foreground/60 cursor-help transition-colors" title={"Lean-run break (r776): the trailing letterless bucket (no middle-tier lane dialed) ended the lean run the r767 tag was counting - the r767 semantics witnessed on-page: a bucket without middle-tier rows breaks the run, the tag unrenders. The run restarts at the next lettered bucket (x1 renders no tag, x2 renders the lean tag again). This note renders only when the broken run was 2+ - the size that renders a tag."}>{" lean run broken (was " + laneLean.broken.letter + " ×" + laneLean.broken.run + ") — "}</span> : null}{!laneFilter && laneGap !== null ? <span className="font-medium text-foreground/70" title={"Interval readout (r768): " + laneGap + " minutes between the newest corpus-row timestamps of the two newest strip buckets (bounds max-to-max) - the cadence-band watch made on-page; the band so far: 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58 - the 70 opened the post-burst band, the 6 is the wave-12 readout (bucket 04:45 to 05:00 maxes), the 73 is the wave-13 readout (bucket 05:00 to 06:15 maxes, past the old 70 max), the 55 is the wave-14 readout (bucket 06:15 to 07:00 maxes), the 59 is the wave-15 readout (bucket 07:00 to 08:00 maxes; the wave-15 bucket is letterless - the cadence counts it, the r767 lean run breaks; r775 same-round correction: second-precision census math said 60, the ms-true render is 59), the 62 is the wave-16 readout (bucket 08:00 to 09:00 maxes, landed mid-r777), the 57 is the wave-17 readout (bucket 09:00 to 10:00 maxes, landed mid-r779), the 58 is the wave-18 readout (bucket 10:00 to 11:00 maxes, landed mid-r780) - a gap far outside it, or a zero-growth stretch past its ceiling, is the interval-break signal."}>{" +" + laneGap + "m since prior — "}</span> : null}{!laneFilter && laneQuiet !== null ? <span className={laneQuiet > QUIET_CEILING ? "font-medium transition-colors text-amber-600 dark:text-amber-400" : "font-medium transition-colors text-foreground/70"} title={"Quiet readout (r770): " + laneQuiet + " minutes elapsed since the newest corpus row of the newest shown bucket, as of this render (the value re-ticks every 30s while the board is open) - the zero-growth half of the cadence watch (r768 band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58 - the 70 opened the post-burst band, the 6 is the wave-12 readout, the 73 is the wave-13 readout, the 55 is the wave-14 readout (bucket 06:15 to 07:00 maxes), the 59 is the wave-15 readout (bucket 07:00 to 08:00 maxes, a letterless bucket), the 62 is the wave-16 readout (bucket 08:00 to 09:00 maxes, landed mid-r777), the 57 is the wave-17 readout (bucket 09:00 to 10:00 maxes, landed mid-r779), the 58 is the wave-18 readout (bucket 10:00 to 11:00 maxes, landed mid-r780); the lull before wave 13 peaked past the ceiling, the amber fired mid-lull with no round open to see it - inferred from the 73 interval, disclosed; the r775 re-look (post-burst 6/73/55/59, mean 48.25m vs pre-burst mean 43.3m) finds the cadence regime compatible - the 62 ceiling is held, its one firing true); past the " + QUIET_CEILING + "-minute ceiling the tag takes the amber signal tone - the burst-ended witness, the same convention as the divergence diamonds, not a fault."}>{" +" + laneQuiet + "m quiet — "}</span> : null}{Object.entries(laneTiers.routes).map(([tier, r]) => tier.replace("middle · ", "mid·") + " " + (r.active.length ? "ACTIVE" : "silent") + " (" + r.active.length + "/" + r.lanes.length + (r.active.length < r.lanes.length ? " · silent: " + r.lanes.filter((l) => !r.active.includes(l)).map((l) => l.replace(/^fast-judge /, "").replace(" · ", " ")).join(", ") : "") + ")").join(" · ")}
                </span>
              ) : null}
              {[...laneDistress.split("; ")].sort((a, b) => (laneCounts[b] ?? 0) - (laneCounts[a] ?? 0)).map((lane, i) => (
                <button
                  key={i}
                  type="button"
                  aria-pressed={laneFilter === lane}
                  onClick={() => setLaneFilter((cur) => (cur === lane ? null : lane))}
                  className={cn(
                    "rounded border bg-background/60 px-1.5 py-0.5 text-[10px] transition-colors",
                    laneFilter === lane
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                  title={
                    (laneFilter === lane
                      ? "Active filter — click to clear it and restore every corpus pill"
                      : "Click to show only the runs whose ledger rows name this lane") +
                    " — " + lane + " — " + (laneCounts[lane] ?? 0) + " dial attempt(s) across " + (laneRunCounts[lane] ?? 0) + " run(s) affected" +
                    (laneFirstSeen[lane] !== undefined
                      ? " — first seen " + new Date(laneFirstSeen[lane]).toISOString().replace("T", " ").slice(0, 16) + " UTC (earliest fetched row naming this lane; window = newest 400 rows)"
                      : "") +
                    (laneLastSeen[lane] !== undefined
                      ? " — last seen " + new Date(laneLastSeen[lane]).toISOString().replace("T", " ").slice(0, 16) + " UTC (latest such row)"
                      : "") +
                    (laneBuckets.lanes[lane] !== undefined
                      ? " — by 15-min UTC bucket: " + Object.keys(laneBuckets.lanes[lane]).sort().map((k) => k + " ×" + laneBuckets.lanes[lane][k]).join(" · ")
                      : "") +
                    (laneDivergence[lane]
                      ? " — DIVERGES from the corpus strip in: " + laneDivergence[lane] + " (recent-bucket lag: route-preference shift or partial ladder - check the laggards before interpreting)"
                      : "")
                  }
                >
                  <span
                    className="mr-0.5 rounded bg-muted px-0.5 text-[9px] uppercase leading-4 tracking-wide text-muted-foreground/60"
                    title={"Rung (r760): " + laneTierOf(lane) + " — the dial-ladder rung this lane serves (r759: the chain is 5 lanes wide; the middle tier alternates routes)."}
                  >
                    {laneTierOf(lane).replace("middle · ", "mid·")}
                  </span>
                  {lane}
                  <span className="ml-1 rounded-full bg-amber-500/10 px-1 font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                    ×{laneCounts[lane] ?? 0}
                  </span>
                  <span className="ml-0.5 tabular-nums text-muted-foreground/70">
                    {laneRunCounts[lane] ?? 0} run{(laneRunCounts[lane] ?? 0) === 1 ? "" : "s"}
                  </span>
                  {laneFirstSeen[lane] !== undefined ? (
                    <span className="ml-0.5 tabular-nums text-muted-foreground/50">
                      {"· " + new Date(laneFirstSeen[lane]).toISOString().slice(5, 10)}
                    </span>
                  ) : null}
                  {laneLastSeen[lane] !== undefined && laneLastSeen[lane] !== laneFirstSeen[lane] ? (
                    <span className="ml-0.5 tabular-nums text-muted-foreground/50">
                      {"-> " + (new Date(laneLastSeen[lane]).toISOString().slice(5, 10) === new Date(laneFirstSeen[lane]).toISOString().slice(5, 10)
                        ? new Date(laneLastSeen[lane]).toISOString().slice(11, 16) + "Z"
                        : new Date(laneLastSeen[lane]).toISOString().slice(5, 10))}
                    </span>
                  ) : null}
                  {laneDivergence[lane] ? (
                    <span
                      data-div="1"
                      aria-label="Lane diverges from the corpus bucket profile"
                      title={"Divergence (r758): this lane's last-3-bucket profile lags the corpus strip — " + laneDivergence[lane] + " — a recent-bucket lag: with the r759 route-alternation finding this fires on middle-tier route shifts too; check the laggards before interpreting."}
                      className="ml-0.5 rounded bg-amber-500/15 px-1 text-[9px] font-semibold leading-4 text-amber-700 dark:text-amber-400"
                    >
                      ∆
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {waveStrip.total > 0 ? (
            <div
              data-testid="corpus-wave-strip"
              title={"Dials over time (r757): " + (laneFilter ? "dial attempts naming " + laneFilter : "no-judge ledger rows") + " bucketed into 15-minute UTC slots, oldest first, last 6 slots shown of " + waveStrip.total + ". Bounded by the newest-400-rows corpus fetch window (same as first/last-seen). The (N lanes) figure is the distinct lanes named per bucket - a mixed-tier bucket shows more (r759: the middle tier alternates the qwen free pair and the glm-5.3 pair, so a 7-lane bucket is a both-routes bucket). The mini-bar (r761) scales with the row count (2px per row, 16px cap); an amber bar marks a mixed-tier (both-routes) bucket, muted bars are single-tier - the route watch reads the bar color at a glance. The bucket hover (r762) shows the actual first/last corpus-row times inside the slot - the bucket key drops the year, the hover recovers it from the row epochs. The route letter (r763, corpus mode) names which middle-tier routes answered in the bucket: q = qwen-only, g = glm-only, m = both - the wave-by-wave relay alternation becomes legible in the strip text itself. The bucket chips are keyboard-focusable (r777): tab lands on a bucket and the browser surfaces its title tooltip on focus (Chromium and Firefox), the focus ring marks the landing - the hover-only bucket data (lanes named, counts, the max-to-max gap, the letterless why-sentence) reads without a pointing device."}
              className="mb-2 text-[11px] leading-4 tabular-nums text-muted-foreground/70 cursor-help"
            >
              {laneFilter ? "dials for " + laneFilter + " by 15-min UTC bucket: " : "no-judge rows by 15-min UTC bucket: "}
              {waveStrip.shown.map((k, i) => (
                <span
                  key={k}
                  tabIndex={0}
                  className="inline-flex items-end gap-1 whitespace-nowrap rounded-sm cursor-help transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:bg-muted/30 focus-visible:text-foreground/90"
                  title={"Bucket " + k + " UTC (15-min slot)" + (waveStrip.bounds[k] ? " — corpus rows actually span " + new Date(waveStrip.bounds[k].min).toISOString().slice(0, 19).replace("T", " ") + " to " + new Date(waveStrip.bounds[k].max).toISOString().slice(11, 19) + " UTC" : "") + (!laneFilter ? (waveStrip.gap[k] ? " — +" + waveStrip.gap[k] + "m since prior (max-to-max)" : "") + " — lanes named here: " + ((waveStrip.named[k] ?? []).length ? (waveStrip.named[k] ?? []).map((l) => l.replace(/^fast-judge /, "").replace(" · ", " ") + " ×" + (laneBuckets.lanes[l]?.[k] ?? 0)).join(", ") : "none") + (waveStrip.route[k] ? "" : " — no route letter: no middle-tier lane dialed in this slot, the lanes above are outer-rung lanes (the letter needs a middle-tier qwen or glm dial)") : "")}
                >
                  <span
                    aria-hidden
                    className={"inline-block w-1.5 rounded-sm " + (!laneFilter && (waveStrip.spread[k] ?? 0) > 5 ? "bg-amber-500/40" : "bg-muted-foreground/30")}
                    style={{ height: Math.max(2, Math.min(16, waveStrip.src[k] * 2)) + "px" }}
                  />
                  <span>{k + " ×" + waveStrip.src[k]}{!laneFilter && waveStrip.route[k] ? <span className="font-medium text-foreground/70 transition-colors">{" " + waveStrip.route[k]}</span> : null}{laneFilter ? "" : " (" + (waveStrip.spread[k] ?? 0) + " lanes)"}</span>
                  {i < waveStrip.shown.length - 1 ? <span aria-hidden className="text-muted-foreground/40"> · </span> : null}
                </span>
              ))}
              {waveStrip.total > waveStrip.shown.length ? " (+" + (waveStrip.total - waveStrip.shown.length) + " older)" : ""}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {visibleCorpus.map(({ runId, rows }) => (
              <button
                key={runId}
                type="button"
                onClick={() => setOpenCorpusRun((cur) => (cur === runId ? null : runId))}
                aria-expanded={openCorpusRun === runId}
                aria-controls={openCorpusRun === runId ? "corpus-detail-" + runId : undefined}
                onKeyDown={(e) => {
                  // r727: keyboard traversal — ArrowDown/ArrowUp move between
                  // the run pills without leaving the strip (no full Tab
                  // cycle), Escape collapses the open panel from its own
                  // pill (focus stays put; aria-expanded flips with state).
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const row = e.currentTarget.parentElement;
                    const pills = row ? Array.from(row.querySelectorAll("button")) : [];
                    const i = pills.indexOf(e.currentTarget);
                    const next = pills[i + (e.key === "ArrowDown" ? 1 : -1)];
                    if (next) next.focus();
                  } else if (e.key === "Escape" && openCorpusRun === runId) {
                    setOpenCorpusRun(null);
                  }
                }}
                title="Per-run gate detail from the durable ledger rows alone — every event note verbatim, the judge dial trace included when the judge never answered. Click to expand or collapse."
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border bg-card/60 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors",
                  "hover:border-violet-500/40 hover:text-foreground",
                  CHIP_FOCUS_RING,
                  openCorpusRun === runId && "border-violet-500/50 bg-violet-500/10 text-foreground"
                )}
              >
                <CorpusRunChip rows={rows} tabbable={false} />
                <code className="font-mono">{runId.length > 20 ? runId.slice(0, 20) + "…" : runId}</code>
                <span className="tabular-nums">{rows.length} ev</span>
                {laneRunLetterOf(rows) ? (
                  <span
                    className="font-medium text-foreground/70"
                    title={"run route letter (r766): which middle-tier routes this run touched - q = qwen-only, g = glm-only, m = both (an m run is the investigate signal)"}
                  >
                    {laneRunLetterOf(rows)}
                  </span>
                ) : null}
                <ChevronDown
                  className={cn("h-3 w-3 shrink-0 transition-transform", openCorpusRun === runId && "rotate-180")}
                  aria-hidden
                />
              </button>
            ))}
          </div>
          {visibleCorpus.length === 0 && (pillQuery || laneFilter) ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
              <span>
                No corpus runs match{" "}
                {[pillQuery ? '"' + pillFilter.trim() + '"' : "", laneFilter ? "the lane filter (" + laneFilter + ")" : ""]
                  .filter(Boolean)
                  .join(" + ") || "the active filters"}{" "}
                — all {corpusOnly.length} corpus runs are hidden by the active filter{pillQuery && laneFilter ? "s" : ""}.
              </span>
              {/* r734: the ghost used to only INSTRUCT clearing (Escape works solely while the
                  input holds focus) — the affordance now exists where the dead end is. Same one
                  mechanism as Escape (setPillFilter("")), no rival vocabulary. */}
              <button
                type="button"
                onClick={() => {
                  setPillFilter("");
                  setLaneFilter(null);
                }}
                aria-label="Clear the active filters and show all corpus run pills"
                className={
                  "inline-flex h-5 shrink-0 items-center rounded-md border border-border/60 bg-background px-2 font-mono text-[10px] text-foreground/80 transition-colors hover:border-violet-400/60 hover:text-foreground " +
                  CHIP_FOCUS_RING
                }
              >
                Clear filter
              </button>
            </p>
          ) : null}
          {detailRun ? (
            <div
              id={"corpus-detail-" + detailRun.runId}
              data-testid="corpus-run-detail"
              role="region"
              aria-label={"Gate event detail for " + detailRun.runId + " — built from the durable ledger rows alone"}
              className="mt-2 rounded-lg border border-border/60 bg-card/50 p-3 text-[11px]"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  <code className="font-mono text-foreground">{detailRun.runId}</code>
                  <CopyRunIdButton runId={detailRun.runId} />
                  <CopyLadderButton
                    runId={detailRun.runId}
                    rows={detailRows}
                    census={detailCensus}
                  />
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {detailRows.length} event{detailRows.length === 1 ? "" : "s"} · engaged {detailCensus.engaged} · {detailCensus.verdicts} verdict{detailCensus.verdicts === 1 ? "" : "s"}
                  <GateSuffix census={detailCensus} />
                </span>
                {detailFam.cross + detailFam.same > 0 ? (
                  <span className="text-muted-foreground">
                    ◈ {detailFam.cross} cross-family · ◇ {detailFam.same} same-family
                  </span>
                ) : null}
              </div>
              {detailRows.length > 0 ? (
                <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {detailRows.map((row, i) => (
                    <CorpusEventRow key={detailRun.runId + "-" + i} row={row} />
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted-foreground">No durable events for this run in the current payload.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
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
