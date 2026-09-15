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
import { downloadJson, fmtRel } from "@/lib/helpers";
import { useAgentsStore, useConversationsStore } from "@/lib/stores";
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

/** Validate an untrusted parsed value as an Agent; returns null when unusable. */
function sanitizeAgent(raw: unknown): Agent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
  const num = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  return {
    id: `agent_${Math.random().toString(36).slice(2, 14)}`,
    name: name.slice(0, 60),
    emoji: str(r.emoji, "🤖").slice(0, 2) || "🤖",
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
  lastAt: number;
}

export function AgentsView() {
  const agents = useAgentsStore((s) => s.agents);
  const addAgent = useAgentsStore((s) => s.add);
  const removeAgent = useAgentsStore((s) => s.remove);
  const duplicateAgent = useAgentsStore((s) => s.duplicate);
  const conversations = useConversationsStore((s) => s.conversations);

  // Per-agent usage (assistant replies in stored chats) — local data only
  const usage = React.useMemo(() => {
    const map = new Map<string, AgentUsage>();
    for (const conv of conversations) {
      for (const m of conv.messages) {
        if (m.role !== "assistant" || !m.agentId) continue;
        const cur = map.get(m.agentId) ?? { replies: 0, lastAt: 0 };
        cur.replies += 1;
        cur.lastAt = Math.max(cur.lastAt, m.createdAt);
        map.set(m.agentId, cur);
      }
    }
    return map;
  }, [conversations]);

  const [formOpen, setFormOpen] = React.useState(false);
  const [formAgent, setFormAgent] = React.useState<Agent | null>(null);
  const [testOpen, setTestOpen] = React.useState(false);
  const [testAgent, setTestAgent] = React.useState<Agent | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Agent | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

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
    const newId = duplicateAgent(agent.id);
    if (newId) toast.success(`Duplicated "${agent.name}"`);
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
      const imported = list
        .map(sanitizeAgent)
        .filter((a): a is Agent => a !== null)
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
                usage={usage.get(agent.id)}
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
              Workflows that reference it will need to be updated.
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
      className="card-lift flex cursor-pointer flex-col gap-4 p-4 hover:ring-1 hover:ring-primary/30"
      onClick={onTest}
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
        <p className="text-[11px] text-muted-foreground">Updated {fmtRel(agent.updatedAt)}</p>
        {usage && usage.replies > 0 && (
          <div
            className="flex items-center gap-1.5 rounded-lg border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-[11px] text-foreground/85"
            title={`${agent.name} has written ${usage.replies} replies in your chats`}
          >
            <span className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            <span className="tabular-nums font-medium text-violet-400">{usage.replies}</span>
            <span>repl{usage.replies === 1 ? "y" : "ies"}</span>
            <span aria-hidden>·</span>
            <span className="text-muted-foreground">last {fmtRel(usage.lastAt)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
