"use client";

// ─── Radar shared layer (r422, survey slice 1) ──────────────────────────────
// The r422 survey of radar-view.tsx (1,100 lines, four tabs) found the file
// cleanly sectioned but carrying a shared bottom layer every tab depends on:
// guarded localStorage helpers, the relative-time formatter, and five UI
// atoms (cache status, error box, skeleton grid, chips). This file is the
// dependency-free root of the decomposition DAG — extracting it FIRST is what
// makes the later tab slices (github-stars-tab, hf-trending-tab,
// paper-radar-tab) mechanical moves instead of circular gymnastics.
//
// Doctrine preserved verbatim from radar-view: every localStorage access is
// guarded (the radar never throws on a stale key), CacheStatus's staleness is
// display-only (no auto-refetch — the R5 QA gate guards cache-first egress),
// and the stale stamp deepens on a minute tick while the tab sits open.

import * as React from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtRel } from "@/lib/helpers";
import { cn } from "@/lib/utils";

// ─── localStorage helpers (all reads/writes guarded — radar never throws) ────

export function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — the radar works without persistence */
  }
}

/** Shared relative-time for cache stamps and repo pushes. */
export function relTime(ts: number | string): string {
  const n = typeof ts === "string" ? new Date(ts).getTime() : ts;
  return Number.isFinite(n) ? fmtRel(n) : "unknown";
}

/** r423: the friendly-timeout predicate — the /timeout|timed? ?out/i regex
 * lived copy-pasted in all three radar tabs' catch blocks; one copy here is
 * the fixable one. The per-source timeout MESSAGES stay at the call sites. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && /timeout|timed? ?out/i.test(err.message);
}

// ─── Small shared UI pieces ──────────────────────────────────────────────────

/** "cached 5m ago · Refresh" header row used by every tab. */
export function CacheStatus({
  fetchedAt,
  onRefresh,
  refreshing,
  extra,
  staleAfterMs,
}: {
  fetchedAt?: number;
  onRefresh: () => void;
  refreshing: boolean;
  extra?: React.ReactNode;
  /** r160: past this age the cache stamp turns amber + "stale" — a week-old
   * trending board used to look identical to a 5-minute-old one. TTLs are
   * per-tab (HF boards rotate fastest, GitHub stars slowest). Display-only:
   * no auto-refetch — the R5 QA gate guards the cache-first egress doctrine. */
  staleAfterMs?: number;
}) {
  // Minute tick so the stale state appears (and deepens) on its own while the
  // tab sits open — only the active tab is mounted (Radix unmounts the rest).
  const [, tickNow] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (fetchedAt == null || staleAfterMs == null) return;
    const t = setInterval(tickNow, 60_000);
    return () => clearInterval(t);
  }, [fetchedAt, staleAfterMs]);
  const stale =
    fetchedAt != null && staleAfterMs != null && Date.now() - fetchedAt > staleAfterMs;
  return (
    <div className="flex items-center gap-2">
      {extra}
      {fetchedAt ? (
        <span
          className={cn(
            "text-[11px]",
            stale ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground"
          )}
          aria-live="polite"
          title={stale ? "This cache is older than usual — hit Refresh for fresh results" : undefined}
        >
          cached {relTime(fetchedAt)}
          {stale ? " · stale" : ""}
        </span>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh results"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
        Refresh
      </Button>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
      <Button variant="outline" size="sm" className="h-8 shrink-0" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        Retry
      </Button>
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="space-y-3 p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-4 w-12 rounded-full" />
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Muted chip — used for topics, pipeline tags and link-outs alike. */
export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}

/** Outbound link chip (arXiv / alphaXiv / PDF / repo). */
export function LinkChip({
  href,
  children,
  ariaLabel,
}: {
  href: string;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400"
    >
      {children}
      <ArrowUpRight className="h-2.5 w-2.5" aria-hidden />
    </a>
  );
}
