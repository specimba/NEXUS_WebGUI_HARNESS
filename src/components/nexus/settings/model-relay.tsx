"use client";

// ─── Model Relay settings card ───────────────────────────────────────────────
// The "Genius rotator" doctrine, applied to the free-frontier vault: an ordered
// fallback chain (Generation-Era tier → arena Elo) that the engine rotates
// through when the active model fails before streaming anything.

import * as React from "react";
import {
  Activity,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleAlert,
  Gauge,
  Info,
  Radar,
  RadioTower,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { resolveLlm } from "@/lib/llm-config";
import {
  buildRelayChain,
  hopBreakerDocked,
  hopIsFree,
  laneRecentlyFailed,
  relayHealthSnapshot,
  resetRelayHealth,
  TIER_LABEL,
  type RelayFailoverPolicy,
  type RelayHealthEntry,
  type RelayHop,
} from "@/lib/relay";
// r504: provider circuit breaker board — the fleet-level view of the same
// health truth (streaks, quarantine countdowns, degradation banner).
import {
  BREAKER_STREAK_THRESHOLD,
  fmtQuarantineLeft,
  providerBreakerSnapshot,
  quarantineLeftMs,
  resetProviderBreakers,
  type ProviderBreakerMap,
} from "@/lib/provider-breaker";
import { useSettingsStore } from "@/lib/stores";
// r506: utility fast-lane routing — the AI buttons' own wire, previewed here.
import { buildUtilityWire } from "@/lib/utility-lane";
// r516: benchmark intelligence index — the live ordering signal this card
// previews and refreshes (arena.ai WebDev/Agent + artificialanalysis.ai).
import {
  intelligenceStale,
  readIntelligenceCache,
  writeIntelligenceCache,
  type IntelligenceIndex,
} from "@/lib/intelligence";
import { fmtRel } from "@/lib/helpers";
// r517: free reach census — freellm.sh's filtered view (free access ∩
// operational, newest first): the REACH half of "reach × intelligence".
import {
  FREELLM_FILTERED_URL,
  freellmStale,
  isNewcomer,
  matchFreellmEntry,
  readFreellmCache,
  writeFreellmCache,
  type FreellmEntry,
  type FreellmIndex,
} from "@/lib/freellm";
// r503: Radar → Relay adoption pipeline — this card renders and manages the
// adopted-lane registry (localStorage `nexus-relay-adopted`, written by the
// radar tab's auto-pipeline AND the row actions below) plus the auto-adopt
// switch. buildRelayChain() above already appends the enabled ones as hops.
import {
  MAX_ADOPTED_LANES,
  adoptedLanesSnapshot,
  catalogHasLane,
  clearAdoptedLanes,
  removeAdoptedLane,
  restoreLane,
  setAdoptedLaneEnabled,
  type AdoptedLane,
} from "@/lib/lane-adopt";
import { fmtAge, fmtCtx, fmtPrice, providerMeta } from "@/lib/tracker-types";
import { cn } from "@/lib/utils";

/** r517: reach-census filter slices (Model Relay → Free reach panel). */
type ReachFilter = "all" | "free-forever" | "signup-credits" | "new";

const TIER_STYLE: Record<1 | 2 | 3, string> = {
  1: "border-violet-500/50 bg-violet-500/15 text-violet-300",
  2: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  3: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

// ── r504: failover policy copy (owner directive: "auto-rotate them to the
// best available alternative free frontiers for continuation smartly") ──
// r516 rewording: ordering within a class is benchmark-led now, not words.
const POLICY_COPY: Record<RelayFailoverPolicy, { label: string; desc: string }> = {
  smart: {
    label: "Smart",
    desc: "Keeps quality tiers, but a FREE lane outranks paid siblings of its era — outages ride free frontiers before spending a cent. Within a class, lanes order by the live benchmark intelligence index, not by name words.",
  },
  quality: {
    label: "Quality",
    desc: "Generation-Era tier first, then the intelligence blend (65% live benchmark index · 35% catalog Elo). Free/paid is not a factor.",
  },
  free: {
    label: "Free first",
    desc: "All free lanes dial before any paid lane (benchmark intelligence orders within). Maximum cost protection during a degraded fleet.",
  },
};

/** One aggregated provider row for the fleet board. */
interface FleetRow {
  providerId: string;
  okLanes: number;
  sickLanes: number;
  throttledLanes: number;
  answered: number;
  quarantined: boolean;
  leftMs: number;
  streak: number;
  lastError?: string;
}

function buildFleetRows(
  health: Record<string, RelayHealthEntry>,
  breaker: ProviderBreakerMap
): FleetRow[] {
  const byProvider = new Map<string, RelayHealthEntry[]>();
  for (const [key, entry] of Object.entries(health)) {
    const pid = key.slice(0, key.indexOf("::"));
    if (!pid) continue;
    const lanes = byProvider.get(pid) ?? [];
    lanes.push(entry);
    byProvider.set(pid, lanes);
  }
  const rows: FleetRow[] = [];
  for (const [providerId, lanes] of byProvider) {
    const b = breaker[providerId];
    rows.push({
      providerId,
      okLanes: lanes.filter((e) => !laneRecentlyFailed(e) && e.ok > 0).length,
      sickLanes: lanes.filter((e) => laneRecentlyFailed(e) && !e.soft).length,
      throttledLanes: lanes.filter((e) => laneRecentlyFailed(e) && e.soft).length,
      answered: lanes.reduce((n, e) => n + e.ok, 0),
      quarantined: quarantineLeftMs(providerId, breaker) > 0,
      leftMs: quarantineLeftMs(providerId, breaker),
      streak: b?.streak ?? 0,
      lastError:
        lanes.find((e) => laneRecentlyFailed(e) && e.lastError)?.lastError ??
        b?.lastError,
    });
  }
  // Degradation first (quarantined → sick count → name) so the eye lands on
  // the burning fleet without hunting.
  rows.sort(
    (a, b) =>
      (b.quarantined ? 1 : 0) - (a.quarantined ? 1 : 0) ||
      b.sickLanes - a.sickLanes ||
      a.providerId.localeCompare(b.providerId)
  );
  return rows;
}

export function ModelRelayCard() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const enabled = settings.relayEnabled !== false;

  // The rotator's health memory refreshes live (runs record hop outcomes) —
  // and the r504 provider breaker rides the SAME cadence (one tick, both
  // snapshots fresh; the breaker memory is written by the same hop outcomes).
  const [health, setHealth] = React.useState<Record<string, RelayHealthEntry>>(() => relayHealthSnapshot());
  const [breaker, setBreaker] = React.useState<ProviderBreakerMap>(() => providerBreakerSnapshot());
  React.useEffect(() => {
    const t = window.setInterval(() => {
      setHealth(relayHealthSnapshot());
      setBreaker(providerBreakerSnapshot());
    }, 15_000);
    const onVis = () => {
      setHealth(relayHealthSnapshot());
      setBreaker(providerBreakerSnapshot());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // ── r503: adopted-lane registry — same refresh doctrine as the health
  // memory above (15s cadence + on visibility). The registry lives in
  // localStorage and is written by the radar tab's auto-pipeline too, so a
  // snapshot poll keeps this list in step without a cross-component store;
  // row mutations below set it synchronously from the action's return value.
  const [lanes, setLanes] = React.useState<AdoptedLane[]>(() => adoptedLanesSnapshot());
  React.useEffect(() => {
    const t = window.setInterval(() => setLanes(adoptedLanesSnapshot()), 15_000);
    const onVis = () => setLanes(adoptedLanesSnapshot());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // ── r516: benchmark intelligence index — the live ordering signal. Mounted
  // hydrates from localStorage, auto-refreshes when older than 6h, and the
  // Refresh button forces a server re-fetch (?fresh=1). The chain preview
  // below recomputes when this lands, so the ladder the owner sees is the
  // ladder the rotator actually dials.
  const [intel, setIntel] = React.useState<IntelligenceIndex | null>(() => readIntelligenceCache());
  const [intelLoading, setIntelLoading] = React.useState(false);
  const intelBooted = React.useRef(false);
  const loadIntel = React.useCallback(async (fresh: boolean) => {
    setIntelLoading(true);
    try {
      const res = await fetch(`/api/intelligence${fresh ? "?fresh=1" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const idx = (await res.json()) as IntelligenceIndex;
      writeIntelligenceCache(idx);
      setIntel(idx);
      if (fresh) {
        const live = idx.sources.filter((s) => s.status === "live").length;
        toast.success("Benchmark index refreshed", {
          description: `${idx.entries.length} models · ${idx.origin === "live" ? `${live} live board${live === 1 ? "" : "s"}` : "curated snapshot (boards unreachable)"} · ${idx.ms}ms`,
        });
      }
    } catch (err) {
      if (fresh) {
        toast.error("Benchmark refresh failed", {
          description: err instanceof Error ? err.message : "Could not reach /api/intelligence.",
        });
      }
    } finally {
      setIntelLoading(false);
    }
  }, []);
  React.useEffect(() => {
    if (intelBooted.current) return;
    intelBooted.current = true;
    if (intelligenceStale(readIntelligenceCache())) void loadIntel(false);
  }, [loadIntel]);

  // ── r517: free reach census — freellm.sh's filtered view (free access ∩
  // operational, newest first). Same mount shape as the intel index above:
  // hydrate from localStorage, silent auto-refresh when stale, Refresh
  // forces ?fresh=1. Reach × intelligence = the adoption shortlist.
  const [freellm, setFreellm] = React.useState<FreellmIndex | null>(() => readFreellmCache());
  const [freellmLoading, setFreellmLoading] = React.useState(false);
  const [reachFilter, setReachFilter] = React.useState<ReachFilter>("all");
  const freellmBooted = React.useRef(false);
  const loadFreellm = React.useCallback(async (fresh: boolean) => {
    setFreellmLoading(true);
    try {
      const res = await fetch(`/api/freellm${fresh ? "?fresh=1" : ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const idx = (await res.json()) as FreellmIndex;
      writeFreellmCache(idx);
      setFreellm(idx);
      if (fresh) {
        toast.success("Free reach census refreshed", {
          description:
            idx.origin === "live"
              ? `${idx.entries.length} free+operational of ${idx.total} sources · ${idx.ms}ms`
              : `freellm.sh unreachable — ${idx.note ?? "no parsed payload"}`,
        });
      }
    } catch (err) {
      if (fresh) {
        toast.error("Reach census refresh failed", {
          description: err instanceof Error ? err.message : "Could not reach /api/freellm.",
        });
      }
    } finally {
      setFreellmLoading(false);
    }
  }, []);
  React.useEffect(() => {
    if (freellmBooted.current) return;
    freellmBooted.current = true;
    if (freellmStale(readFreellmCache())) void loadFreellm(false);
  }, [loadFreellm]);
  const reachRows = React.useMemo(() => {
    if (!freellm || freellm.origin !== "live") return [] as FreellmEntry[];
    if (reachFilter === "free-forever") return freellm.entries.filter((e) => e.access.includes("free-forever"));
    if (reachFilter === "signup-credits") return freellm.entries.filter((e) => e.access.includes("signup-credits"));
    if (reachFilter === "new") return freellm.entries.filter((e) => isNewcomer(e));
    return freellm.entries;
  }, [freellm, reachFilter]);

  const primary = resolveLlm(settings);
  const policy: RelayFailoverPolicy = settings.relayFailoverPolicy ?? "smart";
  // r506: the utility wire (AI buttons' dial order) — recomputed on the SAME
  // tick as health/breaker so the preview reflects quarantine/sickness live.
  const utilityWire = React.useMemo(
    () => buildUtilityWire(settings),
    // health/breaker are the 15s-tick inputs buildUtilityWire reads via
    // snapshots — listing them keeps the preview live with quarantine state.
    [settings, health, breaker]
  );
  // r504: fleet board rows + per-hop dock verdicts — both read the SAME two
  // snapshots the sort uses (one truth, no parallel verdict math here).
  const fleet = React.useMemo(() => buildFleetRows(health, breaker), [health, breaker]);
  const quarantinedCount = fleet.filter((r) => r.quarantined).length;
  const degraded = quarantinedCount > 0 || fleet.some((r) => r.sickLanes >= 2);
  // Mirror buildRelayWire's exclusion: the primary is already shown in its own
  // row — don't list it twice. The auto hop is likewise excluded when the
  // built-in engine IS the primary.
  const chain = React.useMemo(() => {
    const excludeKey =
      primary.provider === "custom" && primary.providerId !== "custom" && primary.model
        ? `${primary.providerId}::${primary.model}`
        : undefined;
    return buildRelayChain(settings).filter(
      (h) =>
        h.key !== excludeKey &&
        !(primary.providerId === "auto" && h.providerId === "auto")
    );
    // intel rides the deps: when a fresh benchmark index lands, the previewed
    // ladder re-sorts exactly like the next real dial will.
  }, [settings, primary, intel]);

  // Reorder controls index THIS list (auto pinned last is never swappable).
  // r167 fix: the old code indexed the full chain but reordered the filtered
  // list, and disabled move-down with `index >= chain.length - 2` — which
  // wrongly pinned the second-to-last REAL hop whenever the auto hop is
  // absent (auto primary — the default fresh-profile setup).
  const reorderable = React.useMemo(
    () => chain.filter((h) => h.providerId !== "auto"),
    [chain]
  );

  function move(orderIdx: number, dir: -1 | 1) {
    const target = orderIdx + dir;
    if (target < 0 || target >= reorderable.length) return;
    const reordered = [...reorderable];
    const [row] = reordered.splice(orderIdx, 1);
    reordered.splice(target, 0, row);
    update({ relayOrder: reordered.map((h) => h.key) });
  }

  function resetOrder() {
    update({ relayOrder: [] });
    toast.success("Relay order reset to recommended (tier → benchmark intelligence)");
  }

  return (
    <Card className="gap-4" data-testid="model-relay-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Waypoints className="h-4 w-4 text-violet-400" aria-hidden />
            Model Relay
            <Badge variant="outline" className="text-[10px] font-normal">
              automatic rotation
            </Badge>
          </CardTitle>
          <Switch
            aria-label="Toggle model relay"
            checked={enabled}
            onCheckedChange={(v) => update({ relayEnabled: v })}
          />
        </div>
        <CardDescription>
          When the active model fails before answering — gateway drop, rate
          limit, out of credits, dead model id — the run rotates down this
          chain until a model responds. Same doctrine as a local model relay:
          tier first, then quality, then the built-in engine as the last resort.
          The chain also adapts per task: research steps (search tools) try
          fast models first, writing/review steps try flagships first — and
          hops that failed recently are demoted automatically. Every fallback
          hop also dials leaner (token-lean shaping): max_tokens scaled per
          hop class and the oldest turns trimmed, so a storm across the chain
          spends less budget per retry — the primary hop stays byte-identical.
        </CardDescription>
      </CardHeader>
      <div className="flex items-start justify-between gap-3 rounded-lg border border-sky-500/25 bg-sky-500/[0.04] p-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium leading-tight">Prefer server relay for workflow runs</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Resume and retry workflow LLM calls through the relay by default instead of the
            direct lane. The stall watchdog and the ⇄/⊙ lane chips stay unchanged.
          </p>
        </div>
        <Switch
          aria-label="Prefer server relay for workflow runs"
          checked={settings.preferRelay === true}
          onCheckedChange={(v) => update({ preferRelay: v })}
          className="mt-0.5 shrink-0"
        />
      </div>
      <CardContent className="space-y-3">
        {/* ── r504: failover policy — how the chain orders itself when it must
            rotate. Amber row, matching the established row pattern (sky =
            server relay, emerald = radar pipeline, amber = outage doctrine). */}
        <div
          className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3"
          data-testid="failover-policy"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
              <CircleAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden />
              Failover policy
            </p>
            <div
              role="group"
              aria-label="Failover policy"
              className="flex flex-wrap gap-1"
            >
              {(["smart", "quality", "free"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={policy === p}
                  aria-label={`${POLICY_COPY[p].label} failover policy`}
                  onClick={() => update({ relayFailoverPolicy: p })}
                  className={cn(
                    "h-7 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
                    policy === p
                      ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                      : "border-border/70 bg-background/40 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {POLICY_COPY[p].label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {POLICY_COPY[policy].desc} Three consecutive hard lane-fails trip a
            provider circuit breaker: its lanes dial last until the quarantine
            lapses, then one dial re-probes them.
          </p>
        </div>

        {/* ── r516: Benchmark intelligence — the live ordering signal the
            ladder actually sorts by (arena WebDev/Agent + Artificial
            Analysis intelligence + coding agents). Emerald row. */}
        <div
          className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-3"
          data-testid="benchmark-intelligence"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
              <Gauge className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
              Benchmark intelligence
              {/* r588: age honesty — the badge said "live boards"/"snapshot"
                  regardless of when the boards payload landed (mount
                  auto-refresh only fires past the TTL). Same honest chip
                  language the freellm census got in r587 and the plugin-packs
                  strip in r583: live/cached · HH:MM naming the vintage,
                  tooltip carrying the refresh doctrine. */}
              {/* r603: seed-flow honesty (r602's twin) — with an EMPTY device
                  cache this badge said "loading…" permanently (even after the
                  boot fetch FAILED nothing was loading) and its tooltip
                  claimed "Boards unreachable — curated snapshot in effect" —
                  knowledge it does not have (null means not-yet-loaded, and
                  with null there is no snapshot either). A null index now
                  splits by intelLoading: "seeding…" (first fetch in flight)
                  vs "no boards yet" (fetch not landed — Refresh seeds it).
                  Nothing is invented in any state.
                  r606: the snapshot label now names its vintage too
                  ("snapshot · HH:MM") — the fallback state is exactly where
                  age matters most (r605 put it in the title, the label now
                  carries it at a glance); the badge also grows a dashed
                  border while in the snapshot state — dashed = provisional
                  fallback, solid = live parse. */}
              {(() => {
                const age = intel ? fmtRel(intel.asOf) : "";
                return (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-normal tabular-nums transition-colors duration-500",
                      intel?.origin === "live"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500/70 hover:bg-emerald-500/20"
                        : "border-dashed border-amber-500/40 bg-amber-500/10 text-amber-300 hover:border-amber-500/70 hover:bg-amber-500/20"
                    )}
                    title={
                      intel?.origin === "live"
                        ? `At least one leaderboard board was parsed live for this index, as of ${age} — auto-refreshes on mount past its freshness window; Refresh forces a live fetch.`
                        : intel
                          ? `Boards unreachable — curated snapshot in effect (honest fallback, never invented) — snapshot assembled ${age}; upstream is dark right now, so this is the newest parse this device holds`
                          : intelLoading
                            ? "No boards cached on this device yet — the first fetch is in flight; nothing is invented while it runs."
                            : "The first fetch has not landed (no boards cached on this device) — hit Refresh to seed it; nothing is invented in the meantime."
                    }
                    data-testid="intel-vintage-badge"
                    role="status"
                    aria-live="polite"
                  >
                    {intel
                      ? intel.origin === "live"
                        ? `${intelligenceStale(intel) ? "cached" : "live"} boards · ${age}`
                        : `snapshot · ${age}`
                      : intelLoading
                        ? "seeding…"
                        : "no boards yet"}
                  </Badge>
                );
              })()}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={intelLoading}
              aria-label="Refresh benchmark intelligence index"
              onClick={() => void loadIntel(true)}
            >
              <RefreshCw className={cn("h-3 w-3", intelLoading && "animate-spin")} aria-hidden />
              {intelLoading ? "checking…" : "Refresh"}
            </Button>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Ordering signal — arena.ai WebDev + Agent boards and Artificial
            Analysis (intelligence index + coding agents). Lane order blends{" "}
            <span className="font-medium text-emerald-400">65% benchmark · 35% catalog Elo</span>,
            cached 6h; a speed lane can no longer outrank a benchmark-proven
            frontier model just because its name says so.
          </p>
          {intel ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {intel.sources.map((s) => (
                  <span
                    key={s.id}
                    title={`${s.url} · ${s.status}${s.note ? ` · ${s.note}` : ""}`}
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        s.status === "live"
                          ? "bg-emerald-500"
                          : s.status === "snapshot"
                            ? "bg-amber-500"
                            : "bg-stone-400"
                      )}
                      aria-hidden
                    />
                    {s.label}
                    {s.status === "live" ? ` · ${s.count}` : ""}
                  </span>
                ))}
                <span className="text-[10px] text-muted-foreground">
                  {intel.entries.length} models · updated {new Date(intel.asOf).toLocaleString()}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {intel.entries.slice(0, 6).map((e, i) => (
                  <div key={e.name} className="flex items-center gap-2 text-[11px]">
                    <span className="w-4 shrink-0 text-right font-mono text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono" title={e.name}>
                      {e.name}
                    </span>
                    <div className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-emerald-500/60"
                        style={{ width: `${Math.round(e.intel * 100)}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right font-mono text-emerald-400">
                      {e.intel.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground" role="status">
              Fetching the boards… the ladder re-sorts the moment it lands.
            </p>
          )}
        </div>

        {/* ── r517: Free reach census — freellm.sh's filtered view (free
            access ∩ operational, newest first) as the REACH half of the
            owner's "reach and intelligence index" directive. Teal row. */}
        <div
          className="rounded-lg border border-teal-500/25 bg-teal-500/[0.04] p-3"
          data-testid="freellm-reach"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
              <RadioTower className="h-3.5 w-3.5 text-teal-400" aria-hidden />
              Free reach · freellm.sh
              {/* r587: age honesty — the badge used to say "live census"
                  regardless of when the payload actually landed (the mount
                  auto-refresh only fires past the TTL, so a long-lived tab
                  silently shows aging data). Same honest chip language the
                  plugin-packs strip got in r583: live/cached · HH:MM naming
                  the vintage, tooltip carrying the refresh doctrine. */}
              {/* r602: seed-flow honesty — with an EMPTY device cache the
                  badge said "loading…" permanently (even after the boot fetch
                  FAILED nothing was loading) and its tooltip claimed
                  "unreachable" — knowledge it does not have. A null census now
                  splits by freellmLoading: "seeding…" (first fetch in flight)
                  vs "no census yet" (fetch not landed — Refresh seeds it).
                  Nothing is invented in any state. */}
              {(() => {
                const age = freellm ? fmtRel(freellm.asOf) : "";
                return (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-normal tabular-nums",
                      freellm?.origin === "live"
                        ? "border-teal-500/40 bg-teal-500/10 text-teal-300"
                        : "border-stone-500/40 bg-stone-500/10 text-stone-400"
                    )}
                    title={
                      freellm?.origin === "live"
                        ? `Census parsed from freellm.sh as of ${age} — auto-refreshes on mount past its freshness window; Refresh forces a live fetch.`
                        : freellm
                          ? "freellm.sh unreachable — no invented reach data, ever"
                          : freellmLoading
                            ? "No census cached on this device yet — the first fetch is in flight; nothing is invented while it runs."
                            : "The first fetch has not landed (no census cached on this device) — hit Refresh to seed it; nothing is invented in the meantime."
                    }
                    data-testid="freellm-census-badge"
                    role="status"
                    aria-live="polite"
                  >
                    {freellm
                      ? freellm.origin === "live"
                        ? `${freellmStale(freellm) ? "cached" : "live"} · ${age}`
                        : "unavailable"
                      : freellmLoading
                        ? "seeding…"
                        : "no census yet"}
                  </Badge>
                );
              })()}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={freellmLoading}
              aria-label="Refresh free reach census"
              onClick={() => void loadFreellm(true)}
            >
              <RefreshCw className={cn("h-3 w-3", freellmLoading && "animate-spin")} aria-hidden />
              {freellmLoading ? "checking…" : "Refresh"}
            </Button>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Reach census — every free-access source that is operational right now
            (free-tier · free-forever · signup-credits), newest first. Cross it with
            the benchmark panel above:{" "}
            <span className="font-medium text-teal-300">reach × intelligence</span> is
            the adoption shortlist.{" "}
            <a
              href={FREELLM_FILTERED_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-400 hover:underline"
            >
              filtered view ↗
            </a>
          </p>
          {freellm && freellm.origin === "live" ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Reach filter">
                {(
                  [
                    ["all", `All ${freellm.entries.length}`],
                    ["free-forever", `free-forever ${freellm.entries.filter((e) => e.access.includes("free-forever")).length}`],
                    ["signup-credits", `signup-credits ${freellm.entries.filter((e) => e.access.includes("signup-credits")).length}`],
                    ["new", `new 14d ${freellm.counts.new14d}`],
                  ] as Array<[ReachFilter, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setReachFilter(id)}
                    aria-pressed={reachFilter === id}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                      reachFilter === id
                        ? "border-teal-500/50 bg-teal-500/15 text-teal-300"
                        : "border-border/70 bg-background/40 text-muted-foreground hover:border-teal-500/30 hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {reachRows.length === 0 ? (
                <p className="mt-2 rounded-md border border-dashed border-border/60 px-2 py-3 text-center text-[11px] text-muted-foreground">
                  No sources in this slice right now — the census stays honest, not padded.
                </p>
              ) : (
                <div
                  className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-teal-500/30"
                  role="list"
                  aria-label="Free reach sources"
                >
                  {reachRows.map((e) => (
                    <div
                      key={e.id}
                      role="listitem"
                      className="flex items-start gap-2 rounded-md border border-border/50 bg-background/30 px-2 py-1.5"
                    >
                      <span
                        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
                        title="operational"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-xs font-medium" title={`${e.name} — ${e.provider}`}>
                            {e.name}
                          </span>
                          {isNewcomer(e) && (
                            <Badge
                              variant="outline"
                              className="border-rose-500/40 bg-rose-500/10 text-[9px] font-normal text-rose-300"
                              title={`Added to the freellm.sh index within the last 14 days (${e.addedAt?.slice(0, 10) ?? "recent"})`}
                            >
                              NEW
                            </Badge>
                          )}
                          {e.gated && (
                            <span
                              className="shrink-0 rounded-full border border-stone-500/40 bg-stone-500/10 px-1.5 py-0.5 text-[9px] text-stone-400"
                              title="Gated access — expect friction (waitlist/invite/approval)"
                            >
                              gated
                            </span>
                          )}
                          <span
                            className="shrink-0 rounded-full border border-border/70 bg-background/40 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                            title={`Provider: ${e.provider}`}
                          >
                            {e.provider}
                          </span>
                          {e.access
                            .filter((a) => a === "free-forever" || a === "free-tier" || a === "signup-credits")
                            .map((a) => (
                              <span
                                key={a}
                                className={cn(
                                  "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px]",
                                  a === "free-forever"
                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                                    : a === "free-tier"
                                      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                                      : "border-teal-500/40 bg-teal-500/10 text-teal-300"
                                )}
                              >
                                {a}
                              </span>
                            ))}
                          {e.url && (
                            <a
                              href={e.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-auto shrink-0 text-[10px] text-muted-foreground hover:text-teal-400"
                              aria-label={`Open ${e.name} (${e.provider})`}
                            >
                              ↗
                            </a>
                          )}
                        </div>
                        {(e.freeLimit || e.types.length > 0) && (
                          <p
                            className="mt-0.5 truncate text-[10px] text-muted-foreground"
                            title={[e.freeLimit, e.types.length ? `types: ${e.types.join(", ")}` : ""].filter(Boolean).join(" — ")}
                          >
                            {e.freeLimit ?? e.types.join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-muted-foreground">
                <span>
                  {freellm.total} sources · {freellm.counts.operational} operational ·{" "}
                  {freellm.counts.degraded} degraded
                </span>
                <span>
                  updated {new Date(freellm.asOf).toLocaleString()} · {freellm.ms}ms
                </span>
              </div>
            </>
          ) : freellm ? (
            <p className="mt-2 text-[11px] text-muted-foreground" role="status">
              freellm.sh census unavailable — {freellm.note ?? "no parsed payload"}. No
              invented reach data; hit Refresh to retry.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground" role="status">
              Crawling freellm.sh… the reach list lands in a moment.
            </p>
          )}
        </div>

        {/* ── r506: Utility fast lanes — the AI buttons (plan generation,
            auto-assign, memory folds) dial a FAST above-moderate lane with
            emergent substitutions instead of the largest reasoning model.
            Violet row (matches the primary row + the ✨ utility identity). */}
        <div
          className="rounded-lg border border-violet-500/25 bg-violet-500/[0.04] p-3"
          data-testid="utility-fast-lane"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
              <Sparkles className="h-3.5 w-3.5 text-violet-400" aria-hidden />
              Utility fast lanes
            </p>
            <Switch
              aria-label="Toggle utility fast lanes"
              checked={settings.utilityFastLane !== false}
              onCheckedChange={(v) => update({ utilityFastLane: v })}
            />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            AI buttons (plan generation, auto-assign, memory folds) are SMALL
            tasks: they dial a fast, above-moderate lane — free-first — with a
            30s first-token budget and emergent substitutions, instead of the
            largest reasoning model.
          </p>
          <p
            className="mt-1.5 truncate font-mono text-[11px] text-violet-300/90"
            title={`Utility dial order: ${utilityWire.preview}`}
            aria-label={`Utility dial order: ${utilityWire.preview}`}
          >
            {utilityWire.fast ? "⚡ ": "→ "}
            {utilityWire.preview}
          </p>
        </div>

        {/* ── r516: Decision gates — the System-One tier reviews every workflow
            step output on the FREE decision quota (Intern Decision-4B → fast
            judge; paid Jev stays demoted last). Emerald row (the SystemOne
            identity color across the harness). */}
        <div
          className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-3"
          data-testid="decision-gates"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
              <CircleCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
              Decision gates in workflows
            </p>
            <Switch
              aria-label="Toggle per-step decision gates"
              checked={settings.decisionGates !== false}
              onCheckedChange={(v) => update({ decisionGates: v })}
            />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            After every workflow step, the free System-One primitive (Intern
            Decision-4B — its own 200 RPM decision quota, separate from the
            generative 50 RPM) judges the output against the step assignment.
            Confident PASS: accepted with a witness line. Confident FAIL: one
            bounded free rework pass. Uncertain or no judge: accepted unchanged
            — the gate never blocks, and the generative quota stays untouched.
          </p>
        </div>

        {/* ── r578: Peer blind score — a SECOND, deliberately blind cheap-lane
            reviewer (output only, no assignment) on the same free decision
            quota. Amber row: the dissenting second opinion by design. */}
        <div
          className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3"
          data-testid="peer-blind-score"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
              <CircleCheck className="h-3.5 w-3.5 text-amber-400" aria-hidden />
              Peer blind score (crew quality)
            </p>
            <Switch
              aria-label="Toggle peer blind scoring"
              checked={settings.peerBlindScore !== false}
              onCheckedChange={(v) => update({ peerBlindScore: v })}
            />
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            A second independent reviewer sees ONLY the output — never the task
            or step assignment — and rates substance, coherence and completeness
            on the same free decision quota. Confident FAIL: one bounded
            blind-revise pass. Uncertain or no judge: accepted unchanged — like
            the decision gate, it never blocks a run.
          </p>
        </div>

        {/* Primary — always first, not reorderable */}
        <div className="flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/5 px-2.5 py-2">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-violet-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">
              {primary.label}
              {primary.model ? (
                <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                  {primary.model}
                </span>
              ) : null}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Primary — always tried first
            </p>
          </div>
        </div>

        {/* Fallback chain */}
        <div
          className={cn(
            "space-y-1.5 transition-opacity",
            !enabled && "pointer-events-none opacity-40"
          )}
          role="list"
          aria-label="Fallback chain"
        >
          {chain.map((hop, i) => {
            const orderIndex = hop.providerId === "auto" ? -1 : reorderable.indexOf(hop);
            return (
              <HopRow
                key={hop.key}
                hop={hop}
                index={i}
                orderIndex={orderIndex}
                orderCount={reorderable.length}
                enabled={enabled}
                health={health[hop.key]}
                docked={hopBreakerDocked(hop, breaker, health)}
                reach={matchFreellmEntry(freellm, hop.model)}
                onMove={(d) => move(orderIndex, d)}
              />
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            disabled={!enabled || (settings.relayOrder ?? []).length === 0}
            onClick={resetOrder}
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Reset order
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            disabled={Object.keys(health).length === 0}
            onClick={() => {
              resetRelayHealth();
              resetProviderBreakers();
              setHealth({});
              setBreaker({});
              toast.success("Relay health & breaker memory cleared");
            }}
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Clear health memory
          </Button>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Info className="h-3 w-3" aria-hidden />
            Hops without a saved key are skipped automatically.
          </p>
        </div>

        {/* ── r504: Fleet health — the owner pasted Vyce's own status page
            (degraded, 58.3% uptime, a whole model family offline); this board
            is the platform's mirror of that truth, per provider: lane verdicts,
            breaker countdowns, and the “one more fail trips it” anticipation. */}
        <section
          className={cn(
            "rounded-lg border p-3",
            degraded
              ? "border-amber-500/30 bg-amber-500/[0.05]"
              : "border-border/80 bg-muted/20"
          )}
          aria-label="Provider fleet health"
          data-testid="fleet-health"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <Activity
              className={cn("h-3.5 w-3.5", degraded ? "text-amber-400" : "text-emerald-400")}
              aria-hidden
            />
            <p className="text-xs font-semibold">Fleet health</p>
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                degraded ? "animate-pulse bg-amber-400" : "bg-emerald-400"
              )}
              aria-hidden
            />
            <Badge variant="outline" className="text-[10px] font-normal">
              {fleet.length === 0
                ? "no dial history"
                : `${fleet.length} provider${fleet.length === 1 ? "" : "s"} · live verdicts`}
            </Badge>
          </div>

          {quarantinedCount > 0 && (
            <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-300">
              Circuit breaker open — {quarantinedCount} provider
              {quarantinedCount === 1 ? "" : "s"} quarantined. Their lanes dial
              last until the timer lapses, then the next dial re-probes them.
              Lanes that answered in the last 15m keep their seat.
            </p>
          )}

          {fleet.length === 0 ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              No failures or answers recorded yet — rows appear here as the
              rotator learns which lanes and fleets live.
            </p>
          ) : (
            <div className="mt-2 max-h-44 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-amber-500/30">
              <ul className="divide-y rounded-md border border-border/70 bg-background/40">
                {fleet.map((row) => (
                  <FleetHealthRow key={row.providerId} row={row} />
                ))}
              </ul>
            </div>
          )}
          <p className="mt-2 text-[10.5px] leading-relaxed text-muted-foreground">
            Breaker arms at {BREAKER_STREAK_THRESHOLD} consecutive hard fails
            (429/capacity noise never counts) — quarantine 10m → 20m → 40m → 60m
            per repeat trip; any answer heals it instantly.
          </p>
        </section>

        {/* ── r503: Radar → Relay adoption pipeline ────────────────────────
            Placed after the chain list: it explains WHERE the fresh hops
            come from and manages the registry — the chain's supply line,
            read best once the chain itself is on screen. Styling mirrors
            the sky "Prefer server relay" row, in emerald (radar = fresh
            free capacity). */}
        <section
          className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] p-3"
          aria-label="Radar to relay adoption pipeline"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                <Radar className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                Radar → Relay pipeline
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Brand-new FREE models the Model Tracker sees at first sight
                automatically join this chain with their provider tags — fresh
                capacity dials before it goes stale. Failures self-demote via
                the health memory. Turn off to adopt manually only.
              </p>
            </div>
            <Switch
              aria-label="Auto-adopt new free radar lanes into the relay"
              checked={settings.radarAutoAdopt !== false}
              onCheckedChange={(v) => update({ radarAutoAdopt: v })}
              className="mt-0.5 shrink-0"
            />
          </div>

          {/* Adopted-lane registry (audit + per-lane control). */}
          <div className="mt-2.5">
            {lanes.length === 0 ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                No adopted lanes yet — the radar fills this list as the tracker
                sees new free models (or use Adopt on a radar row).
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-emerald-500/30">
                <ul className="divide-y rounded-md border border-emerald-500/20 bg-background/40">
                  {lanes.map((lane) => (
                    <AdoptedLaneRow key={lane.key} lane={lane} onLanes={setLanes} />
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[10.5px] text-muted-foreground">
                {lanes.length}/{MAX_ADOPTED_LANES} adopted lanes ride the chain · oldest evicted
                past the cap
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[11px] text-red-500/90 hover:text-red-500"
                disabled={lanes.length === 0}
                onClick={() => {
                  clearAdoptedLanes();
                  setLanes([]);
                  toast.success("Adopted lanes cleared");
                }}
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                Clear all
              </Button>
            </div>
          </div>
        </section>

        {/* r510 System-One decisions — FREE provider decision primitives first */}
        <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" aria-hidden />
            <p className="text-xs font-semibold">System-One decisions (free lanes)</p>
            <Badge variant="outline" className="text-[10px] font-normal">
              $0 · automated
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Classification, judging and verification gates run on a fast
            &quot;System One&quot; primitive instead of a frontier model. r510
            ladder: ① the <strong>free</strong> Intern SystemOne primitive
            (书生 Decision 4B — 200 RPM decision quota, separate from the
            generative 50 RPM) → ② the fastest free flash lane in your vault →
            ③ paid typesafe Jev only if you ever paste its key (you don&apos;t
            need it). No key below is an SSL/GPG certificate — they are plain
            provider API keys, exactly like the ones in the Providers vault.
          </p>
          {(() => {
            const internKey = settings.providerKeys?.["intern-discovery"]?.key?.trim();
            return internKey ? (
              <div className="mt-2 flex items-start gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden />
                <p className="text-[11px] leading-relaxed text-emerald-300/90">
                  Intern TokenPlan key detected in your vault — decision gates
                  dial the <span className="font-medium">free SystemOne primitive</span>{" "}
                  (intern-decision-4b) and never bill a token. The generative
                  quota stays untouched.
                </p>
              </div>
            ) : (
              <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                <p className="text-[11px] leading-relaxed text-amber-300/90">
                  Add an <span className="font-medium">Intern TokenPlan</span> key
                  in the Providers vault to arm the free decision primitive —
                  until then the ladder uses the fastest flash lane in your
                  vault, which also works and stays $0.
                </p>
              </div>
            );
          })()}
          <details className="group mt-2 rounded-md border border-border/60 bg-background/40">
            <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
              Legacy paid option — typesafe.ai Jev (not needed) ▾
            </summary>
            <div className="px-2 pb-2">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Kept only for completeness: Jev is typesafe.ai&apos;s paid
                decision API (~$0.042/Mtok, input-only). If you ever want it,
                paste that provider&apos;s <span className="font-medium">API key</span> here
                (it starts with <code className="font-mono">sk-</code> and comes
                from typesafe.ai&apos;s console — it is NOT an SSL/GPG key and
                never leaves your browser). Without it the ladder above already
                covers everything for free.
              </p>
              <Input
                type="password"
                value={settings.typesafeKey ?? ""}
                onChange={(e) => update({ typesafeKey: e.target.value })}
                placeholder="typesafe.ai API key — optional, not required"
                aria-label="Legacy typesafe.ai (Jev) API key — optional"
                autoComplete="off"
                className="mt-2 h-8 border-border/70 bg-background/60 font-mono text-xs"
              />
            </div>
          </details>
        </div>
      </CardContent>
    </Card>
  );
}

function HopRow({
  hop,
  index,
  orderIndex,
  orderCount,
  enabled,
  health,
  docked,
  reach,
  onMove,
}: {
  hop: RelayHop;
  /** Position in the displayed chain (row number only). */
  index: number;
  /** Position among REORDERABLE hops — auto is pinned and never swappable. */
  orderIndex: number;
  orderCount: number;
  enabled: boolean;
  health?: RelayHealthEntry;
  /** r504: the provider's circuit breaker is open and this lane is docked. */
  docked: boolean;
  /** r517: freellm.sh reach match — this model is free+operational somewhere. */
  reach?: FreellmEntry | null;
  onMove: (dir: -1 | 1) => void;
}) {
  const isAuto = hop.providerId === "auto";
  const cooling = !!health?.lastFailAt && Date.now() - health.lastFailAt < 5 * 60_000;
  const free = hopIsFree(hop);
  return (
    <div
      role="listitem"
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-2",
        isAuto ? "border-dashed border-border/70" : "border-border",
        (cooling || docked) && "border-amber-500/40 bg-amber-500/5",
        docked && "opacity-80"
      )}
    >
      <span className="w-5 shrink-0 text-center font-mono text-[10px] text-muted-foreground">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-medium">{hop.label}</span>
          <Badge
            variant="outline"
            className={cn("text-[10px] font-normal", TIER_STYLE[hop.tier])}
          >
            T{hop.tier} {TIER_LABEL[hop.tier]}
          </Badge>
          {/* r516: the ordering badge is the BENCHMARK BLEND now — live index
              when a leaderboard row matched, catalog Elo prior otherwise.
              Static Elo survives only inside the tooltip (the 35% prior). */}
          <Badge
            variant="outline"
            className={cn(
              "font-mono text-[10px] font-normal",
              hop.intelOrigin === "live"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "text-muted-foreground"
            )}
            title={
              hop.intelOrigin === "live"
                ? `Intelligence ${((hop.intel ?? hop.elo).toFixed(3))} = 65% benchmark "${hop.intelName ?? hop.model}" + 35% catalog Elo ${hop.elo.toFixed(2)} — this is what orders the ladder`
                : `No leaderboard row matched "${hop.model}" — ordering falls back to the catalog Elo prior (${hop.elo.toFixed(2)})`
            }
          >
            Intel {(hop.intel ?? hop.elo).toFixed(3)}
            {hop.intelOrigin === "live" ? "" : "°"}
          </Badge>
          {free && !isAuto && (
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-[10px] font-normal text-emerald-400"
              title="Free frontier lane — the failover policy may prefer it"
            >
              free
            </Badge>
          )}
          {/* r517: reach witness — the freellm.sh census independently
              confirms this model as free AND operational somewhere. */}
          {reach && !isAuto && (
            <Badge
              variant="outline"
              className="border-teal-500/40 bg-teal-500/10 text-[10px] font-normal text-teal-300"
              title={`freellm.sh census: free + operational on ${reach.provider}${reach.freeLimit ? ` — ${reach.freeLimit}` : ""}`}
            >
              reach
            </Badge>
          )}
          {docked ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-[10px] font-normal text-amber-300"
              title="Provider circuit breaker open — this lane dials last until the quarantine lapses"
            >
              <CircleAlert className="mr-0.5 h-2.5 w-2.5" aria-hidden />
              breaker dock
            </Badge>
          ) : cooling ? (
            <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] font-normal text-amber-300">
              <CircleAlert className="mr-0.5 h-2.5 w-2.5" aria-hidden />
              demoted — failed recently
            </Badge>
          ) : health && health.ok > 0 ? (
            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] font-normal text-emerald-400">
              <CircleCheck className="mr-0.5 h-2.5 w-2.5" aria-hidden />
              answered {health.ok}×
            </Badge>
          ) : null}
        </div>
        {hop.note && (
          <p className="truncate text-[11px] text-muted-foreground">{hop.note}</p>
        )}
      </div>
      {!isAuto && enabled && (
        <div className="flex shrink-0 flex-col gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 w-6 p-0 text-muted-foreground"
            aria-label={`Move ${hop.label} up`}
            disabled={orderIndex <= 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="h-3 w-3" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 w-6 p-0 text-muted-foreground"
            aria-label={`Move ${hop.label} down`}
            disabled={orderIndex >= orderCount - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-3 w-3" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── r504: one fleet-health row (aggregated provider verdict) ────────────
function FleetHealthRow({ row }: { row: FleetRow }) {
  const meta = providerMeta(row.providerId);
  const nearTrip = !row.quarantined && row.streak >= BREAKER_STREAK_THRESHOLD - 1;
  return (
    <li className="flex items-center gap-2 px-2.5 py-1.5">
      <span aria-hidden className="w-5 shrink-0 text-center text-sm" title={meta.label}>
        {meta.glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-medium">{meta.label}</span>
          {row.quarantined ? (
            <Badge
              variant="outline"
              className="border-amber-500/50 bg-amber-500/15 text-[10px] font-semibold text-amber-300"
              title="Circuit breaker open — lanes dial last until the quarantine lapses"
            >
              <CircleAlert className="mr-0.5 h-2.5 w-2.5" aria-hidden />
              breaker {fmtQuarantineLeft(row.leftMs)}
            </Badge>
          ) : nearTrip ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-[10px] font-normal text-amber-300"
              title={`${row.streak} consecutive hard fails — one more trips the breaker`}
            >
              1 fail → breaker
            </Badge>
          ) : null}
          {row.sickLanes > 0 && (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-[10px] font-normal text-amber-300"
            >
              {row.sickLanes} sick
            </Badge>
          )}
          {row.throttledLanes > 0 && (
            <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
              {row.throttledLanes} throttled
            </Badge>
          )}
          {row.okLanes > 0 && (
            <Badge
              variant="outline"
              className="border-emerald-500/40 bg-emerald-500/10 text-[10px] font-normal text-emerald-400"
            >
              {row.okLanes} ok · {row.answered}×
            </Badge>
          )}
        </div>
        {row.lastError && (
          <p className="truncate text-[10px] text-muted-foreground" title={row.lastError}>
            {row.lastError}
          </p>
        )}
      </div>
    </li>
  );
}

// ─── r503: one adopted-lane registry row (Radar → Relay pipeline section) ────
// Tags are the "correct tags in first seen" the owner asked for: provider
// glyph + free/paid + ctx + $in/$out + first-seen age + origin, and when the
// lane is disabled a red chip carries the reason (audit trail, not deletion).
// r512: RETIRED lanes (proven removed from their provider catalog) render an
// amber retired chip with the full reason+date in the tooltip, and a Restore
// affordance ONLY when the catalog shows the lane again — the restore
// re-verifies against a live /api/tracker fetch before un-retiring.
function AdoptedLaneRow({
  lane,
  onLanes,
}: {
  lane: AdoptedLane;
  /** Registry setter — fed straight from the action's return value. */
  onLanes: (lanes: AdoptedLane[]) => void;
}) {
  const price = fmtPrice({ priceIn: lane.priceIn ?? null, priceOut: lane.priceOut ?? null });
  const ctx = fmtCtx(lane.contextWindow ?? null);
  const retired = lane.retired === true;
  // The restore affordance exists only while the (mirror of the) catalog
  // shows the lane alive; the click path re-verifies live before un-retiring.
  const [canRestore, setCanRestore] = React.useState(() => retired && catalogHasLane(lane.key));
  const [restoring, setRestoring] = React.useState(false);
  // Keep the affordance in step with the 15s registry poll and the tracker
  // mirror's own refresh cadence.
  React.useEffect(() => {
    if (!retired) return;
    const t = window.setInterval(() => setCanRestore(catalogHasLane(lane.key)), 15_000);
    return () => window.clearInterval(t);
  }, [retired, lane.key]);

  async function restore() {
    setRestoring(true);
    try {
      const res = await fetch("/api/tracker", { cache: "no-store" });
      const json = res.ok
        ? ((await res.json()) as { tracked?: Array<{ id?: string; removedAt?: string | null }> })
        : null;
      const row = json?.tracked?.find((r) => r?.id === lane.key);
      if (!row || row.removedAt) {
        toast.error(`${lane.modelId} is still absent from the provider catalog — nothing to restore yet`);
        setCanRestore(false);
        return;
      }
      onLanes(restoreLane(lane.key));
      toast.success(`${lane.modelId} restored to the relay chain`);
    } catch {
      toast.error("Catalog check failed — try again");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <li className={cn("flex items-center gap-2 px-2.5 py-1.5", (!lane.enabled || retired) && "opacity-70")}>
      <span aria-hidden className="w-5 shrink-0 text-center text-sm" title={providerMeta(lane.providerId).label}>
        {providerMeta(lane.providerId).glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-mono text-[11.5px] font-medium" title={lane.modelId}>
            {lane.modelId}
          </span>
          {lane.free ? (
            <Badge variant="secondary" className="h-4 shrink-0 rounded bg-emerald-500/15 px-1 text-[9px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
              free
            </Badge>
          ) : (
            <Badge variant="secondary" className="h-4 shrink-0 rounded bg-muted px-1 text-[9px] font-bold uppercase text-muted-foreground">
              paid
            </Badge>
          )}
          {retired ? (
            <Badge
              variant="outline"
              title={`${lane.retiredReason ?? "removed from provider catalog"} · retired ${fmtAge(lane.retiredAt ?? lane.adoptedAt)}`}
              className="h-4 shrink-0 rounded border-amber-500/40 bg-amber-500/10 px-1 text-[9px] font-semibold uppercase text-amber-600 dark:text-amber-300"
            >
              <CircleAlert className="mr-0.5 h-2.5 w-2.5" aria-hidden />
              retired
            </Badge>
          ) : !lane.enabled ? (
            <Badge
              variant="outline"
              title={lane.disabledReason ?? "disabled"}
              className="h-4 min-w-0 max-w-44 rounded border-red-500/40 bg-red-500/10 px-1 text-[9px] font-semibold uppercase text-red-600 dark:text-red-400"
            >
              <span className="truncate">{lane.disabledReason ?? "disabled"}</span>
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-[10px] text-muted-foreground">
          {[ctx, price, `first seen ${fmtAge(lane.firstSeenAt)}`].filter(Boolean).join(" · ") ||
            "tags n/a"}
        </p>
      </div>
      <Badge
        variant="outline"
        className="shrink-0 font-mono text-[9px] font-normal uppercase text-muted-foreground"
      >
        {lane.origin === "radar-auto" ? "auto" : "manual"}
      </Badge>
      {retired ? (
        canRestore ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={restoring}
            className="h-6 shrink-0 gap-1 px-1.5 text-[10.5px] text-amber-600 hover:text-amber-500 dark:text-amber-300"
            aria-label={`Restore ${lane.modelId} to the relay — it re-appeared in the catalog`}
            onClick={() => void restore()}
          >
            <ArchiveRestore className="h-3 w-3" aria-hidden />
            {restoring ? "Checking…" : "Restore"}
          </Button>
        ) : null
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-1.5 text-[10.5px] text-muted-foreground"
          aria-label={lane.enabled ? `Mute ${lane.modelId} in the relay` : `Re-enable ${lane.modelId} in the relay`}
          onClick={() => {
            onLanes(setAdoptedLaneEnabled(lane.key, !lane.enabled));
            toast.success(lane.enabled ? `${lane.modelId} muted` : `${lane.modelId} back in the chain`);
          }}
        >
          {lane.enabled ? "Mute" : "Enable"}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-red-500"
        aria-label={`Remove ${lane.modelId} from adopted lanes`}
        onClick={() => {
          onLanes(removeAdoptedLane(lane.key));
          toast.success(`${lane.modelId} removed from the relay registry`);
        }}
      >
        <Trash2 className="h-3 w-3" aria-hidden />
      </Button>
    </li>
  );
}
