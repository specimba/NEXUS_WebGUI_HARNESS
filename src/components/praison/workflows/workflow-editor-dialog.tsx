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
import { AUTO_PLAN_SYSTEM } from "@/lib/constants";
import { extractJsonArray, fmtRel, uid } from "@/lib/helpers";
import {
  useAgentsStore,
  useSettingsStore,
  useWorkflowsStore,
} from "@/lib/stores";
import type { PipelineDepth, RunLesson, StepKind, Workflow, WorkflowStep } from "@/lib/types";
import { isAbortError, runAgentChat } from "@/lib/chat-client";
import { resolveLlm } from "@/lib/llm-config";
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

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [depth, setDepth] = React.useState<PipelineDepth>("standard");
  const [steps, setSteps] = React.useState<WorkflowStep[]>([]);
  const [planOpen, setPlanOpen] = React.useState(false);
  const [planTask, setPlanTask] = React.useState("");
  const [planning, setPlanning] = React.useState(false);

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
    setSteps(
      workflow
        ? workflow.steps.map((s) => ({ ...s }))
        : []
    );
    setPlanOpen(false);
    setPlanTask("");
    setPlanning(false);
  }, [open, workflow]);

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
    try {
      const settings = useSettingsStore.getState().settings;
      const agentList = useAgentsStore
        .getState()
        .agents.map((a) => ({ id: a.id, name: a.name, role: a.role }));
      const llm = resolveLlm(settings, "auto");
      const res = await runAgentChat({
        provider: llm.provider,
        apiKey: llm.apiKey,
        baseUrl: llm.baseUrl,
        model: llm.model,
        temperature: 0.2,
        maxIterations: 1,
        system: AUTO_PLAN_SYSTEM,
        messages: [
          {
            role: "user",
            content: `Task: ${task}\n\nAvailable agents JSON:\n${JSON.stringify(agentList)}`,
          },
        ],
      });
      const plan = extractJsonArray(res.content);
      const available = useAgentsStore.getState().agents;
      if (!plan || plan.length === 0 || available.length === 0) {
        toast.error("Couldn't generate a plan, add steps manually");
        return;
      }
      const validIds = new Set(available.map((a) => a.id));
      const mapped: WorkflowStep[] = plan.map((raw, i) => {
        const item = (raw ?? {}) as { label?: unknown; agentId?: unknown; instruction?: unknown };
        const label =
          typeof item.label === "string" && item.label.trim()
            ? item.label.trim()
            : `Step ${i + 1}`;
        const agentId =
          typeof item.agentId === "string" && validIds.has(item.agentId)
            ? item.agentId
            : available[i % available.length].id;
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
      toast.success(`Generated ${mapped.length} steps`);
    } catch (err) {
      if (!isAbortError(err)) {
        toast.error("Couldn't generate a plan, add steps manually");
      }
    } finally {
      setPlanning(false);
    }
  }

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Give your workflow a name");
      return;
    }
    const validSteps = steps
      .filter((s) => s.agentId)
      .map((s, i) => ({
        ...s,
        label: s.label.trim() || `Step ${i + 1}`,
        instruction: s.instruction?.trim() ? s.instruction.trim() : undefined,
      }));
    if (validSteps.length === 0) {
      toast.error("Add at least one step with an agent");
      return;
    }
    const descriptionTrim = description.trim();
    if (workflow) {
      updateWf(workflow.id, {
        name: trimmedName,
        description: descriptionTrim,
        steps: validSteps,
        depth,
      });
      toast.success("Workflow updated");
    } else {
      const newId = addWf({ name: trimmedName, description: descriptionTrim, steps: validSteps });
      // The store's add() only materializes known fields — persist depth via a
      // follow-up patch so new workflows carry their depth setting too.
      updateWf(newId, { depth });
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
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Blog post factory"
                autoFocus
              />
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Steps</Label>
              <span className="text-[11px] text-muted-foreground">
                {steps.length} step{steps.length === 1 ? "" : "s"} · run top to bottom · drag ⠿ to reorder
              </span>
            </div>

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
                        className="flex-1"
                        aria-label={`Agent for step ${i + 1}`}
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
                    {(step.kind ?? "generate") === "review" ? (
                      <span className="text-[11px] text-amber-600/90 dark:text-amber-400/90">
                        ↻ Audits the previous step — can send it back for one rework pass
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Produces output for the next step
                      </span>
                    )}
                  </div>

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
                onClick={() => setPlanOpen((v) => !v)}
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
                />
                <div className="flex justify-end">
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

        {/* r31 harness rank-3: Reflexion lessons — visible, deletable, never
            a hidden model-written doc (UX verdict from the expert panel). */}
        {workflow && (workflow.lessons?.length ?? 0) > 0 ? (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-sky-600 dark:text-sky-400">
                  Lessons from failed runs ({workflow.lessons!.length})
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Written automatically when a run fails or a review gate sends work back — injected into the
                  next run's context so the pipeline learns. Max {workflow.lessons!.length}/5 kept.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 text-muted-foreground hover:text-red-500"
                onClick={() => updateWf(workflow.id, { lessons: [] })}
              >
                <Trash2 className="h-3.5 w-3.5" /> Clear all
              </Button>
            </div>
            <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {workflow.lessons!.map((l: RunLesson, i: number) => (
                <li
                  key={`${l.at}-${i}`}
                  className="flex items-start justify-between gap-2 rounded-md border bg-background/70 px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded-full border px-1.5 py-px text-[10px] font-semibold",
                          l.kind === "rework"
                            ? "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                            : "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
                        )}
                      >
                        {l.kind}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{fmtRel(l.at)}</span>
                    </div>
                    <p className="mt-0.5 text-xs leading-snug text-foreground/90">{l.text}</p>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-red-500"
                    aria-label="Delete lesson"
                    onClick={() =>
                      updateWf(workflow.id, { lessons: workflow.lessons!.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

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
