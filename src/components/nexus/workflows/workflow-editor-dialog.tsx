"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
// r651 (arXiv 2610.31421 F6/F7): the precedent-exemplar lane preview —
// authoring-time mirror of what the archive-fed two-occurrence block would
// inject for this generate step.
import { PrecedentLanePreview } from "./precedent-lane-preview";
import { ModelPicker } from "@/components/nexus/model-picker";
import { AUTO_PLAN_SYSTEM } from "@/lib/constants";
// r503 (owner directive): quality-marked lane pool for pipeline/step pins.
import { buildLaneCatalog, laneShortName } from "@/lib/lane-catalog";
// r506 (owner directive): AI utility buttons dial a FAST above-moderate lane
// with emergent substitutions — never the largest reasoning model by default.
import {
  UTILITY_FAST_BUDGET_MS,
  UTILITY_SYSTEM_SUFFIX,
  buildUtilityWire,
} from "@/lib/utility-lane";
import { extractJsonArray, roleMatchesAgent, uid } from "@/lib/helpers";
import {
  useAgentsStore,
  useSettingsStore,
  useWorkflowsStore,
} from "@/lib/stores";
import type { PipelineDepth, StepKind, Workflow, WorkflowStep } from "@/lib/types";
import { isAbortError, runAgentChat } from "@/lib/chat-client";
import { cn } from "@/lib/utils";

// ─── Create / edit a workflow: name, description and ordered steps ──────────

const DEPTH_OPTIONS: {
  v: PipelineDepth;
  label: string;
  desc: string;
  summary: string;
}[] = [
  {
    v: "quick",
    label: "Quick",
    desc: "As authored — no extra passes, fastest and cheapest.",
    summary: "runs exactly as authored",
  },
  {
    v: "standard",
    label: "Standard",
    desc: "Adds one verification pass at the end (skipped when you already have a review gate).",
    summary: "+ verification pass",
  },
  {
    v: "deep",
    label: "Deep",
    desc: "2 extra deep-research passes after step 1, then verification — for briefings that need detail.",
    summary: "+ 2 deep-research passes · + verification pass",
  },
];

interface WorkflowEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow?: Workflow | null;
}

