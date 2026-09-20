"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  Clock,
  Columns3,
  Copy,
  Download,
  LayoutList,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useAgentsStore,
  useUiStore,
  useWorkflowsStore,
} from "@/lib/stores";
import type { Workflow, WorkflowStep } from "@/lib/types";
import { downloadJson, fmtIn, fmtIntervalShort, fmtRel, uid } from "@/lib/helpers";
import { cn } from "@/lib/utils";
import { AgentAvatar, DepthChip, EmptyState, PageHeader } from "@/components/praison/atoms";
import { WorkflowEditorDialog } from "./workflow-editor-dialog";
import { WorkflowRunPanel } from "./workflow-run-panel";
import { RunKanban } from "./run-kanban";

// ─── Workflow import/export helpers ─────────────────────────────────

function slugifyWf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workflow"
  );
}

function exportWorkflows(workflows: Workflow[]) {
  // Runs are history — not portable. Export the definition only.
  downloadJson(
    workflows.length === 1
      ? `praison-workflow-${slugifyWf(workflows[0].name)}.json`
      : "praison-workflows.json",
    {
      kind: "praison-workflows",
      version: 1,
      exportedAt: new Date().toISOString(),
      workflows: workflows.map((w) => ({
        name: w.name,
        description: w.description,
        steps: w.steps,
        ...(w.depth ? { depth: w.depth } : {}),
      })),
    }
  );
}

/** Validate an untrusted parsed value as a Workflow; returns null when unusable. */
function sanitizeWorkflow(raw: unknown, validAgentIds: Set<string>): Workflow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

  const rawSteps = Array.isArray(r.steps) ? r.steps : [];
  const steps: WorkflowStep[] = [];
  for (const rs of rawSteps) {
    if (!rs || typeof rs !== "object") continue;
    const s = rs as Record<string, unknown>;
    const agentId = typeof s.agentId === "string" ? s.agentId : "";
    if (!agentId || !validAgentIds.has(agentId)) continue; // drop steps w/o a local agent
    steps.push({
      id: uid("step"),
      agentId,
      label: str(s.label, "Step").slice(0, 200) || "Step",
      instruction: s.instruction ? str(s.instruction).slice(0, 2000) : undefined,
      kind: s.kind === "review" ? ("review" as const) : ("generate" as const),
    });
  }
  if (steps.length === 0) return null;

  const now = Date.now();
  return {
    id: uid("wf"),
    name: name.slice(0, 80),
    description: str(r.description).slice(0, 300),
    steps,
    runs: [],
    createdAt: now,
    updatedAt: now,
    ...(r.depth === "quick" || r.depth === "standard" || r.depth === "deep"
      ? { depth: r.depth as Workflow["depth"] }
      : {}),
  };
}

// ─── Workflow Studio · grid of pipelines, editor dialog + run panel ─────────

