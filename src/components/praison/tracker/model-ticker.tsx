"use client";

import * as React from "react";
import { Activity, ArrowRight, Copy, RefreshCw, Satellite } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/helpers";
import { useConversationsStore, useSettingsStore, useUiStore } from "@/lib/stores";
import {
  CAP_META,
  capsOf,
  declaresNoTools,
  fmtAge,
  fmtCtx,
  fmtPrice,
  providerMeta,
  TRACKER_CACHE_KEY,
  TRACKER_LAST_SEEN_KEY,
  TRACKER_SYNC_TTL_MS,
  type TrackedModelRow,
  type TrackerData,
} from "@/lib/tracker-types";

// ─── Model Tracker ticker (r28) ──────────────────────────────────────────────
// The "firsthand entry advantage" strip: a slim always-visible marquee that
// surfaces brand-new / free models the 4-8h watcher just caught, with a
// popover panel for the full picture + one-click "pin in this chat".
//
// Data path: GET /api/tracker (SQLite snapshot) → instant paint from the
// localStorage mirror → if status.stale, POST /api/tracker {vyceKey?} (BYOK:
// the key travels per-request from the vault, never stored server-side).
// Toasts fire only for "new" events the user hasn't seen yet.

const POLL_MS = 15 * 60_000;

function loadCache(): TrackerData | null {
  try {
    const raw = localStorage.getItem(TRACKER_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { at: number; tracked: TrackedModelRow[]; events: TrackerData["events"]; lastSyncAt: string | null };
    return {
      tracked: c.tracked ?? [],
      signals: [],
      events: c.events ?? [],
      sources: [],
      status: {
        lastSyncAt: c.lastSyncAt ?? null,
        stale: Date.now() - c.at > TRACKER_SYNC_TTL_MS,
        nextForceEligibleAt: 0,
        newWindowHours: 48,
        syncTtlHours: 4,
      },
    };
  } catch {
    return null;
  }
}

function saveCache(data: TrackerData): void {
  try {
    localStorage.setItem(
      TRACKER_CACHE_KEY,
      JSON.stringify({ at: Date.now(), tracked: data.tracked.slice(0, 120), events: data.events.slice(0, 40), lastSyncAt: data.status.lastSyncAt })
    );
  } catch {
    /* quota — cache is best-effort */
  }
}

/** The marquee feed: new arrivals first, then free lanes, then the rest. */
function tickerFeed(data: TrackerData): TrackedModelRow[] {
  const fresh = data.tracked.filter((m) => m.isNew);
  const free = data.tracked.filter((m) => !m.isNew && m.free);
  const rest = data.tracked.filter((m) => !m.isNew && !m.free);
  return [...fresh, ...free, ...rest].slice(0, 30);
}

export function ModelTicker() {
  const [data, setData] = React.useState<TrackerData | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  const setView = useUiStore((s) => s.setView);
  const activeId = useConversationsStore((s) => s.activeId);
  const setModelOverride = useConversationsStore((s) => s.setModelOverride);
  const vyceKey = useSettingsStore((s) => s.settings.providerKeys?.vyce?.key ?? "");

  const syncNowRef = React.useRef<() => Promise<void>>(async () => {});

  // Merge fetched data + fire unseen-event toasts.
  const apply = React.useCallback((fresh: TrackerData, announce: boolean) => {
    setData(fresh);
    saveCache(fresh);
    if (announce) {
      try {
        const lastSeen = Number(localStorage.getItem(TRACKER_LAST_SEEN_KEY) ?? 0);
        const unseen = lastSeen
          ? fresh.events.filter((e) => e.type === "new" && new Date(e.createdAt).getTime() > lastSeen).slice(0, 3)
          : []; // first-ever paint: don't toast the history
        for (const e of unseen) {
          const meta = e.payload
            ? (JSON.parse(e.payload) as { contextWindow?: number | null; priceIn?: number | null; priceOut?: number | null; free?: boolean })
            : {};
          const bits = [
            providerMeta(e.providerId).label,
            fmtCtx(meta.contextWindow ?? null),
            fmtPrice({ priceIn: meta.priceIn ?? null, priceOut: meta.priceOut ?? null }) ?? (meta.free ? "free" : null),
          ]
            .filter(Boolean)
            .join(" · ");
          toast(`New model spotted: ${e.modelId}`, {
            description: bits,
            icon: "🛰",
            duration: 12_000,
            action: { label: "Open radar", onClick: () => useUiStore.getState().setView("radar") },
          });
        }
        const newest = fresh.events.reduce((acc, e) => Math.max(acc, new Date(e.createdAt).getTime()), lastSeen || Date.now());
        localStorage.setItem(TRACKER_LAST_SEEN_KEY, String(newest));
      } catch {
        /* best-effort announcements */
      }
    }
  }, []);

  const refresh = React.useCallback(
    async (announce: boolean) => {
      try {
        const res = await fetch("/api/tracker", { cache: "no-store" });
        if (!res.ok) return;
        const fresh = (await res.json()) as TrackerData;
        apply(fresh, announce);
        if (fresh.status.stale) void syncNowRef.current();
      } catch {
        /* offline — the cache keeps painting */
      }
    },
    [apply]
  );

  const syncNow = React.useCallback(
    async (announce = true) => {
      setSyncing(true);
      try {
        const res = await fetch("/api/tracker", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-praison-csrf": "1" },
          body: JSON.stringify(vyceKey ? { force: true, vyceKey } : { force: true }),
        });
        const out = (await res.json()) as { skipped?: boolean; reason?: string; newModels?: number };
        await refresh(announce);
        if (!out.skipped) {
          if ((out.newModels ?? 0) > 0) toast(`Tracker caught ${out.newModels} new model${out.newModels === 1 ? "" : "s"}`, { icon: "🛰" });
        } else if (announce && out.reason === "throttled") {
          toast("Sync throttled — the watcher ran less than 10 minutes ago", { icon: "⏳" });
        }
      } catch {
        if (announce) toast.error("Tracker sync failed — check the connection");
      } finally {
        setSyncing(false);
      }
    },
    [vyceKey, refresh]
  );

  syncNowRef.current = syncNow;

  // Boot: instant paint from the mirror, then live fetch + poll.
  React.useEffect(() => {
    const cached = loadCache();
    if (cached) setData(cached);
    void refresh(true);
    const iv = setInterval(() => void refresh(true), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const feed = data ? tickerFeed(data) : [];
  const newCount = data ? data.tracked.filter((m) => m.isNew).length : 0;
  const freeCount = data ? data.tracked.filter((m) => m.free).length : 0;
  const syncedRel = data?.status.lastSyncAt ? fmtAge(data.status.lastSyncAt) : "never";

  function pinModel(m: TrackedModelRow) {
    if (!activeId) {
      toast("Open a chat first, then pin the model", { icon: "💬" });
      setView("chat");
      return;
    }
    setModelOverride(activeId, m.id);
    setView("chat");
    setOpen(false);
    // r45 pin honesty: a lane whose catalog data does NOT declare tool calling
    // is a real constraint for agents/pipelines — say so at the moment of pin.
    const noTools = declaresNoTools(m);
    toast(`This chat now runs on ${m.modelId}`, {
      description: noTools
        ? `${providerMeta(m.providerId).label} — pinned from the tracker. ⚠ Catalog does not declare tool calling: agents and tool-using steps may fail.`
        : `${providerMeta(m.providerId).label} — pinned from the model tracker.`,
      icon: noTools ? "⚠️" : "📌",
      duration: noTools ? 9_000 : undefined,
    });
  }

  // Don't render an empty strip before the first snapshot lands.
  if (!data || feed.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        className="relative z-10 flex h-8 shrink-0 items-center gap-2 border-b bg-background/70 px-3 backdrop-blur-md md:px-5"
        role="region"
        aria-label="Model tracker ticker"
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-400"
            aria-label={`Open model tracker panel — ${newCount} new, ${freeCount} free models`}
          >
            <Satellite className="h-3 w-3" aria-hidden />
            Model Tracker
            {newCount > 0 && (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold text-white">
                {newCount}
              </span>
            )}
          </button>
        </PopoverTrigger>

        {/* Marquee — duplicated track for a seamless loop, decorative copy hidden */}
        <div className="relative min-w-0 flex-1 overflow-hidden" aria-hidden>
          <div className="ticker-track flex w-max items-center gap-6 whitespace-nowrap">
            {[0, 1].map((dup) => (
              <div key={dup} className="flex items-center gap-6">
                {feed.map((m) => {
                  const pm = providerMeta(m.providerId);
                  const bits = [fmtCtx(m.contextWindow), fmtPrice(m), m.free ? "free" : null].filter(Boolean);
                  return (
                    <span key={`${dup}-${m.id}`} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      <span aria-hidden>{pm.glyph}</span>
                      <span className="font-mono text-foreground/80">{m.modelId}</span>
                      {m.isNew && (
                        <span className="rounded bg-emerald-500/15 px-1 text-[9px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                          new
                        </span>
                      )}
                      {bits.length > 0 && <span className="text-[10.5px] opacity-70">{bits.join(" · ")}</span>}
                      <span className="text-[10px] opacity-50">{pm.label}</span>
                      <span className="text-border">•</span>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <span className="hidden shrink-0 text-[10px] text-muted-foreground md:inline">
          synced {syncedRel}
        </span>
      </div>

      {/* ── Panel ── */}
      <PopoverContent align="start" sideOffset={6} className="w-[min(420px,calc(100vw-1.5rem))] p-0 md:w-[480px]">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-500" aria-hidden />
            <div>
              <p className="text-[13px] font-semibold leading-tight">Free &amp; new model radar</p>
              <p className="text-[10.5px] text-muted-foreground">
                Watcher polls every 4-8h · synced {syncedRel} · {data.tracked.length} lanes watched
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Sync now" disabled={syncing} onClick={() => void syncNow(true)}>
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          </Button>
        </div>

        <ScrollArea className="max-h-[46vh]">
          <ul className="divide-y">
            {data.tracked.slice(0, 60).map((m) => (
              <TickerRow key={m.id} row={m} onPin={() => pinModel(m)} />
            ))}
          </ul>
        </ScrollArea>

        <div className="flex items-center justify-between border-t px-3 py-2">
          <span className="text-[10.5px] text-muted-foreground">NEW = caught within the last 48h firsthand window</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-[11px]"
            onClick={() => {
              setOpen(false);
              setView("radar");
            }}
          >
            Full radar <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TickerRow({ row, onPin }: { row: TrackedModelRow; onPin: () => void }) {
  const pm = providerMeta(row.providerId);
  const caps = capsOf(row);
  const bits = [fmtCtx(row.contextWindow), fmtPrice(row), row.free ? "free" : null].filter(Boolean) as string[];
  return (
    <li className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/40">
      <span aria-hidden className="w-5 text-center text-sm">
        {pm.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[12.5px] font-medium">{row.modelId}</span>
          {row.isNew && (
            <Badge variant="secondary" className="h-4 rounded bg-emerald-500/15 px-1 text-[9px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
              new
            </Badge>
          )}
          {row.free && (
            <Badge variant="secondary" className="h-4 rounded bg-amber-500/15 px-1 text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">
              free
            </Badge>
          )}
          {caps &&
            CAP_META.filter((c) => caps[c.key]).map((c) => (
              <span
                key={c.key}
                title={`${c.label} — ${c.hint}`}
                aria-label={`capability: ${c.label}`}
                className={cn("inline-flex h-4 items-center rounded px-1 text-[9px] font-bold", c.cls)}
              >
                {c.glyph}
              </span>
            ))}
        </div>
        <p className="truncate text-[10.5px] text-muted-foreground">
          {pm.label} · {bits.length ? bits.join(" · ") : "pricing n/a"} · first seen {fmtAge(row.firstSeenAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`Copy model id ${row.modelId}`}
          onClick={async () => {
            const ok = await copyText(row.modelId);
            if (ok) toast(`Copied ${row.modelId}`, { icon: "📋" });
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={onPin}>
          Pin
        </Button>
      </div>
    </li>
  );
}
