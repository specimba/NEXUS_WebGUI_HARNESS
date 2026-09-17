"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type {
  Agent,
  ChatMessage,
  Conversation,
  ConversationHeartbeat,
  ConversationMemory,
  Settings,
  ToolCallInfo,
  View,
  Workflow,
  WorkflowRun,
  WorkflowRunStep,
} from "./types";
import { DEFAULT_SETTINGS, PRESEED_PROVIDER_KEYS, SEED_AGENTS } from "./constants";
import { uid } from "./helpers";

// ─── Debounced localStorage (avoid writing on every streamed token) ─────────
function debouncedStorage(delay = 500): StateStorage {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, string>();
  const flush = (name: string) => {
    const v = pending.get(name);
    if (v == null) return;
    pending.delete(name);
    try {
      localStorage.setItem(name, v);
    } catch {
      /* quota — ignore */
    }
  };
  const flushAll = () => {
    for (const name of [...timers.keys()]) {
      const t = timers.get(name);
      if (t) clearTimeout(t);
      timers.delete(name);
      flush(name);
    }
  };
  if (typeof window !== "undefined") {
    // Durability: write pending debounced updates before the page goes away
    window.addEventListener("pagehide", flushAll);
    window.addEventListener("beforeunload", flushAll);
  }
  return {
    getItem: (name) => {
      try {
        return localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending.set(name, value);
      const t = timers.get(name);
      if (t) clearTimeout(t);
      timers.set(
        name,
        setTimeout(() => {
          timers.delete(name);
          flush(name);
        }, delay)
      );
    },
    removeItem: (name) => {
      pending.delete(name);
      const t = timers.get(name);
      if (t) clearTimeout(t);
      timers.delete(name);
      try {
        localStorage.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}

// ─── Settings ────────────────────────────────────────────────────────────────
interface SettingsState {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      update: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      reset: () => set({ settings: DEFAULT_SETTINGS }),
    }),
    {
      name: "praison-settings",
      storage: createJSONStorage(() => localStorage),
      // Deep-merge so settings added in later versions (providerKeys,
      // activeProviderId, …) exist even for users with older persisted state.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        const settings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) };
        // Vault preseed (r18): fill in pre-seeded keys for providers the user
        // has no key for yet — never overwrite a key the user saved themselves.
        const keys = { ...(settings.providerKeys ?? {}) };
        for (const [pid, pre] of Object.entries(PRESEED_PROVIDER_KEYS)) {
          const cur = keys[pid];
          if (!cur?.key?.trim()) {
            keys[pid] = { ...pre, ...cur, key: cur?.key?.trim() || pre.key };
          }
        }
        return {
          ...current,
          ...p,
          settings: { ...settings, providerKeys: keys },
        };
      },
    }
  )
);

// ─── Agents ──────────────────────────────────────────────────────────────────
interface AgentsState {
  agents: Agent[];
  add: (agent: Agent) => void;
  addMany: (agents: Agent[]) => void;
  update: (id: string, patch: Partial<Agent>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => string | null;
  getById: (id?: string) => Agent | undefined;
}

function stamp(a: Partial<Agent>): Agent {
  const now = Date.now();
  return {
    id: a.id ?? uid("agent"),
    name: a.name ?? "Untitled agent",
    emoji: a.emoji ?? "🤖",
    color: a.color ?? "violet",
    role: a.role ?? "",
    description: a.description ?? "",
    instructions: a.instructions ?? "",
    model: a.model ?? "auto",
    temperature: a.temperature ?? 0.7,
    maxIterations: a.maxIterations ?? 6,
    tools: a.tools ?? [],
    createdAt: a.createdAt ?? now,
    updatedAt: now,
  } as Agent;
}

export const useAgentsStore = create<AgentsState>()(
  persist(
    (set, get) => ({
      agents: [],
      add: (agent) => set((s) => ({ agents: [...s.agents, stamp(agent)] })),
      addMany: (agents) =>
        set((s) => {
          const have = new Set(s.agents.map((a) => a.id));
          const add = agents
            .filter((a) => !have.has(a.id))
            .map((a) => stamp({ ...a, createdAt: Date.now() }));
          return { agents: [...s.agents, ...add] };
        }),
      update: (id, patch) =>
        set((s) => ({
          agents: s.agents.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)),
        })),
      remove: (id) => set((s) => ({ agents: s.agents.filter((a) => a.id !== id) })),
      duplicate: (id) => {
        const src = get().agents.find((a) => a.id === id);
        if (!src) return null;
        const copy = stamp({ ...src, id: uid("agent"), name: `${src.name} copy` });
        set((s) => ({ agents: [...s.agents, copy] }));
        return copy.id;
      },
      getById: (id) => (id ? get().agents.find((a) => a.id === id) : undefined),
    }),
    { name: "praison-agents", storage: createJSONStorage(() => localStorage) }
  )
);

