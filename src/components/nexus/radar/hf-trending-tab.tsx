"use client";

// ─── HF Trending tab (r424, survey slice 3) ─────────────────────────────────
// Mechanical move out of radar-view.tsx per the r422 decomposition plan —
// types, HF cache keys, the Hub-section radio config, and the tab component,
// verbatim. No code edits beyond the move: this tab's catch block was already
// rewired to the shared isTimeoutError() predicate in radar-shared (r423).

import * as React from "react";
import {
  ArrowUpRight,
  Boxes,
  Database,
  Download,
  ExternalLink,
  Heart,
  Search,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/nexus/atoms";
import { cn } from "@/lib/utils";
import {
  CacheStatus,
  CardGridSkeleton,
  Chip,
  ErrorBox,
  isTimeoutError,
  readCache,
  writeCache,
} from "./radar-shared";

const HF_CACHE_KEY = "nexus-radar-hf";
const HF_KIND_KEY = "nexus-radar-hf-kind";

const HF_LIMIT = 30;

// ─── Types ───────────────────────────────────────────────────────────────────

interface HfItem {
  id: string;
  likes?: number;
  downloads?: number;
  pipeline_tag?: string;
  library_name?: string;
}

interface HfCache {
  fetchedAt: number;
  models: HfItem[];
  datasets: HfItem[];
  spaces: HfItem[];
  /** r501: the server proxy answered with the owner's HF PAT attached
   * (db/hf-token.txt) — higher Hub rate limits + gated repos visible. */
  authed?: boolean;
}

type HfKind = "models" | "datasets" | "spaces";

// ─── HF Trending tab ─────────────────────────────────────────────────────────

const HF_KINDS: { id: HfKind; label: string; icon: React.ElementType; path: string }[] = [
  { id: "models", label: "Models", icon: Boxes, path: "models" },
  { id: "datasets", label: "Datasets", icon: Database, path: "datasets" },
  { id: "spaces", label: "Spaces", icon: ExternalLink, path: "spaces" },
];

function hfHref(kind: HfKind, id: string): string {
  if (kind === "datasets") return `https://huggingface.co/datasets/${id}`;
  if (kind === "spaces") return `https://huggingface.co/spaces/${id}`;
  return `https://huggingface.co/${id}`;
}

export function HfTrendingTab() {
  const [cache, setCache] = React.useState<HfCache | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // r468: when only SOME Hub sections fail their refresh, the surviving boards
  // still render — this amber status line names the gap instead of hiding it.
  const [partialNote, setPartialNote] = React.useState<string | null>(null);
  const [kind, setKindState] = React.useState<HfKind>(() => {
    const saved = readCache<HfKind>(HF_KIND_KEY);
    return saved === "models" || saved === "datasets" || saved === "spaces"
      ? saved
      : "models";
  });
  // r240: the picked Hub section survives remounts — same treatment the
  // GitHub tab already gives its username. Switching views no longer snaps
  // the radio back to "models" while the datasets/spaces cache is intact.
  const setKind = (k: HfKind) => {
    setKindState(k);
    writeCache(HF_KIND_KEY, k);
  };
  const didAuto = React.useRef(false);

  const fetchTrending = React.useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    setPartialNote(null);
    try {
      const kinds: HfKind[] = ["models", "datasets", "spaces"];
      const attempts = await Promise.allSettled(
        kinds.map(async (k) => {
          // r139: routed through our own /api/radar/hf proxy — the last of
          // the three radar sources to leave the browser (GitHub Stars and
          // Paper Radar already hop through the server). Same egress path,
          // same { error } classification, no silent CSP/egress surprises.
          const res = await fetch(`/api/radar/hf?kind=${k}&limit=${HF_LIMIT}`, {
            signal: AbortSignal.timeout(25_000),
          });
          const data = (await res.json().catch(() => null)) as
            | { items?: HfItem[]; error?: string; authed?: boolean }
            | null;
          if (!res.ok) {
            throw new Error(
              data?.error ?? `Hugging Face API (${k}) returned HTTP ${res.status}.`
            );
          }
          if (!data || !Array.isArray(data.items)) {
            throw new Error(`Unexpected Hugging Face response for ${k}.`);
          }
          return [k, data.items, data.authed === true] as const;
        })
      );
      // r468: this used to be Promise.all — one flaky Hub endpoint threw away
      // BOTH good boards: cache untouched, a full-width error box, and a retry
      // that re-fetched everything. The three kinds are independent upstreams;
      // keep what answered. Merge rule: a failed kind falls back to its
      // previous rows (if any) instead of being wiped, and fetchedAt only
      // advances on a FULL success so the cache stamp never claims fresher
      // than the oldest board on screen.
      const failed: HfKind[] = [];
      for (let i = 0; i < kinds.length; i++) {
        if (attempts[i].status === "rejected") failed.push(kinds[i]);
      }
      if (failed.length === kinds.length) {
        // r478: all-fail used to rethrow the FIRST rejection verbatim, so the
        // user saw an error about "models" even when datasets and spaces were
        // down too. Name every dead section — the same truthfulness the r468
        // partial-note brought to partial failures — and keep one underlying
        // reason as the "why" instead of a bare "Could not fetch".
        const first = attempts.find(
          (a): a is PromiseRejectedResult => a.status === "rejected"
        );
        const raw = first?.reason;
        const why =
          raw instanceof Error ? raw.message : raw ? String(raw) : "unknown error";
        throw new Error(
          `All three Hub sections failed (${kinds.join(" + ")}) — reason: ${why}.`
        );
      }
      const next: HfCache = {
        fetchedAt: cache?.fetchedAt ?? 0,
        models: cache?.models ?? [],
        datasets: cache?.datasets ?? [],
        spaces: cache?.spaces ?? [],
        authed: cache?.authed ?? false,
      };
      for (let i = 0; i < kinds.length; i++) {
        const a = attempts[i];
        if (a.status === "fulfilled") next[kinds[i]] = a.value[1];
      }
      // r501: any successful section proves whether the proxy is authed.
      next.authed = attempts.some(
        (a) => a.status === "fulfilled" && a.value[2]
      );
      if (failed.length === 0 || !cache) next.fetchedAt = Date.now();
      setCache(next);
      writeCache(HF_CACHE_KEY, next);
      if (failed.length > 0) {
        setPartialNote(
          `${failed.join(" + ")} failed to refresh — ${failed.length === 1 ? "that section keeps" : "those sections keep"} the previous board if one exists; hit Refresh to try again.`
        );
      }
    } catch (err) {
      const message = isTimeoutError(err)
        ? "Hugging Face took too long to answer — try again."
        : err instanceof Error
          ? err.message
          : "Could not fetch HF trending.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [loading, cache]);

  // First open of the tab = the explicit trigger; afterwards cache-only.
  React.useEffect(() => {
    if (didAuto.current) return;
    didAuto.current = true;
    const cached = readCache<HfCache>(HF_CACHE_KEY);
    if (cached) {
      setCache(cached);
    } else {
      void fetchTrending();
    }
  }, [fetchTrending]);

  const items = cache ? cache[kind] : [];
  const kindMeta = HF_KINDS.find((k) => k.id === kind)!;

  // r287: keyword filter — the GitHub Stars tab has had one for ages, but the
  // HF board (30 items × 3 kinds) rendered everything with no way to narrow
  // it. Client-side live filter (no Enter/IME path), matching id, pipeline
  // tag and library name; the honest count line below mirrors the GitHub tab.
  const [hfQuery, setHfQuery] = React.useState("");
  const filtered = React.useMemo(() => {
    const q = hfQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      `${it.id} ${it.pipeline_tag ?? ""} ${it.library_name ?? ""}`.toLowerCase().includes(q)
    );
  }, [items, hfQuery]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="radiogroup"
          aria-label="Hub section"
          className="flex overflow-hidden rounded-lg border"
        >
          {HF_KINDS.map(({ id, label, icon: Icon }) => {
            const active = kind === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setKind(id)}
                className={cn(
                  "flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors",
                  id !== "models" && "border-l",
                  active
                    ? "bg-violet-500/15 text-violet-500 dark:text-violet-400"
                    : "text-muted-foreground hover:bg-muted"
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
        {cache?.authed ? (
          <span
            className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400"
            title="Hub calls carry the owner's HF token (db/hf-token.txt, gitignored) — higher rate limits, gated repos visible. Rotate by editing that file; no restart needed."
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
            HF auth
          </span>
        ) : null}
        <div className="relative ml-auto">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={hfQuery}
            onChange={(e) => setHfQuery(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter HF items by keyword"
            className="h-8 w-32 pl-8 text-xs sm:w-44"
          />
        </div>
        <div>
          <CacheStatus
            fetchedAt={cache?.fetchedAt}
            onRefresh={() => void fetchTrending()}
            refreshing={loading}
            staleAfterMs={6 * 3_600_000}
          />
        </div>
      </div>

      {error ? <ErrorBox message={error} onRetry={() => void fetchTrending()} /> : null}

      {/* r302: refreshing a CACHED board used to show only the spinner inside
          the Refresh button — up to 25 silent seconds (three Hub calls race
          the 25s timeout) that felt identical to a dead click. The GitHub tab
          already prints an inline, aria-live "Refreshing from GitHub…" line
          in the same situation; this is that parity. */}
      {loading && cache ? (
        <p className="text-[11px] text-muted-foreground" aria-live="polite">
          Refreshing from the Hugging Face Hub…
        </p>
      ) : null}

      {partialNote ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-400" role="status">
          {partialNote}
        </p>
      ) : null}

      {loading && !cache ? (
        <CardGridSkeleton count={6} />
      ) : (
        <>
        <div
          className="max-h-[62vh] overflow-y-auto pr-1"
          role="region"
          aria-label={`Trending ${kind}`}
        >
          {items.length === 0 ? (
            <EmptyState
              emoji="🤗"
              title={`No ${kindMeta.label.toLowerCase()} cached`}
              description="Hit Refresh to pull the current trending board from the Hugging Face Hub."
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              emoji="🔭"
              title="Nothing matches"
              description="Clear the filter or hit Refresh for a fresh board."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((item) => (
                <Card key={`${kind}-${item.id}`} className="card-lift flex flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={hfHref(kind, item.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${item.id} on Hugging Face`}
                      className="group flex min-w-0 items-center gap-1.5 font-mono text-xs font-semibold transition-colors hover:text-violet-500 dark:hover:text-violet-400"
                    >
                      <span className="truncate">{item.id}</span>
                      <ArrowUpRight
                        className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    </a>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {item.pipeline_tag ? <Chip>{item.pipeline_tag}</Chip> : null}
                    {item.library_name ? <Chip>{item.library_name}</Chip> : null}
                  </div>

                  <div className="mt-auto flex items-center gap-3 pt-1 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1" title="Likes">
                      <Heart className="h-3 w-3 text-rose-500" aria-hidden />
                      {(item.likes ?? 0).toLocaleString()}
                    </span>
                    {item.downloads != null ? (
                      <span className="flex items-center gap-1" title="Downloads">
                        <Download className="h-3 w-3" aria-hidden />
                        {item.downloads.toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
        {items.length > 0 ? (
          <p className="text-[11px] text-muted-foreground" aria-live="polite">
            {filtered.length} of {items.length} {kindMeta.label.toLowerCase()}
            {hfQuery.trim() ? <> matching &ldquo;{hfQuery.trim()}&rdquo;</> : null}
          </p>
        ) : null}
        </>
      )}
    </div>
  );
}
