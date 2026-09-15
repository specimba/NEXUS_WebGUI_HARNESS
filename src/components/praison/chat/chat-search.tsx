"use client";

import * as React from "react";
import { CornerDownLeft, MessageSquare, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtTime, truncate } from "@/lib/helpers";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ChatSearchProps {
  open: boolean;
  messages: ChatMessage[];
  onClose: () => void;
}

interface SearchHit {
  msgId: string;
  role: "user" | "assistant";
  who: string;
  time: number;
  snippetBefore: string;
  snippetMatch: string;
  snippetAfter: string;
}

function buildHits(messages: ChatMessage[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const m of messages) {
    const idx = m.content.toLowerCase().indexOf(q);
    if (idx === -1) continue;
    const before = m.content.slice(Math.max(0, idx - 42), idx);
    const match = m.content.slice(idx, idx + q.length);
    const after = m.content.slice(idx + q.length, idx + q.length + 62);
    hits.push({
      msgId: m.id,
      role: m.role,
      who: m.role === "user" ? "You" : m.agentName ?? "Assistant",
      time: m.createdAt,
      snippetBefore: (idx > 42 ? "…" : "") + before,
      snippetMatch: match,
      snippetAfter: after + (idx + q.length + 62 < m.content.length ? "…" : ""),
    });
    if (hits.length >= 50) break;
  }
  return hits;
}

function jumpToMessage(msgId: string) {
  const el = document.querySelector<HTMLElement>(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("msg-flash");
  // restart the animation if it was already applied
  void el.offsetWidth;
  el.classList.add("msg-flash");
  window.setTimeout(() => el.classList.remove("msg-flash"), 2200);
}

export function ChatSearch({ open, messages, onClose }: ChatSearchProps) {
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const hits = React.useMemo(() => buildHits(messages, query), [messages, query]);

  if (!open) return null;

  return (
    <div className="absolute inset-x-0 top-0 z-20 border-b bg-background/95 shadow-lg backdrop-blur-md">
      <div className="mx-auto max-w-3xl p-3">
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
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "Enter" && hits.length > 0) {
                e.preventDefault();
                jumpToMessage(hits[0].msgId);
              }
            }}
            placeholder="Find in this conversation…"
            aria-label="Find in conversation"
            className="h-10 rounded-xl border-border/70 bg-card/70 pl-9 pr-24 text-sm"
          />
          <div className="absolute right-2 flex items-center gap-1">
            {query.trim().length >= 2 && (
              <span className="mr-1 text-[11px] tabular-nums text-muted-foreground">
                {hits.length} {hits.length === 1 ? "match" : "matches"}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close search"
              onClick={onClose}
              className="h-7 w-7 rounded-lg"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </div>

        {query.trim().length >= 2 && (
          <div
            role="listbox"
            aria-label="Search results"
            className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1"
          >
            {hits.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-6 text-center text-sm text-muted-foreground">
                <MessageSquare className="h-5 w-5 opacity-50" aria-hidden />
                No messages match “{truncate(query, 32)}”
              </div>
            ) : (
              hits.map((h) => (
                <button
                  key={h.msgId}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => jumpToMessage(h.msgId)}
                  className={cn(
                    "group flex w-full items-start gap-2.5 rounded-xl border border-transparent px-3 py-2 text-left",
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
                        {fmtTime(h.time)}
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
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
