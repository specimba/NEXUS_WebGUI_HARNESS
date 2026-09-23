import type { Agent, ProviderKeyEntry, Settings, ToolId, UiThemeId } from "./types";

// ─── Branding ────────────────────────────────────────────────────────────────
export const APP_NAME = "PraisonAI";
export const APP_TAGLINE = "Multi-Agent AI Platform";
export const APP_VERSION = "1.0.0";
export const GITHUB_URL = "https://github.com/specimba/PraisonAI";

// ─── Provider defaults ───────────────────────────────────────────────────────
export const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
export const CUSTOM_FALLBACK_MODEL = "llama-3.3-70b-versatile";

// ─── Pre-seeded BYOK keys (r18) ──────────────────────────────────────────────
// Ships working keys so the app chats out-of-the-box. These are merged into the
// vault for EVERY user (persisted user keys always win — we only fill blanks).
// Vyce AI: daily-reward gateway, DeepSeek V4.1 preselected (user-verified).
// Pollinations: keyed tier beats the exhausted anonymous IP pool.
export const PRESEED_PROVIDER_KEYS: Record<string, ProviderKeyEntry> = {
  vyce: {
    key: "sk-5507b79cf0226a14d3d32719ca0bb0f05b159b9c3481c4f3",
    model: "deepseek-v4.1",
  },
  pollinations: {
    key: "sk_6irvUWDd8292cklHVE3qir6dGl6tBPxW",
    model: "openai-fast",
  },
  // AIHubMix (r30): 45 live $0 lanes + frontier at list price; coding GLM 5.3
  // preselected (1M ctx, tools). Free budget: 5 RPM / 100 req / 1M tok per day.
  aihubmix: {
    key: "sk-GlU6TNazMnKBlASg26E36a0d914f4fF88a41F14fD08fFcA0",
    model: "coding-glm-5.3-free",
  },
};

/** localStorage flag so the one-time "Vyce is here" intro toast fires once. */
export const VYCE_INTRO_FLAG = "praison-vyce-intro";

/** localStorage flag for the one-time "AIHubMix joined the vault" intro toast (r30). */
export const AIHUBMIX_INTRO_FLAG = "praison-aihubmix-intro";

export const AUTO_MODEL = {
  id: "auto",
  label: "Auto · built-in GLM",
  note: "Zero config — works instantly, no API key",
} as const;

export interface ModelPreset {
  id: string;
  label: string;
  note: string;
}

/** Curated presets for custom OpenAI-compatible providers (Groq first). */
export const CUSTOM_MODELS: ModelPreset[] = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", note: "Best all-round · Groq" },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", note: "Fastest · Groq" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", note: "OpenAI open-weight · Groq" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", note: "OpenAI open-weight · Groq" },
  { id: "moonshotai/kimi-k2-instruct-0905", label: "Kimi K2 Instruct", note: "Long-context · Groq" },
  { id: "qwen/qwen3-32b", label: "Qwen 3 32B", note: "Multilingual · Groq" },
  { id: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill 70B", note: "Reasoning · Groq" },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B", note: "Latest Meta · Groq" },
];

export function modelLabel(model: string): string {
  if (!model || model === "auto") return AUTO_MODEL.label;
  const preset = CUSTOM_MODELS.find((m) => m.id === model);
  if (preset) return preset.label;
  return model;
}

// ─── Tools ───────────────────────────────────────────────────────────────────
export const TOOL_IDS: ToolId[] = [
  "web_search",
  "read_url",
  "run_code",
  "current_time",
  "arxiv_search",
  "wikipedia_search",
  "hacker_news_search",
  "github_repo_read",
  "package_info",
  "market_rates",
  "uuid_hash",
  "image_generate",
  "tts_speak",
];

