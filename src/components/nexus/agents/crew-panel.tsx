"use client";

// ─── Harness Crew panel (r511) ───────────────────────────────────────────────
// Owner directive: "automated, autonomous, assigned, aligned workers as
// Praison promised … obtain or create our harness system within our whole
// workflow." This panel makes the crew VISIBLE and ACTIONABLE on top of the
// pure data in src/lib/crew.ts: alignment meters, Praison/Hermes-inspired
// presets, one-click seeding of missing workers, and per-worker dossiers that
// can be pasted into ANY framework. Zero framework imports — the definitions
// are plain data the workflow runner already consumes.

import * as React from "react";
import { Copy, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AgentAvatar } from "@/components/nexus/atoms";
import { copyText, uid } from "@/lib/helpers";
import { useAgentsStore, useWorkflowsStore } from "@/lib/stores";
import type { Agent, AgentColor } from "@/lib/types";
import {
  CREW_PRESETS,
  CREW_ROLE_DEFS,
  CREW_ROLE_ORDER,
  crewAlignment,
  crewRoster,
  presetMissingRoles,
  praisonDossier,
  type CrewMember,
  type CrewRoleId,
} from "@/lib/crew";
import { cn } from "@/lib/utils";

// Valid colors from the AgentColor union (types.ts), one per role — the seed
// button cycles this exact palette so every created worker is a valid agent.
const SEED_COLOR_BY_ROLE: Record<CrewRoleId, AgentColor> = {
  scout: "cyan",
  judge: "amber",
  curator: "fuchsia",
  implementer: "violet",
  operator: "emerald",
  reviewer: "rose",
};

/** Per-click cap — seeding six workers at once is a surprise, three is a choice. */
const MAX_SEEDS_PER_CLICK = 3;

