"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  Circle,
  ClipboardCopy,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Loader2,
  PlugZap,
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CORTEX_DEFAULT_FUNCTION_URL,
  CORTEX_PASTE_PACK,
} from "@/lib/cortex-edge-paste-pack";
// Frozen contract (2-c, landed): CORTEX_RATE_CAPS + the widened CortexConfig /
// CortexProbeResult (lanes · rate · vector) live in cortex-edge.ts v2. During
// the parallel round the values were read through the module namespace because
// Turbopack hard-fails a named import of an export that doesn't exist yet (it
// blanked the settings view while 2-c's file was in flight); now that the v2
// module is landed this is the exact named import the contract specifies.
import {
  CORTEX_RATE_CAPS,
  probeCortexEdge,
} from "@/lib/cortex-edge";
import type { CortexConfig, CortexProbeResult } from "@/lib/cortex-edge";
import {
  CORTEX_PROBE_FRESH_MS,
  cortexCensusOf,
  cortexStatusLabel,
  persistCortexProbe,
  readCortexProbe,
  type CortexCensus,
} from "@/lib/cortex-census";
import { copyText, truncate } from "@/lib/helpers";
import { useSettingsStore } from "@/lib/stores";
import { cn } from "@/lib/utils";

const EMPTY_CORTEX: CortexConfig = { url: "" };

/** Probe-matrix chips — order = the lane order of the v2 diagnostics. */
const LANE_CHIPS: {
  key: keyof NonNullable<CortexProbeResult["lanes"]>;
  emoji: string;
  label: string;
  helper: string;
}[] = [
  {
    key: "hyperbrowser",
    emoji: "🕸️",
    label: "Deep-web",
    helper: "Hyperbrowser edge secret or your BYOK key",
  },
  {
    key: "redis",
    emoji: "⚡",
    label: "Redis state",
    helper: "edge secret only (cache · rate limits · locks · job parking)",
  },
  {
    key: "vector",
    emoji: "🧠",
    label: "Memory",
    helper: "semantic memory + LLM cache",
  },
  {
    key: "qstash",
    emoji: "✉️",
    label: "Jobs",
    helper: "durable async deep-scrapes",
  },
  {
    key: "box",
    emoji: "📦",
    label: "Sandbox",
    helper: "shell in a free Upstash Box",
  },
  {
    key: "sharedSecretGate",
    emoji: "🔑",
    label: "Secret gate",
    helper: "CORTEX_SHARED_SECRET active",
  },
];

/** Guided-setup step 2 — which edge secret powers which lane. */
const EDGE_SECRET_MAP: { names: string; lane: string }[] = [
  { names: "HYPERBROWSER_API_KEY", lane: "deep-web" },
  { names: "UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN", lane: "state" },
  { names: "UPSTASH_VECTOR_REST_URL + UPSTASH_VECTOR_REST_TOKEN", lane: "memory" },
  { names: "QSTASH_TOKEN", lane: "jobs" },
  { names: "BOX_API_KEY + BOX_ID", lane: "sandbox" },
  { names: "CORTEX_SHARED_SECRET", lane: "recommended gate" },
];

/** "Get it free ↗" — external console link (setup-wizard link styling). */
function FreeLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="shrink-0 text-xs text-violet-500 hover:underline dark:text-violet-400"
    >
      {children}
    </a>
  );
}

