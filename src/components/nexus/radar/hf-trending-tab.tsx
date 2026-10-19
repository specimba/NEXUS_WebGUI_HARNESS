"use client";

// ─── HF Trending tab (r424, survey slice 3) ─────────────────────────────────
// Mechanical move out of radar-view.tsx per the r422 decomposition plan —
// types, HF cache keys, the Hub-section radio config, and the tab component,
// verbatim. No code edits beyond the move: this tab's catch block was already
// rewired to the shared isTimeoutError() predicate in radar-shared (r423).
//
// r501-p2: a second panel lives at the top of the scroll region — the Hub
// FLEET sweep (/api/hub/fleet): the owner's spaces runtime stages, webhook
// health (HF auto-suspends silently — surfaced red), owned artifacts and the
// Inference-Providers router catalog with per-provider latency/throughput.
// Explicit load only (it fans out ~10 upstream calls); cached in localStorage
// like every other radar board.

import * as React from "react";
import {
  ArrowUpRight,
  Boxes,
  Database,
  Download,
  ExternalLink,
  Heart,
  RefreshCw,
  Rocket,
  Search,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

// ─── Hub Fleet types (r501-p2) ───────────────────────────────────────────────

interface FleetSection<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface FleetData {
  authed: boolean;
  identity: FleetSection<{ name: string; isPro: boolean; canPay: boolean; billingMode: string }>;
  spaces: FleetSection<{ id: string; likes: number; stage: string | null; hardware: string | null }[]>;
  artifacts: FleetSection<{ models: string[]; datasets: string[]; collections: { slug: string; title: string }[] }>;
  webhooks: FleetSection<{ id: string; url: string; disabled: string | null; watched: number }[]>;
  router: FleetSection<{
    total: number;
    liveProviders: string[];
    freeCount: number;
    topLanes: {
      id: string;
      provider: string;
      context: number | null;
      inPrice: number | null;
      outPrice: number | null;
      ms: number | null;
      tps: number | null;
      tools: boolean;
    }[];
  }>;
  probedAt: number;
}

const FLEET_CACHE_KEY = "nexus-radar-hf-fleet";

function stageTone(stage: string | null): string {
  if (stage === "RUNNING") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400";
  if (stage === "SLEEPING") return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  if (stage) return "border-violet-500/40 bg-violet-500/10 text-violet-500 dark:text-violet-400";
  return "border-muted bg-muted text-muted-foreground";
}

function fleetRel(ts: number | undefined): string {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// r502: the router's pricing JSON carries upstream float garbage
// (0.12000000000000001, 2.5999999999999996) — 3 significant digits renders
// the honest value without the noise.
function fmtPrice(v: number): string {
  return `$${parseFloat(v.toPrecision(3))}`;
}

function HubFleetSection() {
  const [fleet, setFleet] = React.useState<FleetData | null>(null);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const didAuto = React.useRef(false);

  const load = React.useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hub/fleet", { signal: AbortSignal.timeout(35_000) });
      const body = (await res.json().catch(() => null)) as FleetData | { error?: string } | null;
      if (!res.ok) {
        throw new Error(
          (body && "error" in body && body.error) || `Hub fleet returned HTTP ${res.status}.`
        );
      }
      const data = body as FleetData;
      setFleet(data);
      try {
        localStorage.setItem(FLEET_CACHE_KEY, JSON.stringify(data));
      } catch {
        /* best-effort cache */
      }
    } catch (err) {
      setError(
        err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message)
          ? "The Hub took too long to answer — try again."
          : err instanceof Error
            ? err.message
            : "Could not sweep the Hub fleet."
      );
    } finally {
      setLoading(false);
    }
  }, [loading]);

  React.useEffect(() => {
    if (didAuto.current) return;
    didAuto.current = true;
    try {
      const raw = localStorage.getItem(FLEET_CACHE_KEY);
      if (raw) setFleet(JSON.parse(raw) as FleetData);
    } catch {
      /* stale junk — explicit probe only */
    }
  }, []);

  const suspended = (fleet?.webhooks.data ?? []).filter((w) => !!w.disabled);

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
      >
        <Rocket className="h-3.5 w-3.5 text-violet-500" aria-hidden />
        <span className="text-xs font-semibold">Hub fleet</span>
        <span className="text-[11px] text-muted-foreground">
          spaces · webhooks · router lanes — the authenticated ops surface
        </span>
        {suspended.length > 0 ? (
          <span
            className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-500 dark:text-red-400"
            title="HF auto-suspends a webhook after delivery failures — it fails silently unless polled. Open the fleet for details."
          >
            {suspended.length} webhook suspended
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {fleet ? `swept ${fleetRel(fleet.probedAt)}` : "not swept"}
          </span>
          <RefreshCw
            className={cn("h-3 w-3 text-muted-foreground", open && !loading && "opacity-60")}
            aria-hidden
          />
        </span>
      </button>
      {open ? (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
              {loading ? "Sweeping the Hub…" : fleet ? "Re-sweep fleet" : "Load fleet"}
            </Button>
            {error ? (
              <span className="text-[11px] text-red-500 dark:text-red-400" role="alert">
                {error}
              </span>
            ) : null}
          </div>

          {fleet ? (
            <>
              {/* identity + billing truth */}
              {fleet.identity.ok && fleet.identity.data ? (
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{fleet.identity.data.name}</span>
                  <span
                    className="rounded-full border border-muted bg-muted px-1.5 py-0.5 text-[10px]"
                    title="Billing reality verified r501-p2: prepaid mode with 0 credits — /v1/chat/completions answers 402 until credits or PRO."
                  >
                    {fleet.identity.data.billingMode}
                  </span>
                  {fleet.identity.data.canPay ? null : (
                    <span title="Inference dialing is credit-gated — the router below is a CATALOG lane, not an inference lane.">
                      · no prepaid balance → router lanes are catalog-only
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">{fleet.identity.error}</p>
              )}

              {/* spaces fleet */}
              {fleet.spaces.ok && fleet.spaces.data ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Spaces ({fleet.spaces.data.length})
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {fleet.spaces.data.map((s) => (
                      <a
                        key={s.id}
                        href={`https://huggingface.co/spaces/${s.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group"
                        aria-label={`Open ${s.id} on Hugging Face`}
                      >
                        <span
                          className={cn(
                            "inline-flex max-w-56 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors group-hover:border-violet-500/40",
                            stageTone(s.stage)
                          )}
                          title={`${s.id} — stage ${s.stage ?? "unknown"}${s.hardware ? ` · ${s.hardware}` : ""}`}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              s.stage === "RUNNING" ? "bg-emerald-400" : s.stage === "SLEEPING" ? "bg-amber-400" : "bg-muted-foreground"
                            )}
                            aria-hidden
                          />
                          <span className="truncate">{s.id.split("/")[1] ?? s.id}</span>
                          {s.stage ? <span className="opacity-70">{s.stage.toLowerCase()}</span> : null}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">{fleet.spaces.error}</p>
              )}

              {/* webhooks */}
              {fleet.webhooks.ok && fleet.webhooks.data ? (
                fleet.webhooks.data.length > 0 ? (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Webhooks ({fleet.webhooks.data.length})
                    </p>
                    <ul className="mt-1 space-y-1 text-[11px]">
                      {fleet.webhooks.data.map((w) => (
                        <li key={w.id} className="flex flex-wrap items-center gap-1.5">
                          <span className="max-w-64 truncate font-mono text-muted-foreground" title={w.url}>
                            {w.url.replace(/^https?:\/\//, "")}
                          </span>
                          <span className="text-muted-foreground">· {w.watched} watched</span>
                          {w.disabled ? (
                            <span
                              className="rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-500 dark:text-red-400"
                              title="HF auto-suspended this webhook after delivery failures. Re-enable it from the Hub settings — it fails silently otherwise."
                            >
                              {w.disabled}
                            </span>
                          ) : (
                            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500 dark:text-emerald-400">
                              active
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">No webhooks registered.</p>
                )
              ) : (
                <p className="text-[11px] text-muted-foreground">{fleet.webhooks.error}</p>
              )}

              {/* artifacts */}
              {fleet.artifacts.ok && fleet.artifacts.data ? (
                <p className="text-[11px] text-muted-foreground">
                  Owns {fleet.artifacts.data.models.length} models ·{" "}
                  {fleet.artifacts.data.datasets.length} datasets ·{" "}
                  {fleet.artifacts.data.collections.length} collection
                  {fleet.artifacts.data.collections.length === 1 ? "" : "s"}
                  {fleet.artifacts.data.collections[0] ? (
                    <>
                      {" "}({fleet.artifacts.data.collections[0].title})
                    </>
                  ) : null}
                </p>
              ) : null}

              {/* router catalog */}
              {fleet.router.ok && fleet.router.data ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Inference Providers router — {fleet.router.data.total} models ·{" "}
                    {fleet.router.data.liveProviders.length} live providers ·{" "}
                    {fleet.router.data.freeCount} free lanes
                  </p>
                  <div className="mt-1.5 overflow-hidden rounded-md border">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1 font-medium">Model</th>
                          <th className="px-2 py-1 font-medium">Provider</th>
                          <th className="px-2 py-1 font-medium">TTFT</th>
                          <th className="hidden px-2 py-1 font-medium sm:table-cell">Ctx</th>
                          <th className="hidden px-2 py-1 font-medium md:table-cell">$/M in-out</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fleet.router.data.topLanes.map((lane) => (
                          <tr key={`${lane.id}:${lane.provider}`} className="border-t">
                            <td className="max-w-44 px-2 py-1 font-mono" title={lane.id}>
                              <span className="flex items-center gap-1.5">
                                <span className="truncate">{lane.id}</span>
                                {lane.tools ? (
                                  <span
                                    className="shrink-0 rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-px text-[9px] font-medium text-emerald-500 dark:text-emerald-400"
                                    title="Provider supports tool calling"
                                  >
                                    tools
                                  </span>
                                ) : null}
                              </span>
                            </td>
                            <td className="px-2 py-1">{lane.provider}</td>
                            <td className="px-2 py-1 tabular-nums">{lane.ms != null ? `${Math.round(lane.ms)}ms` : "—"}</td>
                            <td className="hidden px-2 py-1 tabular-nums sm:table-cell">
                              {lane.context != null ? `${Math.round(lane.context / 1024)}k` : "—"}
                            </td>
                            <td className="hidden px-2 py-1 tabular-nums md:table-cell">
                              {lane.inPrice != null && lane.outPrice != null
                                ? `${fmtPrice(lane.inPrice)}/${fmtPrice(lane.outPrice)}`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Sorted by first-token latency among live providers. Catalog only while the
                    account holds no prepaid credits — dialing answers 402.
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">{fleet.router.error}</p>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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
        <div
          className="min-h-0 flex-1 overflow-y-auto pr-1"
          role="region"
          aria-label={`Trending ${kind}`}
        >
        <HubFleetSection />
        {/* r502 wiring fix: the fleet + grid + count line now share ONE
            scroll container (this flex-1 region). Previously the grid kept
            the only max-h scroller while the expanded fleet sat OUTSIDE it
            in a non-scrolling flex column — anything taller than the
            viewport (fleetBottom 977px in an 800px viewport) was clipped
            with no scroll path at all. */}
        <div className="mt-3">
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
          <p className="mt-3 text-[11px] text-muted-foreground" aria-live="polite">
            {filtered.length} of {items.length} {kindMeta.label.toLowerCase()}
            {hfQuery.trim() ? <> matching &ldquo;{hfQuery.trim()}&rdquo;</> : null}
          </p>
        ) : null}
        </div>
      )}
    </div>
  );
}
