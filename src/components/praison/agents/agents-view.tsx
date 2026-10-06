"use client";

import * as React from "react";
import { Copy, Download, FlaskConical, MoreVertical, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentAvatar, EmptyState, ModelBadge, PageHeader, ToolBadge } from "@/components/praison/atoms";
import { AgentFormDialog } from "@/components/praison/agents/agent-form-dialog";
import { TestAgentDialog } from "@/components/praison/agents/test-agent-dialog";
import { downloadJson, firstGrapheme, fmtRel } from "@/lib/helpers";
import { useAgentsStore, useConversationsStore, useWorkflowsStore } from "@/lib/stores";
import type { Agent, AgentColor, ToolId } from "@/lib/types";

// ─── Agent import/export helpers ─────────────────────────────────────

const VALID_COLORS: AgentColor[] = ["violet", "emerald", "amber", "rose", "cyan", "fuchsia"];
const VALID_TOOLS: ToolId[] = ["web_search", "read_url", "run_code", "current_time"];

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "agent"
  );
}

/** Validate an untrusted parsed value as an Agent; returns null when unusable.
 *  Exported for the agent-io unit suite (scripts/qa-agent-io.ts).
 *  `existingIds` lets the caller guarantee batch-unique ids: an entry whose
 *  original id is well-formed AND not yet taken keeps it (export → wipe →
 *  import then RESTORES workflow wiring — the delete dialog warns "steps
 *  will run without an agent until updated", and fresh-id import could
 *  never undo that). Re-importing onto an existing roster keeps the old
 *  behavior: every id collides → fresh copies, nothing clobbered. */