export const TOOL_META: Record<ToolId, { label: string; description: string; emoji: string }> = {
  web_search: {
    label: "Web Search",
    description: "Search the web for current, real-world information",
    emoji: "🌐",
  },
  read_url: {
    label: "URL Reader",
    description: "Fetch and read the contents of any web page",
    emoji: "📄",
  },
  run_code: {
    label: "Code Runner",
    description: "Execute JavaScript in a secure sandbox and get the output",
    emoji: "⚡",
  },
  current_time: {
    label: "Clock",
    description: "Get the current date and time",
    emoji: "🕒",
  },
  arxiv_search: {
    label: "arXiv Papers",
    description: "Search arXiv research papers with alphaXiv discussion links",
    emoji: "🧪",
  },
  wikipedia_search: {
    label: "Wikipedia",
    description: "Search Wikipedia for encyclopedic grounding on established facts",
    emoji: "📚",
  },
  hacker_news_search: {
    label: "Hacker News",
    description: "Search Hacker News discussions, launches and community sentiment",
    emoji: "🟠",
  },
  github_repo_read: {
    label: "GitHub Repo",
    description: "Read a GitHub repository's metadata, README and open issues",
    emoji: "🐙",
  },
  package_info: {
    label: "Package Info",
    description: "Look up npm/PyPI package versions, licenses and downloads",
    emoji: "📦",
  },
  market_rates: {
    label: "Market Rates",
    description: "Indicative crypto prices and fiat FX rates (not financial advice)",
    emoji: "📈",
  },
  uuid_hash: {
    label: "UUID & Hash",
    description: "Generate UUIDs, SHA-256/HMAC hashes and random hex in server code",
    emoji: "🔐",
  },
  image_generate: {
    label: "Image Gen",
    description: "Generate an image from a prompt (status line — view in the Image Studio)",
    emoji: "🎨",
  },
  tts_speak: {
    label: "TTS",
    description: "Convert short text to speech with the built-in voices (status line)",
    emoji: "🔊",
  },
};

// ─── Settings ────────────────────────────────────────────────────────────────
export const DEFAULT_TTS_VOICE = "tongtong";

/** Read-aloud playback rates offered in Settings (value stored in settings). */
export const SPEECH_RATES: number[] = [0.75, 1, 1.25, 1.5, 2];

// ─── Workflow schedules ─────────────────────────────────────────────────────
export interface ScheduleIntervalPreset {
  label: string;
  short: string;
  ms: number;
}

export const SCHEDULE_INTERVALS: ScheduleIntervalPreset[] = [
  { label: "Every 5 minutes", short: "5m", ms: 5 * 60_000 },
  { label: "Every 15 minutes", short: "15m", ms: 15 * 60_000 },
  { label: "Every 30 minutes", short: "30m", ms: 30 * 60_000 },
  { label: "Every hour", short: "1h", ms: 60 * 60_000 },
  { label: "Every 6 hours", short: "6h", ms: 6 * 60 * 60_000 },
  { label: "Every day", short: "1d", ms: 24 * 60 * 60_000 },
];

// ─── Accent themes (Fallout / Matrix / Cyberpunk dark variants) ─────────────
export interface UiThemePreset {
  id: UiThemeId;
  label: string;
  tagline: string;
  /** Thumbnail art served from /public/themes. */
  art: string;
}

export const UI_THEMES: UiThemePreset[] = [
  { id: "nexus", label: "Nexus", tagline: "Violet nebula — the classic harness glow", art: "/themes/nexus.jpg" },
  { id: "matrix", label: "Matrix", tagline: "Phosphor green digital rain", art: "/themes/matrix.jpg" },
  { id: "fallout", label: "Fallout", tagline: "Vault amber terminal warmth", art: "/themes/fallout.jpg" },
  { id: "cyber", label: "Cyberpunk", tagline: "Neon magenta & electric cyan", art: "/themes/cyber.jpg" },
];

export const DEFAULT_UI_THEME: UiThemeId = "nexus";

export function uiThemeById(id: string | undefined): UiThemePreset {
  return UI_THEMES.find((t) => t.id === id) ?? UI_THEMES[0];
}

