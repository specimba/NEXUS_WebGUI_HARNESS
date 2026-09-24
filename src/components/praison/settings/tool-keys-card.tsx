"use client";

// ─── Tool Keys card (r41) ────────────────────────────────────────────────────
// BYOK keys that power BUILT-IN tools (distinct from provider keys, which
// authenticate LLM lanes). Same doctrine: the key lives in your browser's
// localStorage and rides a tool-execution request ONLY when that exact tool
// actually runs — never with any other call, never persisted server-side.

import * as React from "react";
import { ExternalLink, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettingsStore } from "@/lib/stores";

export function ToolKeysCard() {
  const hyperbrowserKey = useSettingsStore((s) => s.settings.hyperbrowserKey ?? "");
  const update = useSettingsStore((s) => s.update);
  const keySet = hyperbrowserKey.trim().length > 0;

  return (
    <Card className="gap-4" id="tools">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Wrench className="size-4 text-violet-500" aria-hidden />
          Tool Keys
        </CardTitle>
        <CardDescription>
          API keys that arm built-in tools. BYOK: keys stay in your browser and
          are attached ONLY to the tool that needs them — one execution, never
          stored server-side.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-border/80 bg-muted/20 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span aria-hidden className="text-sm leading-none">
              🕸️
            </span>
            <Label className="text-xs">Hyperbrowser API key</Label>
            {keySet ? (
              <Badge
                variant="outline"
                className="border-emerald-500/40 bg-emerald-500/5 text-[10px] font-normal tabular-nums"
                title={`A key is saved (${hyperbrowserKey.trim().length} characters). It rides only deep_scrape executions.`}
              >
                key set · {hyperbrowserKey.trim().length} chars
              </Badge>
            ) : (
              <Badge variant="outline" className="border-dashed text-[10px] font-normal text-muted-foreground">
                not set
              </Badge>
            )}
            <a
              href="https://app.hyperbrowser.ai"
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-violet-600 underline-offset-2 hover:underline dark:text-violet-400"
            >
              app.hyperbrowser.ai
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            headless cloud browser · used by the deep_scrape tool — JS rendering
            and bot defeat for pages plain fetch cannot read (SPAs,
            Cloudflare-guarded sites). Toggle the tool on per-agent in its
            editor; scrape jobs run on Hyperbrowser&apos;s cloud (~5–25s), so
            this key transits the app server only inside that one tool call.
          </p>
          <Input
            type="password"
            value={hyperbrowserKey}
            onChange={(e) => update({ hyperbrowserKey: e.target.value })}
            placeholder="hb_… (optional — deep_scrape fails honestly without it)"
            aria-label="Hyperbrowser API key"
            autoComplete="off"
            className="mt-2 h-8 border-border/70 bg-background/60 font-mono text-xs"
          />
        </div>
      </CardContent>
    </Card>
  );
}
