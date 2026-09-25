"use client";

import * as React from "react";
import { RefreshCw, Satellite, Signal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/helpers";
import { useSettingsStore } from "@/lib/stores";
import { ModelOddsCard } from "@/components/praison/tracker/model-odds-card";
import {
  CAP_META,
  capsOf,
  declaresNoTools,
  fmtAge,
  fmtCtx,
  fmtPrice,
  providerMeta,
  type ModelCaps,
  type TrackedModelRow,
  type TrackerData,
  type TrackerSourceHealth,
} from "@/lib/tracker-types";

// ─── Radar → "Models" tab (r28) ──────────────────────────────────────────────
// The full-screen companion to the ticker: every watched lane with NEW/FREE
// badges, per-source health, manual sync (carries the Vyce vault key per-
// request — BYOK), and the HuggingFace early-signal feed.

type Filter = "all" | "new" | "free" | "tools";

export function ModelRadarTab() {
  const [data, setData] = React.useState<TrackerData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("all");

  const vyceKey = useSettingsStore((s) => s.settings.providerKeys?.vyce?.key ?? "");

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/tracker", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as TrackerData);
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const sync = React.useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-praison-csrf": "1" },
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
  const filtered = tracked.filter((m) =>
    filter === "new" ? m.isNew : filter === "free" ? m.free : filter === "tools" ? capsOf(m)?.tools === true : true
  );
  const newCount = tracked.filter((m) => m.isNew).length;
  const freeCount = tracked.filter((m) => m.free).length;
  const toolsCount = tracked.filter((m) => capsOf(m)?.tools === true).length;
  const sources: TrackerSourceHealth[] = data?.sources ?? [];

  return (
    <div className="space-y-4">
      {/* ── Model Odds — launch forecast (r51, fleet intel for the ranks doctrine) ── */}
      <ModelOddsCard />

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
                ["tools", `🔧 Tools · ${toolsCount}`],
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
              {data?.status.lastSyncAt ? `last sync ${fmtAge(data.status.lastSyncAt)}` : "never synced"}
            </span>
          </div>
          {/* r45 capability legend — glyphs mean catalog-declared support only */}
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-muted-foreground">
            <span className="font-medium uppercase tracking-wide opacity-80">caps:</span>
            {CAP_META.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1" title={c.hint}>
                <span aria-hidden className={cn("rounded px-1 text-[9.5px] font-semibold", c.cls)}>
                  {c.glyph}
                </span>
                {c.label}
              </span>
            ))}
            <span className="opacity-70">— declared by OpenRouter/Kilo catalogs; sources without data show no glyphs (unknown ≠ no)</span>
          </p>
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
            {sources.length === 0 && !loading && <span className="text-[11px] text-muted-foreground">No sync yet — hit “Sync now”.</span>}
          </div>
        </CardContent>
      </Card>

      {/* ── Watched lanes ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px]">
            Watched lanes <span className="text-[11px] font-normal text-muted-foreground">({filtered.length} shown)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="space-y-2" aria-busy>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted/60" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-muted-foreground">
              {filter === "new"
                ? "No brand-new lanes in the current 48h window — the watcher will flag them the moment they appear."
                : filter === "tools"
                  ? "No tool-calling lanes captured yet — sync once; OpenRouter/Kilo rows carry capability data."
                  : "Nothing tracked yet — hit “Sync now” to take the first snapshot."}
            </p>
          ) : (
            <div className="max-h-[52vh] overflow-y-auto pr-1">
              <ul className="divide-y rounded-md border">
                {filtered.slice(0, 120).map((m) => (
                  <RadarLaneRow key={m.id} row={m} />
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
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-56 overflow-y-auto pr-1">
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {data!.signals.slice(0, 24).map((s) => (
                  <li key={s.id} className="rounded-md border px-2.5 py-1.5">
                    <p className="truncate font-mono text-[11.5px] font-medium">{s.modelId}</p>
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

/** One radar lane: source glyph + id + NEW/FREE + capability badges + copy. */
function RadarLaneRow({ row }: { row: TrackedModelRow }) {
  const caps = capsOf(row);
  return (
    <li className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-accent/40">
      <span aria-hidden className="w-5 text-center text-sm">
        {providerMeta(row.providerId).glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
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
          {providerMeta(row.providerId).label} ·{" "}
          {[fmtCtx(row.contextWindow), fmtPrice(row)].filter(Boolean).join(" · ") || "pricing n/a"} · first seen{" "}
          {fmtAge(row.firstSeenAt)}
          {declaresNoTools(row) && (
            <span
              className="ml-1 text-amber-600 dark:text-amber-400"
              title="Catalog does not declare tool calling — solo chat only; agent/pipeline steps that pass tools may fail"
            >
              · no tools
            </span>
          )}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 text-[11px]"
        onClick={async () => {
          const ok = await copyText(row.modelId);
          if (ok) toast(`Copied ${row.modelId}`, { icon: "📋" });
        }}
      >
        Copy id
      </Button>
    </li>
  );
}
