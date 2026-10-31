"use client";

import * as React from "react";
import { Bot, CornerDownLeft, MessageSquare, MessagesSquare, Search, SearchX, Workflow } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AgentAvatar } from "@/components/nexus/atoms";
import { fmtRel, truncate } from "@/lib/helpers";
import { useAgentsStore, useConversationsStore, useUiStore, useWorkflowsStore } from "@/lib/stores";
import { cn } from "@/lib/utils";

// ─── Global search: find messages across ALL conversations ─────────────────

interface GlobalHit {
  convId: string;
  convTitle: string;
  agentEmoji: string;
  msgId: string;
  role: "user" | "assistant";
  who: string;
  createdAt: number;
  snippetBefore: string;
  snippetMatch: string;
  snippetAfter: string;
}

const MAX_CONVS = 6;
const MAX_HITS_PER_CONV = 3;

function snippet(content: string, idx: number, qLen: number) {
  return {
    snippetBefore: (idx > 42 ? "…" : "") + content.slice(Math.max(0, idx - 42), idx),
    snippetMatch: content.slice(idx, idx + qLen),
    snippetAfter:
      content.slice(idx + qLen, idx + qLen + 62) +
      (idx + qLen + 62 < content.length ? "…" : ""),
  };
}

function buildGlobalHits(
  conversations: ReturnType<typeof useConversationsStore.getState>["conversations"],
  agentNameOf: (id?: string) => { name: string; emoji: string },
  query: string
): GlobalHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: GlobalHit[] = [];
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const conv of sorted) {
    if (hits.length >= MAX_CONVS * MAX_HITS_PER_CONV && hits.some((h) => h.convId === conv.id)) {
      continue;
    }
    let convHits = 0;
    const agent = agentNameOf(conv.agentId);
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (!m.content) continue;
      const idx = m.content.toLowerCase().indexOf(q);
      if (idx === -1) continue;
      hits.push({
        convId: conv.id,
        convTitle: conv.title,
        agentEmoji: agent.emoji,
        msgId: m.id,
        role: m.role,
        who: m.role === "user" ? "You" : m.agentName ?? agent.name,
        createdAt: m.createdAt,
        ...snippet(m.content, idx, q.length),
      });
      convHits += 1;
      if (convHits >= MAX_HITS_PER_CONV) break;
    }
    // r258: the old early break read `hits.length >= MAX_CONVS` — a
    // hits-vs-conversations category error that always stopped the scan
    // at 6 hits = 2 groups, silently hiding matches in chats 3-6 that the
    // MAX_CONVS design (and the group filter below) promise. Cap distinct
    // conversation groups instead (6 groups × 3 hits = 18).
    if (
      hits.some((h) => h.convId === conv.id) &&
      new Set(hits.map((x) => x.convId)).size >= MAX_CONVS
    ) {
      break;
    }
  }
  // group order follows conversation order; keep at most MAX_CONVS groups
  const seen = new Set<string>();
  return hits.filter((h) => {
    if (seen.has(h.convId)) return true;
    if (seen.size >= MAX_CONVS) return false;
    seen.add(h.convId);
    return true;
  });
}

// ─── Chat-title hits (r410): the hint copy has promised "searches titles"
// since the dialog shipped, but buildGlobalHits only scanned message BODIES —
// a conversation whose title matched yet whose bodies didn't was silently
// unfindable (⌘K's Recent-chats group DOES match titles, so the two search
// surfaces disagreed). Title matches render as their own "Chats" group and
// exclude conversations already surfaced by body hits — no double rows for
// one chat. Clicking opens the conversation (palette's openConversation
// convention minus requestFocusMessage — a title match has no message to
// focus).

interface ChatHit {
  convId: string;
  titleBefore: string;
  titleMatch: string;
  titleAfter: string;
  agentEmoji: string;
  msgCount: number;
  updatedAt: number;
}

const MAX_CHAT_HITS = 5;

