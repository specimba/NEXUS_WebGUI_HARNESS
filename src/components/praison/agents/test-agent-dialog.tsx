"use client";

import * as React from "react";
import { Check, Loader2, SendHorizontal, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AgentAvatar, ModelBadge } from "@/components/praison/atoms";
import { MarkdownRenderer } from "@/components/praison/markdown";
import { TOOL_META } from "@/lib/constants";
import { fmtMs, uid } from "@/lib/helpers";
import { isAbortError, runAgentChat } from "@/lib/chat-client";
import { mcpRunParams } from "@/lib/mcp";
import { resolveLlm } from "@/lib/llm-config";
import { buildRelayWire } from "@/lib/relay";
import { HARNESS_PRESETS, harnessById } from "@/lib/harness";
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
  // r39 conversation-side A/B: the playground gets its own harness selection
  // (seeded from the global setting) so you can probe how an agent behaves
  // under Fast vs Deep Research WITHOUT moving the global default.
  const [harnessId, setHarnessId] = React.useState<string>(
    useSettingsStore.getState().settings.activeHarness ?? "balanced"
  );

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

    const history = base
      .filter((m) => m.role === "user" || m.content.trim().length > 0)
      .slice(-12)
      .map((m) => ({ role: m.role, content: m.content }));

    const settings = useSettingsStore.getState().settings;
    const controller = new AbortController();
    abortRef.current = controller;

    const patchAssistant = (patch: Partial<TestMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));

    try {
      const llm = resolveLlm(settings, agent.model);
      // r39: harness knobs ride the playground exactly like chat + pipelines —
      // relay bias, tool budget and stall resilience are the same three dials.
      const harness = harnessById(harnessId);
      const relayHops = settings.relayEnabled === false || llm.provider === "auto"
        ? []
        : buildRelayWire(settings, { providerId: llm.providerId, model: llm.model ?? "" }, {
            taskFit: harness.knobs.taskFit,
            freeFirst: harness.knobs.freeFirst,
          });
      const result = await runAgentChat(
        {
          provider: llm.provider,
          apiKey: llm.apiKey,
          baseUrl: llm.baseUrl,
          model: llm.model,
          temperature: agent.temperature,
          maxIterations: agent.maxIterations + harness.knobs.maxIterationsBonus,
          ...(harness.knobs.stallResumes !== 2 ? { stallResumes: harness.knobs.stallResumes } : {}),
          system: agent.instructions || undefined,
          messages: history,
          tools: agent.tools,
          // r38 MCP: agent test dialog honors MCP tools too.
          ...mcpRunParams(settings),
          // r40 MRTR: the playground is interactive — input_required opens the gate.
          mcpInteractive: true,
          ...(relayHops.length > 0 ? { relay: relayHops } : {}),
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
        });
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
      setStatusText("");
    }
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
          {/* r39 conversation-side A/B: harness picker local to the playground. */}
          <Select
            value={harnessId}
            onValueChange={(id) => {
              const preset = harnessById(id);
              setHarnessId(preset.id);
              toast(`${preset.glyph} ${preset.name} harness in playground`, {
                description: `${preset.tagline} — affects this dialog only, not the global default.`,
              });
            }}
            aria-label="Playground harness"
          >
            <SelectTrigger
              className="h-8 w-[150px] shrink-0 gap-1.5 text-xs sm:w-[168px]"
              title={`Harness: ${harnessById(harnessId).name} — ${harnessById(harnessId).tagline}`}
            >
              <span aria-hidden className="text-sm">{harnessById(harnessId).glyph}</span>
              <span className="truncate">{harnessById(harnessId).name}</span>
            </SelectTrigger>
            <SelectContent>
              {HARNESS_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id} className="text-xs">
                  <span aria-hidden className="mr-1.5">{p.glyph}</span>
                  {p.name}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{p.tagline}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            messages.map((m) =>
              m.role === "user" ? (
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
                      <div className="flex items-center gap-2 py-0.5">
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
                      <p className={cn("text-xs text-red-500", m.content ? "mt-1.5" : "")}>
                        {m.error}
                      </p>
                    ) : null}
                  </div>
                </div>
              )
            )
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
          <p className="mt-2 text-[11px] text-muted-foreground">
            Runs with your current provider from Settings — messages are not saved. Harness{" "}
            <span className="font-medium text-foreground/80">
              {harnessById(harnessId).glyph} {harnessById(harnessId).name}
            </span>{" "}
            retunes relay order, tool budget and stall retries here only.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
