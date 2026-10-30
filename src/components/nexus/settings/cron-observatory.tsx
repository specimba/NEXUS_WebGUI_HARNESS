"use client";

import * as React from "react";
import { RefreshCw, Skull, TimerReset, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api-fetch";

// ─── Cron Observatory (r56) ──────────────────────────────────────────────────
// Live window into the PLATFORM cron fleet that drives this project's
// automation. Born from the r56 deep-dive: six "vanishings" were really
// first-fire max_rounds_exceeded deaths hidden by `cron list`. This panel
// renders the forensic death table, the empirical laws, the live fleet and the
// heartbeat log so the automation's health is legible at a glance — and so no
// future round re-chases the ghost.

interface DeathRow {
  id: number;
  kind: string;
  cadence: string;
  createdUtc: string;
  diedUtc: string;
  lifetime: string;
  death: string;
}

interface LiveJob {
  platformJobId?: number;
  name?: string;
  expr?: string;
  kind?: string;
  status?: string;
}

interface FleetJob {
  id: string;
  platformJobId?: number;
  tier?: string;
  kind?: string;
  purpose?: string;
  schedule?: { expr?: string; human?: string; timezone?: string };
}

interface ForensicsPayload {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  registry?: {
    version?: number;
    updatedAt?: string;
    summary?: string;
    empiricalLaws?: string[];
    deathTable?: DeathRow[];
    jobs?: FleetJob[];
    live?: LiveJob[];
    lesson?: string;
    lastObservedAt?: string;
  };
  heartbeat?: string[];
  stats?: {
    totalProbed: number;
    webDevReview: { dead: number; total: number };
    agentTurn: { alive: number; total: number };
    byMode: { maxRounds: number; execLimits: number; succeeded: number };
    medianWebDevLifetimeMin: number | null;
    fleetExpected: number;
    fleetLive: number;
  };
}

const REFRESH_MS = 60_000;

function KindBadge({ kind }: { kind: string }) {
  const survivor = kind === "agentTurn";
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 px-1.5 text-[10px] font-medium",
        survivor
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
          : "border-red-500/40 bg-red-500/10 text-red-500",
      )}
    >
      {kind}
    </Badge>
  );
}

function DeathCell({ death }: { death: string }) {
  if (/succeeded/i.test(death)) {
    return <span className="font-medium text-emerald-500">{death}</span>;
  }
  if (/max_rounds_exceeded/i.test(death)) {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-red-500">
        <Skull className="h-3 w-3 shrink-0" aria-hidden />
        max_rounds_exceeded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-medium text-amber-500">
      <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
      {death}
    </span>
  );
}

export function CronObservatory() {
  const [data, setData] = React.useState<ForensicsPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      // r784: apiJson death-window guard - idempotent read, retry-safe; the
      // !res.ok / !json.ok error paths keep the exact old semantics.
      const { res, json } = await apiJson<ForensicsPayload>("/api/cron/forensics", {
        cache: "no-store",
      });
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "observatory fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const reg = data?.registry;
  const stats = data?.stats;
  const live = reg?.live ?? [];
  const laws = reg?.empiricalLaws ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Cron Observatory (platform fleet + forensics)
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          onClick={() => void load()}
          aria-label="Refresh cron observatory"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} aria-hidden />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Observatory offline: {error}
        </div>
      ) : loading && !data ? (
        <div className="space-y-2" aria-hidden>
          <div className="h-16 animate-pulse rounded-lg bg-muted/60" />
          <div className="h-32 animate-pulse rounded-lg bg-muted/40" />
        </div>
      ) : reg && stats ? (
        <div className="space-y-3">
          {/* ── Live fleet ─────────────────────────────────────────── */}
          <ul className="space-y-1.5">
            {live.map((job) => (
              <li
                key={job.platformJobId}
                className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 soft-pulse"
                />
                <span className="min-w-0 flex-1 truncate font-medium">{job.name}</span>
                <KindBadge kind={job.kind ?? "agentTurn"} />
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground" title={job.expr}>
                  #{job.platformJobId} · {job.expr}
                </span>
              </li>
            ))}
            {live.length === 0 && (
              <li className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                Fleet is EMPTY — run bootEnsure (ops/cron.jobs.json) from the next agent session.
              </li>
            )}
          </ul>

          {/* ── Stats strip ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">webDevReview</p>
              <p className="text-sm font-semibold tabular-nums text-red-500">
                {stats.webDevReview.dead}/{stats.webDevReview.total} dead
              </p>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">agentTurn</p>
              <p className="text-sm font-semibold tabular-nums text-emerald-500">
                {stats.agentTurn.alive}/{stats.agentTurn.total} survived
              </p>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Median life</p>
              <p className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums">
                <TimerReset className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {stats.medianWebDevLifetimeMin !== null
                  ? `${stats.medianWebDevLifetimeMin} min`
                  : "—"}
              </p>
            </div>
            <div className="rounded-lg border px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Fleet</p>
              <p
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  stats.fleetLive >= stats.fleetExpected ? "text-emerald-500" : "text-amber-500",
                )}
              >
                {stats.fleetLive}/{stats.fleetExpected} live
              </p>
            </div>
          </div>

          {/* ── Heartbeat tail ─────────────────────────────────────── */}
          {data.heartbeat && data.heartbeat.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Heartbeat log tail (ops/heartbeat.log)
              </p>
              <pre className="max-h-28 overflow-y-auto rounded-lg border bg-muted/30 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {data.heartbeat.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {/http=200/.test(line) ? (
                      <span className="text-emerald-500">{line}</span>
                    ) : /http=bootstrap/.test(line) ? (
                      <span>{line}</span>
                    ) : (
                      <span className="text-amber-500">{line}</span>
                    )}
                  </div>
                ))}
              </pre>
            </div>
          )}

          {/* ── Empirical laws ─────────────────────────────────────── */}
          {laws.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Empirical laws (13 jobs probed via cron get)
              </p>
              <ol className="space-y-1 rounded-lg border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {laws.map((law, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="shrink-0 font-mono text-[10px] text-primary">L{i + 1}</span>
                    <span>{law}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* ── Death table ────────────────────────────────────────── */}
          {reg.deathTable && reg.deathTable.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Death table — every platform job ever registered
              </p>
              <div className="max-h-64 overflow-y-auto rounded-lg border" role="region" aria-label="Cron death table">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-card/95 backdrop-blur">
                    <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">Job</th>
                      <th className="px-2 py-1.5 font-medium">Kind</th>
                      <th className="px-2 py-1.5 font-medium">Life</th>
                      <th className="px-2 py-1.5 font-medium">Death</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reg.deathTable.map((d) => (
                      <tr key={d.id} className="border-t">
                        <td className="px-2 py-1.5">
                          <span className="font-mono text-[10px] text-muted-foreground">#{d.id}</span>{" "}
                          <span className="text-[10px] text-muted-foreground">{d.cadence}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <KindBadge kind={d.kind} />
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{d.lifetime}</td>
                        <td className="px-2 py-1.5">
                          <DeathCell death={d.death} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Registry v{reg.version ?? 1} · updated {reg.updatedAt ?? "—"} · fleet self-heals via the
            T0 heartbeat payload (cron census + recreate from ops/cron.jobs.json, agentTurn only).
          </p>
        </div>
      ) : null}
    </div>
  );
}
