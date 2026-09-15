"use client";

import * as React from "react";
import {
  Bot,
  Cog,
  MessagesSquare,
  Moon,
  MessageSquarePlus,
  Play,
  Search,
  Sun,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { AgentAvatar } from "@/components/praison/atoms";
import { titleFrom, truncate } from "@/lib/helpers";
import {
  useAgentsStore,
  useConversationsStore,
  useUiStore,
  useWorkflowsStore,
} from "@/lib/stores";
import type { View } from "@/lib/types";

const NAV: { view: View; label: string; icon: React.ElementType; shortcut: string }[] = [
  { view: "chat", label: "Chat", icon: MessagesSquare, shortcut: "⌘1" },
  { view: "agents", label: "Agents", icon: Bot, shortcut: "⌘2" },
  { view: "workflows", label: "Workflows", icon: WorkflowIcon, shortcut: "⌘3" },
  { view: "settings", label: "Settings", icon: Cog, shortcut: "⌘4" },
];

const RECENT_CONVERSATIONS = 6;

/**
 * Global ⌘K command palette: navigation, quick actions, agents,
 * recent conversations and one-click workflow runs.
 */
export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setView = useUiStore((s) => s.setView);
  const setActiveAgentId = useUiStore((s) => s.setActiveAgentId);
  const requestRunWorkflow = useUiStore((s) => s.requestRunWorkflow);

  const agents = useAgentsStore((s) => s.agents);
  const conversations = useConversationsStore((s) => s.conversations);
  const workflows = useWorkflowsStore((s) => s.workflows);
  const { resolvedTheme, setTheme } = useTheme();

  // Global ⌘K / Ctrl+K listener
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUiStore.getState().setPaletteOpen(!useUiStore.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = React.useCallback(
    (fn: () => void) => {
      setOpen(false);
      // Defer so the dialog closes before the action navigates
      setTimeout(fn, 10);
    },
    [setOpen]
  );

  const newChat = React.useCallback(() => {
    run(() => {
      const ui = useUiStore.getState();
      // create() sets activeId — the user lands directly in the fresh chat
      useConversationsStore.getState().create(ui.activeAgentId ?? undefined);
      ui.setView("chat");
    });
  }, [run]);

  const chatWithAgent = React.useCallback(
    (agentId: string) => {
      run(() => {
        setActiveAgentId(agentId);
        // create() sets activeId — the user lands directly in the fresh chat
        useConversationsStore.getState().create(agentId);
        setView("chat");
      });
    },
    [run, setActiveAgentId, setView]
  );

  const openConversation = React.useCallback(
    (convId: string) => {
      run(() => {
        useConversationsStore.getState().setActive(convId);
        const conv = useConversationsStore
          .getState()
          .conversations.find((c) => c.id === convId);
        if (conv?.agentId) setActiveAgentId(conv.agentId);
        setView("chat");
      });
    },
    [run, setActiveAgentId, setView]
  );

  const recentConversations = React.useMemo(
    () =>
      [...conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, RECENT_CONVERSATIONS),
    [conversations]
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search commands, agents, chats and workflows"
      className="sm:max-w-xl [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Quick actions">
          <CommandItem onSelect={newChat}>
            <MessageSquarePlus className="text-violet-400" />
            New chat
            <CommandShortcut>⌘⇧N</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => useUiStore.getState().setGlobalSearchOpen(true))
            }
          >
            <Search className="text-violet-400" />
            Search all chats…
            <CommandShortcut>⌘⇧F</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
            }
          >
            {resolvedTheme === "dark" ? (
              <Sun className="text-amber-400" />
            ) : (
              <Moon className="text-violet-400" />
            )}
            Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          {NAV.map(({ view, label, icon: Icon, shortcut }) => (
            <CommandItem key={view} onSelect={() => run(() => setView(view))}>
              <Icon />
              {label}
              <CommandShortcut>{shortcut}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        {agents.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Chat with an agent">
              {agents.map((a) => (
                <CommandItem key={a.id} value={`agent ${a.name} ${a.role}`} onSelect={() => chatWithAgent(a.id)}>
                  <AgentAvatar agent={a} size="xs" />
                  <span className="truncate font-medium">{a.name}</span>
                  {a.role ? (
                    <span className="truncate text-xs text-muted-foreground">
                      · {a.role}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {recentConversations.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent chats">
              {recentConversations.map((c) => (
                <CommandItem key={c.id} value={`chat ${c.title}`} onSelect={() => openConversation(c.id)}>
                  <Search className="opacity-60" />
                  <span className="truncate">{truncate(c.title, 36)}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                    {c.messages.length} msg
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {workflows.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Run a workflow">
              {workflows.map((w) => (
                <CommandItem
                  key={w.id}
                  value={`workflow ${w.name} ${w.description}`}
                  onSelect={() => run(() => requestRunWorkflow(w.id))}
                >
                  <Play className="text-emerald-400" />
                  <span className="truncate font-medium">{w.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    · {w.steps.length} step{w.steps.length === 1 ? "" : "s"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
