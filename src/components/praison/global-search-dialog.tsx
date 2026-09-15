"use client";

import * as React from "react";
import { CornerDownLeft, MessageSquare, MessagesSquare, Search, SearchX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fmtRel, truncate } from "@/lib/helpers";
import { useAgentsStore, useConversationsStore, useUiStore } from "@/lib/stores";
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
    if (hits.filter((h) => h.convId === conv.id).length > 0 && hits.length >= MAX_CONVS) break;
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

export function GlobalSearchDialog() {
  const open = useUiStore((s) => s.globalSearchOpen);
  const setOpen = useUiStore((s) => s.setGlobalSearchOpen);
  const requestFocusMessage = useUiStore((s) => s.requestFocusMessage);
  const conversations = useConversationsStore((s) => s.conversations);
  const agents = useAgentsStore((s) => s.agents);

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

  const grouped = React.useMemo(() => {
    const map = new Map<string, GlobalHit[]>();
    for (const h of hits) {
      const list = map.get(h.convId) ?? [];
      list.push(h);
      map.set(h.convId, list);
    }
    return [...map.entries()];
  }, [hits]);

  const totalHits = hits.length;

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
            Search all chats
          </DialogTitle>
          <DialogDescription>
            Find messages across every conversation, then jump straight to them
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
                if (e.key === "Enter" && hits.length > 0) {
                  e.preventDefault();
                  jump(hits[0]);
                }
              }}
              placeholder="Search message text in every chat…"
              aria-label="Search all chats"
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
              Type at least 2 characters — searches titles and every message body.
            </div>
          ) : totalHits === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <SearchX className="h-6 w-6 opacity-40" aria-hidden />
              No messages match “{truncate(query, 32)}” in any chat.
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
                  {convHits.map((h) => (
                    <button
                      key={h.msgId}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => jump(h)}
                      className={cn(
                        "group flex w-full items-start gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left",
                        "transition-colors hover:border-violet-500/30 hover:bg-violet-500/5"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
