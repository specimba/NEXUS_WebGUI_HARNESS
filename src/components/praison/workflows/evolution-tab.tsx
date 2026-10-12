"use client";

import * as React from "react";
import {
  Activity,
  Dna,
  FlaskConical,
  ListPlus,
  ScrollText,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { dismissProposal, spawnProposal } from "@/lib/evolution";
import { fmtRel } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import { useEvolutionStore } from "@/lib/stores";
import type { EvolutionLogEntry, EvolutionProposal } from "@/lib/types";

// ─── r67 Evolution tab — the RSI loop's public ledger ────────────────────────
// Three surfaces: (1) policy knobs (auto-spawn + caps), (2) the proposal
// inbox — every spawn directive the analyzer produced, inspectable and
// one-click actionable, (3) the evidence log — every evolution decision the
// worker ever made. This is what makes self-improvement auditable instead of
// theatrical: no change happens outside this ledger.

function midnightToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function noveltyTone(novelty: number): string {
  return novelty >= 0.35
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-amber-600 dark:text-amber-400";
}

function noveltyBar(novelty: number | undefined): React.ReactNode {
  if (novelty == null) return null;
  const pct = Math.round(novelty * 100);
  return (
    <div className="flex items-center gap-2" title={`Run novelty vs recent history — ${(novelty * 100).toFixed(0)}% (stagnant below 35%)`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className={cn(
            "h-full rounded-full",
            novelty >= 0.35 ? "bg-emerald-500" : "bg-amber-500"
          )}
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <span className={cn("text-[11px] font-semibold tabular-nums", noveltyTone(novelty))}>
        🧬 {pct}%
      </span>
    </div>
  );
}

const ACTION_META: Record<
  EvolutionLogEntry["action"],
  { icon: React.ReactNode; tone: string; label: string }
> = {
  analyzed: { icon: <Activity className="h-3.5 w-3.5" aria-hidden />, tone: "text-sky-500", label: "analyzed" },
  proposal: { icon: <Sparkles className="h-3.5 w-3.5" aria-hidden />, tone: "text-violet-500", label: "proposal" },
  spawned: { icon: <Dna className="h-3.5 w-3.5" aria-hidden />, tone: "text-emerald-500", label: "spawned" },
  dismissed: { icon: <X className="h-3.5 w-3.5" aria-hidden />, tone: "text-muted-foreground", label: "dismissed" },
  diversified: { icon: <Sparkles className="h-3.5 w-3.5" aria-hidden />, tone: "text-amber-500", label: "diversified" },
  skipped: { icon: <X className="h-3.5 w-3.5" aria-hidden />, tone: "text-muted-foreground", label: "skipped" },
  error: { icon: <X className="h-3.5 w-3.5" aria-hidden />, tone: "text-red-500", label: "error" },
};

function ProposalCard({ p }: { p: EvolutionProposal }) {
  const spawn = () => {
    if (spawnProposal(p.id)) return;
  };
  const dismiss = () => dismissProposal(p.id);
  const resolved = p.status !== "pending";

  return (
    <div
      className={cn(
        "rounded-xl border p-4 transition-colors",
        p.status === "pending"
          ? "border-violet-500/25 bg-violet-500/[0.04]"
          : "opacity-75"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 gap-1 text-[10px] font-semibold",
                p.kind === "workflow"
                  ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300"
                  : "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400"
              )}
            >
              {p.kind === "workflow" ? (
                <ListPlus className="h-3 w-3" aria-hidden />
              ) : (
                <FlaskConical className="h-3 w-3" aria-hidden />
              )}
              {p.kind === "workflow" ? "new pipeline" : "one-shot task"}
            </Badge>
            {p.status === "spawned" ? (
              <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                <Dna className="h-3 w-3" aria-hidden /> spawned
              </Badge>
            ) : p.status === "dismissed" ? (
              <Badge variant="outline" className="text-[10px] font-semibold text-muted-foreground">
                dismissed
              </Badge>
            ) : null}
            {noveltyBar(p.novelty)}
          </div>
          <p className="mt-1.5 truncate text-sm font-semibold" title={p.title}>
            {p.title}
          </p>
          {p.rationale ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" title={p.rationale}>
              {p.rationale}
            </p>
          ) : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>
              from <span className="font-medium text-foreground/80">{p.sourceWorkflowName}</span>
            </span>
            <span>· {fmtRel(p.createdAt)}</span>
            {p.steps ? <span>· {p.steps.length} steps</span> : null}
            {p.intervalMinutes ? <span>· every {p.intervalMinutes}m proposed</span> : null}
          </p>
          {p.taskText ? (
            <p className="mt-1.5 line-clamp-2 rounded-lg border bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground" title={p.taskText}>
              {p.taskText}
            </p>
          ) : null}
        </div>
        {!resolved ? (
          <div className="flex shrink-0 flex-col gap-1.5">
            <Button size="sm" className="h-8 gap-1.5" onClick={spawn}>
              <Dna className="h-3.5 w-3.5" aria-hidden />
              Spawn
            </Button>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-muted-foreground" onClick={dismiss}>
              <X className="h-3.5 w-3.5" aria-hidden />
              Dismiss
            </Button>
          </div>
        ) : p.status === "spawned" ? (
          <span className="shrink-0 self-center text-right text-[11px] leading-snug text-muted-foreground" title="Spawned pipelines land on the Pipelines tab">
            on the
            <br />
            Pipelines tab →
          </span>
        ) : null}
      </div>
    </div>
  );
}

function LogRow({ entry }: { entry: EvolutionLogEntry }) {
  const meta = ACTION_META[entry.action] ?? ACTION_META.skipped;
  return (
    <div className="flex items-start gap-2.5 px-3 py-2">
      <span className={cn("mt-0.5 shrink-0", meta.tone)}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-relaxed">{entry.detail}</p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {meta.label} · {fmtRel(entry.at)}
        </p>
      </div>
    </div>
  );
}

export function EvolutionTab() {
  const proposals = useEvolutionStore((s) => s.proposals);
  const log = useEvolutionStore((s) => s.log);
  const prefs = useEvolutionStore((s) => s.prefs);
  const setPrefs = useEvolutionStore((s) => s.setPrefs);
  const clearLog = useEvolutionStore((s) => s.clearLog);

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending").slice(0, 10);
  const spawnedToday = proposals.filter(
    (p) => p.status === "spawned" && (p.spawnedAt ?? 0) >= midnightToday()
  ).length;

  return (
    <div className="space-y-5">
      {/* ── header: what this tab is + policy knobs ───────────────────────── */}
      <div className="rounded-xl border bg-muted/30 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500 dark:text-violet-400">
              <Dna className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h3 className="text-sm font-semibold">Evolution layer</h3>
              <p className="text-xs text-muted-foreground">
                Every done run is scored for novelty; stagnant pipelines get pushed into new modes
                and concrete follow-ups land here as proposals. Bounded by caps — no runaway loops.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium" title="Proposals waiting for a decision">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" aria-hidden />
              {pending.length} pending
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium tabular-nums"
              title="Auto-spawned pipelines + tasks today (daily cap protects quota)"
            >
              <Dna className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
              {spawnedToday}/{prefs.maxPerDay} spawned today
            </span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="flex items-center gap-2.5">
            <Switch
              id="evo-autospawn"
              checked={prefs.autoSpawn}
              onCheckedChange={(v) => setPrefs({ autoSpawn: v })}
              aria-label="Auto-spawn workflow proposals"
            />
            <Label htmlFor="evo-autospawn" className="cursor-pointer text-xs font-medium">
              Auto-spawn workflow proposals
              <span className="block text-[11px] font-normal text-muted-foreground">
                Off = everything waits in the inbox for your decision. On = spawns immediately,
                capped at {prefs.maxPerDay}/day and {`≤2`} provenance hops deep.
              </span>
            </Label>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 text-muted-foreground"
            disabled={log.length === 0}
            onClick={() => {
              clearLog();
              toast("Evidence log cleared");
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Clear log
          </Button>
        </div>
      </div>

      {/* ── proposal inbox ────────────────────────────────────────────────── */}
      <section aria-label="Evolution proposal inbox" className="space-y-2.5">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ListPlus className="h-3.5 w-3.5" aria-hidden />
          Proposal inbox
        </h4>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
            No pending proposals. They appear after runs complete — especially when a pipeline
            keeps producing near-duplicate output.
          </div>
        ) : (
          pending.map((p) => <ProposalCard key={p.id} p={p} />)
        )}
        {resolved.length > 0 ? (
          <details className="group">
            <summary className="cursor-pointer select-none py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
              {resolved.length} resolved proposal{resolved.length === 1 ? "" : "s"} (spawned / dismissed)
            </summary>
            <div className="mt-2 space-y-2.5">
              {resolved.map((p) => (
                <ProposalCard key={p.id} p={p} />
              ))}
            </div>
          </details>
        ) : null}
      </section>

      {/* ── evidence log ──────────────────────────────────────────────────── */}
      <section aria-label="Evolution evidence log" className="space-y-2.5">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <ScrollText className="h-3.5 w-3.5" aria-hidden />
          Evidence log
          <span className="font-normal normal-case tracking-normal">— every decision, newest first</span>
        </h4>
        <div className="max-h-96 overflow-y-auto rounded-xl border bg-card evo-scrollbar">
          {log.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              Nothing yet — the worker logs an entry after every analyzed run.
            </p>
          ) : (
            <div className="divide-y">
              {log.map((entry) => (
                <LogRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