export function sanitizeAgent(raw: unknown, existingIds: Set<string> = new Set()): Agent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  // r226: keep the original id when it is a well-formed agent id and not
  // already in the roster; stamp() falls back to uid() only when we drop it.
  const rawId = typeof r.id === "string" ? r.id : "";
  const id = /^agent_[a-z0-9]+$/.test(rawId) && !existingIds.has(rawId)
    ? rawId
    : `agent_${Math.random().toString(36).slice(2, 14)}`;
  return {
    id,
    name: name.slice(0, 60),
    // r226: flags are 2 code points / 4 UTF-16 units — .slice(0, 2) cut them
    // in half on import (the form dialog fixed the same bug on input; the
    // sanitizer now shares firstGrapheme, so both agree on what one emoji is).
    emoji: firstGrapheme(str(r.emoji)) || "🤖",
    color: VALID_COLORS.includes(r.color as AgentColor)
      ? (r.color as AgentColor)
      : "violet",
    role: str(r.role).slice(0, 80),
    description: str(r.description).slice(0, 300),
    instructions: str(r.instructions).slice(0, 4000),
    model: str(r.model, "auto") || "auto",
    temperature: num(r.temperature, 0, 1.5, 0.7),
    maxIterations: Math.round(num(r.maxIterations, 1, 10, 3)),
    tools: Array.isArray(r.tools)
      ? [...new Set(r.tools.filter((t) => VALID_TOOLS.includes(t as ToolId)) as ToolId[])]
      : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function exportAgents(agents: Agent[]) {
  downloadJson(
    agents.length === 1 ? `praison-agent-${slugify(agents[0].name)}.json` : "praison-agents.json",
    {
      kind: "praison-agents",
      version: 1,
      exportedAt: new Date().toISOString(),
      agents,
    }
  );
}

// ─── Agents view: roster grid + create/edit/test/delete flows ────────────────

export interface AgentUsage {
  replies: number;
  /** Completed pipeline steps (r162) — chat replies alone made pipeline
   *  workhorses read as idle ("0 replies" while running 11-step workflows
   *  hourly). Steps counted only when status="done" (honest completed work). */
  steps: number;
  lastAt: number;
}

export function AgentsView() {
  const agents = useAgentsStore((s) => s.agents);
  const addAgent = useAgentsStore((s) => s.add);
  const removeAgent = useAgentsStore((s) => s.remove);
  const duplicateAgent = useAgentsStore((s) => s.duplicate);
  const conversations = useConversationsStore((s) => s.conversations);
  const workflows = useWorkflowsStore((s) => s.workflows);

  // Per-agent usage — local data only, two sources (r162): assistant replies
  // in stored chats AND completed pipeline steps (the roster previously read
  // chat-only, so the platform's actual workhorses — pipeline agents — showed
  // "0 replies" and looked idle while their schedules churned every hour).
  const usage = React.useMemo(() => {
    const map = new Map<string, AgentUsage>();
    for (const conv of conversations) {
      for (const m of conv.messages) {
        if (m.role !== "assistant" || !m.agentId) continue;
        const cur = map.get(m.agentId) ?? { replies: 0, steps: 0, lastAt: 0 };
        cur.replies += 1;
        cur.lastAt = Math.max(cur.lastAt, m.createdAt);
        map.set(m.agentId, cur);
      }
    }
    return map;
  }, [conversations]);

  const stepUsage = React.useMemo(() => {
    const map = new Map<string, AgentUsage>();
    for (const wf of workflows) {
      for (const run of wf.runs) {
        const at = run.finishedAt ?? run.startedAt;
        for (const st of run.steps) {
          if (!st.agentId || st.status !== "done") continue;
          const cur = map.get(st.agentId) ?? { replies: 0, steps: 0, lastAt: 0 };
          cur.steps += 1;
          cur.lastAt = Math.max(cur.lastAt, at);
          map.set(st.agentId, cur);
        }
      }
    }
    return map;
  }, [workflows]);

  const mergedUsage = React.useCallback(
    (agentId: string): AgentUsage | undefined => {
      const r = usage.get(agentId);
      const s = stepUsage.get(agentId);
      if (!r && !s) return undefined;
      return {
        replies: r?.replies ?? 0,
        steps: s?.steps ?? 0,
        lastAt: Math.max(r?.lastAt ?? 0, s?.lastAt ?? 0),
      };
    },
    [usage, stepUsage]
  );

  const [formOpen, setFormOpen] = React.useState(false);
  const [formAgent, setFormAgent] = React.useState<Agent | null>(null);
  const [testOpen, setTestOpen] = React.useState(false);
  const [testAgent, setTestAgent] = React.useState<Agent | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Agent | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // r221: the delete dialog used to warn "Workflows that reference it will
  // need to be updated" — a vague warning when the exact consequence is
  // computable from the SAME workflows array this view already holds.
  // Same-source doctrine (r216): the names in the dialog come from the one
  // array the runner actually reads, so the warning can never drift from
  // reality. A copy/duplicate agent (fresh id) correctly reads "none".
  const referencingWorkflows = React.useMemo(() => {
    if (!deleteTarget) return [] as string[];
    return workflows
      .filter((wf) => wf.steps.some((st) => st.agentId === deleteTarget.id))
      .map((wf) => wf.name);
  }, [deleteTarget, workflows]);

  const openCreate = () => {
    setFormAgent(null);
    setFormOpen(true);
  };

  const openEdit = (agent: Agent) => {
    setFormAgent(agent);
    setFormOpen(true);
  };

  const openTest = (agent: Agent) => {
    setTestAgent(agent);
    setTestOpen(true);
  };

  const handleDuplicate = (agent: Agent) => {
    // r287 (re-applied r288 after sandbox rollback): duplicateAgent returns
    // null when the agent is already gone from the store (another tab deleted
    // it between render and click) — r270 doctrine: an action that did nothing
    // must SAY so, not leave the user clicking a dead control. Same
    // silent-failure fix r286 shipped for workflow duplicate.
    const newId = duplicateAgent(agent.id);
    if (newId) toast.success(`Duplicated "${agent.name}"`);
    else
      toast.error(
        `Could not duplicate "${agent.name}" — it no longer exists. Refresh to sync.`
      );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    removeAgent(deleteTarget.id);
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
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { agents?: unknown }).agents)
          ? (parsed as { agents: unknown[] }).agents
          : null;
      if (!list) {
        toast.error("Invalid agent file", { description: "Expected an agents array or a PraisonAI export." });
        return;
      }
      const existingIds = new Set(agents.map((a) => a.id));
      // Feed each preserved id back into the set so duplicate ids WITHIN one
      // file cannot land twice — the roster never gets two agents with the
      // same id.
      const imported: Agent[] = [];
      for (const entry of list) {
        const a = sanitizeAgent(entry, existingIds);
        if (a) {
          existingIds.add(a.id);
          imported.push(a);
        }
      }
      if (imported.length === 0) {
        toast.error("No valid agents found in that file.");
        return;
      }
      for (const a of imported) addAgent(a);
      const skipped = list.length - imported.length;
      toast.success(
        `Imported ${imported.length} agent${imported.length === 1 ? "" : "s"}` +
          (skipped > 0 ? ` (${skipped} skipped)` : "")
      );
    } catch {
      toast.error("Could not read that file as JSON.");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Agent Roster"
        description="Create, test and manage your autonomous AI agents"
      >
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Import agents"
        >
          <Upload className="h-4 w-4" />
          <span className="hidden sm:inline">Import</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={agents.length === 0}
          onClick={() => exportAgents(agents)}
          aria-label="Export all agents"
        >
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Export</span>
        </Button>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          New Agent
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
          <EmptyState
            emoji="🤖"
            title="No agents yet"
            description="Create your first autonomous agent — give it a role, instructions and tools."
            action={
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New Agent
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                usage={mergedUsage(agent.id)}
                onTest={() => openTest(agent)}
                onEdit={() => openEdit(agent)}
                onDuplicate={() => handleDuplicate(agent)}
                onDelete={() => setDeleteTarget(agent)}
                onExport={() => exportAgents([agent])}
              />
            ))}
          </div>
        )}
      </div>

      <AgentFormDialog open={formOpen} onOpenChange={setFormOpen} agent={formAgent} />
      <TestAgentDialog open={testOpen} onOpenChange={setTestOpen} agent={testAgent} />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes &ldquo;{deleteTarget?.name}&rdquo; and its configuration.
              {referencingWorkflows.length > 0 ? (
                <>
                  {" "}
                  {referencingWorkflows.length}{" "}
                  {referencingWorkflows.length === 1 ? "workflow" : "workflows"} reference
                  {referencingWorkflows.length === 1 ? "s" : ""} it —{" "}
                  <span className="font-medium text-foreground">
                    {referencingWorkflows.slice(0, 3).join(", ")}
                    {referencingWorkflows.length > 3
                      ? ` and ${referencingWorkflows.length - 3} more`
                      : ""}
                  </span>
                  . Those steps will run without an agent until updated.
                </>
              ) : (
                <> No workflows reference it. This cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Agent card (click → test playground, kebab menu → the rest) ─────────────

function AgentCard({
  agent,
  usage,
  onTest,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
}: {
  agent: Agent;
  usage?: AgentUsage;
  onTest: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const visibleTools = agent.tools.slice(0, 3);
  const overflow = agent.tools.length - visibleTools.length;

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open test playground for ${agent.name}`}
      className="card-lift flex cursor-pointer flex-col gap-4 p-4 outline-none hover:ring-1 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-primary/60"
      onClick={onTest}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTest();
        }
      }}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <AgentAvatar agent={agent} size="lg" />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">{agent.name}</h3>
            <p className="truncate text-xs text-muted-foreground">{agent.role || "No role set"}</p>
          </div>
        </div>
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Actions for ${agent.name}`}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onTest}>
                <FlaskConical /> Test
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onExport}>
                <Download /> Export
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Description */}
      <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
        {agent.description || "No description yet."}
      </p>

      {/* Footer */}
      <div className="mt-auto space-y-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <ModelBadge model={agent.model} />
          <div className="flex items-center justify-end gap-1">
            {visibleTools.map((tool) => (
              <ToolBadge key={tool} tool={tool} />
            ))}
            {overflow > 0 ? (
              <Badge variant="secondary" className="font-normal">
                +{overflow}
              </Badge>
            ) : null}
            {agent.tools.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">No tools</span>
            ) : null}
          </div>
        </div>
        <p
          className="text-[11px] text-muted-foreground"
          title={`Last updated ${new Date(agent.updatedAt).toLocaleString()}`}
        >
          Updated {fmtRel(agent.updatedAt)}
        </p>
        {usage && (usage.replies > 0 || usage.steps > 0) && (
          <div
            className="flex items-center gap-1.5 rounded-lg border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-[11px] text-foreground/85"
            title={`${agent.name} has written ${usage.replies} chat ${usage.replies === 1 ? "reply" : "replies"} and completed ${usage.steps} pipeline ${usage.steps === 1 ? "step" : "steps"}`}
          >
            <span className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            {usage.replies > 0 && (
              <>
                <span className="tabular-nums font-medium text-violet-400">{usage.replies}</span>
                <span>repl{usage.replies === 1 ? "y" : "ies"}</span>
                {usage.steps > 0 && <span aria-hidden>·</span>}
              </>
            )}
            {usage.steps > 0 && (
              <>
                <span className="tabular-nums font-medium text-violet-400">{usage.steps}</span>
                <span>step{usage.steps === 1 ? "" : "s"}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="text-muted-foreground">last {fmtRel(usage.lastAt)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
