"use client";

import * as React from "react";
import {
  Bot,
  Clock3,
  Command as CommandIcon,
  Cog,
  FileText,
  GripVertical,
  Loader2,
  MessageSquarePlus,
  Mic,
  Moon,
  Palette,
  Paperclip,
  Search,
  SendHorizontal,
  Square,
  Sun,
  Workflow as WorkflowIcon,
  Wrench,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToolBadge } from "@/components/praison/atoms";
import {
  CONTEXT_TOKEN_BUDGET,
  isImageFileName,
  isTextFileName,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_CONTEXT_MESSAGES,
  MAX_IMAGE_ATTACHMENTS,
  MAX_IMAGE_SOURCE_BYTES,
} from "@/lib/constants";
import {
  conversationToMarkdown,
  dataUrlBytes,
  downloadText,
  downscaleImageFile,
  estimateNextTurnTokens,
  fmtBytes,
  slugify,
} from "@/lib/helpers";
import { useConversationsStore, useSettingsStore, useUiStore } from "@/lib/stores";
import { UI_THEMES, uiThemeById } from "@/lib/constants";
import type { Agent, MessageAttachment } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ComposerProps {
  agent?: Agent | null;
  streaming: boolean;
  onSend: (text: string, attachments: MessageAttachment[]) => void;
  /** Typed while streaming: parked and auto-sent when the turn settles. */
  onQueue: (text: string, attachments: MessageAttachment[]) => void;
  onStop: () => void;
  /** Text of the currently parked message (null = none, or another chat's). */
  queuedPreview?: string | null;
  onCancelQueued: () => void;
  onSendQueued: () => void;
}

const MAX_HEIGHT = 160; // max-h-40
const MAX_RECORDING_MS = 60_000;

// ─── Slash commands (type "/" in the composer) ───────────────────────────────

interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  icon: React.ElementType;
  run: () => void;
}

function useSlashCommands(): SlashCommand[] {
  const { resolvedTheme, setTheme } = useTheme();
  return React.useMemo(() => {
    const ui = useUiStore.getState();
    const convStore = useConversationsStore.getState();
    const conv = convStore.conversations.find((c) => c.id === convStore.activeId);
    return [
      {
        id: "new",
        label: "/new",
        hint: "Start a new chat",
        icon: MessageSquarePlus,
        run: () => {
          convStore.create(ui.activeAgentId ?? undefined);
          ui.setView("chat");
        },
      },
      {
        id: "export",
        label: "/export",
        hint: "Export this chat as Markdown",
        icon: FileText,
        run: () => {
          const store = useConversationsStore.getState();
          const active = store.conversations.find((c) => c.id === store.activeId);
          if (!active || active.messages.length === 0) {
            toast.warning("Nothing to export yet — this chat is empty.");
            return;
          }
          downloadText(
            `praison-chat-${slugify(active.title)}.md`,
            conversationToMarkdown(active),
            "text/markdown"
          );
          toast.success("Chat exported as Markdown", {
            description: `${active.messages.length} messages saved to your device.`,
          });
        },
      },
      {
        id: "search",
        label: "/search",
        hint: "Search all chats",
        icon: Search,
        run: () => useUiStore.getState().setGlobalSearchOpen(true),
      },
      {
        id: "palette",
        label: "/palette",
        hint: "Open the ⌘K command palette",
        icon: CommandIcon,
        run: () => useUiStore.getState().setPaletteOpen(true),
      },
      {
        id: "agents",
        label: "/agents",
        hint: "Open the Agent Roster",
        icon: Bot,
        run: () => useUiStore.getState().setView("agents"),
      },
      {
        id: "workflows",
        label: "/workflows",
        hint: "Open the Workflow Studio",
        icon: WorkflowIcon,
        run: () => useUiStore.getState().setView("workflows"),
      },
      {
        id: "settings",
        label: "/settings",
        hint: "Open Settings",
        icon: Cog,
        run: () => useUiStore.getState().setView("settings"),
      },
      {
        id: "theme",
        label: "/theme",
        hint: `Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`,
        icon: resolvedTheme === "dark" ? Sun : Moon,
        run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
      },
      {
        id: "accent",
        label: "/accent",
        hint: `Cycle accent theme (now: ${uiThemeById(useSettingsStore.getState().settings.uiTheme).label})`,
        icon: Palette,
        run: () => {
          const s = useSettingsStore.getState();
          const idx = UI_THEMES.findIndex((t) => t.id === (s.settings.uiTheme ?? "nexus"));
          const next = UI_THEMES[(idx + 1) % UI_THEMES.length];
          s.update({ uiTheme: next.id });
          toast(`${next.label} theme engaged`, { description: next.tagline });
        },
      },
    ];
  }, [resolvedTheme, setTheme]);
}

