"use client";

import * as React from "react";
import { HeartPulse, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AgentAvatar } from "@/components/nexus/atoms";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_IDLE_MS,
  HEARTBEAT_INTERVALS,
  HEARTBEAT_MIN_INTERVAL_MS,
  MAX_CONTEXT_MESSAGES,
} from "@/lib/constants";
import { msgContextText, fmtRel, fmtIn, uid } from "@/lib/helpers";
import { buildMemoryBlock } from "@/lib/memory";
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

// r446: first-output budget for a heartbeat dial. The relay lane carries a
// 60s connect budget, but the browser-direct lane has NO pre-headers budget —
// a silently-hanging endpoint left a beat's promise unsettled forever, and
// since beatInFlight is global, ONE hung dial deadlocked every future
// heartbeat for EVERY conversation (live-witnessed: 83s into a hung dial the
// placeholder was still streaming and the engine was fully locked).
const HEARTBEAT_FIRST_OUTPUT_MS = 90_000;

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

  // r446: arm the budget on our own signal. Past the budget a still-silent
  // dial aborts bare — user-intent classification, so the direct lane
  // rethrows instead of rotating to the relay — and the r445 truncation
  // path removes the placeholder. The first streamed token disarms the
  // timer so a legitimately long beat is never killed mid-flight.
  const dialCtl = new AbortController();
  let sawOutput = false;
  const dialTimer = window.setTimeout(() => {
    if (!sawOutput) dialCtl.abort();
  }, HEARTBEAT_FIRST_OUTPUT_MS);
  try {
    const result = await runAgentChat(
      {
        provider: llm.provider,
        apiKey: llm.apiKey,
        baseUrl: llm.baseUrl,
        model: llm.model,
        // r317: forward the registry id — heartbeat is a RECURRING runner;
        // without it its 429s/successes never reached the shared exhaustion
        // memory (note/reset) and r25 primary-hop stamping stayed inert.
        providerId: llm.providerId,
        temperature: agent.temperature,
        maxIterations: agent.maxIterations,
        system: agent.instructions + buildMemoryBlock(conv.memory) + "\n\n" + HEARTBEAT_SYSTEM,
        tools: agent.tools,
        messages: history,
        signal: dialCtl.signal,
      },
      {
        onToken: () => {
          sawOutput = true;
        },
      }
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
      transport: result.transport,
    });
    toast(`⏱ ${agent.name} checked in`, {
      description: `${conv.title} — heartbeat follow-up posted.`,
    });
  } catch (err) {
    if (isAbortError(err) || dialCtl.signal.aborted) {
      // r445: isAbortError is a TRANSPORT classifier — it also matches the
      // engine's own connect/first-token budgets (see chat-client v9/v10
      // notes), not just user intent. Leaving the placeholder streaming here
      // would ghost a live bubble AND lock this chat out of every future
      // beat (the tick skips conversations holding a streaming message).
      // Remove the placeholder exactly like a silent noop beat.
      // r446: also honor our OWN first-output budget abort — the direct lane
      // wraps rejections, so the abort class isn't guaranteed to survive;
      // a budget-aborted beat is a transport hiccup either way and must
      // vanish silently (live-witnessed: it landed as an error bubble).
      useConversationsStore.getState().truncateFrom(conv.id, asstId, true);
    } else {
      useConversationsStore.getState().patchMessage(conv.id, asstId, {
        status: "error",
        error: err instanceof Error ? err.message : "heartbeat failed",
      });
    }
  } finally {
    window.clearTimeout(dialTimer);
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
  // r445: mirror the ENGINE's real gate — it fires when BOTH (last-beat
  // baseline + interval) and (updatedAt + idle window) have elapsed, and
  // falls back to conv.updatedAt as the baseline when no beat has landed
  // yet. The old "—" for a never-beaten chat hid a schedule the engine
  // already had; compute the exact implied fire time instead.
  const baseline = last ?? conv.updatedAt;
  const nextAt = Math.max(
    baseline + Math.max(interval, HEARTBEAT_MIN_INTERVAL_MS),
    conv.updatedAt + HEARTBEAT_IDLE_MS
  );

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
