"use client";

import "@/lib/migration";
import {
  idbAvailable as idbAvailableFn,
  idbDeleteRun,
  idbCountRuns,
  idbClearRuns,
  idbGetRun,
  idbListRuns,
  idbPutRun,
} from "./storage-tiers";
import { mirrorRunToCloud } from "./cloud-mirror";

// ─── r486-a: Run Archive — the local persistence + export wire ───────────────
// The owner's ask: "the works are getting lost in the thin air due to no
// collection archive saving or batch complete pack downloading of the workflow
// conversation logs of outputs." The r414 trimmers mean the live run store
// forgets, and the r455 DB tier needs the server — this module is the
// OFFLINE-FIRST tier: every settled run lands in localStorage under
// "nexus.run-archive.v1", is browsable in Workflows → Archive, exports as
// batch Markdown/JSON packs, and feeds successors via digestRecent() (the RSI
// continuity wire, consumed by the run panel's digest checkbox).
//
// Doctrine (mirrors the r455/r457 archive code): archiving is best-effort and
// MUST NEVER break or alter a run — every entry point is try/catch-wrapped,
// and QuotaExceeded sheds the oldest 25% instead of failing the write.
// Dependency-free by design: no store imports, no npm deps — callers hand in
// whatever shape they have (WorkflowRun rows, server-lane poll rows).
//
// r507 TIERING: the 5MB localStorage wall kept firing the "storage is full"
// warning because this single key held up to 300 runs with FULL step outputs.
// Every settled run is now MIRRORED to IndexedDB (src/lib/storage-tiers.ts —
// a ~hundreds-of-MB browser tier) the moment it lands, so a hot-tier shed is
// no longer data loss: `listArchiveFull()` merges both tiers back together.
// The hot index stays deliberately small; the warm tier keeps everything.

/** How a run was launched — provenance kept so successors can weigh context. */
export type RunArchiveTrigger = "manual" | "schedule" | "server";

/** Archive status — the engine's richer statuses compress into these four. */
export type RunArchiveStatus = "done" | "failed" | "stopped" | "partial";

export interface RunArchiveStep {
  name: string;
  agent: string;
  output: string;
  ms?: number;
}

export interface RunArchiveEntry {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger: RunArchiveTrigger;
  status: RunArchiveStatus;
  startedAt: string;
  finishedAt: string;
  totalMs?: number;
  model?: string;
  scheduleId?: string;
  notes?: string;
  steps: RunArchiveStep[];
}

/** Persisted shape (the `v` guard makes future migrations honest). */
interface ArchivePayload {
  v: 1;
  runs: RunArchiveEntry[];
}

const ARCHIVE_KEY = "nexus.run-archive.v1";
const BACKFILL_KEY = "nexus.run-archive.backfill.v1";
/** FIFO cap — the archive remembers 300 runs by finishedAt, oldest evicted. */
const MAX_ARCHIVE_RUNS = 300;
/** Continuity digest budget (chars) — mirrors the r457 PRIOR_TOTAL_CAP. */
const DIGEST_TOTAL_CAP = 4000;
const DIGEST_STEP_CAP = 240;
/** Warm-tier FIFO cap — IndexedDB holds hundreds of MB; 2000 runs is years
 * of scheduled pipelines and still trivially small for the disk. */
const MAX_IDB_RUNS = 2000;
/** Dispatched on every mutation so open surfaces live-refresh. */
export const RUN_ARCHIVE_EVENT = "nexus:run-archive-updated";
/** Exported for the panel's `storage`-event key filter. */
export const RUN_ARCHIVE_STORAGE_KEY = ARCHIVE_KEY;

// ─── storage primitives (all guarded — SSR-safe, corrupt-payload-safe) ──────

function isEntry(raw: unknown): raw is RunArchiveEntry {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Partial<RunArchiveEntry>;
  return (
    typeof r.id === "string" &&
    typeof r.workflowId === "string" &&
    typeof r.workflowName === "string" &&
    typeof r.status === "string" &&
    typeof r.startedAt === "string" &&
    typeof r.finishedAt === "string" &&
    Array.isArray(r.steps)
  );
}

function readStore(): ArchivePayload {
  try {
    if (typeof window === "undefined") return { v: 1, runs: [] };
    const raw = window.localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return { v: 1, runs: [] };
    const parsed = JSON.parse(raw) as Partial<ArchivePayload> | null;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.runs)) {
      return { v: 1, runs: [] };
    }
    return { v: 1, runs: parsed.runs.filter(isEntry) };
  } catch {
    return { v: 1, runs: [] }; // corrupt payload → behave like an empty archive
  }
}

