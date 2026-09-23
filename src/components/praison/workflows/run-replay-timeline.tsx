"use client";

// ─── Run replay timeline (r33) ───────────────────────────────────────────────
// Devin/LangGraph-Studio-inspired scrubable timeline: every step is a segment
// proportional to its real duration, colored by status. Play runs a time-lapse
// through the run (scaled, never the full wall-clock); clicking a segment
// jumps the run view to that step. Pure presentation — the timing data
// (ms / status / toolCalls / llmCalls) was already persisted by the runner.

import * as React from "react";
import { FastForward, Pause, Play, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtMs } from "@/lib/helpers";
import type { WorkflowRun, WorkflowRunStep } from "@/lib/types";
import { cn } from "@/lib/utils";

const SEGMENT_COLOR: Record<WorkflowRunStep["status"], string> = {
  running: "bg-violet-500",
  done: "bg-emerald-500",
  error: "bg-red-500",
  stopped: "bg-amber-500",
};

const SEGMENT_COLOR_SOFT: Record<WorkflowRunStep["status"], string> = {
  running: "bg-violet-500/25",
  done: "bg-emerald-500/25",
  error: "bg-red-500/25",
  stopped: "bg-amber-500/25",
};

/** Time-lapse pacing: fast steps get a floor, slow steps never stall the show. */
function stepDelay(ms: number | undefined): number {
  return Math.min(1400, Math.max(340, (ms ?? 1_000) / 10));
}

export function RunReplayTimeline({
  run,
  playhead,
  onScrub,
  playing,
  onPlayingChange,
}: {
  run: WorkflowRun;
  /** null = live view (all steps); number = last visible step index. */
  playhead: number | null;
  onScrub: (idx: number | null) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
}) {
  const steps = run.steps;
  const totalMs =
    run.finishedAt != null
      ? Math.max(1, run.finishedAt - run.startedAt)
      : Math.max(1, steps.reduce((n, s) => n + (s.ms ?? 0), 0));

  const lastIdx = steps.length - 1;
  const current = playhead ?? lastIdx;

  // Auto-advance: one timer per step; fires scrub(next) then re-runs.
  React.useEffect(() => {
    if (!playing || playhead == null) return;
    if (playhead >= lastIdx) {
      onPlayingChange(false);
      return;
    }
    const t = setTimeout(() => onScrub(playhead + 1), stepDelay(steps[playhead + 1]?.ms));
    return () => clearTimeout(t);
  }, [playing, playhead, lastIdx, steps, onScrub, onPlayingChange]);

  function handlePlay() {
    if (playing) {
      onPlayingChange(false);
      return;
    }
    if (playhead == null || playhead >= lastIdx) onScrub(0);
    onPlayingChange(true);
  }

  function cumStart(idx: number): number {
    return steps.slice(0, idx).reduce((n, s) => n + (s.ms ?? 0), 0);
  }

  return (
    <div
      className="rounded-xl border bg-muted/20 p-3"
      role="group"
      aria-label="Run replay timeline"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Replay
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {steps.length} step{steps.length === 1 ? "" : "s"} · {fmtMs(totalMs)}
          {playhead != null && (
            <>
              {" "}
              · viewing {playhead + 1}/{steps.length}
            </>
          )}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-violet-400"
          aria-label={playing ? "Pause replay" : "Play time-lapse replay"}
          title={playing ? "Pause" : "Time-lapse replay"}
          onClick={handlePlay}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-violet-400"
          aria-label="Jump to final step"
          title="Jump to end"
          onClick={() => {
            onPlayingChange(false);
            onScrub(lastIdx);
          }}
        >
          <FastForward className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1.5 px-2 text-[11px] text-muted-foreground hover:text-violet-400",
            playhead == null && "text-violet-500"
          )}
          aria-label="Exit replay — show the whole run"
          title="Back to live view"
          onClick={() => {
            onPlayingChange(false);
            onScrub(null);
          }}
        >
          <Radio className="h-3.5 w-3.5" />
          Live
        </Button>
      </div>

      {/* Duration-proportional segments */}
      <div
        className="flex h-5 w-full items-stretch gap-0.5 overflow-hidden rounded-md"
        role="slider"
        aria-label="Scrub run steps"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={current + 1}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            onPlayingChange(false);
            onScrub(Math.min(lastIdx, current + 1));
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            onPlayingChange(false);
            onScrub(Math.max(0, current - 1));
          } else if (e.key === "Escape") {
            onPlayingChange(false);
            onScrub(null);
          }
        }}
      >
        {steps.map((s, i) => (
          <button
            key={`${s.stepId}-${i}`}
            type="button"
            aria-label={`Step ${i + 1}: ${s.label} — ${s.status}`}
            title={`Step ${i + 1} · ${s.label} · ${s.status}${s.ms != null ? ` · ${fmtMs(s.ms)}` : ""}${
              s.toolCalls.length ? ` · ${s.toolCalls.length} tool${s.toolCalls.length === 1 ? "" : "s"}` : ""
            }${s.llmCalls?.length ? ` · ${s.llmCalls.length} LLM call${s.llmCalls.length === 1 ? "" : "s"}` : ""}`}
            onClick={() => {
              onPlayingChange(false);
              onScrub(i === current && playhead != null ? null : i);
            }}
            className={cn(
              "relative min-w-[10px] rounded-[3px] transition-all hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
              i <= (playhead ?? lastIdx) ? SEGMENT_COLOR[s.status] : SEGMENT_COLOR_SOFT[s.status],
              i === current && playhead != null
                ? "ring-2 ring-violet-400 ring-offset-1 ring-offset-background"
                : ""
            )}
            // duration-proportional growth (sqrt damps long tails; floored so
            // tiny steps stay clickable)
            style={{ flexGrow: Math.max(0.6, Math.sqrt((s.ms ?? 800) / 1000)) }}
          />
        ))}
      </div>

      {/* Time axis */}
      <div className="mt-1 flex items-center justify-between font-mono text-[10px] tabular-nums text-muted-foreground/80">
        <span>0s</span>
        {playhead != null && (
          <span className="text-violet-500">
            t+{fmtMs(cumStart(playhead + 1))} · {steps[playhead]?.label}
          </span>
        )}
        <span>{fmtMs(totalMs)}</span>
      </div>
    </div>
  );
}