/** Password input + Eye toggle — byte-for-byte the v1 / provider-card row. */
function SecretInput(props: {
  id: string;
  ariaLabel: string;
  revealLabel: string;
  value: string;
  placeholder: string;
  show: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <Input
        id={props.id}
        type={props.show ? "text" : "password"}
        aria-label={props.ariaLabel}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="pr-10 font-mono text-xs"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={props.onToggle}
        aria-label={props.revealLabel}
        className="absolute top-1/2 right-1 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        {props.show ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

export function CortexEdgeCard() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const cortex = settings.cortex ?? EMPTY_CORTEX;

  const [showKey, setShowKey] = React.useState(false);
  const [showHbKey, setShowHbKey] = React.useState(false);
  const [showVectorToken, setShowVectorToken] = React.useState(false);
  const [showQstashToken, setShowQstashToken] = React.useState(false);
  const [showBoxKey, setShowBoxKey] = React.useState(false);
  const [guideOpen, setGuideOpen] = React.useState(false);
  const [probing, setProbing] = React.useState(false);
  const [probe, setProbe] = React.useState<CortexProbeResult | null>(null);
  // r672: the probe verdict is now PERSISTED (cortex-census adapter) — the
  // census survives reloads and renders on every mount, killing the card's
  // ephemeral-probe staleness (KB-1-b finding: green badge while edge down).
  const [census, setCensus] = React.useState<CortexCensus>(() =>
    cortexCensusOf(readCortexProbe())
  );
  const [copying, setCopying] = React.useState(false);

  /** Persist one field; an entirely empty config is stored as absent. */
  function patchCortex(part: Partial<CortexConfig>) {
    const next = {
      url: cortex.url ?? "",
      key: cortex.key ?? "",
      hbKey: cortex.hbKey ?? "",
      vectorUrl: cortex.vectorUrl ?? "",
      vectorToken: cortex.vectorToken ?? "",
      qstashToken: cortex.qstashToken ?? "",
      boxApiKey: cortex.boxApiKey ?? "",
      boxId: cortex.boxId ?? "",
      boxRegion: cortex.boxRegion ?? "",
      ...part,
    };
    const cleaned: CortexConfig = {
      url: next.url.trim(),
      ...(next.key.trim() ? { key: next.key.trim() } : {}),
      ...(next.hbKey.trim() ? { hbKey: next.hbKey.trim() } : {}),
      ...(next.vectorUrl.trim() ? { vectorUrl: next.vectorUrl.trim() } : {}),
      ...(next.vectorToken.trim() ? { vectorToken: next.vectorToken.trim() } : {}),
      ...(next.qstashToken.trim() ? { qstashToken: next.qstashToken.trim() } : {}),
      ...(next.boxApiKey.trim() ? { boxApiKey: next.boxApiKey.trim() } : {}),
      ...(next.boxId.trim() ? { boxId: next.boxId.trim() } : {}),
      // Empty region = absent → the edge function defaults to us-east-1.
      ...(next.boxRegion.trim() ? { boxRegion: next.boxRegion.trim() } : {}),
    };
    const isEmpty =
      !cleaned.url &&
      !cleaned.key &&
      !cleaned.hbKey &&
      !cleaned.vectorUrl &&
      !cleaned.vectorToken &&
      !cleaned.qstashToken &&
      !cleaned.boxApiKey &&
      !cleaned.boxId &&
      !cleaned.boxRegion;
    update({ cortex: isEmpty ? undefined : cleaned });
    return cleaned;
  }

  /** Record a probe verdict: component state + the persisted census, together. */
  function recordProbe(result: CortexProbeResult) {
    setProbe(result);
    persistCortexProbe({
      at: Date.now(),
      ok: result.ok,
      ms: result.ms,
      ...(result.edgeRegion != null ? { edgeRegion: result.edgeRegion } : {}),
      ...(result.lanes != null ? { lanes: result.lanes } : {}),
      ...(result.error != null ? { error: result.error } : {}),
    });
    setCensus(cortexCensusOf(readCortexProbe()));
  }

  async function handleProbe() {
    if (probing) return;
    const cfg = patchCortex({});
    setProbing(true);
    setProbe(null);
    try {
      recordProbe(await probeCortexEdge(cfg));
    } catch (err) {
      recordProbe({
        ok: false,
        ms: 0,
        error: err instanceof Error ? err.message : "probe failed",
      });
    } finally {
      setProbing(false);
    }
  }

  async function handleCopyPack() {
    if (copying) return;
    setCopying(true);
    try {
      const ok = await copyText(CORTEX_PASTE_PACK);
      if (ok) {
        toast.success("Paste pack copied — paste it into your Supabase AI Assistant", {
          description: "It deploys the nexus-cortex-harness edge function + its cache/telemetry tables.",
        });
      } else {
        toast.error("Copy failed — the browser refused clipboard access", {
          description: "Select the pack text manually from deliverables/nexus-cortex-harness/SUPABASE_AI_PASTE_PACK.md.",
        });
      }
    } finally {
      setCopying(false);
    }
  }

  const laneArmed = !!(
    cortex.url?.trim() ||
    cortex.hbKey?.trim() ||
    cortex.vectorUrl?.trim() ||
    cortex.vectorToken?.trim() ||
    cortex.qstashToken?.trim() ||
    cortex.boxApiKey?.trim() ||
    cortex.boxId?.trim()
  );

  // r672: auto-probe on mount when ARMED and the persisted verdict is stale
  // (or absent) — one honest fetch, never-throw; the census chip reflects it
  // immediately from the persisted verdict either way.
  const armedRef = React.useRef(laneArmed);
  armedRef.current = laneArmed;
  React.useEffect(() => {
    if (!armedRef.current) return;
    const p = readCortexProbe();
    const c = cortexCensusOf(p);
    setCensus(c);
    if (!p || c.ageMs > CORTEX_PROBE_FRESH_MS) {
      void (async () => {
        try {
          recordProbe(await probeCortexEdge(useSettingsStore.getState().settings.cortex ?? EMPTY_CORTEX));
        } catch {
          /* never-throw: the census keeps its previous honest verdict */
        }
      })();
    }
    // mount-only by design: the freshness window, not deps, drives re-probes
  }, []);

  // Probe matrix — rendered only when the v2 function answered with lanes
  // (undefined on a v1 function / on probe failure → graceful v1 degrade).
  const lanes = probe?.lanes;
  const rate = probe?.rate;
  const vector = probe?.vector;
  const topHours = Object.entries(rate?.hour ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <Card className="gap-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <span aria-hidden>🕸️</span> Cortex Edge
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-normal",
              laneArmed
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
            )}
          >
            {laneArmed ? "lane armed" : "lane off"}
          </Badge>
          {/* r672: the persisted-Verdict census chip — always-on liveness in the
              KICK corpus's HUD vocabulary (`//` mono codes, CORTEX // ACTIVE),
              tone per the house system: emerald online, amber armed-but-down,
              muted unprobed. Survives reloads; refreshes via the Probe button
              and the mount auto-probe. */}
          <Badge
            variant="outline"
            aria-label={`Cortex liveness: ${cortexStatusLabel(census)}`}
            title={`${cortexStatusLabel(census)} — the verdict is persisted locally and survives reloads; the mount auto-probe refreshes it when older than ${Math.round(CORTEX_PROBE_FRESH_MS / 60000)} minutes (armed configs only).`}
            className={cn(
              "font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors",
              probing
                ? "animate-pulse border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                : census.tone === "online"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : census.tone === "offline"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground"
            )}
          >
            {probing
              ? "CORTEX // PROBING"
              : census.probed
                ? `CORTEX // ${census.online ? "ONLINE" : "OFFLINE"} · ${census.lanesArmed}/${census.lanesTotal}`
                : "CORTEX // UNPROBED"}
          </Badge>
        </CardTitle>
        <CardDescription>
          Server-side deep-web + intelligence lanes for agents — Hyperbrowser at the edge, kickbot-proven
          pattern. v2 adds the free Upstash lanes: 🧠 semantic memory (Vector), ✉️ durable jobs (QStash),
          📦 sandbox shell (Box) and ⚡ Redis state. Agents get the 🕸️ Deep scrape tool (JS-rendered scrape ·
          site crawl · structured search); when a lane is off they honestly fall back to the plain URL reader /
          web search.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* HUD status line — the full census verdict in the KICK corpus's
            telemetry vocabulary; visible kinship, house palette. */}
        <p
          aria-label={`Cortex status: ${cortexStatusLabel(census)}`}
          className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-1.5 shrink-0 rounded-full transition-colors",
              probing
                ? "animate-pulse bg-violet-500"
                : census.tone === "online"
                  ? "bg-emerald-500"
                  : census.tone === "offline"
                    ? "bg-amber-500"
                    : "bg-muted-foreground/40"
            )}
          />
          {cortexStatusLabel(census)}
        </p>
        {/* Function URL */}
        <div className="space-y-1.5">
          <Label htmlFor="cortex-url" className="text-xs">
            Function URL
          </Label>
          <Input
            id="cortex-url"
            aria-label="Cortex Edge function URL"
            value={cortex.url ?? ""}
            onChange={(e) => patchCortex({ url: e.target.value })}
            placeholder={CORTEX_DEFAULT_FUNCTION_URL}
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            The deployed nexus-cortex-harness edge function URL (Supabase Dashboard → Edge Functions).
            Empty = lane off.
          </p>
        </div>

        {/* Shared secret */}
        <div className="space-y-1.5">
          <Label htmlFor="cortex-key" className="text-xs">
            Shared key <span className="font-mono text-[10px] text-muted-foreground">(x-nexus-cortex-key)</span>
          </Label>
          <SecretInput
            id="cortex-key"
            ariaLabel="Cortex shared key"
            revealLabel={showKey ? "Hide shared key" : "Show shared key"}
            value={cortex.key ?? ""}
            onChange={(v) => patchCortex({ key: v })}
            placeholder="the CORTEX_SHARED_SECRET value"
            show={showKey}
            onToggle={() => setShowKey((v) => !v)}
          />
          <p className="text-xs text-muted-foreground">
            The CORTEX_SHARED_SECRET you set in Supabase → Edge Functions → Secrets; NOT an SSL/GPG key.
            Requests are rejected with 401 when it mismatches.
          </p>
        </div>

        {/* Probe + paste pack */}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleProbe} disabled={probing}>
            {probing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlugZap className="h-4 w-4" aria-hidden />
            )}
            {probing ? "Probing…" : "Probe"}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={handleCopyPack} disabled={copying}>
            {copying ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ClipboardCopy className="h-4 w-4" aria-hidden />
            )}
            Copy Supabase AI paste pack
          </Button>
        </div>
        <div aria-live="polite" className="flex min-h-5 items-center">
          {probe ? (
            probe.ok ? (
              <Badge
                variant="outline"
                className="max-w-full border-emerald-500/40 bg-emerald-500/10 font-normal text-emerald-600 dark:text-emerald-400"
              >
                Edge online{probe.edgeRegion ? ` · ${probe.edgeRegion}` : ""} · {probe.ms}ms
              </Badge>
            ) : (
              <Badge variant="destructive" className="max-w-full font-normal">
                ✗ {probe.error}
              </Badge>
            )
          ) : null}
        </div>

        {/* Probe matrix — v2 diagnostics; absent on v1 functions → no chips */}
        {lanes ? (
          <div className="space-y-1.5">
            <ul className="flex flex-wrap gap-1.5" aria-label="Cortex lane status">
              {LANE_CHIPS.map((chip) => {
                const armed = !!lanes[chip.key];
                const helper =
                  chip.key === "sharedSecretGate" && !armed ? "open — set the secret" : chip.helper;
                return (
                  <li
                    key={chip.key}
                    title={helper}
                    className={cn(
                      "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-none",
                      armed
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-zinc-500/30 bg-zinc-500/5 text-zinc-600 dark:text-zinc-400"
                    )}
                  >
                    <span aria-hidden>{chip.emoji}</span>
                    <span className="font-medium">{chip.label}</span>
                    <span className="inline-flex items-center gap-0.5">
                      {armed ? (
                        <Check className="h-3 w-3" aria-hidden />
                      ) : (
                        <Circle className="h-3 w-3" aria-hidden />
                      )}
                      {armed ? "armed" : "off"}
                    </span>
                  </li>
                );
              })}
            </ul>
            {rate && rate.day && typeof rate.day.count === "number" ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span aria-hidden>⏱</span> {rate.day.count} edge actions today
                {topHours.length ? " · " : ""}
                {topHours
                  .map(([action, count]) => `${action} ${count}/${CORTEX_RATE_CAPS[action] || "—"}`)
                  .join(" · ")}
              </p>
            ) : rate && rate.limited === false && rate.note ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{truncate(rate.note, 120)}</p>
            ) : null}
            {vector ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span aria-hidden>🧠</span> index: {vector.vectorCount ?? "?"} vectors ·{" "}
                {vector.dimension ?? "?"}d · {vector.embeddingModel || vector.indexType || "—"}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Guided setup — general-user capable, exact copy strings inside */}
        <Collapsible open={guideOpen} onOpenChange={setGuideOpen} className="rounded-lg border bg-muted/30">
          <div className="p-3">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 h-8 gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Setup guide
                <ChevronDown
                  aria-hidden
                  className={cn("h-4 w-4 transition-transform", guideOpen && "rotate-180")}
                />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent>
            <ol className="list-decimal space-y-3 px-3 pb-3 pl-7 text-xs leading-relaxed text-muted-foreground marker:text-muted-foreground/70">
              <li>
                <span className="font-medium text-foreground">Deploy the function</span> — press{" "}
                <span className="font-medium text-foreground">Copy Supabase AI paste pack</span> above → paste it
                into your Supabase project&apos;s AI Assistant → it creates the tables and deploys{" "}
                <span className="font-mono text-[11px]">nexus-cortex-harness</span>. You&apos;ll find it in the{" "}
                <FreeLink href="https://supabase.com/dashboard">Supabase Dashboard</FreeLink>.
              </li>
              <li>
                <span className="font-medium text-foreground">Set the edge secrets</span> — Supabase Dashboard →
                Edge Functions → Secrets. Required per lane:
                <dl className="mt-1.5 space-y-0.5">
                  {EDGE_SECRET_MAP.map((s) => (
                    <div key={s.names} className="flex flex-wrap items-baseline gap-x-1.5">
                      <dt className="font-mono text-[11px] text-foreground">{s.names}</dt>
                      <dd className="text-[11px]">— {s.lane}</dd>
                    </div>
                  ))}
                </dl>
                <span className="mt-1.5 block">
                  Copy the SAME values into the matching fields here only when you want per-request BYOK instead
                  of edge secrets.
                </span>
              </li>
              <li>
                <span className="font-medium text-foreground">Create the free Upstash resources</span> —{" "}
                <FreeLink href="https://console.upstash.com/redis">console.upstash.com/redis</FreeLink> ·{" "}
                <FreeLink href="https://console.upstash.com/vector">/vector (hybrid + hosted embedding!)</FreeLink>{" "}
                · <FreeLink href="https://console.upstash.com/qstash">/qstash</FreeLink> ·{" "}
                <FreeLink href="https://console.upstash.com/box">/box</FreeLink>.
              </li>
              <li>
                <span className="font-medium text-foreground">Fill your keys here</span> — every field below is
                BYOK: it stays in your browser and rides per-request only (never stored server-side). Leave blank
                whatever you set as edge secrets.
              </li>
              <li>
                <span className="font-medium text-foreground">Probe &amp; witness</span> — press Probe (the matrix
                above arms per lane) → ask an agent with the 🕸️ Deep scrape / 🧠 Cortex memory / 🧳 Sandbox run
                tools to work — the provenance header shows the lane, latency and rate used.
              </li>
            </ol>
          </CollapsibleContent>
        </Collapsible>

        {/* Lane credentials — BYOK rows, styled like the LLM API key rows */}
        <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0 text-violet-500/80 dark:text-violet-400" aria-hidden />
            <p className="text-xs font-medium text-foreground">Lane credentials</p>
            <Badge variant="secondary" className="text-[10px] font-normal">
              BYOK — stays in your browser
            </Badge>
          </div>

          {/* Hyperbrowser (deep-web lane) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="cortex-hbkey" className="text-xs">
                <span aria-hidden>🕸️</span> Hyperbrowser key{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <FreeLink href="https://hyperbrowser.ai">Get it free ↗</FreeLink>
            </div>
            <SecretInput
              id="cortex-hbkey"
              ariaLabel="Hyperbrowser API key"
              revealLabel={showHbKey ? "Hide Hyperbrowser key" : "Show Hyperbrowser key"}
              value={cortex.hbKey ?? ""}
              onChange={(v) => patchCortex({ hbKey: v })}
              placeholder="hb-…"
              show={showHbKey}
              onToggle={() => setShowHbKey((v) => !v)}
            />
            <p className="text-xs text-muted-foreground">
              Only needed if HYPERBROWSER_API_KEY is not set as an edge secret — forwarded per request
              (edge fallback + direct lane) and stays in your browser (BYOK).
            </p>
          </div>

          {/* Semantic memory — Vector REST URL + token */}
          <div className="space-y-1.5">
            <Label htmlFor="cortex-vector-url" className="text-xs">
              <span aria-hidden>🧠</span> Semantic memory — Vector REST URL{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="cortex-vector-url"
              aria-label="Vector REST URL"
              value={cortex.vectorUrl ?? ""}
              onChange={(e) => patchCortex({ vectorUrl: e.target.value })}
              placeholder="https://…-eu1-vector.upstash.io"
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Create a FREE index at console.upstash.com/vector — pick hybrid with an Upstash-hosted embedding
              model (text-embedding-3-small + BM25) so text is embedded for you — free 10K ops/day.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="cortex-vector-token" className="text-xs">
                Vector token <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <FreeLink href="https://console.upstash.com/vector">Get it free ↗</FreeLink>
            </div>
            <SecretInput
              id="cortex-vector-token"
              ariaLabel="Vector REST token"
              revealLabel={showVectorToken ? "Hide Vector token" : "Show Vector token"}
              value={cortex.vectorToken ?? ""}
              onChange={(v) => patchCortex({ vectorToken: v })}
              placeholder="the UPSTASH_VECTOR_REST_TOKEN value"
              show={showVectorToken}
              onToggle={() => setShowVectorToken((v) => !v)}
            />
          </div>

          {/* Durable jobs — QStash token */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="cortex-qstash-token" className="text-xs">
                <span aria-hidden>✉️</span> Durable jobs — QStash token{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <FreeLink href="https://console.upstash.com/qstash">Get it free ↗</FreeLink>
            </div>
            <SecretInput
              id="cortex-qstash-token"
              ariaLabel="QStash token"
              revealLabel={showQstashToken ? "Hide QStash token" : "Show QStash token"}
              value={cortex.qstashToken ?? ""}
              onChange={(v) => patchCortex({ qstashToken: v })}
              placeholder="the QSTASH_TOKEN value"
              show={showQstashToken}
              onToggle={() => setShowQstashToken((v) => !v)}
            />
            <p className="text-xs text-muted-foreground">
              Free 1000 messages/day — long crawls run past the 26s edge wall via job.enqueue → job.result.
            </p>
          </div>

          {/* Sandbox — Box API key + id + region */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="cortex-box-key" className="text-xs">
                <span aria-hidden>📦</span> Sandbox — Box API key{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <FreeLink href="https://console.upstash.com/box">Get it free ↗</FreeLink>
            </div>
            <SecretInput
              id="cortex-box-key"
              ariaLabel="Box API key"
              revealLabel={showBoxKey ? "Hide Box API key" : "Show Box API key"}
              value={cortex.boxApiKey ?? ""}
              onChange={(v) => patchCortex({ boxApiKey: v })}
              placeholder="the BOX_API_KEY value"
              show={showBoxKey}
              onToggle={() => setShowBoxKey((v) => !v)}
            />
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cortex-box-id" className="text-xs">
                  Box id
                </Label>
                <Input
                  id="cortex-box-id"
                  aria-label="Box id"
                  value={cortex.boxId ?? ""}
                  onChange={(e) => patchCortex({ boxId: e.target.value })}
                  placeholder="the BOX_ID value"
                  className="font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cortex-box-region" className="text-xs">
                  Box region
                </Label>
                <Input
                  id="cortex-box-region"
                  aria-label="Box region"
                  value={cortex.boxRegion ?? ""}
                  onChange={(e) => patchCortex({ boxRegion: e.target.value })}
                  placeholder="us-east-1"
                  className="font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Free 5 CPU-hours/month, 10 concurrent boxes — runs shell commands for agents.
            </p>
          </div>

          {/* Redis — deliberately no BYOK input (security boundary) */}
          <div className="flex items-start gap-2 rounded-lg border bg-background/60 p-2.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span aria-hidden>⚡</span> Upstash Redis stays{" "}
              <span className="font-medium text-foreground">edge-secret-only</span> by design — it holds shared
              state (cache, rate counters, locks), and a caller-supplied Redis could poison it. Set{" "}
              <span className="font-mono text-[11px]">UPSTASH_REDIS_REST_URL/TOKEN</span> as edge secrets in the
              paste pack.
            </p>
          </div>
        </div>

        {/* Free-tier budget footnote */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Free budget map — Redis ≈500K cmds/mo · Vector 10K ops/day · QStash 1000 msgs/day · Box 5 CPU-h/mo ·
          caps per lane: scrape 60/h · search 90/h · crawl 20/h · sandbox 40/h (mirrors the edge function).
        </p>

        {/* Setup pointer — honest one-line doctrine */}
        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
          <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-500/80 dark:text-violet-400" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            One-time setup: press <span className="font-medium text-foreground">Copy Supabase AI paste pack</span> and
            paste it into your project&apos;s Supabase AI Assistant — it creates the cache/telemetry tables and deploys
            the edge function. Keys in this card live in your browser only and are forwarded per request; nothing is
            persisted server-side (BYOK).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
