"use client";

import * as React from "react";
import { Check, Loader2, RotateCcw, SendHorizontal, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AgentAvatar, ModelBadge } from "@/components/praison/atoms";
import { MarkdownRenderer } from "@/components/praison/markdown";
import { TOOL_META } from "@/lib/constants";
import { fmtMs, uid } from "@/lib/helpers";
import { isAbortError, runAgentChat } from "@/lib/chat-client";
import { resolveLlm } from "@/lib/llm-config";
import { useSettingsStore } from "@/lib/stores";
import type { Agent, ToolCallInfo, ToolId } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─── Test playground dialog (accepts persisted or pseudo agents) ─────────────

interface TestMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCallInfo[];
  status: "streaming" | "done" | "error" | "stopped";
  error?: string;
  /** r163: structured upstream error kind from the SSE error event (the
   *  same classification chat and the workflow runner already get) — the
   *  playground previously dropped it, rendering bare prose. */
  kind?: string;
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1" aria-label="Agent is responding">
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
    </span>
  );
}

function ToolChip({ call }: { call: ToolCallInfo }) {
  const meta = TOOL_META[call.name as ToolId];
  const label = meta?.label ?? call.name;
  const emoji = meta?.emoji ?? "🔧";
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-1 text-[11px] text-muted-foreground">
      <span aria-hidden>{emoji}</span>
      <span className="truncate font-medium text-foreground/80">{label}</span>
      {call.ok == null ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-label="running" />
      ) : call.ok ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-500" aria-label="ok" />
      ) : (
        <X className="h-3 w-3 shrink-0 text-red-500" aria-label="failed" />
      )}
      {call.ok != null && call.ms != null ? (
        <span className="shrink-0 tabular-nums">{fmtMs(call.ms)}</span>
      ) : null}
    </span>
  );
}

/** r163: structured-kind chip for errored turns. rate-limit gets the amber
 *  congestion treatment (pipelines park-and-resume on the same failure —
 *  r158); other kinds stay neutral — the kind name is the honest signal. */
function KindChip({ kind }: { kind: string }) {
  const rateLimited = kind === "rate-limit";
  return (
    <span
      title={
        rateLimited
          ? "The shared gateway is congested — scheduled pipelines park and auto-resume on this same failure. See the workflows view for the live gateway pulse."
          : `Upstream error kind reported by the engine: ${kind}`
      }
      className={cn(
        "mt-1.5 inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        rateLimited
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          : "border-border bg-muted/40 text-muted-foreground"
      )}
    >
      {kind}
    </span>
  );
}

