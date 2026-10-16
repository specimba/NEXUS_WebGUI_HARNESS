"use client";

// ─── r456: read surface for the durable run-report archive (r455) ────────────
// The in-panel run history above reads from localStorage (r414 trimmers cap
// per-item bulk, and the r455 byte-budget ladder may deep-trim outputs to fit
// the origin quota). THIS section reads the durable tier instead: every
// settled run lands in SQLite in full via the runner's auto-archive POST
// (r455), and agents maintain the same rows through /api/runs/archive.
// Egress doctrine (r161): silent on mount, ONE list fetch per expand,
// explicit refresh button, ONE detail fetch per row click. No polling.

import * as React from "react";
import { Archive, ChevronDown, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface ArchiveMeta {
  id: string;
  workflowId: string;
  workflowName: string;
  task: string | null;
  source: string | null;
  status: string | null;
  depth: string | null;
  error: string | null;
  toolCalls: number;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  archivedAt: string;
}

// Same step shape the r455 route parses out of stepsJson.
interface ArchiveStep {
  stepId?: string;
  agentName?: string;
  label?: string;
  output?: string;
  status?: string;
  ms?: number;
}

interface ArchivedReportsProps {
  workflowId: string;
}

/** r456: status → badge tone, mirroring the board's done/error/amber reads. */
function statusTone(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s === "completed" || s === "done") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (s === "error" || s === "failed" || s === "cancelled") return "border-red-500/40 bg-red-500/10 text-red-300";
  return "border-amber-500/40 bg-amber-500/10 text-amber-300";
}

function fmtDur(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function ArchivedReports({ workflowId }: ArchivedReportsProps) {
  const [open, setOpen] = React.useState(false);
  const [reports, setReports] = React.useState<ArchiveMeta[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Detail pane: the clicked row's full stepsJson, loaded on demand.
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [detailSteps, setDetailSteps] = React.useState<ArchiveStep[] | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const fetchList = React.useCallback(async () => {
    if (!workflowId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/runs/archive?workflowId=${encodeURIComponent(workflowId)}&limit=50`
      );
      const json = (await res.json()) as { reports?: ArchiveMeta[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setReports(json.reports ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "archive read failed");
    } finally {
      setLoading(false);
    }
  }, [workflowId]);

  // Egress doctrine: one fetch per expand — not on mount.
  const onOpenChange = React.useCallback(
    (v: boolean) => {
      setOpen(v);
      if (v && reports === null && !loading) void fetchList();
    },
    [reports, loading, fetchList]
  );

  const openDetail = React.useCallback(
    async (id: string) => {
      if (detailId === id) {
        setDetailId(null); // toggle closed
        setDetailSteps(null);
        return;
      }
      setDetailId(id);
      setDetailSteps(null);
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/runs/archive?runId=${encodeURIComponent(id)}`);
        const json = (await res.json()) as { report?: { steps?: ArchiveStep[] }; error?: string };
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setDetailSteps(json.report?.steps ?? []);
      } catch {
        setDetailSteps([]); // detail failed to load — the row still shows meta
      } finally {
        setDetailLoading(false);
      }
    },
    [detailId]
  );

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="pt-2">
      <div className="flex items-center gap-2">
        <CollapsibleTrigger
          className="group flex flex-1 items-center gap-1.5 text-left text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200"
          aria-label="Toggle archived reports"
          aria-expanded={open}
        >
          <Archive className="h-3.5 w-3.5 text-sky-400" aria-hidden />
          Archived reports
          {reports !== null && reports.length > 0 ? (
            <span className="text-zinc-500">({reports.length})</span>
          ) : null}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </CollapsibleTrigger>
        {open ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] text-zinc-500 hover:text-zinc-300"
            onClick={() => void fetchList()}
            disabled={loading}
            aria-label="Refresh archived reports"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden />
            )}
            Refresh
          </Button>
        ) : null}
      </div>
      <CollapsibleContent>
        {/* why open: full per-step outputs (incl. tool calls) live in the DB
            tier — r414 trims may have dropped them from localStorage history */}
        <p className="pt-1 text-[11px] italic text-zinc-600">
          Durable SQLite tier — full steps survive the localStorage budget ladder; agents read
          these via /api/runs/archive.
        </p>
        {error ? (
          <p role="alert" className="pt-2 text-xs text-red-400">
            Archive read failed: {error}
          </p>
        ) : null}
        {!error && reports !== null && reports.length === 0 ? (
          <p className="pt-2 text-xs text-zinc-500">
            No archived reports yet — every completed run lands here automatically.
          </p>
        ) : null}
        {reports !== null && reports.length > 0 ? (
          <ul className="space-y-1 pt-2">
            {reports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void openDetail(r.id)}
                  aria-expanded={detailId === r.id}
                  // r461 (live witness finding): the accessible name used to
                  // be the button's full text content — a ~300-char task line
                  // read verbatim by screen readers for EVERY list row before
                  // the state/duration. A bounded label keeps the audible
                  // name scannable; visible content is untouched.
                  aria-label={`${r.status ?? "unknown"} — ${(r.task || r.workflowName || "untitled").slice(0, 80)}${
                    (r.task || r.workflowName || "").length > 80 ? "…" : ""
                  } — ${fmtDur(r.durationMs)} — ${new Date(r.startedAt).toLocaleString()}`}
                  className="w-full rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2.5 py-1.5 text-left transition-colors hover:border-zinc-700"
                >
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className={cn("h-4 px-1.5 text-[10px]", statusTone(r.status))}>
                      {r.status ?? "unknown"}
                    </Badge>
                    <span className="flex-1 truncate text-xs text-zinc-300">
                      {r.task || r.workflowName}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                      {fmtDur(r.durationMs)}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                      {new Date(r.startedAt).toLocaleString()}
                    </span>
                  </span>
                </button>
                {detailId === r.id ? (
                  <div className="mt-1 rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                    {detailLoading ? (
                      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> loading steps…
                      </p>
                    ) : detailSteps && detailSteps.length > 0 ? (
                      <ol className="space-y-2">
                        {detailSteps.map((s, i) => (
                          <li key={s.stepId ?? i} className="text-xs">
                            <span className="flex items-center gap-1.5 text-zinc-300">
                              <span className="font-medium">{s.label ?? s.stepId ?? `step ${i + 1}`}</span>
                              {s.agentName ? (
                                <span className="text-[10px] text-zinc-500">{s.agentName}</span>
                              ) : null}
                              {s.ms != null ? (
                                <span className="text-[10px] tabular-nums text-zinc-600">{fmtDur(s.ms)}</span>
                              ) : null}
                            </span>
                            {s.output ? (
                              <pre className="mt-0.5 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-zinc-900/80 p-1.5 text-[11px] leading-relaxed text-zinc-400">
                                {s.output}
                              </pre>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-xs text-zinc-500">No steps recorded on this archived run.</p>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
