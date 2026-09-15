"use client";

import * as React from "react";
import {
  Download,
  MessageSquarePlus,
  MoreVertical,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  SearchX,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { conversationToMarkdown, downloadText, fmtRel, slugify } from "@/lib/helpers";
import { useAgentsStore, useConversationsStore, useUiStore } from "@/lib/stores";
import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─── Date bucketing ──────────────────────────────────────────────────────────
const DAY = 86_400_000;

function dateBucket(ts: number, startOfToday: number): string {
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - DAY) return "Yesterday";
  if (ts >= startOfToday - 7 * DAY) return "Previous 7 days";
  if (ts >= startOfToday - 30 * DAY) return "Previous 30 days";
  return "Older";
}

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

export interface ConversationListProps {
  /** Called after the user picks a conversation or creates one (close the mobile overlay). */
  onNavigate?: () => void;
  className?: string;
}

export function ConversationList({ onNavigate, className }: ConversationListProps) {
  const conversations = useConversationsStore((s) => s.conversations);
  const activeId = useConversationsStore((s) => s.activeId);
  const setActive = useConversationsStore((s) => s.setActive);
  const create = useConversationsStore((s) => s.create);
  const rename = useConversationsStore((s) => s.rename);
  const togglePin = useConversationsStore((s) => s.togglePin);
  const remove = useConversationsStore((s) => s.remove);
  const chatListOpen = useUiStore((s) => s.chatListOpen);
  const toggleChatList = useUiStore((s) => s.toggleChatList);
  const activeAgentId = useUiStore((s) => s.activeAgentId);
  const agents = useAgentsStore((s) => s.agents);

  const [query, setQuery] = React.useState("");
  const [renameTarget, setRenameTarget] = React.useState<Conversation | null>(null);
  const [renameText, setRenameText] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<Conversation | null>(null);

  const agentMap = React.useMemo(() => {
    const m = new Map<string, { emoji: string; color: string; name: string }>();
    for (const a of agents) m.set(a.id, { emoji: a.emoji, color: a.color, name: a.name });
    return m;
  }, [agents]);

  const sorted = React.useMemo(
    () => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations]
  );

  // ─── Search filter (title + message bodies) ────────────────────────────────
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  }, [sorted, query]);

  // ─── Pinned group + date buckets for the rest ───────────────────────────────
  const groups = React.useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const pinnedList: Conversation[] = [];
    const rest: Conversation[] = [];
    for (const c of filtered) (c.pinned ? pinnedList : rest).push(c);
    const map = new Map<string, Conversation[]>();
    for (const c of rest) {
      const bucket = dateBucket(c.updatedAt, startOfToday);
      const list = map.get(bucket);
      if (list) list.push(c);
      else map.set(bucket, [c]);
    }
    const out: { label: string; items: Conversation[]; pinned?: boolean }[] = [];
    if (pinnedList.length > 0) out.push({ label: "Pinned", items: pinnedList, pinned: true });
    for (const g of GROUP_ORDER) {
      if (map.has(g)) out.push({ label: g, items: map.get(g)! });
    }
    return out;
  }, [filtered]);

  const searching = query.trim().length > 0;

  const openRename = (c: Conversation) => {
    setRenameTarget(c);
    setRenameText(c.title);
  };

  const submitRename = () => {
    if (!renameTarget) return;
    const title = renameText.trim();
    if (title && title !== renameTarget.title) {
      rename(renameTarget.id, title);
      toast.success("Chat renamed");
    }
    setRenameTarget(null);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    remove(deleteTarget.id);
    setDeleteTarget(null);
    toast.success("Chat deleted");
  };

  const exportMarkdown = (c: Conversation) => {
    downloadText(`praison-chat-${slugify(c.title)}.md`, conversationToMarkdown(c), "text/markdown");
    toast.success("Chat exported as Markdown", { description: `${c.messages.length} messages saved to your device.` });
  };

  const handleNewChat = () => {
    create(activeAgentId ?? undefined);
    onNavigate?.();
  };

  /** Open dialogs after the menu has fully closed — avoids the Radix
   * menu-close/focus-restore race that would instantly dismiss the dialog. */
  const defer = (fn: () => void) => {
    if (typeof window === "undefined") fn();
    else window.setTimeout(fn, 0);
  };

  return (
    <>
      {/* Mobile backdrop (click to close) */}
      {chatListOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px] md:hidden"
          onClick={toggleChatList}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Conversations"
        className={cn(
          "absolute inset-y-0 left-0 z-40 flex w-72 flex-col border-r bg-background shadow-2xl transition-all duration-200 ease-in-out",
          "md:relative md:inset-auto md:z-auto md:translate-x-0 md:shadow-none",
          chatListOpen
            ? "translate-x-0 md:w-72"
            : "-translate-x-full md:w-0 md:overflow-hidden md:border-r-0",
          className
        )}
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
          <h2 className="text-sm font-semibold">Chats</h2>
          <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px] font-semibold">
            {sorted.length}
          </Badge>
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              aria-label="New chat"
              className="h-8 w-8"
              onClick={handleNewChat}
            >
              <Plus className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Hide chat list"
              className="h-8 w-8"
              onClick={toggleChatList}
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>

        {/* Search */}
        {sorted.length > 0 && (
          <div className="shrink-0 border-b px-3 py-2">
            <div className="group relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-violet-400"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats…"
                aria-label="Search conversations"
                className="h-8 rounded-lg border-transparent bg-muted/60 pl-8 pr-7 text-xs shadow-none transition-colors focus-visible:border-violet-500/40 focus-visible:bg-background"
              />
              {searching && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>
          </div>
        )}

        {/* List */}
        {sorted.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted shadow-inner">
              <MessageSquarePlus className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm font-medium">No conversations yet</p>
            <p className="text-xs text-muted-foreground">Start a new chat to talk with your agents.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted shadow-inner">
              <SearchX className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm font-medium">No matches</p>
            <p className="text-xs text-muted-foreground">
              Nothing found for &ldquo;{query.trim()}&rdquo;.
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {groups.map((group) => (
              <section key={group.label} className="mb-1">
                <h3
                  className={cn(
                    "sticky top-0 z-10 bg-background/95 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] backdrop-blur-sm",
                    group.pinned ? "text-violet-400" : "text-muted-foreground"
                  )}
                >
                  {group.pinned && <Pin className="mr-1 inline h-2.5 w-2.5" aria-hidden />}
                  {group.label}
                  {searching && (
                    <span className="ml-1.5 font-normal normal-case tracking-normal">
                      {group.items.length}
                    </span>
                  )}
                </h3>
                <div className="space-y-1">
                  {group.items.map((c) => {
                    const active = c.id === activeId;
                    const convAgent = c.agentId ? agentMap.get(c.agentId) : undefined;
                    return (
                      <div
                        key={c.id}
                        className={cn(
                          "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
                          active ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent/60"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActive(c.id);
                            onNavigate?.();
                          }}
                          aria-current={active ? "true" : undefined}
                          className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <div className="flex items-center gap-1.5">
                            {convAgent && (
                              <span
                                aria-hidden
                                title={`with ${convAgent.name}`}
                                className="shrink-0 text-[11px] leading-none opacity-80"
                              >
                                {convAgent.emoji}
                              </span>
                            )}
                            <span className="truncate text-sm font-medium">{c.title}</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {c.pinned && (
                              <Pin
                                className="h-2.5 w-2.5 text-violet-400/90"
                                aria-label="Pinned"
                              />
                            )}
                            <span>{fmtRel(c.updatedAt)}</span>
                            <span aria-hidden>·</span>
                            <span className="tabular-nums">
                              {c.messages.length} {c.messages.length === 1 ? "msg" : "msgs"}
                            </span>
                          </div>
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Options for ${c.title}`}
                              className="h-7 w-7 shrink-0 text-muted-foreground opacity-60 hover:opacity-100"
                            >
                              <MoreVertical className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onSelect={() => {
                                togglePin(c.id);
                                toast.success(c.pinned ? "Chat unpinned" : "Chat pinned to top", {
                                  icon: c.pinned ? "📌" : "📍",
                                });
                              }}
                            >
                              {c.pinned ? (
                                <PinOff className="h-3.5 w-3.5" aria-hidden />
                              ) : (
                                <Pin className="h-3.5 w-3.5" aria-hidden />
                              )}
                              {c.pinned ? "Unpin" : "Pin to top"}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                defer(() => exportMarkdown(c));
                              }}
                            >
                              <Download className="h-3.5 w-3.5" aria-hidden />
                              Export as Markdown
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                defer(() => openRename(c));
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                defer(() => setDeleteTarget(c));
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Rename dialog */}
        <Dialog
          open={!!renameTarget}
          onOpenChange={(o) => {
            if (!o) setRenameTarget(null);
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Rename chat</DialogTitle>
              <DialogDescription>Give this conversation a memorable name.</DialogDescription>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitRename();
              }}
            >
              <Input
                autoFocus
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                aria-label="Chat title"
                placeholder="Chat title"
                maxLength={80}
              />
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!renameText.trim()}>
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
              <AlertDialogDescription>
                “{deleteTarget?.title}” and its {deleteTarget?.messages.length ?? 0} message
                {(deleteTarget?.messages.length ?? 0) === 1 ? "" : "s"} will be permanently removed.
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
                onClick={confirmDelete}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </aside>
    </>
  );
}
