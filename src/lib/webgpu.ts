// ─── WebGPU capability detection + local model catalog ──────────────────────
// Detects the user's GPU via WebGPU (adapter.info) with a WebGL2 fallback for
// the human-readable renderer string, classifies a rough VRAM budget, and
// matches prebuilt WebLLM / transformers.js models that fit.

export interface GpuReport {
  /** navigator.gpu exists AND an adapter was granted. */
  supported: boolean;
  /** Secure context (WebGPU requires https or localhost). */
  secure: boolean;
  vendor: string;
  architecture: string;
  description: string;
  /** Software fallback adapter — very slow, warn the user. */
  isFallbackAdapter: boolean;
  /** shader-f16 → q4f16 weights allowed (half the memory of fp32 paths). */
  shaderF16: boolean;
  features: string[];
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  /** WebGL2 UNMASKED_RENDERER_WEBGL string (e.g. "NVIDIA GeForce RTX 3060"). */
  glRenderer: string;
  /** navigator.deviceMemory (approximate, bucketed by Chrome: max 8). */
  deviceMemoryGB: number;
  /** navigator.hardwareConcurrency. */
  cores: number;
  /** Rough VRAM budget for model selection, in MB. 0 when unsupported. */
  budgetMB: number;
  tier: "none" | "tiny" | "small" | "medium" | "large";
  error?: string;
}

export type LocalEngine = "web-llm" | "transformers.js";

export interface LocalModelOption {
  /** WebLLM prebuilt model id (mlc-ai) or HF repo id (transformers.js). */
  id: string;
  label: string;
  params: string;
  engine: LocalEngine;
  /** VRAM required in MB (WebLLM prebuilt config values). */
  vramMB: number;
  note: string;
  /** True for q4f16/q0f16 weights — requires the adapter's shader-f16 feature. */
  requiresF16?: boolean;
  /** r501: December-2025 generation (Qwen3.5, Ministral-3-2512) — badge in UI. */
  fresh?: boolean;
}

