"use client";

import * as React from "react";
import {
  Check,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  PlugZap,
  Trash2,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ─── r514: Egress · Webshare proxies ─────────────────────────────────────────
// The owner-facing control for the server-side egress layer (src/lib/server/
// egress.ts). Doctrinal flip vs every other credential card: the Webshare
// token is SERVER-ONLY (PlatformSetting KV) — it never lives in the browser,
// never rides a request, and only a masked last-4 preview ever comes back.
// The card deals in counts / country codes / mode strings exclusively.

type EgressStatus = {
  ok: boolean;
  configured: boolean;
  count: number;
  validCount: number;
  sampledCountries: string[];
  routing: "on" | "off";
  transport: string | null;
  note?: string;
};

type TokenStatus = { ok: boolean; configured: boolean; tokenPreview?: string };

type RoutingMap = Record<string, "direct" | "pool">;

type ProbeLeg =
  | { ok: true; status: number; loc: string | null; via: string }
  | { ok: false; code: string; message: string; attempts?: number };

type EgressProbe = {
  checkedAt: string;
  timedOut?: boolean;
  error?: string;
  transport: string | null;
  poolConfigured: boolean;
  poolCount: number | null;
  targets: {
    target: string;
    direct: ProbeLeg;
    pool: ProbeLeg & { egressChanged: boolean };
  }[];
};

/** The routing rows — same keys the server layer's relay hook maps hosts to. */
const ROUTING_ROWS: { key: string; label: string; helper: string }[] = [
  { key: "groq", label: "Groq", helper: "api.groq.com — measured WAF 403 direct → 401 via pool" },
  { key: "vyce", label: "Vyce", helper: "Vyce gateway endpoints" },
  { key: "openai", label: "OpenAI", helper: "api.openai.com" },
  { key: "generic", label: "Generic", helper: "every other dialed host (tool fetches, probes)" },
];

const PROBE_TARGET_LABEL: Record<string, string> = {
  generic: "Cloudflare trace (loc=)",
  groq: "Groq /openai/v1/models",
};

/** Paste hygiene — trim + strip ONE wrapping-quote pair (mirror of the server helper). */
function cleanPastedToken(raw: string): string {
  let t = raw.trim();
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      t = t.slice(1, -1).trim();
    }
  }
  return t;
}

function legSummary(leg: ProbeLeg): string {
  if (leg.ok) {
    const loc = leg.loc ? ` · ${leg.loc}` : "";
    return `HTTP ${leg.status}${loc}`;
  }
  return `✗ ${leg.code}`;
}

