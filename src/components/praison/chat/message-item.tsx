"use client";

import * as React from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Copy,
  FileText,
  Loader2,
  Pencil,
  RotateCcw,
  Users,
  Volume2,
  X,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { AgentAvatar, ModelBadge } from "@/components/praison/atoms";
import { MarkdownRenderer } from "@/components/praison/markdown";
import { TOOL_META } from "@/lib/constants";
import { copyText, fmtBytes, fmtMs, fmtTime } from "@/lib/helpers";
import type { Agent, ChatMessage, MessageAttachment, ToolCallInfo, ToolId } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─── Typing dots (uses the global .typing-dot animation) ─────────────────────
function TypingDots({ className, dotClassName }: { className?: string; dotClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden>
      <span className={cn("typing-dot h-1.5 w-1.5 rounded-full bg-violet-400", dotClassName)} />
      <span className={cn("typing-dot h-1.5 w-1.5 rounded-full bg-violet-400", dotClassName)} />
      <span className={cn("typing-dot h-1.5 w-1.5 rounded-full bg-violet-400", dotClassName)} />
    </span>
  );
}

// ─── Tool call card (collapsible args/result inspector) ──────────────────────
function ToolCallCard({ call }: { call: ToolCallInfo }) {
  const [open, setOpen] = React.useState(false);
  const meta = TOOL_META[call.name as ToolId];
  const label = meta?.label ?? call.name;
  const emoji = meta?.emoji ?? "🛠️";
  const pending = call.result === undefined;

  const prettyArgs = React.useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(call.args), null, 2);
    } catch {
      return call.args || "{}";
    }
  }, [call.args]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border bg-muted/40"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50">
        <span aria-hidden>{emoji}</span>
        <span className="font-medium">{label}</span>
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" aria-label="Running" />
        ) : call.ok ? (
          <Check className="h-3.5 w-3.5 text-emerald-400" aria-label="Succeeded" />
        ) : (
          <X className="h-3.5 w-3.5 text-destructive" aria-label="Failed" />
        )}
        {call.ms != null && (
          <span className="text-[10px] tabular-nums text-muted-foreground">{fmtMs(call.ms)}</span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2.5 px-3 pb-3 pt-1">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Args
            </div>
            <pre className="mt-1 max-h-32 overflow-auto rounded-md border bg-background/70 p-2 font-mono text-[11px] leading-relaxed">
              {prettyArgs}
            </pre>
          </div>
          {call.result !== undefined && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Result
              </div>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                {call.result || "(empty result)"}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Equalizer (read-aloud playing indicator) ───────────────────────────────
function Equalizer({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-3.5 items-center gap-[2.5px]", className)} aria-hidden>
      <span className="eq-bar h-3" style={{ animationDelay: "-0.45s" }} />
      <span className="eq-bar h-3" style={{ animationDelay: "-0.2s" }} />
      <span className="eq-bar h-3" style={{ animationDelay: "-0.32s" }} />
    </span>
  );
}

// ─── Image lightbox (click a thumbnail in a user bubble) ───────────────────
function ImageLightbox({
  att,
  onClose,
}: {
  att: MessageAttachment | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!att} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl gap-3 p-3">
        {att && (
          <>
            <DialogTitle className="truncate pr-6 text-sm font-semibold">{att.name}</DialogTitle>
            <DialogDescription className="sr-only">
              Attached image preview, {fmtBytes(att.size)}
            </DialogDescription>
            { }
            <img
              src={att.content}
              alt={att.name}
              className="max-h-[68vh] w-full rounded-xl border bg-muted/30 object-contain"
            />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="tabular-nums">{fmtBytes(att.size)} · JPEG preview</span>
              <span>Click outside or press Esc to close</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── User bubble (with hover toolbar + inline edit-and-resend) ─────────────
function UserBubble({
  message,
  onEdit,
  onAnswerAs,
  agents,
}: {
  message: ChatMessage;
  onEdit?: (newText: string) => void;
  onAnswerAs?: (agentId: string) => void;
  agents?: Agent[];
}) {
  const [copied, setCopied] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(message.content);
  const [lightbox, setLightbox] = React.useState<MessageAttachment | null>(null);
  const editRef = React.useRef<HTMLTextAreaElement | null>(null);

  const textAtts = React.useMemo(
    () => (message.attachments ?? []).filter((a) => a.kind !== "image"),
    [message.attachments]
  );
  const imageAtts = React.useMemo(
    () => (message.attachments ?? []).filter((a) => a.kind === "image"),
    [message.attachments]
  );

  const handleCopy = React.useCallback(async () => {
    const ok = await copyText(message.content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [message.content]);

  const startEdit = React.useCallback(() => {
    setDraft(message.content);
    setEditing(true);
    requestAnimationFrame(() => {
      const el = editRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, [message.content]);

  const save = React.useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.content) {
      setEditing(false);
      return;
    }
    setEditing(false);
    onEdit?.(trimmed);
  }, [draft, message.content, onEdit]);

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-2">
        <div className="w-full max-w-[85%] rounded-2xl rounded-br-md border border-violet-500/40 bg-card p-3 shadow-md shadow-violet-500/10 ring-2 ring-violet-500/20">
          <textarea
            ref={editRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            rows={Math.min(8, Math.max(2, draft.split("\n").length))}
            aria-label="Edit message"
            className="w-full resize-none bg-transparent text-[14.5px] leading-relaxed outline-none placeholder:text-muted-foreground"
            placeholder="Edit your message…"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <span className="mr-auto text-[10px] text-muted-foreground">
              Enter to resend · Esc to cancel
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              className="h-7 px-2.5 text-xs"
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={!draft.trim()} className="h-7 gap-1.5 px-3 text-xs">
              <RotateCcw className="h-3 w-3" aria-hidden />
              Save &amp; resend
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/msg flex items-end justify-end gap-2">
      <div
        className={cn(
          "mb-1 flex items-center gap-0.5 rounded-full border bg-card/90 p-0.5 shadow-sm transition-opacity duration-150",
          "opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100"
        )}
        role="toolbar"
        aria-label="Message actions"
      >
        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy message"
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={startEdit}
            aria-label="Edit and resend message"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {onAnswerAs && agents && agents.length > 1 && (
          <>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Answer with a different agent"
                  title="Answer as…"
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Users className="h-3.5 w-3.5" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Answer as…
                </DropdownMenuLabel>
                {agents.map((a) => (
                  <DropdownMenuItem
                    key={a.id}
                    onSelect={() => onAnswerAs(a.id)}
                    className="gap-2"
                  >
                    <span
                      aria-hidden
                      className="flex h-4 w-4 shrink-0 items-center justify-center text-[11px] leading-none"
                    >
                      {a.emoji}
                    </span>
                    <span className="truncate">{a.name}</span>
                    {a.role ? (
                      <span className="ml-auto hidden truncate text-[10px] text-muted-foreground sm:inline">
                        {a.role}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
      <div className="max-w-[85%]">
        <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-br from-primary to-violet-600 px-4 py-2.5 text-[14.5px] text-primary-foreground shadow-md shadow-violet-500/20">
          {message.content}
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <>
            {imageAtts.length > 0 && (
              <div
                className="mt-1.5 flex flex-wrap justify-end gap-1.5"
                role="list"
                aria-label="Attached images"
              >
                {imageAtts.map((a) => (
                  <button
                    key={a.name}
                    type="button"
                    role="listitem"
                    onClick={() => setLightbox(a)}
                    aria-label={`View image ${a.name}`}
                    title={`${a.name} · click to enlarge`}
                    className="group/img relative overflow-hidden rounded-xl border border-violet-500/30 shadow-sm transition-all duration-200 hover:scale-[1.03] hover:border-violet-500/60 hover:shadow-md hover:shadow-violet-500/20"
                  >
                    { }
                    <img
                      src={a.content}
                      alt={a.name}
                      className="h-20 w-20 object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/75 to-transparent px-1.5 pb-0.5 pt-3 text-[9px] font-medium text-white opacity-0 transition-opacity group-hover/img:opacity-100">
                      {a.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {textAtts.length > 0 && (
              <div
                className="mt-1.5 flex flex-wrap justify-end gap-1.5"
                role="list"
                aria-label="Attached files"
              >
                {textAtts.map((a) => (
                  <span
                    key={a.name}
                    role="listitem"
                    title={`${a.name} · ${fmtBytes(a.size)}`}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-violet-500/25 bg-violet-500/10 py-1 pl-2 pr-2 text-[11px] text-foreground/90"
                  >
                    <FileText className="h-3 w-3 shrink-0 text-violet-400" aria-hidden />
                    <span className="max-w-36 truncate font-medium">{a.name}</span>
                    <span className="shrink-0 tabular-nums text-[9px] text-muted-foreground">
                      {fmtBytes(a.size)}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        <ImageLightbox att={lightbox} onClose={() => setLightbox(null)} />
      </div>
    </div>
  );
}

// ─── Assistant message ───────────────────────────────────────────────────────
export interface MessageItemProps {
  message: ChatMessage;
  agent?: Agent | null;
  isLast: boolean;
  streaming: boolean;
  /** Offered on the last assistant message when idle — retries a failed reply. */
  onRetry?: () => void;
  /** Offered on user messages when idle — edits and resends the turn. */
  onEdit?: (newText: string) => void;
  /** Offered on user messages when idle — re-runs the turn with a chosen agent. */
  onAnswerAs?: (agentId: string) => void;
  /** Roster for the "Answer as…" picker. */
  agents?: Agent[];
  /** Read-aloud state for THIS assistant message (undefined = not playing). */
  speechState?: "loading" | "playing";
  /** Current playback rate while playing — shown as a badge when ≠ 1. */
  speechRate?: number;
  /** Toggles read-aloud for this assistant message. */
  onToggleSpeak?: () => void;
}

export const MessageItem = React.memo(function MessageItem({
  message,
  agent,
  isLast,
  streaming,
  onRetry,
  onEdit,
  onAnswerAs,
  agents,
  speechState,
  speechRate,
  onToggleSpeak,
}: MessageItemProps) {
  const [copied, setCopied] = React.useState(false);

  const isUser = message.role === "user";
  const isStreamingNow = message.status === "streaming" && streaming;
  const showTypingBubble =
    !isUser && isStreamingNow && isLast && !message.content && message.toolCalls.length === 0;

  const handleCopy = React.useCallback(async () => {
    const ok = await copyText(message.content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [message.content]);

  if (isUser) {
    return (
      <div data-msg-id={message.id}>
        <UserBubble
          message={message}
          onEdit={onEdit}
          onAnswerAs={onAnswerAs}
          agents={agents}
        />
      </div>
    );
  }

  const displayName = message.agentName ?? agent?.name ?? "Assistant";
  const showStats =
    !isStreamingNow && message.status !== "streaming" && message.durationMs != null;

  return (
    <div className="group/msg flex gap-3" data-msg-id={message.id}>
      <AgentAvatar
        agent={agent ?? undefined}
        size="sm"
        className={cn(
          "mt-0.5 transition-shadow duration-300",
          isStreamingNow &&
            "ring-2 ring-violet-500/50 shadow-[0_0_16px_oklch(0.606_0.25_292.717/0.45)]"
        )}
      />
      <div className="min-w-0 flex-1">
        {/* Header: name · model · time · duration · status */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold">{displayName}</span>
          <ModelBadge model={agent?.model ?? "auto"} />
          <span className="text-[11px] text-muted-foreground">{fmtTime(message.createdAt)}</span>
          {showStats && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground/80"
              title={`Responded in ${fmtMs(message.durationMs)}`}
            >
              <Clock className="h-2.5 w-2.5" aria-hidden />
              {fmtMs(message.durationMs)}
            </span>
          )}
          {isStreamingNow && <TypingDots dotClassName="h-1 w-1" />}
          {message.status === "stopped" && (
            <span className="text-xs font-medium text-amber-400">(stopped)</span>
          )}
          {message.status === "error" && (
            <AlertTriangle className="h-3.5 w-3.5 text-red-400" aria-label="Message failed" />
          )}
          {message.status === "done" && message.content ? (
            <>
              {onToggleSpeak && (
                <button
                  type="button"
                  onClick={onToggleSpeak}
                  aria-label={
                    speechState === "playing"
                      ? "Stop reading aloud"
                      : speechState === "loading"
                        ? "Generating audio…"
                        : "Read this reply aloud"
                  }
                  title={
                    speechState === "playing"
                      ? "Stop reading aloud"
                      : "Read this reply aloud"
                  }
                  className={cn(
                    "ml-0.5 rounded p-0.5 opacity-0 transition-all hover:text-violet-400 focus-visible:opacity-100 group-hover/msg:opacity-100",
                    speechState === "playing" && "text-violet-400 opacity-100",
                    speechState === "loading" && "text-violet-400/70 opacity-100"
                  )}
                >
                  {speechState === "loading" ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : speechState === "playing" ? (
                    <span className="inline-flex items-center gap-1">
                      <Equalizer />
                      {speechRate != null && speechRate !== 1 && (
                        <span
                          className="rounded-full border border-violet-500/30 bg-violet-500/10 px-1 text-[9px] font-semibold tabular-nums text-violet-400"
                          aria-label={`Playback speed ${speechRate}×`}
                        >
                          {speechRate}×
                        </span>
                      )}
                    </span>
                  ) : (
                    <Volume2 className="h-3 w-3" aria-hidden />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy message"
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/msg:opacity-100"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-400" aria-hidden />
                ) : (
                  <Copy className="h-3 w-3" aria-hidden />
                )}
              </button>
            </>
          ) : null}
        </div>

        {/* Tool calls */}
        {message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {message.toolCalls.map((call) => (
              <ToolCallCard key={call.id} call={call} />
            ))}
          </div>
        )}

        {/* Typing bubble (nothing streamed yet) */}
        {showTypingBubble && (
          <div className="mt-2 inline-flex items-center rounded-2xl rounded-bl-md border bg-card px-4 py-3.5 shadow-sm">
            <TypingDots />
          </div>
        )}

        {/* Optional reasoning trace */}
        {message.reasoning ? (
          <Collapsible className="mt-2">
            <CollapsibleTrigger className="text-xs italic text-muted-foreground transition-colors hover:text-foreground">
              Thinking…
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-violet-500/30 pl-2.5 text-xs italic leading-relaxed text-muted-foreground">
                {message.reasoning}
              </p>
            </CollapsibleContent>
          </Collapsible>
        ) : null}

        {/* Markdown content */}
        {message.content ? (
          <div className="mt-2 w-fit max-w-full rounded-2xl rounded-bl-md border bg-card px-4 py-3 shadow-sm">
            <MarkdownRenderer content={message.content} />
          </div>
        ) : null}

        {/* Error banner (with inline retry when offered) */}
        {message.error ? (
          <div className="mt-2 flex flex-wrap items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 break-words">{message.error}</span>
            {onRetry && (
              <Button
                size="sm"
                variant="outline"
                onClick={onRetry}
                className="h-7 shrink-0 gap-1.5 border-red-500/40 px-2.5 text-xs text-red-300 hover:bg-red-500/15 hover:text-red-200"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                Retry
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});