export function CrewPanel() {
  const agents = useAgentsStore((s) => s.agents);
  const addAgent = useAgentsStore((s) => s.add);
  const updateAgent = useAgentsStore((s) => s.update);
  const workflows = useWorkflowsStore((s) => s.workflows);

  const [presetId, setPresetId] = React.useState<string | null>("research-crew");

  const alignment = React.useMemo(() => crewAlignment(agents, workflows), [agents, workflows]);

  // Roster sorted by canonical role order, then name — stable, deterministic.
  const roster = React.useMemo(
    () =>
      [...crewRoster(agents)].sort((a, b) => {
        const roleDelta = CREW_ROLE_ORDER.indexOf(a.roleId) - CREW_ROLE_ORDER.indexOf(b.roleId);
        return roleDelta !== 0 ? roleDelta : a.agent.name.localeCompare(b.agent.name);
      }),
    [agents]
  );

  const preset = CREW_PRESETS.find((p) => p.id === presetId) ?? null;
  const missingRoles = React.useMemo(
    () => (preset ? presetMissingRoles(preset.id, agents) : []),
    [preset, agents]
  );
  const seedDefs = missingRoles.slice(0, MAX_SEEDS_PER_CLICK).map((id) => CREW_ROLE_DEFS[id]);

  const gatesRan = alignment.gatePass + alignment.gateFail > 0;
  const passRate = gatesRan ? alignment.gatePass / (alignment.gatePass + alignment.gateFail) : null;

  const seedCrew = () => {
    if (seedDefs.length === 0) return;
    const now = Date.now();
    // Exact addAgent payload shape (agent-form-dialog.tsx conventions) plus
    // the r511 alignment fields (goal/backstory) so seeded workers are born
    // aligned instead of needing the legacy one-click goal fix.
    for (const def of seedDefs) {
      const id = uid("agent");
      addAgent({
        id,
        name: def.name,
        emoji: def.glyph,
        color: SEED_COLOR_BY_ROLE[def.id],
        role: def.goal,
        description: def.backstory.slice(0, 140),
        instructions: `${def.goal}\n\nEXPECTED OUTPUT: ${def.expectedOutput}`,
        goal: def.goal,
        backstory: def.backstory,
        model: "auto",
        temperature: 0.4,
        maxIterations: 6,
        tools: [],
        createdAt: now,
        updatedAt: now,
      });
      // stores.ts `add` routes through stamp(), whose field whitelist predates
      // the r511 goal/backstory fields — re-land them via update()'s spread
      // patch so seeded workers are BORN aligned (goal meters count them).
      updateAgent(id, { goal: def.goal, backstory: def.backstory });
    }
    toast.success(
      `Crew seeded: ${seedDefs.length} worker${seedDefs.length === 1 ? "" : "s"}`,
      { description: seedDefs.map((d) => `${d.glyph} ${d.name}`).join(" · ") }
    );
  };

  const copyDossier = async (agent: Agent) => {
    const ok = await copyText(praisonDossier(agent));
    if (ok) toast.success("Worker dossier copied — paste into any harness");
    else toast.error("Could not copy the dossier — check clipboard permissions.");
  };

  // One click turns a legacy agent (no goal) into an aligned worker: fill
  // goal + backstory from its mapped role definition.
  const addGoal = (member: CrewMember) => {
    updateAgent(member.agent.id, {
      goal: member.def.goal,
      backstory: member.def.backstory,
      updatedAt: Date.now(),
    });
    toast.success(`Goal set for ${member.agent.name}`, {
      description: `${member.def.glyph} ${member.def.name} — aligned from the crew role definition.`,
    });
  };

  return (
    <Card className="mb-4 flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <span aria-hidden>🧩</span>
            Harness Crew
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            autonomous · assigned · aligned workers — Praison-style roles, Hermes-style learning
            loop, run on your own relay lanes
          </p>
        </div>
      </div>

      {/* Alignment meters + gate chip */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4" aria-label="Crew alignment">
        <MiniMeter label="agents with goals" value={alignment.withGoal} max={alignment.agents} />
        <MiniMeter label="workflow steps assigned" value={alignment.assignedSteps} max={alignment.steps} />
        <MiniStat label="judge-gated steps" value={alignment.gatedSteps} />
        <div className="shrink-0 sm:pb-0.5">
          {passRate === null ? (
            <Badge variant="outline" className="font-normal border-stone-500/40 text-stone-400">
              no gates yet
            </Badge>
          ) : passRate >= 0.8 ? (
            <Badge variant="outline" className="font-normal border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
              gates {alignment.gatePass}/{alignment.gatePass + alignment.gateFail} pass
            </Badge>
          ) : (
            <Badge variant="outline" className="font-normal border-amber-500/40 bg-amber-500/10 text-amber-500">
              gates {alignment.gatePass}/{alignment.gatePass + alignment.gateFail} pass
            </Badge>
          )}
        </div>
      </div>

      {/* Preset chips + detail */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Crew presets">
          {CREW_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPresetId(p.id)}
              aria-pressed={presetId === p.id}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors sm:min-h-9",
                presetId === p.id
                  ? "border-violet-500/50 bg-violet-500/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-violet-500/30 hover:text-foreground"
              )}
            >
              <span aria-hidden>{p.glyph}</span>
              {p.name}
            </button>
          ))}
        </div>

        {preset ? (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <p className="text-xs font-medium">{preset.tagline}</p>
            <p className="text-xs text-muted-foreground">{preset.description}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {preset.chips.map((chip) => (
                <Badge key={chip} variant="secondary" className="font-normal">
                  {chip}
                </Badge>
              ))}
            </div>
            <div className="flex flex-col gap-2 pt-0.5 sm:flex-row sm:items-center sm:justify-between">
              {missingRoles.length > 0 ? (
                <p className="min-w-0 text-xs text-amber-500/90">
                  Missing:{" "}
                  {missingRoles
                    .map((id) => `${CREW_ROLE_DEFS[id].glyph} ${CREW_ROLE_DEFS[id].name}`)
                    .join(" · ")}
                  {missingRoles.length > MAX_SEEDS_PER_CLICK
                    ? ` — seeding first ${MAX_SEEDS_PER_CLICK} per click`
                    : ""}
                </p>
              ) : (
                <p className="min-w-0 text-xs text-emerald-500/90">
                  ✓ Full lineup covered — every role of this preset has a worker.
                </p>
              )}
              <Button
                size="sm"
                className="min-h-11 shrink-0 sm:min-h-9"
                disabled={missingRoles.length === 0}
                onClick={seedCrew}
              >
                <Plus className="h-4 w-4" />
                Seed missing workers
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Pick a preset to see its lineup and seed missing workers.
          </p>
        )}
      </div>

      {/* Roster */}
      <div className="space-y-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Roster · {roster.length} worker{roster.length === 1 ? "" : "s"}
        </h3>
        <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-violet-500/30">
          {roster.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No agents yet — seed a preset crew above or create one below.
            </p>
          ) : (
            roster.map((member) => (
              <RosterRow
                key={member.agent.id}
                member={member}
                onCopyDossier={() => void copyDossier(member.agent)}
                onAddGoal={() => addGoal(member)}
              />
            ))
          )}
        </div>
      </div>

      {/* Footer caption */}
      <p className="text-[11px] leading-relaxed text-muted-foreground/80">
        Borrowed vocabulary, zero framework imports — roles/goals/expected outputs are plain data
        the workflow runner already consumes. Judge gates dial the free SystemOne ladder
        (Decision-4B first).
      </p>
    </Card>
  );
}

