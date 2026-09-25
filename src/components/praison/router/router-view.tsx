"use client";

// ─── Router view (r49) — the failover state machine, made visible ────────────
// Four tabs over the routing intelligence:
//   Health      — live lane cooldowns / demotions from the relay's memory
//   Event log   — every failover attempt, queryable, correlated by request id
//   Watchdog    — pattern scan over the log + human-confirmed weight actions
//   Leaderboard — the dated model-ranking snapshot that keeps Elo honest
// Doctrine: a user-visible rate-limit error is a bug unless every lane was
// tried; cooldown ≠ removal; the human confirms every routing change.

import * as React from "react";
import {
  Activity,
  BadgeCheck,
  CircleAlert,
  ClipboardList,
  Clock3,
  Copy,
  ExternalLink,
  Gauge,
  HeartPulse,
  History,
  Info,
  Radar as RadarIcon,
  RefreshCw,
  ShieldAlert,
  TimerReset,
  Trophy,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtRel } from "@/lib/helpers";
import {
  buildRelayChain,
  isCapacityCooled,
  laneReliabilityPenalty,
  leaderboardMeta,
  providerInCooldown,
  relayHealthSnapshot,
  resetRelayHealth,
  type RelayHealthEntry,
} from "@/lib/relay";
import { lastRosterSweepAt, probeNow, PROBE_INTERVAL_MS, sweepNow, SWEEP_EVERY_TICKS } from "@/lib/relay-prober";
import { useSettingsStore } from "@/lib/stores";
import { cn } from "@/lib/utils";

// ─── shared bits ──────────────────────────────────────────────────────────────

const KIND_STYLE: Record<string, string> = {
  "rate-limit": "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  network: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  timeout: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  credits: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
  auth: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  region: "border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  model: "border-muted-foreground/40 bg-muted text-muted-foreground",
  unknown: "border-muted-foreground/40 bg-muted text-muted-foreground",
};

const ACTION_LABEL: Record<string, string> = {
  served: "answered",
  rotated: "rotated past",
  cooled: "capacity-cooled",
  demoted: "demoted",
  recorded: "recorded (mid-stream)",
  exhausted: "chain exhausted",
  "probe-revived": "probe revived",
  "probe-extended": "probe extended",
  "sweep-ok": "sweep ok",
  "sweep-fail": "sweep caught",
  failed: "failed",
};

function actionStyle(action?: string | null): string {
  switch (action) {
    case "served":
    case "probe-revived":
    case "sweep-ok":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "cooled":
    case "probe-extended":
      return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    case "demoted":
    case "exhausted":
      return "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400";
    case "rotated":
      return "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400";
    case "sweep-fail":
      // a sweep-caught corpse: same family as a demotion but visually distinct
      return "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400";
    default:
      return "border-muted-foreground/40 bg-muted text-muted-foreground";
  }
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  return fmtRel(t);
}

// ─── view shell ───────────────────────────────────────────────────────────────

type RouterTab = "health" | "events" | "watchdog" | "leaderboard";