export function TestAgentDialog({
  open,
  onOpenChange,
  agent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: Agent | null;
}) {
  const [messages, setMessages] = React.useState<TestMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [running, setRunning] = React.useState(false);
  const [statusText, setStatusText] = React.useState("");

  // r463 (extended r464): honest pre-flight for the composer footer. The
  // resolver NEVER hands back a keyed-provider-without-key lane — it degrades
  // to the built-in Auto engine with an honest `fallbackNote` — and chat-view
  // (toast) plus workflows-view (tooltip) both surface that note; the
  // playground was the only surface silently riding the degraded lane. The
  // memo now returns: null (keyed, or sanctioned keyless custom+baseUrl),
  // the resolver's own fallbackNote (degraded lane), or a truly-broken legacy
  // lane (custom endpoint with neither key nor URL). The dial still proceeds
  // (r315 doctrine — the engine's error stays ground truth).
  const liveSettings = useSettingsStore((s) => s.settings);
  const lane = React.useMemo(() => {
    if (!open || !agent) return null;
    const llm = resolveLlm(liveSettings, agent.model);
    if (llm.fallbackNote) return { kind: "fallback" as const, text: llm.fallbackNote };
    if (!llm.apiKey && !(llm.provider === "custom" && llm.baseUrl?.trim())) {
      return { kind: "missing" as const, text: `${llm.provider} · ${llm.model ?? "?"}` };
    }
    return { kind: "ok" as const, label: llm.label };
  }, [open, agent, liveSettings]);

  const abortRef = React.useRef<AbortController | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);

  // Fresh playground each time the dialog opens / target changes.
  React.useEffect(() => {
    if (!open) return;
    setMessages([]);
    setInput("");
    setStatusText("");
    setRunning(false);
  }, [open, agent]);

  // Auto-grow composer.
  React.useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  // Keep the latest message in view while streaming.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      abortRef.current?.abort();
      abortRef.current = null;
      setRunning(false);
    }
    onOpenChange(next);
  };

  const stop = () => abortRef.current?.abort();

  /** The engine call + turn patching, shared by send and retry (r163). */
  const runTurn = async (
    history: { role: "user" | "assistant"; content: string }[],
    assistantId: string,
    controller: AbortController
  ) => {
    if (!agent) return;
    const patchAssistant = (patch: Partial<TestMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));
    try {
      const settings = useSettingsStore.getState().settings;
      const llm = resolveLlm(settings, agent.model);
      const result = await runAgentChat(
        {
          provider: llm.provider,
          apiKey: llm.apiKey,
          baseUrl: llm.baseUrl,
          model: llm.model,
          // r317: registry id for the shared 429 memory + rotator stamping.
          providerId: llm.providerId,
          temperature: agent.temperature,
          maxIterations: agent.maxIterations,
          system: agent.instructions || undefined,
          messages: history,
          tools: agent.tools,
          signal: controller.signal,
        },
        {
          onStatus: (message) => setStatusText(message),
          onToken: (t) => {
            setStatusText("");
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + t } : m))
            );
          },
          onToolCall: (call) => {
            setStatusText("Using tools…");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolCalls: [
                        ...m.toolCalls,
                        { id: call.id, name: call.name, args: call.args },
                      ],
                    }
                  : m
              )
            );
          },
          onToolResult: (res) =>
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      toolCalls: m.toolCalls.map((tc) =>
                        tc.id === res.id ? { ...tc, ok: res.ok, ms: res.ms, result: res.content } : tc
                      ),
                    }
                  : m
              )
            ),
        }
      );
      patchAssistant({ content: result.content, status: "done" });
    } catch (err) {
      if (isAbortError(err)) {
        patchAssistant({ status: "stopped" });
      } else {
        patchAssistant({
          status: "error",
          error: err instanceof Error ? err.message : "Something went wrong.",
          kind: (err as Error & { kind?: string })?.kind,
        });
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
      setStatusText("");
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || running || !agent) return;

    const userMsg: TestMessage = {
      id: uid("tmsg"),
      role: "user",
      content: text,
      toolCalls: [],
      status: "done",
    };
    const assistantId = uid("tmsg");
    const base = [...messages, userMsg];
    const assistantMsg: TestMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      toolCalls: [],
      status: "streaming",
    };
    setMessages([...base, assistantMsg]);
    setInput("");
    setRunning(true);
    setStatusText("Thinking…");

    const controller = new AbortController();
    abortRef.current = controller;
    await runTurn(base.filter((m) => m.role === "user" || m.content.trim().length > 0).slice(-12), assistantId, controller);
  };

  /** r163: one-click retry of an errored turn — the playground previously
   *  dead-ended (composer already cleared; the user had to retype). Re-runs
   *  the SAME user message, replacing the errored assistant turn. */
  const retry = async () => {
    if (running || !agent) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.status !== "error") return;
    const lastUser = [...messages]
      .slice(0, -1)
      .reverse()
      .find((m) => m.role === "user");
    if (!lastUser) return;

    const base = messages.slice(0, -1); // drop the errored assistant turn
    const assistantId = uid("tmsg");
    const assistantMsg: TestMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      toolCalls: [],
      status: "streaming",
    };
    setMessages([...base, assistantMsg]);
    setRunning(true);
    setStatusText("Thinking…");

    const controller = new AbortController();
    abortRef.current = controller;
    await runTurn(base.filter((m) => m.role === "user" || m.content.trim().length > 0).slice(-12), assistantId, controller);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-4 py-3.5 pr-12">
          <AgentAvatar agent={agent} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <DialogTitle className="truncate text-base">
                {agent?.name ?? "Test agent"}
              </DialogTitle>
              {agent ? <ModelBadge model={agent.model} /> : null}
            </div>
            <DialogDescription className="text-xs">Test playground</DialogDescription>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <AgentAvatar agent={agent} size="lg" />
              <p className="max-w-xs text-sm text-muted-foreground">
                Send a message to watch{" "}
                <span className="font-medium text-foreground">{agent?.name ?? "this agent"}</span>{" "}
                reason, call tools and respond.
              </p>
            </div>
          ) : (
            messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              return m.role === "user" ? (
                <div
                  key={m.id}
                  className="ml-auto max-w-[80%] whitespace-pre-wrap break-words rounded-2xl bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                >
                  {m.content}
                </div>
              ) : (
                <div key={m.id} className="max-w-[90%] space-y-2">
                  {m.toolCalls.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {m.toolCalls.map((tc) => (
                        <ToolChip key={tc.id} call={tc} />
                      ))}
                    </div>
                  ) : null}
                  <div className="rounded-2xl border bg-muted/50 px-3.5 py-2">
                    {m.content ? (
                      <MarkdownRenderer content={m.content} className="text-[13.5px]" />
                    ) : m.status === "streaming" ? (
                      // r418 survey: the status line was visual-only — a live
                      // region so "Thinking…" / "Using tools…" reaches screen
                      // readers (parity with r417's radar count-line sweep).
                      <div
                        className="flex items-center gap-2 py-0.5"
                        role="status"
                        aria-live="polite"
                      >
                        <TypingDots />
                        {statusText ? (
                          <span className="text-xs text-muted-foreground">{statusText}</span>
                        ) : null}
                      </div>
                    ) : null}
                    {m.status === "stopped" ? (
                      <p
                        className={cn(
                          "text-xs italic text-muted-foreground",
                          m.content ? "mt-1.5" : ""
                        )}
                      >
                        (stopped)
                      </p>
                    ) : null}
                    {m.status === "error" && m.error ? (
                      <div className={m.content ? "mt-1.5" : ""}>
                        {/* r418 survey: role=alert — failures announce on render
                            instead of being a silent red line for SR users. */}
                        <p role="alert" className="text-xs text-red-500">{m.error}</p>
                        {m.kind ? <KindChip kind={m.kind} /> : null}
                        {!running && isLast ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void retry()}
                            aria-label="Retry this message"
                            className="mt-1.5 h-7 gap-1.5 px-2 text-[11px]"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <div className="border-t px-4 py-3">
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  // r244: parity with the chat composer (r993) — Enter that
                  // only CONFIRMS an IME composition (CJK input) must not
                  // send the half-composed text.
                  if (e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={`Message ${agent?.name ?? "agent"}… (Enter to send, Shift+Enter for newline)`}
              aria-label="Test message"
              disabled={!agent}
              className="max-h-[132px] min-h-[40px] flex-1 resize-none py-2.5"
            />
            {running ? (
              <Button
                type="button"
                variant="destructive"
                size="icon"
                aria-label="Stop run"
                onClick={stop}
                className="shrink-0"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                aria-label="Send message"
                disabled={!input.trim() || !agent}
                onClick={() => void send()}
                className="shrink-0"
              >
                <SendHorizontal className="h-4 w-4" />
              </Button>
            )}
          </div>
          {lane ? (
            lane.kind === "ok" ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Runs with <span className="font-medium text-foreground/75">{lane.label}</span> from
                Settings — messages are not saved.
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400" role="status">
                {lane.kind === "fallback"
                  ? lane.text
                  : `No API key resolved for this lane (${lane.text}) — add one in Settings → Providers or pick a keyless custom engine. Sending will fail with an auth error.`}
              </p>
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
