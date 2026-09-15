"use client";

import * as React from "react";
import { ArrowDown, Download, Eraser, MessagesSquare, PanelLeftOpen, Plus, RefreshCw, Search } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AgentAvatar, ModelBadge } from "@/components/praison/atoms";
import { ChatSearch } from "@/components/praison/chat/chat-search";
import { Composer } from "@/components/praison/chat/composer";
import { ConversationList } from "@/components/praison/chat/conversation-list";
import { MessageItem } from "@/components/praison/chat/message-item";
import { isAbortError, runAgentChat } from "@/lib/chat-client";
import {
  DEFAULT_TTS_VOICE,
  MAX_CONTEXT_MESSAGES,
  MAX_SPEAK_CHARS,
} from "@/lib/constants";
import {
  attachmentContextBlock,
  conversationToMarkdown,
  downloadText,
  mdToSpeakable,
  msgContextText,
  slugify,
  titleFrom,
  uid,
} from "@/lib/helpers";
import {
  useAgentsStore,
  useConversationsStore,
  useSettingsStore,
  useUiStore,
} from "@/lib/stores";
import type { Agent, ChatMessage, MessageAttachment, QueuedMessage, Settings } from "@/lib/types";
import { cn } from "@/lib/utils";

const NO_MESSAGES: ChatMessage[] = [];

