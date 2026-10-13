"use client";

// ─── r486-a: Run Archive tab — browse, search, export and prune the archive ──
// The client surface of src/lib/run-archive.ts: every settled run (manual,
// scheduled and server-lane) lands here automatically; this panel lists them,
// exports batch Markdown/JSON packs, and manages the store. Live-refreshes via
// the "praison:run-archive-updated" event + cross-tab "storage" events.

import * as React from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  Download,
  FileJson,
  FileText,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/praison/atoms";
import { fmtRel } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import { useWorkflowsStore } from "@/lib/stores";
import {
  archivePackStamp,
  backfillArchiveFromRuns,
  buildJsonPack,
  buildMarkdownPack,
  clearArchive,
  downloadText,
  listArchive,
  removeRun,
  runToMarkdown,
  RUN_ARCHIVE_EVENT,
  RUN_ARCHIVE_STORAGE_KEY,
  type RunArchiveEntry,
  type RunArchiveStatus,
} from "@/lib/run-archive";

/** `done` = emerald · `failed` = red · stopped/partial = amber. */
function statusChipClass(status: RunArchiveStatus): string {
  switch (status) {
    case "done":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }
}

function fmtDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function fmtDateTime(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString();
}

export function RunArchivePanel() {
  const [entries, setEntries] = React.useState<RunArchiveEntry[]>([]);
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  // The one-time backfill from the persisted run store — idempotent inside
  // (flag key + getRun dedupe); the ref just avoids re-invoking per remount.
  const backfilledRef = React.useRef(false);

  const reload = React.useCallback(() => setEntries(listArchive()), []);

  React.useEffect(() => {
    if (!backfilledRef.current) {
      backfilledRef.current = true;
      try {
        const added = backfillArchiveFromRuns(useWorkflowsStore.getState().workflows);
        if (added > 0) {
          toast.success(`Backfilled ${added} prior run${added === 1 ? "" : "s"} into the archive`);
        }
      } catch {
        /* backfill is best-effort */
      }
    }
    reload();
    const onUpdated = () => reload();
    window.addEventListener(RUN_ARCHIVE_EVENT, onUpdated);
    // Cross-tab / cross-surface sync: another tab mutated the archive.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === RUN_ARCHIVE_STORAGE_KEY) reload();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RUN_ARCHIVE_EVENT, onUpdated);
      window.removeEventListener("storage", onStorage);
    };
  }, [reload]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (r) =>
        r.workflowName.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q) ||
        r.trigger.toLowerCase().includes(q) ||
        r.steps.some(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.agent.toLowerCase().includes(q) ||
            (s.output ?? "").toLowerCase().includes(q)
        )
    );
  }, [entries, query]);

  const downloadMdPack = () => {
    if (filtered.length === 0) return;
    downloadText(
      `praisonai-run-archive-${archivePackStamp()}.md`,
      buildMarkdownPack(filtered),
      "text/markdown"
    );
    toast.success("Markdown pack downloaded", {
      description: `${filtered.length} run${filtered.length === 1 ? "" : "s"} packed.`,
    });
  };

  const downloadJsonPack = () => {
    if (filtered.length === 0) return;
    downloadText(
      `praisonai-run-archive-${archivePackStamp()}.json`,
      buildJsonPack(filtered),
      "application/json"
    );
    toast.success("JSON pack downloaded", {
      description: `${filtered.length} run${filtered.length === 1 ? "" : "s"} packed.`,
    });
  };

  const handleClear = () => {
    if (entries.length === 0) return;
    if (!window.confirm(`Clear all ${entries.length} archived run${entries.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    clearArchive();
    setExpanded({});
    toast.success("Run archive cleared");
  };

  const removeOne = (entry: RunArchiveEntry) => {
    if (!window.confirm(`Delete the archived run "${entry.workflowName}" (${entry.id})?`)) return;
    removeRun(entry.id);
    toast.success("Archived run deleted");
  };

  const downloadOneMd = (entry: RunArchiveEntry) => {
    downloadText(`praisonai-run-${entry.id}.md`, runToMarkdown(entry), "text/markdown");
  };

  const downloadOneJson = (entry: RunArchiveEntry) => {
    downloadText(
      `praisonai-run-${entry.id}.json`,
      JSON.stringify(
        { schema: "praisonai.run-archive-pack.v1", exportedAt: new Date().toISOString(), runs: [entry] },
        null,
        2
      ),
      "application/json"
    );
  };

  return (
    <section aria-label="Run archive" className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search runs by workflow name or step text…"
            aria-label="Search the run archive"
            className="h-8 pl-8 pr-3 text-xs"
          />
        </div>
        <Badge variant="outline" className="shrink-0 tabular-nums" title="Runs currently in the local archive">
          {entries.length} archived
        </Badge>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            disabled={filtered.length === 0}
            onClick={downloadMdPack}
            aria-label="Download the archived runs as a Markdown pack"
            title="Download every shown run as one batch Markdown pack"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Download pack (.md)</span>
            <span className="sm:hidden">.md</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            disabled={filtered.length === 0}
            onClick={downloadJsonPack}
            aria-label="Download the archived runs as a JSON pack"
            title="Download every shown run as one batch JSON pack"
          >
            <FileJson className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Download pack (.json)</span>
            <span className="sm:hidden">.json</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
            disabled={entries.length === 0}
            onClick={handleClear}
            aria-label="Clear the entire run archive"
            title="Delete every archived run (asks first)"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        </div>
      </div>

      {/* List */}
      {entries.length === 0 ? (
        <EmptyState
          emoji="🗄️"
          title="Nothing archived yet"
          description="Completed and failed runs will land here automatically."
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
          No archived run matches “{query.trim()}”.
        </p>
      ) : (
        <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-violet-500/30">
          {filtered.map((entry) => {
            const open = expanded[entry.id] === true;
            return (
              <div key={entry.id} className="rounded-lg border bg-card">
                {/* Row header — the whole strip toggles expand/collapse */}
                <button
                  type="button"
                  onClick={() => setExpanded((m) => ({ ...m, [entry.id]: !open }))}
                  aria-expanded={open}
                  aria-label={`${open ? "Collapse" : "Expand"} archived run ${entry.workflowName} (${entry.id})`}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      !open && "-rotate-90"
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {entry.workflowName}
                  </span>
                  <span
                    className="hidden shrink-0 text-[11px] tabular-nums text-muted-foreground sm:inline"
                    title={`Finished ${fmtDateTime(entry.finishedAt)}`}
                  >
                    {fmtRel(new Date(entry.finishedAt).getTime())}
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                    {entry.trigger}
                  </Badge>
                  <Badge className={cn("shrink-0 text-[10px] capitalize", statusChipClass(entry.status))}>
                    {entry.status}
                  </Badge>
                  <span
                    className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                    title={`${entry.steps.length} step${entry.steps.length === 1 ? "" : "s"} recorded`}
                  >
                    {entry.steps.length} step{entry.steps.length === 1 ? "" : "s"}
                  </span>
                </button>

                {/* Row actions — isolated from the toggle */}
                {open ? (
                  <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => downloadOneMd(entry)}
                      aria-label={`Download run ${entry.id} as Markdown`}
                      title="Download this run as Markdown"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      .md
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => downloadOneJson(entry)}
                      aria-label={`Download run ${entry.id} as JSON`}
                      title="Download this run as JSON"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      .json
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-8 gap-1.5 px-2.5 text-xs text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
                      onClick={() => removeOne(entry)}
                      aria-label={`Delete archived run ${entry.id}`}
                      title="Delete this archived run (asks first)"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Delete
                    </Button>
                  </div>
                ) : null}

                {/* Expanded body — meta + per-step conversation log */}
                {open ? (
                  <div className="space-y-3 border-t px-3 py-3">
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>
                        Started <span className="text-foreground">{fmtDateTime(entry.startedAt)}</span>
                      </span>
                      <span>
                        Finished <span className="text-foreground">{fmtDateTime(entry.finishedAt)}</span>
                      </span>
                      <span>
                        Duration <span className="text-foreground tabular-nums">{fmtDuration(entry.totalMs)}</span>
                      </span>
                      {entry.model ? (
                        <span>
                          Model <span className="text-foreground">{entry.model}</span>
                        </span>
                      ) : null}
                    </p>
                    {entry.steps.map((step, i) => (
                      <div key={`${entry.id}-step-${i}`} className="space-y-1">
                        <p className="text-xs font-medium">
                          <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded bg-muted text-[10px] tabular-nums text-muted-foreground" aria-hidden>
                            {i + 1}
                          </span>
                          {step.name}
                          <span className="ml-1.5 font-normal text-muted-foreground">· {step.agent}</span>
                          {step.ms != null ? (
                            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                              · {fmtDuration(step.ms)}
                            </span>
                          ) : null}
                        </p>
                        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-2 pr-3 text-xs leading-relaxed text-foreground/90 scrollbar-thin scrollbar-thumb-violet-500/30">
                          {step.output || "(no output recorded)"}
                        </pre>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