// r501 refresh — generated from the INSTALLED @mlc-ai/web-llm (0.2.85)
// prebuiltAppConfig.model_list (163 entries): every vramMB below is the
// package's own vram_required_MB, so nothing here can 404 on load. The old
// list predated Qwen3.5 and the Mistral 2512 trio entirely.
// HONESTY NOTE (owner's MTP/DFLASH question): in-browser engines can only
// stream MLC-compiled weights (q4f16 IS the quantization here). Trending HF
// repos shipping GGUF/MTP/DFLASH/MLX variants (LFM2.5, Dory, Mellum, Kolibri)
// are llama.cpp / vLLM server formats — they cannot load in this panel; see
// docs/research/hf-hub-capabilities-r501.md for the server-side paths.
export const LOCAL_MODELS: LocalModelOption[] = [
  { id: "Qwen3.5-9B-q4f16_1-MLC", label: "Qwen3.5 9B", params: "9B", engine: "web-llm", vramMB: 6433, note: "Newest-gen flagship · 9B class", requiresF16: true, fresh: true },
  { id: "Qwen3.5-4B-q4f16_1-MLC", label: "Qwen3.5 4B", params: "4B", engine: "web-llm", vramMB: 3868, note: "Newest gen · hybrid reasoning", requiresF16: true, fresh: true },
  { id: "Qwen3.5-2B-q4f16_1-MLC", label: "Qwen3.5 2B", params: "2B", engine: "web-llm", vramMB: 2245, note: "Newest gen · mid-small", requiresF16: true, fresh: true },
  { id: "Qwen3.5-0.8B-q4f16_1-MLC", label: "Qwen3.5 0.8B", params: "0.8B", engine: "web-llm", vramMB: 1629, note: "Newest gen · tiny", requiresF16: true, fresh: true },
  { id: "Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC", label: "Ministral 3 3B (Dec-25)", params: "3B", engine: "web-llm", vramMB: 2864, note: "Mistral 2512 instruct · BF16 distill", requiresF16: true, fresh: true },
  { id: "Ministral-3-3B-Reasoning-2512-q4f16_1-MLC", label: "Ministral 3 3B Reasoning", params: "3B", engine: "web-llm", vramMB: 2864, note: "Mistral 2512 reasoning variant", requiresF16: true, fresh: true },
  { id: "Qwen3-8B-q4f16_1-MLC", label: "Qwen3 8B", params: "8B", engine: "web-llm", vramMB: 5696, note: "Thinking-capable", requiresF16: true },
  { id: "Qwen3-4B-q4f16_1-MLC", label: "Qwen3 4B", params: "4B", engine: "web-llm", vramMB: 3432, note: "Thinking-capable", requiresF16: true },
  { id: "Qwen3-1.7B-q4f16_1-MLC", label: "Qwen3 1.7B", params: "1.7B", engine: "web-llm", vramMB: 2037, note: "Thinking-capable", requiresF16: true },
  { id: "Qwen3-0.6B-q4f16_1-MLC", label: "Qwen3 0.6B", params: "0.6B", engine: "web-llm", vramMB: 1403, note: "Thinking-capable", requiresF16: true },
  { id: "Phi-4-mini-instruct-q4f16_1-MLC", label: "Phi-4-mini 3.8B", params: "3.8B", engine: "web-llm", vramMB: 3438, note: "Microsoft", requiresF16: true },
  { id: "DeepSeek-R1-Distill-Qwen-7B-q4f16_1-MLC", label: "R1 Distill Qwen 7B", params: "7B", engine: "web-llm", vramMB: 5107, note: "Local reasoning", requiresF16: true },
  { id: "Llama-3.1-8B-Instruct-q4f16_1-MLC-1k", label: "Llama 3.1 8B (1k)", params: "8B", engine: "web-llm", vramMB: 4598, note: "Meta · low-VRAM 1k ctx build", requiresF16: true },
  { id: "Llama-3.2-3B-Instruct-q4f16_1-MLC", label: "Llama 3.2 3B", params: "3B", engine: "web-llm", vramMB: 2264, note: "Solid quality", requiresF16: true },
  { id: "Llama-3.2-1B-Instruct-q4f16_1-MLC", label: "Llama 3.2 1B", params: "1B", engine: "web-llm", vramMB: 879, note: "4K ctx", requiresF16: true },
  { id: "Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC", label: "Qwen2.5 Coder 7B", params: "7B", engine: "web-llm", vramMB: 5107, note: "In-browser coding", requiresF16: true },
  { id: "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC", label: "Qwen2.5 Coder 3B", params: "3B", engine: "web-llm", vramMB: 2505, note: "In-browser coding", requiresF16: true },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen2.5 3B", params: "3B", engine: "web-llm", vramMB: 2505, note: "Balanced", requiresF16: true },
  { id: "Mistral-7B-Instruct-v0.3-q4f16_1-MLC", label: "Mistral 7B v0.3", params: "7B", engine: "web-llm", vramMB: 4573, note: "Classic", requiresF16: true },
  { id: "gemma-2-9b-it-q4f16_1-MLC", label: "Gemma 2 9B", params: "9B", engine: "web-llm", vramMB: 6422, note: "Google instruct", requiresF16: true },
  { id: "gemma3-1b-it-q4f16_1-MLC", label: "Gemma 3 1B", params: "1B", engine: "web-llm", vramMB: 711, note: "Punchy", requiresF16: true },
  { id: "OLMo-2-0425-1B-Instruct-q4f16_1-MLC", label: "OLMo 2 1B", params: "1B", engine: "web-llm", vramMB: 1777, note: "Fully open (Ai2)", requiresF16: true },
  { id: "SmolLM2-1.7B-Instruct-q4f16_1-MLC", label: "SmolLM2 1.7B", params: "1.7B", engine: "web-llm", vramMB: 1774, note: "Strong for size", requiresF16: true },
  { id: "SmolLM2-360M-Instruct-q4f16_1-MLC", label: "SmolLM2 360M", params: "360M", engine: "web-llm", vramMB: 376, note: "Best tiny chat", requiresF16: true },
  { id: "SmolLM2-135M-Instruct-q0f16-MLC", label: "SmolLM2 135M", params: "135M", engine: "web-llm", vramMB: 360, note: "Buttery on anything", requiresF16: true },
  // transformers.js fallback rows (verified live on the Hub, r501):
  // Qwen3-0.6B-ONNX and LFM2-350M-ONNX are real onnx-community repos (200),
  // so weak/no-WebGPU devices get a CURRENT model, not just 2024-era ONNX.
  { id: "onnx-community/LFM2-350M-ONNX", label: "LFM2 350M (ONNX)", params: "350M", engine: "transformers.js", vramMB: 400, note: "Liquid AI · WebGPU or CPU/WASM" },
  { id: "onnx-community/Qwen3-0.6B-ONNX", label: "Qwen3 0.6B (ONNX)", params: "0.6B", engine: "transformers.js", vramMB: 900, note: "Thinking-capable · CPU fallback" },
  { id: "onnx-community/Qwen2.5-0.5B-Instruct", label: "Qwen2.5 0.5B (ONNX)", params: "0.5B", engine: "transformers.js", vramMB: 500, note: "WebGPU or CPU/WASM" },
  { id: "HuggingFaceTB/SmolLM2-135M-Instruct", label: "SmolLM2 135M (ONNX)", params: "135M", engine: "transformers.js", vramMB: 150, note: "Runs even without WebGPU" },
];