export function ChatView() {
  // ─── Stores ────────────────────────────────────────────────────────────────
  const conversations = useConversationsStore((s) => s.conversations);
  const activeId = useConversationsStore((s) => s.activeId);
  const create = useConversationsStore((s) => s.create);
  const agents = useAgentsStore((s) => s.agents);
  const chatListOpen = useUiStore((s) => s.chatListOpen);
  const toggleChatList = useUiStore((s) => s.toggleChatList);
  const uiActiveAgentId = useUiStore((s) => s.activeAgentId);
  const setActiveAgentId = useUiStore((s) => s.setActiveAgentId);

  const conversation = React.useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId]
  );

  // ─── Local state / refs ────────────────────────────────────────────────────
  const [streaming, setStreaming] = React.useState(false);
  /** Sync mirror of `streaming` — readable inside async callbacks without stale closures. */
  const streamingRef = React.useRef(false);
  const [statusLine, setStatusLine] = React.useState<string | null>(null);
  const [showJump, setShowJump] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [scrolledDown, setScrolledDown] = React.useState(false);
  /** Per-chat agent override: which agent the NEXT message in this chat goes to. */
  const [chatAgentId, setChatAgentId] = React.useState<string | null>(null);
  /** Follow-up typed while the agent streams — auto-sent when the turn settles. */
  const [queued, setQueued] = React.useState<QueuedMessage | null>(null);
  const queuedRef = React.useRef<QueuedMessage | null>(null);
  const flushQueueRef = React.useRef<(() => void) | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);
  const draftRef = React.useRef("");
  const reasoningRef = React.useRef("");
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = React.useRef(true);

  const agentMap = React.useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  // Reset the per-chat agent override when switching conversations
  React.useEffect(() => {
    setChatAgentId(null);
    setSearchOpen(false);
  }, [activeId]);

  const convAgentId =
    conversation?.agentId && agentMap.has(conversation.agentId) ? conversation.agentId : null;
  const uiAgentId =
    uiActiveAgentId && agentMap.has(uiActiveAgentId) ? uiActiveAgentId : null;
  const effectiveAgentId = chatAgentId ?? convAgentId ?? uiAgentId ?? agents[0]?.id ?? null;
  const agent = effectiveAgentId ? agentMap.get(effectiveAgentId) : undefined;

  // Latest selected agent id, readable inside the async send callback
  const agentIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    agentIdRef.current = effectiveAgentId;
  }, [effectiveAgentId]);

  // Abort any in-flight run when the view unmounts
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const messages = conversation?.messages ?? NO_MESSAGES;

  // Show "Regenerate" when the conversation ends on a finished assistant reply
  const canRegenerate = React.useMemo(() => {
    if (streaming || messages.length === 0) return false;
    const last = messages[messages.length - 1];
    return last.role === "assistant" && last.status !== "streaming";
  }, [messages, streaming]);

  // ─── Auto-scroll: pin to bottom while near it, else offer "Jump to latest" ──
  React.useEffect(() => {
    if (!isNearBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    el.scrollTo({
      top: el.scrollHeight,
      behavior: last?.status === "streaming" ? "auto" : "smooth",
    });
  }, [messages, statusLine]);

  // Jump to bottom when switching conversations
  React.useEffect(() => {
    isNearBottomRef.current = true;
    setShowJump(false);
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [activeId]);

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    isNearBottomRef.current = near;
    setShowJump(!near);
    setScrolledDown(el.scrollTop > 8);
  }, []);

  const scrollToBottom = React.useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // ─── Jump to a message requested from outside (global search) ──────────────
  const pendingFocus = useUiStore((s) => s.pendingFocus);
  const clearPendingFocus = useUiStore((s) => s.clearPendingFocus);
  React.useEffect(() => {
    if (!pendingFocus || pendingFocus.convId !== activeId) return;
    const timer = window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-msg-id="${pendingFocus.msgId}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("msg-flash");
        void el.offsetWidth; // restart animation when already flashed
        el.classList.add("msg-flash");
        window.setTimeout(() => el.classList.remove("msg-flash"), 2200);
      }
      clearPendingFocus();
    }, 160);
    return () => window.clearTimeout(timer);
  }, [pendingFocus, activeId, clearPendingFocus]);

  // ─── Run one agent turn into an existing assistant message ─────────────────
  const runTurn = React.useCallback(
    async (
      convId: string,
      asstId: string,
      history: { role: "user" | "assistant"; content: string }[],
      selectedAgent: Agent,
      settings: Settings,
      images?: { name: string; dataUrl: string }[]
    ): Promise<"done" | "stopped" | "error"> => {
      setStreaming(true);
      streamingRef.current = true;
      useUiStore.getState().setBusy(true);
      setStatusLine(null);
      setShowJump(false);
      isNearBottomRef.current = true;
      draftRef.current = "";
      reasoningRef.current = "";

      const startedAt = Date.now();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await runAgentChat(
          {
            provider: settings.provider,
            apiKey: settings.apiKey || undefined,
            baseUrl: settings.baseUrl,
            model: selectedAgent.model,
            temperature: selectedAgent.temperature,
            maxIterations: selectedAgent.maxIterations,
            system: selectedAgent.instructions,
            tools: selectedAgent.tools,
            messages: history,
            images: images && images.length > 0 ? images : undefined,
            signal: controller.signal,
          },
          {
            onToken: (t) => {
              draftRef.current += t;
              useConversationsStore
                .getState()
                .patchMessage(convId, asstId, { content: draftRef.current });
            },
            onReasoning: (t) => {
              reasoningRef.current = reasoningRef.current
                ? `${reasoningRef.current}\n${t}`
                : t;
              useConversationsStore
                .getState()
                .patchMessage(convId, asstId, { reasoning: reasoningRef.current });
            },
            onToolCall: (c) => {
              const store = useConversationsStore.getState();
              store.appendToolCall(convId, asstId, { id: c.id, name: c.name, args: c.args });
              draftRef.current = "";
              store.patchMessage(convId, asstId, { content: "" });
            },
            onToolResult: (r) => {
              useConversationsStore.getState().patchToolCall(convId, asstId, r.id, {
                result: r.content,
                ok: r.ok,
                ms: r.ms,
              });
            },
            onIteration: (n) => setStatusLine(n > 1 ? `iteration ${n}` : null),
          }
        );

        // Reconcile the final tool calls with results streamed into the store
        const store = useConversationsStore.getState();
        const finalMsg = store.conversations
          .find((c) => c.id === convId)
          ?.messages.find((m) => m.id === asstId);
        const streamedCalls = finalMsg?.toolCalls ?? [];
        const byId = new Map(streamedCalls.map((tc) => [tc.id, tc]));
        const toolCalls = result.toolCalls.length
          ? result.toolCalls.map((tc) => {
              const prev = byId.get(tc.id);
              return prev ? { ...tc, result: prev.result, ok: prev.ok, ms: prev.ms } : tc;
            })
          : streamedCalls;

        store.patchMessage(convId, asstId, {
          content: result.content,
          toolCalls,
          status: "done",
          durationMs: Date.now() - startedAt,
          model: selectedAgent.model,
        });
        return "done";
      } catch (err) {
        const store = useConversationsStore.getState();
        const elapsed = { durationMs: Date.now() - startedAt, model: selectedAgent.model };
        if (isAbortError(err)) {
          store.patchMessage(convId, asstId, {
            status: "stopped",
            content: draftRef.current || "(stopped)",
            ...elapsed,
          });
          return "stopped";
        } else {
          const message = err instanceof Error ? err.message : "Something went wrong.";
          store.patchMessage(convId, asstId, {
            status: "error",
            error: message,
            content: draftRef.current,
            ...elapsed,
          });
          toast.error("The agent failed to respond", { description: message });
          return "error";
        }
      } finally {
        abortRef.current = null;
        streamingRef.current = false;
        useUiStore.getState().setBusy(false);
        setStreaming(false);
        setStatusLine(null);
      }
    },
    []
  );

  // ─── Send one agent turn ───────────────────────────────────────────────
  const send = React.useCallback(
    async (text: string, attachments: MessageAttachment[] = []) => {
      const trimmed = text.trim();
      if (!trimmed || streamingRef.current) return;

      const convStore = useConversationsStore.getState();
      const convId = convStore.activeId;
      const conv = convStore.conversations.find((c) => c.id === convId);
      if (!convId || !conv) {
        toast.error("No chat selected — start a new chat first.");
        return;
      }

      const selectedAgent = useAgentsStore.getState().getById(agentIdRef.current ?? undefined);
      if (!selectedAgent) {
        toast.error("No agent selected.");
        return;
      }

      const settings = useSettingsStore.getState().settings;

      // Split attachments: text bodies inline into the prompt, images travel
      // as dedicated content parts (vision path).
      const textAtts = attachments.filter((a) => a.kind !== "image");
      const imageAtts = attachments.filter((a) => a.kind === "image");
      const images = imageAtts.map((a) => ({ name: a.name, dataUrl: a.content }));

      // Context: completed turns only (attachment file bodies included), capped
      const history = conv.messages
        .filter((m) => m.status === "done" || m.role === "user")
        .map((m) => ({ role: m.role, content: msgContextText(m) }))
        .slice(-MAX_CONTEXT_MESSAGES);
      history.push({ role: "user", content: trimmed + attachmentContextBlock(textAtts) });

      // Optimistically append the user message + assistant placeholder
      const userMsg: ChatMessage = {
        id: uid("msg"),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
        toolCalls: [],
        status: "done",
        ...(attachments.length > 0 ? { attachments } : {}),
      };
      const asstId = uid("msg");
      const asstMsg: ChatMessage = {
        id: asstId,
        role: "assistant",
        content: "",
        agentId: selectedAgent.id,
        agentName: selectedAgent.name,
        createdAt: Date.now(),
        toolCalls: [],
        status: "streaming",
      };
      convStore.appendMessage(convId, userMsg);
      convStore.appendMessage(convId, asstMsg);

      // Auto-title brand-new chats
      const fresh = useConversationsStore.getState();
      const freshConv = fresh.conversations.find((c) => c.id === convId);
      if (freshConv && freshConv.title === "New chat") {
        fresh.rename(convId, titleFrom(trimmed));
      }

      void runTurn(
        convId,
        asstId,
        history,
        selectedAgent,
        settings,
        images.length > 0 ? images : undefined
      ).then((settled) => {
        // Async steering: the queued follow-up fires when the turn settles.
        // Stopping the generation intentionally drops the queue.
        if (settled === "stopped") {
          if (queuedRef.current?.convId === convId) {
            queuedRef.current = null;
            setQueued(null);
            toast("Queued message cancelled", { icon: "🛑" });
          }
          return;
        }
        flushQueueRef.current?.();
      });
    },
    [runTurn]
  );

  // Always-fresh send, callable from the settle handler without stale closures
  const sendRef = React.useRef(send);
  React.useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // ─── Queued follow-up (async steering while the agent streams) ─────────
  const flushQueue = React.useCallback(() => {
    const q = queuedRef.current;
    if (!q) return;
    const activeIdNow = useConversationsStore.getState().activeId;
    if (activeIdNow !== q.convId) return; // stays queued for its own chat
    queuedRef.current = null;
    setQueued(null);
    void sendRef.current(q.text, q.attachments);
  }, []);
  React.useEffect(() => {
    flushQueueRef.current = flushQueue;
  }, [flushQueue]);

  const queueMessage = React.useCallback(
    (text: string, attachments: MessageAttachment[]) => {
      const convId = useConversationsStore.getState().activeId;
      if (!convId) return;
      const replaced = queuedRef.current !== null;
      const q: QueuedMessage = { convId, text, attachments, queuedAt: Date.now() };
      queuedRef.current = q;
      setQueued(q);
      toast(replaced ? "Queued message replaced" : "Message queued", {
        icon: "⏭",
        description: "Sends automatically when the current reply finishes.",
      });
    },
    []
  );

  const cancelQueued = React.useCallback(() => {
    if (!queuedRef.current) return;
    queuedRef.current = null;
    setQueued(null);
    toast("Queued message removed", { icon: "✕" });
  }, []);

  const sendQueuedNow = React.useCallback(() => {
    if (streamingRef.current) return;
    flushQueueRef.current?.();
  }, []);

  // ─── Regenerate the last assistant response ──────────────────────────
  const regenerate = React.useCallback(async () => {
    if (streaming || !conversation) return;
    const store = useConversationsStore.getState();
    const conv = store.conversations.find((c) => c.id === conversation.id);
    if (!conv) return;

    let lastAsstIdx = -1;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].role === "assistant") {
        lastAsstIdx = i;
        break;
      }
    }
    if (lastAsstIdx === -1) return;

    const asst = conv.messages[lastAsstIdx];
    const sourceAgent = useAgentsStore
      .getState()
      .getById(asst.agentId ?? agentIdRef.current ?? undefined);
    if (!sourceAgent) {
      toast.error("The agent that wrote this reply no longer exists.");
      return;
    }

    const history = conv.messages
      .slice(0, lastAsstIdx)
      .filter((m) => m.status === "done" || m.role === "user")
      .map((m) => ({ role: m.role, content: msgContextText(m) }))
      .slice(-MAX_CONTEXT_MESSAGES);
    if (history.length === 0) return;

    store.patchMessage(conv.id, asst.id, {
      content: "",
      toolCalls: [],
      reasoning: undefined,
      status: "streaming",
      error: undefined,
    });
    // Re-attach images from the originating user turn, if any
    const prevUser = conv.messages[lastAsstIdx - 1];
    const images =
      prevUser?.role === "user"
        ? (prevUser.attachments ?? [])
            .filter((a) => a.kind === "image")
            .map((a) => ({ name: a.name, dataUrl: a.content }))
        : [];
    toast("Regenerating response…", { icon: "↻" });
    void runTurn(
      conv.id,
      asst.id,
      history,
      sourceAgent,
      useSettingsStore.getState().settings,
      images.length > 0 ? images : undefined
    );
  }, [streaming, conversation, runTurn]);

  const stop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ─── Read-aloud: speak any finished assistant reply via /api/tts ──────────
  const speechRate = useSettingsStore((s) => s.settings.speechRate ?? 1);
  const [speech, setSpeech] = React.useState<{
    msgId: string;
    state: "loading" | "playing";
  } | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = React.useRef<string | null>(null);

  const stopSpeech = React.useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setSpeech(null);
  }, []);

  // Stop playback when switching chats or unmounting
  React.useEffect(() => stopSpeech, [stopSpeech]);
  React.useEffect(() => stopSpeech(), [activeId, stopSpeech]);

  // Speed changes apply live to whatever is currently playing
  React.useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speechRate;
  }, [speechRate]);

  const toggleSpeak = React.useCallback(
    async (msgId: string, rawMarkdown: string) => {
      if (speech?.msgId === msgId) {
        stopSpeech();
        return;
      }
      stopSpeech();
      const voice =
        useSettingsStore.getState().settings.voice || DEFAULT_TTS_VOICE;
      let text = mdToSpeakable(rawMarkdown);
      if (!text) {
        toast.warning("Nothing to read in this reply.");
        return;
      }
      if (text.length > MAX_SPEAK_CHARS) {
        text = text.slice(0, MAX_SPEAK_CHARS);
        toast.info("Long reply — reading the first part.");
      }
      setSpeech({ msgId, state: "loading" });
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `Speech generation failed (${res.status})`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = new Audio(url);
        audio.playbackRate = useSettingsStore.getState().settings.speechRate ?? 1;
        audioRef.current = audio;
        audio.onended = () => stopSpeech();
        audio.onerror = () => stopSpeech();
        await audio.play();
        setSpeech({ msgId, state: "playing" });
      } catch (err) {
        stopSpeech();
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (/NotAllowedError|didn't interact/i.test(msg)) {
          toast.warning("Playback blocked by the browser — click the speaker again.");
        } else if (!/interrupted|abort/i.test(msg)) {
          toast.error("Read-aloud failed", { description: msg });
        }
      }
    },
    [speech, stopSpeech]
  );

  // ─── Edit a user message and resend the turn from that point ─────────────
  const editAndResend = React.useCallback(
    async (msgId: string, newText: string) => {
      if (streaming || !conversation) return;
      const store = useConversationsStore.getState();
      const conv = store.conversations.find((c) => c.id === conversation.id);
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === msgId);
      if (idx === -1) return;
      const target = conv.messages[idx];
      if (target.role !== "user") return;

      // The agent that answered this turn originally; fall back to current
      const nextAsst = conv.messages[idx + 1];
      const agentsState = useAgentsStore.getState();
      const sourceAgent =
        agentsState.getById(nextAsst?.agentId ?? target.agentId ?? undefined) ??
        agentsState.getById(agentIdRef.current ?? undefined);
      if (!sourceAgent) {
        toast.error("No agent available to answer the edited message.");
        return;
      }

      // History = everything before the edited message + the new text
      const history = conv.messages
        .slice(0, idx)
        .filter((m) => m.status === "done" || m.role === "user")
        .map((m) => ({ role: m.role, content: msgContextText(m) }))
        .slice(-MAX_CONTEXT_MESSAGES);
      history.push({ role: "user", content: newText });

      // Drop the rest of the thread, keep the edited user message in place
      store.truncateFrom(conv.id, msgId, false);
      store.patchMessage(conv.id, msgId, { content: newText });

      // Re-title when the first user message is edited
      if (conv.messages.find((m) => m.role === "user")?.id === msgId) {
        store.rename(conv.id, titleFrom(newText));
      }

      // Keep the original images (if any) attached to the edited turn
      const images = (target.attachments ?? [])
        .filter((a) => a.kind === "image")
        .map((a) => ({ name: a.name, dataUrl: a.content }));

      const asstId = uid("msg");
      store.appendMessage(conv.id, {
        id: asstId,
        role: "assistant",
        content: "",
        agentId: sourceAgent.id,
        agentName: sourceAgent.name,
        createdAt: Date.now(),
        toolCalls: [],
        status: "streaming",
      });
      toast("Resending from your edit…", { icon: "✏️" });
      void runTurn(
        conv.id,
        asstId,
        history,
        sourceAgent,
        useSettingsStore.getState().settings,
        images.length > 0 ? images : undefined
      );
    },
    [streaming, conversation, runTurn]
  );

  const handleAgentChange = React.useCallback(
    (id: string) => {
      setChatAgentId(id);
      setActiveAgentId(id);
    },
    [setActiveAgentId]
  );

  // ─── Re-run a past turn with a different agent ("Answer as …") ────────────
  const answerAs = React.useCallback(
    async (msgId: string, agentId: string) => {
      if (streaming || !conversation) return;
      const store = useConversationsStore.getState();
      const conv = store.conversations.find((c) => c.id === conversation.id);
      if (!conv) return;
      const idx = conv.messages.findIndex((m) => m.id === msgId);
      if (idx === -1) return;
      const target = conv.messages[idx];
      if (target.role !== "user") return;
      const nextAgent = useAgentsStore.getState().getById(agentId);
      if (!nextAgent) {
        toast.error("That agent no longer exists.");
        return;
      }

      // History: everything up to AND including this user message (it is always
      // kept — it is the last entry after the context cap).
      const history = conv.messages
        .slice(0, idx + 1)
        .filter((m) => m.status === "done" || m.role === "user")
        .map((m) => ({ role: m.role, content: msgContextText(m) }))
        .slice(-MAX_CONTEXT_MESSAGES);
      if (history.length === 0) return;

      // Drop everything after the user message, keep the message itself
      store.truncateFrom(conv.id, msgId, false);

      const asstId = uid("msg");
      store.appendMessage(conv.id, {
        id: asstId,
        role: "assistant",
        content: "",
        agentId: nextAgent.id,
        agentName: nextAgent.name,
        createdAt: Date.now(),
        toolCalls: [],
        status: "streaming",
      });
      // Keep the original images (if any) attached to the re-answered turn
      const images = (target.attachments ?? [])
        .filter((a) => a.kind === "image")
        .map((a) => ({ name: a.name, dataUrl: a.content }));
      toast(`Answering as ${nextAgent.name}…`, { icon: nextAgent.emoji });
      void runTurn(
        conv.id,
        asstId,
        history,
        nextAgent,
        useSettingsStore.getState().settings,
        images.length > 0 ? images : undefined
      );
    },
    [streaming, conversation, runTurn]
  );

  // ─── Export the active conversation as a Markdown download ──────────────
  const exportActiveChat = React.useCallback(() => {
    if (!conversation || conversation.messages.length === 0) return;
    downloadText(
      `praison-chat-${slugify(conversation.title)}.md`,
      conversationToMarkdown(conversation),
      "text/markdown"
    );
    toast.success("Chat exported as Markdown", {
      description: `${conversation.messages.length} messages saved to your device.`,
    });
  }, [conversation]);

  // "Clear chat": swap the active conversation for a fresh one with the same agent
  const clearChat = React.useCallback(() => {
    if (!conversation) return;
    const store = useConversationsStore.getState();
    store.remove(conversation.id);
    store.create(agentIdRef.current ?? undefined);
    setChatAgentId(null);
    toast.success("Chat cleared — fresh start!");
  }, [conversation]);

  // Close the mobile overlay after navigating from the list
  const closeOnMobile = React.useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      const ui = useUiStore.getState();
      if (ui.chatListOpen) ui.toggleChatList();
    }
  }, []);

  // Agent-tailored suggestion chips for the empty state
  const suggestions = React.useMemo(() => {
    const list = ["Introduce yourself and what you can do"];
    const tools = agent?.tools ?? [];
    if (tools.includes("web_search")) list.push("What's the latest news about AI agents?");
    if (tools.includes("run_code"))
      list.push("Write and run JS that computes the 30th Fibonacci number");
    if (tools.includes("read_url"))
      list.push("Read https://github.com/specimba/PraisonAI and summarize it");
    if (tools.includes("current_time")) list.push("What time is it right now?");
    return list;
  }, [agent]);

  // ─── No active conversation ────────────────────────────────────────────────
  if (!conversation) {
    return (
      <div className="relative flex h-full min-w-0">
        <ConversationList onNavigate={closeOnMobile} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted shadow-inner">
              <MessagesSquare className="h-7 w-7 text-muted-foreground" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-semibold">No chat selected</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick a conversation from the list or start a new one.
              </p>
            </div>
            <Button
              onClick={() => create(agent?.id ?? undefined)}
              className="gap-2 shadow-md shadow-violet-500/20"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Start chatting
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main layout ───────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full min-w-0">
      <ConversationList onNavigate={closeOnMobile} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* In-conversation search overlay */}
        <ChatSearch open={searchOpen} messages={messages} onClose={() => setSearchOpen(false)} />

        {/* Header */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 md:gap-3 md:px-4">
          {!chatListOpen && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Show chat list"
              onClick={toggleChatList}
            >
              <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden />
            </Button>
          )}

          {/* Agent selector — sets who answers the NEXT message in this chat */}
          <Select value={agent?.id ?? ""} onValueChange={handleAgentChange}>
            <SelectTrigger
              aria-label="Switch agent"
              className="h-9 max-w-[10rem] gap-2 rounded-full pl-1.5 pr-2.5 sm:max-w-56"
            >
              <AgentAvatar agent={agent} size="xs" />
              <SelectValue placeholder="Agent" className="truncate text-sm font-medium" />
            </SelectTrigger>
            <SelectContent align="start">
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="mr-1" aria-hidden>
                    {a.emoji}
                  </span>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">
            {agent?.role ?? "No agent selected"}
          </p>
          <ModelBadge model={agent?.model ?? "auto"} className="hidden sm:inline-flex" />

          <div className="ml-auto flex items-center gap-1">
            {streaming ? (
              <span className="hidden items-center gap-1.5 text-xs font-medium text-violet-400 sm:flex">
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400"
                  aria-hidden
                />
                {statusLine ?? "thinking…"}
              </span>
            ) : (
              <span className="hidden text-xs text-muted-foreground md:inline">
                {messages.length} {messages.length === 1 ? "message" : "messages"}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Find in conversation"
              title="Find in conversation"
              disabled={messages.length === 0}
              onClick={() => setSearchOpen((v) => !v)}
              className="transition-colors hover:text-violet-400"
            >
              <Search className="h-[18px] w-[18px]" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Export chat as Markdown"
              title="Export chat as Markdown"
              disabled={messages.length === 0}
              onClick={exportActiveChat}
              className="transition-colors hover:text-violet-400"
            >
              <Download className="h-[18px] w-[18px]" aria-hidden />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear this chat"
                  disabled={streaming || messages.length === 0}
                >
                  <Eraser className="h-[18px] w-[18px]" aria-hidden />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear this chat?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All messages in “{conversation.title}” will be erased and a fresh chat will
                    start with {agent?.name ?? "the same agent"}. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40"
                    onClick={clearChat}
                  >
                    Clear chat
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </header>

        {/* Messages */}
        {messages.length === 0 ? (
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center text-center">
              <AgentAvatar agent={agent} size="lg" className="shadow-lg shadow-violet-500/25" />
              <h2 className="mt-4 text-xl font-bold tracking-tight">
                {agent?.name ?? "New chat"}
              </h2>
              {agent?.role ? <p className="mt-0.5 text-sm text-violet-400">{agent.role}</p> : null}
              {agent?.description ? (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {agent.description}
                </p>
              ) : null}
              <p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Try
              </p>
              <div className="mt-2.5 flex flex-wrap justify-center gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={streaming}
                    onClick={() => void send(s)}
                    className="rounded-full border bg-card/60 px-3 py-1.5 text-sm text-foreground/90 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-500/40 hover:bg-accent hover:text-foreground hover:shadow-md hover:shadow-violet-500/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className={cn(
                "min-h-0 flex-1 overflow-y-auto px-4 py-6 transition-shadow duration-300",
                scrolledDown && "shadow-[inset_0_14px_16px_-14px_rgba(0,0,0,0.55)]"
              )}
              role="log"
              aria-label="Chat messages"
            >
              <div className="mx-auto max-w-3xl space-y-6">
                {messages.map((m, i) => (
                  <MessageItem
                    key={m.id}
                    message={m}
                    agent={(m.agentId ? agentMap.get(m.agentId) : undefined) ?? agent ?? undefined}
                    isLast={i === messages.length - 1}
                    streaming={streaming}
                    onRetry={
                      m.role === "assistant" && i === messages.length - 1 && !streaming
                        ? () => void regenerate()
                        : undefined
                    }
                    onEdit={
                      m.role === "user" && !streaming
                        ? (text) => void editAndResend(m.id, text)
                        : undefined
                    }
                    onAnswerAs={
                      m.role === "user" && !streaming && agents.length > 1
                        ? (agentId) => void answerAs(m.id, agentId)
                        : undefined
                    }
                    agents={m.role === "user" ? agents : undefined}
                    speechState={
                      m.role === "assistant" && speech?.msgId === m.id ? speech.state : undefined
                    }
                    speechRate={
                      m.role === "assistant" && speech?.msgId === m.id && speech.state === "playing"
                        ? speechRate
                        : undefined
                    }
                    onToggleSpeak={
                      m.role === "assistant" && !streaming && m.status === "done" && m.content
                        ? () => void toggleSpeak(m.id, m.content)
                        : undefined
                    }
                  />
                ))}
              </div>
              <div className="h-2" aria-hidden />
            </div>
            {showJump && (
              <Button
                size="sm"
                onClick={() => scrollToBottom(true)}
                className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 gap-1.5 rounded-full bg-primary text-white shadow-lg shadow-violet-500/30 hover:bg-primary/90"
              >
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                Jump to latest
              </Button>
            )}
          </div>
        )}

        {/* Regenerate bar */}
        {canRegenerate && (
          <div className="flex shrink-0 justify-center pb-1.5 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void regenerate()}
              className="h-7 gap-1.5 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Regenerate response
            </Button>
          </div>
        )}

        {/* Composer */}
        <Composer
          agent={agent}
          streaming={streaming}
          queuedPreview={
            queued && queued.convId === activeId ? queued.text : null
          }
          onSend={(t, atts) => void send(t, atts)}
          onQueue={queueMessage}
          onCancelQueued={cancelQueued}
          onSendQueued={sendQueuedNow}
          onStop={stop}
        />
      </div>
    </div>
  );
}