function buildChatHits(
  conversations: ReturnType<typeof useConversationsStore.getState>["conversations"],
  agentNameOf: (id?: string) => { name: string; emoji: string },
  excludeConvIds: Set<string>,
  query: string
): ChatHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: ChatHit[] = [];
  for (const conv of [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (excludeConvIds.has(conv.id)) continue;
    const tIdx = (conv.title ?? "").toLowerCase().indexOf(q);
    if (tIdx === -1) continue;
    hits.push({
      convId: conv.id,
      // tIdx is never -1 here, so the r408 guard holds trivially — slices
      // are always meaningful.
      titleBefore: tIdx > 24 ? "…" + conv.title.slice(Math.max(0, tIdx - 24), tIdx) : conv.title.slice(0, tIdx),
      titleMatch: conv.title.slice(tIdx, tIdx + q.length),
      titleAfter: conv.title.slice(tIdx + q.length, tIdx + q.length + 28) + (tIdx + q.length + 28 < conv.title.length ? "…" : ""),
      agentEmoji: agentNameOf(conv.agentId).emoji,
      msgCount: conv.messages.length,
      updatedAt: conv.updatedAt,
    });
    if (hits.length >= MAX_CHAT_HITS) break;
  }
  return hits;
}

// ─── Workflow hits (r408): ⌘K's run-a-workflow group proved the palette can
// reach workflows — the ⌘⇧F surface silently couldn't, so a pipeline the user
// half-remembers was findable only by scrolling the board. Matched by name,
// description, or step label; clicking lands on the Workflows view (no
// selection state exists — r406 refuted adding one on scope).

interface WorkflowHit {
  id: string;
  nameBefore: string;
  nameMatch: string;
  nameAfter: string;
  description: string;
  matchedIn: "name" | "description" | "steps";
  stepCount: number;
}

const MAX_WF_HITS = 5;

function buildWorkflowHits(
  workflows: ReturnType<typeof useWorkflowsStore.getState>["workflows"],
  query: string
): WorkflowHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: WorkflowHit[] = [];
  for (const wf of [...workflows].sort((a, b) => b.updatedAt - a.updatedAt)) {
    // r823 QA-found crash: description/label/title are TYPED optional but were
    // read unguarded — an agent (or workflow) saved without a description made
    // EVERY query throw "Cannot read properties of undefined (reading
    // 'toLowerCase')" inside this dialog, and the error boundary unmounted it
    // (the console tail caught it; the v1-v5 witness "dialog self-close" was
    // this crash all along). Guard every optional string at the scan.
    const nameIdx = (wf.name ?? "").toLowerCase().indexOf(q);
    const matchedIn = nameIdx !== -1
      ? "name"
      : (wf.description ?? "").toLowerCase().includes(q)
        ? "description"
        : wf.steps.some((st) => (st.label ?? "").toLowerCase().includes(q))
          ? "steps"
          : null;
    if (!matchedIn) continue;
    hits.push({
      id: wf.id,
      // name slices are only meaningful for a name match — for
      // description/step matches the full name renders unmarked (and
      // slice(0, -1) on nameIdx=-1 would amputate the last character).
      nameBefore: nameIdx > 24 ? "…" + wf.name.slice(Math.max(0, nameIdx - 24), nameIdx) : nameIdx !== -1 ? wf.name.slice(0, nameIdx) : wf.name,
      nameMatch: nameIdx !== -1 ? wf.name.slice(nameIdx, nameIdx + q.length) : "",
      nameAfter: nameIdx !== -1
        ? wf.name.slice(nameIdx + q.length, nameIdx + q.length + 28) + (nameIdx + q.length + 28 < wf.name.length ? "…" : "")
        : "",
      description: wf.description,
      matchedIn,
      stepCount: wf.steps.length,
    });
    if (hits.length >= MAX_WF_HITS) break;
  }
  return hits;
}

// ─── Agent hits (r409): the roster was invisible to ⌘⇧F — agents surfaced
// only as message attribution, so a half-remembered specialist was findable
// only by scrolling the grid. Matched by name, role, or description;
// clicking starts a new chat with it, exactly the ⌘K palette's
// chatWithAgent convention (the roster has no selection state — its card
// click opens the test playground via local state, unreachable from here
// without new ui-store plumbing; refuted on scope).

interface AgentHit {
  id: string;
  nameBefore: string;
  nameMatch: string;
  nameAfter: string;
  role: string;
  description: string;
  matchedIn: "name" | "role" | "description";
}

const MAX_AGENT_HITS = 5;