// ─── Voice input hook: MediaRecorder → /api/transcribe → text ───────────────

type VoiceState = "idle" | "recording" | "transcribing";

function useVoiceInput(onTranscript: (text: string) => void) {
  const [state, setState] = React.useState<VoiceState>("idle");
  const [elapsedMs, setElapsedMs] = React.useState(0);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const startedAtRef = React.useRef(0);
  const tickRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = React.useRef(false);

  const cleanup = React.useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    tickRef.current = null;
    timeoutRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  React.useEffect(() => cleanup, [cleanup]);

  const transcribe = React.useCallback(
    async (blob: Blob) => {
      setState("transcribing");
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("Could not read the recording"));
          reader.readAsDataURL(blob);
        });
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: base64 }),
        });
        const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
        const text = (json.text ?? "").trim();
        if (!text) {
          toast.warning("Heard nothing — try speaking a bit louder.");
          return;
        }
        onTranscript(text);
      } catch (err) {
        toast.error("Voice input failed", {
          description: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setState("idle");
        setElapsedMs(0);
      }
    },
    [onTranscript]
  );

  const stop = React.useCallback(
    (cancel = false) => {
      cancelledRef.current = cancel;
      const rec = recorderRef.current;
      if (rec && rec.state !== "inactive") rec.stop();
      else {
        cleanup();
        setState("idle");
        setElapsedMs(0);
      }
    },
    [cleanup]
  );

  const start = React.useCallback(async () => {
    if (state !== "idle") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      toast.error("Voice input is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((m) =>
        typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)
      );
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const duration = Date.now() - startedAtRef.current;
        cleanup();
        setElapsedMs(0);
        if (cancelledRef.current || duration < 400 || blob.size === 0) {
          cancelledRef.current = false;
          setState("idle");
          return;
        }
        void transcribe(blob);
      };
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      cancelledRef.current = false;
      rec.start();
      setState("recording");
      setElapsedMs(0);
      tickRef.current = setInterval(
        () => setElapsedMs(Date.now() - startedAtRef.current),
        250
      );
      timeoutRef.current = setTimeout(() => stop(false), MAX_RECORDING_MS);
    } catch (err) {
      cleanup();
      setState("idle");
      const name = err instanceof Error ? err.name : "";
      toast.error(
        name === "NotAllowedError" ? "Microphone access denied" : "Could not start recording",
        {
          description:
            name === "NotAllowedError"
              ? "Allow mic access in your browser to use voice input."
              : "No available microphone was found on this device.",
        }
      );
    }
  }, [state, transcribe, stop, cleanup]);

  const toggle = React.useCallback(() => {
    if (state === "recording") stop(false);
    else if (state === "idle") void start();
  }, [state, start, stop]);

  return { state, elapsedMs, toggle, stop };
}

// ─── Composer ────────────────────────────────────────────────────────────────

