"use client";

// ─── Local models panel (WebGPU) ─────────────────────────────────────────────
// GPU auto-detect → budget-matched WebLLM catalog → real in-browser playground
// (streaming, tok/s, interrupt, cache management) + HF Spaces field examples.
// Rebuilt against the surviving lib interfaces (webgpu.ts · hf-spaces.ts).

import * as React from "react";
import {
  BadgeCheck,
  CircleStop,
  Cpu,
  Eraser,
  ExternalLink,
  Gauge,
  HardDrive,
  Loader2,
  MemoryStick,
  Microchip,
  Play,
  Send,
  Trash2,
  TriangleAlert,
  Zap,
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
import {
  detectGpu,
  fmtMB,
  HF_WEBGPU_GUIDE_URL,
  LOCAL_MODELS,
  suggestModels,
  WEBLLM_REPO_URL,
  type GpuReport,
  type LocalModelOption,
} from "@/lib/webgpu";
import {
  fitsBudget,
  HF_SPACE_EXAMPLES,
  HF_WEBGPU_SEARCH_URL,
  SIZE_TIER_LABEL,
  spaceUrl,
  sizeTierOf,
  type SizeTier,
} from "@/lib/hf-spaces";
import { cn } from "@/lib/utils";

const LAST_MODEL_KEY = "praison-local-model";
const TRANSCRIPT_CAP = 30; // kept in UI
const CONTEXT_CAP = 12; // sent to the engine

interface PlayMsg {
  role: "user" | "assistant";
  content: string;
}

type PanelStatus =
  | "idle"
  | "loading"
  | "warmup"
  | "ready"
  | "generating"
  | "error";

const TIER_STYLE: Record<GpuReport["tier"], string> = {
  large: "border-emerald-500/50 bg-emerald-500/15 text-emerald-400",
  medium: "border-violet-500/50 bg-violet-500/15 text-violet-300",
  small: "border-amber-500/50 bg-amber-500/15 text-amber-300",
  tiny: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  none: "border-border bg-muted text-muted-foreground",
};

const SIZE_FILTERS: Array<SizeTier | "all"> = [
  "all",
  "tiny",
  "small",
  "medium",
  "large",
];

export function LocalModelsPanel() {
  // ── GPU detection ──────────────────────────────────────────────────────
  const [gpu, setGpu] = React.useState<GpuReport | null>(null);
  const [probeError, setProbeError] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const [cacheHits, setCacheHits] = React.useState<Set<string>>(new Set());

  // ── Engine / playground state ──────────────────────────────────────────
  const engineRef = React.useRef<Awaited<
    ReturnType<typeof import("@mlc-ai/web-llm").CreateMLCEngine>
  > | null>(null);
  const loadRunIdRef = React.useRef(0); // supersedes in-flight loads
  const runIdRef = React.useRef(0); // drops stream chunks after stop

  const [status, setStatus] = React.useState<PanelStatus>("idle");
  const [loadedModel, setLoadedModel] = React.useState<LocalModelOption | null>(
    null
  );
  const [loadProgress, setLoadProgress] = React.useState(0);
  const [loadLabel, setLoadLabel] = React.useState("");
  const [transcript, setTranscript] = React.useState<PlayMsg[]>([]);
  const [draft, setDraft] = React.useState("");
  const [toksPerSec, setToksPerSec] = React.useState<number | null>(null);
  const [errorText, setErrorText] = React.useState<string | null>(null);

  // ── HF Spaces gallery filter ───────────────────────────────────────────
  const [sizeFilter, setSizeFilter] = React.useState<SizeTier | "all">("all");

  const detectRef = React.useRef(false);
  React.useEffect(() => {
    if (detectRef.current) return;
    detectRef.current = true;
    let alive = true;
    (async () => {
      try {
        const report = await detectGpu();
        if (!alive) return;
        setGpu(report);
        if (report.error) setProbeError(report.error);
      } catch (err) {
        if (alive)
          setProbeError(
            err instanceof Error ? err.message : "GPU probe failed"
          );
      }
    })();
    // Cache probe deferred — the heavy web-llm chunk must not race hydration.
    const t = setTimeout(() => {
      (async () => {
        try {
          const webllm = await import("@mlc-ai/web-llm");
          const hits = new Set<string>();
          await Promise.all(
            LOCAL_MODELS.filter((m) => m.engine === "web-llm").map(
              async (m) => {
                try {
                  if (await webllm.hasModelInCache(m.id)) hits.add(m.id);
                } catch {
                  /* cache API unavailable — ignore */
                }
              }
            )
          );
          if (alive) setCacheHits(hits);
        } catch {
          /* ignore */
        }
      })();
    }, 1200);
    // Restore last-selected model label (hydration-safe: effect only).
    try {
      const saved = localStorage.getItem(LAST_MODEL_KEY);
      if (saved) {
        const m = LOCAL_MODELS.find((x) => x.id === saved);
        if (m) setLoadedModel(m); // label only; engine reloads on demand
      }
    } catch {
      /* ignore */
    }
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  // Release the GPU when the panel unmounts.
  React.useEffect(() => {
    return () => {
      loadRunIdRef.current += 1;
      runIdRef.current += 1;
      const engine = engineRef.current;
      engineRef.current = null;
      if (engine) {
        engine
          .unload()
          .catch(() => undefined);
      }
    };
  }, []);

  const suggestions = React.useMemo(
    () => (gpu ? suggestModels(gpu) : []),
    [gpu]
  );
  const aboveBudget = React.useMemo(() => {
    if (!gpu) return [];
    const fit = new Set(suggestions.map((m) => m.id));
    return LOCAL_MODELS.filter((m) => !fit.has(m.id));
  }, [gpu, suggestions]);

  // ── Load / unload ──────────────────────────────────────────────────────
  async function loadModel(model: LocalModelOption) {
    if (model.engine !== "web-llm") {
      window.open(`https://huggingface.co/${model.id}`, "_blank", "noopener");
      return;
    }
    const runId = ++loadRunIdRef.current;
    setErrorText(null);
    setToksPerSec(null);
    setLoadProgress(0);
    setLoadLabel("Initializing engine…");
    setStatus("loading");
    try {
      const webllm = await import("@mlc-ai/web-llm");
      const engine = await webllm.CreateMLCEngine(model.id, {
        initProgressCallback: (p) => {
          if (loadRunIdRef.current !== runId) return;
          setLoadProgress(Math.round((p.progress ?? 0) * 100));
          setLoadLabel(p.text ?? "Fetching weights…");
        },
      });
      if (loadRunIdRef.current !== runId) {
        // Superseded by another load/unload — quietly free the loser.
        try {
          await engine.unload();
        } catch {
          /* ignore */
        }
        return;
      }
      // 1-token warmup — compiles shaders so the first real reply isn't slow.
      setStatus("warmup");
      setLoadLabel("Compiling shaders · warming up…");
      await engine.chat.completions.create({
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
        stream: false,
      });
      if (loadRunIdRef.current !== runId) {
        try {
          await engine.unload();
        } catch {
          /* ignore */
        }
        return;
      }
      engineRef.current = engine;
      setLoadedModel(model);
      try {
        localStorage.setItem(LAST_MODEL_KEY, model.id);
      } catch {
        /* ignore */
      }
      setStatus("ready");
      setLoadProgress(100);
      toast.success(`${model.label} ready`, {
        description: "Running fully on your GPU — nothing leaves the browser.",
      });
    } catch (err) {
      if (loadRunIdRef.current !== runId) return;
      const msg = err instanceof Error ? err.message : "Model load failed";
      setErrorText(msg);
      setStatus("error");
      toast.error("Model load failed", { description: msg });
    }
  }

  async function unloadModel() {
    loadRunIdRef.current += 1;
    runIdRef.current += 1;
    const engine = engineRef.current;
    engineRef.current = null;
    setStatus("idle");
    setLoadedModel(null);
    setLoadProgress(0);
    setLoadLabel("");
    setToksPerSec(null);
    try {
      localStorage.removeItem(LAST_MODEL_KEY);
    } catch {
      /* ignore */
    }
    if (engine) {
      try {
        await engine.unload();
      } catch {
        /* ignore */
      }
    }
  }

  async function deleteCached(modelId: string) {
    try {
      const webllm = await import("@mlc-ai/web-llm");
      await webllm.deleteModelInCache(modelId);
      setCacheHits((prev) => {
        const next = new Set(prev);
        next.delete(modelId);
        return next;
      });
      toast.success("Cached weights deleted", { description: modelId });
    } catch {
      toast.error("Could not delete cached weights");
    }
  }

  // ── Playground generation ──────────────────────────────────────────────
  async function generate() {
    const engine = engineRef.current;
    const text = draft.trim();
    if (!engine || !text || status === "generating") return;
    const runId = ++runIdRef.current;

    const history = [...transcript, { role: "user" as const, content: text }];
    setTranscript([
      ...history.slice(-TRANSCRIPT_CAP),
      { role: "assistant", content: "" },
    ]);
    setDraft("");
    setStatus("generating");

    const t0 = performance.now();
    let firstTok: number | null = null;
    let tokCount = 0;
    try {
      const stream = await engine.chat.completions.create({
        messages: [
          ...history.slice(-CONTEXT_CAP).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        ],
        stream: true,
        max_tokens: 1024,
      });
      for await (const chunk of stream) {
        if (runIdRef.current !== runId) return; // stopped / superseded
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (!delta) continue;
        if (firstTok === null) firstTok = performance.now();
        tokCount += 1;
        setTranscript((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + delta };
          }
          return next;
        });
      }
      if (runIdRef.current !== runId) return;
      if (firstTok !== null && tokCount > 1) {
        const secs = (performance.now() - firstTok) / 1000;
        if (secs > 0) setToksPerSec(tokCount / secs);
      }
      setStatus("ready");
    } catch (err) {
      if (runIdRef.current !== runId) return;
      const msg = err instanceof Error ? err.message : "Generation failed";
      setErrorText(msg);
      setStatus("error");
    }
  }

  function stopGenerate() {
    runIdRef.current += 1;
    try {
      engineRef.current?.interruptGenerate();
    } catch {
      /* ignore */
    }
    setStatus("ready");
  }

  async function clearChat() {
    runIdRef.current += 1;
    setTranscript([]);
    setToksPerSec(null);
    try {
      await engineRef.current?.resetChat();
    } catch {
      /* ignore */
    }
  }

  // ── Derived UI flags ───────────────────────────────────────────────────
  const busy = status === "loading" || status === "warmup";
  const engineActive = status === "ready" || status === "generating";
  const playgroundVisible = engineActive || status === "error" || transcript.length > 0;

  return (
    <div className="space-y-4" data-testid="local-models-panel">
      {/* ── GPU capability card ─────────────────────────────────────────── */}
      <Card className="gap-4">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              <Microchip className="h-4 w-4 text-violet-400" aria-hidden />
              Local models · WebGPU
            </CardTitle>
            {gpu && (
              <Badge variant="outline" className={cn("text-[10px] uppercase", TIER_STYLE[gpu.tier])}>
                {gpu.tier === "none" ? "no WebGPU" : `${gpu.tier} tier`}
              </Badge>
            )}
          </div>
          <CardDescription>
            Run small LLMs entirely in this browser tab — weights stream once,
            then chat with zero servers.{" "}
            <a
              href={WEBLLM_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 hover:underline"
            >
              WebLLM
            </a>{" "}
            ·{" "}
            <a
              href={HF_WEBGPU_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 hover:underline"
            >
              transformers.js guide
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Detecting */}
          {!gpu && !probeError && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Detecting GPU…
            </div>
          )}
          {probeError && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              GPU probe failed: {probeError}. Showing the catalog anyway —
              loads will tell you if your device can&apos;t run them.
            </p>
          )}

          {/* GPU report chips */}
          {gpu?.supported && (
            <div className="flex flex-wrap gap-1.5" data-testid="gpu-report">
              {gpu.glRenderer && (
                <Badge variant="outline" className="max-w-full gap-1 truncate font-normal">
                  <Microchip className="h-3 w-3 shrink-0 text-violet-400" aria-hidden />
                  <span className="truncate">{gpu.glRenderer}</span>
                </Badge>
              )}
              <Badge variant="outline" className="gap-1 font-normal">
                <HardDrive className="h-3 w-3 text-violet-400" aria-hidden />
                budget ~{fmtMB(gpu.budgetMB)}
              </Badge>
              {gpu.deviceMemoryGB > 0 && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <MemoryStick className="h-3 w-3 text-violet-400" aria-hidden />
                  {gpu.deviceMemoryGB} GB RAM
                </Badge>
              )}
              {gpu.cores > 0 && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Cpu className="h-3 w-3 text-violet-400" aria-hidden />
                  {gpu.cores} cores
                </Badge>
              )}
              {gpu.maxBufferSize > 0 && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Gauge className="h-3 w-3 text-violet-400" aria-hidden />
                  max buffer {fmtMB(gpu.maxBufferSize / 1024 / 1024)}
                </Badge>
              )}
              {gpu.shaderF16 && (
                <Badge variant="outline" className="gap-1 border-emerald-500/40 font-normal text-emerald-400">
                  <Zap className="h-3 w-3" aria-hidden />
                  shader-f16
                </Badge>
              )}
            </div>
          )}

          {/* Honest explainers (field conventions: Granite-style gating notes) */}
          {gpu && !gpu.secure && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              WebGPU needs a secure context (https or localhost). The list below
              still shows CPU-friendly fallbacks.
            </p>
          )}
          {gpu && gpu.secure && !gpu.supported && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              No WebGPU adapter on this device (or the browser blocks it). Only
              the WASM/CPU transformers.js models are offered — WebLLM loads
              would fail here.
            </p>
          )}
          {gpu?.isFallbackAdapter && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              This is a software-fallback adapter (SwiftShader). It reports
              WebGPU support but real inference will be extremely slow.
            </p>
          )}
          {gpu?.supported && !gpu.shaderF16 && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Your adapter lacks the <code className="mx-1">shader-f16</code>
              feature, so half-precision (q4f16) weights are hidden. The
              q4f32 / ONNX variants below are the safe paths.
            </p>
          )}

          {/* ── Model list ──────────────────────────────────────────────── */}
          {gpu && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  {suggestions.length} model{suggestions.length === 1 ? "" : "s"} fit
                  your budget
                  {cacheHits.size > 0 && ` · ${cacheHits.size} cached`}
                </p>
              </div>
              <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-violet-500/30">
                {suggestions.map((m) => (
                  <ModelRow
                    key={m.id}
                    model={m}
                    fits
                    cached={cacheHits.has(m.id)}
                    loaded={loadedModel?.id === m.id && engineActive}
                    busy={busy && loadedModel?.id === m.id}
                    onLoad={() => loadModel(m)}
                    onDeleteCache={() => deleteCached(m.id)}
                  />
                ))}
                {showAll &&
                  aboveBudget.map((m) => (
                    <ModelRow
                      key={m.id}
                      model={m}
                      fits={false}
                      cached={cacheHits.has(m.id)}
                      loaded={loadedModel?.id === m.id && engineActive}
                      busy={busy && loadedModel?.id === m.id}
                      onLoad={() => loadModel(m)}
                      onDeleteCache={() => deleteCached(m.id)}
                    />
                  ))}
              </div>
              {aboveBudget.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll
                    ? "Hide above-budget models"
                    : `Show ${aboveBudget.length} above budget`}
                </Button>
              )}
            </div>
          )}

          {/* Load progress */}
          {busy && (
            <div className="space-y-1.5 rounded-lg border p-3" data-testid="load-progress">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" aria-hidden />
                  {loadLabel || "Loading…"}
                </span>
                <span className="font-mono tabular-nums">{loadProgress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-violet-500 transition-all duration-300"
                  style={{ width: `${loadProgress}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Playground ──────────────────────────────────────────────────── */}
      {playgroundVisible && (
        <Card className="gap-4">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Play className="h-4 w-4 text-violet-400" aria-hidden />
                Local playground
              </CardTitle>
              <div className="flex items-center gap-1.5">
                {loadedModel && (
                  <Badge variant="outline" className="font-normal">
                    {loadedModel.label}
                  </Badge>
                )}
                {toksPerSec !== null && (
                  <Badge variant="outline" className="gap-1 border-emerald-500/40 font-mono text-[10px] text-emerald-400">
                    <Zap className="h-3 w-3" aria-hidden />
                    {toksPerSec.toFixed(1)} tok/s
                  </Badge>
                )}
                {loadedModel && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground"
                    onClick={unloadModel}
                  >
                    Unload
                  </Button>
                )}
              </div>
            </div>
            {loadedModel && (
              <CardDescription>
                {loadedModel.note} · {loadedModel.params} params ·{" "}
                {fmtMB(loadedModel.vramMB)} VRAM — nothing is sent anywhere.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {status === "error" && errorText && (
              <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {errorText}
              </p>
            )}
            {transcript.length > 0 ? (
              <div className="max-h-96 space-y-2.5 overflow-y-auto rounded-lg border bg-muted/20 p-3 pr-1 scrollbar-thin scrollbar-thumb-violet-500/30">
                {transcript.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed",
                      m.role === "user"
                        ? "ml-auto bg-violet-500/15 text-foreground"
                        : "bg-background text-foreground"
                    )}
                  >
                    {m.content || (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        thinking…
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              engineActive && (
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Model loaded. Say hello — every token is generated on your GPU.
                </p>
              )
            )}
            <div className="flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    generate();
                  }
                }}
                placeholder={
                  engineActive ? "Message the local model…" : "Load a model first"
                }
                disabled={!engineActive}
                aria-label="Message the local model"
                className="h-9"
              />
              {status === "generating" ? (
                <Button type="button" size="sm" variant="outline" onClick={stopGenerate}>
                  <CircleStop className="h-4 w-4" aria-hidden />
                  Stop
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={generate}
                  disabled={!engineActive || !draft.trim()}
                >
                  <Send className="h-4 w-4" aria-hidden />
                  Send
                </Button>
              )}
              {transcript.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={clearChat}
                  aria-label="Clear transcript"
                >
                  <Eraser className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── HF Spaces field examples ────────────────────────────────────── */}
      <Card className="gap-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <BadgeCheck className="h-4 w-4 text-violet-400" aria-hidden />
            Field examples · WebGPU on Hugging Face Spaces
          </CardTitle>
          <CardDescription>
            Live spaces verified against the HF API — each one is a reference
            implementation for a pattern used above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            role="radiogroup"
            aria-label="Filter examples by size tier"
            className="flex flex-wrap gap-1.5"
          >
            {SIZE_FILTERS.map((f) => {
              const active = sizeFilter === f;
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSizeFilter(f)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all",
                    active
                      ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                      : "border-border bg-muted/30 text-muted-foreground hover:border-violet-500/40 hover:text-foreground"
                  )}
                >
                  {f === "all" ? "All" : SIZE_TIER_LABEL[f]}
                </button>
              );
            })}
            <a
              href={HF_WEBGPU_SEARCH_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-violet-400 hover:underline"
            >
              search HF
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-violet-500/30">
            {HF_SPACE_EXAMPLES.filter(
              (ex) => sizeFilter === "all" || sizeTierOf(ex.sizeMB) === sizeFilter
            ).map((ex) => {
              const fits = gpu ? fitsBudget(ex, gpu.budgetMB) : null;
              return (
                <a
                  key={ex.space}
                  href={spaceUrl(ex.space)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border p-3 transition-colors hover:border-violet-500/40 hover:bg-muted/40"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{ex.title}</span>
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {ex.org}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {ex.framework}
                    </Badge>
                    {ex.sizeMB > 0 && (
                      <Badge variant="outline" className="font-mono text-[10px] font-normal">
                        {fmtMB(ex.sizeMB)}
                      </Badge>
                    )}
                    {fits === true && (
                      <Badge className="border-emerald-500/40 bg-emerald-500/15 text-[10px] font-normal text-emerald-400" variant="outline">
                        ✓ fits your GPU
                      </Badge>
                    )}
                    {fits === false && (
                      <Badge className="border-amber-500/40 bg-amber-500/15 text-[10px] font-normal text-amber-300" variant="outline">
                        needs more GPU
                      </Badge>
                    )}
                    {fits === null && ex.sizeMB > 0 && (
                      <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                        size only
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {ex.blurb}
                  </p>
                  <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-violet-300/80">
                    pattern: {ex.pattern}
                  </p>
                </a>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── One catalog row ─────────────────────────────────────────────────────────
function ModelRow({
  model,
  fits,
  cached,
  loaded,
  busy,
  onLoad,
  onDeleteCache,
}: {
  model: LocalModelOption;
  fits: boolean;
  cached: boolean;
  loaded: boolean;
  busy: boolean;
  onLoad: () => void;
  onDeleteCache: () => void;
}) {
  const isTransformers = model.engine === "transformers.js";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors",
        fits ? "border-border" : "border-dashed border-border/60 opacity-60",
        loaded && "border-violet-500/50 bg-violet-500/5"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-xs font-medium">{model.label}</span>
          <Badge variant="outline" className="font-mono text-[10px] font-normal">
            {model.params}
          </Badge>
          {model.requiresF16 && (
            <Badge variant="outline" className="text-[10px] font-normal text-violet-300">
              f16
            </Badge>
          )}
          {cached && (
            <Badge
              variant="outline"
              className="gap-0.5 border-emerald-500/40 text-[10px] font-normal text-emerald-400"
              title="Weights already downloaded in this browser"
            >
              <HardDrive className="h-2.5 w-2.5" aria-hidden />
              cached
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
            {isTransformers ? "transformers.js" : "WebLLM"}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {model.note} · {fmtMB(model.vramMB)} VRAM{!fits && " — above your budget"}
        </p>
      </div>
      {isTransformers ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 text-xs"
          onClick={onLoad}
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          HF
        </Button>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          {loaded ? (
            <Badge
              variant="outline"
              className="border-violet-500/50 text-[10px] text-violet-300"
            >
              loaded
            </Badge>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={onLoad}
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                "Load"
              )}
            </Button>
          )}
          {cached && !busy && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground"
              aria-label={`Delete cached weights for ${model.label}`}
              onClick={onDeleteCache}
            >
              <Trash2 className="h-3 w-3" aria-hidden />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
