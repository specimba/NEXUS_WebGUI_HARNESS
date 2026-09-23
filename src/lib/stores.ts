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
  Suite,
  SuiteCase,
  SuiteCaseResult,
  SuiteResult,
  ToolCallInfo,
  ToolId,
  View,
  Workflow,
  WorkflowRun,
  WorkflowRunStep,
  WorkflowStep,
} from "./types";
import {
  ATTACHMENT_KEEP_RECENT,
  DEFAULT_SETTINGS,
  MAX_MESSAGES_HARD,
  PRESEED_PROVIDER_KEYS,
  SEED_AGENTS,
  SUITE_RESULTS_CAP,
  TOOL_IDS,
} from "./constants";
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
      // r31 landmine fix: quota failures were silently swallowed — surface
      // them once so users know old chats may lose heavy attachments.
      try {
        window.dispatchEvent(new CustomEvent("praison:storage-quota"));
      } catch {
        /* ignore */
      }
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
    {
      name: "praison-agents",
      storage: createJSONStorage(() => localStorage),
      // r26.2 tool-expansion migration (v0 → v1): seeded agents gain the new
      // tools (UNION — nothing the user kept is removed) and tool ids that no
      // longer exist in the closed-world registry are dropped. Runs once.
      version: 1,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<AgentsState>;
        const agents = (state.agents ?? []).map((a) => {
          const valid = (a.tools ?? []).filter((t): t is ToolId => (TOOL_IDS as string[]).includes(t));
          const seed = SEED_AGENTS.find((s) => s.id === a.id);
          return seed
            ? { ...a, tools: [...new Set([...valid, ...seed.tools])] }
            : { ...a, tools: valid };
        });
        return { ...(state as AgentsState), agents } as AgentsState;
      },
    }
  )
);

// ─── Conversations ───────────────────────────────────────────────────────────

/**
 * r31 landmine fix: praison-conversations grew unbounded (attachment bodies +
 * image data URLs persist forever) under the ~5MB localStorage ceiling, and
 * quota failures were swallowed. Bounded policy, applied on every append:
 * 1) strip heavy attachment payloads from messages older than the latest 12
 *    (text stub keeps the name/size so the UI can still show what was there);
 * 2) hard-cap the message list (drop the OLDEST rows beyond MAX_MESSAGES_HARD).
 */
