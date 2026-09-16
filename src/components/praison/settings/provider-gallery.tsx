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
  const [live, setLive] = React.useState<LiveCatalog>(() => loadLiveCatalog());

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
              {p.liveCatalog ? (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  <RefreshCw className="mr-0.5 h-2.5 w-2.5" aria-hidden /> live catalog
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
              <div className="flex items-center justify-between">
                <Label className="text-xs">Default model</Label>
                {p.liveCatalog ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={refreshLiveCatalog}
                    disabled={busy === "openrouter-live"}
                  >
                    {busy === "openrouter-live" ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="h-3 w-3" aria-hidden />
                    )}
                    Refresh live :free catalog
                  </Button>
                ) : null}
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
                emptyHint={
                  p.liveCatalog
                    ? "Curated + live :free models. Clear the search, or refresh the live catalog."
                    : "Clear the search to see this provider's full catalog."
                }
                footer={
                  p.liveCatalog ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start text-[11px] text-muted-foreground"
                      onClick={refreshLiveCatalog}
                      disabled={busy === "openrouter-live"}
                    >
                      {busy === "openrouter-live" ? (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw className="h-3 w-3" aria-hidden />
                      )}
                      Refresh live :free catalog
                    </Button>
                  ) : undefined
                }
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
              <span aria-live="polite" className="flex min-h-6 flex-1 items-center justify-end">
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
          Catalog curated against freellm.sh + official vendor docs (Sept 2026). OpenRouter&apos;s free roster
          rotates weekly — use its live refresh. Registering takes 2-5 minutes per provider; nothing is
          uploaded anywhere by this app.
        </p>
      </CardContent>
    </Card>
  );
}
