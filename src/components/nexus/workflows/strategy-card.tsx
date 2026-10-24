"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  FileText,
  Layers,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── r515-c: Strategy & doctrine card (Strategic Context Layer) ──────────────
// Owner diagnosis that built this: the AIE ran but proposed idle no-ops —
// "not connected enough … we need proper instruction and agent.md tasks.md
// worklogs.md etc etc like strategical system for proper disciplined
// continuous work … this is still void for connected system."
//
// This card is the human window onto the connected system:
//   • the StrategyItem backlog the AIE advances every 10-min cycle (data-only)
//   • the distilled-findings digest the next briefing carries
//   • /api/briefing — the environment brief any scheduled agent reads first
//   • one-click sync of seeds + radar tryables into the backlog
// Doctrine lives in docs/strategy/AGENT.md (the capability elevation cycle).

interface StrategyItem {
  id: string;
  title: string;
  kind: string;
  source: string;
  status: string;
  priority: number;
  nextAction: string;
  acceptance: string | null;
  advancedCount: number;
  advancedAt: string | null;
  createdAt: string;
}

interface DigestEntry {
  id: string;
  ts: string;
  source: string;
  text: string;
}

interface StrategyPayload {
  ok: boolean;
  items?: StrategyItem[];
  open?: number;
  byStatus?: Record<string, number>;
  digest?: DigestEntry[];
  radar?: { at: string | null; findings: number; criticals: number; tryables: number };
  queue?: { queued?: number; researched?: number; failed?: number };
  lastAieReport?: { at: string; summary: string } | null;
  engine?: { armed: boolean };
  error?: string;
}