function compactMessages(messages: ChatMessage[]): ChatMessage[] {
  let msgs = messages;
  if (msgs.length > ATTACHMENT_KEEP_RECENT) {
    const cutoff = msgs.length - ATTACHMENT_KEEP_RECENT;
    msgs = msgs.map((m, i) => {
      const heavy = m.attachments?.some((a) => a.content && a.content.length > 2048);
      if (i >= cutoff || !heavy) return m;
      return {
        ...m,
        attachments: m.attachments!.map((a) =>
          a.content && a.content.length > 2048 ? { ...a, content: "" } : a
        ),
      };
    });
  }
  if (msgs.length > MAX_MESSAGES_HARD) {
    msgs = msgs.slice(msgs.length - MAX_MESSAGES_HARD);
  }
  return msgs;
}

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
  /** r27 per-chat model pin ("providerId::model" / "auto::builtin" / undefined = global). */
  setModelOverride: (convId: string, override: string | undefined) => void;
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
              ? {
                  ...c,
                  messages: compactMessages([...c.messages, msg]),
                  updatedAt: Date.now(),
                }
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
      setModelOverride: (convId, override) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? { ...c, modelOverride: override, updatedAt: Date.now() }
              : c
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
        // r29 fix: carry depth/schedule through — add() used to silently drop
        // them, so seeded/imported workflows lost their pipeline depth.
        const workflow: Workflow = {
          id,
          name: wf.name ?? "Untitled workflow",
          description: wf.description ?? "",
          steps: wf.steps ?? [],
          runs: [],
          createdAt: now,
          updatedAt: now,
          ...(wf.depth ? { depth: wf.depth } : {}),
          ...(wf.schedule ? { schedule: wf.schedule } : {}),
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

// ─── Task suites (harness rank-①, r31) ──────────────────────────────────────
interface SuitesState {
  suites: Suite[];
  add: (suite: Partial<Suite> & { name: string; cases: SuiteCase[] }) => string;
  update: (id: string, patch: Partial<Suite>) => void;
  remove: (id: string) => void;
  addCase: (id: string, c: SuiteCase) => void;
  removeCase: (id: string, caseId: string) => void;
  /** r36 A/B lab: set (or clear) a case's harness rotation in place. */
  setCaseHarnesses: (id: string, caseId: string, harnesses: string[]) => void;
  recordResult: (suiteId: string, result: SuiteResult) => void;
}

export const useSuitesStore = create<SuitesState>()(
  persist(
    (set, get) => ({
      suites: [],
      add: (suite) => {
        const id = suite.id ?? uid("suite");
        const now = Date.now();
        const row: Suite = {
          id,
          name: suite.name,
          description: suite.description ?? "",
          cases: suite.cases,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ suites: [row, ...s.suites] }));
        return id;
      },
      update: (id, patch) =>
        set((s) => ({
          suites: s.suites.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x)),
        })),
      remove: (id) => set((s) => ({ suites: s.suites.filter((x) => x.id !== id) })),
      addCase: (id, c) =>
        set((s) => ({
          suites: s.suites.map((x) =>
            x.id === id ? { ...x, cases: [...x.cases, c], updatedAt: Date.now() } : x
          ),
        })),
      removeCase: (id, caseId) =>
        set((s) => ({
          suites: s.suites.map((x) =>
            x.id === id
              ? { ...x, cases: x.cases.filter((c) => c.id !== caseId), updatedAt: Date.now() }
              : x
          ),
        })),
      setCaseHarnesses: (id, caseId, harnesses) =>
        set((s) => ({
          suites: s.suites.map((x) =>
            x.id === id
              ? {
                  ...x,
                  cases: x.cases.map((c) =>
                    c.id === caseId ? { ...c, harnesses: harnesses.length > 0 ? harnesses : undefined } : c
                  ),
                  updatedAt: Date.now(),
                }
              : x
          ),
        })),
      /** Persist a finished (or stopped/partial) run — aggregates only, capped. */
      recordResult: (suiteId, result) =>
        set((s) => ({
          suites: s.suites.map((x) =>
            x.id === suiteId
              ? {
                  ...x,
                  lastResult: result,
                  history: [...(x.history ?? []), result].slice(-SUITE_RESULTS_CAP),
                  updatedAt: Date.now(),
                }
              : x
          ),
        })),
    }),
    { name: "praison-suites", storage: createJSONStorage(() => debouncedStorage(450)) }
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
  /** Workflows view: task-suites board layout (harness rank-①, r31). */
  workflowSuitesOpen: boolean;
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
  setWorkflowSuitesOpen: (v: boolean) => void;
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
      workflowSuitesOpen: false,
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
      setWorkflowBoardOpen: (workflowBoardOpen) =>
        // Switching to grid OR board always leaves the suites board.
        set({ workflowBoardOpen, workflowSuitesOpen: false }),
      setWorkflowSuitesOpen: (workflowSuitesOpen) =>
        set({ workflowSuitesOpen, ...(workflowSuitesOpen ? { workflowBoardOpen: false } : {}) }),
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
        workflowSuitesOpen: s.workflowSuitesOpen,
      }),
      storage: createJSONStorage(() => localStorage),
    }
  )
);

// ─── Seed on first launch ────────────────────────────────────────────────────
/**
 * r29 Morning Briefing v2 steps — the autonomous-friendly pipeline:
 * dated research (36h recency window, failure-aware) → picker/structure step
 * → writer with a strict no-invented-stories contract. When no planner agent
 * exists (deleted roster), the pipeline degrades gracefully to research → writer.
 */