export function WorkflowEditorDialog({
  open,
  onOpenChange,
  workflow,
}: WorkflowEditorDialogProps) {
  const agents = useAgentsStore((s) => s.agents);
  const addWf = useWorkflowsStore((s) => s.add);
  const updateWf = useWorkflowsStore((s) => s.update);
  const settings = useSettingsStore((s) => s.settings);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [depth, setDepth] = React.useState<PipelineDepth>("standard");
  // r503 (owner directive): pipeline-default lane pin — "" = follow agents
  // (each step dials its agent's model + the global provider, as before).
  const [lane, setLane] = React.useState<string>("");
  const [steps, setSteps] = React.useState<WorkflowStep[]>([]);
  const [planOpen, setPlanOpen] = React.useState(false);
  const [planTask, setPlanTask] = React.useState("");
  const [planning, setPlanning] = React.useState(false);
  // r235: the auto-plan call is now cancellable — the AbortController is
  // handed to runAgentChat (signal plumbed through), a Cancel button shows
  // while planning, and a stale run's finally can never clobber a new run's
  // in-flight state (live-run guard below).
  const planAbortRef = React.useRef<AbortController | null>(null);
  // Closing the plan panel (toggle or dialog close) must not leave a request
  // running invisibly in the background.
  React.useEffect(() => {
    if (!planOpen && planAbortRef.current) planAbortRef.current.abort();
  }, [planOpen]);
  // r232 save-truth: after a blocked save attempt, errors render INLINE at the
  // offending field (r225 pattern) instead of a distant toast — and no authored
  // step is ever silently dropped (pre-fix: unassigned steps vanished on save).
  const [saveAttempted, setSaveAttempted] = React.useState(false);
  const nameInputRef = React.useRef<HTMLInputElement | null>(null);
  const stepTriggerRefs = React.useRef(new Map<string, HTMLButtonElement>());

  // Drag-to-reorder state (HTML5 DnD — dragstart is only allowed from the grip handle)
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [overIndex, setOverIndex] = React.useState<number | null>(null);

  // Hydrate the form each time the dialog opens
  React.useEffect(() => {
    if (!open) return;
    setName(workflow?.name ?? "");
    setDescription(workflow?.description ?? "");
    // Old workflows read depth = undefined → treat as "standard".
    setDepth(workflow?.depth ?? "standard");
    // r503: pipeline lane pin hydrates like depth — old workflows = "".
    setLane(workflow?.lane ?? "");
    setSteps(
      workflow
        ? workflow.steps.map((s) => ({ ...s }))
        : []
    );
    setPlanOpen(false);
    setPlanTask("");
    setPlanning(false);
    setSaveAttempted(false);
  }, [open, workflow]);

  // r503: the dialable lane pool with LIVE quality marks (Generation-Era
  // tier, arena Elo, usage ok/failed counts, rotator trust badges) is built
  // ONCE per dialog open — buildLaneCatalog reads localStorage (rotator
  // health, live rosters), so per-render/per-step calls would thrash. Every
  // picker shares these arrays; the synthetic head row of each names its
  // "no pin" default.
  const laneCatalogOptions = React.useMemo(() => {
    if (!open) return [];
    return buildLaneCatalog(settings).options;
  }, [open, settings]);
  const pipelineLaneOptions = React.useMemo(
    () => [
      {
        id: "",
        label: "Follow agents (default)",
        note: "each step dials its agent's model + the global provider",
        group: "Pipeline lane",
      },
      ...laneCatalogOptions,
    ],
    [laneCatalogOptions]
  );
  const stepLaneOptions = React.useMemo(
    () => [
      {
        id: "",
        label: "Pipeline default",
        note: "dials the pipeline lane / agent model",
        group: "Step lane",
      },
      ...laneCatalogOptions,
    ],
    [laneCatalogOptions]
  );

  const patchStep = (id: string, patch: Partial<WorkflowStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addStep = () => {
    setSteps((prev) => [...prev, { id: uid("step"), agentId: "", label: "" }]);
  };

  /** Insert a review gate right after the last step (a gate needs a target). */
  const addReviewStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        id: uid("step"),
        agentId: "",
        label: "",
        kind: "review" as const,
      },
    ]);
  };

  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[j];
      next[j] = tmp;
      return next;
    });
  };

  const reorderStep = (from: number, to: number) => {
    setSteps((prev) => {
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= prev.length ||
        to >= prev.length
      )
        return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const clearDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  async function generatePlan() {
    const task = planTask.trim();
    if (!task) {
      toast.error("Describe the task you want the pipeline to solve first");
      return;
    }
    setPlanning(true);
    const controller = new AbortController();
    planAbortRef.current?.abort(); // never two live plan runs
    planAbortRef.current = controller;
    // r506: the utility wire names the lane that actually answers — smart
    // substitution is SAID, not silent (r270 class) — captured via receipt.
    let servedLabel: string | null = null;
    try {
      const settings = useSettingsStore.getState().settings;
      const agentList = useAgentsStore
        .getState()
        .agents.map((a) => ({ id: a.id, name: a.name, role: a.role }));
      // r506 (owner directive): plan generation is a SMALL task — dial a fast
      // above-moderate lane (free-first) with an emergent substitution ladder
      // and a 30s first-token budget, instead of the global primary (often
      // the largest reasoning model — the exact dial that dead-ended as
      // "Couldn't generate a plan" when the flagship fleet went silent).
      const wire = buildUtilityWire(settings);
      const res = await runAgentChat(
        {
          provider: wire.primary.provider,
          apiKey: wire.primary.apiKey,
          baseUrl: wire.primary.baseUrl,
          model: wire.primary.model,
          // r317: registry id for the shared 429 memory + rotator stamping.
          providerId: wire.primary.providerId,
          temperature: 0.2,
          maxIterations: 1,
          firstTokenBudgetMs: UTILITY_FAST_BUDGET_MS,
          // Smart substitution: fast backups + built-in engine, outcomes feed
          // the shared health memory/breaker so the pool self-heals.
          relay: wire.relay,
          signal: controller.signal,
          system: AUTO_PLAN_SYSTEM + UTILITY_SYSTEM_SUFFIX,
          messages: [
            {
              role: "user",
              content: `Task: ${task}\n\nAvailable agents JSON:\n${JSON.stringify(agentList)}`,
            },
          ],
        },
        {
          onReceipt: (receipt) => {
            servedLabel = receipt.resolved_label ?? null;
          },
        }
      );
      const plan = extractJsonArray(res.content);
      const available = useAgentsStore.getState().agents;
      if (!plan || plan.length === 0 || available.length === 0) {
        toast.error("Couldn't generate a plan, add steps manually");
        return;
      }
      const validIds = new Set(available.map((a) => a.id));
      let substituted = 0;
      const mapped: WorkflowStep[] = plan.map((raw, i) => {
        const item = (raw ?? {}) as { label?: unknown; agentId?: unknown; instruction?: unknown };
        const label =
          typeof item.label === "string" && item.label.trim()
            ? item.label.trim()
            : `Step ${i + 1}`;
        let agentId: string;
        if (typeof item.agentId === "string" && validIds.has(item.agentId)) {
          agentId = item.agentId;
        } else {
          // r450: the planner named an agent that does not exist here —
          // hallucinated id, or an agent renamed/deleted since. The step is
          // still mapped (round-robin keeps the pipeline runnable) but the
          // substitution is SAID, not silent (r270 class): a hallucinated plan
          // used to re-assign every step with no word, and the "Generated N
          // steps" toast made it look faithful.
          substituted++;
          agentId = available[i % available.length].id;
        }
        // r29: auto-planned steps now carry step-specific instructions (v2 planner contract).
        const instruction =
          typeof item.instruction === "string" && item.instruction.trim()
            ? item.instruction.trim()
            : undefined;
        return { id: uid("step"), agentId, label, ...(instruction ? { instruction } : {}) };
      });
      setSteps(mapped);
      setPlanOpen(false);
      setPlanTask("");
      toast.success(
        `Generated ${mapped.length} steps` +
          (servedLabel ? ` · via ${servedLabel}` : "") +
          (substituted > 0
            ? ` · ${substituted} step${substituted === 1 ? "" : "s"} on a fallback agent (planned agent not in roster — re-assign if needed)`
            : "")
      );
    } catch (err) {
      // r235: a user cancel lands here as AbortError and stays silent — the
      // Cancel button is the affordance; no toast noise on purpose.
      if (!isAbortError(err)) {
        // r506: say what actually happened — the wire already rotated fast
        // lanes + the built-in engine before surfacing, so this is a REAL
        // exhaustion, not one dead flagship.
        const reason = err instanceof Error && err.message ? ` — ${err.message.slice(0, 90)}` : "";
        toast.error(`Couldn't generate a plan${reason}. Add steps manually or retry.`);
      }
    } finally {
      // Only the LIVE run resets planning state — a stale run resolving right
      // after Cancel + Regenerate must not clobber the new run.
      if (planAbortRef.current === controller) {
        planAbortRef.current = null;
        setPlanning(false);
      }
    }
  }

  const handleSave = () => {
    setSaveAttempted(true);
    const trimmedName = name.trim();
    if (!trimmedName) {
      // r232: inline error at the field (aria-invalid + role=alert below),
      // focus pulled to the input — matches the r225 agent-form contract.
      nameInputRef.current?.focus();
      return;
    }
    const firstUnassigned = steps.find((s) => !s.agentId);
    if (firstUnassigned) {
      // r232 truth-in-save: a labeled-but-unassigned step used to be SILENTLY
      // dropped here (its label + instruction lost). Block instead: inline
      // alert naming the count, aria-invalid on every offender, focus the
      // first one. Nothing is saved until every step has an agent.
      stepTriggerRefs.current.get(firstUnassigned.id)?.focus();
      return;
    }
    const validSteps = steps
      .filter((s) => s.agentId)
      .map((s, i) => ({
        ...s,
        label: s.label.trim() || `Step ${i + 1}`,
        instruction: s.instruction?.trim() ? s.instruction.trim() : undefined,
        // r182: normalize the explicit role — whitespace-only collapses to
        // absent so the parsed-label fallback stays the live signal.
        roleId: s.roleId?.trim() ? s.roleId.trim() : undefined,
        // r503: same normalization for per-step lane pins — whitespace-only
        // collapses to absent so "pipeline default" stays the live signal.
        lane: s.lane?.trim() ? s.lane.trim() : undefined,
        // r645: normalize the looped-depth opt-in — only generate steps carry
        // it, and the runner engages the loop only at rCap >= 2, so r<2 (and
        // review gates) collapse to absent instead of lying in authored JSON.
        loopedPasses:
          (s.kind ?? "generate") === "generate" && Math.floor(s.loopedPasses ?? 0) >= 2
            ? Math.min(Math.floor(s.loopedPasses ?? 0), 3)
            : undefined,
      }));
    if (validSteps.length === 0) {
      toast.error("Add at least one step with an agent");
      return;
    }
    const descriptionTrim = description.trim();
    // r503: pipeline lane pin saves with the workflow (undefined = follow
    // agents) — mirrors depth.
    const laneTrim = lane.trim();
    if (workflow) {
      updateWf(workflow.id, {
        name: trimmedName,
        description: descriptionTrim,
        steps: validSteps,
        depth,
        lane: laneTrim || undefined,
      });
      toast.success("Workflow updated");
    } else {
      const newId = addWf({ name: trimmedName, description: descriptionTrim, steps: validSteps });
      // The store's add() only materializes known fields — persist depth and
      // the lane pin via a follow-up patch so new workflows carry them too.
      updateWf(newId, { depth, lane: laneTrim || undefined });
      toast.success("Workflow created");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{workflow ? "Edit workflow" : "New workflow"}</DialogTitle>
          <DialogDescription>
            An ordered pipeline — each step runs one agent and hands its output to
            the next.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {agents.length === 0 ? (
            <p className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-xs text-muted-foreground">
              You need at least one agent before you can assign steps — create
              agents in the Agents view first.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                ref={nameInputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Blog post factory"
                autoFocus
                aria-invalid={saveAttempted && !name.trim()}
                aria-describedby={
                  saveAttempted && !name.trim() ? "wf-name-error" : undefined
                }
                className={cn(
                  saveAttempted &&
                    !name.trim() &&
                    "border-red-500/60 focus-visible:ring-red-500/30"
                )}
              />
              {saveAttempted && !name.trim() ? (
                <p
                  id="wf-name-error"
                  role="alert"
                  className="text-xs text-red-500 dark:text-red-400"
                >
                  Give your workflow a name
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="wf-desc">Description</Label>
              <Input
                id="wf-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this pipeline delivers"
              />
            </div>
          </div>

          {/* Pipeline depth (r26): how much rigor the runner injects at run time */}
          <div className="space-y-2">
            <Label>Depth</Label>
            <div
              role="group"
              aria-label="Pipeline depth"
              className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              {DEPTH_OPTIONS.map((opt) => {
                const active = depth === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDepth(opt.v)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-all",
                      active
                        ? "border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/30"
                        : "border-border/70 hover:bg-muted/60"
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <span
                        aria-hidden
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          active ? "bg-violet-400 soft-pulse" : "bg-muted-foreground/30"
                        )}
                      />
                      {opt.label}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block text-[11px] leading-snug",
                        active ? "text-foreground/80" : "text-muted-foreground"
                      )}
                    >
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* r503 (owner directive): pipeline-default lane — pin the whole
              pipeline (deep passes inherit step 1's lane, verification the
              last step's) to one provider::model, or leave it on "Follow
              agents". Options ARE the relay chain the runner walks, with
              quality marks per lane: tier + Elo (quality), usage counts,
              rotator trust (free / blocked / sick / throttled badges). */}
          <div className="space-y-2">
            <Label>Pipeline lane</Label>
            <ModelPicker
              value={lane}
              options={pipelineLaneOptions}
              onSelect={setLane}
              placeholder="Follow agents (default)"
              searchPlaceholder="Search lanes — provider, model, tier, free…"
              emptyTitle="No lane matches"
              emptyHint="Labels, lane ids, notes and quality keywords all count."
              ariaLabel="Pipeline lane"
            />
            <p className="text-[11px] text-muted-foreground" aria-live="polite">
              {lane
                ? `Pinned: every step dials ${laneShortName(lane)} (${lane}) — spread load instead with per-step lanes below.`
                : "Each step dials its agent's model via the global provider. Pin one lane here to stop exhausting a single API source."}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Steps</Label>
              <span className="text-[11px] text-muted-foreground">
                {steps.length} step{steps.length === 1 ? "" : "s"} · run top to bottom · drag ⠿ to reorder
              </span>
            </div>

            {/* r232 truth-in-save: a blocked save says so HERE, naming the
                unassigned count — pre-fix these steps were dropped silently. */}
            {saveAttempted && steps.some((s) => !s.agentId) ? (
              <p
                id="wf-steps-error"
                role="alert"
                className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-500 dark:text-red-400"
              >
                {steps.filter((s) => !s.agentId).length} step
                {steps.filter((s) => !s.agentId).length === 1 ? " has" : "s have"} no
                agent assigned — pick an agent or remove the step. Nothing was
                saved.
              </p>
            ) : null}

            {/* Depth summary — what the runner will actually execute */}
            <p className="text-[11px] text-muted-foreground" aria-live="polite">
              <span className="font-medium text-violet-500 dark:text-violet-400">
                {DEPTH_OPTIONS.find((o) => o.v === depth)?.label}
              </span>{" "}
              run: {steps.length || "0"} authored step{steps.length === 1 ? "" : "s"}{" "}
              {steps.some((s) => (s.kind ?? "generate") === "review")
                ? "· your review gate handles verification"
                : DEPTH_OPTIONS.find((o) => o.v === depth)?.summary}
            </p>

            {steps.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                No steps yet — add one below or let AI auto-assign agents.
              </div>
            ) : null}

            {steps.map((step, i) => {
              const agent = agents.find((a) => a.id === step.agentId);
              const isDragging = dragIndex === i;
              const isDropTarget = overIndex === i && dragIndex !== null && !isDragging;
              return (
                <div
                  key={step.id}
                  draggable
                  onDragStart={(e) => {
                    // Only the grip handle may start a drag — keeps text
                    // selection inside inputs/textareas working normally.
                    const t = e.target as HTMLElement;
                    if (!t.closest("button[data-drag-handle]")) {
                      e.preventDefault();
                      return;
                    }
                    setDragIndex(i);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", step.id);
                  }}
                  onDragOver={(e) => {
                    if (dragIndex === null || dragIndex === i) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setOverIndex(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && overIndex !== null) {
                      reorderStep(dragIndex, overIndex);
                    }
                    clearDrag();
                  }}
                  onDragEnd={clearDrag}
                  className={cn(
                    "space-y-2 rounded-lg border p-3 transition-all",
                    isDragging && "opacity-50 ring-2 ring-violet-500/40",
                    isDropTarget &&
                      "border-violet-500/60 bg-violet-500/5 ring-1 ring-violet-500/30"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-drag-handle
                      aria-label={`Drag handle for step ${i + 1} — hold and drag to reorder`}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          moveStep(i, -1);
                        } else if (e.key === "ArrowDown") {
                          e.preventDefault();
                          moveStep(i, 1);
                        }
                      }}
                      className="flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/40 transition-colors hover:bg-muted hover:text-violet-400 active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4" aria-hidden />
                    </button>
                    <StepIndexBadge index={i} />
                    <Select
                      value={step.agentId}
                      onValueChange={(v) => patchStep(step.id, { agentId: v })}
                    >
                      <SelectTrigger
                        size="sm"
                        className={cn(
                          "flex-1",
                          saveAttempted &&
                            !step.agentId &&
                            "border-red-500/60 focus-visible:ring-red-500/30"
                        )}
                        aria-label={`Agent for step ${i + 1}`}
                        aria-invalid={saveAttempted && !step.agentId}
                        aria-describedby={
                          saveAttempted && !step.agentId
                            ? "wf-steps-error"
                            : undefined
                        }
                        ref={(el) => {
                          if (el) stepTriggerRefs.current.set(step.id, el);
                          else stepTriggerRefs.current.delete(step.id);
                        }}
                      >
                        <SelectValue placeholder="Select agent" />
                      </SelectTrigger>
                      <SelectContent>
                        {agents.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            <span className="flex items-center gap-2">
                              <span aria-hidden>{a.emoji}</span>
                              {a.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex shrink-0 items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={i === 0}
                        onClick={() => moveStep(i, -1)}
                        aria-label={`Move step ${i + 1} up`}
                      >
                        <ChevronUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={i === steps.length - 1}
                        onClick={() => moveStep(i, 1)}
                        aria-label={`Move step ${i + 1} down`}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                        onClick={() => removeStep(step.id)}
                        aria-label={`Remove step ${i + 1}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* r503 (owner directive): per-step lane override — empty =
                      pipeline default. A pinned step dials that exact
                      provider::model even when the pipeline lane or the
                      agent's model differ; the note on each option carries
                      the quality marks (no vault key → the catalog says so).
                      The picker trigger never starts a drag — dragstart is
                      gated on [data-drag-handle]. */}
                  <div className="flex items-center gap-2">
                    <Label className="w-12 shrink-0 text-[11px] font-normal text-muted-foreground">
                      Lane
                    </Label>
                    <ModelPicker
                      value={step.lane ?? ""}
                      options={stepLaneOptions}
                      onSelect={(id) => patchStep(step.id, { lane: id || undefined })}
                      placeholder="Pipeline default"
                      searchPlaceholder="Search lanes…"
                      emptyTitle="No lane matches"
                      ariaLabel={`Lane for step ${i + 1}`}
                      className="h-8 flex-1 text-xs"
                    />
                  </div>

                  <Input
                    value={step.label}
                    onChange={(e) => patchStep(step.id, { label: e.target.value })}
                    placeholder={
                      (step.kind ?? "generate") === "review"
                        ? "What this gate checks, e.g. Verify the code actually runs"
                        : "What this step does, e.g. Research the topic"
                    }
                    aria-label={`Label for step ${i + 1}`}
                  />

                  {/* Step kind: generate vs review gate (quality gate with rework) */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div
                      role="radiogroup"
                      aria-label={`Kind for step ${i + 1}`}
                      className="flex overflow-hidden rounded-lg border"
                    >
                      {(
                        [
                          { v: "generate", label: "Generate", icon: null },
                          { v: "review", label: "Review gate", icon: null },
                        ] as const
                      ).map((opt) => {
                        const active = (step.kind ?? "generate") === opt.v;
                        return (
                          <button
                            key={opt.v}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() =>
                              patchStep(step.id, {
                                kind: opt.v as StepKind,
                              })
                            }
                            className={cn(
                              "px-2.5 py-1 text-[11px] font-medium transition-colors",
                              active
                                ? opt.v === "review"
                                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                  : "bg-violet-500/15 text-violet-500 dark:text-violet-400"
                                : "text-muted-foreground hover:bg-muted"
                            )}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {/* r645 (paper adaptation slice 2b, arXiv 2610.31421):
                        looped-depth opt-in for generate steps — on a gate
                        FAIL the TIED rework prompt re-runs up to r passes,
                        each re-judged. Off = legacy single rework (default,
                        byte-identical); the runner engages only at r >= 2,
                        hard cap 3 (RegBench plateau). Amber tint mirrors the
                        run-row "↻ looped k/r" chip. */}
                    {(step.kind ?? "generate") === "generate" ? (
                      <div
                        role="radiogroup"
                        aria-label={`Looped depth for step ${i + 1}`}
                        className="flex items-center gap-1.5"
                      >
                        <span className="text-[11px] text-muted-foreground">Looped</span>
                        <div className="flex overflow-hidden rounded-lg border">
                          {([null, 2, 3] as const).map((n) => {
                            const active =
                              n === null
                                ? step.loopedPasses == null
                                : step.loopedPasses === n;
                            return (
                              <button
                                key={String(n)}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                title={
                                  n === null
                                    ? "Legacy single-rework path (default)"
                                    : `On a gate FAIL, the tied rework prompt re-runs up to ×${n}, each pass re-judged — arXiv 2610.31421 looped-depth adaptation`
                                }
                                onClick={() =>
                                  patchStep(step.id, { loopedPasses: n ?? undefined })
                                }
                                className={cn(
                                  "px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
                                  active
                                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                    : "text-muted-foreground hover:bg-muted"
                                )}
                              >
                                {n === null ? "Off" : `×${n}`}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    {(step.kind ?? "generate") === "review" ? (
                      <span className="text-[11px] text-amber-600/90 dark:text-amber-400/90">
                        ↻ Audits the previous step — can send it back for one rework pass
                      </span>
                    ) : (step.loopedPasses ?? 0) >= 2 ? (
                      <span className="text-[11px] font-medium text-amber-600/90 dark:text-amber-400/90">
                        ↻ tied rework ×{Math.min(Math.floor(step.loopedPasses ?? 0), 3)} —
                        every pass re-judged by the gate
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Produces output for the next step
                      </span>
                    )}

                    {/* r182 (directive item (a) completion): the explicit role
                        field — the honest home the directive asked for. Empty =
                        legacy "[Tag]" label prefixes keep working; anything
                        typed here WINS over the label prefix. Routing still
                        follows the selected agent, visibly. */}
                    <Input
                      value={step.roleId ?? ""}
                      onChange={(e) => patchStep(step.id, { roleId: e.target.value })}
                      placeholder="Role tag (optional)"
                      aria-label={`Role tag for step ${i + 1} — explicit role identity; routing still follows the selected agent`}
                      className="ml-auto h-8 w-full text-xs sm:w-44"
                    />
                  </div>

                  {/* r651: precedent-exemplar lane preview — what the archive
                      would inject for this step, live while authoring. */}
                  {(step.kind ?? "generate") === "generate" ? (
                    <PrecedentLanePreview
                      query={`${agent?.name ?? ""} ${step.label ?? ""} ${step.instruction ?? ""}`}
                      stepIndex={i + 1}
                    />
                  ) : null}

                  {/* r182: authoring-time honesty — an explicit role that
                      disagrees with the worker says so NOW, not after a run. */}
                  {(() => {
                    const explicit = (step.roleId ?? "").trim();
                    if (!explicit || !agent) return null;
                    if (roleMatchesAgent(explicit, agent.name)) return null;
                    return (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400">
                        ⚠ Role “{explicit}” doesn’t match worker “{agent.name}” — routing follows the worker.
                      </p>
                    );
                  })()}

                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ChevronDown className="h-3 w-3" />
                        Step instruction override
                        {step.instruction ? (
                          <span className="text-violet-400">· set</span>
                        ) : null}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <Textarea
                        rows={2}
                        value={step.instruction ?? ""}
                        onChange={(e) =>
                          patchStep(step.id, { instruction: e.target.value })
                        }
                        placeholder={
                          "Extra system-prompt focus injected at run time, e.g. \"Keep findings under 200 words\""
                        }
                        aria-label={`Instruction override for step ${i + 1}`}
                        className="max-h-40 overflow-y-auto" /* r516: long pastes stay scrollable, dialog never blown open */
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {agent
                          ? `Appended to ${agent.name}'s system prompt during this step only.`
                          : "Appended to the step agent's system prompt at run time."}
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              );
            })}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addStep}
                disabled={agents.length === 0}
              >
                <Plus className="h-4 w-4" />
                Add step
              </Button>
              {steps.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addReviewStep}
                  disabled={agents.length === 0}
                  className="border-amber-500/40 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400"
                >
                  <Plus className="h-4 w-4" />
                  Review gate
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  // r235: collapsing the panel mid-generation cancels the run.
                  if (planOpen && planning) planAbortRef.current?.abort();
                  setPlanOpen((v) => !v);
                }}
                disabled={agents.length === 0}
                aria-expanded={planOpen}
              >
                <Sparkles className="h-4 w-4 text-violet-400" />
                ✨ Auto-assign with AI
              </Button>
            </div>

            {planOpen ? (
              <div className="space-y-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
                <Label htmlFor="wf-plan-task" className="text-xs">
                  Describe the goal — AI will pick agents and order the steps
                </Label>
                <Textarea
                  id="wf-plan-task"
                  rows={2}
                  value={planTask}
                  onChange={(e) => setPlanTask(e.target.value)}
                  placeholder="e.g. Research the state of AI agents, distill the top trends into an outline, then write a short blog post"
                  className="max-h-40 overflow-y-auto" /* r516: same paste guard */
                />
                <div className="flex justify-end gap-2">
                  {planning ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => planAbortRef.current?.abort()}
                    >
                      Cancel
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    onClick={generatePlan}
                    disabled={planning}
                  >
                    {planning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {planning ? "Generating…" : "Generate"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>{workflow ? "Save changes" : "Create workflow"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// 1-based index pill for a step row
function StepIndexBadge({ index }: { index: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-xs font-semibold text-violet-400">
      {index + 1}
    </span>
  );
}