/** Detect the GPU. Cheap, permission-free; safe to call on mount. */
export async function detectGpu(): Promise<GpuReport> {
  const base: GpuReport = {
    supported: false,
    secure: typeof window !== "undefined" && window.isSecureContext,
    vendor: "",
    architecture: "",
    description: "",
    isFallbackAdapter: false,
    shaderF16: false,
    features: [],
    maxBufferSize: 0,
    maxStorageBufferBindingSize: 0,
    glRenderer: "",
    deviceMemoryGB: (navigator as { deviceMemory?: number }).deviceMemory ?? 0,
    cores: navigator.hardwareConcurrency ?? 0,
    budgetMB: 0,
    tier: "none",
  };

  // WebGL2 renderer string — the most human-readable GPU name available.
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") as WebGL2RenderingContext | null;
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      if (ext) {
        base.glRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? "");
      } else {
        base.glRenderer = String(gl.getParameter(gl.RENDERER) ?? "");
      }
    }
  } catch {
    /* ignore */
  }

  const nav = navigator as Navigator & { gpu?: MinGPU };
  if (!nav.gpu || !base.secure) {
    classifyBudget(base);
    return base;
  }

  try {
    const adapter = (await nav.gpu.requestAdapter?.({ powerPreference: "high-performance" })) ?? null;
    if (!adapter) {
      classifyBudget(base);
      return base;
    }
    // adapter.info is synchronous since Chrome 131 (requestAdapterInfo removed);
    // fall back to the async API for older builds, then to nothing.
    let info: MinGPUAdapterInfo | undefined = adapter.info;
    if (!info && adapter.requestAdapterInfo) {
      try {
        info = await adapter.requestAdapterInfo();
      } catch {
        info = undefined;
      }
    }
    base.supported = true;
    base.vendor = info?.vendor ?? "";
    base.architecture = info?.architecture ?? "";
    base.description = info?.description ?? "";
    base.isFallbackAdapter = Boolean(info?.isFallbackAdapter);
    base.features = adapter.features ? [...adapter.features] : [];
    base.shaderF16 = !!adapter.features?.has("shader-f16");
    base.maxBufferSize = Number(adapter.limits?.maxBufferSize ?? 0);
    base.maxStorageBufferBindingSize = Number(adapter.limits?.maxStorageBufferBindingSize ?? 0);
    classifyBudget(base);
    return base;
  } catch (err) {
    base.error = err instanceof Error ? err.message : "Adapter request failed";
    classifyBudget(base);
    return base;
  }
}

