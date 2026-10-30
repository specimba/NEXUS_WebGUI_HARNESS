"use client";

// ─── GitHub Ops card (r501-p2) ───────────────────────────────────────────────
// The r501-p2 deep dive promoted the r498 PAT from "git transport" to a
// first-class REST credential — this card is its console. One explicit
// "Probe GitHub" sweep over /api/gh/vitals (server-side; the token derived
// from the origin remote never reaches the browser) renders:
//
//   • identity + PAT expiry chip (regen window turns amber inside 90 days)
//   • rate budget meters (core /search — /rate_limit is a free call)
//   • sync state: local HEAD vs remote default-branch tip (push discipline)
//   • repos fleet + gists fleet
//
// Static capability note: gists WRITE returns 403 with the current
// fine-grained PAT (needs the account-level "Gists" permission) — the
// snapshot-backup integration stays parked until a regen. Rotation =
// re-embed in the origin remote URL; the server re-reads it within 5 min.

import * as React from "react";
import { GitBranch, KeyRound, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

const CACHE_KEY = "nexus-gh-vitals";

interface Section<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface GhVitals {
  repo: { owner: string; name: string };
  identity: Section<{ login: string; tokenExpiry: string | null }>;
  rate: Section<{
    core: { limit: number; used: number; remaining: number; reset: number };
    search: { limit: number; used: number; remaining: number };
  }>;
  sync: Section<{
    localHead: string | null;
    remoteHead: string | null;
    inSync: boolean;
    defaultBranch: string;
    pushedAt: string | null;
  }>;
  repos: Section<{ name: string; pushedAt: string; private: boolean }[]>;
  gists: Section<{ count: number; names: string[] }>;
  probedAt: number;
}

function fmtRelIso(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "unknown";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtRel(ts: number | undefined): string {
  if (!ts) return "never";
  return fmtRelIso(new Date(ts).toISOString());
}

function short(sha: string | null | undefined): string {
  return sha ? `${sha.slice(0, 7)}` : "—";
}

function RateMeter({
  label,
  remaining,
  limit,
}: {
  label: string;
  remaining: number;
  limit: number;
}) {
  const pct = limit > 0 ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : 0;
  const tone =
    pct > 50 ? "bg-emerald-500" : pct > 20 ? "bg-amber-500" : "bg-red-500";
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {remaining.toLocaleString()} / {limit.toLocaleString()} left
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${label} rate budget`}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function GitHubOpsCard() {
  const [vitals, setVitals] = React.useState<GhVitals | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const didAuto = React.useRef(false);

  const probe = React.useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const { res, json: body } = await apiJson<GhVitals | { error?: string } | null>("/api/gh/vitals", {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        throw new Error(
          (body && "error" in body && body.error) || `GitHub vitals returned HTTP ${res.status}.`
        );
      }
      const data = body as GhVitals;
      setVitals(data);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } catch {
        /* storage full — cache is best-effort */
      }
    } catch (err) {
      setError(
        err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message)
          ? "GitHub took too long to answer — try again."
          : err instanceof Error
            ? err.message
            : "Could not probe GitHub."
      );
    } finally {
      setLoading(false);
    }
  }, [loading]);

  // First mount = explicit trigger is the button, but a cached vitals sheet
  // renders immediately (local-first doctrine — same as the radar tabs).
  React.useEffect(() => {
    if (didAuto.current) return;
    didAuto.current = true;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) setVitals(JSON.parse(raw) as GhVitals);
    } catch {
      /* stale junk — ignore, probe on demand */
    }
  }, []);

  const tokenExpiry = vitals?.identity.ok ? vitals.identity.data?.tokenExpiry ?? null : null;
  const expiryDays = tokenExpiry
    ? Math.round((Date.parse(tokenExpiry) - Date.now()) / 86_400_000)
    : null;

  return (
    <Card className="gap-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-violet-500" aria-hidden />
          GitHub Ops
        </CardTitle>
        <CardDescription>
          Repo fleet, rate budget and push discipline for{" "}
          <span className="font-mono text-xs">
            {vitals ? `${vitals.repo.owner}/${vitals.repo.name}` : "origin"}
          </span>{" "}
          — probed with the PAT embedded in the origin remote (r498), server-side only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void probe()} disabled={loading}>
            {loading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            {loading ? "Probing…" : "Probe GitHub"}
          </Button>
          <span className="text-[11px] text-muted-foreground" aria-live="polite">
            {vitals ? `probed ${fmtRel(vitals.probedAt)}` : "no probe yet"}
          </span>
        </div>

        {error ? (
          <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {vitals ? (
          <div className="space-y-4">
            {/* identity + PAT expiry */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {vitals.identity.ok ? vitals.identity.data?.login : "identity failed"}
              </span>
              {tokenExpiry ? (
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    expiryDays !== null && expiryDays < 0
                      ? "border-red-500/40 bg-red-500/10 text-red-500 dark:text-red-400"
                      : expiryDays !== null && expiryDays < 90
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
                  )}
                  title={`Fine-grained PAT expires ${tokenExpiry}. Rotation = re-embed the new token in the origin remote URL; the server re-reads it within 5 minutes.`}
                >
                  PAT · {expiryDays !== null && expiryDays < 0 ? "expired" : `${expiryDays}d left`}
                </span>
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                expires {tokenExpiry ? tokenExpiry.slice(0, 10) : "unknown"}
              </span>
            </div>

            {/* rate budget */}
            {vitals.rate.ok && vitals.rate.data ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <RateMeter
                  label="Core API"
                  remaining={vitals.rate.data.core.remaining}
                  limit={vitals.rate.data.core.limit}
                />
                <RateMeter
                  label="Search API"
                  remaining={vitals.rate.data.search.remaining}
                  limit={vitals.rate.data.search.limit}
                />
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">{vitals.rate.error}</p>
            )}

            {/* sync state */}
            {vitals.sync.ok && vitals.sync.data ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-xs">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="font-medium">{vitals.sync.data.defaultBranch}:</span>
                <span className="font-mono" title="local HEAD">
                  {short(vitals.sync.data.localHead)}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono" title="remote tip">
                  {short(vitals.sync.data.remoteHead)}
                </span>
                <span
                  className={cn(
                    "ml-auto rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    vitals.sync.data.inSync
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  )}
                >
                  {vitals.sync.data.inSync ? "in sync" : "push needed"}
                </span>
                <span className="w-full text-[11px] text-muted-foreground">
                  last push {fmtRelIso(vitals.sync.data.pushedAt)}
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">{vitals.sync.error}</p>
            )}

            {/* repos + gists fleet */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Repos (recent push)
                </p>
                {vitals.repos.ok && vitals.repos.data ? (
                  <ul className="mt-2 space-y-1 text-xs">
                    {vitals.repos.data.slice(0, 5).map((r) => (
                      <li key={r.name} className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono">{r.name}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {fmtRelIso(r.pushedAt)}
                          {r.private ? " · private" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">{vitals.repos.error}</p>
                )}
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Gists fleet
                </p>
                {vitals.gists.ok && vitals.gists.data ? (
                  <>
                    <p className="mt-2 text-xs">
                      {vitals.gists.data.count} gist{vitals.gists.data.count === 1 ? "" : "s"}
                    </p>
                    <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                      {vitals.gists.data.names.map((n) => (
                        <li key={n} className="truncate">
                          · {n}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">{vitals.gists.error}</p>
                )}
              </div>
            </div>

            {/* capability note — verified r501-p2 */}
            <p
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400"
              role="note"
            >
              Gist <strong>write</strong> is 403 with the current fine-grained PAT (needs the
              account-level &ldquo;Gists&rdquo; permission) — snapshot backup via gists stays
              parked until a regen. Read plane + repo APIs all live.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
