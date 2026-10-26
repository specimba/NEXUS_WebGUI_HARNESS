"use client";

import * as React from "react";
import { Copy, Download, FlaskConical, MoreVertical, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentAvatar, EmptyState, ModelBadge, PageHeader, ToolBadge } from "@/components/nexus/atoms";
import { AgentFormDialog } from "@/components/nexus/agents/agent-form-dialog";
import { TestAgentDialog } from "@/components/nexus/agents/test-agent-dialog";
import { CrewPanel } from "@/components/nexus/agents/crew-panel";
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
    // r302: a missing/garbage maxIterations used to import as 3 — a third
    // default nobody chose; the create form seeds 6. One default everywhere.
    maxIterations: Math.round(num(r.maxIterations, 1, 10, 6)),
    tools: Array.isArray(r.tools)
      ? [...new Set(r.tools.filter((t) => VALID_TOOLS.includes(t as ToolId)) as ToolId[])]
      : [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function exportAgents(agents: Agent[]) {
  downloadJson(
    agents.length === 1 ? `nexus-agent-${slugify(agents[0].name)}.json` : "nexus-agents.json",
    {
      kind: "nexus-agents",
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

// ─── Plugin packs strip (r575 · TASK-103 slice 1) ──────────────────────
// The tools-registry UI half: packs the server loader picked up from
// plugins/*/manifest.json. Cyan = the lane/extension family; an invalid pack
// shows its validation errors instead of vanishing (honest registry doctrine:
// a broken pack is visible, never boot-crashing). No packs → renders nothing
// (honest zero state, no noise).
// r576: per-tool chips now carry the base's schema arg names + pinned preset
// keys in their tooltip, and chips that pin preset args get the stronger cyan
// tint — the pack-author vocabulary aid from the r575 correction, in the UI.
// r577: preset keys outside the base schema surface as "·drift" (amber chip +
// tooltip line) — registry-time detection of the r575 algo/op drift class.
// r583: the strip no longer re-fetches on EVERY mount (each #agents visit used
// to burn one /api/tools/registry round-trip and paint nothing while it flew).
// Module-level cache + in-flight dedupe + background revalidate (SWR): first
// paint is instant from cache, a fresh fetch lands in place, and a live/cached
// age chip names the data's vintage — with an explicit refresh affordance so
// the Owner can re-scan the registry without a full page reload.
// r604: a REQUESTED re-scan that never lands is no longer a silent no-op —
// the strip grows an amber "re-scan failed" chip (same vocabulary as the
// drift chips) while the last good scan stays on the wall with its true old
// vintage. The background revalidate failing at mount stays quiet: nothing
// was requested there, and the cached chip already names the paint's age.
type PacksData = {
  packs: {
    id: string;
    name: string;
    version: string;
    dir: string;
    tools: {
      name: string;
      base: string;
      description: string;
      args: string[];
      preset: Record<string, unknown> | null;
      unknownPresetKeys: string[];
    }[];
  }[];
  invalid: { dir: string; errors: string[] }[];
  checkedAt: number;
};

// Module-level (NOT per-mount) state: navigating away and back to #agents is
// instant, and concurrent mounts share one request instead of racing.
let packsCache: PacksData | null = null;
let packsInflight: Promise<PacksData | null> | null = null;

function fetchPacks(): Promise<PacksData | null> {
  if (packsInflight) return packsInflight;
  packsInflight = fetch("/api/tools/registry")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j && Array.isArray(j.packs)) {
        packsCache = { packs: j.packs, invalid: j.invalid ?? [], checkedAt: Date.now() };
        return packsCache;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      packsInflight = null;
    });
  return packsInflight;
}

function PluginPacksPanel() {
  // Hydrate from the cache synchronously — no flash of nothing on revisit.
  const [data, setData] = React.useState<PacksData | null>(() => packsCache);
  const [live, setLive] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  // r604: the last requested re-scan failed to land — never true from a mere
  // mount revalidate, so the chip only appears when the Owner asked and the
  // registry answered with silence.
  const [failed, setFailed] = React.useState(false);

  // Background revalidate: the cached paint stays up while a fresh fetch runs;
  // only a NEW payload object (new checkedAt) replaces the state.
  React.useEffect(() => {
    let alive = true;
    fetchPacks().then((j) => {
      if (alive && j) {
        setData(j);
        setLive(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = () => {
    setRefreshing(true);
    setLive(false);
    setFailed(false);
    void fetchPacks().then((j) => {
      if (j) {
        setData(j);
        setLive(true);
      } else {
        // r604: honesty face — the re-scan the Owner requested did not land.
        // Keep the cached paint (it is still the newest truth) and say so.
        setFailed(true);
      }
      setRefreshing(false);
    });
  };

  if (!data || (data.packs.length === 0 && data.invalid.length === 0)) return null;
  const toolCount = data.packs.reduce((n, p) => n + p.tools.length, 0);
  return (
    <div
      data-testid="plugin-packs-panel"
      className="mb-4 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] p-3"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Plugin packs</span>
        <span className="rounded-md border border-cyan-500/30 bg-cyan-500/5 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-cyan-600 dark:text-cyan-400">
          {data.packs.length} pack{data.packs.length === 1 ? "" : "s"} · {toolCount} tool{toolCount === 1 ? "" : "s"}
        </span>
        <span
          title={
            live
              ? "Fresh from /api/tools/registry this visit"
              : "Rendered from the cached registry payload — the background revalidate keeps it honest"
          }
          className="rounded-md border border-cyan-500/30 bg-cyan-500/5 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-cyan-600 dark:text-cyan-400"
        >
          {live ? "live" : "cached"} ·{" "}
          {new Date(data.checkedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {failed && (
          <span
            title="The re-scan fetch did not land (registry API unreachable this visit) — the strip still shows the last good scan; nothing was invented while it failed. Hit refresh to retry."
            className="rounded-md border border-amber-500/40 bg-amber-500/[0.07] px-1.5 py-0.5 text-[10.5px] font-medium text-amber-600 dark:text-amber-400"
          >
            re-scan failed
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          title="Re-scan the plugins folder registry now — no page reload needed"
          className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-cyan-500/10 hover:text-cyan-700 disabled:opacity-50 dark:hover:text-cyan-300"
        >
          {refreshing ? "checking…" : "refresh"}
        </button>
        <span className="text-xs text-muted-foreground">
          declared in plugins/*/manifest.json — preset tools over builtin
          executors, re-scan without reload
        </span>
      </div>
      <div className="space-y-1.5">
        {data.packs.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-foreground/85">{p.name}</span>
            <span className="rounded-md border border-cyan-500/30 bg-cyan-500/5 px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums text-cyan-600 dark:text-cyan-400">
              v{p.version}
            </span>
            {p.tools.map((t) => {
              const pinned = t.preset ? Object.keys(t.preset) : [];
              const known = t.args ?? [];
              const unknown = t.unknownPresetKeys ?? [];
              return (
                <span
                  key={t.name}
                  title={`${t.description}\n\nDispatches through builtin "${t.base}".\nSchema args: ${known.length ? known.join(", ") : "none"}${pinned.length ? `\nPinned preset: ${pinned.join(", ")}` : ""}${unknown.length ? `\nUnknown preset keys (not in the base schema): ${unknown.join(", ")}` : ""}`}
                  className={
                    unknown.length > 0
                      ? "rounded-md border border-amber-500/40 bg-amber-500/[0.07] px-1.5 py-0.5 text-[10.5px] text-foreground/85"
                      : pinned.length > 0
                        ? "rounded-md border border-cyan-500/35 bg-cyan-500/[0.09] px-1.5 py-0.5 text-[10.5px] text-foreground/80"
                        : "rounded-md border border-cyan-500/20 bg-background/60 px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
                  }
                >
                  {t.name} <span aria-hidden className="text-cyan-500/70">→</span> {t.base}
                  {pinned.length > 0 && (
                    <span className="ml-1 text-cyan-600/80 dark:text-cyan-400/80">·pin</span>
                  )}
                  {unknown.length > 0 && (
                    <span className="ml-1 text-amber-600/90 dark:text-amber-400/90">·drift</span>
                  )}
                </span>
              );
            })}
          </div>
        ))}
        {data.invalid.map((inv) => (
          <div key={inv.dir} className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-md border border-amber-500/30 bg-amber-500/5 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-600 dark:text-amber-400">
              invalid pack
            </span>
            <span className="text-xs text-muted-foreground" title={inv.errors.join("\n")}>
              {inv.dir} — {inv.errors[0]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
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

  // r428: roster search — the conversation list has had one for ages, but the
  // agent roster grew up without any way to narrow it (name/role/description,
  // plus model and tools since those are on the card). Client-side live filter
  // (no Enter/IME path), mirroring the r287 HF filter; the count line below
  // is aria-live per the r417 doctrine — it updates as the user types.
  const [query, setQuery] = React.useState("");
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) =>
      `${a.name} ${a.role} ${a.description} ${a.model} ${a.tools.join(" ")}`
        .toLowerCase()
        .includes(q)
    );
  }, [agents, query]);

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
      // Structural validation only — no `kind` gate, so both NEXUS exports
      // (kind "nexus-agents") and legacy pre-rebrand exports (kind
      // "praison-agents" / praisonai-export.json) import unchanged.
      if (!list) {
        toast.error("Invalid agent file", { description: "Expected an agents array or a NEXUS export." });
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
        {/* r511 Harness Crew — alignment meters + presets, mounted above the grid */}
        <CrewPanel />
        {/* r575 TASK-103 slice 1 — the tools-registry plugin strip: packs from
            the watched plugins folder (manifest.json per dir), visible here
            after reload (renders nothing when no packs exist — honest zero). */}
        <PluginPacksPanel />
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
          <>
            <div className="relative mb-4 max-w-xs">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents…"
                aria-label="Search agents"
                className="h-8 pl-8 text-xs"
              />
            </div>
            {filtered.length === 0 ? (
              <EmptyState
                emoji="🔭"
                title="Nothing matches"
                description={`No agent matches “${query.trim()}” — clear the search to see the full roster.`}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((agent) => (
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
            {query.trim() ? (
              <p className="mt-3 text-[11px] text-muted-foreground" aria-live="polite">
                {filtered.length} of {agents.length} agent{agents.length === 1 ? "" : "s"} matching
                “{query.trim()}”
              </p>
            ) : null}
          </>
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