function buildAgentHits(
  agents: ReturnType<typeof useAgentsStore.getState>["agents"],
  query: string
): AgentHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: AgentHit[] = [];
  for (const a of [...agents].sort((x, y) => y.updatedAt - x.updatedAt)) {
    const nameIdx = (a.name ?? "").toLowerCase().indexOf(q);
    const matchedIn = nameIdx !== -1
      ? "name"
      : (a.role ?? "").toLowerCase().includes(q)
        ? "role"
        : (a.description ?? "").toLowerCase().includes(q)
          ? "description"
          : null;
    if (!matchedIn) continue;
    hits.push({
      id: a.id,
      // name slices are only meaningful for a name match — for role/
      // description matches the full name renders unmarked (and slice(0, -1)
      // on nameIdx=-1 would amputate the last character — the r408 guard).
      nameBefore: nameIdx > 24 ? "…" + a.name.slice(Math.max(0, nameIdx - 24), nameIdx) : nameIdx !== -1 ? a.name.slice(0, nameIdx) : a.name,
      nameMatch: nameIdx !== -1 ? a.name.slice(nameIdx, nameIdx + q.length) : "",
      nameAfter: nameIdx !== -1
        ? a.name.slice(nameIdx + q.length, nameIdx + q.length + 28) + (nameIdx + q.length + 28 < a.name.length ? "…" : "")
        : "",
      role: a.role,
      description: a.description,
      matchedIn,
    });
    if (hits.length >= MAX_AGENT_HITS) break;
  }
  return hits;
}

