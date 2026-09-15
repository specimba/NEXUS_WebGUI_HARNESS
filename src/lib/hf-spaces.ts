// ─── HF Spaces · WebGPU field examples ───────────────────────────────────────
// Curated live Hugging Face Spaces that demonstrate real in-browser model
// inference — verified against the HF Spaces API (research round 15-a, Sept
// 2026). Dead IDs excluded (llama-v2-webgpu, phi-3-webgpu, Jan-nano, paligemma
// all 404'd). Sizes are field-measured weight footprints.

export interface HfSpaceExample {
  /** Full space id, e.g. "webml-community/deepseek-r1-webgpu". */
  space: string;
  title: string;
  org: string;
  model: string;
  framework: "transformers.js" | "WebLLM";
  /** Approximate downloaded weight size in MB. */
  sizeMB: number;
  /** One-line what-it-does blurb (shown in-app). */
  blurb: string;
  /** The integration pattern this space is the reference for. */
  pattern: string;
}

export const HF_SPACE_EXAMPLES: HfSpaceExample[] = [
  {
    space: "webml-community/deepseek-r1-webgpu",
    title: "DeepSeek-R1 WebGPU",
    org: "webml-community",
    model: "DeepSeek-R1-Distill-Qwen-1.5B (q4f16)",
    framework: "transformers.js",
    sizeMB: 1126,
    blurb: "The canonical in-browser reasoning chat — streams its <think> phase, ~1.1GB one-time download.",
    pattern: "Worker-thread inference · check→load→generate protocol · per-file progress · full-screen no-WebGPU fallback",
  },
  {
    space: "Xenova/realtime-whisper-webgpu",
    title: "Real-time Whisper WebGPU",
    org: "Xenova",
    model: "whisper-base",
    framework: "transformers.js",
    sizeMB: 80,
    blurb: "Live speech-to-text, token-by-token, entirely on your GPU — a worker thread keeps the UI at 60fps.",
    pattern: "Realtime streaming ASR in a worker — proof tiny models run continuously without jank",
  },
  {
    space: "Xenova/whisper-web",
    title: "Whisper Web",
    org: "Xenova",
    model: "whisper tiny→medium + distil",
    framework: "transformers.js",
    sizeMB: 750,
    blurb: "Best model-variant selector UX: model dropdown × quantized toggle, with graceful WASM fallback.",
    pattern: "Manual variant/quantization choice · per-file progress bars · `no_attentions` revision to dodge OOM",
  },
  {
    space: "webml-community/smolvlm-realtime-webgpu",
    title: "SmolVLM Realtime WebGPU",
    org: "webml-community",
    model: "SmolVLM-500M-Instruct",
    framework: "transformers.js",
    sizeMB: 500,
    blurb: "Point your webcam, get answers every second — a 500M vision-language model with mixed-precision weights.",
    pattern: "Per-module dtype map {embed: fp16, vision: q4} · inline warning when WebGPU is missing",
  },
  {
    space: "apple/fastvlm-webgpu",
    title: "FastVLM WebGPU",
    org: "apple",
    model: "FastVLM-0.5B-ONNX",
    framework: "transformers.js",
    sizeMB: 550,
    blurb: "Apple's official realtime video captioning — clean state machine and a “model already loaded” cache guard.",
    pattern: "Context state machine · cache-hit fast path · 50ms frame pacing",
  },
  {
    space: "webml-community/kokoro-webgpu",
    title: "Kokoro WebGPU (TTS)",
    org: "webml-community",
    model: "Kokoro-82M-ONNX",
    framework: "transformers.js",
    sizeMB: 100,
    blurb: "82M-param text-to-speech streaming natural audio in-browser — proof WebGPU isn't just for chat.",
    pattern: "Tiny-scale non-LLM WebGPU workload",
  },
  {
    space: "ibm-granite/Granite-4.0-WebGPU",
    title: "Granite 4.0 WebGPU",
    org: "ibm-granite",
    model: "granite-4.0-micro (3B, q4f16)",
    framework: "transformers.js",
    sizeMB: 2000,
    blurb: "IBM's 3B enterprise model with the field's strictest capability check — the best gating example.",
    pattern: "Hard shader-f16 gate in the worker's check() · explicit “compiling shaders” warmup step",
  },
  {
    space: "mistralai/Voxtral-Realtime-WebGPU",
    title: "Voxtral Realtime WebGPU",
    org: "mistralai",
    model: "Voxtral-Mini-4B-Realtime-ONNX",
    framework: "transformers.js",
    sizeMB: 2400,
    blurb: "Mistral's 4B realtime voice model: mic → transcript entirely in the browser via AudioWorklet.",
    pattern: "Strict idle→loading→ready/error status machine · audio cleanup on unmount · per-file progress ÷ known count",
  },
  {
    space: "webml-community/GPT-OSS-WebGPU",
    title: "GPT-OSS WebGPU",
    org: "webml-community × OpenAI",
    model: "gpt-oss-20b (q4f16)",
    framework: "transformers.js",
    sizeMB: 12355,
    blurb: "OpenAI's 20B model quantized to 12.6GB, running in a browser tab. Discrete GPU + patience required.",
    pattern: "Progress against a known TOTAL_FILE_SIZE · Harmony stream parser splitting reasoning vs final channels",
  },
  {
    space: "mlc-ai/webllm-playground",
    title: "WebLLM Playground",
    org: "mlc-ai",
    model: "dozens of MLC prebuilts",
    framework: "WebLLM",
    sizeMB: 0,
    blurb: "The official WebLLM demo — switch between prebuilt models, each labeled with its VRAM cost.",
    pattern: "Hot model switch via reload() · VRAM labels + low-resource tags · cache management",
  },
  {
    space: "cfahlgren1/webllm-playground",
    title: "Community WebLLM Playground",
    org: "cfahlgren1",
    model: "Llama / Qwen / SmolLM",
    framework: "WebLLM",
    sizeMB: 0,
    blurb: "The best community WebLLM UX: multi-model switcher with per-model VRAM hints and download progress.",
    pattern: "initProgressCallback → per-model download progress · engine unload between models",
  },
  {
    space: "LiquidAI/LFM2.5-2.6B-WebGPU",
    title: "LFM2.5 Edge Research Agent",
    org: "LiquidAI",
    model: "LFM2.5-2.6B-ONNX",
    framework: "transformers.js",
    sizeMB: 1600,
    blurb: "A vendor-official agentic research assistant that runs fully on-device — mid-size agent-grade model.",
    pattern: "Agentic loop on-device · clean TS source mirrored on GitHub",
  },
];

export function spaceUrl(id: string): string {
  return `https://huggingface.co/spaces/${id}`;
}

export const HF_WEBGPU_SEARCH_URL =
  "https://huggingface.co/spaces?search=webgpu";

/** Tier buckets consistent with our GpuReport tiers (by weight size). */
export type SizeTier = "tiny" | "small" | "medium" | "large";

export function sizeTierOf(sizeMB: number): SizeTier {
  if (sizeMB <= 300) return "tiny";
  if (sizeMB <= 1500) return "small";
  if (sizeMB <= 3000) return "medium";
  return "large";
}

/** Whether an example fits the detected GPU budget (0-size = any model picker). */
export function fitsBudget(ex: HfSpaceExample, budgetMB: number): boolean {
  if (ex.sizeMB === 0) return true;
  return ex.sizeMB <= budgetMB;
}

export const SIZE_TIER_LABEL: Record<SizeTier, string> = {
  tiny: "Tiny ≤300MB",
  small: "Small ≤1.5GB",
  medium: "Medium ≤3GB",
  large: "Large 3GB+",
};
