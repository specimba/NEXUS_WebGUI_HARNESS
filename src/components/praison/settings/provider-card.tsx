"use client";

import * as React from "react";
import { Eye, EyeOff, KeyRound, Loader2, PlugZap, Sparkles } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { runAgentChat } from "@/lib/chat-client";
import { CUSTOM_MODELS, DEFAULT_BASE_URL, modelLabel } from "@/lib/constants";
import { truncate } from "@/lib/helpers";
import { useSettingsStore } from "@/lib/stores";
import type { ProviderMode } from "@/lib/types";
import { cn } from "@/lib/utils";

type TestResult = { ok: true; ms: number } | { ok: false; error: string } | null;

const PROVIDER_OPTIONS: {
  value: ProviderMode;
  icon: React.ElementType;
  title: string;
  sub: string;
  badge?: string;
}[] = [
  {
    value: "auto",
    icon: Sparkles,
    title: "Auto — built-in GLM",
    sub: "Works instantly with no API key. Tool calling via built-in protocol.",
    badge: "Zero config",
  },
  {
    value: "custom",
    icon: KeyRound,
    title: "Custom — bring your own key (BYOK)",
    sub: "Any OpenAI-compatible endpoint: Groq, OpenAI, OpenRouter, Ollama, LM Studio…",
  },
];

export function ProviderCard() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [showKey, setShowKey] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<TestResult>(null);

  const presetMatch = CUSTOM_MODELS.find((m) => m.id === settings.defaultModel);

  async function handleTestConnection() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    const started = performance.now();
    try {
      await runAgentChat({
        provider: "custom",
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.defaultModel,
        maxIterations: 1,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
      });
      setTestResult({ ok: true, ms: Math.round(performance.now() - started) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setTestResult({ ok: false, error: truncate(message, 80) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="gap-4">
      <CardHeader className="pb-3">
        <CardTitle>LLM Provider</CardTitle>
        <CardDescription>Choose how agents reach their brain.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Provider mode — radio group semantics */}
        <div role="radiogroup" aria-label="Provider mode" className="grid gap-3">
          {PROVIDER_OPTIONS.map((opt) => {
            const selected = settings.provider === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => update({ provider: opt.value })}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none",
                  "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                  selected
                    ? "border-violet-500/60 bg-violet-500/5 ring-2 ring-violet-500/30"
                    : "hover:border-violet-500/30 hover:bg-muted/50"
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    selected ? "bg-violet-500/15 text-violet-400" : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{opt.title}</span>
                    {opt.badge ? (
                      <Badge variant="secondary" className="text-[10px] font-normal">
                        {opt.badge}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {opt.sub}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Custom provider configuration */}
        {settings.provider === "custom" ? (
          <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
            {/* API base URL */}
            <div className="space-y-1.5">
              <Label htmlFor="provider-base-url" className="text-xs">
                API Base URL
              </Label>
              <Input
                id="provider-base-url"
                value={settings.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value })}
                placeholder={DEFAULT_BASE_URL}
                className="font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Groq: https://api.groq.com/openai/v1 · Ollama: http://localhost:11434/v1
              </p>
            </div>

            {/* API key */}
            <div className="space-y-1.5">
              <Label htmlFor="provider-api-key" className="text-xs">
                API Key
              </Label>
              <div className="relative">
                <Input
                  id="provider-api-key"
                  type={showKey ? "text" : "password"}
                  value={settings.apiKey}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  placeholder="sk-…"
                  className="pr-10 font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? "Hide API key" : "Show API key"}
                  className="absolute top-1/2 right-1 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]"
                >
                  {showKey ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Stored locally in your browser only — never persisted server-side.
              </p>
            </div>

            {/* Default model */}
            <div className="space-y-1.5">
              <div className="grid gap-1.5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="provider-model" className="text-xs">
                    Default model
                  </Label>
                  <Select
                    value={presetMatch ? presetMatch.id : settings.defaultModel || undefined}
                    onValueChange={(v) => update({ defaultModel: v })}
                  >
                    <SelectTrigger id="provider-model" className="w-full font-mono text-xs">
                      <SelectValue placeholder="Pick a preset…" />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOM_MODELS.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="font-mono text-xs">
                          {modelLabel(m.id)}
                        </SelectItem>
                      ))}
                      {!presetMatch && settings.defaultModel ? (
                        <SelectItem value={settings.defaultModel} className="font-mono text-xs">
                          {settings.defaultModel}
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provider-model-custom" className="text-xs">
                    Custom model id
                  </Label>
                  <Input
                    id="provider-model-custom"
                    value={settings.defaultModel}
                    onChange={(e) => update({ defaultModel: e.target.value })}
                    placeholder="…or type a custom model id"
                    className="font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>
            </div>

            {/* Test connection */}
            <div className="space-y-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <PlugZap className="h-4 w-4" aria-hidden />
                )}
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <div aria-live="polite" className="flex min-h-5 items-center">
                {testResult ? (
                  testResult.ok ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
                    >
                      Connected ✓ {testResult.ms}ms
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="max-w-full font-normal">
                      ✗ {testResult.error}
                    </Badge>
                  )
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