/** Write through; on QuotaExceeded drop the oldest 25% and retry ONCE.
 * Returns false only when even the shed write failed (caller stays silent). */
function writeStore(payload: ArchivePayload): boolean {
  try {
    window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(payload));
    emitUpdated();
    return true;
  } catch {
    // Quota (or private-mode) failure: shed the oldest quarter and retry once.
    try {
      const keep = Math.max(1, Math.floor(payload.runs.length * 0.75));
      const shed = { v: 1 as const, runs: payload.runs.slice(payload.runs.length - keep) };
      // runs are stored newest-first → the tail is the oldest
      window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(shed));
      emitUpdated();
      return true;
    } catch {
      return false;
    }
  }
}

function emitUpdated(): void {
  try {
    window.dispatchEvent(new CustomEvent(RUN_ARCHIVE_EVENT));
  } catch {
    /* event dispatch is best-effort */
  }
}

// ─── core API ────────────────────────────────────────────────────────────────

/** Upsert one run (by id) and enforce the 300-entry FIFO cap by finishedAt.
 * NEVER throws — an archiving failure must not propagate into a run.
 * r507: every write is also mirrored to the IndexedDB warm tier (fire-and-
 * forget; the hot write is never delayed or blocked by it). */
export function archiveRun(entry: RunArchiveEntry): void {
  try {
    const store = readStore();
    const idx = store.runs.findIndex((r) => r.id === entry.id);
    if (idx >= 0) store.runs[idx] = entry;
    else store.runs.unshift(entry); // newest first
    store.runs.sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || ""));
    if (store.runs.length > MAX_ARCHIVE_RUNS) store.runs = store.runs.slice(0, MAX_ARCHIVE_RUNS);
    writeStore(store);
  } catch {
    /* archiving must never break or alter a run */
  }
  mirrorRunToIdb(entry);
  // r507 tier 3: optional BYO Supabase off-site mirror (never blocks, never
  // throws — a cloud outage is invisible to the run).
  void mirrorRunToCloud(entry);
}

/** Fire-and-forget warm-tier mirror. Failure is invisible by design — the
 * hot tier and the SQLite tier carry on without it. */
function mirrorRunToIdb(entry: RunArchiveEntry): void {
  try {
    void idbPutRun(entry).then(async (ok) => {
      if (!ok) return;
      // Keep the warm tier inside its own generous FIFO cap.
      const all = await idbListRuns<RunArchiveEntry>();
      if (all.length > MAX_IDB_RUNS) {
        for (const stale of all.slice(MAX_IDB_RUNS)) void idbDeleteRun(stale.id);
      }
    });
  } catch {
    /* mirror is best-effort */
  }
}

/** All archived runs in the HOT tier, newest-first. (Sync on purpose — the
 * live panels read it during render. Full history incl. shed runs lives in
 * `listArchiveFull()`.) */
export function listArchive(): RunArchiveEntry[] {
  try {
    return readStore().runs;
  } catch {
    return [];
  }
}

/** One run from either tier (hot first, warm as fallback). Async because the
 * warm tier is IndexedDB. */
