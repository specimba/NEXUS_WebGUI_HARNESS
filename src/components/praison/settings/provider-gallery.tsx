"use client";

import * as React from "react";
import {
  BadgeCheck,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runAgentChat } from "@/lib/chat-client";
import {
  FREELLM_SH_URL,
  FREE_PROVIDERS,
  LIVE_CATALOG_KEY,
  loadLiveCatalog,
  providerBaseUrl,
  providerModelOptions,
  withSavedOption,
  type FreeProvider,
  type LiveCatalog,
} from "@/lib/providers";
import { ModelPicker } from "@/components/praison/model-picker";
import { truncate } from "@/lib/helpers";
import { useSettingsStore, useUiStore } from "@/lib/stores";
import type { ProviderKeyEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type TestResult = { ok: true; ms: number } | { ok: false; error: string };

type TestMap = Record<string, TestResult | undefined>;

/** Result of an account/credits probe (providers with mePath — Vyce today). */
type CreditsInfo = {
  name?: string;
  balance?: number;
  rateLimit?: number;
  enabled?: boolean;
  totalSpent?: number;
  totalRequests?: number;
  at: number;
  error?: string;
};
type CreditsMap = Record<string, CreditsInfo | undefined>;

/** Timestamps of the last successful live-model refresh per provider (persisted). */
type LiveAtMap = Record<string, number>;
const LIVE_AT_KEY = "praison-free-catalog-at";

function loadLiveAt(): LiveAtMap {
  try {
    const raw = localStorage.getItem(LIVE_AT_KEY);
    return raw ? (JSON.parse(raw) as LiveAtMap) : {};
  } catch {
    return {};
  }
}

function fmtRel(ts: number | undefined): string {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── Free Frontier Providers — curated BYOK gallery with setup guides ───────
export function ProviderGallery() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [showKey, setShowKey] = React.useState<Record<string, boolean>>({});
  const [draftKeys, setDraftKeys] = React.useState<Record<string, string>>({});
  const [draftAccounts, setDraftAccounts] = React.useState<Record<string, string>>({});
  const [tests, setTests] = React.useState<TestMap>({});
  const [credits, setCredits] = React.useState<CreditsMap>({});
  const [live, setLive] = React.useState<LiveCatalog>(() => loadLiveCatalog());
  const [liveAt, setLiveAt] = React.useState<LiveAtMap>(() => loadLiveAt());
  const [refreshing, setRefreshing] = React.useState<Record<string, boolean>>({});

  const featured = FREE_PROVIDERS.filter((p) => p.featured);
  const rest = FREE_PROVIDERS.filter((p) => !p.featured);
  const readyCount = FREE_PROVIDERS.filter(
    (p) => p.noKey || !!settings.providerKeys?.[p.id]?.key?.trim()
  ).length;

  function entryFor(p: FreeProvider): ProviderKeyEntry {
    return settings.providerKeys?.[p.id] ?? { key: "" };
  }

  function draftKeyFor(p: FreeProvider): string {
    return draftKeys[p.id] ?? entryFor(p).key ?? "";
  }

  function draftAccountFor(p: FreeProvider): string {
    return draftAccounts[p.id] ?? entryFor(p).accountId ?? "";
  }

  function toggleExpand(id: string) {
    setExpanded((cur) => {
      const next = cur === id ? null : id;
      if (next) {
        const p = FREE_PROVIDERS.find((x) => x.id === next);
        if (p) {
          setDraftKeys((d) => ({ ...d, [next]: entryFor(p).key ?? "" }));
          setDraftAccounts((d) => ({ ...d, [next]: entryFor(p).accountId ?? "" }));
        }
      }
      return next;
    });
  }

  function saveProvider(p: FreeProvider, opts?: { validateAfter?: boolean }) {
    const key = draftKeyFor(p).trim();
    const accountId = draftAccountFor(p).trim() || undefined;
    if (!p.noKey && !key) {
      toast.error("Paste your API key first");
      return;
    }
    const next: ProviderKeyEntry = {
      ...entryFor(p),
      key,
      accountId,
      model: entryFor(p).model || p.models[0]?.id,
    };
    update({ providerKeys: { ...(settings.providerKeys ?? {}), [p.id]: next } });
    toast.success(`${p.name} key saved`, {
      description: "Stored only in this browser's localStorage — never sent anywhere but the provider.",
    });
    if (opts?.validateAfter) void validate(p);
  }

  async function validate(p: FreeProvider) {
    if (busy) return;
    const entry = settings.providerKeys?.[p.id] ?? { key: draftKeyFor(p).trim() };
    const key = entry.key?.trim() || draftKeyFor(p).trim();
    if (!p.noKey && !key) {
      toast.error("Save a key first");
      return;
    }
    setBusy(p.id);
    setTests((t) => ({ ...t, [p.id]: undefined }));
    const model = entry.model || p.models[0]?.id;
    const started = performance.now();
    try {
      await runAgentChat({
        provider: "custom",
        apiKey: key || undefined,
        baseUrl: providerBaseUrl(p, entry.accountId),
        model,
        maxIterations: 1,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
      });
      const ms = Math.round(performance.now() - started);
      setTests((t) => ({ ...t, [p.id]: { ok: true, ms } }));
      // stamp validatedAt into the vault
      update({
        providerKeys: { ...(settings.providerKeys ?? {}), [p.id]: { ...entry, key, validatedAt: Date.now() } },
      });
      toast.success(`${p.name} connected ✓`, { description: `Round-trip ${ms}ms · model ${model ?? "default"}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setTests((t) => ({ ...t, [p.id]: { ok: false, error: truncate(message, 90) } }));
    } finally {
      setBusy(null);
    }
  }

  /** Probe the provider's account endpoint (balance/limits) — Vyce /v1/me today. */
  async function checkCredits(p: FreeProvider) {
    if (busy) return;
    const key = settings.providerKeys?.[p.id]?.key?.trim() || draftKeyFor(p).trim();
    if (!key) {
      toast.error("Save a key first");
      return;
    }
    setBusy(p.id);
    try {
      const res = await fetch("/api/providers/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: p.id, key }),
      });
      const data = (await res.json()) as {
        name?: string;
        balance?: number;
        rateLimit?: number;
        enabled?: boolean;
        totalSpent?: number;
        totalRequests?: number;
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCredits((c) => ({ ...c, [p.id]: { ...data, at: Date.now() } }));
      // Honesty first: some providers (Vyce) apply daily free credits at request
      // time and report a $0.00 key-level balance — surface USAGE instead of a
      // misleading "balance $0.00".
      const zeroBalance = data.balance != null && data.balance === 0;
      toast.success(`${p.name} account checked${data.name ? ` — ${data.name}` : ""}`, {
        description: zeroBalance
          ? `Key balance reads $0.00 — daily free credits are applied at request time and are not exposed by the API (dashboard-only). Usage so far: $${(data.totalSpent ?? 0).toFixed(2)} spent · ${data.totalRequests ?? 0} calls · ${data.rateLimit ?? "?"} RPM.`
          : data.balance != null
            ? `Balance $${data.balance.toFixed(2)} · ${data.rateLimit ?? "?"} RPM limit${data.enabled === false ? " · KEY DISABLED" : ""}`
            : "Account reachable.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setCredits((c) => ({ ...c, [p.id]: { at: Date.now(), error: message } }));
      toast.error("Account check failed", { description: truncate(message, 90) });
    } finally {
      setBusy(null);
    }
  }

  /** Persist the live catalog + refresh timestamps. */
  function persistLive(next: LiveCatalog, nextAt: LiveAtMap) {
    setLive(next);
    setLiveAt(nextAt);
    try {
      localStorage.setItem(LIVE_CATALOG_KEY, JSON.stringify(next));
      localStorage.setItem(LIVE_AT_KEY, JSON.stringify(nextAt));
    } catch {
      /* quota */
    }
  }

  /**
   * Refresh ONE provider's model roster from its live /models endpoint.
   * Works for every registry provider (r22): key-authed catalogs POST the
   * vault key per-request; OpenRouter/Pollinations delegate keyless.
   * Returns the live model count, or null on failure (error toasted).
   */
  async function refreshProviderModels(p: FreeProvider): Promise<number | null> {
    const entry = settings.providerKeys?.[p.id];
    const key = entry?.key?.trim() || "";
    setRefreshing((r) => ({ ...r, [p.id]: true }));
    try {
      const res = await fetch("/api/providers/free-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: p.id, key, accountId: entry?.accountId }),
      });
      const data = (await res.json()) as {
        models?: { id: string; label?: string; contextLength?: number }[];
        error?: string;
        cached?: boolean;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      const models = data.models ?? [];
      persistLive({ ...live, [p.id]: models }, { ...liveAt, [p.id]: Date.now() });
      return models.length;
    } catch (err) {
      toast.error(`${p.name} model refresh failed`, {
        description: truncate(err instanceof Error ? err.message : "Unknown error", 110),
      });
      return null;
    } finally {
      setRefreshing((r) => ({ ...r, [p.id]: false }));
    }
  }

  /** THE single renew button: refresh every READY provider's roster in one pass.
   *  Providers without a saved key are skipped silently (their /models needs a
   *  key) — a per-card Refresh still explains what's missing. */
  async function refreshAllModels() {
    if (Object.values(refreshing).some(Boolean)) return;
    const targets = FREE_PROVIDERS.filter(
      (p) => p.liveCatalog && (p.noKey || !!settings.providerKeys?.[p.id]?.key?.trim())
    );
    let total = 0;
    let okCount = 0;
    const failures: string[] = [];
    for (const p of targets) {
      const n = await refreshProviderModels(p);
      if (n != null) {
        total += n;
        okCount += 1;
      } else {
        failures.push(p.name);
      }
    }
    if (okCount > 0) {
      const skipped = FREE_PROVIDERS.filter((p) => p.liveCatalog && !targets.includes(p)).length;
      toast.success(`${total} live models across ${okCount}/${targets.length} ready providers`, {
        description: [
          failures.length ? `Failed (cached rosters kept): ${failures.join(", ")}` : null,
          skipped > 0 ? `${skipped} provider${skipped === 1 ? "" : "s"} skipped — add a key on their card to refresh those.` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    }
  }

  function applyProvider(p: FreeProvider) {
    if (!p.noKey && !settings.providerKeys?.[p.id]?.key?.trim() && !draftKeyFor(p).trim()) {
      toast.error(`Add your ${p.name} key first`, {
        description: "Follow the guide below — it takes ~2 minutes for most providers.",
      });
      setExpanded(p.id);
      return;
    }
    if (draftKeyFor(p).trim() && draftKeyFor(p).trim() !== entryFor(p).key) {
      saveProvider(p);
    }
    update({ provider: "custom", activeProviderId: p.id });
    toast.success(`${p.name} is now your LLM provider`, {
      description: p.noKey ? "No key needed — start chatting." : `Model: ${entryFor(p).model || p.models[0]?.id}`,
    });
  }

  async function refreshLiveCatalog() {
    if (busy) return;
    const rotating = FREE_PROVIDERS.filter((p) => p.liveCatalog);
    if (rotating.length === 0) return;
    setBusy("live-catalog");
    let total = 0;
    const failures: string[] = [];
    try {
      const next: LiveCatalog = { ...live };
      for (const p of rotating) {
        try {
          const res = await fetch(`/api/providers/free-models?provider=${encodeURIComponent(p.liveCatalog!)}`);
          const data = (await res.json()) as { models?: LiveCatalog[string]; error?: string; cached?: boolean };
          if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
          next[p.id] = data.models ?? [];
          total += data.models?.length ?? 0;
        } catch (err) {
          failures.push(`${p.name}: ${err instanceof Error ? err.message : "unknown"}`);
        }
      }
      setLive(next);
      try {
        localStorage.setItem(LIVE_CATALOG_KEY, JSON.stringify(next));
      } catch {
        /* quota */
      }
      if (total > 0) {
        toast.success(`${total} live models across ${rotating.length} rotating catalogs`, {
          description: failures.length ? `Partial: ${truncate(failures.join(" · "), 90)}` : "Fresh from the providers' APIs.",
        });
      } else {
        throw new Error(failures.join(" · ") || "No catalogs returned models");
      }
    } catch (err) {
      toast.error("Live catalog fetch failed", {
        description: err instanceof Error ? truncate(err.message, 80) : "Unknown error",
      });
    } finally {
      setBusy(null);
    }
  }

  const modelOptionsFor = (p: FreeProvider): { id: string; label: string; note?: string; badge?: string; badgeTone?: "violet" | "emerald" | "amber" | "muted" }[] =>
    withSavedOption(providerModelOptions(p, live), entryFor(p).model || p.models[0]?.id);

  /** Universal per-provider refresh button (works for every registry provider). */
  const renderRefreshButton = (p: FreeProvider, className = "") => {
    const isRefreshing = !!refreshing[p.id];
    const liveCount = live[p.id]?.length ?? 0;
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-6 px-2 text-[11px]", className)}
        onClick={(e) => {
          e.stopPropagation();
          void refreshProviderModels(p);
        }}
        disabled={isRefreshing}
        title={`Pull ${p.name}'s current model roster from its /models endpoint${liveCount ? ` · ${liveCount} live now · checked ${fmtRel(liveAt[p.id])}` : ""}`}
      >
        {isRefreshing ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-3 w-3" aria-hidden />
        )}
        Refresh models
        {liveCount > 0 ? (
          <span className="ml-1 rounded-full bg-violet-500/15 px-1.5 text-[10px] font-medium text-violet-300">{liveCount}</span>
        ) : null}
      </Button>
    );
  };

  const renderCard = (p: FreeProvider, featuredCard = false) => {
    const entry = entryFor(p);
    const hasKey = p.noKey || !!entry.key?.trim();
    const isActive = settings.provider === "custom" && settings.activeProviderId === p.id;
    const isOpen = expanded === p.id;
    const test = tests[p.id];
    const options = modelOptionsFor(p);
    const selectedModel = entry.model || p.models[0]?.id;

    return (
      <div
        key={p.id}
        className={cn(
          "rounded-xl border transition-all",
          featuredCard && "sm:col-span-1",
          isActive
            ? "border-violet-500/60 bg-violet-500/5 ring-2 ring-violet-500/20"
            : "bg-card hover:border-violet-500/30"
        )}
      >
        {/* Header row — click to expand */}
        <button
          type="button"
          onClick={() => toggleExpand(p.id)}
          aria-expanded={isOpen}
          className="flex w-full items-center gap-3 p-3 text-left outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] rounded-xl"
        >
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg",
              isActive ? "bg-violet-500/15" : "bg-muted"
            )}
            aria-hidden
          >
            {p.glyph}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold">{p.name}</span>
              {p.noKey ? (
                <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                  no signup
                </Badge>
              ) : p.cardRequired ? (
                <Badge variant="outline" className="border-amber-500/40 px-1.5 py-0 text-[10px] text-amber-500">
                  <CreditCard className="mr-0.5 h-2.5 w-2.5" aria-hidden /> card
                </Badge>
              ) : (
                <Badge variant="outline" className="border-emerald-500/40 px-1.5 py-0 text-[10px] text-emerald-500">
                  no card
                </Badge>
              )}
              {p.liveCatalog && (live[p.id]?.length ?? 0) > 0 ? (
                <Badge variant="outline" className="border-violet-500/40 px-1.5 py-0 text-[10px] text-violet-300">
                  <RefreshCw className="mr-0.5 h-2.5 w-2.5" aria-hidden /> {live[p.id]!.length} live
                </Badge>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{p.tagline}</span>
          </span>
          {/* status dot */}
          <span
            title={hasKey ? "Key saved" : "No key yet"}
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              hasKey ? (entry.validatedAt ? "bg-emerald-400" : "bg-emerald-400/50") : "bg-muted-foreground/30"
            )}
          />
          <ChevronDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
            aria-hidden
          />
        </button>

        {/* Expanded panel */}
        {isOpen ? (
          <div className="space-y-4 border-t px-3 pb-3 pt-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-500" aria-hidden />
              {p.limits}
            </p>

            {/* Setup guide */}
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold">
                  <KeyRound className="h-3.5 w-3.5" aria-hidden />
                  Get your key — {p.guide.length} steps
                </p>
                <a
                  href={p.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 hover:underline"
                >
                  Open {new URL(p.signupUrl).host}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              </div>
              <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                {p.guide.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>

            {/* Key input */}
            {!p.noKey ? (
              <div className="space-y-1.5">
                <Label htmlFor={`key-${p.id}`} className="text-xs">
                  API key {p.keyPrefix ? <span className="font-mono text-muted-foreground">({p.keyPrefix}…)</span> : null}
                </Label>
                <div className="relative">
                  <Input
                    id={`key-${p.id}`}
                    type={showKey[p.id] ? "text" : "password"}
                    value={draftKeyFor(p)}
                    onChange={(e) => setDraftKeys((d) => ({ ...d, [p.id]: e.target.value }))}
                    placeholder={p.keyPrefix ? `${p.keyPrefix}…` : "paste your key…"}
                    className="pr-10 font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => ({ ...s, [p.id]: !s[p.id] }))}
                    aria-label={showKey[p.id] ? "Hide key" : "Show key"}
                    className="absolute top-1/2 right-1 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {showKey[p.id] ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs text-emerald-600 dark:text-emerald-400">
                This provider needs no key at all — just press Use.
              </p>
            )}

            {/* Account id (Cloudflare-style) */}
            {p.needsAccountId ? (
              <div className="space-y-1.5">
                <Label htmlFor={`acct-${p.id}`} className="text-xs">
                  Account id <span className="text-muted-foreground">(spliced into the endpoint URL)</span>
                </Label>
                <Input
                  id={`acct-${p.id}`}
                  value={draftAccountFor(p)}
                  onChange={(e) => setDraftAccounts((d) => ({ ...d, [p.id]: e.target.value }))}
                  placeholder="32-hex Cloudflare account id"
                  className="font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ) : null}

            {/* Model picker — searchable curated + live, stale-saved stays visible */}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <Label className="text-xs">
                  Default model
                  {liveAt[p.id] ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">· checked {fmtRel(liveAt[p.id])}</span>
                  ) : null}
                </Label>
                {renderRefreshButton(p)}
              </div>
              <ModelPicker
                value={selectedModel}
                options={options}
                onSelect={(v) =>
                  update({
                    providerKeys: { ...(settings.providerKeys ?? {}), [p.id]: { ...entry, model: v } },
                  })
                }
                ariaLabel={`${p.name} default model`}
                placeholder="Pick a model…"
                searchPlaceholder={`Search ${p.name} models…`}
                emptyTitle="No model matches"
                emptyHint="Clear the search, or hit Refresh models to pull the current roster."
                footer={renderRefreshButton(p, "w-full justify-start")}
              />
            </div>

            {/* Actions + status */}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={() => applyProvider(p)} disabled={isActive}>
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {isActive ? "Active provider" : "Use this provider"}
              </Button>
              {!p.noKey ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => saveProvider(p)}
                    disabled={busy === p.id}
                  >
                    Save key
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const saved = settings.providerKeys?.[p.id]?.key?.trim();
                      if (!saved) {
                        saveProvider(p, { validateAfter: true });
                      } else {
                        void validate(p);
                      }
                    }}
                    disabled={busy === p.id}
                  >
                    {busy === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Validate
                  </Button>
                </>
              ) : null}
              {p.mePath ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void checkCredits(p)}
                  disabled={busy === p.id}
                  title={`Probe ${p.name}'s account endpoint (${p.mePath}) for live balance & limits`}
                >
                  {busy === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Wallet className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Check credits
                </Button>
              ) : null}
              <span aria-live="polite" className="flex min-h-6 flex-1 flex-wrap items-center justify-end gap-1.5">
                {test ? (
                  test.ok ? (
                    <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
                      ✓ {test.ms}ms · saved {fmtRel(entry.validatedAt)}
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="max-w-full font-normal">
                      ✗ {test.error}
                    </Badge>
                  )
                ) : hasKey && entry.validatedAt ? (
                  <span className="text-[11px] text-muted-foreground">validated {fmtRel(entry.validatedAt)}</span>
                ) : null}
                {credits[p.id] && !credits[p.id]!.error ? (
                  <Badge
                    variant="outline"
                    className="max-w-full border-violet-500/40 bg-violet-500/10 font-normal text-violet-300"
                    title={
                      credits[p.id]!.balance === 0
                        ? "This provider applies daily free credits at request time — the API key-level balance always reads $0.00 and daily credit status is dashboard-only. Usage figures come from the account endpoint."
                        : `Live from ${p.mePath}`
                    }
                  >
                    {credits[p.id]!.name ? `${credits[p.id]!.name} · ` : ""}
                    {credits[p.id]!.balance != null && credits[p.id]!.balance! > 0
                      ? `$${credits[p.id]!.balance!.toFixed(2)} · `
                      : credits[p.id]!.totalSpent != null
                        ? `$${credits[p.id]!.totalSpent!.toFixed(2)} spent · ${credits[p.id]!.totalRequests ?? 0} calls · `
                        : ""}
                    {credits[p.id]!.rateLimit != null ? `${credits[p.id]!.rateLimit} RPM · ` : ""}
                    checked {fmtRel(credits[p.id]!.at)}
                  </Badge>
                ) : credits[p.id]?.error ? (
                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500 max-w-full font-normal">
                    credits: {truncate(credits[p.id]!.error!, 60)}
                  </Badge>
                ) : null}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <Card className="gap-4">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Free frontier providers</CardTitle>
            <CardDescription>
              {readyCount}/{FREE_PROVIDERS.length} ready · guides, keys and live catalogs. Keys live in your
              browser only — zero telemetry, sent nowhere but the provider you pick.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void refreshAllModels()}
              disabled={Object.values(refreshing).some(Boolean)}
              title="Pull every provider's current model roster in one pass — Gemini, Groq, Vyce, Mistral, NVIDIA and the rest"
            >
              {Object.values(refreshing).some(Boolean) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              )}
              Refresh all models
            </Button>
            <a
              href={FREELLM_SH_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs text-violet-400 transition-colors hover:border-violet-500/40 hover:text-violet-300"
              title="The community index of free frontier models this gallery is curated against"
            >
              freellm.sh index
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
          <Button
            type="button"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => {
              history.replaceState(null, "", "#/setup");
              useUiStore.getState().openSetupWizard();
            }}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Guided setup
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Featured trio */}
        <div className="grid items-start gap-3 sm:grid-cols-3">{featured.map((p) => renderCard(p, true))}</div>
        {/* The rest */}
        <div className="grid items-start gap-3">{rest.map((p) => renderCard(p))}</div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Catalog curated against freellm.sh + official vendor docs, and refreshed live: every provider card
          has a <span className="text-violet-400">Refresh models</span> button that pulls its current roster
          straight from the source (rosters rotate — Gemini, Groq and Vyce ship new models constantly).
          Registering takes 2-5 minutes per provider; nothing is uploaded anywhere by this app.
        </p>
      </CardContent>
    </Card>
  );
}