export const DEFAULT_SETTINGS: Settings = {
  // New users land on Vyce (pre-seeded key, DeepSeek V4.1) — the current
  // efficiency-frontier pick. Existing users keep their selection; the vault
  // preseed + a one-time intro toast make the switch one click.
  provider: "custom",
  apiKey: "",
  baseUrl: DEFAULT_BASE_URL,
  defaultModel: CUSTOM_FALLBACK_MODEL,
  temperature: 0.7,
  framework: "sequential",
  displayName: "You",
  voice: DEFAULT_TTS_VOICE,
  speechRate: 1,
  uiTheme: DEFAULT_UI_THEME,
  providerKeys: { ...PRESEED_PROVIDER_KEYS },
  activeProviderId: "vyce",
  relayEnabled: true,
  seeded: false,
};

// ─── Seed agents (first launch) ──────────────────────────────────────────────
export const SEED_AGENTS: Agent[] = [
  {
    id: "a-assistant",
    name: "Praison Assistant",
    emoji: "🤖",
    color: "violet",
    role: "General-purpose AI agent",
    description: "Versatile assistant that can search the web, read pages, run code and tell time.",
    instructions:
      "You are Praison Assistant, a capable, friendly generalist agent. Answer with well-structured markdown. Use your tools whenever real-world data or computation would improve the answer.",
    model: "auto",
    temperature: 0.7,
    maxIterations: 6,
    tools: [
      "web_search",
      "read_url",
      "run_code",
      "current_time",
      "arxiv_search",
      "wikipedia_search",
      "hacker_news_search",
      "github_repo_read",
      "package_info",
      "market_rates",
      "uuid_hash",
    ],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "a-researcher",
    name: "Research Scout",
    emoji: "🔍",
    color: "cyan",
    role: "Web research specialist",
    description: "Finds fresh information online, verifies across sources and cites links.",
    instructions:
      "You are Research Scout, an expert web researcher. For every factual question, use web_search first, then read_url on the most promising pages. Always cite sources as markdown links and clearly separate facts from inference.",
    model: "auto",
    temperature: 0.4,
    maxIterations: 10,
    tools: ["web_search", "read_url", "current_time", "arxiv_search", "wikipedia_search", "hacker_news_search", "github_repo_read", "package_info"],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "a-coder",
    name: "Code Smith",
    emoji: "👨‍💻",
    color: "emerald",
    role: "JavaScript pair programmer",
    description: "Writes code, runs it in the sandbox, and iterates until it works.",
    instructions:
      "You are Code Smith, a pragmatic senior engineer. When asked to solve a computational or algorithmic problem, write JavaScript, verify it with the run_code tool, and iterate on failures. Present the final solution in a fenced code block with a short explanation.",
    model: "auto",
    temperature: 0.3,
    maxIterations: 8,
    tools: ["run_code", "web_search", "package_info", "github_repo_read", "uuid_hash"],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "a-planner",
    name: "Strategic Planner",
    emoji: "🗺️",
    color: "amber",
    role: "Task decomposition expert",
    description: "Breaks complex goals into crisp, ordered execution plans.",
    instructions:
      "You are Strategic Planner. Decompose any goal into a numbered plan with owners, deliverables and success criteria. Be concrete and brief. You do not need tools; rely on reasoning.",
    model: "auto",
    temperature: 0.5,
    maxIterations: 3,
    tools: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "a-writer",
    name: "Tech Writer",
    emoji: "✍️",
    color: "rose",
    role: "Documentation & copy editor",
    description: "Turns rough ideas into clear, polished writing.",
    instructions:
      "You are Tech Writer, a meticulous editor. Produce clean markdown with headings, lists and tables where useful. Prefer active voice, short sentences and zero fluff.",
    model: "auto",
    temperature: 0.6,
    maxIterations: 3,
    tools: [],
    createdAt: 0,
    updatedAt: 0,
  },
];