// ─── Conversations ───────────────────────────────────────────────────────────
interface ConversationsState {
  conversations: Conversation[];
  activeId: string | null;
  create: (agentId?: string, workflowId?: string, title?: string) => string;
  setActive: (id: string | null) => void;
  rename: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  remove: (id: string) => void;
  appendMessage: (convId: string, msg: ChatMessage) => void;
  patchMessage: (convId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  appendToolCall: (convId: string, msgId: string, call: ToolCallInfo) => void;
  patchToolCall: (convId: string, msgId: string, callId: string, patch: Partial<ToolCallInfo>) => void;
  /** Drop every message after `msgId` (or including it when `inclusive`). */
  truncateFrom: (convId: string, msgId: string, inclusive?: boolean) => void;
  /** Replace the folded memory doc (source: auto consolidation or manual edit). */
  setMemory: (convId: string, memory: ConversationMemory | undefined) => void;
  /** Enable/disable/configure the proactive heartbeat loop. */
  setHeartbeat: (convId: string, heartbeat: ConversationHeartbeat | undefined) => void;
  clearAll: () => void;
}

export const useConversationsStore = create<ConversationsState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      create: (agentId, workflowId, title = "New chat") => {
        const id = uid("conv");
        const now = Date.now();
        const conv: Conversation = {
          id,
          title,
          agentId,
          workflowId,
          messages: [],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ conversations: [conv, ...s.conversations], activeId: id }));
        return id;
      },
      setActive: (id) => set({ activeId: id }),
      rename: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
        })),
      togglePin: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, pinned: !c.pinned } : c
          ),
        })),
      remove: (id) =>
        set((s) => {
          const conversations = s.conversations.filter((c) => c.id !== id);
          const activeId = s.activeId === id ? conversations[0]?.id ?? null : s.activeId;
          return { conversations, activeId };
        }),
      appendMessage: (convId, msg) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() }
              : c
          ),
        })),
      patchMessage: (convId, msgId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
                }
              : c
          ),
        })),
      appendToolCall: (convId, msgId, call) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === msgId ? { ...m, toolCalls: [...m.toolCalls, call] } : m
                  ),
                }
              : c
          ),
        })),
      patchToolCall: (convId, msgId, callId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === msgId
                      ? {
                          ...m,
                          toolCalls: m.toolCalls.map((t) =>
                            t.id === callId ? { ...t, ...patch } : t
                          ),
                        }
                      : m
                  ),
                }
              : c
          ),
        })),
      truncateFrom: (convId, msgId, inclusive = false) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c;
            const idx = c.messages.findIndex((m) => m.id === msgId);
            if (idx === -1) return c;
            return {
              ...c,
              messages: c.messages.slice(0, inclusive ? idx : idx + 1),
              updatedAt: Date.now(),
            };
          }),
        })),
      setMemory: (convId, memory) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId ? { ...c, memory } : c
          ),
        })),
      setHeartbeat: (convId, heartbeat) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId ? { ...c, heartbeat } : c
          ),
        })),
      clearAll: () => set({ conversations: [], activeId: null }),
    }),
    {
      name: "praison-conversations",
      storage: createJSONStorage(() => debouncedStorage(450)),
    }
  )
);