export async function getRunFull(id: string): Promise<RunArchiveEntry | undefined> {
  const hot = getRun(id);
  if (hot) return hot;
  try {
    return (await idbGetRun<RunArchiveEntry>(id)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function getRun(id: string): RunArchiveEntry | undefined {
  try {
    return readStore().runs.find((r) => r.id === id);
  } catch {
    return undefined;
  }
}

export function removeRun(id: string): void {
  try {
    const store = readStore();
    const next = store.runs.filter((r) => r.id !== id);
    if (next.length === store.runs.length) return; // nothing removed — no event noise
    writeStore({ v: 1, runs: next });
  } catch {
    /* best-effort */
  }
  void idbDeleteRun(id);
}

export function clearArchive(): void {
  try {
    writeStore({ v: 1, runs: [] });
  } catch {
    /* best-effort */
  }
  void idbClearRuns();
}

// ─── r507: warm-tier reads — the full-history surface ────────────────────────

/** Newest-first merge of the hot index (≤300) and the warm tier (≤2000).
 * This is what Archive surfaces should render: runs the hot tier shed under
 * quota pressure re-appear from IndexedDB instead of vanishing. */
export async function listArchiveFull(): Promise<RunArchiveEntry[]> {
  const hot = listArchive();
  let warm: RunArchiveEntry[] = [];
  try {
    warm = await idbListRuns<RunArchiveEntry>();
  } catch {
    warm = [];
  }
  if (warm.length === 0) return hot;
  const seen = new Set(hot.map((r) => r.id));
  const merged = [...hot];
  for (const r of warm) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }
  merged.sort((a, b) => (b.finishedAt || "").localeCompare(a.finishedAt || ""));
  return merged;
}

/** One-time hydration: the warm tier only sees runs archived after r507 —
 * mirror the hot index into IndexedDB so the merge view is complete on day
 * one. Flagged (HYDRATE_KEY), dedupe-safe (put is an upsert), never throws. */
const HYDRATE_KEY = "nexus.run-archive.hydrate.v1";

export async function hydrateIdbFromHot(): Promise<number> {
  try {
    if (typeof window === "undefined") return 0;
    if (window.localStorage.getItem(HYDRATE_KEY) === "1") return 0;
    const hot = readStore();
    if (hot.runs.length === 0) return 0;
    let n = 0;
    for (const r of hot.runs) {
      const ok = await idbPutRun(r);
      if (ok) n += 1;
    }
    try {
      window.localStorage.setItem(HYDRATE_KEY, "1");
    } catch {
      /* flag write failed → next mount re-runs; put is idempotent */
    }
    return n;
  } catch {
    return 0;
  }
}

/** Rescue path: localStorage was cleared/lost but IndexedDB still holds the
 * history — pull the newest `n` back into the hot index. Returns how many
 * entries were restored (0 when the hot tier already has data). */
export async function restoreArchiveFromIdb(n = 100): Promise<number> {
  try {
    const hot = readStore();
    if (hot.runs.length > 0) return 0; // hot tier alive — nothing to rescue
    const warm = await idbListRuns<RunArchiveEntry>();
    if (warm.length === 0) return 0;
    const restored = warm.slice(0, Math.max(1, n));
    writeStore({ v: 1, runs: restored });
    return restored.length;
  } catch {
    return 0;
  }
}

export interface ArchiveTierStats {
  hotRuns: number;
  warmRuns: number;
  idbAvailable: boolean;
  /** Runs visible through the merged view (dedupe by id). */
  totalRuns: number;
}

export async function archiveTierStats(): Promise<ArchiveTierStats> {
  const hot = listArchive();
  let warm = 0;
  let idbAvailable = false;
  try {
    if (idbAvailableFn()) {
      warm = await idbCountRuns();
      idbAvailable = true;
    }
  } catch {
    idbAvailable = false;
  }
  const warmList = idbAvailable && warm > 0 ? await idbListRuns<RunArchiveEntry>() : [];
  const seen = new Set(hot.map((r) => r.id));
  let total = hot.length;
  for (const r of warmList) {
    if (!seen.has(r.id)) total += 1;
  }
  return { hotRuns: hot.length, warmRuns: warm, idbAvailable, totalRuns: total };
}

// ─── status compression (shared by the runner wire and the server lane) ─────

/** Engine status → archive status. `blocked` (parked, auto-resumes) compresses
 * by what it achieved: done steps → "partial", zero progress → "stopped". */
export function engineStatusToArchiveStatus(status: string, hasDoneSteps = false): RunArchiveStatus {
  switch (status) {
    case "done":
      return "done";
    case "error":
      return "failed";
    case "partial":
      return "partial";
    case "blocked":
      return hasDoneSteps ? "partial" : "stopped";
    default:
      return "stopped";
  }
}

// ─── export surfaces ─────────────────────────────────────────────────────────

/** Fence long enough to survive any ``` run inside the output. */
function fenceFor(output: string): string {
  let longest = 0;
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) longest = Math.max(longest, m[0].length);
  return "`".repeat(Math.max(3, longest + 1));
}

function fmtDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** One run as a Markdown section (used alone for per-row export, and as the
 * body unit of the batch pack). */
export function runToMarkdown(entry: RunArchiveEntry): string {
  const meta = [
    `- Trigger: ${entry.trigger}`,
    `- Status: ${entry.status}`,
    `- Started: ${entry.startedAt}`,
    `- Finished: ${entry.finishedAt}`,
    `- Duration: ${fmtDuration(entry.totalMs)}`,
    entry.model ? `- Model: ${entry.model}` : "",
    entry.notes ? `- Notes: ${entry.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const steps = entry.steps
    .map((s, i) => {
      const f = fenceFor(s.output ?? "");
      return [
        `### Step ${i + 1}: ${s.name} (${s.agent})${s.ms != null ? ` · ${fmtDuration(s.ms)}` : ""}`,
        "",
        f,
        s.output ?? "",
        f,
      ].join("\n");
    })
    .join("\n\n");
  return `## ${entry.workflowName} — ${entry.id}\n\n${meta}\n\n${steps}`;
}