/**
 * Rough VRAM budget heuristic. WebGPU exposes no real VRAM number, so we combine:
 *  - maxBufferSize (default 256MB → integrated; raised to ≥2-4GB → discrete)
 *  - shader-f16 (modern GPU signal — enables the smallest q4f16 weights)
 *  - WebGL renderer string heuristics + navigator.deviceMemory
 * The budget deliberately stays conservative (~60% of estimated usable memory)
 * to leave headroom for KV cache + the rest of the page.
 */
function classifyBudget(r: GpuReport): void {
  if (!r.supported) {
    r.tier = "none";
    r.budgetMB = 0;
    return;
  }
  const gl = r.glRenderer.toLowerCase();
  const strongGpu =
    /rtx [3-5]0\d\d|radeon (rx [6-9]|rx 7)|arc a[3-7]|apple m[1-4]( pro|max)/.test(gl) ||
    /geforce (gtx 16|rtx)/.test(gl);
  const ramGB = r.deviceMemoryGB || 4;

  let budget = 600; // pessimistic floor for a working iGPU
  if (r.shaderF16) budget = 1400;
  if (r.maxBufferSize >= 2 * 1024 ** 3) budget = 2400;
  if (r.maxBufferSize >= 4 * 1024 ** 3 && r.shaderF16) budget = 3800;
  if (strongGpu && r.shaderF16) budget = 6000;
  if (r.isFallbackAdapter) budget = 400;
  // Devices with little RAM can't give the GPU much either.
  if (ramGB <= 4) budget = Math.min(budget, 1600);
  if (ramGB <= 2) budget = Math.min(budget, 800);

  r.budgetMB = budget;
  r.tier = budget >= 6000 ? "large" : budget >= 3000 ? "medium" : budget >= 1400 ? "small" : "tiny";
}

/** Models that fit the detected budget, best utilization first.
 *  WebGPU field convention (IBM Granite / webml-community pattern): q4f16
 *  weights are hard-gated on the adapter's shader-f16 feature — devices
 *  without it get q4f32 / CPU-friendly variants instead of a broken load. */
export function suggestModels(report: GpuReport): LocalModelOption[] {
  if (!report.supported) {
    // No WebGPU → only the transformers.js CPU/WASM paths make sense.
    return LOCAL_MODELS.filter((m) => m.engine === "transformers.js");
  }
  return LOCAL_MODELS.filter(
    (m) =>
      m.vramMB <= report.budgetMB &&
      (!m.requiresF16 || report.shaderF16)
  ).sort((a, b) => b.vramMB - a.vramMB);
}

export function fmtMB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export const WEBLLM_REPO_URL = "https://github.com/mlc-ai/web-llm";
export const HF_WEBGPU_GUIDE_URL = "https://huggingface.co/docs/transformers.js/en/guides/webgpu";

// ─── Minimal WebGPU structural types (TS DOM lib doesn't ship them yet) ─────
interface MinGPUAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
}
interface MinGPUSupportedLimits {
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
}
interface MinGPUAdapter {
  features?: Set<string>;
  limits?: MinGPUSupportedLimits;
  info?: MinGPUAdapterInfo;
  requestAdapterInfo?: () => Promise<MinGPUAdapterInfo>;
}
interface MinGPU {
  requestAdapter?: (options?: {
    powerPreference?: "high-performance" | "low-power";
    forceFallbackAdapter?: boolean;
  }) => Promise<MinGPUAdapter | null>;
}