// ─── Workflows ───────────────────────────────────────────────────────────────
interface WorkflowsState {
  workflows: Workflow[];
  add: (wf: Partial<Workflow>) => string;
  update: (id: string, patch: Partial<Workflow>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => string | null;
  addRun: (wfId: string, run: WorkflowRun) => void;
  patchRun: (wfId: string, runId: string, patch: Partial<WorkflowRun>) => void;
  patchRunStep: (wfId: string, runId: string, stepId: string, patch: Partial<WorkflowRunStep>) => void;
}

export const useWorkflowsStore = create<WorkflowsState>()(
  persist(
    (set, get) => ({
      workflows: [],
      add: (wf) => {
        const id = wf.id ?? uid("wf");
        const now = Date.now();
        const workflow: Workflow = {
          id,
          name: wf.name ?? "Untitled workflow",
          description: wf.description ?? "",
          steps: wf.steps ?? [],
          runs: [],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ workflows: [workflow, ...s.workflows] }));
        return id;
      },
      update: (id, patch) =>
        set((s) => ({
          workflows: s.workflows.map((w) =>
            w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w
          ),
        })),
      remove: (id) => set((s) => ({ workflows: s.workflows.filter((w) => w.id !== id) })),
      duplicate: (id) => {
        const src = get().workflows.find((w) => w.id === id);
        if (!src) return null;
        const copyId = uid("wf");
        const copy: Workflow = {
          ...src,
          id: copyId,
          name: `${src.name} copy`,
          runs: [],
          // A duplicated pipeline must not silently inherit the original's
          // recurring schedule — the copy starts unscheduled (interval kept).
          schedule: src.schedule
            ? { ...src.schedule, enabled: false, lastRunAt: undefined, nextRunAt: undefined }
            : undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ workflows: [copy, ...s.workflows] }));
        return copyId;
      },
      addRun: (wfId, run) =>
        set((s) => ({
          workflows: s.workflows.map((w) =>
            w.id === wfId
              ? { ...w, runs: [run, ...w.runs].slice(0, 12), updatedAt: Date.now() }
              : w
          ),
        })),
      patchRun: (wfId, runId, patch) =>
        set((s) => ({
          workflows: s.workflows.map((w) =>
            w.id === wfId
              ? {
                  ...w,
                  runs: w.runs.map((r) => (r.id === runId ? { ...r, ...patch } : r)),
                }
              : w
          ),
        })),
      patchRunStep: (wfId, runId, stepId, patch) =>
        set((s) => ({
          workflows: s.workflows.map((w) =>
            w.id === wfId
              ? {
                  ...w,
                  runs: w.runs.map((r) =>
                    r.id === runId
                      ? {
                          ...r,
                          steps: r.steps.map((st) =>
                            st.stepId === stepId ? { ...st, ...patch } : st
                          ),
                        }
                      : r
                  ),
                }
              : w
          ),
        })),
    }),
    { name: "praison-workflows", storage: createJSONStorage(() => debouncedStorage(450)) }
  )
);

// ─── UI state ────────────────────────────────────────────────────────────────

/** Cross-view “jump into a message” request (global search → chat). */
export interface PendingMessageFocus {
  convId: string;
  msgId: string;
}

interface UiState {
  view: View;
  mobileNavOpen: boolean;
  chatListOpen: boolean;
  activeAgentId: string | null;
  /** Global command palette (⌘K) visibility. */
  paletteOpen: boolean;
  /** Workflow the command palette asked to run — WorkflowsView consumes + clears it. */
  pendingRunWorkflowId: string | null;
  /** Global search dialog (⌘⇧F) visibility. */
  globalSearchOpen: boolean;
  /** Message to scroll+flash after the chat view mounts the conversation. */
  pendingFocus: PendingMessageFocus | null;
  /** True while any agent stream (chat turn or workflow run) is in flight. */
  busy: boolean;
  /** Workflows view layout: card grid or the runs kanban board. */
  workflowBoardOpen: boolean;
  /** Guided "get your free frontier key" wizard visibility (+ optional deep-linked provider). */
  setupWizardOpen: boolean;
  setupWizardProviderId: string | null;
  /** Image Studio dialog (BYOK image generation) visibility. */
  imageStudioOpen: boolean;
  /** Scroll target inside Settings ("providers" | "local-models") — consumed by SettingsView. */
  settingsAnchor: "providers" | "local-models" | null;
  setView: (v: View) => void;
  setMobileNavOpen: (v: boolean) => void;
  toggleChatList: () => void;
  setActiveAgentId: (id: string | null) => void;
  setPaletteOpen: (v: boolean) => void;
  requestRunWorkflow: (workflowId: string) => void;
  clearPendingRunWorkflow: () => void;
  setGlobalSearchOpen: (v: boolean) => void;
  setImageStudioOpen: (v: boolean) => void;
  requestFocusMessage: (convId: string, msgId: string) => void;
  clearPendingFocus: () => void;
  setBusy: (v: boolean) => void;
  setWorkflowBoardOpen: (v: boolean) => void;
  openSetupWizard: (providerId?: string) => void;
  setSetupWizardOpen: (v: boolean) => void;
  setSettingsAnchor: (a: "providers" | "local-models" | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      view: "chat",
      mobileNavOpen: false,
      chatListOpen: true,
      activeAgentId: "a-assistant",
      paletteOpen: false,
      pendingRunWorkflowId: null,
      globalSearchOpen: false,
      pendingFocus: null,
      busy: false,
      workflowBoardOpen: false,
      setupWizardOpen: false,
      setupWizardProviderId: null,
      imageStudioOpen: false,
      settingsAnchor: null,
      setView: (view) => set({ view, mobileNavOpen: false }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      toggleChatList: () => set((s) => ({ chatListOpen: !s.chatListOpen })),
      setActiveAgentId: (activeAgentId) => set({ activeAgentId }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      requestRunWorkflow: (pendingRunWorkflowId) =>
        set({ pendingRunWorkflowId, view: "workflows", mobileNavOpen: false }),
      setImageStudioOpen: (imageStudioOpen) => set({ imageStudioOpen }),
      clearPendingRunWorkflow: () => set({ pendingRunWorkflowId: null }),
      setGlobalSearchOpen: (globalSearchOpen) => set({ globalSearchOpen }),
      requestFocusMessage: (convId, msgId) =>
        set({ pendingFocus: { convId, msgId }, view: "chat", mobileNavOpen: false }),
      clearPendingFocus: () => set({ pendingFocus: null }),
      setBusy: (busy) => set({ busy }),
      setWorkflowBoardOpen: (workflowBoardOpen) => set({ workflowBoardOpen }),
      openSetupWizard: (providerId) =>
        set({
          setupWizardOpen: true,
          setupWizardProviderId: providerId ?? null,
          view: "settings",
          mobileNavOpen: false,
        }),
      setSetupWizardOpen: (setupWizardOpen) => set({ setupWizardOpen }),
      setSettingsAnchor: (settingsAnchor) => set({ settingsAnchor }),
    }),
    {
      name: "praison-ui",
      partialize: (s) => ({
        view: s.view,
        activeAgentId: s.activeAgentId,
        chatListOpen: s.chatListOpen,
        workflowBoardOpen: s.workflowBoardOpen,
      }),
      storage: createJSONStorage(() => localStorage),
    }
  )
);

