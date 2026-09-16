"use client";

// ─── Local Models · WebGPU + WebLLM playground ───────────────────────────────
// Detects the user's GPU (src/lib/webgpu.ts), suggests prebuilt WebLLM models
// that fit the VRAM budget, and runs them fully in-browser. Patterns adopted
// from HF Spaces field examples (src/lib/hf-spaces.ts): shader-f16 hard gate,
// weight-cache management, 1-token shader warmup, interruptible generation,
// tokens/sec meter. Zero telemetry — everything stays on the device.

import * as React from "react";
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import {
  BadgeCheck,
  Cpu,
  Download,
  Eraser,
  ExternalLink,
  Flame,
  Gauge,
  HardDrive,
  MemoryStick,
  MonitorSmartphone,
  Play,
  SendHorizontal,
  Square,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  detectGpu,
  fmtMB,
  suggestModels,
  LOCAL_MODELS,
  HF_WEBGPU_GUIDE_URL,
  WEBLLM_REPO_URL,
  type GpuReport,
  type LocalModelOption,
} from "@/lib/webgpu";
import {
  HF_SPACE_EXAMPLES,
  SIZE_TIER_LABEL,
  fitsBudget,
  sizeTierOf,
  spaceUrl,
  type SizeTier,
} from "@/lib/hf-spaces";

type Phase = "detecting" | "idle" | "loading" | "warming" | "live" | "generating" | "error";

interface LoadProgress {
  progress: number; // 0..1
  text: string;
}