// ─── Alignment meter atoms ───────────────────────────────────────────────────

function MiniMeter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {value}/{max}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" aria-label={`${label}: ${value} of ${max}`} />
    </div>
  );
}

/** Count-only meter slot (judge-gated steps have no natural denominator). */
function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 w-full rounded-full border border-dashed border-border/70" aria-hidden />
    </div>
  );
}

// ─── Roster row ──────────────────────────────────────────────────────────────

function RosterRow({
  member,
  onCopyDossier,
  onAddGoal,
}: {
  member: CrewMember;
  onCopyDossier: () => void;
  onAddGoal: () => void;
}) {
  const { agent, roleId, def, hasGoal } = member;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <AgentAvatar agent={agent} size="sm" className="shrink-0" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className="max-w-full truncate text-sm font-medium sm:max-w-[13rem]">
              {agent.name}
            </span>
            <Badge
              variant="outline"
              className="gap-1 border-violet-500/30 font-normal text-violet-400"
              title={`Crew role: ${def.name}`}
            >
              <span aria-hidden>{def.glyph}</span>
              {roleId}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "font-normal",
                def.gate.enabled
                  ? "border-emerald-500/40 text-emerald-500"
                  : "border-stone-500/40 text-stone-400"
              )}
              title={
                def.gate.enabled
                  ? "SystemOne judge gate ON for this role's outputs"
                  : "No judge gate for this role — downstream consumers re-check"
              }
            >
              {def.gate.enabled ? "gated" : "open"}
            </Badge>
            <Badge
              variant="outline"
              className="max-w-[10rem] font-mono text-[10px] font-normal text-muted-foreground"
            >
              <span className="truncate">{agent.model === "auto" ? "built-in" : agent.model}</span>
            </Badge>
            <Badge variant="secondary" className="font-normal">
              {agent.tools.length} tool{agent.tools.length === 1 ? "" : "s"}
            </Badge>
          </div>
          {hasGoal ? (
            <p className="truncate text-[11px] text-muted-foreground" title={agent.goal}>
              {agent.goal}
            </p>
          ) : (
            <p className="truncate text-[11px] italic text-amber-500/90">
              set a goal →
            </p>
          )}
          <p className="truncate text-[11px] text-muted-foreground/70" title={def.expectedOutput}>
            expected: {def.expectedOutput}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {!hasGoal ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 gap-1.5 px-3 sm:min-h-9"
            onClick={onAddGoal}
            aria-label={`Add goal from the ${def.name} role definition for ${agent.name}`}
          >
            Add goal
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="min-h-11 gap-1.5 px-3 sm:min-h-9"
          onClick={onCopyDossier}
          aria-label={`Copy Praison dossier for ${agent.name}`}
        >
          <Copy className="h-3.5 w-3.5" />
          Dossier
        </Button>
      </div>
    </div>
  );
}
