"use client";

import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  CreditCard,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessagesSquare,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { runAgentChat } from "@/lib/chat-client";
import { FREELLM_SH_URL, FREE_PROVIDERS, providerBaseUrl, type FreeProvider } from "@/lib/providers";
import { useSettingsStore, useUiStore } from "@/lib/stores";
import type { ProviderKeyEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─── Guided setup wizard: zero → working frontier key in ~3 minutes ──────────
// Deep-linkable via the ui store (openSetupWizard(providerId)) and the
// `#/setup` / `#/guide/<providerId>` hash routes.

type TestResult = { ok: true; ms: number } | { ok: false; error: string };

const WIZARD_STEPS = ["Pick a provider", "Register (2-3 min)", "Connect key", "Done"];

function ProviderBadges({ p }: { p: FreeProvider }) {
  return (
    <>
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
      {p.featured ? (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-violet-400">
          <Sparkles className="mr-0.5 h-2.5 w-2.5" aria-hidden /> recommended
        </Badge>
      ) : null}
    </>
  );
}

export function SetupWizard() {
  const open = useUiStore((s) => s.setupWizardOpen);
  const setOpen = useUiStore((s) => s.setSetupWizardOpen);
  const deepLinkProviderId = useUiStore((s) => s.setupWizardProviderId);

  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  const [step, setStep] = React.useState(0);
  const [providerId, setProviderId] = React.useState<string | null>(null);
  const [draftKey, setDraftKey] = React.useState("");
  const [draftAccount, setDraftAccount] = React.useState("");
  const [draftModel, setDraftModel] = React.useState("");
  const [showKey, setShowKey] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [test, setTest] = React.useState<TestResult | null>(null);

  const provider = FREE_PROVIDERS.find((p) => p.id === providerId) ?? null;

  // Reset whenever the wizard opens; honor deep-linked provider (#/guide/<id>).
  React.useEffect(() => {
    if (!open) return;
    const pid = deepLinkProviderId && FREE_PROVIDERS.some((p) => p.id === deepLinkProviderId)
      ? deepLinkProviderId
      : null;
    setProviderId(pid);
    setStep(pid ? 1 : 0);
    setDraftKey("");
    setDraftAccount("");
    setDraftModel("");
    setShowKey(false);
    setTesting(false);
    setTest(null);
  }, [open, deepLinkProviderId]);

  function pickProvider(p: FreeProvider) {
    setProviderId(p.id);
    const entry = settings.providerKeys?.[p.id];
    setDraftKey(entry?.key ?? "");
    setDraftAccount(entry?.accountId ?? "");
    setDraftModel(entry?.model ?? p.models[0]?.id ?? "");
    setTest(null);
    // Keyless providers (Pollinations) and providers that already have a key
    // skip the registration reading — straight to connect/activate.
    if (p.noKey || entry?.key?.trim()) setStep(2);
    else setStep(1);
  }

  function saveEntry(p: FreeProvider, extra: Partial<ProviderKeyEntry> = {}) {
    const entry: ProviderKeyEntry = {
      ...(settings.providerKeys?.[p.id] ?? {}),
      key: draftKey.trim(),
      accountId: draftAccount.trim() || undefined,
      model: draftModel || p.models[0]?.id,
      ...extra,
    };
    update({ providerKeys: { ...(settings.providerKeys ?? {}), [p.id]: entry } });
    return entry;
  }

  async function validateAndFinish(p: FreeProvider) {
    if (testing) return;
    const key = draftKey.trim();
    if (!p.noKey && !key) {
      toast.error("Paste your API key first");
      return;
    }
    setTesting(true);
    setTest(null);
    const model = draftModel || p.models[0]?.id;
    const started = performance.now();
    try {
      await runAgentChat({
        provider: "custom",
        apiKey: key || undefined,
        baseUrl: providerBaseUrl(p, draftAccount.trim() || undefined),
        model,
        maxIterations: 1,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
      });
      const ms = Math.round(performance.now() - started);
      saveEntry(p, { validatedAt: Date.now() });
      setTest({ ok: true, ms });
      update({ provider: "custom", activeProviderId: p.id });
      setStep(3);
    } catch (err) {
      setTest({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setTesting(false);
    }
  }

  function finish() {
    setOpen(false);
    useUiStore.getState().setView("chat");
    toast.success("You're all set", {
      description: `${provider?.name ?? "Provider"} is active — chat away. Nothing left your browser except model calls.`,
    });
  }

  const signupHost = provider
    ? (() => {
        try {
          return new URL(provider.signupUrl).host;
        } catch {
          return "signup";
        }
      })()
    : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) history.replaceState(null, "", location.pathname + location.search);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" aria-hidden />
            Free frontier key — guided setup
          </DialogTitle>
          <DialogDescription>
            {WIZARD_STEPS[step]} · step {Math.min(step + 1, 4)} of 4 · keys stay in your browser
          </DialogDescription>
        </DialogHeader>

        {/* Progress rail */}
        <div className="flex items-center gap-1" aria-hidden>
          {WIZARD_STEPS.map((s, i) => (
            <div
              key={s}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < step ? "bg-violet-500" : i === step ? "bg-violet-500/50" : "bg-muted"
              )}
            />
          ))}
        </div>

        {/* ── Step 0: pick a provider ── */}
        {step === 0 ? (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Every provider below has a genuinely free tier. Recommended ones need no credit
              card and take about 2 minutes. Catalog curated against{" "}
              <a href={FREELLM_SH_URL} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline">
                freellm.sh
              </a>
              .
            </p>
            <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {FREE_PROVIDERS.map((p) => {
                const entry = settings.providerKeys?.[p.id];
                const hasKey = p.noKey || !!entry?.key?.trim();
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickProvider(p)}
                    className="flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:border-violet-500/40 hover:bg-violet-500/5"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-base" aria-hidden>
                      {p.glyph}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold">{p.name}</span>
                        <ProviderBadges p={p} />
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{p.tagline}</span>
                    </span>
                    {hasKey ? (
                      <span className="shrink-0 text-[10px] font-medium text-emerald-500">key saved</span>
                    ) : (
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
              Zero telemetry — keys are stored locally and sent only to the provider you choose.
            </p>
          </div>
        ) : null}

        {/* ── Step 1: registration guide ── */}
        {step === 1 && provider ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg" aria-hidden>
                {provider.glyph}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                  {provider.name} <ProviderBadges p={provider} />
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{provider.limits}</p>
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
                <KeyRound className="h-3.5 w-3.5" aria-hidden />
                How to get your key — {provider.guide.length} steps
              </p>
              <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                {provider.guide.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ol>
              <a
                href={provider.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-400 transition-colors hover:bg-violet-500/20"
              >
                Open {signupHost} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep(0)}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setStep(2)}
              >
                I have my key <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}

        {/* ── Step 2: connect the key ── */}
        {step === 2 && provider ? (
          <div className="space-y-4">
            {provider.noKey ? (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs text-emerald-600 dark:text-emerald-400">
                {provider.name} needs no key at all — activate and go.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="wizard-key" className="text-xs">
                  {provider.name} API key{" "}
                  {provider.keyPrefix ? <span className="font-mono text-muted-foreground">({provider.keyPrefix}…)</span> : null}
                </Label>
                <div className="relative">
                  <Input
                    id="wizard-key"
                    type={showKey ? "text" : "password"}
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                    placeholder={provider.keyPrefix ? `${provider.keyPrefix}…` : "paste your key…"}
                    className="pr-10 font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    aria-label={showKey ? "Hide key" : "Show key"}
                    className="absolute top-1/2 right-1 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
              </div>
            )}

            {provider.needsAccountId ? (
              <div className="space-y-1.5">
                <Label htmlFor="wizard-account" className="text-xs">
                  Account id <span className="text-muted-foreground">(from the Cloudflare dashboard)</span>
                </Label>
                <Input
                  id="wizard-account"
                  value={draftAccount}
                  onChange={(e) => setDraftAccount(e.target.value)}
                  placeholder="32-hex account id"
                  className="font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label className="text-xs">Default model</Label>
              <Select value={draftModel} onValueChange={setDraftModel}>
                <SelectTrigger className="w-full font-mono text-xs" aria-label={`${provider.name} default model`}>
                  <SelectValue placeholder="Pick a model…" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto">
                  {provider.models.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="font-mono text-xs">
                      <span className="font-sans font-medium">{m.label}</span>
                      <span className="ml-1.5 font-sans text-[10px] text-muted-foreground">{m.note ?? m.id}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {test && !test.ok ? (
              <p className="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-xs text-red-500">
                {test.error}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setStep(provider.guide.length >= 0 ? 1 : 0)}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={testing}
                  onClick={() => {
                    if (provider.noKey) {
                      // No key needed: just activate.
                      saveEntry(provider);
                      update({ provider: "custom", activeProviderId: provider.id });
                      setStep(3);
                      return;
                    }
                    saveEntry(provider);
                    void validateAndFinish(provider);
                  }}
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {provider.noKey ? "Activate" : "Save & test"}
                </Button>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              “Save &amp; test” makes one real round-trip to {signupHost} to confirm the key works,
              then activates the provider. The test runs from your browser — nothing is logged here.
            </p>
          </div>
        ) : null}

        {/* ── Step 3: done ── */}
        {step === 3 && provider ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10" aria-hidden>
              <Check className="h-6 w-6 text-emerald-500" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">{provider.name} is live</p>
              <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
                Your key is stored only in this browser&apos;s localStorage and is sent solely to{" "}
                {signupHost} when you chat. No account, no cloud, no telemetry.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button type="button" size="sm" onClick={finish}>
                <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
                Start chatting
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setStep(0);
                  setProviderId(null);
                }}
              >
                Add another provider
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