export function EgressCard() {
  const [status, setStatus] = React.useState<EgressStatus | null>(null);
  const [tokenPreview, setTokenPreview] = React.useState<string | null>(null);
  const [tokenInput, setTokenInput] = React.useState("");
  const [showToken, setShowToken] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [routing, setRouting] = React.useState<RoutingMap>({});
  const [modePending, setModePending] = React.useState<string | null>(null);
  const [probing, setProbing] = React.useState(false);
  const [probe, setProbe] = React.useState<EgressProbe | null>(null);
  const [tokenProbeError, setTokenProbeError] = React.useState<string | null>(null);

  const configured = !!status?.configured;

  const refreshStatus = React.useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        fetch("/api/egress/status", { cache: "no-store" }).then((r) => r.json() as Promise<EgressStatus>),
        fetch("/api/egress/token", { cache: "no-store" }).then((r) => r.json() as Promise<TokenStatus>),
      ]);
      if (s.ok) setStatus(s);
      if (t.ok) setTokenPreview(t.tokenPreview ?? null);
    } catch {
      /* status fetch failure → card shows its honest "unknown" state */
    }
  }, []);

  const refreshRouting = React.useCallback(async () => {
    try {
      const r = await fetch("/api/egress/routing", { cache: "no-store" }).then(
        (res) => res.json() as Promise<{ ok: boolean; routing?: RoutingMap }>,
      );
      if (r.ok && r.routing) setRouting(r.routing);
    } catch {
      /* keep local map */
    }
  }, []);

  React.useEffect(() => {
    void refreshStatus();
    void refreshRouting();
  }, [refreshStatus, refreshRouting]);

  async function handleSaveToken() {
    if (saving) return;
    const token = cleanPastedToken(tokenInput);
    if (!token) {
      toast.error("Paste the Webshare token first");
      return;
    }
    setSaving(true);
    setTokenProbeError(null);
    try {
      const res = await fetch("/api/egress/token", {
        method: "POST",
        headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
        body: JSON.stringify({ token }),
      }).then((r) => r.json() as Promise<{ ok: boolean; tokenPreview?: string; probe?: { ok: boolean; error?: string; count?: number; validCount?: number }; error?: string }>);

      if (!res.ok) {
        toast.error("Token save failed", { description: res.error ?? "unknown error" });
        return;
      }
      setTokenInput("");
      setShowToken(false);
      setTokenPreview(res.tokenPreview ?? null);
      if (res.probe?.ok) {
        toast.success(`Webshare pool loaded — ${res.probe.count ?? "?"} proxies (${res.probe.validCount ?? "?"} valid)`);
      } else {
        // Store-then-probe honesty: the token IS stored, but Webshare said no.
        setTokenProbeError(res.probe?.error ?? "probe failed");
        toast.warning("Token stored — but Webshare rejected it", {
          description: res.probe?.error ?? "probe failed",
        });
      }
      await refreshStatus();
    } catch {
      toast.error("Token save failed — network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleClearToken() {
    if (clearing) return;
    setClearing(true);
    try {
      const res = await fetch("/api/egress/token", {
        method: "DELETE",
        headers: { "x-nexus-csrf": "1" },
      }).then((r) => r.json() as Promise<{ ok: boolean }>);
      if (res.ok) {
        setTokenPreview(null);
        setTokenProbeError(null);
        toast.success("Webshare token cleared — egress falls back to direct");
      } else {
        toast.error("Token clear failed");
      }
      await refreshStatus();
    } catch {
      toast.error("Token clear failed — network error");
    } finally {
      setClearing(false);
    }
  }

  async function handleMode(upstreamKey: string, mode: "direct" | "pool") {
    if (modePending) return;
    if (mode === "pool" && !configured) return; // disabled + tooltip explains
    setModePending(upstreamKey);
    const prev = routing[upstreamKey];
    setRouting((r) => ({ ...r, [upstreamKey]: mode })); // optimistic
    try {
      const res = await fetch("/api/egress/routing", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
        body: JSON.stringify({ upstreamKey, mode }),
      }).then((r) => r.json() as Promise<{ ok: boolean; routing?: RoutingMap; error?: string }>);
      if (res.ok && res.routing) {
        setRouting(res.routing);
        toast.success(`${upstreamKey} → ${mode}`);
      } else {
        setRouting((r) => ({ ...r, [upstreamKey]: prev ?? "direct" }));
        toast.error("Routing not saved", { description: res.error ?? "unknown error" });
      }
    } catch {
      setRouting((r) => ({ ...r, [upstreamKey]: prev ?? "direct" }));
      toast.error("Routing not saved — network error");
    } finally {
      setModePending(null);
    }
  }

  async function handleProbe() {
    if (probing) return;
    setProbing(true);
    setProbe(null);
    try {
      const res = await fetch("/api/egress/probe", { cache: "no-store" }).then(
        (r) => r.json() as Promise<{ ok: boolean; probe?: EgressProbe }>,
      );
      if (res.ok && res.probe) setProbe(res.probe);
      else setProbe({ checkedAt: new Date().toISOString(), error: "probe request failed", transport: null, poolConfigured: false, poolCount: null, targets: [] });
    } catch {
      setProbe({ checkedAt: new Date().toISOString(), error: "probe request failed — network error", transport: null, poolConfigured: false, poolCount: null, targets: [] });
    } finally {
      setProbing(false);
    }
  }

  return (
    <Card className="gap-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-violet-500/80 dark:text-violet-400" aria-hidden />
          Egress · Webshare proxies
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-normal",
              configured
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
            )}
          >
            {configured ? "Pool armed" : "Direct only"}
          </Badge>
        </CardTitle>
        <CardDescription>
          Route outbound dials to specific upstreams through your paid Webshare proxy pool instead of the
          sandbox egress IP. Measured use-case: Groq WAF-blocks datacenter IPs with 403 while the same
          request via a pool proxy gets a real key-level answer (401) — WAF bypass. Everything defaults to
          direct; empty token = byte-identical behavior.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Token row — server-only credential */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="egress-token" className="text-xs">
              Webshare API token{" "}
              {tokenPreview ? (
                <span className="font-mono text-[10px] text-muted-foreground">stored {tokenPreview}</span>
              ) : (
                <span className="font-normal text-muted-foreground">(not stored)</span>
              )}
            </Label>
            <a
              href="https://proxy.webshare.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs text-violet-500 hover:underline dark:text-violet-400"
            >
              Get it free ↗
            </a>
          </div>
          <div className="relative">
            <Input
              id="egress-token"
              type={showToken ? "text" : "password"}
              aria-label="Webshare API token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="paste the Webshare API token"
              className="pr-10 font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? "Hide Webshare token" : "Show Webshare token"}
              className="absolute top-1/2 right-1 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              {showToken ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={handleSaveToken} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              {saving ? "Saving…" : "Save token"}
            </Button>
            {tokenPreview ? (
              <Button type="button" size="sm" variant="secondary" onClick={handleClearToken} disabled={clearing}>
                {clearing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                Clear
              </Button>
            ) : null}
          </div>
          <div aria-live="polite" className="flex min-h-5 items-center">
            {tokenProbeError ? (
              <Badge variant="destructive" className="max-w-full font-normal">
                ✗ {tokenProbeError}
              </Badge>
            ) : configured && status ? (
              <Badge
                variant="outline"
                className="max-w-full border-emerald-500/40 bg-emerald-500/10 font-normal text-emerald-600 dark:text-emerald-400"
              >
                pool: {status.count} proxies · {status.validCount} valid
                {status.sampledCountries.length ? ` · ${status.sampledCountries.join("/")}` : ""}
                {status.transport ? ` · via ${status.transport}` : ""}
              </Badge>
            ) : status?.note ? (
              <span className="text-xs text-muted-foreground">{status.note}</span>
            ) : null}
          </div>
        </div>

        {/* Routing rows — Direct/Pool per upstream */}
        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">Routing per upstream</p>
          {ROUTING_ROWS.map((row) => {
            const mode = routing[row.key] ?? "direct";
            const poolUsable = configured;
            return (
              <div
                key={row.key}
                className="flex flex-wrap items-center justify-between gap-2 sm:flex-nowrap"
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{row.label}</p>
                  <p className="truncate text-[11px] text-muted-foreground" title={row.helper}>
                    {row.helper}
                  </p>
                </div>
                <div
                  role="group"
                  aria-label={`${row.label} egress mode`}
                  className="flex shrink-0 items-center gap-1 rounded-lg border bg-background p-0.5"
                >
                  <button
                    type="button"
                    aria-pressed={mode === "direct"}
                    onClick={() => void handleMode(row.key, "direct")}
                    disabled={modePending === row.key}
                    className={cn(
                      "min-h-9 min-w-16 rounded-md px-3 text-xs font-medium transition-colors disabled:opacity-50",
                      mode === "direct"
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Direct
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === "pool"}
                    onClick={() => void handleMode(row.key, "pool")}
                    disabled={!poolUsable || modePending === row.key}
                    title={poolUsable ? "route through the Webshare pool" : "save a Webshare token first"}
                    aria-disabled={!poolUsable}
                    className={cn(
                      "min-h-9 min-w-16 rounded-md px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      mode === "pool"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {modePending === row.key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      "Pool"
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Probe */}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={handleProbe} disabled={probing}>
            {probing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlugZap className="h-4 w-4" aria-hidden />
            )}
            {probing ? "Probing…" : "Probe direct vs pool"}
          </Button>
        </div>
        <div aria-live="polite" className="space-y-1.5">
          {probe ? (
            probe.error ? (
              <Badge variant="destructive" className="max-w-full font-normal">
                ✗ {probe.error}
              </Badge>
            ) : (
              <div className="space-y-1.5">
                {probe.targets.map((t) => (
                  <div
                    key={t.target}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border bg-muted/30 px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="font-medium text-foreground">{t.target}</span>
                    <span className="text-muted-foreground">{PROBE_TARGET_LABEL[t.target] ?? ""}</span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-normal",
                        t.direct.ok
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-zinc-500/30 bg-zinc-500/5 text-zinc-600 dark:text-zinc-400"
                      )}
                    >
                      direct {legSummary(t.direct)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-normal",
                        t.pool.ok
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-zinc-500/30 bg-zinc-500/5 text-zinc-600 dark:text-zinc-400"
                      )}
                    >
                      pool {legSummary(t.pool)}
                    </Badge>
                    {t.pool.egressChanged ? (
                      <Badge variant="outline" className="border-violet-500/40 bg-violet-500/10 font-normal text-violet-600 dark:text-violet-400">
                        egress changed
                      </Badge>
                    ) : null}
                    {!t.direct.ok && !t.pool.ok ? (
                      <span className="w-full text-muted-foreground">
                        {t.pool.message || t.direct.message}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )
          ) : null}
        </div>

        {/* Footnotes — doctrine + budget + measured fact */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Proxy credentials never leave the server; only counts and country codes are displayed. Webshare
          proxy-list endpoints allow 60 req/min — the pool cache holds 60s and concurrent loads share one
          in-flight request.
        </p>
        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
          <Globe className="mt-0.5 h-4 w-4 shrink-0 text-violet-500/80 dark:text-violet-400" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Measured: Groq WAF <span className="font-mono text-[11px]">403</span> direct →{" "}
            <span className="font-mono text-[11px]">401</span>-via-pool (WAF bypass). A 403 on a direct dial
            is a network fact, never a key problem — the relay error text points here when it happens.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