// ─── Seed on first launch ────────────────────────────────────────────────────
export function ensureSeeded(): void {
  // Mark stale "streaming" messages from a mid-stream reload as stopped
  useConversationsStore.setState((s) => ({
    conversations: s.conversations.map((c) => ({
      ...c,
      messages: c.messages.map((m) =>
        m.status === "streaming"
          ? { ...m, status: "stopped" as const, content: m.content || "(interrupted)" }
          : m
      ),
    })),
  }));

  const settings = useSettingsStore.getState().settings;
  const agents = useAgentsStore.getState().agents;
  if (!settings.seeded && agents.length === 0) {
    useAgentsStore.getState().addMany(SEED_AGENTS);
  }
  // Starter workflow templates (first launch only — fixed ids keep it idempotent)
  if (!settings.seeded && useWorkflowsStore.getState().workflows.length === 0) {
    const wfStore = useWorkflowsStore.getState();
    const mkStep = (agentId: string, label: string) => ({ id: uid("step"), agentId, label });
    wfStore.add({
      id: "wf-research-brief",
      name: "Research Brief",
      description: "Research a topic with live web sources, distill the insights, publish a polished brief.",
      steps: [
        mkStep("a-researcher", "Research the topic with live web sources"),
        mkStep("a-planner", "Distill key insights and structure the narrative"),
        mkStep("a-writer", "Write the executive brief"),
      ],
    });
    wfStore.add({
      id: "wf-build-verify",
      name: "Build & Verify",
      description: "Code Smith writes JavaScript, runs it in the sandbox and iterates until it works.",
      steps: [mkStep("a-coder", "Write, run and verify the solution")],
    });
  }
  // Hermes-style daily briefing — added for everyone who doesn't have it yet
  // (fixed id, idempotent; the user opts into a schedule via the Schedule popover).
  {
    const wfStore = useWorkflowsStore.getState();
    if (!wfStore.workflows.some((w) => w.id === "wf-morning-briefing")) {
      const researcher = useAgentsStore.getState().getById("a-researcher");
      const writer = useAgentsStore.getState().getById("a-writer");
      if (researcher && writer) {
        const mkStep = (agentId: string, label: string) => ({ id: uid("step"), agentId, label });
        wfStore.add({
          id: "wf-morning-briefing",
          name: "Morning Briefing",
          description:
            "A daily digest: scan the web for what happened while you were away, then deliver a tight 5-bullet briefing.",
          steps: [
            mkStep("a-researcher", "Search the web for today's most important developments in AI and tech"),
            mkStep("a-writer", "Write a tight morning briefing: 5 bullets max, one line each, end with one recommended focus for the day"),
          ],
        });
      }
    }
  }
  if (!settings.seeded) {
    useSettingsStore.getState().update({ seeded: true });
  }
  // Guarantee at least one conversation + valid active agent
  const conv = useConversationsStore.getState();
  const ui = useUiStore.getState();
  if (agents.length === 0 && !ui.activeAgentId) ui.setActiveAgentId("a-assistant");
  if (!conv.activeId && conv.conversations.length === 0) {
    conv.create(ui.activeAgentId ?? "a-assistant");
  } else if (!conv.activeId) {
    conv.setActive(conv.conversations[0].id);
  }
}