function morningBriefingStepsV2(withPlanner: boolean): WorkflowStep[] {
  const mkStep = (agentId: string, label: string, instruction: string): WorkflowStep => ({
    id: uid("step"),
    agentId,
    label,
    instruction,
  });
  const research = mkStep(
    "a-researcher",
    "Scan the web for today's most important developments in AI and tech",
    "Research TODAY'S developments in AI and tech. Anchor every query to today's date (ask the clock tool first) and prefer results published within the last 36 hours — put the publication date next to each fact and drop anything you cannot date. Diversify: aim for 4+ distinct stories, at most 2 per topic area. When read_url fails (403/404), note the failure once and move on — never spend a second attempt on a dead link, and never present a failed fetch as a story. Finish with a dated, source-linked list of the 5-7 strongest candidate stories."
  );
  const writer = mkStep(
    "a-writer",
    "Write the 5-bullet morning briefing",
    "Turn the selected stories into the morning briefing: a one-line header with today's date, then 5 bullets max — one line each: **headline** — why it matters — [source](link). End with 'Focus for the day:' and one recommended action. Use ONLY stories the research step actually sourced; never invent a story or a link. If the selection step reported fewer than 3 usable stories, open with an honest 'Quiet news day' note."
  );
  if (!withPlanner) return [research, writer];
  const picker = mkStep(
    "a-planner",
    "Select and structure the briefing",
    "You receive candidate stories from the research step. Pick EXACTLY 5 for the briefing: deduplicate overlapping coverage, drop anything older than 36 hours, drop items whose source failed to load, rank by importance for a technologist's morning. For each pick output one line: headline — why it matters (max 15 words) — source link — date. If fewer than 3 usable stories survived, say so explicitly so the writer can report a thin news day honestly."
  );
  return [research, picker, writer];
}

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

  // Zombie runs (r25): a workflow run left "running" by a page reload can
  // never resume — resume() refuses status "running" and no live runner
  // exists at hydration. Mark them stopped so the resume/recovery path can
  // pick the run back up from its completed steps.
  useWorkflowsStore.setState((s) => ({
    workflows: s.workflows.map((w) => ({
      ...w,
      // r31 boot resilience (OpenClaw gateway doctrine): a malformed schedule
      // must never block app boot — quarantine it (disabled + console flag)
      // instead of throwing during rehydration.
      ...(w.schedule?.enabled &&
      (!Number.isFinite(w.schedule.intervalMs) ||
        w.schedule.intervalMs < 1_000 ||
        typeof w.schedule.task !== "string" ||
        (w.schedule.nextRunAt != null && !Number.isFinite(w.schedule.nextRunAt)))
        ? (() => {
            console.warn(
              `[boot] quarantined malformed schedule on "${w.name}" — fix interval/task, then re-enable`
            );
            return { schedule: { ...w.schedule, enabled: false } };
          })()
        : {}),
      runs: w.runs.map((r) =>
        r.status === "running"
          ? { ...r, status: "stopped" as const, finishedAt: r.finishedAt ?? Date.now() }
          : r
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
    const mkStep = (agentId: string, label: string, instruction?: string) => ({
      id: uid("step"),
      agentId,
      label,
      ...(instruction ? { instruction } : {}),
    });
    wfStore.add({
      id: "wf-research-brief",
      name: "Research Brief",
      description: "Research a topic with live web sources, distill the insights, publish a polished brief.",
      depth: "standard",
      steps: [
        mkStep(
          "a-researcher",
          "Research the topic with live web sources",
          "Research the topic exhaustively with live sources: start with web_search, then read_url the 3-5 strongest pages. Cite every fact with a markdown link and explicitly mark anything you could not verify. If a fetch fails, note it once and move on — never retry a dead link twice."
        ),
        mkStep(
          "a-planner",
          "Distill key insights and structure the narrative",
          "Distill the research into a tight outline: 4-6 key insights, each with its source links. Flag contradictions between sources instead of smoothing them over."
        ),
        mkStep(
          "a-writer",
          "Write the executive brief",
          "Write the executive brief from the outline: headline verdict first, then structured markdown sections. Keep every citation; never add facts the research step didn't source."
        ),
      ],
    });
    wfStore.add({
      id: "wf-build-verify",
      name: "Build & Verify",
      description: "Code Smith writes JavaScript, runs it in the sandbox and iterates until it works.",
      steps: [
        mkStep(
          "a-coder",
          "Write, run and verify the solution",
          "Write JavaScript that solves the task, run it with run_code, and iterate on failures until the run passes. Show the final code and the passing output."
        ),
      ],
    });
  }
  // Hermes-style daily briefing — added for everyone who doesn't have it yet
  // (fixed id, idempotent; the user opts into a schedule via the Schedule popover).
  {
    const wfStore = useWorkflowsStore.getState();
    if (!wfStore.workflows.some((w) => w.id === "wf-morning-briefing")) {
      const researcher = useAgentsStore.getState().getById("a-researcher");
      const planner = useAgentsStore.getState().getById("a-planner");
      const writer = useAgentsStore.getState().getById("a-writer");
      if (researcher && writer) {
        wfStore.add({
          id: "wf-morning-briefing",
          name: "Morning Briefing",
          description:
            "A daily digest: scan the web for what happened while you were away, then deliver a tight 5-bullet briefing.",
          depth: "standard",
          steps: morningBriefingStepsV2(planner != null),
        });
      }
    }
    // r29 template migration: pre-existing v1 Morning Briefings have no
    // per-step instructions (the v1 fingerprint) — upgrade them in place to
    // the autonomous v2 pipeline. User-authored schedules and any edited
    // instructions are respected (upgrade only fills what's missing).
    const mb = wfStore.workflows.find((w) => w.id === "wf-morning-briefing");
    if (mb && mb.steps.some((s) => !s.instruction)) {
      const planner = useAgentsStore.getState().getById("a-planner");
      wfStore.update(mb.id, {
        depth: mb.depth ?? "standard",
        steps: morningBriefingStepsV2(planner != null),
      });
      console.info("[seed] Morning Briefing upgraded to v2 (dated, deduped, failure-aware)");
    }
  }
  // r29: Deep Research Dossier — demonstrates the sophisticated
  // planner → gap-fill → writer structure (map, audit gaps, fill them, synthesize).
  {
    const wfStore = useWorkflowsStore.getState();
    if (!wfStore.workflows.some((w) => w.id === "wf-deep-dossier")) {
      const researcher = useAgentsStore.getState().getById("a-researcher");
      const planner = useAgentsStore.getState().getById("a-planner");
      const writer = useAgentsStore.getState().getById("a-writer");
      if (researcher && planner && writer) {
        const mkStep = (agentId: string, label: string, instruction: string) => ({
          id: uid("step"),
          agentId,
          label,
          instruction,
        });
        wfStore.add({
          id: "wf-deep-dossier",
          name: "Deep Research Dossier",
          description:
            "Map a topic, audit what the map is missing, fill exactly those gaps, then publish a cited dossier.",
          depth: "deep",
          steps: [
            mkStep(
              "a-researcher",
              "Map the landscape",
              "First pass: map the topic — main players, state of the art, notable disagreements, open questions. 4-6 web searches, then read the 3 most substantive pages. Output a structured map where every claim carries a source link."
            ),
            mkStep(
              "a-planner",
              "Identify the gaps",
              "Audit the landscape map: list the 3 most important gaps — questions the research didn't answer or answered shallowly. Output them as precise research briefs, one short paragraph each."
            ),
            mkStep(
              "a-researcher",
              "Fill the gaps",
              "Execute the gap briefs from the previous step: one focused search round per brief. Report ONLY what the new searches actually found; mark anything still unresolved as an open question. Do not repeat material the map already covered."
            ),
            mkStep(
              "a-writer",
              "Write the dossier",
              "Write the dossier: executive summary (max 5 lines), findings organized by section with inline citations, then Open Questions at the end. Synthesize in your own words — never paste raw research notes."
            ),
          ],
        });
      }
    }
  }
  // r31 harness rank-①: Loop Health Check — the roadmap's mandatory
  // "correct action is to stop" suite case: verifies the engine reaches a
  // clean tool-free exit (done, 0 tool calls, ~1s). Fixed id, idempotent.
  {
    const wfStore = useWorkflowsStore.getState();
    if (!wfStore.workflows.some((w) => w.id === "wf-loop-health")) {
      const assistant = useAgentsStore.getState().getById("a-assistant");
      if (assistant) {
        wfStore.add({
          id: "wf-loop-health",
          name: "Loop Health Check",
          description:
            "One-step probe: verifies the engine reaches a clean tool-free exit. The task suite's stop-case — expect done, 0 tool calls, output OK.",
          depth: "quick",
          steps: [
            {
              id: uid("step"),
              agentId: "a-assistant",
              label: "Health probe",
              instruction:
                "This is a health probe. Reply with exactly OK and nothing else. Do not use any tools.",
            },
          ],
        });
      }
    }
  }
  // r31: Harness Baseline Suite — replayable cases over the seeded pipelines
  // (cheap stop-case first, sandbox case, then the web pipelines). Deep
  // Dossier deliberately excluded: suites must stay cost-honest.
  {
    const sStore = useSuitesStore.getState();
    if (!sStore.suites.some((x) => x.id === "suite-baseline")) {
      const wfs = useWorkflowsStore.getState().workflows;
      const has = (id: string) => wfs.some((w) => w.id === id);
      const mkCase = (workflowId: string, task: string, expect?: string, maxToolCalls?: number): SuiteCase => ({
        id: uid("case"),
        workflowId,
        task,
        ...(expect ? { expect } : {}),
        ...(maxToolCalls != null ? { maxToolCalls } : {}),
      });
      const cases: SuiteCase[] = [];
      if (has("wf-loop-health"))
        cases.push(
          mkCase("wf-loop-health", "Health probe — reply with exactly OK. Do not use any tools.", "done · 0 tool calls · output OK", 0)
        );
      if (has("wf-build-verify"))
        cases.push(
          mkCase(
            "wf-build-verify",
            "Write and run a JavaScript function that returns the first 10 Fibonacci numbers joined by commas, then show the passing output.",
            "done · code runs clean in the sandbox"
          )
        );
      if (has("wf-research-brief"))
        cases.push(
          mkCase(
            "wf-research-brief",
            "In one short brief: what shipped recently in open-source AI agent frameworks? Cite sources.",
            "done · brief with citations"
          )
        );
      if (has("wf-morning-briefing"))
        cases.push(
          mkCase("wf-morning-briefing", "Today's top AI model releases and platform news, briefed professionally.", "done · 5-bullet briefing")
        );
      if (cases.length > 0) {
        sStore.add({
          id: "suite-baseline",
          name: "Harness Baseline Suite",
          description:
            "Replayable health + quality cases over the seeded pipelines — converts harness changes from vibes into experiments. Suites run REAL pipelines and spend provider quota.",
          cases,
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
