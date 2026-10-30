"use client";

import * as React from "react";
import { Activity, ArrowRight, Copy, RefreshCw, Search, Satellite } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/helpers";
import { relayHealthSnapshot, relayHopBadge, type RelayHealthBadge, type RelayHealthEntry } from "@/lib/relay";
import { useSettingsStore, useUiStore } from "@/lib/stores";
import {
  fmtAge,
  fmtCtx,
  fmtPrice,
  providerMeta,
  parseTrackerMirror,
  TRACKER_CACHE_KEY,
  TRACKER_LAST_SEEN_KEY,
  type TrackerMirrorBoot,
  type TrackedModelRow,
  type TrackerData,
} from "@/lib/tracker-types";
import { usePinModel } from "./use-pin-model";
import { apiJson } from "@/lib/api-fetch";

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

// r210: boot paint DISTINGUISHES "no cache" from "corrupt cache" via
// parseTrackerMirror (tracker-types). A corrupt mirror row used to be
// swallowed forever (silent catch re-failing every boot, zero diagnosis); the
// boot effect heals it by removing the bad row and says so.
function bootFromMirror(): TrackerMirrorBoot {
  try {
    return parseTrackerMirror(localStorage.getItem(TRACKER_CACHE_KEY));
  } catch {
    return { kind: "corrupted" }; // localStorage itself unavailable (private mode)
  }
}

