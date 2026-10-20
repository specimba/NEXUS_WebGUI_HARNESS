"use client";

// ─── Model Relay settings card ───────────────────────────────────────────────
// The "Genius rotator" doctrine, applied to the free-frontier vault: an ordered
// fallback chain (Generation-Era tier → arena Elo) that the engine rotates
// through when the active model fails before streaming anything.

import * as React from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleAlert,
  Info,
  Radar,
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
// r503: Radar → Relay adoption pipeline — this card renders and manages the
// adopted-lane registry (localStorage `nexus-relay-adopted`, written by the
// radar tab's auto-pipeline AND the row actions below) plus the auto-adopt
// switch. buildRelayChain() above already appends the enabled ones as hops.
import {
  MAX_ADOPTED_LANES,
  adoptedLanesSnapshot,
  clearAdoptedLanes,
  removeAdoptedLane,
  setAdoptedLaneEnabled,
  type AdoptedLane,
} from "@/lib/lane-adopt";
import { fmtAge, fmtCtx, fmtPrice, providerMeta } from "@/lib/tracker-types";
import { cn } from "@/lib/utils";

const TIER_STYLE: Record<1 | 2 | 3, string> = {
  1: "border-violet-500/50 bg-violet-500/15 text-violet-300",
  2: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  3: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

// ── r504: failover policy copy (owner directive: "auto-rotate them to the
// best available alternative free frontiers for continuation smartly") ──
const POLICY_COPY: Record<RelayFailoverPolicy, { label: string; desc: string }> = {
  smart: {
    label: "Smart",
    desc: "Keeps quality tiers, but a FREE lane outranks paid siblings of its era — outages ride free frontiers before spending a cent.",
  },
  quality: {
    label: "Quality",
    desc: "Classic doctrine: Generation-Era tier first, then arena Elo. Free/paid is not a factor.",
  },
  free: {
    label: "Free first",
    desc: "All free lanes dial before any paid lane (tiers still order within). Maximum cost protection during a degraded fleet.",
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

  const primary = resolveLlm(settings);
  const policy: RelayFailoverPolicy = settings.relayFailoverPolicy ?? "smart";
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
  }, [settings, primary]);

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
    toast.success("Relay order reset to recommended (tier → Elo)");
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
          hops that failed recently are demoted automatically.
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

        {/* r27 System-One decisions (Jev) — the cheap calibrated judging tier */}
        <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" aria-hidden />
            <p className="text-xs font-semibold">System-One decisions (Jev)</p>
            <Badge variant="outline" className="text-[10px] font-normal">
              optional
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Classification, judging and verification gates run on a fast
            "System One" primitive instead of a frontier model — decision-fit
            relay lanes (flash models) are tried first. Paste a typesafe.ai key
            to use Jev natively (choice/noul decisions, ~$0.042/Mtok,
            input-only); without a key the ladder falls back to the fastest
            lane in your vault — everything keeps working either way.
          </p>
          <Input
            type="password"
            value={settings.typesafeKey ?? ""}
            onChange={(e) => update({ typesafeKey: e.target.value })}
            placeholder="typesafe.ai API key (optional)"
            aria-label="System-One (Jev) API key"
            autoComplete="off"
            className="mt-2 h-8 border-border/70 bg-background/60 font-mono text-xs"
          />
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
          <Badge variant="outline" className="font-mono text-[10px] font-normal">
            Elo {hop.elo.toFixed(2)}
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
  return (
    <li className={cn("flex items-center gap-2 px-2.5 py-1.5", !lane.enabled && "opacity-70")}>
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
          {!lane.enabled && (
            <Badge
              variant="outline"
              title={lane.disabledReason ?? "disabled"}
              className="h-4 min-w-0 max-w-44 rounded border-red-500/40 bg-red-500/10 px-1 text-[9px] font-semibold uppercase text-red-600 dark:text-red-400"
            >
              <span className="truncate">{lane.disabledReason ?? "disabled"}</span>
            </Badge>
          )}
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