export function Composer({
  agent,
  streaming,
  onSend,
  onQueue,
  onStop,
  queuedPreview,
  onCancelQueued,
  onSendQueued,
}: ComposerProps) {
  const [value, setValue] = React.useState("");
  const [attachments, setAttachments] = React.useState<MessageAttachment[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  // Attachment chip drag-to-reorder (ref = synchronous source index, state = visuals)
  const dragFromRef = React.useRef<number | null>(null);
  const [dragFrom, setDragFrom] = React.useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = React.useState<number | null>(null);
  const taRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const dragDepth = React.useRef(0);

  // Voice input
  const insertTranscript = React.useCallback((text: string) => {
    setValue((prev) => (prev ? `${prev} ${text}` : text));
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, []);
  const voice = useVoiceInput(insertTranscript);

  // Slash menu
  const slashCommands = useSlashCommands();
  const slashQuery = value.startsWith("/") && !value.includes(" ") ? value.slice(1).toLowerCase() : null;
  const slashOpen = slashQuery !== null;
  const [slashIndex, setSlashIndex] = React.useState(0);
  const filteredSlash = React.useMemo(
    () =>
      slashQuery === null
        ? []
        : slashCommands
            .filter(
              (c) => c.id.startsWith(slashQuery) || c.hint.toLowerCase().includes(slashQuery)
            )
            .sort((a, b) => {
              // prefix matches (e.g. "/th" → /theme) rank before fuzzy hint matches
              const ap = a.id.startsWith(slashQuery) ? 0 : 1;
              const bp = b.id.startsWith(slashQuery) ? 0 : 1;
              return ap - bp;
            }),
    [slashQuery, slashCommands]
  );
  React.useEffect(() => setSlashIndex(0), [slashQuery]);

  const runSlash = React.useCallback(
    (cmd: SlashCommand) => {
      setValue("");
      requestAnimationFrame(() => taRef.current?.focus());
      toast(`/${cmd.id}`, { description: cmd.hint, icon: "⌘" });
      cmd.run();
    },
    []
  );

  // Auto-grow: shrink-to-measure, cap at max-h-40 with internal scroll
  React.useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const addFiles = React.useCallback(
    async (files: File[]) => {
      const accepted: MessageAttachment[] = [];
      for (const f of files) {
        if (attachments.length + accepted.length >= MAX_ATTACHMENTS) {
          toast.warning(`Up to ${MAX_ATTACHMENTS} files per message`);
          break;
        }
        const isImage = isImageFileName(f.name) || f.type.startsWith("image/");
        if (isImage) {
          const imageCount = [...attachments, ...accepted].filter((a) => a.kind === "image").length;
          if (imageCount >= MAX_IMAGE_ATTACHMENTS) {
            toast.warning(`Up to ${MAX_IMAGE_ATTACHMENTS} images per message`);
            continue;
          }
          if (f.size > MAX_IMAGE_SOURCE_BYTES) {
            toast.error(`Image too large: ${f.name}`, {
              description: `Max ${fmtBytes(MAX_IMAGE_SOURCE_BYTES)} per image (got ${fmtBytes(f.size)}).`,
            });
            continue;
          }
          try {
            const dataUrl = await downscaleImageFile(f);
            accepted.push({
              name: f.name,
              size: dataUrlBytes(dataUrl),
              content: dataUrl,
              kind: "image",
              mime: "image/jpeg",
            });
          } catch (err) {
            toast.error(`Could not process image: ${f.name}`, {
              description: err instanceof Error ? err.message : "Unknown error",
            });
          }
          continue;
        }
        if (!isTextFileName(f.name)) {
          toast.error(`Unsupported file: ${f.name}`, {
            description: "Attach text files (code, md, json, csv…) or images (png, jpg, webp, gif).",
          });
          continue;
        }
        if (f.size > MAX_ATTACHMENT_BYTES) {
          toast.error(`File too large: ${f.name}`, {
            description: `Max ${fmtBytes(MAX_ATTACHMENT_BYTES)} per file (got ${fmtBytes(f.size)}).`,
          });
          continue;
        }
        try {
          const content = await f.text();
          accepted.push({ name: f.name, size: f.size, content, kind: "text" });
        } catch {
          toast.error(`Could not read ${f.name}`);
        }
      }
      if (accepted.length > 0) {
        setAttachments((prev) => [...prev, ...accepted]);
        toast.success(
          accepted.length === 1 ? `${accepted[0].name} attached` : `${accepted.length} files attached`,
          { icon: "📎" }
        );
      }
    },
    [attachments.length, attachments]
  );

  const removeAttachment = React.useCallback((name: string) => {
    setAttachments((prev) => prev.filter((a) => a.name !== name));
  }, []);

  const reorderAttachments = React.useCallback((from: number, to: number) => {
    if (from === to) return;
    setAttachments((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  /** Shared drag handlers + classes for attachment chips (HTML5 reorder). */
  const chipDrag = (i: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      dragFromRef.current = i;
      setDragFrom(i);
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", `reorder:${i}`);
      } catch {
        /* older engines */
      }
    },
    onDragEnter: (e: React.DragEvent) => {
      e.stopPropagation();
      if (dragFromRef.current !== null) {
        e.preventDefault();
        setDragOverIdx(i);
      }
    },
    onDragOver: (e: React.DragEvent) => {
      if (dragFromRef.current !== null) {
        e.stopPropagation();
        e.preventDefault();
        setDragOverIdx(i);
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (dragFromRef.current !== null) reorderAttachments(dragFromRef.current, i);
      dragFromRef.current = null;
      setDragFrom(null);
      setDragOverIdx(null);
    },
    onDragEnd: (e: React.DragEvent) => {
      e.stopPropagation();
      dragFromRef.current = null;
      setDragFrom(null);
      setDragOverIdx(null);
    },
  });

  const chipDropHighlight = (i: number) =>
    dragFrom !== null && dragOverIdx === i && dragFrom !== i
      ? "border-violet-500/70 ring-1 ring-violet-400/70"
      : dragFrom === i
        ? "opacity-40"
        : "";

  const submit = React.useCallback(() => {
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    const safeText = text || "Please analyze the attached file(s).";
    if (streaming) {
      // Async steering: park the follow-up; it auto-sends when the turn ends.
      onQueue(safeText, attachments);
    } else {
      onSend(safeText, attachments);
    }
    setValue("");
    setAttachments([]);
  }, [value, attachments, streaming, onSend, onQueue]);

  const hasContent = value.trim().length > 0 || attachments.length > 0;

  // Context economy meter (inspired by mksglu/context-mode)
  const activeMessages = useConversationsStore(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.messages ?? null
  );
  const estTokens = React.useMemo(
    () =>
      estimateNextTurnTokens(
        activeMessages ?? [],
        agent?.instructions ?? "",
        value,
        MAX_CONTEXT_MESSAGES
      ),
    [activeMessages, agent, value]
  );
  const ctxPct = Math.min(1, estTokens / CONTEXT_TOKEN_BUDGET);
  const tools = agent?.tools ?? [];
  const agentName = agent?.name ?? "agent";
  const recSeconds = Math.floor(voice.elapsedMs / 1000);

  return (
    <div className="shrink-0 border-t bg-background/80 p-3 backdrop-blur">
      <div className="relative mx-auto max-w-3xl">
        {/* Queued follow-up strip (async steering) */}
        {queuedPreview ? (
          <div
            role="status"
            aria-label="Queued follow-up message"
            className="queue-in mb-2 flex items-center gap-2 rounded-xl border border-violet-500/40 bg-violet-500/10 py-2 pl-3 pr-2 shadow-sm shadow-violet-500/10"
          >
            <Clock3 className="h-4 w-4 shrink-0 animate-pulse text-violet-400" aria-hidden />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-400">
                Queued · sends when the reply finishes
              </p>
              <p className="truncate text-xs text-foreground/85">{queuedPreview}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={streaming}
              onClick={onSendQueued}
              className="h-7 shrink-0 rounded-lg px-2 text-[11px] text-violet-400 hover:bg-violet-500/15 hover:text-violet-300"
            >
              Send now
            </Button>
            <button
              type="button"
              aria-label="Remove queued message"
              onClick={onCancelQueued}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : null}

        {/* Slash command menu */}
        {slashOpen && filteredSlash.length > 0 && (
          <div
            role="listbox"
            aria-label="Slash commands"
            className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-2xl border bg-popover shadow-2xl shadow-violet-500/10"
          >
            <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Wrench className="h-3 w-3" aria-hidden />
              Quick actions · ↑↓ to pick, Enter to run, Esc to dismiss
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {filteredSlash.map((c, i) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={i === slashIndex}
                    onMouseEnter={() => setSlashIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runSlash(c);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                      i === slashIndex ? "bg-violet-500/10 text-foreground" : "text-foreground/85"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px]",
                        i === slashIndex
                          ? "border-violet-500/40 bg-violet-500/15 text-violet-400"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="font-mono font-medium text-violet-400">{c.label}</span>
                    <span className="truncate text-xs text-muted-foreground">{c.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepth.current += 1;
            setDragOver(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault();
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) {
              dragDepth.current = 0;
              setDragOver(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragOver(false);
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length > 0) void addFiles(files);
          }}
          className={cn(
            "relative rounded-2xl border border-border/70 bg-card/70 shadow-sm transition-all duration-200",
            "focus-within:border-violet-500/50 focus-within:shadow-[0_0_0_3px_oklch(0.606_0.25_292.717/0.12)]",
            dragOver &&
              "border-violet-500 bg-violet-500/5 shadow-[0_0_0_4px_oklch(0.606_0.25_292.717/0.18)]",
            voice.state === "recording" &&
              "border-red-500/60 shadow-[0_0_0_3px_oklch(0.577_0.245_27.325/0.15)]"
          )}
        >
          {/* Attachment chips (drag to reorder) */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3" role="list" aria-label="Attached files — drag to reorder">
              {attachments.map((a, i) =>
                a.kind === "image" ? (
                  <span
                    key={`${a.name}-${i}`}
                    {...chipDrag(i)}
                    role="listitem"
                    title={`${a.name} · ${fmtBytes(a.size)} · drag to reorder`}
                    className={cn(
                      "group/img relative inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 p-1 pr-1 cursor-grab active:cursor-grabbing transition-all",
                      chipDropHighlight(i)
                    )}
                  >
                    {}
                    <img
                      src={a.content}
                      alt={a.name}
                      className="h-9 w-9 rounded-md border border-violet-500/30 object-cover"
                    />
                    <span className="max-w-28 truncate text-xs font-medium">{a.name}</span>
                    <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                      {fmtBytes(a.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.name)}
                      aria-label={`Remove attachment ${a.name}`}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <span aria-hidden className="px-0.5 text-[13px] leading-none">×</span>
                    </button>
                  </span>
                ) : (
                  <span
                    key={`${a.name}-${i}`}
                    {...chipDrag(i)}
                    role="listitem"
                    title={`${a.name} · ${fmtBytes(a.size)} · drag to reorder`}
                    className={cn(
                      "group/att inline-flex max-w-full cursor-grab items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 py-1 pl-2 pr-1 text-xs text-foreground transition-all active:cursor-grabbing",
                      chipDropHighlight(i)
                    )}
                  >
                    <GripVertical
                      className="h-3 w-3 shrink-0 text-muted-foreground/50 transition-opacity group-hover/att:opacity-100 opacity-0"
                      aria-hidden
                    />
                    <FileText className="h-3.5 w-3.5 shrink-0 text-violet-400" aria-hidden />
                    <span className="max-w-40 truncate font-medium">{a.name}</span>
                    <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                      {fmtBytes(a.size)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.name)}
                      aria-label={`Remove attachment ${a.name}`}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <span aria-hidden className="px-0.5 text-[13px] leading-none">×</span>
                    </button>
                  </span>
                )
              )}
            </div>
          )}

          {/* Drag-over hint */}
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/60 backdrop-blur-[2px]">
              <span className="flex items-center gap-2 rounded-full border border-violet-500/50 bg-card px-4 py-1.5 text-sm font-medium text-violet-400 shadow-lg">
                <FileText className="h-4 w-4" aria-hidden />
                Drop files or images to attach
              </span>
            </div>
          )}

          <form
            className="flex items-end gap-2 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".txt,.md,.markdown,.json,.csv,.tsv,.yaml,.yml,.toml,.ini,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.rb,.go,.rs,.java,.kt,.c,.h,.cpp,.hpp,.cs,.php,.swift,.sh,.bash,.zsh,.sql,.html,.css,.scss,.less,.vue,.svelte,.xml,.svg,.log,.env,.gitignore,.dockerfile,.prisma,.graphql,.gql,.png,.jpg,.jpeg,.webp,.gif,text/*,image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              aria-label="Attach files or images"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) void addFiles(files);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Attach files"
              title="Attach files (or drag & drop / paste)"
              disabled={streaming}
              onClick={() => fileRef.current?.click()}
              className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground transition-colors hover:text-violet-400"
            >
              <Paperclip className="h-[18px] w-[18px]" aria-hidden />
            </Button>

            {/* Voice input */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={
                voice.state === "recording"
                  ? "Stop recording"
                  : voice.state === "transcribing"
                    ? "Transcribing…"
                    : "Record voice input"
              }
              title={
                voice.state === "recording"
                  ? "Stop & transcribe"
                  : "Voice input (click, speak, click again)"
              }
              disabled={streaming || voice.state === "transcribing"}
              onClick={voice.toggle}
              className={cn(
                "relative h-10 w-10 shrink-0 rounded-xl transition-colors",
                voice.state === "idle" && "text-muted-foreground hover:text-violet-400",
                voice.state === "recording" &&
                  "bg-red-500/15 text-red-500 hover:bg-red-500/20 hover:text-red-500",
                voice.state === "transcribing" && "text-violet-400"
              )}
            >
              {voice.state === "transcribing" ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden />
              ) : (
                <>
                  {voice.state === "recording" && (
                    <span
                      className="absolute inset-1 rounded-full bg-red-500/30 rec-ripple"
                      aria-hidden
                    />
                  )}
                  <Mic className="relative h-[18px] w-[18px]" aria-hidden />
                </>
              )}
            </Button>

            <Textarea
              ref={taRef}
              rows={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files ?? []);
                if (files.length > 0) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
              onKeyDown={(e) => {
                // Slash menu keyboard navigation
                if (slashOpen && filteredSlash.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((i) => (i + 1) % filteredSlash.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex((i) => (i - 1 + filteredSlash.length) % filteredSlash.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    runSlash(filteredSlash[slashIndex]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setValue("");
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={
                voice.state === "recording"
                  ? `Listening… ${recSeconds}s (click the mic to stop)`
                  : streaming
                    ? `Agent is replying — type a follow-up and press Enter to queue it`
                    : `Message ${agentName}…  (Enter to send, / for commands)`
              }
              aria-label={`Message ${agentName}`}
              className="min-h-[44px] flex-1 resize-none overflow-y-auto border-0 bg-transparent text-[14.5px] shadow-none focus-visible:ring-0"
            />
            {streaming ? (
              <>
                {hasContent ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => submit()}
                    aria-label="Queue follow-up message"
                    title="Queue this follow-up — it sends when the current reply finishes"
                    className="h-10 w-10 shrink-0 rounded-xl border-violet-500/50 text-violet-400 shadow-md shadow-violet-500/15 transition-all hover:bg-violet-500/10 hover:text-violet-300"
                  >
                    <Clock3 className="h-4 w-4" aria-hidden />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={onStop}
                  aria-label="Stop generating"
                  className="h-10 w-10 shrink-0 rounded-xl border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
                </Button>
              </>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!hasContent}
                aria-label="Send message"
                className="h-10 w-10 shrink-0 rounded-xl shadow-md shadow-violet-500/25"
              >
                <SendHorizontal className="h-[18px] w-[18px]" aria-hidden />
              </Button>
            )}
          </form>
        </div>

        {/* Hint row */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1">
          {voice.state === "recording" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-500">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden />
              REC {recSeconds}s · max 60s
            </span>
          ) : voice.state === "transcribing" ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-violet-400">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Transcribing…
            </span>
          ) : (
            <>
              {tools.map((t) => (
                <ToolBadge key={t} tool={t} className="h-5 gap-1 rounded-md px-1.5 text-[10px]" />
              ))}
              <span className="text-[11px] text-muted-foreground">
                {tools.length > 0 ? "tools available" : "no tools — pure reasoning"}
              </span>
            </>
          )}
          {/* Context economy meter */}
          <span
            title={`≈ ${estTokens.toLocaleString()} tokens of next-request context · soft budget ${CONTEXT_TOKEN_BUDGET.toLocaleString()}`}
            className="ml-auto hidden items-center gap-1.5 sm:flex"
          >
            <span
              role="meter"
              aria-label="Context usage"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(ctxPct * 100)}
              className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
            >
              <span
                className={cn(
                  "block h-full rounded-full transition-all duration-500",
                  ctxPct > 0.9
                    ? "bg-red-500"
                    : ctxPct > 0.7
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                )}
                style={{ width: `${Math.max(3, Math.round(ctxPct * 100))}%` }}
              />
            </span>
            <span className="tabular-nums text-[10px] text-muted-foreground">
              ~{estTokens >= 1000 ? `${(estTokens / 1000).toFixed(1)}k` : estTokens} tok
            </span>
          </span>
          <span className="hidden text-[10px] text-muted-foreground/70 md:inline">
            📎 files · ⠿ drag chips to reorder · 🎤 voice · / commands
          </span>
        </div>
      </div>
    </div>
  );
}
