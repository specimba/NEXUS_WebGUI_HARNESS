"use client";

// ─── Model Relay settings card ───────────────────────────────────────────────
// The "Genius rotator" doctrine, applied to the free-frontier vault: an ordered
// fallback chain (Generation-Era tier → arena Elo) that the engine rotates
// through when the active model fails before streaming anything.

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  CircleCheck,
  CircleAlert,
  Info,
  RotateCcw,
  ShieldCheck,
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
import { resolveLlm } from "@/lib/llm-config";
import {
  buildRelayChain,
  relayHealthSnapshot,
  resetRelayHealth,
  TIER_LABEL,
  type RelayHealthEntry,
  type RelayHop,
} from "@/lib/relay";
import { useSettingsStore } from "@/lib/stores";
import { cn } from "@/lib/utils";

const TIER_STYLE: Record<1 | 2 | 3, string> = {
  1: "border-violet-500/50 bg-violet-500/15 text-violet-300",
  2: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  3: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

export function ModelRelayCard() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const enabled = settings.relayEnabled !== false;

  // The rotator's health memory refreshes live (runs record hop outcomes).
  const [health, setHealth] = React.useState<Record<string, RelayHealthEntry>>(() => relayHealthSnapshot());
  React.useEffect(() => {
    const t = window.setInterval(() => setHealth(relayHealthSnapshot()), 15_000);
    const onVis = () => setHealth(relayHealthSnapshot());
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const primary = resolveLlm(settings);
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

  function move(idx: number, dir: -1 | 1) {
    const hops = chain.filter((h) => h.providerId !== "auto");
    const target = idx + dir;
    if (target < 0 || target >= hops.length) return;
    const reordered = [...hops];
    const [row] = reordered.splice(idx, 1);
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
      <CardContent className="space-y-3">
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
          {chain.map((hop, i) => (
            <HopRow
              key={hop.key}
              hop={hop}
              index={i}
              count={chain.length - 1}
              enabled={enabled}
              health={health[hop.key]}
              onMove={(d) => move(i, d)}
            />
          ))}
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
              setHealth({});
              toast.success("Relay health memory cleared");
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
      </CardContent>
    </Card>
  );
}

function HopRow({
  hop,
  index,
  count,
  enabled,
  health,
  onMove,
}: {
  hop: RelayHop;
  index: number;
  count: number;
  enabled: boolean;
  health?: RelayHealthEntry;
  onMove: (dir: -1 | 1) => void;
}) {
  const isAuto = hop.providerId === "auto";
  const cooling = !!health?.lastFailAt && Date.now() - health.lastFailAt < 5 * 60_000;
  return (
    <div
      role="listitem"
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-2",
        isAuto ? "border-dashed border-border/70" : "border-border",
        cooling && "border-amber-500/40 bg-amber-500/5"
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
          {cooling ? (
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
            disabled={index === 0}
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
            disabled={index >= count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-3 w-3" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