const STATUS_STYLES: Record<string, string> = {
  proposed: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  ready: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  "in-progress": "border-amber-500/40 bg-amber-500/10 text-amber-300",
  blocked: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  done: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

const KIND_LABEL: Record<string, string> = {
  integration: "integration",
  research: "research",
  experiment: "experiment",
  "owner-action": "owner",
};

function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${Math.max(1, m)}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function StrategyCard() {
  const [data, setData] = React.useState<StrategyPayload | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [briefing, setBriefing] = React.useState<string | null>(null);
  const [briefingOpen, setBriefingOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [formTitle, setFormTitle] = React.useState("");
  const [formNext, setFormNext] = React.useState("");
  const [formPriority, setFormPriority] = React.useState("2");
  const [formKind, setFormKind] = React.useState("integration");

  const load = React.useCallback(async () => {
    try {
      const r = await fetch("/api/strategy", { cache: "no-store" });
      const j = (await r.json()) as StrategyPayload;
      if (j.ok) setData(j);
    } catch {
      /* poll — the next tick recovers */
    }
  }, []);

  React.useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 45_000);
    return () => clearInterval(t);
  }, [load]);

  const post = React.useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setBusy(label);
      try {
        const r = await fetch("/api/strategy", {
          method: "POST",
          headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
          body: JSON.stringify(body),
        });
        const j = (await r.json()) as StrategyPayload & { seedsInserted?: number; radarAdded?: number; seedsSkipped?: number };
        if (!j.ok) throw new Error(j.error ?? `http ${r.status}`);
        if (body.action === "sync") {
          toast.success(
            `Strategy synced — +${j.seedsInserted ?? 0} seeds (+${j.radarAdded ?? 0} radar tryables, ${j.seedsSkipped ?? 0} already present)`,
          );
        } else {
          toast.success(label === "status" ? "Status updated" : label === "advance" ? "Item advanced" : "Item created");
        }
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "action failed");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const openBriefing = React.useCallback(async () => {
    setBusy("briefing");
    try {
      const r = await fetch("/api/briefing", { cache: "no-store" });
      setBriefing(await r.text());
      setBriefingOpen(true);
    } catch {
      toast.error("briefing fetch failed");
    } finally {
      setBusy(null);
    }
  }, []);

  const copyBriefing = React.useCallback(async () => {
    if (!briefing) return;
    const { copyText } = await import("@/lib/helpers");
    if (await copyText(briefing)) toast.success("Brief copied — paste it into your z.ai cron task");
    else toast.error("copy failed");
  }, [briefing]);

  const items = data?.items ?? [];
  const open = data?.open ?? 0;
  const openItems = items.filter((i) => i.status !== "done");
  const visible = expanded ? openItems : openItems.slice(0, 4);
  const digest = data?.digest ?? [];

  return (
    <Card className="p-4 md:p-6" aria-label="Strategy and doctrine">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="h-4 w-4 text-emerald-400" aria-hidden />
        <h3 className="text-sm font-semibold tracking-tight">Strategy &amp; doctrine</h3>
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
          {open} open
        </Badge>
        {data?.engine?.armed ? (
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
            engine advances it
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-500/40 text-amber-300">
            engine disarmed
          </Badge>
        )}
        {data?.queue ? (
          <span className="text-xs text-muted-foreground">
            queue {data.queue.queued ?? 0}q / {data.queue.researched ?? 0}r / {data.queue.failed ?? 0}f
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void post({ action: "sync" }, "sync")} disabled={busy === "sync"}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", busy === "sync" && "animate-spin")} aria-hidden />
            Sync signals
          </Button>
          <Button size="sm" variant="outline" onClick={() => void openBriefing()} disabled={busy === "briefing"}>
            <FileText className="mr-1 h-3.5 w-3.5" aria-hidden />
            Briefing
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)} aria-expanded={showForm}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            Item
          </Button>
        </div>
      </div>

      {/* Doctrine line */}
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        The connected system (r515-c): in-app workers <span className="text-foreground">research</span> → the chat-side
        architect <span className="text-foreground">distills &amp; implements</span> → the Owner{" "}
        <span className="text-foreground">decides &amp; schedules</span>. The engine advances this backlog data-only every
        cycle; doctrine lives in <code className="rounded bg-muted px-1 py-0.5 text-[10px]">docs/strategy/AGENT.md</code> ·{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-[10px]">TASKS.md</code> ·{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-[10px]">WORKLOGS.md</code>.
      </p>

      {/* New-item form */}
      {showForm ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 md:grid-cols-[2fr_2fr_auto_auto_auto]">
          <div className="space-y-1">
            <Label htmlFor="strategy-item-title" className="text-[11px] text-muted-foreground">
              Title
            </Label>
            <Input
              id="strategy-item-title"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="Integration / research task…"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="strategy-item-next" className="text-[11px] text-muted-foreground">
              Next action
            </Label>
            <Input
              id="strategy-item-next"
              value={formNext}
              onChange={(e) => setFormNext(e.target.value)}
              placeholder="Concrete next step…"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Kind</Label>
            <Select value={formKind} onValueChange={setFormKind}>
              <SelectTrigger className="h-8 text-xs" aria-label="Item kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="integration">integration</SelectItem>
                <SelectItem value="research">research</SelectItem>
                <SelectItem value="experiment">experiment</SelectItem>
                <SelectItem value="owner-action">owner-action</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Priority</Label>
            <Select value={formPriority} onValueChange={setFormPriority}>
              <SelectTrigger className="h-8 text-xs" aria-label="Priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">P1 high</SelectItem>
                <SelectItem value="2">P2 normal</SelectItem>
                <SelectItem value="3">P3 low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              size="sm"
              onClick={() => {
                if (!formTitle.trim()) {
                  toast.error("title required");
                  return;
                }
                void post(
                  { action: "item", title: formTitle, nextAction: formNext, kind: formKind, priority: Number(formPriority) },
                  "item",
                );
                setFormTitle("");
                setFormNext("");
              }}
              disabled={busy === "item"}
            >
              Add
            </Button>
          </div>
        </div>
      ) : null}

      {/* Backlog */}
      <div className="mt-3 max-h-96 overflow-y-auto pr-1" role="list" aria-label="Open strategy items">
        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
            Backlog empty — hit <span className="text-foreground">Sync signals</span> to seed it from the repo sweep,
            radar tryables, and owner actions.
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((it) => (
              <li key={it.id} role="listitem" className="rounded-lg border border-border/60 bg-card/50 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{it.id}</span>
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                      STATUS_STYLES[it.status] ?? "border-border text-muted-foreground",
                    )}
                  >
                    {it.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    P{it.priority} · {KIND_LABEL[it.kind] ?? it.kind}
                    {it.advancedCount > 0 ? ` · advanced ×${it.advancedCount}` : ""}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground" title={it.createdAt}>
                    {ageOf(it.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm font-medium leading-snug">{it.title}</p>
                {it.nextAction ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">→ {it.nextAction}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => void post({ action: "advance", id: it.id }, "advance")}
                    disabled={busy === "advance"}
                    title="Touch advancedAt/Count + append a digest line"
                  >
                    <Play className="mr-1 h-3 w-3" aria-hidden />
                    Advance
                  </Button>
                  {it.status !== "in-progress" && it.status !== "done" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => void post({ action: "status", id: it.id, status: "in-progress" }, "status")}
                      disabled={busy === "status"}
                    >
                      Start
                    </Button>
                  ) : null}
                  {it.status !== "done" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => void post({ action: "status", id: it.id, status: "done" }, "status")}
                      disabled={busy === "status"}
                    >
                      <Check className="mr-1 h-3 w-3" aria-hidden />
                      Done
                    </Button>
                  ) : null}
                  {it.status !== "blocked" && it.kind !== "owner-action" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => void post({ action: "status", id: it.id, status: "blocked" }, "status")}
                      disabled={busy === "status"}
                    >
                      <PauseCircle className="mr-1 h-3 w-3" aria-hidden />
                      Hold
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {openItems.length > 4 ? (
        <Button size="sm" variant="ghost" className="mt-1 h-7 w-full text-[11px] text-muted-foreground" onClick={() => setExpanded((v) => !v)}>
          {expanded ? (
            <>
              <ChevronUp className="mr-1 h-3 w-3" aria-hidden /> Show top 4
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-3 w-3" aria-hidden /> Show all {openItems.length} open items
            </>
          )}
        </Button>
      ) : null}

      {/* Digest */}
      {digest.length > 0 ? (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="flex items-center gap-1.5">
            <ScrollText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="text-[11px] font-medium text-muted-foreground">Distilled findings (the digest the briefing carries)</span>
          </div>
          <ul className="mt-1.5 space-y-1">
            {digest.slice(0, 5).map((d) => (
              <li key={d.id} className="flex items-start gap-1.5 text-xs leading-relaxed">
                <span className="mt-0.5 shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">
                  {d.source}
                </span>
                <span className="text-muted-foreground">{d.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Briefing drawer */}
      {briefingOpen && briefing ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
            <span className="text-xs font-medium">Environment brief — GET /api/briefing</span>
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void copyBriefing()}>
                <ClipboardCopy className="mr-1 h-3 w-3" aria-hidden />
                Copy
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setBriefingOpen(false)}>
                Close
              </Button>
            </div>
          </div>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {briefing}
          </pre>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Paste this into the task text of a cron you create on the z.ai side (hourly recommended) — chat-side
            auto-created crons get platform-gated, Owner-created ones are the resilient control plane.
          </p>
        </div>
      ) : null}
    </Card>
  );
}
