"use client";

import * as React from "react";
import { Check, RefreshCw, Satellite, Search, Signal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/helpers";
import { useSettingsStore } from "@/lib/stores";
// r503: the Radar → Relay adoption pipeline — absorb on every tracker load,
// plus the manual Adopt affordance per watched-lane row (lane-adopt.ts is the
// single registry; Settings → Model relay renders and manages the same list).
import { absorbTrackerLanes, adoptLane, adoptedLanesSnapshot } from "@/lib/lane-adopt";
import { providerById } from "@/lib/providers";
import {
  fmtAge,
  fmtCtx,
  fmtPrice,
  providerMeta,
  type TrackerData,
  type TrackerSourceHealth,
  type TrackedModelRow,
} from "@/lib/tracker-types";
import { usePinModel } from "./use-pin-model";

// ─── Radar → "Models" tab (r28) ──────────────────────────────────────────────
// The full-screen companion to the ticker: every watched lane with NEW/FREE
// badges, per-source health, manual sync (carries the Vyce vault key per-
// request — BYOK), and the HuggingFace early-signal feed.

type Filter = "all" | "new" | "free";

/** r219: matches the always-on ticker's cadence (model-ticker.tsx POLL_MS). */
const POLL_MS = 15 * 60_000;

/** r283/r290: the HF early-signals card renders at most this many rows —
 *  when the server delivers more, the header must SAY so (honest truncation,
 *  r273 doctrine) instead of silently dropping the tail. */
const SIGNALS_CAP = 24;

export function ModelRadarTab() {
  const [data, setData] = React.useState<TrackerData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("all");
  // r411: a failed FIRST load used to be indistinguishable from an empty
  // tracker — both rendered "Nothing tracked yet / No sync yet / never synced",
  // false claims whenever /api/tracker 500'd (r273 honesty doctrine: never
  // state what you cannot know). loadFailed gates those three strings;
  // keep-previous on REFRESH failures stays r219 doctrine (no flicker) and
  // never flips the copy while real data is on screen.
  const [loadFailed, setLoadFailed] = React.useState(false);
  // r435: the radar promises "every watched lane" (see the header comment)
  // but the list body caps at 120 (r273) — with 160 live lanes, 40 were
  // invisible in the one view meant to be the full picture, and the ticker's
  // r434 panel search was the only UI that reached them. Search filters the
  // chip-filtered set BEFORE the render cap, so every lane is reachable here
  // as well; the caption reports the match set while searching.
  const [query, setQuery] = React.useState("");

  const vyceKey = useSettingsStore((s) => s.settings.providerKeys?.vyce?.key ?? "");

  // r467: the pin affordance — this full-screen companion (the view that
  // promises "every watched lane") could only COPY a lane before it; r469
  // moved the shared contract into usePinModel, one hook for ticker + radar.
  const pinModel = usePinModel("the model radar");

  // ── r503: Radar → Relay adoption pipeline ──────────────────────────────
  // Owner directive: "free radar new findings should be added related
  // locations and providers with correct tags in first seen automatically —
  // we need that pipeline automation". Tracker rows landing HERE is the
  // "first seen" moment, so every successful load runs the absorb step from
  // lane-adopt.ts: brand-new FREE lanes of KNOWN providers register into the
  // relay lane registry with their full tag set (provider, ctx, $-per-M,
  // first-seen age) and the very next buildRelayChain() dials them. The
  // toast makes the automation visible instead of silent. autoAdopt reads
  // the live setting (default ON when undefined) via getState() so load()
  // keeps its stable deps.
  const toastedAbsorbRef = React.useRef<Set<string>>(new Set());
  const [adoptTick, setAdoptTick] = React.useState(0);

  const absorb = React.useCallback((rows: TrackedModelRow[]) => {
    const report = absorbTrackerLanes(rows, {
      autoAdopt: useSettingsStore.getState().settings.radarAutoAdopt !== false,
    });
    // Double-toast guard: the tracker re-sends the same rows on every poll
    // and the registry already dedupes the ADD itself — this ref keeps the
    // announcement honest about what THIS session hasn't toasted yet.
    const fresh = report.addedKeys.filter((k) => !toastedAbsorbRef.current.has(k));
    for (const k of fresh) toastedAbsorbRef.current.add(k);
    if (fresh.length > 0) {
      const modelIds = rows.filter((r) => fresh.includes(r.id)).map((r) => r.modelId);
      toast.success(
        `Radar pipeline: ${fresh.length} new free lane${fresh.length === 1 ? "" : "s"} joined the relay`,
        {
          description:
            modelIds.slice(0, 3).join(" · ") +
            (fresh.length > 3 ? ` · +${fresh.length - 3} more` : ""),
        }
      );
    }
    setAdoptTick((t) => t + 1); // "in relay" chips re-evaluate immediately
  }, []);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/tracker", { cache: "no-store" });
      if (res.ok) {
        const next = (await res.json()) as TrackerData;
        setData(next);
        setLoadFailed(false);
        // r503: the first-seen → registry → relay-chain wiring, run on the
        // same success path for boot load, visibility refetch, poll, and the
        // post-sync reload (single choke point, no double registration).
        absorb(next.tracked);
      } else {
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true); // first load: say so; refresh: data kept, no flicker
    } finally {
      setLoading(false);
    }
  }, [absorb]);

  React.useEffect(() => {
    void load();
    // r219 parked-tab staleness: this tab used to fetch EXACTLY once at mount —
    // park the Radar view for an hour and the full table, source health, and
    // HF signals froze, while the always-on ticker above (same /api/tracker
    // endpoint) stayed fresh on its own poll + visibility refetch. The deep
    // view now obeys the same freshness doctrine: refetch the moment the tab
    // becomes visible again, poll on the ticker's 15-min cadence while
    // visible, and dial nothing while hidden (r141 hidden-tab doctrine).
    // load() keeps previous data on failure (no flicker) and is cache:"no-store".
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(iv);
    };
  }, [load]);

  const sync = React.useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-nexus-csrf": "1" },
        body: JSON.stringify(vyceKey ? { force: true, vyceKey } : { force: true }),
      });
      const out = (await res.json()) as { skipped?: boolean; reason?: string; newModels?: number; sources?: { id: string; ok: boolean; models: number }[] };
      if (!out.skipped) {
        const ok = (out.sources ?? []).filter((s) => s.ok).map((s) => `${s.id} (${s.models})`).join(", ");
        toast(`Synced — ${out.newModels ?? 0} new · ${ok || "no sources"}`, { icon: "🛰" });
      } else if (out.reason === "throttled") {
        toast("Sync throttled — try again in a few minutes", { icon: "⏳" });
      }
      await load();
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [vyceKey, load]);

  const tracked = data?.tracked ?? [];
  const chipFiltered = tracked.filter((m) => (filter === "new" ? m.isNew : filter === "free" ? m.free : true));
  // r435: search composes with the All/New/Free chips and runs over the full
  // set — the 120-row render cap applies only to what comes back, never to
  // what the search sees.
  const q = query.trim().toLowerCase();
  const searching = q !== "";
  const filtered = searching
    ? chipFiltered.filter(
        (m) =>
          m.modelId.toLowerCase().includes(q) ||
          (m.displayName ?? "").toLowerCase().includes(q) ||
          m.providerId.toLowerCase().includes(q) ||
          providerMeta(m.providerId).label.toLowerCase().includes(q)
      )
    : chipFiltered;
  const newCount = tracked.filter((m) => m.isNew).length;
  const freeCount = tracked.filter((m) => m.free).length;
  const sources: TrackerSourceHealth[] = data?.sources ?? [];
  const firstLoadFailed = loadFailed && !data;

  // r503: which watched lanes already ride the relay — they render the
  // emerald "in relay" chip instead of the Adopt button. One registry read
  // per render (snapshot Set) instead of isLaneAdopted() ×120 rows; recomputes
  // when fresh tracker data lands (auto-adoptions included) or a manual
  // Adopt bumps adoptTick. r512: RETIRED lanes (removed from the catalog)
  // no longer count as "in relay" — the chip must not promise a dial path
  // the rotation excluded (they re-qualify via the manual Adopt override).
  const adoptedKeys = React.useMemo(
    () =>
      new Set(
        adoptedLanesSnapshot()
          .filter((l) => l.enabled && !l.retired)
          .map((l) => l.key)
      ),
    [data, adoptTick]
  );

  return (
    <div className="space-y-4">
      {/* ── Watcher header ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <Satellite className="h-4 w-4 text-emerald-500" aria-hidden />
              Free &amp; new model tracker
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[12px]" disabled={syncing} onClick={() => void sync()}>
                <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} aria-hidden />
                Sync now{vyceKey ? " (with Vyce key)" : ""}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            A 4-8 hour watcher diffs OpenRouter, OrcaRouter, Pollinations and — when your Vyce key travels with the
            request — Vyce itself. Brand-new lanes flash in the ticker above and here, so you can catch free capacity in
            its first 1-2 days before it gets crowded.
          </p>
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Tracker filters">
            {(
              [
                ["all", `All · ${tracked.length}`],
                ["new", `New · ${newCount}`],
                ["free", `Free · ${freeCount}`],
              ] as [Filter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                aria-pressed={filter === id}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium transition-colors",
                  filter === id
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "border-border text-muted-foreground hover:bg-accent/60"
                )}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-[10.5px] text-muted-foreground">
              {data?.status.lastSyncAt
                ? `last sync ${fmtAge(data.status.lastSyncAt)}`
                : firstLoadFailed
                  ? "sync status unknown — fetch failed"
                  : "never synced"}
            </span>
          </div>
          {/* Source health */}
          <div className="flex flex-wrap gap-1.5">
            {sources.map((s) => (
              <span
                key={s.id}
                title={s.lastError ?? `${s.modelCount} models`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px]",
                  s.lastOk ? "border-border text-muted-foreground" : "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
                )}
              >
                <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", s.lastOk ? "bg-emerald-500" : "bg-red-500")} />
                {s.id} · {s.modelCount}
              </span>
            ))}
            {sources.length === 0 && !loading &&
              (firstLoadFailed ? (
                <span className="text-[11px] text-red-600 dark:text-red-400">
                  Source health unavailable — the tracker API didn’t answer.
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground">No sync yet — hit “Sync now”.</span>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Watched lanes ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px]">
            Watched lanes{" "}
            <span className="text-[11px] font-normal text-muted-foreground">
              {/* The list body caps at 120 rows — the count must not claim
                  more than actually render (r273 honesty fix). r435: while
                  searching, the caption reports the match set instead. */}
              ({searching
                ? `${filtered.length} of ${chipFiltered.length} match${filtered.length > 120 ? " · first 120 shown" : ""}`
                : filtered.length > 120
                  ? `first 120 of ${filtered.length} shown`
                  : `${filtered.length} shown`})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {/* r435: lane search — lanes 121+ were unreachable in the one view
              that promises "every watched lane". */}
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search lanes — ids, display names, providers…"
              aria-label="Search watched lanes"
              className="h-8 w-full rounded-md border bg-transparent pl-7 pr-2 text-[12.5px] outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          {loading ? (
            <div className="space-y-2" aria-busy>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted/60" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            searching ? (
              <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                No lanes match “{query.trim()}” — ids, display names and provider labels all count.
              </p>
            ) : firstLoadFailed ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <p className="text-[12.5px] text-muted-foreground">
                  Couldn’t reach the tracker — showing nothing rather than
                  pretending the watch-list is empty.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-[12px]"
                  onClick={() => void load()}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Retry
                </Button>
              </div>
            ) : (
              <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                {filter === "new"
                  ? "No brand-new lanes in the current 48h window — the watcher will flag them the moment they appear."
                  : "Nothing tracked yet — hit “Sync now” to take the first snapshot."}
              </p>
            )
          ) : (
            <div className="max-h-[52vh] overflow-y-auto pr-1">
              <ul className="divide-y rounded-md border">
                {filtered.slice(0, 120).map((m) => (
                  <li key={m.id} className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/40">
                    <span aria-hidden className="w-5 text-center text-sm">
                      {providerMeta(m.providerId).glyph}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-mono text-[12.5px] font-medium">{m.modelId}</span>
                        {m.isNew && (
                          <Badge variant="secondary" className="h-4 rounded bg-emerald-500/15 px-1 text-[9px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                            new
                          </Badge>
                        )}
                        {m.free && (
                          <Badge variant="secondary" className="h-4 rounded bg-amber-500/15 px-1 text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">
                            free
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-[10.5px] text-muted-foreground">
                        {providerMeta(m.providerId).label} ·{" "}
                        {[fmtCtx(m.contextWindow), fmtPrice(m)].filter(Boolean).join(" · ") || "pricing n/a"} · first seen{" "}
                        {fmtAge(m.firstSeenAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 text-[11px]"
                      aria-label={`Copy model id ${m.modelId}`}
                      onClick={async () => {
                        const ok = await copyText(m.modelId);
                        if (ok) toast(`Copied ${m.modelId}`, { icon: "📋" });
                        else toast.error("Copy failed — select the id and copy manually");
                      }}
                    >
                      Copy id
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1 text-[11px]"
                      aria-label={`Pin ${m.modelId} in this chat`}
                      onClick={() => pinModel(m)}
                    >
                      Pin
                    </Button>
                    {/* r503: Adopt / in-relay affordance — dialable providers
                        only (providerById gate); HuggingFace signal rows and
                        other non-registry lanes stay display-only, matching
                        the lane-adopt policy. Same h-7 density as Copy/Pin. */}
                    {providerById(m.providerId) &&
                      (adoptedKeys.has(m.id) ? (
                        <Badge
                          variant="outline"
                          title={`${m.modelId} dials in the Model Relay chain — manage it in Settings → Model relay`}
                          className="h-7 shrink-0 gap-1 border-emerald-500/40 bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                        >
                          <Check className="h-3 w-3" aria-hidden />
                          in relay
                        </Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 text-[11px]"
                          aria-label={`Adopt ${m.modelId} into the relay chain`}
                          onClick={() => {
                            const res = adoptLane(m, "manual");
                            if (res.added) {
                              setAdoptTick((t) => t + 1);
                              toast.success(`${m.modelId} joined the relay chain`, {
                                description: "Settings → Model relay lists it",
                              });
                            }
                          }}
                        >
                          Adopt
                        </Button>
                      ))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── HF early signals ── */}
      {(data?.signals.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <Signal className="h-4 w-4 text-violet-400" aria-hidden />
              HuggingFace early signals
              <span className="text-[11px] font-normal text-muted-foreground">
                (just-published text-gen repos — watch-list, never alerts)
              </span>
            </CardTitle>
            {data && data.signals.length > SIGNALS_CAP && (
              <p className="text-[11px] text-muted-foreground" aria-live="polite">
                first {SIGNALS_CAP} of {data.signals.length} shown
              </p>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-56 overflow-x-hidden overflow-y-auto pr-1">
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {data!.signals.slice(0, SIGNALS_CAP).map((s) => (
                  <li key={s.id} className="min-w-0 rounded-md border px-2.5 py-1.5">
                    <p className="truncate font-mono text-[11.5px] font-medium" title={s.modelId}>{s.modelId}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {typeof s.meta?.downloads === "number" ? `${s.meta.downloads.toLocaleString()} dl · ` : ""}
                      {typeof s.meta?.likes === "number" ? `${s.meta.likes} ★ · ` : ""}
                      seen {fmtAge(s.lastSeenAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