/** Batch Markdown pack: header + one section per run. */
export function buildMarkdownPack(entries: RunArchiveEntry[]): string {
  const header = [
    `# NEXUS WebGUI Run Archive`,
    ``,
    `- Generated at: ${new Date().toISOString()}`,
    `- Runs: ${entries.length}`,
  ].join("\n");
  if (entries.length === 0) return `${header}\n\n_(empty archive)_\n`;
  return `${header}\n\n${entries.map(runToMarkdown).join("\n\n")}\n`;
}

/** Batch JSON pack — machine-readable twin for agents and tooling. */
export function buildJsonPack(entries: RunArchiveEntry[]): string {
  return JSON.stringify(
    {
      schema: "nexus.run-archive-pack.v1",
      exportedAt: new Date().toISOString(),
      runs: entries,
    },
    null,
    2
  );
}

/** Plain Blob download (no jszip, no deps). */
export function downloadText(filename: string, content: string, mime = "text/plain"): void {
  try {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick — some browsers cut the download short otherwise.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* download is best-effort */
  }
}

/** `nexus-run-archive-YYYYMMDD-HHmm` stamp for pack filenames. */
export function archivePackStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

// ─── RSI continuity wire ─────────────────────────────────────────────────────

/** Compact continuity digest of the last `n` archived runs (optionally scoped
 * to one workflow) — ≤ ~4000 chars, clearly labeled, built to be prepended to
 * a successor run's first step. Empty string when there is nothing to give. */
export function digestRecent(workflowId?: string, n = 3): string {
  try {
    let runs = listArchive();
    if (workflowId) runs = runs.filter((r) => r.workflowId === workflowId);
    runs = runs.slice(0, Math.max(1, n));
    if (runs.length === 0) return "";
    const lines: string[] = [
      "PRIOR RUN DIGEST (continuity context from previous archived runs):",
      "Build on what previous runs of this pipeline produced — verify their load-bearing claims against fresh findings, integrate what is still relevant, and avoid redoing identical work.",
    ];
    runs.forEach((r, i) => {
      const when = r.finishedAt || r.startedAt;
      const date = when && !Number.isNaN(new Date(when).getTime()) ? new Date(when).toISOString().slice(0, 16).replace("T", " ") : "unknown date";
      lines.push(`${i + 1}. ${date} · ${r.status} · ${r.trigger}`);
      for (const s of r.steps) {
        const out = (s.output ?? "").trim();
        if (!out || out.startsWith("(not run")) continue; // placeholders are noise
        const head = out.length > DIGEST_STEP_CAP ? `${out.slice(0, DIGEST_STEP_CAP)}…` : out;
        lines.push(`   - ${s.name} (${s.agent}): ${head.replace(/\s+/g, " ")}`);
      }
    });
    let text = lines.join("\n");
    if (text.length > DIGEST_TOTAL_CAP) {
      text = `${text.slice(0, DIGEST_TOTAL_CAP)}\n…(digest truncated to fit the context budget)`;
    }
    return text;
  } catch {
    return ""; // best-effort — a successor runs fine without the digest
  }
}

// ─── server-lane landing wire ────────────────────────────────────────────────

/** Structural subset of the /api/automation/sync GET row (both client pollers
 * hand rows shaped like this — see use-server-runs.ts and run-kanban.tsx). */
export interface ServerLaneRunRow {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  error?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  stepsJson?: string | null;
  finalReport?: string | null;
}

/** Module-scoped dedupe: the pollers re-land the same rows every 60s; only
 * the FIRST landing of an id does work (archiveRun's upsert is the second,
 * reload-proof net). */
const serverLaneSeen = new Set<string>();

/** Archive one server-lane run at the moment it lands in client state.
 * The lane's finalReport becomes the step output when per-step rows are
 * absent; per-step rows (stepsJson) win when present — the full conversation
 * log is the point. Never throws. */