export function WorkflowsView() {
  const workflows = useWorkflowsStore((s) => s.workflows);
  const agents = useAgentsStore((s) => s.agents);
  const addWf = useWorkflowsStore((s) => s.add);
  const duplicateWf = useWorkflowsStore((s) => s.duplicate);
  const removeWf = useWorkflowsStore((s) => s.remove);

  // Keep schedule countdowns honest (cheap re-render every 30s when needed)
  const hasSchedules = workflows.some((w) => w.schedule?.enabled);
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!hasSchedules) return;
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [hasSchedules, tick]);

  const activeSchedules = workflows.filter(
    (w) => w.schedule?.enabled && w.steps.length > 0
  ).length;

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Workflow | null>(null);
  const [runOpen, setRunOpen] = React.useState(false);
  const [running, setRunning] = React.useState<Workflow | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Workflow | null>(null);
  const [pendingRunFocus, setPendingRunFocus] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Grid ↔ board layout toggle (persisted in the ui store)
  const boardOpen = useUiStore((s) => s.workflowBoardOpen);
  const setBoardOpen = useUiStore((s) => s.setWorkflowBoardOpen);

  const agentById = React.useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents]
  );

  // The command palette (⌘K) can request a workflow run from anywhere
  const pendingRunId = useUiStore((s) => s.pendingRunWorkflowId);
  const clearPendingRun = useUiStore((s) => s.clearPendingRunWorkflow);
  React.useEffect(() => {
    if (!pendingRunId) return;
    const wf = useWorkflowsStore.getState().workflows.find((w) => w.id === pendingRunId);
    clearPendingRun();
    if (wf && wf.steps.length > 0) {
      setRunning(wf);
      setRunOpen(true);
    } else if (wf) {
      toast.error(`“${wf.name}” has no steps yet — add agents first.`, {
        action: {
          label: "Edit",
          onClick: () => {
            setEditing(wf);
            setEditorOpen(true);
          },
        },
      });
    }
  }, [pendingRunId, clearPendingRun]);

  const openNew = React.useCallback(() => {
    setEditing(null);
    setEditorOpen(true);
  }, []);

  const openEdit = React.useCallback((wf: Workflow) => {
    setEditing(wf);
    setEditorOpen(true);
  }, []);

  const openRun = React.useCallback((wf: Workflow) => {
    setRunning(wf);
    setPendingRunFocus(null);
    setRunOpen(true);
  }, []);

  /** Kanban card → open the run panel on that specific run. */
  const openRunFromBoard = React.useCallback((workflowId: string, runId?: string) => {
    const wf = useWorkflowsStore.getState().workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    setRunning(wf);
    setPendingRunFocus(runId ?? null);
    setRunOpen(true);
  }, []);

  const handleDuplicate = (wf: Workflow) => {
    const id = duplicateWf(wf.id);
    if (id) toast.success(`Duplicated "${wf.name}"`);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    removeWf(deleteTarget.id);
    toast.success(`Deleted "${deleteTarget.name}"`);
    setDeleteTarget(null);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { workflows?: unknown }).workflows)
          ? (parsed as { workflows: unknown[] }).workflows
          : null;
      if (!list) {
        toast.error("Invalid workflow file", {
          description: "Expected a workflows array or a PraisonAI export.",
        });
        return;
      }
      const validAgentIds = new Set(useAgentsStore.getState().agents.map((a) => a.id));
      const imported = list
        .map((w) => sanitizeWorkflow(w, validAgentIds))
        .filter((w): w is Workflow => w !== null);
      if (imported.length === 0) {
        toast.error("No usable workflows found", {
          description: "Workflows need a name and at least one step whose agent exists in your roster.",
        });
        return;
      }
      for (const w of imported) addWf(w);
      const skipped = list.length - imported.length;
      toast.success(
        `Imported ${imported.length} workflow${imported.length === 1 ? "" : "s"}` +
          (skipped > 0 ? ` (${skipped} skipped)` : "")
      );
    } catch {
      toast.error("Could not read that file as JSON.");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Workflow Studio"
        description="Chain agents into sequential multi-agent pipelines"
      >
        {activeSchedules > 0 && (
          <span
            title={`${activeSchedules} workflow${activeSchedules === 1 ? "" : "s"} on a recurring schedule`}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {activeSchedules} scheduled
          </span>
        )}
        <div
          role="radiogroup"
          aria-label="Layout"
          className="flex overflow-hidden rounded-lg border"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!boardOpen}
            aria-label="Card grid layout"
            title="Card grid"
            onClick={() => setBoardOpen(false)}
            className={cn(
              "flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium transition-colors",
              !boardOpen
                ? "bg-violet-500/15 text-violet-500 dark:text-violet-400"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <LayoutList className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Pipelines</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={boardOpen}
            aria-label="Runs board layout"
            title="Runs board"
            onClick={() => setBoardOpen(true)}
            className={cn(
              "flex h-8 items-center gap-1.5 border-l px-2.5 text-xs font-medium transition-colors",
              boardOpen
                ? "bg-violet-500/15 text-violet-500 dark:text-violet-400"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            <Columns3 className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Runs board</span>
          </button>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Import workflows"
        >
          <Upload className="h-4 w-4" />
          <span className="hidden sm:inline">Import</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={workflows.length === 0}
          onClick={() => exportWorkflows(workflows)}
          aria-label="Export all workflows"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Export</span>
        </Button>
        <Button size="sm" onClick={openNew} aria-label="New Workflow">
          <Plus className="h-4 w-4" />
          New Workflow
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void handleImportFile(e)}
          aria-hidden
          tabIndex={-1}
        />
      </PageHeader>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {agents.length === 0 ? (
          <Alert className="mb-4 border-violet-500/30 bg-violet-500/5">
            <Users className="h-4 w-4 text-violet-400" />
            <AlertTitle>You need at least one agent to build workflows</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-muted-foreground">
                Agents are the workers of a pipeline — create them first, then compose steps.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => useUiStore.getState().setView("agents")}
              >
                Go to Agents
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {boardOpen ? (
          <RunKanban onSelect={openRunFromBoard} />
        ) : workflows.length === 0 ? (
          <EmptyState
            emoji="🧩"
            title="No workflows yet"
            description="Compose agents into a pipeline — e.g. Researcher → Planner → Writer."
            action={
              <Button size="sm" onClick={openNew}>
                <Plus className="h-4 w-4" />
                New Workflow
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {workflows.map((wf) => {
              const lastRun = wf.runs[0];
              return (
                <Card key={wf.id} className="card-lift gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 truncate text-sm font-semibold md:text-[15px]">
                      {wf.name}
                    </h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label={`Actions for ${wf.name}`}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => openRun(wf)}>
                          <Play className="h-4 w-4" />
                          Run
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(wf)}>
                          <Pencil className="h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(wf)}>
                          <Copy className="h-4 w-4" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => exportWorkflows([wf])}>
                          <Download className="h-4 w-4" />
                          Export
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(wf)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {wf.description ? (
                    <p className="line-clamp-1 text-sm text-muted-foreground">
                      {wf.description}
                    </p>
                  ) : null}

                  <div
                    className="flex flex-wrap items-center gap-1.5"
                    aria-label={`${wf.steps.length} steps`}
                  >
                    {wf.steps.map((step, i) => {
                      const agent = agentById.get(step.agentId);
                      const isReview = (step.kind ?? "generate") === "review";
                      return (
                        <React.Fragment key={step.id}>
                          {i > 0 ? (
                            <ChevronRight
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                          ) : null}
                          <span
                            title={step.label || agent?.name}
                            className={cn(
                              "flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5",
                              isReview
                                ? "border-amber-500/40 bg-amber-500/10"
                                : "border bg-muted/40"
                            )}
                          >
                            {isReview ? (
                              <ShieldAlert
                                className="ml-1 h-3 w-3 shrink-0 text-amber-500"
                                aria-hidden
                              />
                            ) : null}
                            <AgentAvatar agent={agent} size="xs" />
                            <span className="max-w-32 truncate text-xs font-medium">
                              {agent?.name ?? step.label ?? "Unassigned"}
                            </span>
                          </span>
                        </React.Fragment>
                      );
                    })}
                    {wf.steps.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No steps yet — edit to add some
                      </span>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <DepthChip depth={wf.depth} />
                      <span className="text-[11px] text-muted-foreground">
                        {lastRun
                          ? `${wf.runs.length} run${wf.runs.length === 1 ? "" : "s"} · last ${fmtRel(lastRun.startedAt)}`
                          : "Never run"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {wf.schedule?.enabled && wf.steps.length > 0 && (
                        <span
                          title={`Recurring schedule · next ${fmtIn(wf.schedule.nextRunAt)}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                        >
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          </span>
                          {fmtIntervalShort(wf.schedule.intervalMs)} · next {fmtIn(wf.schedule.nextRunAt)}
                        </span>
                      )}
                      <Button size="sm" onClick={() => openRun(wf)}>
                        <Play className="h-3.5 w-3.5" />
                        Run
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(wf)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <WorkflowEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        workflow={editing}
      />

      <WorkflowRunPanel
        open={runOpen}
        onOpenChange={(v) => {
          setRunOpen(v);
          if (!v) setPendingRunFocus(null);
        }}
        workflow={running}
        initialRunId={pendingRunFocus}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the workflow and its run history. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "bg-red-600 text-white hover:bg-red-600/90 focus-visible:ring-red-600/40"
              )}
              onClick={handleDelete}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