export function GlobalSearchDialog() {
  const open = useUiStore((s) => s.globalSearchOpen);
  const setOpen = useUiStore((s) => s.setGlobalSearchOpen);
  const requestFocusMessage = useUiStore((s) => s.requestFocusMessage);
  const conversations = useConversationsStore((s) => s.conversations);
  const agents = useAgentsStore((s) => s.agents);
  const workflows = useWorkflowsStore((s) => s.workflows);

  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const agentInfo = React.useMemo(() => {
    const m = new Map<string, { name: string; emoji: string }>();
    for (const a of agents) m.set(a.id, { name: a.name, emoji: a.emoji });
    return (id?: string) =>
      (id && m.get(id)) || { name: "Assistant", emoji: "🤖" };
  }, [agents]);

  const hits = React.useMemo(
    () => buildGlobalHits(conversations, agentInfo, query),
    [conversations, agentInfo, query]
  );

  const wfHits = React.useMemo(
    () => buildWorkflowHits(workflows, query),
    [workflows, query]
  );

  const agentHits = React.useMemo(
    () => buildAgentHits(agents, query),
    [agents, query]
  );

  const chatHits = React.useMemo(() => {
    // Conversations with body hits are already reachable — exclude them so
    // one chat never renders twice.
    const excluded = new Set(hits.map((h) => h.convId));
    return buildChatHits(conversations, agentInfo, excluded, query);
  }, [conversations, agentInfo, hits, query]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, GlobalHit[]>();
    for (const h of hits) {
      const list = map.get(h.convId) ?? [];
      list.push(h);
      map.set(h.convId, list);
    }
    return [...map.entries()];
  }, [hits]);

  const totalHits = hits.length + chatHits.length + agentHits.length + wfHits.length;

  const jumpToWorkflow = React.useCallback(
    (_hit: WorkflowHit) => {
      setOpen(false);
      // Same close-before-navigate beat as jump(): the dialog unmounts
      // cleanly before the view switch repaints the board.
      setTimeout(() => {
        useUiStore.getState().setView("workflows");
      }, 30);
    },
    [setOpen]
  );

  const jumpToAgent = React.useCallback(
    (hit: AgentHit) => {
      setOpen(false);
      // Same close-before-navigate beat as jump()/jumpToWorkflow(); the
      // palette's chatWithAgent convention — a search hit for an agent
      // lands in a fresh chat with it.
      setTimeout(() => {
        useUiStore.getState().setActiveAgentId(hit.id);
        useConversationsStore.getState().create(hit.id);
        useUiStore.getState().setView("chat");
      }, 30);
    },
    [setOpen]
  );

  const jumpToConversation = React.useCallback(
    (hit: ChatHit) => {
      setOpen(false);
      // Palette's openConversation convention minus requestFocusMessage —
      // a title match has no specific message to focus.
      setTimeout(() => {
        useConversationsStore.getState().setActive(hit.convId);
        const conv = useConversationsStore
          .getState()
          .conversations.find((c) => c.id === hit.convId);
        if (conv?.agentId) useUiStore.getState().setActiveAgentId(conv.agentId);
        useUiStore.getState().setView("chat");
      }, 30);
    },
    [setOpen]
  );

  const jump = React.useCallback(
    (hit: GlobalHit) => {
      setOpen(false);
      // Let the dialog close before navigating + scrolling
      setTimeout(() => {
        useConversationsStore.getState().setActive(hit.convId);
        const conv = useConversationsStore
          .getState()
          .conversations.find((c) => c.id === hit.convId);
        if (conv?.agentId) useUiStore.getState().setActiveAgentId(conv.agentId);
        requestFocusMessage(hit.convId, hit.msgId);
      }, 30);
    },
    [setOpen, requestFocusMessage]
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <MessagesSquare className="h-4 w-4 text-violet-400" aria-hidden />
            Search chats, agents &amp; workflows
          </DialogTitle>
          <DialogDescription>
            Find messages across every conversation — plus agents by name,
            role or description and workflows by name, description or step —
            and jump straight to them
          </DialogDescription>
        </DialogHeader>

        <div className="border-b p-4 pb-3">
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // r245 IME parity: Enter that only confirms a CJK composition
                // must not jump to the first hit.
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (hits.length > 0) jump(hits[0]);
                  else if (chatHits.length > 0) jumpToConversation(chatHits[0]);
                  else if (agentHits.length > 0) jumpToAgent(agentHits[0]);
                  else if (wfHits.length > 0) jumpToWorkflow(wfHits[0]);
                }
              }}
              placeholder="Search chats, agents and workflows…"
              aria-label="Search chats, agents and workflows"
              className="h-10 rounded-xl border-border/70 bg-card/70 pl-9 pr-16 text-sm"
            />
            <span className="absolute right-3 text-[11px] tabular-nums text-muted-foreground">
              {query.trim().length >= 2 ? `${totalHits} hit${totalHits === 1 ? "" : "s"}` : ""}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 pt-2" role="listbox" aria-label="Global search results">
          {query.trim().length < 2 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <Search className="h-6 w-6 opacity-40" aria-hidden />
              Type at least 2 characters — searches chat titles, every message
              body, agent names, roles and descriptions, and workflow names,
              descriptions and steps.
            </div>
          ) : totalHits === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <SearchX className="h-6 w-6 opacity-40" aria-hidden />
              No chats, agents or workflows match “{truncate(query, 32)}”.
            </div>
          ) : (
            grouped.map(([convId, convHits]) => (
              <div key={convId} className="mb-3 last:mb-1">
                <p className="flex items-center gap-1.5 px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <MessageSquare className="h-3 w-3" aria-hidden />
                  <span className="max-w-[16rem] truncate">{convHits[0].convTitle}</span>
                  <span className="font-normal normal-case tracking-normal">
                    · {convHits[0].agentEmoji} {convHits.length} match{convHits.length === 1 ? "" : "es"}
                  </span>
                </p>
                <div className="space-y-1">
                  {/* r823: the message-hit rows' own content said WHO spoke and
                      the snippet — the conversation they belong to lived ONLY in
                      the group header above (visual context), so navigating the
                      listbox by option heard "WitnessWorker — 2h ago — snippet"
                      with no idea which chat a jump would open. Each row now
                      carries its conversation in the utterance (the arc's
                      interactive-row rule: the button names, the group frames). */}
                  {convHits.map((h) => (
                    <button
                      key={h.msgId}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => jump(h)}
                      aria-label={`${h.convTitle} — ${h.who}, ${fmtRel(h.createdAt)}: ${h.snippetBefore}${h.snippetMatch}${h.snippetAfter}`}
                      className={cn(
                        "group flex w-full items-start gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left",
                        "transition-colors hover:border-violet-500/30 hover:bg-violet-500/5 focus-visible:border-violet-500/50 focus-visible:bg-violet-500/5"
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px]",
                          h.role === "user"
                            ? "bg-gradient-to-br from-primary to-violet-600 text-primary-foreground"
                            : "border bg-muted"
                        )}
                      >
                        {h.role === "user" ? "🧑" : "🤖"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-xs font-semibold">{h.who}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {fmtRel(h.createdAt)}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs leading-relaxed text-muted-foreground">
                          {h.snippetBefore}
                          <mark className="rounded bg-violet-500/25 px-0.5 font-medium text-foreground">
                            {h.snippetMatch}
                          </mark>
                          {h.snippetAfter}
                        </span>
                      </span>
                      <CornerDownLeft
                        className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          {chatHits.length > 0 ? (
            <div className="mb-3">
              <p className="flex items-center gap-1.5 px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <MessagesSquare className="h-3 w-3" aria-hidden />
                Chats by title
                <span className="font-normal normal-case tracking-normal">
                  · {chatHits.length} match{chatHits.length === 1 ? "" : "es"}
                </span>
              </p>
              <div className="space-y-1">
                {chatHits.map((h) => (
                  <button
                    key={h.convId}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => jumpToConversation(h)}
                    className={cn(
                      "group flex w-full items-start gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left",
                      "transition-colors hover:border-violet-500/30 hover:bg-violet-500/5 focus-visible:border-violet-500/50 focus-visible:bg-violet-500/5"
                    )}
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-muted"
                    >
                      {h.agentEmoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold">
                          {h.titleBefore}
                          <mark className="rounded bg-violet-500/25 px-0.5 font-medium text-foreground">
                            {h.titleMatch}
                          </mark>
                          {h.titleAfter}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {h.msgCount} msg{h.msgCount === 1 ? "" : "s"} · updated {fmtRel(h.updatedAt)}
                        </span>
                      </span>
                    </span>
                    <CornerDownLeft
                      className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {agentHits.length > 0 ? (
            <div className="mb-3">
              <p className="flex items-center gap-1.5 px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Bot className="h-3 w-3" aria-hidden />
                Agents
                <span className="font-normal normal-case tracking-normal">
                  · {agentHits.length} match{agentHits.length === 1 ? "" : "es"}
                </span>
              </p>
              <div className="space-y-1">
                {agentHits.map((h) => {
                  const agent = agents.find((a) => a.id === h.id);
                  return (
                    <button
                      key={h.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => jumpToAgent(h)}
                      className={cn(
                        "group flex w-full items-start gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left",
                        "transition-colors hover:border-violet-500/30 hover:bg-violet-500/5 focus-visible:border-violet-500/50 focus-visible:bg-violet-500/5"
                      )}
                    >
                      {agent ? (
                        <AgentAvatar agent={agent} size="xs" className="mt-0.5 shrink-0" />
                      ) : (
                        <span
                          aria-hidden
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-muted"
                        >
                          <Bot className="h-3 w-3" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-xs font-semibold">
                            {h.nameMatch ? (
                              <>
                                {h.nameBefore}
                                <mark className="rounded bg-violet-500/25 px-0.5 font-medium text-foreground">
                                  {h.nameMatch}
                                </mark>
                                {h.nameAfter}
                              </>
                            ) : (
                              h.nameBefore
                            )}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {h.role ? truncate(h.role, 40) : "no role"} · matched in {h.matchedIn}
                          </span>
                        </span>
                        {h.description ? (
                          <span className="mt-0.5 block truncate text-xs leading-relaxed text-muted-foreground">
                            {h.description}
                          </span>
                        ) : null}
                      </span>
                      <CornerDownLeft
                        className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {wfHits.length > 0 ? (
            <div className="mb-1">
              <p className="flex items-center gap-1.5 px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Workflow className="h-3 w-3" aria-hidden />
                Workflows
                <span className="font-normal normal-case tracking-normal">
                  · {wfHits.length} match{wfHits.length === 1 ? "" : "es"}
                </span>
              </p>
              <div className="space-y-1">
                {wfHits.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => jumpToWorkflow(w)}
                    className={cn(
                      "group flex w-full items-start gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left",
                      "transition-colors hover:border-violet-500/30 hover:bg-violet-500/5 focus-visible:border-violet-500/50 focus-visible:bg-violet-500/5"
                    )}
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border bg-muted"
                    >
                      <Workflow className="h-3 w-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold">
                          {w.nameMatch ? (
                            <>
                              {w.nameBefore}
                              <mark className="rounded bg-violet-500/25 px-0.5 font-medium text-foreground">
                                {w.nameMatch}
                              </mark>
                              {w.nameAfter}
                            </>
                          ) : (
                            w.nameBefore
                          )}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {w.stepCount} step{w.stepCount === 1 ? "" : "s"} · matched in {w.matchedIn}
                        </span>
                      </span>
                      {w.description ? (
                        <span className="mt-0.5 block truncate text-xs leading-relaxed text-muted-foreground">
                          {w.description}
                        </span>
                      ) : null}
                    </span>
                    <CornerDownLeft
                      className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
