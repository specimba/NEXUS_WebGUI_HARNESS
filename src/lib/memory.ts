"use client";

import type { Agent, Conversation, Settings } from "./types";
import {
  MEMORY_CONSOLIDATE_EVERY,
  MEMORY_MAX_CHARS,
  MEMORY_SOURCE_MESSAGES,
} from "./constants";
import { runAgentChat } from "./chat-client";
import { useAgentsStore, useConversationsStore, useSettingsStore } from "./stores";

// ─── Hermes-style memory folding ─────────────────────────────────────────────
// A conversation can carry a compact first-person "memory document" that is
// pinned into every future turn's system prompt. It is either written by hand
// or auto-consolidated by a silent LLM pass after enough new activity.

/** The memory block injected into the system prompt ("" when no memory). */
export function buildMemoryBlock(
  memory: Conversation["memory"],
  fallbackPrefix = "CONVERSATION MEMORY"
): string {
  if (!memory?.text?.trim()) return "";
  return `\n\n--- ${fallbackPrefix} (durable context — always apply) ---\n${memory.text.trim()}\n--- end memory ---`;
}

/** Number of assistant replies produced since the last consolidation pass. */
export function repliesSinceConsolidation(conv: Conversation): number {
  const assistantCount = conv.messages.filter(
    (m) => m.role === "assistant" && (m.status === "done" || m.status === "stopped")
  ).length;
  const baseline = conv.memory?.atMessageCount ?? 0;
  return Math.max(0, assistantCount - baseline);
}

/** True when the conversation crossed the auto-consolidation threshold. */
export function shouldAutoConsolidate(conv: Conversation): boolean {
  if (conv.messages.length < 4) return false;
  return repliesSinceConsolidation(conv) >= MEMORY_CONSOLIDATE_EVERY;
}

/** Trim a consolidated doc to the budget (line-aware). */
function trimMemory(text: string): string {
  const clean = text.trim();
  if (clean.length <= MEMORY_MAX_CHARS) return clean;
  const cut = clean.slice(0, MEMORY_MAX_CHARS);
  const lastLine = cut.lastIndexOf("\n");
  return (lastLine > MEMORY_MAX_CHARS * 0.6 ? cut.slice(0, lastLine) : cut) + "\n…";
}

const CONSOLIDATION_SYSTEM =
  "You are a memory consolidation engine for an AI assistant. " +
  "You will receive the recent transcript of a conversation (and its previous memory document, if any). " +
  "Write an UPDATED memory document in FIRST PERSON from the assistant's point of view " +
  '(e.g. "The user is building…", "We decided…", "They prefer…"). ' +
  "Keep it under 150 words. Preserve durable facts (goals, decisions, preferences, names, constraints, open threads), " +
  "drop chit-chat and resolved questions. Merge with the previous memory instead of repeating it. " +
  "Output ONLY the memory document text — no preamble, no quotes, no markdown headers.";

/**
 * Run a silent consolidation pass and return the new memory doc.
 * Throws on failure — the caller decides how to surface it.
 */
export async function consolidateMemory(
  conv: Conversation,
  agent: Agent | undefined,
  settings: Settings,
  signal?: AbortSignal
): Promise<string> {
  const recent = [...conv.messages]
    .filter((m) => m.status !== "error")
    .slice(-MEMORY_SOURCE_MESSAGES)
    .map((m) => `${m.role === "user" ? (settings.displayName || "User") : `Assistant${m.agentName ? ` (${m.agentName})` : ""}`}: ${m.content.slice(0, 700)}`)
    .join("\n");

  const prev = conv.memory?.text?.trim()
    ? `Previous memory document:\n"""\n${conv.memory.text.trim()}\n"""\n\n`
    : "";

  const result = await runAgentChat(
    {
      provider: settings.provider,
      apiKey: settings.apiKey || undefined,
      baseUrl: settings.baseUrl,
      model: "auto",
      temperature: 0.2,
      maxIterations: 0,
      system: CONSOLIDATION_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${prev}Recent transcript (oldest first):\n"""\n${recent}\n"""\n\nWrite the updated memory document now.`,
        },
      ],
      signal,
    },
    {}
  );
  return trimMemory(result.content);
}

// ─── Consolidation orchestration (shared by the auto trigger + manual button)

const inFlight = new Set<string>();

/** Resolve the agent that "owns" a conversation (stamped → per-chat → fallback). */
function resolveAgent(conv: Conversation): Agent | undefined {
  const store = useAgentsStore.getState();
  const lastAsst = [...conv.messages].reverse().find((m) => m.role === "assistant");
  return store.getById(lastAsst?.agentId ?? conv.agentId ?? undefined) ?? store.getById("a-assistant");
}

/**
 * Fire a consolidation pass for a conversation (deduplicated). Returns the new
 * memory text, or null when skipped/failed. `onDone` gets a human reason.
 */
export async function fireConsolidation(
  convId: string,
  opts: { silent?: boolean; onDone?: (ok: boolean, note: string) => void } = {}
): Promise<string | null> {
  if (inFlight.has(convId)) {
    opts.onDone?.(false, "already running");
    return null;
  }
  const store = useConversationsStore.getState();
  const conv = store.conversations.find((c) => c.id === convId);
  if (!conv || conv.messages.length < 2) {
    opts.onDone?.(false, "not enough messages");
    return null;
  }
  inFlight.add(convId);
  try {
    const settings = useSettingsStore.getState().settings;
    const agent = resolveAgent(conv);
    const text = await consolidateMemory(conv, agent, settings);
    store.setMemory(convId, {
      text,
      updatedAt: Date.now(),
      source: "auto",
      atMessageCount: conv.messages.filter(
        (m) => m.role === "assistant" && (m.status === "done" || m.status === "stopped")
      ).length,
    });
    opts.onDone?.(true, "memory updated");
    return text;
  } catch {
    opts.onDone?.(false, "consolidation failed");
    return null;
  } finally {
    inFlight.delete(convId);
  }
}

/** Threshold check + background pass. Called after a turn settles. */
export function maybeAutoConsolidate(convId: string): void {
  const conv = useConversationsStore.getState().conversations.find((c) => c.id === convId);
  if (!conv || !shouldAutoConsolidate(conv) || inFlight.has(convId)) return;
  void fireConsolidation(convId, {
    onDone: (ok, note) => {
      if (ok) {
        // Subtle — this is a background hygiene pass, not a headline event.
        console.info(`[memory] ${note} for ${conv.title}`);
      }
    },
  });
}

/** True while a consolidation pass is running for this conversation. */
export function isConsolidating(convId: string): boolean {
  return inFlight.has(convId);
}