// r416 mirror audit: the mirror exists ONLY for the ticker's boot paint — the
// radar view fetches /api/tracker live, and the ticker renders at most 60 rows
// (panel) / 30 (marquee). The old 120-row / 40-event mirror stored double the
// renderable surface (its own boot trim raced nothing; rows 61+ were never
// rendered by anything), which made it the largest key in localStorage — the
// exact budget the r415 storage meter now exposes. Trimmed to 60/12 with the
// TRUE lane count carried in trackedTotal so "N lanes watched" stays honest
// while the mirror is trimmed. Live refresh overwrites this seconds later.
function saveCache(data: TrackerData): void {
  try {
    localStorage.setItem(
      TRACKER_CACHE_KEY,
      JSON.stringify({
        at: Date.now(),
        tracked: data.tracked.slice(0, 60),
        events: data.events.slice(0, 12),
        trackedTotal: data.tracked.length,
        lastSyncAt: data.status.lastSyncAt,
      })
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
  // r210: one-shot amber note for the corrupt-mirror heal (rare, surprising,
  // and previously invisible). The r151 retry system owns the failure UX for
  // fetches; this state only reports the healed boot.
  const [syncNote, setSyncNote] = React.useState<string | null>(null);
  // r434: the panel renders 60 rows, but the live API returns the FULL lane
  // set (160 at survey time) — and the header says "N lanes watched" right
  // above a list that silently showed 60 of them. A query searches the FULL
  // tracked array so lanes 61+ are reachable (and pinnable) from the ticker;
  // when idle, the cap is stated in the footer instead of hidden.
  const [query, setQuery] = React.useState("");

  const setView = useUiStore((s) => s.setView);
  const vyceKey = useSettingsStore((s) => s.settings.providerKeys?.vyce?.key ?? "");

  const syncNowRef = React.useRef<() => Promise<void>>(async () => {});
  // r175: the last-seen watermark lives in a ref, not just localStorage —
  // apply() is read-modify-write, and two overlapping refreshes (StrictMode
  // boot double-fire, a retry timer colliding with the 15-min poll, rapid
  // visibilitychange bursts) both read the SAME stale localStorage value,
  // computed identical "unseen" lists and toasted duplicate
  // "New model spotted" announcements. The ref is read and updated
  // synchronously inside apply(), so the second apply always sees the
  // first's write and finds nothing left to announce.
  const lastSeenRef = React.useRef<number>(0);

  // Merge fetched data + fire unseen-event toasts.
  const apply = React.useCallback((fresh: TrackerData, announce: boolean) => {
    setData(fresh);
    saveCache(fresh);
    if (announce) {
      try {
        const lastSeen =
          lastSeenRef.current || Number(localStorage.getItem(TRACKER_LAST_SEEN_KEY) ?? 0);
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
        const newest = fresh.events.reduce((acc, e) => {
          // r210: NaN guard — a malformed createdAt previously poisoned
          // Math.max into NaN, and lastSeen="NaN" (plus the r175 ref, which
          // would cache the NaN for the whole page load) silently killed
          // every future toast.
          const t = new Date(e.createdAt).getTime();
          return Number.isFinite(t) ? Math.max(acc, t) : acc;
        }, Number.isFinite(lastSeen) ? lastSeen : Date.now());
        // r466: the ref AND the persisted watermark must move together and only
        // on a finite value — the r210 bug class was exactly a non-finite seed
        // writing "NaN" here, which then silently killed every future toast.
        if (Number.isFinite(newest)) {
          lastSeenRef.current = newest;
          localStorage.setItem(TRACKER_LAST_SEEN_KEY, String(newest));
        }
      } catch {
        /* best-effort announcements */
      }
    }
  }, []);

  const failsRef = React.useRef(0);
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = React.useRef<() => void>(() => {});

  const refresh = React.useCallback(
    async (announce: boolean) => {
      try {
        // r783: apiJson death-window guard - idempotent read, retry-safe;
        // the HTML-page detect joins the 5s/15s/60s backoff ladder below.
        const { res, json } = await apiJson<TrackerData>("/api/tracker", { cache: "no-store" });
        if (!res.ok) throw new Error(`tracker HTTP ${res.status}`);
        const fresh = json;
        failsRef.current = 0;
        apply(fresh, announce);
        if (fresh.status.stale) void syncNowRef.current();
      } catch {
        // r151: a failed fetch used to strand the ticker DARK — with no
        // localStorage cache the strip renders null entirely, and the next
        // attempt was a full 15-min poll away. Dev servers restart
        // constantly; recover in seconds instead. Short backoff (5s / 15s /
        // 60s), then the normal cadence takes over via POLL_MS. The cached
        // strip keeps painting meanwhile — this path only matters when there
        // is nothing to paint yet, or the cache has gone stale.
        const delay = [5_000, 15_000, 60_000][Math.min(failsRef.current, 2)];
        failsRef.current += 1;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => refreshRef.current(), delay);
      }
    },
    [apply]
  );
  refreshRef.current = () => void refresh(true);

  const syncNow = React.useCallback(
    async (announce = true) => {
      setSyncing(true);
      try {
        // r783: apiJson guard, retries 0 - action route (forces an external
        // source sync), the retry decision stays with the user button.
        const { json } = await apiJson(
          "/api/tracker",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-nexus-csrf": "1" },
            body: JSON.stringify(vyceKey ? { force: true, vyceKey } : { force: true }),
          },
          { retries: 0 },
        );
        const out = json as { skipped?: boolean; reason?: string; newModels?: number };
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
    const boot = bootFromMirror();
    if (boot.kind === "data") setData(boot.data);
    if (boot.kind === "corrupted") {
      // r210: heal — remove the unreadable row so it can't re-fail every boot.
      try {
        localStorage.removeItem(TRACKER_CACHE_KEY);
      } catch {
        /* private mode — nothing more we can do */
      }
      console.warn("[tracker] cache mirror unreadable — healed (removed corrupt row), rebuilding from live");
      setSyncNote("cache mirror was corrupt — healed, rebuilding from live data");
    }
    void refresh(true);
    const iv = setInterval(() => void refresh(true), POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [refresh]);

  const feed = data ? tickerFeed(data) : [];
  // r434: panel search over the FULL lane set (not just the rendered 60).
  const { panelRows, matchCount, queryActive } = React.useMemo(() => {
    if (!data) return { panelRows: [], matchCount: 0, queryActive: false };
    const q = query.trim().toLowerCase();
    if (!q) return { panelRows: data.tracked.slice(0, 60), matchCount: data.tracked.length, queryActive: false };
    const matches = data.tracked.filter(
      (m) =>
        m.modelId.toLowerCase().includes(q) ||
        (m.displayName ?? "").toLowerCase().includes(q) ||
        m.providerId.toLowerCase().includes(q) ||
        providerMeta(m.providerId).label.toLowerCase().includes(q)
    );
    return { panelRows: matches.slice(0, 60), matchCount: matches.length, queryActive: true };
  }, [data, query]);
  // r74: rotator verdicts inline in the tracker — the ClawLabs/free-ai-models
  // doctrine (their ok/sick/dead column) on OUR hop memory. TrackedModelRow.id
  // IS "providerId::modelId" = the rotator's hopKey, so rows light up with
  // zero join logic. Never-dialed lanes stay unmarked (no data, no opinion).
  const healthMap = React.useMemo(() => (data ? relayHealthSnapshot() : null), [data]);
  const newCount = data ? data.tracked.filter((m) => m.isNew).length : 0;
  const freeCount = data ? data.tracked.filter((m) => m.free).length : 0;
  const syncedRel = data?.status.lastSyncAt ? fmtAge(data.status.lastSyncAt) : "never";

  // r469: the pin contract lives in usePinModel now (shared with the radar
  // tab); the popover close rides along on the success path only — the
  // no-chat branch leaves the strip open so the redirect is visible.
  const pinModel = usePinModel("the model tracker", () => setOpen(false));

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

        {/* Marquee — duplicated track for a seamless loop, decorative copy hidden.
            r148 MEASURED verdict (scripts/cdp-qa-ticker-perf.mjs, N-series 5/5):
            this is a pure compositor animation — ΔLayout=0, ΔScript≈22ms/2.5s,
            ΔNodes=0 over the window, RAF locked at 16.7ms, 0 long tasks, and
            RecalcStyleCount identical with the animation running vs paused
            (8 vs 8 per 1.5s). The frame-rate style recalc seen under an active
            rAF loop is instrument reactivity, NOT ticker cost. Do not "fix"
            this marquee without new live evidence it hurts. */}
        <div className="relative min-w-0 flex-1 overflow-hidden" aria-hidden>
          <div className="ticker-track flex w-max items-center gap-6 whitespace-nowrap">
            {[0, 1].map((dup) => (
              <div key={dup} className="flex items-center gap-6">
                {feed.map((m) => {
                  const pm = providerMeta(m.providerId);
                  const hb = healthMap ? relayHopBadge(m.providerId, m.modelId, healthMap) : undefined;
                  const bits = [fmtCtx(m.contextWindow), fmtPrice(m), m.free ? "free" : null].filter(Boolean);
                  return (
                    <span key={`${dup}-${m.id}`} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                      {hb && (
                        <span
                          aria-hidden
                          title={`${m.modelId}: relay verdict ${hb.label}`}
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            hb.tone === "emerald" && "bg-emerald-500",
                            hb.tone === "amber" && "bg-amber-500",
                            hb.tone === "muted" && "bg-muted-foreground/50"
                          )}
                        />
                      )}
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
                Watcher polls every 4-8h · synced {syncedRel} · {data.status.trackedTotal ?? data.tracked.length} lanes watched
                {syncNote && <span className="text-amber-600 dark:text-amber-400"> · {syncNote}</span>}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Sync now" disabled={syncing} onClick={() => void syncNow(true)}>
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
          </Button>
        </div>

        {/* r434: search across every watched lane — the old list hard-capped
            at 60 rows with no way to reach (or pin) older lanes 61+. */}
        <div className="border-b px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all lanes…"
              aria-label="Search tracked models"
              className="h-7 w-full rounded-md border bg-transparent pl-7 pr-2 text-[12px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            />
          </div>
          {queryActive && (
            <p aria-live="polite" className="mt-1.5 text-[10.5px] text-muted-foreground">
              {matchCount === 0
                ? "No lanes match — ids, display names and provider labels all count."
                : `${matchCount} of ${data.tracked.length} lanes match${matchCount > 60 ? " · showing first 60" : ""}`}
            </p>
          )}
        </div>

        <ScrollArea className="max-h-[46vh]">
          {panelRows.length === 0 ? (
            <p className="px-3 py-6 text-center text-[11.5px] text-muted-foreground">
              No lanes match “{query.trim()}”.
            </p>
          ) : (
            <ul className="divide-y">
              {panelRows.map((m) => (
                <TickerRow key={m.id} row={m} onPin={() => pinModel(m)} health={healthMap} />
              ))}
            </ul>
          )}
        </ScrollArea>

        <div className="flex items-center justify-between border-t px-3 py-2">
          <span className="text-[10.5px] text-muted-foreground">
            NEW = caught within the last 48h firsthand window
            {!queryActive && data.tracked.length > 60 && (
              <> · showing 60 of {data.tracked.length} — search or the full radar reach the rest</>
            )}
          </span>
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

const TONED_BADGE: Record<RelayHealthBadge["tone"], string> = {
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  muted: "border-border bg-muted/50 text-muted-foreground",
};

function TickerRow({
  row,
  onPin,
  health,
}: {
  row: TrackedModelRow;
  onPin: () => void;
  health: Record<string, RelayHealthEntry> | null;
}) {
  const pm = providerMeta(row.providerId);
  const hb = health ? relayHopBadge(row.providerId, row.modelId, health) : undefined;
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
          {hb && (
            <Badge
              variant="outline"
              title={hb.detail ? `${row.modelId}: ${hb.detail}` : `${row.modelId}: ${hb.label} on the relay`}
              className={cn("h-4 rounded px-1 text-[9px] font-bold uppercase", TONED_BADGE[hb.tone])}
            >
              {hb.label}
            </Badge>
          )}
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
            else toast.error("Copy failed — select the id and copy manually");
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-[11px]"
          aria-label={`Pin ${row.modelId} in this chat`}
          onClick={onPin}
        >
          Pin
        </Button>
      </div>
    </li>
  );
}