// ─── Prompt templates ────────────────────────────────────────────────────────
export const AUTO_PLAN_SYSTEM = `You are a workflow architect for a multi-agent AI platform.
Given a task and a list of available agents (JSON), design an ordered pipeline of steps.
Reply with ONLY a JSON array, no markdown fences, no commentary:
[{"label": "short step description", "agentId": "<id from provided agents>", "instruction": "one focused sentence of step-specific guidance"}]
Use between 2 and 5 steps. Each agentId MUST be one of the provided ids. Reuse an agent only if the pipeline truly needs it.
Every step SHOULD carry an instruction: concrete, step-specific guidance (what to produce, what to avoid, quality bar) that will be appended to the agent's system prompt for that step only. Research steps that use web tools should require dated, source-linked findings; writing steps should define format and length.`;

export const MAX_CONTEXT_MESSAGES = 40;
export const MAX_ITERATIONS_DEFAULT = 6;

// ─── Context economy (inspired by mksglu/context-mode) ───────────────────────
/** Soft token budget shown by the composer meter (chars/4 estimate). */
export const CONTEXT_TOKEN_BUDGET = 24_000;

// ─── Review-gate workflow steps (inspired by cft0808/edict, ARIS, AWorld) ────
/** How many times a review gate may send the previous step back for rework. */
export const REWORK_LIMIT = 1;

// ─── Session health (inspired by rcaelers/workrave) ──────────────────────────
/** Cumulative agent-activity time before a break nudge appears. */
export const BREAK_THRESHOLD_MS = 25 * 60_000;
export const BREAK_SNOOZE_MS = 10 * 60_000;
export const SESSION_HEALTH_KEY = "praison-session-health";
export const SESSION_HEALTH_TICK_MS = 5_000;

// ─── Chat file attachments ───────────────────────────────────────────────────
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 128 * 1024; // 128 KB per file (text)
/** Extensions accepted as inline text context (coding / research focus). */
export const TEXT_FILE_EXTENSIONS = [
  "txt", "md", "markdown", "json", "csv", "tsv", "yaml", "yml", "toml", "ini",
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "rb", "go", "rs", "java", "kt",
  "c", "h", "cpp", "hpp", "cs", "php", "swift", "sh", "bash", "zsh", "sql",
  "html", "css", "scss", "less", "vue", "svelte", "xml", "svg", "log", "env",
  "gitignore", "dockerfile", "prisma", "graphql", "gql",
] as const;

export function isTextFileName(name: string): boolean {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (TEXT_FILE_EXTENSIONS as readonly string[]).includes(ext);
}

// ─── Chat image attachments (vision path) ────────────────────────────────────
export const MAX_IMAGE_ATTACHMENTS = 2; // per message — keeps localStorage safe
export const MAX_IMAGE_SOURCE_BYTES = 4 * 1024 * 1024; // 4 MB original file cap
/** Data URLs above this length are re-encoded at a lower JPEG quality. */
export const MAX_IMAGE_DATAURL_CHARS = 600_000;
/** Images are downscaled to fit within this box before being stored/sent. */
export const IMAGE_MAX_DIMENSION = 1024;

export function isImageFileName(name: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(name);
}

// ─── Read-aloud (TTS) ────────────────────────────────────────────────────────
/** Hard cap for one read-aloud request (client truncates + toasts). */
export const MAX_SPEAK_CHARS = 8000;

export interface TtsVoicePreset {
  id: string;
  label: string;
  note: string;
}

export const TTS_VOICES: TtsVoicePreset[] = [
  { id: "tongtong", label: "Tongtong", note: "Warm & friendly" },
  { id: "chuichui", label: "Chuichui", note: "Lively" },
  { id: "xiaochen", label: "Xiaochen", note: "Calm & professional" },
  { id: "jam", label: "Jam", note: "British accent" },
  { id: "kazi", label: "Kazi", note: "Clear & standard" },
  { id: "douji", label: "Douji", note: "Natural & smooth" },
  { id: "luodo", label: "Luodo", note: "Expressive" },
];


