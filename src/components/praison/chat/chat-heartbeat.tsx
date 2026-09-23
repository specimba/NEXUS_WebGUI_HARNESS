"use client";

import * as React from "react";
import { HeartPulse, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AgentAvatar } from "@/components/praison/atoms";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_IDLE_MS,
  HEARTBEAT_INTERVALS,
  HEARTBEAT_MIN_INTERVAL_MS,
  MAX_CONTEXT_MESSAGES,
} from "@/lib/constants";
import { msgContextText, fmtRel, fmtIn, uid } from "@/lib/helpers";
import { buildMemoryBlock } from "@/lib/memory";
import { mcpRunParams } from "@/lib/mcp";
import { isAbortError, runAgentChat } from "@/lib/chat-client";
import { resolveLlm } from "@/lib/llm-config";
import {
  useAgentsStore,
  useConversationsStore,
  useSettingsStore,
  useUiStore,
} from "@/lib/stores";
import type { ChatMessage, Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─── Hermes-style conversation heartbeat ─────────────────────────────────────
// An opt-in per-chat loop: while the tab is open, an idle watched conversation
// wakes its agent on an interval. The agent reviews the thread and posts a
// short proactive follow-up — or stays silent ("<noop>") if it has nothing
// of value to add. Re-arm happens BEFORE firing; one beat at a time globally.

const HEARTBEAT_NOOP = "<noop>";

const HEARTBEAT_SYSTEM = `
HEARTBEAT CHECK-IN: this is a proactive wake-up, not a reply to a user message.
Review the conversation above. If you have something genuinely valuable to add —
a progress nudge, fresh relevant information (you may use your tools), or a very
concise recap of open threads — write 1-3 short sentences. Do not pad, do not
repeat earlier points, do not ask the user to confirm you are working.
If there is truly nothing useful to say, reply with exactly: ${HEARTBEAT_NOOP}`.trim();

let beatInFlight = false;

function resolveAgent(conv: Conversation) {
  const store = useAgentsStore.getState();
  const lastAsst = [...conv.messages].reverse().find((m) => m.role === "assistant");
  return store.getById(lastAsst?.agentId ?? conv.agentId ?? undefined) ?? store.getById("a-assistant");
}

/** Fire one proactive beat for a conversation (best-effort, silent on noop). */
async function fireBeat(conv: Conversation): Promise<void> {
  const store = useConversationsStore.getState();
  const agent = resolveAgent(conv);
  if (!agent || conv.messages.length === 0) return;

  const settings = useSettingsStore.getState().settings;
  const history = conv.messages
    .filter((m) => m.status === "done" || m.role === "user")
    .map((m) => ({ role: m.role, content: msgContextText(m) }))
    .slice(-MAX_CONTEXT_MESSAGES);
  if (history.length === 0) return;
  const llm = resolveLlm(settings, agent.model);

  const asstId = uid("msg");
  const placeholder: ChatMessage = {
    id: asstId,
    role: "assistant",
    content: "",
    agentId: agent.id,
    agentName: agent.name,
    createdAt: Date.now(),
    toolCalls: [],
    status: "streaming",
    heartbeat: true,
  };
  store.appendMessage(conv.id, placeholder);

  try {
    const result = await runAgentChat(
      {
        provider: llm.provider,
        apiKey: llm.apiKey,
        baseUrl: llm.baseUrl,
        model: llm.model,
        temperature: agent.temperature,
        maxIterations: agent.maxIterations,
        system: agent.instructions + buildMemoryBlock(conv.memory) + "\n\n" + HEARTBEAT_SYSTEM,
        tools: agent.tools,
        // r38 MCP: heartbeat turns can drive MCP tools too.
        ...mcpRunParams(settings),
        messages: history,
      },
      {}
    );
    const text = result.content.trim();
    if (!text || text === HEARTBEAT_NOOP || text.startsWith(HEARTBEAT_NOOP)) {
      // Silent beat — remove the placeholder entirely.
      useConversationsStore.getState().truncateFrom(conv.id, asstId, true);
      return;
    }
    useConversationsStore.getState().patchMessage(conv.id, asstId, {
      content: result.content,
      toolCalls: result.toolCalls,
      status: "done",
      durationMs: undefined,
      model: agent.model,
    });
    toast(`⏱ ${agent.name} checked in`, {
      description: `${conv.title} — heartbeat follow-up posted.`,
    });
  } catch (err) {
    // Silent failure on aborts; surface anything else briefly.
    if (!isAbortError(err)) {
      useConversationsStore.getState().patchMessage(conv.id, asstId, {
        status: "error",
        error: err instanceof Error ? err.message : "heartbeat failed",
      });
    }
  }
}

/**
 * Global tick loop — mounted once in page.tsx. Fires due heartbeats for any
 * watched conversation (not just the active one) while the tab is visible
 * and the harness is otherwise idle.
 */
export function HeartbeatEngine() {
  React.useEffect(() => {
    const tick = () => {
      if (beatInFlight || document.hidden) return;
      if (useUiStore.getState().busy) return; // a chat/workflow turn is running

      const now = Date.now();
      const store = useConversationsStore.getState();
      for (const conv of store.conversations) {
        const hb = conv.heartbeat;
        if (!hb?.enabled) continue;
        const interval = Math.max(hb.intervalMs, HEARTBEAT_MIN_INTERVAL_MS);
        const last = hb.lastBeatAt ?? conv.updatedAt;
        if (now - last < interval) continue;
        if (now - conv.updatedAt < HEARTBEAT_IDLE_MS) continue;
        if (conv.messages.some((m) => m.status === "streaming")) continue;

        // Re-arm first — never double-fire.
        beatInFlight = true;
        store.setHeartbeat(conv.id, { ...hb, lastBeatAt: now });
        void fireBeat(conv).finally(() => {
          beatInFlight = false;
        });
        break; // one beat per tick, keep the cadence gentle
      }
    };
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, []);
  return null;
}

// ─── Header control (enable / interval / status) ─────────────────────────────

interface HeartbeatButtonProps {
  conv: Conversation | null;
  disabled?: boolean;
}

export function HeartbeatButton({ conv, disabled }: HeartbeatButtonProps) {
  const [open, setOpen] = React.useState(false);
  const setHeartbeat = useConversationsStore((s) => s.setHeartbeat);
  const [, force] = React.useReducer((n) => n + 1, 0);

  // Live next-beat countdown while the popover is open
  React.useEffect(() => {
    if (!open) return;
    const id = window.setInterval(force, 5000);
    return () => window.clearInterval(id);
  }, [open]);

  if (!conv) return null;
  const hb = conv.heartbeat;
  const enabled = Boolean(hb?.enabled);
  const agent = resolveAgent(conv);
  const interval = hb?.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const last = hb?.lastBeatAt;
  const nextAt = last ? last + Math.max(interval, HEARTBEAT_MIN_INTERVAL_MS) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Conversation heartbeat"
          title={enabled ? "Heartbeat on — proactive check-ins" : "Heartbeat — proactive check-ins"}
          disabled={disabled}
          className={cn(
            "relative transition-colors hover:text-violet-400",
            enabled && "text-violet-400"
          )}
        >
          {enabled && (
            <span
              className="heart-ping absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-violet-400 text-violet-400"
              aria-hidden
            />
          )}
          <HeartPulse className="h-[18px] w-[18px]" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-violet-400" aria-hidden />
              <span className="text-sm font-semibold">Heartbeat</span>
            </div>
            <Switch
              checked={enabled}
              aria-label="Enable heartbeat"
              onCheckedChange={(v) => {
                setHeartbeat(conv.id, {
                  enabled: v,
                  intervalMs: interval,
                  lastBeatAt: v ? Date.now() : undefined, // grace period on enable
                });
                toast(
                  v ? "Heartbeat started" : "Heartbeat stopped",
                  {
                    icon: v ? "⏱" : "🛑",
                    description: v
                      ? `${agent?.name ?? "The agent"} will check in when this chat goes idle.`
                      : "No more proactive check-ins for this chat.",
                  }
                );
              }}
            />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Hermes-style proactive wake: while the tab is open, the agent reviews this
            thread on an interval and posts a short follow-up — or stays silent when
            there is nothing worth adding.
          </p>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Interval</Label>
            <Select
              value={String(interval)}
              onValueChange={(v) => {
                setHeartbeat(conv.id, {
                  enabled,
                  intervalMs: Number(v),
                  lastBeatAt: hb?.lastBeatAt,
                });
              }}
            >
              <SelectTrigger className="h-8 text-xs" aria-label="Heartbeat interval">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HEARTBEAT_INTERVALS.map((i) => (
                  <SelectItem key={i.ms} value={String(i.ms)} className="text-xs">
                    Every {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 rounded-lg border bg-muted/40 p-2 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Last beat</span>
              <span className="font-medium text-foreground">{last ? fmtRel(last) : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Next check-in</span>
              <span className="font-medium text-foreground">
                {enabled ? fmtIn(nextAt) : "off"}
              </span>
            </div>
          </div>

          {agent && (
            <div className="flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
              <AgentAvatar agent={agent} size="xs" />
              wakes {agent.name} · currently {beatInFlight ? "beating…" : "idle"}
              {beatInFlight && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