export function RouterView() {
  const [tab, setTab] = React.useState<RouterTab>("health");
  const relayEnabled = useSettingsStore((s) => s.settings.relayEnabled !== false);
  const [cooledCount, setCooledCount] = React.useState(0);

  React.useEffect(() => {
    const scan = () => {
      const h = relayHealthSnapshot();
      setCooledCount(Object.values(h).filter((e) => isCapacityCooled(e)).length);
    };
    scan();
    const t = window.setInterval(scan, 10_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section aria-label="Router" className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <RadarIcon className="h-5 w-5 text-violet-400" aria-hidden />
            Router
            <Badge variant="outline" className="text-[10px] font-normal">
              failover v2
            </Badge>
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            The failover state machine behind every LLM call: capacity errors cool a lane
            down (2–30 min, jittered, escalating), account-shaped 402s cool the whole
            provider (10 min → 4 h) and the chain deterministically rotates to the
            healthiest lane — within the same request. A background probe re-admits
            recovered lanes every {Math.round(PROBE_INTERVAL_MS / 1000)}s; a slower roster
            sweep re-verifies quiet lanes every ~{SWEEP_EVERY_TICKS} min. Cooldown is
            never removal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-normal",
              relayEnabled
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-rose-500/40 bg-rose-500/10 text-rose-500"
            )}
          >
            <Activity className="mr-0.5 h-2.5 w-2.5" aria-hidden />
            relay {relayEnabled ? "on" : "off"}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-normal",
              cooledCount > 0
                ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-muted-foreground/30 bg-muted/40 text-muted-foreground"
            )}
          >
            <Clock3 className="mr-0.5 h-2.5 w-2.5" aria-hidden />
            {cooledCount} cooling
          </Badge>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as RouterTab)} className="min-h-0 flex-1">
        <TabsList className="grid w-full max-w-xl grid-cols-4">
          <TabsTrigger value="health" className="gap-1.5 text-xs">
            <HeartPulse className="h-3.5 w-3.5" aria-hidden /> Health
          </TabsTrigger>
          <TabsTrigger value="events" className="gap-1.5 text-xs">
            <History className="h-3.5 w-3.5" aria-hidden /> Events
          </TabsTrigger>
          <TabsTrigger value="watchdog" className="gap-1.5 text-xs">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Watchdog
          </TabsTrigger>
          <TabsTrigger value="leaderboard" className="gap-1.5 text-xs">
            <Trophy className="h-3.5 w-3.5" aria-hidden /> Ranks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="mt-4">
          <HealthTab />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <EventsTab />
        </TabsContent>
        <TabsContent value="watchdog" className="mt-4">
          <WatchdogTab />
        </TabsContent>
        <TabsContent value="leaderboard" className="mt-4">
          <LeaderboardTab />
        </TabsContent>
      </Tabs>
    </section>
  );
}

// ─── Health tab ───────────────────────────────────────────────────────────────

interface LaneRow {
  key: string;
  label: string;
  providerId: string;
  entry: RelayHealthEntry | undefined;
}

