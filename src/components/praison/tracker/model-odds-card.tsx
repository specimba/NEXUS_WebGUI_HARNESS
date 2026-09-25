"use client";

import * as React from "react";
import { CalendarClock, ExternalLink, RefreshCw, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtAge } from "@/lib/tracker-types";

// ─── Model Odds — launch-forecast card (r51) ────────────────────────────────
// Reads models.lunarwerx.com (free, keyless) through /api/tracker/odds and
// surfaces which models ship next — fleet intel for the versioned-ranks
// doctrine: an 80% GLM-5.4 window means zai/aihubmix catalog churn is coming.
// HONESTY: upstream numbers are statistical estimates from the public launch
// record, not vendor schedules; the caveat rides through verbatim, and odds
// show their per-estimator SPREAD (never a single fake-precise number).

interface OddsRow {
  company: string;
  companyLabel: string;
  lineKey: string;
  lineLabel: string;
  what?: string;
  currentName?: string;
  currentDate?: string;
  nextName?: string;
  nextAlternative?: string;
  waitDays?: number;
  p30min: number;
  p30max: number;
  q50?: string;
}

interface OddsPayload {
  generatedAt?: string;
  caveat?: string;
  upstreamFetchAt: string;
  rows: OddsRow[];
  errors: string[];
  cached?: boolean;
}

const TOP_N = 10;

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Tone for the 30-day window: hot (≥60%) amber, warm (35–59%) sky, cool muted. */
function oddsTone(max: number): string {
  if (max >= 0.6) return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  if (max >= 0.35) return "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400";
  return "border-border bg-muted/40 text-muted-foreground";
}

export function ModelOddsCard() {
  const [data, setData] = React.useState<OddsPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/tracker/odds", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as OddsPayload);
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const rows = (data?.rows ?? []).slice(0, expanded ? 30 : TOP_N);
  const total = data?.rows.length ?? 0;
  const hot = (data?.rows ?? []).filter((r) => r.p30max >= 0.6).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-[14px]">
            <CalendarClock className="h-4 w-4 text-violet-500" aria-hidden />
            Model Odds — which model ships next?
            {hot > 0 ? (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">
                {hot} hot window{hot === 1 ? "" : "s"}
              </Badge>
            ) : null}
          </CardTitle>
          <div className="flex items-center gap-2">
            <a
              href="https://models.lunarwerx.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              title="LunarWerx Model Odds — free, no key, statistical estimates from the public launch record"
            >
              source <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-[12px]"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                void load();
              }}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {loading ? (
          <div className="space-y-1.5" aria-label="Loading Model Odds">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-md bg-muted/60" />
            ))}
          </div>
        ) : total === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            Upstream unreachable{(data?.errors.length ?? 0) > 0 ? ` — ${data?.errors[0]}` : ""}. Retry with Refresh.
          </p>
        ) : (
          <>
            <ul className="space-y-1" role="list" aria-label="Model launch odds, most likely next first">
              {rows.map((r, i) => {
                const spread = r.p30max - r.p30min;
                return (
                  <li
                    key={`${r.company}-${r.lineKey}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 transition-colors hover:bg-accent/30"
                    title={r.what ?? `${r.companyLabel} ${r.lineLabel} line`}
                  >
                    <span className="w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground">
                      {r.companyLabel}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                      {r.nextName ?? "?"}
                      {r.nextAlternative ? (
                        <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                          (or {r.nextAlternative})
                        </span>
                      ) : null}
                    </span>
                    <span className="hidden truncate text-[11px] text-muted-foreground sm:inline sm:max-w-44" title={`after ${r.currentName ?? "?"}`}>
                      after {r.currentName ?? "?"}
                    </span>
                    {typeof r.waitDays === "number" ? (
                      <span
                        className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
                        title={`${r.waitDays} day(s) since ${r.currentName ?? "the current model"} dropped`}
                      >
                        {r.waitDays}d since drop
                      </span>
                    ) : null}
                    {r.q50 ? (
                      <span
                        className="hidden shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums text-muted-foreground md:inline-flex"
                        title="Median expected-date band (primary estimator)"
                      >
                        <TrendingUp className="h-3 w-3" aria-hidden />
                        {r.q50}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums",
                        oddsTone(r.p30max)
                      )}
                      title={
                        spread > 0.001
                          ? `30-day window across estimators: ${pct(r.p30min)}–${pct(r.p30max)} (honest spread, not a single number)`
                          : `30-day window: ${pct(r.p30max)}`
                      }
                    >
                      {spread > 0.001 ? `${pct(r.p30min)}–${pct(r.p30max)}` : pct(r.p30max)}
                      <span className="ml-1 font-normal text-muted-foreground">/30d</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              {total > TOP_N ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px] text-muted-foreground"
                  onClick={() => setExpanded((v) => !v)}
                >
                  {expanded ? "Show top only" : `Show all ${total} lines`}
                </Button>
              ) : (
                <span />
              )}
              <span className="font-mono text-[10px] text-muted-foreground">
                fetched {data?.upstreamFetchAt ? fmtAge(data.upstreamFetchAt) : "just now"}
                {data?.cached ? " · cached" : ""}
              </span>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground/80">
              ⚠️ {data?.caveat ?? "Statistical estimates from the public launch record, not a vendor schedule."}{" "}
              Hot windows feed the versioned-ranks doctrine: a drop inside 30 days means catalog churn on that
              vendor&apos;s lanes.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
