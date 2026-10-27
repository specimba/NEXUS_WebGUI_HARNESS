"use client";

// ─── r651: the precedent-exemplar lane preview (arXiv 2610.31421 F6/F7) ────
// Authoring-time honesty for generate steps: the run archive is the
// precedent store — this preview shows, LIVE, what the lane would inject
// for the step being authored: how many eligible past-successful precedents
// exist, which one wins the r579 RRF retrieval (BM25 + trigram legs), and
// whether a two-occurrence prompt block is assembled. Pure client-side
// retrieval over the already-settled archive — no dials, no runtime, no
// fabrication: an empty archive honestly says so. The runner assembles the
// real block at run time from the LIVE task text; this is the authoring
// mirror of that contract.

import * as React from "react";
import { listArchiveFull, type RunArchiveEntry } from "@/lib/run-archive";
import { precedentRetrieval } from "@/lib/precedent-lane";
import { harnessChipForArchiveRun } from "@/lib/trace-trial";
import { cn } from "@/lib/utils";

const QUERY_MIN = 12;

export function PrecedentLanePreview({
  query,
  stepIndex,
}: {
  query: string;
  stepIndex: number;
}) {
  const [entries, setEntries] = React.useState<RunArchiveEntry[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    void listArchiveFull().then((rows) => {
      if (alive) setEntries(rows);
    });
    return () => {
      alive = false;
    };
  }, []);

  const lane = React.useMemo(() => {
    const q = typeof query === "string" ? query.trim() : "";
    if (entries == null || q.length < QUERY_MIN) return null;
    // The archive altitude: rows must pass the same honesty filter the
    // archive chip enforces — done + replayable output + known-good lineage.
    return precedentRetrieval(
      q,
      entries.map((e) => ({
        id: e.id,
        workflowName: e.workflowName,
        task: e.steps[0]?.name,
        output: e.steps.map((s) => s.output).join(" "),
        status: e.status,
        lineageOk: (() => {
          const chip = harnessChipForArchiveRun(e.steps, e.status);
          return chip ? chip.tone !== "warn" : undefined;
        })(),
      })),
      2,
    );
  }, [entries, query]);

  if (lane == null) return null;

  const top = lane.exemplars[0];
  const detail = top
    ? `${lane.note} — two-occurrence block ${lane.promptBlock.length} chars assembled (anchor + generation-point target).`
    : `${lane.note} — the archive feeds this lane as past-successful runs settle.`;

  return (
    <p
      title={`Precedent lane (arXiv 2610.31421 F6/F7): the archive is our precedent store — top-2 similar past-successful outputs retrieved by the r579 RRF shim, laid out by the two-occurrence rule (an early anchor + a target beside the generation point; induction copies the earlier continuation). ${detail}`}
      aria-label={`Precedent lane preview for step ${stepIndex}`}
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed",
        top ? "text-violet-500 dark:text-violet-400" : "text-muted-foreground"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
          top ? "bg-violet-500" : "bg-muted-foreground/50"
        )}
      />
      {top ? (
        <>
          <span className="font-medium">
            Precedent lane · top: {top.workflowName} (rrf {top.rrfScore.toFixed(4)},{" "}
            {top.legs} leg{top.legs === "both" ? "s" : ""})
          </span>
          <span className="text-muted-foreground">
            · {lane.eligible} eligible · block {lane.promptBlock.length} chars
          </span>
        </>
      ) : (
        <span>
          Precedent lane · no similar past-successful run yet
          {lane.eligible > 0 ? ` (${lane.eligible} eligible in the archive)` : " — the archive feeds it as runs settle"}
        </span>
      )}
    </p>
  );
}