function HealthTab() {
  const settings = useSettingsStore((s) => s.settings);
  const [rows, setRows] = React.useState<LaneRow[]>([]);
  const [now, setNow] = React.useState(() => Date.now());
  const [ticking, setTicking] = React.useState(false);

  const rescan = React.useCallback(() => {
    const health = relayHealthSnapshot();
    const chain = buildRelayChain(settings);
    const seen = new Set<string>();
    const next: LaneRow[] = [];
    for (const h of chain) {
      if (h.providerId === "auto" || seen.has(h.key)) continue;
      seen.add(h.key);
      const entry = health[h.key];
      // Only lanes with history or an active cooldown are interesting.
      if (entry && (entry.ok > 0 || entry.fail > 0 || isCapacityCooled(entry))) {
        next.push({ key: h.key, label: h.label, providerId: h.providerId, entry });
      }
    }
    // r49 QA fix: buildRelayChain EXCLUDES capacity-cooled hops while enough
    // healthy alternatives exist (failover doctrine) — which made the Health
    // tab blind to exactly the lanes it exists to show. Merge off-chain
    // history entries (cooled lanes, stale keys) back in.
    for (const [key, entry] of Object.entries(health)) {
      if (seen.has(key) || key === "auto::builtin") continue;
      if (!(entry.ok > 0 || entry.fail > 0 || isCapacityCooled(entry))) continue;
      const idx = key.indexOf("::");
      next.push({
        key,
        label: idx === -1 ? key : `${key.slice(0, idx)} · ${key.slice(idx + 2)}`,
        providerId: idx === -1 ? key : key.slice(0, idx),
        entry,
      });
    }
    setRows(next);
    setNow(Date.now());
  }, [settings]);

  React.useEffect(() => {
    rescan();
    const t = window.setInterval(rescan, 10_000);
    return () => window.clearInterval(t);
  }, [rescan]);

  // Tick a 1s clock while any cooldown is running so remaining times count down.
  React.useEffect(() => {
    const anyCooling = rows.some((r) => isCapacityCooled(r.entry));
    if (!anyCooling) {
      setTicking(false);
      return;
    }
    setTicking(true);
    const t = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(t);
  }, [rows]);

  const groups = React.useMemo(() => {
    const map = new Map<string, LaneRow[]>();
    for (const r of rows) {
      const list = map.get(r.providerId) ?? [];
      list.push(r);
      map.set(r.providerId, list);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 rounded-lg text-xs"
          onClick={() => {
            probeNow();
            toast.info("Probe tick started — cooled lanes get a 1-token health check.");
          }}
        >
          <Zap className="h-3 w-3" aria-hidden />
          Probe now
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 rounded-lg text-xs"
          onClick={() => {
            sweepNow();
            toast.info("Roster sweep started — the two least-recently-verified lanes get a 1-token check.");
          }}
        >
          <RadarIcon className="h-3 w-3" aria-hidden />
          Sweep now
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground"
          onClick={() => {
            resetRelayHealth();
            rescan();
            toast.success("Relay health memory cleared");
          }}
        >
          <TimerReset className="h-3 w-3" aria-hidden />
          Clear health memory
        </Button>
        <span className="text-[11px] text-muted-foreground">
          sweep every ~{SWEEP_EVERY_TICKS} min · 2 lanes/tick · last{" "}
          {lastRosterSweepAt() ? fmtRel(lastRosterSweepAt()) : "never"}
        </span>
        {ticking ? (
          <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
            <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
            cooldowns counting down…
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Card className="gap-3">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Gauge className="h-6 w-6 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium">No lane history yet</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              Run a chat or pipeline — every hop attempt (answer, rotation, capacity
              cooldown, probe revival) lands here and in the queryable event log.
            </p>
          </CardContent>
        </Card>
      ) : (
        groups.map(([pid, lanes]) => {
          const providerCooling = providerInCooldown(pid);
          return (
            <Card key={pid} className="gap-3">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    {providerCooling ? (
                      <CircleAlert className="h-4 w-4 text-amber-500" aria-hidden />
                    ) : (
                      <BadgeCheck className="h-4 w-4 text-emerald-500" aria-hidden />
                    )}
                    {pid}
                    {providerCooling ? (
                      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                        in cooldown
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {lanes.length} lane{lanes.length === 1 ? "" : "s"}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="max-h-96 space-y-1.5 overflow-y-auto">
                {lanes.map((lane) => {
                  const e = lane.entry;
                  const cooledUntil = e?.cooldownUntil ?? 0;
                  const cooling = cooledUntil > now;
                  const remainMs = Math.max(0, cooledUntil - now);
                  const hardDemoted =
                    !!e?.lastFailAt && !e.soft && now - e.lastFailAt < 5 * 60_000;
                  // r54: chronic-flakiness chip — mirrors the chain sort's
                  // reliability penalty so the ordering is explainable.
                  const rel = laneReliabilityPenalty(e);
                  const relTotal = (e?.ok ?? 0) + (e?.fail ?? 0);
                  return (
                    <div
                      key={lane.key}
                      role="listitem"
                      className={cn(
                        "flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2",
                        cooling
                          ? "border-amber-500/40 bg-amber-500/5"
                          : hardDemoted
                            ? "border-rose-500/30 bg-rose-500/5"
                            : "border-border"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs" title={lane.key}>
                          {lane.key}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          <span className="text-emerald-600 dark:text-emerald-400">{e?.ok ?? 0} ok</span>
                          {" · "}
                          <span className="text-rose-500">{e?.fail ?? 0} fail</span>
                          {" · last ok "}
                          {e?.lastOkAt ? fmtRel(e.lastOkAt) : "never"}
                        </p>
                      </div>
                      {cooling ? (
                        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 gap-1 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                          <Clock3 className="h-2.5 w-2.5" aria-hidden />
                          capacity cooldown {Math.ceil(remainMs / 1000)}s
                        </Badge>
                      ) : hardDemoted ? (
                        <Badge variant="outline" className="border-rose-500/40 bg-rose-500/10 text-[10px] font-normal text-rose-500">
                          demoted — hard failure
                        </Badge>
                      ) : rel > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="border-orange-500/40 bg-orange-500/10 text-[10px] font-normal text-orange-600 dark:text-orange-400">
                              flaky — {e?.ok ?? 0}/{relTotal} answered
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">
                            Long-run reliability {Math.round(((e?.ok ?? 0) / Math.max(1, relTotal)) * 100)}% —
                            the chain sorts this lane below reliable siblings (the watchdog's
                            stall-dominant finding explains the shape).
                          </TooltipContent>
                        </Tooltip>
                      ) : (e?.ok ?? 0) > 0 ? (
                        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-[10px] font-normal text-emerald-600 dark:text-emerald-400">
                          healthy
                        </Badge>
                      ) : null}
                      {e?.lastError ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="max-w-40 cursor-help truncate text-[10px] text-muted-foreground">
                              {e.lastError}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">{e.lastError}</TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

// ─── Events tab ───────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  requestId: string;
  hopKey: string;
  providerId: string;
  modelId: string;
  ok: boolean;
  kind?: string | null;
  action?: string | null;
  attempt?: string | null;
  error?: string | null;
  transport?: string | null;
  createdAt: string;
}

function EventsTab() {
  const [events, setEvents] = React.useState<EventRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [provider, setProvider] = React.useState("");
  const [kind, setKind] = React.useState("");
  const [requestId, setRequestId] = React.useState("");
  const [okFilter, setOkFilter] = React.useState<"" | "true" | "false">("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (provider) qs.set("provider", provider);
      if (kind) qs.set("kind", kind);
      if (requestId) qs.set("requestId", requestId);
      if (okFilter) qs.set("ok", okFilter);
      qs.set("limit", "200");
      const res = await fetch(`/api/router/events?${qs.toString()}`);
      const data = (await res.json()) as { events?: EventRow[] };
      setEvents(data.events ?? []);
    } catch {
      /* keep previous rows */
    } finally {
      setLoading(false);
    }
  }, [provider, kind, requestId, okFilter]);

  React.useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(t);
  }, [load]);

  return (
    <div className="space-y-3">
      <Card className="gap-3">
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <Input
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            placeholder="request id — trace one request end-to-end"
            aria-label="Filter by request id"
            className="h-8 w-full max-w-xs border-border/70 bg-background/60 font-mono text-xs"
          />
          <Input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="provider id"
            aria-label="Filter by provider"
            className="h-8 w-32 border-border/70 bg-background/60 font-mono text-xs"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            aria-label="Filter by error kind"
            className="h-8 rounded-md border border-border/70 bg-background/60 px-2 text-xs"
          >
            <option value="">any kind</option>
            {Object.keys(KIND_STYLE).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select
            value={okFilter}
            onChange={(e) => setOkFilter(e.target.value as "" | "true" | "false")}
            aria-label="Filter by outcome"
            className="h-8 rounded-md border border-border/70 bg-background/60 px-2 text-xs"
          >
            <option value="">any outcome</option>
            <option value="true">answered</option>
            <option value="false">failed</option>
          </select>
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 rounded-lg text-xs" onClick={() => void load()}>
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} aria-hidden />
            Refresh
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {events.length} event{events.length === 1 ? "" : "s"} · auto-refresh 15s
          </span>
        </CardContent>
      </Card>

      {events.length === 0 && !loading ? (
        <Card className="gap-3">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <ClipboardList className="h-6 w-6 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium">No failover events yet</p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              The log records every rotation, capacity cooldown and probe — with the
              request id that ties all attempts of one request together.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="max-h-[30rem] space-y-1.5 overflow-y-auto pr-1" role="list" aria-label="Failover events">
          {events.slice(0, 120).map((ev) => (
            <EventItem key={ev.id} ev={ev} onCorrelate={setRequestId} correlated={!!requestId} />
          ))}
        </div>
      )}

      {requestId ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Info className="h-3 w-3" aria-hidden />
          Showing every recorded attempt of request <span className="font-mono">{requestId}</span> —
          the full failover chain.
          <button
            type="button"
            className="ml-1 underline underline-offset-2 hover:text-foreground"
            onClick={() => setRequestId("")}
          >
            clear
          </button>
        </p>
      ) : null}
    </div>
  );
}

function EventItem({
  ev,
  onCorrelate,
  correlated,
}: {
  ev: EventRow;
  onCorrelate: (id: string) => void;
  correlated: boolean;
}) {
  return (
    <div
      role="listitem"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2",
        ev.ok ? "border-border/70" : "border-border bg-muted/20"
      )}
    >
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground" title={new Date(ev.createdAt).toLocaleString()}>
        {timeAgo(ev.createdAt)}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={`${ev.hopKey} (${ev.attempt ?? "relay"})`}>
        {ev.hopKey}
      </span>
      {ev.action ? (
        <Badge variant="outline" className={cn("text-[10px] font-normal", actionStyle(ev.action))}>
          {ACTION_LABEL[ev.action] ?? ev.action}
        </Badge>
      ) : null}
      {ev.kind && !ev.ok ? (
        <Badge variant="outline" className={cn("text-[10px] font-normal", KIND_STYLE[ev.kind] ?? KIND_STYLE.unknown)}>
          {ev.kind}
        </Badge>
      ) : null}
      {ev.requestId ? (
        <button
          type="button"
          onClick={() => onCorrelate(correlated ? "" : ev.requestId)}
          aria-label={correlated ? "Clear request correlation" : `Trace all attempts of request ${ev.requestId}`}
          className="flex items-center gap-1 rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-violet-500/50 hover:text-violet-400"
        >
          <Copy className="h-2.5 w-2.5" aria-hidden />
          {ev.requestId.slice(0, 8)}
        </button>
      ) : null}
      {ev.error ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="max-w-48 cursor-help truncate text-[10px] text-muted-foreground">
              {ev.error}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm text-xs">{ev.error}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

// ─── Watchdog tab ─────────────────────────────────────────────────────────────

interface WatchdogFinding {
  id: string;
  severity: "info" | "warn" | "critical";
  providerId: string;
  pattern: string;
  evidence: string;
  suggestion: string;
  suggestedWeight?: number;
}

interface WatchdogReport {
  windowDays: number;
  totalEvents: number;
  providers: {
    providerId: string;
    attempts: number;
    fails: number;
    failRate: number;
    kinds: Record<string, number>;
    actions: Record<string, number>;
    lastEventAt?: string;
  }[];
  findings: WatchdogFinding[];
  rateLimitHourHistogram: number[];
  peakRateLimitHourUtc?: number;
}

const SEVERITY_STYLE: Record<WatchdogFinding["severity"], string> = {
  info: "border-sky-500/40 bg-sky-500/5",
  warn: "border-amber-500/50 bg-amber-500/5",
  critical: "border-rose-500/50 bg-rose-500/5",
};

/** r54: human labels for the pattern badges (deep-dive detections included). */
const PATTERN_LABEL: Record<string, string> = {
  "high-fail-rate": "high fail rate",
  "capacity-cycle": "capacity cycle",
  "auth-lock": "auth/model lock",
  "hard-streak": "hard streak",
  "stall-dominant": "stall-dominant lane",
  "structural-credits": "structural credits",
  "single-lane-vault": "single-lane vault",
  "stale-model": "stale model id",
};

function WatchdogTab() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [days, setDays] = React.useState(7);
  const [report, setReport] = React.useState<WatchdogReport | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/router/watchdog?days=${days}`);
      const data = (await res.json()) as { report?: WatchdogReport };
      setReport(data.report ?? null);
    } catch {
      /* keep previous */
    } finally {
      setLoading(false);
    }
  }, [days]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const weights = settings.relayWeights ?? {};

  function applyWeight(providerId: string, weight: number) {
    update({ relayWeights: { ...weights, [providerId]: weight } });
    toast.success(`Routing weight for ${providerId} set to ${weight > 0 ? `+${weight}` : weight}`, {
      description: "The chain sorts by the new weight from the next request on. Human-confirmed — revert anytime.",
    });
  }

  const peak = report?.peakRateLimitHourUtc;
  const peakBar = report ? Math.max(1, ...report.rateLimitHourHistogram) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Watchdog scan window"
          className="h-8 rounded-md border border-border/70 bg-background/60 px-2 text-xs"
        >
          {[1, 3, 7, 14, 30].map((d) => (
            <option key={d} value={d}>
              last {d} day{d === 1 ? "" : "s"}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 rounded-lg text-xs" onClick={() => void load()}>
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} aria-hidden />
          Rescan
        </Button>
        {report ? (
          <span className="text-[11px] text-muted-foreground">
            {report.totalEvents} events scanned
          </span>
        ) : null}
      </div>

      {/* Findings */}
      {report?.findings.length ? (
        <div className="space-y-2">
          {report.findings.map((f) => {
            const applied = weights[f.providerId];
            return (
              <div key={f.id} className={cn("rounded-xl border p-3", SEVERITY_STYLE[f.severity])}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {PATTERN_LABEL[f.pattern] ?? f.pattern}
                  </Badge>
                  <Badge variant="outline" className="border-border/70 font-mono text-[10px] font-normal">
                    {f.providerId}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] font-normal",
                      f.severity === "critical"
                        ? "border-rose-500/40 bg-rose-500/10 text-rose-500"
                        : f.severity === "warn"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    )}
                  >
                    {f.severity}
                  </Badge>
                  <span className="ml-auto text-[11px] text-muted-foreground">{f.evidence}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed">{f.suggestion}</p>
                {f.suggestedWeight !== undefined ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 gap-1.5 rounded-lg px-2.5 text-xs"
                      onClick={() => applyWeight(f.providerId, f.suggestedWeight!)}
                      disabled={applied === f.suggestedWeight}
                    >
                      {applied === f.suggestedWeight ? "Applied" : `Apply weight ${f.suggestedWeight > 0 ? "+" : ""}${f.suggestedWeight}`}
                    </Button>
                    {applied !== undefined && applied !== f.suggestedWeight ? (
                      <span className="text-[10px] text-muted-foreground">
                        current weight: {applied > 0 ? "+" : ""}
                        {applied}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="gap-3">
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <ShieldAlert className="h-6 w-6 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium">
              {loading ? "Scanning the failover log…" : "No patterns need attention"}
            </p>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              The watchdog flags repeated capacity cycles, hard-fail streaks, auth locks,
              high fail rates — plus the deep dives: account-shaped credit exhaustion,
              stall-dominant lanes, stale model ids and one-lane vaults — always as
              suggestions, applied only after you confirm.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Rate-limit hour histogram */}
      {report && report.rateLimitHourHistogram.some((v) => v > 0) ? (
        <Card className="gap-3">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock3 className="h-4 w-4 text-amber-500" aria-hidden />
              Rate-limit hits by UTC hour
              {peak !== undefined ? (
                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                  peak {String(peak).padStart(2, "0")}:00 UTC
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="text-xs">
              Daily-credit reset rhythms show up here — schedule heavy pipelines around the peak.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-20 items-end gap-1" role="img" aria-label="Rate limit hits per UTC hour">
              {report.rateLimitHourHistogram.map((v, h) => (
                <Tooltip key={h}>
                  <TooltipTrigger asChild>
                    <div className="flex h-full flex-1 items-end">
                      <div
                        className={cn(
                          "w-full rounded-t-sm transition-all",
                          v === 0 ? "bg-muted" : "bg-amber-500/60"
                        )}
                        style={{ height: `${Math.max(4, (v / peakBar) * 100)}%` }}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    {String(h).padStart(2, "0")}:00 UTC — {v} hit{v === 1 ? "" : "s"}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Provider stats */}
      {report && report.providers.length > 0 ? (
        <Card className="gap-3">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Gauge className="h-4 w-4 text-violet-400" aria-hidden />
              Provider stats
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border/70 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">provider</th>
                  <th className="py-1.5 pr-2 text-right font-medium">attempts</th>
                  <th className="py-1.5 pr-2 text-right font-medium">fails</th>
                  <th className="py-1.5 pr-2 text-right font-medium">fail rate</th>
                  <th className="py-1.5 font-medium">kinds</th>
                </tr>
              </thead>
              <tbody>
                {report.providers.map((p) => (
                  <tr key={p.providerId} className="border-b border-border/40 last:border-0">
                    <td className="py-1.5 pr-2 font-mono">{p.providerId}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{p.attempts}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{p.fails}</td>
                    <td className={cn("py-1.5 pr-2 text-right tabular-nums", p.failRate >= 0.5 && "font-semibold text-rose-500")}>
                      {Math.round(p.failRate * 100)}%
                    </td>
                    <td className="flex flex-wrap gap-1 py-1.5">
                      {Object.entries(p.kinds)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 3)
                        .map(([k, n]) => (
                          <Badge key={k} variant="outline" className={cn("text-[10px] font-normal", KIND_STYLE[k] ?? KIND_STYLE.unknown)}>
                            {k} ×{n}
                          </Badge>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

// ─── Leaderboard tab ──────────────────────────────────────────────────────────

function LeaderboardTab() {
  const meta = leaderboardMeta();
  return (
    <div className="space-y-4">
      <Card className="gap-3">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            <Trophy className="h-4 w-4 text-amber-500" aria-hidden />
            Leaderboard snapshot
            <Badge variant="outline" className="text-[10px] font-normal">
              {meta.updatedAt ? new Date(meta.updatedAt).toLocaleDateString() : "undated"}
            </Badge>
            <Badge variant="outline" className="border-border/70 font-mono text-[10px] font-normal">
              {meta.count} scored lanes
            </Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Model rankings move daily — the relay blends this reviewed snapshot 50/50
            with the doctrine Elo, so chain order follows the live leaderboards without
            code edits. Snapshots are fetched by a human-run script and applied only
            after review (never auto-pushed).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {(meta.sources ?? []).map((s) => (
              <a
                key={s}
                href={s}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1 rounded-lg border border-border/70 px-2 py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:border-violet-500/50 hover:text-violet-400"
              >
                <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                {s.replace(/^https?:\/\//, "")}
              </a>
            ))}
          </div>
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Refresh: run <code className="rounded bg-muted px-1 font-mono">bun run leaderboard:fetch</code>{" "}
            (prints the proposed diff), review it, then{" "}
            <code className="rounded bg-muted px-1 font-mono">--apply</code> writes the dated
            snapshot. Every apply appends a changelog entry below.
          </p>
        </CardContent>
      </Card>

      <Card className="gap-3">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-violet-400" aria-hidden />
            Changelog
          </CardTitle>
          <CardDescription className="text-xs">Which snapshot moved what, when, and why.</CardDescription>
        </CardHeader>
        <CardContent className="max-h-64 space-y-2 overflow-y-auto">
          {meta.changelog.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No reviewed changes yet — the baseline shipped with doctrine Elo only.
            </p>
          ) : (
            meta.changelog
              .slice()
              .reverse()
              .map((c, i) => (
                <div key={`${c.date}-${i}`} className="flex items-start gap-2 rounded-lg border border-border/70 px-2.5 py-2">
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px] font-normal">
                    {c.date}
                  </Badge>
                  <p className="text-xs leading-relaxed">{c.note}</p>
                </div>
              ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