const TIER_BADGE: Record<GpuReport["tier"], { label: string; cls: string }> = {
  none: { label: "No WebGPU", cls: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30" },
  tiny: { label: "Tiny GPU", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  small: { label: "Small GPU", cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  medium: { label: "Medium GPU", cls: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30" },
  large: { label: "Large GPU", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
};

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-1.5" title={label}>
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="min-w-0 truncate text-xs" aria-label={label}>
        <span className="text-muted-foreground">{label}: </span>
        <span className="font-medium">{value}</span>
      </span>
    </div>
  );
}

export function LocalModelsPanel() {
  const [gpu, setGpu] = React.useState<GpuReport | null>(null);
  const [phase, setPhase] = React.useState<Phase>("detecting");
  const [errorMsg, setErrorMsg] = React.useState("");
  const [modelId, setModelId] = React.useState("");
  const [load, setLoad] = React.useState<LoadProgress | null>(null);
  const [cachedIds, setCachedIds] = React.useState<Set<string>>(new Set());
  const [inCache, setInCache] = React.useState(false);

  // playground state
  const [prompt, setPrompt] = React.useState("");
  const [output, setOutput] = React.useState("");
  const [tps, setTps] = React.useState<number | null>(null);
  const [loadedLabel, setLoadedLabel] = React.useState("");

  const engineRef = React.useRef<MLCEngineInterface | null>(null);
  const mountedRef = React.useRef(true);
  const outputRef = React.useRef("");

  // ── Detect GPU on mount + refresh cache map ───────────────────────────────
  React.useEffect(() => {
    mountedRef.current = true;
    (async () => {
      const report = await detectGpu();
      if (!mountedRef.current) return;
      setGpu(report);
      setPhase("idle");
      const fits = suggestModels(report);
      if (fits.length > 0) setModelId(fits[0].id);
      try {
        const webllm = await import("@mlc-ai/web-llm");
        const marks = await Promise.all(
          LOCAL_MODELS.filter((m) => m.engine === "web-llm").map(async (m) => ({
            id: m.id,
            has: await webllm.hasModelInCache(m.id).catch(() => false),
          })),
        );
        if (mountedRef.current) setCachedIds(new Set(marks.filter((m) => m.has).map((m) => m.id)));
      } catch {
        /* chunk load failure — cache badges simply stay empty */
      }
    })();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Unload engine when leaving the panel ──────────────────────────────────
  React.useEffect(() => {
    return () => {
      const engine = engineRef.current;
      engineRef.current = null;
      if (engine) void engine.unload().catch(() => undefined);
    };
  }, []);

  const fits = React.useMemo(() => (gpu ? suggestModels(gpu) : []), [gpu]);
  const selected = React.useMemo(
    () => LOCAL_MODELS.find((m) => m.id === modelId) ?? null,
    [modelId],
  );
  const f16Blocked = React.useMemo(() => {
    if (!gpu?.supported || gpu.shaderF16) return null;
    const missing = LOCAL_MODELS.filter((m) => m.requiresF16 && m.vramMB <= gpu.budgetMB);
    return missing.length > 0
      ? `${missing.length} model${missing.length > 1 ? "s" : ""} need shader-f16 (your adapter lacks it) — f32 variants are offered instead.`
      : null;
  }, [gpu]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!selected || selected.engine !== "web-llm") {
        setInCache(false);
        return;
      }
      try {
        const webllm = await import("@mlc-ai/web-llm");
        const has = await webllm.hasModelInCache(selected.id).catch(() => false);
        if (alive) setInCache(Boolean(has));
      } catch {
        if (alive) setInCache(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  const busy = phase === "loading" || phase === "warming" || phase === "generating";

  // ── Load model → warm up shaders → live ───────────────────────────────────
  async function handleLoad() {
    if (!selected || selected.engine !== "web-llm" || busy) return;
    setErrorMsg("");
    setOutput("");
    setTps(null);
    setPhase("loading");
    setLoad({ progress: 0, text: "Preparing…" });
    try {
      const webllm = await import("@mlc-ai/web-llm");
      const engine = await webllm.CreateMLCEngine(selected.id, {
        initProgressCallback: (p: { progress: number; text: string }) => {
          if (mountedRef.current) setLoad({ progress: p.progress ?? 0, text: p.text ?? "" });
        },
      });
      if (!mountedRef.current) {
        engine.unload().catch(() => undefined);
        return;
      }
      engineRef.current = engine;

      // Field pattern (IBM Granite): 1-token warmup so first real reply isn't
      // dominated by shader compilation.
      setPhase("warming");
      setLoad({ progress: 1, text: "Compiling shaders · warming up…" });
      try {
        await engine.chat.completions.create({
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        });
      } catch {
        /* warmup failures are non-fatal */
      }
      if (!mountedRef.current) return;
      setLoadedLabel(selected.label);
      setPhase("live");
      setLoad(null);
      setCachedIds((prev) => new Set(prev).add(selected.id));
      setInCache(true);
    } catch (err) {
      if (!mountedRef.current) return;
      setPhase("error");
      setLoad(null);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Model load failed — weight downloads need a permissive network (0.2–6 GB).",
      );
    }
  }

  async function handleUnload() {
    const engine = engineRef.current;
    engineRef.current = null;
    if (engine) await engine.unload().catch(() => undefined);
    setPhase("idle");
    setLoadedLabel("");
    setOutput("");
    setTps(null);
  }

  // ── Streaming generate ────────────────────────────────────────────────────
  async function handleGenerate() {
    const engine = engineRef.current;
    const text = prompt.trim();
    if (!engine || !text || phase !== "live") return;
    setPhase("generating");
    setOutput("");
    setTps(null);
    outputRef.current = "";
    const t0 = performance.now();
    let tokens = 0;
    try {
      const stream = await engine.chat.completions.create({
        messages: [{ role: "user", content: text }],
        stream: true,
        max_tokens: 768,
      });
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          outputRef.current += delta;
          tokens += 1;
          if (mountedRef.current) {
            setOutput(outputRef.current);
            const secs = (performance.now() - t0) / 1000;
            if (secs > 0.4) setTps(tokens / secs);
          }
        }
      }
      const secs = (performance.now() - t0) / 1000;
      if (mountedRef.current) {
        if (secs > 0 && tokens > 0) setTps(tokens / secs);
        setPhase("live");
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // interrupted generation surfaces as an error too — keep what we have
      const msg = err instanceof Error ? err.message : "generation failed";
      if (/interrupt/i.test(msg)) {
        setPhase("live");
      } else {
        setPhase("error");
        setErrorMsg(msg);
      }
    }
  }

  function handleStop() {
    try {
      engineRef.current?.interruptGenerate();
    } catch {
      /* engine already idle */
    }
  }

  async function handleDeleteCache() {
    if (!selected || selected.engine !== "web-llm") return;
    try {
      const webllm = await import("@mlc-ai/web-llm");
      await webllm.deleteModelInCache(selected.id).catch(() => undefined);
      setCachedIds((prev) => {
        const next = new Set(prev);
        next.delete(selected.id);
        return next;
      });
      setInCache(false);
    } catch {
      /* cache API unavailable — ignore */
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Card className="gap-4" data-testid="local-models-panel">
      <CardHeader className="pb-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MonitorSmartphone className="h-4 w-4 text-violet-500" aria-hidden />
            Local Models · WebGPU
          </CardTitle>
          {gpu && (
            <Badge variant="outline" className={TIER_BADGE[gpu.tier].cls}>
              {TIER_BADGE[gpu.tier].label}
              {gpu.supported && gpu.budgetMB > 0 ? ` · ~${fmtMB(gpu.budgetMB)} budget` : ""}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          Run small LLMs entirely in this tab — weights download once into the browser cache, inference
          never leaves your device. Zero telemetry, zero keys.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── GPU report ─────────────────────────────────────────────────── */}
        {phase === "detecting" && (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <span className="bg-violet-500 h-2 w-2 animate-pulse rounded-full" aria-hidden />
            Detecting GPU…
          </div>
        )}

        {gpu && phase !== "detecting" && (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Stat
                icon={<Cpu className="h-3.5 w-3.5" />}
                label="Renderer"
                value={gpu.glRenderer || gpu.description || (gpu.supported ? "WebGPU adapter" : "n/a")}
              />
              <Stat
                icon={<HardDrive className="h-3.5 w-3.5" />}
                label="Device RAM"
                value={gpu.deviceMemoryGB > 0 ? `~${gpu.deviceMemoryGB} GB` : "unknown"}
              />
              <Stat icon={<MemoryStick className="h-3.5 w-3.5" />} label="Max buffer" value={gpu.maxBufferSize > 0 ? fmtMB(gpu.maxBufferSize / 1048576) : "n/a"} />
              <Stat icon={<Gauge className="h-3.5 w-3.5" />} label="CPU threads" value={gpu.cores > 0 ? String(gpu.cores) : "unknown"} />
            </div>
            {!gpu.secure && (
              <p className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5 text-xs">
                <TriangleAlert className="h-3.5 w-3.5" /> WebGPU needs a secure context (https or localhost).
              </p>
            )}
            {gpu.supported && gpu.isFallbackAdapter && (
              <p className="text-amber-600 dark:text-amber-400 flex items-center gap-1.5 text-xs">
                <TriangleAlert className="h-3.5 w-3.5" /> SwiftShader software adapter detected — expect very slow generation.
              </p>
            )}
            {!gpu.supported && gpu.secure && (
              <p className="text-muted-foreground text-xs">
                WebGPU is unavailable in this browser. The CPU/WASM fallbacks below still run, slowly — or
                try{" "}
                <a className="text-violet-500 hover:underline" href={HF_WEBGPU_GUIDE_URL} target="_blank" rel="noreferrer">
                  Transformers.js WebGPU guide
                </a>
                .
              </p>
            )}
            {f16Blocked && (
              <p className="text-amber-600 dark:text-amber-400 text-xs">
                <Flame className="mr-1 inline h-3 w-3" aria-hidden />
                {f16Blocked}
              </p>
            )}
          </div>
        )}

        <Separator />

        {/* ── Model picker + load ────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={modelId} onValueChange={setModelId} disabled={busy || fits.length === 0}>
            <SelectTrigger className="w-full font-mono text-xs sm:flex-1" aria-label="Local model">
              <SelectValue placeholder={fits.length === 0 ? "No model fits this device" : "Pick a model"} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {fits.map((m) => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  <span className="flex items-center gap-2">
                    <span className="truncate">{m.label}</span>
                    <span className="text-muted-foreground font-mono">{fmtMB(m.vramMB)}</span>
                    {cachedIds.has(m.id) && (
                      <Badge variant="outline" className="h-4 px-1 text-[10px] text-emerald-600">
                        cached ✓
                      </Badge>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {phase === "live" || phase === "generating" ? (
            <Button variant="outline" size="sm" onClick={handleUnload} className="shrink-0">
              <Eraser className="h-3.5 w-3.5" /> Unload
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleLoad}
              disabled={!selected || selected.engine !== "web-llm" || busy || !gpu?.supported}
              className="shrink-0 bg-violet-600 text-white hover:bg-violet-700"
            >
              <Download className="h-3.5 w-3.5" />
              {inCache ? "Load (cached)" : "Download & load"}
            </Button>
          )}

          {selected && selected.engine !== "web-llm" && (
            <p className="text-muted-foreground text-xs">
              ONNX/transformers.js models need the worker pipeline — pick a WebLLM prebuilt above.
            </p>
          )}
          {selected?.engine === "web-llm" && inCache && (
            <Button variant="ghost" size="sm" onClick={handleDeleteCache} className="text-muted-foreground shrink-0" title="Delete cached weights">
              <Eraser className="h-3.5 w-3.5" /> Cache
            </Button>
          )}
        </div>

        {selected && (
          <p className="text-muted-foreground text-xs">
            <span className="font-medium">{selected.label}</span> · {selected.params} params ·{" "}
            <span className="font-mono">{fmtMB(selected.vramMB)}</span> VRAM · {selected.note}
            {selected.requiresF16 && !gpu?.shaderF16 && " · needs shader-f16 (blocked)"}
          </p>
        )}

        {/* ── Load progress ──────────────────────────────────────────────── */}
        {(phase === "loading" || phase === "warming") && load && (
          <div className="space-y-1.5">
            <Progress value={Math.round(load.progress * 100)} className="h-2" />
            <p className="text-muted-foreground truncate text-xs" aria-live="polite">
              {Math.round(load.progress * 100)}% · {load.text}
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs" role="alert">
            {errorMsg}
          </div>
        )}

        {/* ── Playground ─────────────────────────────────────────────────── */}
        {(phase === "live" || phase === "generating") && (
          <div className="space-y-2">
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">
                Playground · <span className="text-violet-500">{loadedLabel}</span> is live in this tab
              </p>
              {tps !== null && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  <Gauge className="mr-1 h-3 w-3" /> {tps.toFixed(1)} tok/s
                </Badge>
              )}
            </div>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Say something to ${loadedLabel}… (runs 100% locally)`}
              rows={2}
              disabled={phase === "generating"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
            <div className="flex gap-2">
              {phase === "generating" ? (
                <Button size="sm" variant="destructive" onClick={handleStop}>
                  <Square className="h-3.5 w-3.5" /> Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleGenerate}
                  disabled={!prompt.trim()}
                  className="bg-violet-600 text-white hover:bg-violet-700"
                >
                  <SendHorizontal className="h-3.5 w-3.5" /> Send
                </Button>
              )}
            </div>
            {output && (
              <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
                {output}
                {phase === "generating" && <span className="bg-violet-500 ml-0.5 inline-block h-3 w-1.5 animate-pulse" aria-hidden />}
              </div>
            )}
          </div>
        )}

        <Separator />

        {/* ── HF Spaces field examples ───────────────────────────────────── */}
        <HfExamples gpu={gpu} />
      </CardContent>
    </Card>
  );
}

// ─── HF Spaces gallery (verified live, r15-a research) ───────────────────────
function HfExamples({ gpu }: { gpu: GpuReport | null }) {
  const [tier, setTier] = React.useState<SizeTier | "all">("all");
  const list = React.useMemo(
    () =>
      HF_SPACE_EXAMPLES.filter((ex) => (tier === "all" ? true : sizeTierOf(ex.sizeMB) === tier)),
    [tier],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">
          Field examples — WebGPU on Hugging Face Spaces{" "}
          <a
            className="text-violet-500 hover:underline"
            href="https://huggingface.co/spaces?search=webgpu"
            target="_blank"
            rel="noreferrer"
            aria-label="Search WebGPU spaces on Hugging Face"
          >
            <ExternalLink className="inline h-3 w-3" />
          </a>
        </p>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by weight size">
          {(["all", "tiny", "small", "medium", "large"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tier === t}
              onClick={() => setTier(t)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                tier === t
                  ? "border-violet-500/50 bg-violet-500/15 text-violet-600 dark:text-violet-300"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {t === "all" ? "All" : SIZE_TIER_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {list.map((ex) => {
          const verdict =
            gpu && gpu.supported
              ? ex.sizeMB === 0 || fitsBudget(ex, gpu.budgetMB)
                ? { text: "✓ fits your GPU", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" }
                : { text: "needs more GPU", cls: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300" }
              : null;
          return (
            <a
              key={ex.space}
              href={spaceUrl(ex.space)}
              target="_blank"
              rel="noreferrer"
              className="group hover:border-violet-500/40 hover:bg-muted/40 flex flex-col gap-1.5 rounded-lg border p-3 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium group-hover:underline">{ex.title}</span>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {ex.framework}
                </Badge>
              </div>
              <p className="text-muted-foreground line-clamp-2 text-[11px]">{ex.blurb}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px]">{ex.org}</Badge>
                {ex.sizeMB > 0 && (
                  <Badge variant="outline" className="font-mono text-[10px]">{fmtMB(ex.sizeMB)}</Badge>
                )}
                {verdict && (
                  <Badge variant="outline" className={`text-[10px] ${verdict.cls}`}>{verdict.text}</Badge>
                )}
              </div>
              <p className="text-muted-foreground line-clamp-1 text-[10px] italic">Pattern: {ex.pattern}</p>
            </a>
          );
        })}
      </div>
      <p className="text-muted-foreground text-[10px]">
        Curated &amp; verified live (research 15-a) · WebLLM prebuilts:{" "}
        <a className="text-violet-500 hover:underline" href={WEBLLM_REPO_URL} target="_blank" rel="noreferrer">
          mlc-ai/web-llm
        </a>{" "}
        · <BadgeCheck className="inline h-3 w-3 text-violet-500" /> nothing here phones home — inference is on-device.
      </p>
    </div>
  );
}