// ─── Conversation heartbeat (Hermes-style proactive wake) ───────────────────
export const HEARTBEAT_INTERVALS: { ms: number; label: string }[] = [
  { ms: 5 * 60_000, label: "5 min" },
  { ms: 15 * 60_000, label: "15 min" },
  { ms: 30 * 60_000, label: "30 min" },
  { ms: 60 * 60_000, label: "1 hour" },
];
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15 * 60_000;
/** Heartbeats never fire more often than this, regardless of preset. */
export const HEARTBEAT_MIN_INTERVAL_MS = 60_000;
/** Extra idle quiet-time required after the last message before a beat fires. */
export const HEARTBEAT_IDLE_MS = 30_000;

// ─── Memory folding (Hermes-style consolidation) ─────────────────────────────
/** Auto-consolidate after this many assistant replies since the last pass. */
export const MEMORY_CONSOLIDATE_EVERY = 10;
/** Memory docs are trimmed to roughly this length (chars). */
export const MEMORY_MAX_CHARS = 1200;
/** Messages (most recent first) fed into a consolidation pass. */
export const MEMORY_SOURCE_MESSAGES = 24;

// ─── Reflexion lessons (harness rank-③, r31) ─────────────────────────────────
/** Lessons kept per workflow (oldest-dropped) — budgeted like MEMORY_MAX_CHARS. */
export const MAX_LESSONS = 5;
/** Max chars per lesson — a verbal hint, never a transcript. */
export const LESSON_MAX_CHARS = 300;
/** Lessons injected into a run's first-step context (most recent ones win). */
export const LESSONS_INJECTED = 4;

// ─── Task suite (harness rank-①, r31) ────────────────────────────────────────
/** Result rows kept per suite (aggregates only — never outputs). */
export const SUITE_RESULTS_CAP = 5;
/** Repeats per case offered by the UI (roadmap says n≥3; 1 keeps cost honest). */
export const SUITE_REPEATS_MAX = 3;
/** Pause between suite runs — rate-polite to free providers. */
export const SUITE_GAP_MS = 1_500;

// ─── Conversations storage guard (r31 landmine fix) ──────────────────────────
/** Hard per-conversation message cap; oldest messages are trimmed beyond it. */
export const MAX_MESSAGES_HARD = 120;
/** Attachment payloads are stripped from messages beyond the latest N. */
export const ATTACHMENT_KEEP_RECENT = 12;

// ─── Dreaming-lite (r33, Letta doctrine: idle time consolidates lessons) ─────
/** Runs since the last dream before a consolidation pass becomes due. */
export const DREAM_MIN_RUNS = 4;
/** Minimum gap between dream passes — rate-limits background LLM use. */
export const DREAM_COOLDOWN_MS = 60 * 60_000;
/** Delay after a run settles before the dream check fires (let the UI rest). */
export const DREAM_DELAY_MS = 45_000;
/** Max distilled lessons one dream may add (the run-written ones stay senior). */
export const DREAM_MAX_ADD = 2;
/** Max chars per distilled lesson (dreams are hints, even shorter than run lessons). */
export const DREAM_LESSON_MAX_CHARS = 220;

// ─── Prompt evolution (r35, GEPA doctrine: prompts mutate from feedback) ─────
/** Variants kept per step (authored + evolved, worst-dropped when full). */
export const MAX_PROMPT_VARIANTS = 4;
/** Minimum gap between automatic evolutions of the same step. */
export const EVOLVE_COOLDOWN_MS = 10 * 60_000;
/** Delay after a rework/failure before the evolution pass fires. */
export const EVOLVE_DELAY_MS = 20_000;
/** Max chars for an evolved instruction (a focus hint, never a novel). */
export const VARIANT_INSTRUCTION_MAX_CHARS = 400;