export function archiveServerLaneRun(row: ServerLaneRunRow): void {
  try {
    if (!row || typeof row.id !== "string" || !row.id) return;
    if (row.status === "running") return; // not terminal — wait for the landing that is
    if (serverLaneSeen.has(row.id)) return;
    serverLaneSeen.add(row.id);
    if (getRun(row.id)) return; // already archived (e.g. pre-reload) — done

    // Per-step outputs first: [{label, output, ms, ok}] (executor writes this).
    let steps: RunArchiveStep[] = [];
    try {
      const parsed = row.stepsJson ? (JSON.parse(row.stepsJson) as unknown) : null;
      if (Array.isArray(parsed)) {
        steps = parsed
          .filter(
            (s): s is { label?: string; output?: string; ms?: number } =>
              !!s && typeof s === "object"
          )
          .map((s) => ({
            name: typeof s.label === "string" && s.label ? s.label : "Step",
            agent: "server lane",
            output: typeof s.output === "string" ? s.output : "",
            ...(typeof s.ms === "number" ? { ms: s.ms } : {}),
          }));
      }
    } catch {
      /* corrupt stepsJson → fall through to the report */
    }
    if (steps.length === 0) {
      const report = (row.finalReport ?? "").trim();
      const errMsg = (row.error ?? "").trim();
      if (report) {
        steps = [{ name: "Final report", agent: "server lane", output: report }];
      } else if (errMsg) {
        steps = [{ name: "Run error", agent: "server lane", output: errMsg }];
      } else {
        steps = [{ name: "Run", agent: "server lane", output: "(no output recorded)" }];
      }
    }

    const started = row.startedAt ? new Date(row.startedAt) : new Date();
    const finished = row.finishedAt ? new Date(row.finishedAt) : new Date();
    archiveRun({
      id: row.id,
      workflowId: row.workflowId,
      workflowName: row.workflowName,
      trigger: "server",
      status: engineStatusToArchiveStatus(row.status),
      startedAt: (Number.isNaN(started.getTime()) ? new Date() : started).toISOString(),
      finishedAt: (Number.isNaN(finished.getTime()) ? new Date() : finished).toISOString(),
      ...(row.finishedAt && !Number.isNaN(finished.getTime())
        ? { totalMs: Math.max(0, finished.getTime() - started.getTime()) }
        : {}),
      notes: "Archived from the server lane (closed-tab run) when it landed in client state.",
      steps,
    });
  } catch {
    /* archiving must never break the poller */
  }
}

// ─── one-time backfill ───────────────────────────────────────────────────────

/** Structural subset of the persisted workflows store needed for backfill. */
export interface BackfillWorkflow {
  id: string;
  name: string;
  runs: {
    id: string;
    status: string;
    startedAt: number;
    finishedAt?: number;
    source?: "manual" | "scheduled";
    steps: { label: string; agentName: string; output: string; ms?: number; status?: string }[];
  }[];
}

/** Idempotent one-time rescue of run history that still lives in the
 * persisted workflows store (r414 keeps the newest 4 runs per workflow with
 * full outputs, older ones truncated with an honest trim note). Runs exactly
 * once per browser (flag key), skips ids already archived, and never throws.
 * Returns how many entries were added. */
export function backfillArchiveFromRuns(workflows: BackfillWorkflow[]): number {
  try {
    if (typeof window === "undefined") return 0;
    if (window.localStorage.getItem(BACKFILL_KEY) === "1") return 0;
    let added = 0;
    for (const wf of Array.isArray(workflows) ? workflows : []) {
      for (const run of Array.isArray(wf.runs) ? wf.runs : []) {
        try {
          if (!run || typeof run.id !== "string" || !run.id) continue;
          if (run.status === "running") continue;
          if (getRun(run.id)) continue; // already archived — idempotent
          const hasDone = (run.steps ?? []).some((s) => s.status === "done");
          archiveRun({
            id: run.id,
            workflowId: wf.id,
            workflowName: wf.name,
            trigger: run.source === "scheduled" ? "schedule" : "manual",
            status: engineStatusToArchiveStatus(run.status, hasDone),
            startedAt: new Date(run.startedAt ?? Date.now()).toISOString(),
            finishedAt: new Date(run.finishedAt ?? Date.now()).toISOString(),
            ...(run.finishedAt && run.startedAt ? { totalMs: run.finishedAt - run.startedAt } : {}),
            notes:
              "Backfilled once from the persisted run store — older entries may carry the r414 storage-trim marker.",
            steps: (run.steps ?? []).map((s) => ({
              name: s.label ?? "Step",
              agent: s.agentName ?? "agent",
              output: s.output ?? "",
              ...(s.ms != null ? { ms: s.ms } : {}),
            })),
          });
          added++;
        } catch {
          /* one bad row must not sink the backfill */
        }
      }
    }
    try {
      window.localStorage.setItem(BACKFILL_KEY, "1");
    } catch {
      /* flag write failed → next mount re-runs; dedupe keeps it idempotent */
    }
    return added;
  } catch {
    return 0;
  }
}
