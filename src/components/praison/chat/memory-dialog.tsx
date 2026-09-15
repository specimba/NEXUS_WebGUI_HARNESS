"use client";

import * as React from "react";
import { Brain, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useConversationsStore } from "@/lib/stores";
import { fireConsolidation, repliesSinceConsolidation } from "@/lib/memory";
import { fmtRel } from "@/lib/helpers";
import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";

interface MemoryDialogProps {
  conv: Conversation | null;
  disabled?: boolean;
}

/**
 * Hermes-style conversation memory: a compact first-person document pinned
 * into the system prompt of every future turn. Editable by hand, or rebuilt
 * by a silent consolidation pass over the recent transcript.
 */
export function MemoryDialog({ conv, disabled }: MemoryDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const setMemory = useConversationsStore((s) => s.setMemory);

  const memory = conv?.memory;

  // Re-seed the draft when the dialog opens (per conversation — narrow deps
  // are intentional so a background consolidation can't clobber typing).
  React.useEffect(() => {
    if (open) setDraft(memory?.text ?? "");
  }, [open, conv?.id]);

  const save = () => {
    if (!conv) return;
    const text = draft.trim();
    if (!text) {
      setMemory(conv.id, undefined);
      toast("Memory cleared", { icon: "🧠" });
    } else {
      setMemory(conv.id, {
        text,
        updatedAt: Date.now(),
        source: "manual",
        atMessageCount: memory?.atMessageCount ?? 0,
      });
      toast.success("Memory saved", {
        description: "Future replies in this chat will carry it in context.",
      });
    }
    setOpen(false);
  };

  const consolidate = async () => {
    if (!conv || working) return;
    setWorking(true);
    await fireConsolidation(conv.id, {
      onDone: (ok, note) => {
        setWorking(false);
        if (ok) {
          toast.success("Memory consolidated", {
            description: "The folded document was rebuilt from the recent transcript.",
          });
          setOpen(false);
        } else {
          toast.error(`Consolidation skipped — ${note}`);
        }
      },
    });
  };

  const since = conv ? repliesSinceConsolidation(conv) : 0;
  const hasMemory = Boolean(memory?.text?.trim());

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Conversation memory"
          title={hasMemory ? `Conversation memory · updated ${fmtRel(memory!.updatedAt)}` : "Conversation memory"}
          disabled={disabled || !conv}
          className={cn(
            "transition-colors hover:text-violet-400",
            hasMemory && "memory-chip text-violet-400"
          )}
        >
          <Brain className="h-[18px] w-[18px]" aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-400" aria-hidden />
            Conversation memory
          </DialogTitle>
          <DialogDescription>
            A first-person document the agent carries into every reply of{" "}
            <span className="font-medium text-foreground">{conv?.title ?? "this chat"}</span>.
            {memory?.updatedAt ? ` Last updated ${fmtRel(memory.updatedAt)} (${memory.source}).` : " Empty — nothing pinned yet."}
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={7}
          maxLength={2000}
          placeholder={'"The user is prototyping a fusion dashboard. They prefer concise answers, TS code over Python, and we agreed the API ships Friday."'}
          className="field-sizing-fixed resize-none font-mono text-[13px]"
          aria-label="Memory document"
        />

        <p className="text-xs text-muted-foreground">
          {hasMemory
            ? `Auto-consolidates after ~10 new replies (${since} since last pass).`
            : "Written by you, or auto-consolidated from the transcript after ~10 replies."}
        </p>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDraft("");
              if (conv) setMemory(conv.id, undefined);
              toast("Memory cleared", { icon: "🧠" });
            }}
            disabled={!hasMemory}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Clear
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={consolidate} disabled={working || !conv || conv.messages.length < 2}>
            {working ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-violet-400" aria-hidden />
            )}
            {working ? "Consolidating…" : "Consolidate now"}
          </Button>
          <Button size="sm" onClick={save} disabled={working}>
            Save memory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
