// ─── Free Frontier Provider Registry ─────────────────────────────────────────
// Curated catalog of LLM providers with genuinely free tiers (verified against
// freellm.sh, live OpenRouter /api/v1/models and official vendor docs, Sept 2026).
// This registry is a CLIENT-SIDE convenience layer: it stores nothing itself —
// keys live in the settings store (localStorage) and are sent only to the
// provider the user picked, only when they chat. No telemetry, ever.

export interface ProviderModel {
  id: string;
  label: string;
  note?: string;
}

export interface FreeProvider {
  id: string;
  name: string;
  glyph: string;
  tagline: string;
  /** OpenAI-compatible base URL. "{ACCOUNT_ID}" is replaced for Cloudflare. */
  baseUrl: string;
  /** Expected key prefix hint shown in the key input placeholder. */
  keyPrefix?: string;
  signupUrl: string;
  docsUrl?: string;
  /** True when the free tier requires a payment method on file. */
  cardRequired?: boolean;
  /** True when the provider works with NO key at all. */
  noKey?: boolean;
  /** True when the endpoint URL embeds an account id (Cloudflare). */
  needsAccountId?: boolean;
  /** Show in the featured row of the gallery. */
  featured?: boolean;
  /** Human summary of the free-tier rate limits. */
  limits: string;
  /** 3-4 concrete steps from zero to a working key. */
  guide: string[];
  models: ProviderModel[];
  /** Providers whose free catalog rotates — fetched live via /api/providers/free-models. */
  liveCatalog?: "openrouter";
}

export const FREE_PROVIDERS: FreeProvider[] = [
  {
    id: "groq",
    name: "Groq",
    glyph: "⚡",
    tagline: "Ludicrous-speed open-weight models (GPT-OSS, Qwen). The default BYOK pick.",
    baseUrl: "https://api.groq.com/openai/v1",
    keyPrefix: "gsk_",
    signupUrl: "https://console.groq.com/keys",
    docsUrl: "https://console.groq.com/docs",
    featured: true,
    limits: "Free: ~30 RPM · 1,000 req/day · 8K tokens/min on the big models",
    guide: [
      "Open console.groq.com/keys and sign up (Google or email, ~2 minutes).",
      "Click “Create API Key” and copy it — it starts with gsk_.",
      "Paste it here and hit Validate. That's it.",
    ],
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", note: "OpenAI open-weight · best all-round" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", note: "Fastest frontier-class" },
      { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B", note: "Multilingual" },
      { id: "groq/compound-mini", label: "Groq Compound Mini", note: "Built-in web-grounded system" },
    ],
  },
  {
    id: "google-ai-studio",
    name: "Google AI Studio",
    glyph: "✦",
    tagline: "Gemini models with a generous free tier — great for vision + long context.",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    keyPrefix: "AIza",
    signupUrl: "https://aistudio.google.com/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    featured: true,
    limits: "Free: ~10-15 RPM · 100-1,000 req/day per model (resets midnight PT)",
    guide: [
      "Open aistudio.google.com/apikey and sign in with a Google account.",
      "“Create API key” — starts with AIza. No credit card needed.",
      "Paste it here. Note: free-tier data may be used by Google for training.",
    ],
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "Fast + vision + 1M ctx" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", note: "Highest free quota" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "Strongest · tiny free quota" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", note: "Newest generation" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    glyph: "⇌",
    tagline: "One key → dozens of rotating :free models from NVIDIA, Google, Cohere and more.",
    baseUrl: "https://openrouter.ai/api/v1",
    keyPrefix: "sk-or-v1-",
    signupUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs",
    featured: true,
    liveCatalog: "openrouter",
    limits: "Free: 50 req/day (1,000/day forever after a one-time $10 top-up) · 20 RPM",
    guide: [
      "Open openrouter.ai/keys, sign up (email or GitHub) — no card needed for free use.",
      "Create a key — starts with sk-or-v1-.",
      "Use the “Refresh live :free catalog” button below — the free roster rotates weekly.",
    ],
    models: [
      { id: "nvidia/nemotron-3.5-lightning:free", label: "Nemotron 3.5 Lightning", note: "1M ctx · NVIDIA" },
      { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B", note: "Google open model" },
      { id: "inclusionai/ling-3.0-flash-vl:free", label: "Ling 3.0 Flash VL", note: "Vision-language" },
      { id: "cohere/north-mini-code:free", label: "North Mini Code", note: "Coding-focused" },
      { id: "liquid/lfm-2.5-2.6b:free", label: "LFM 2.5 2.6B", note: "Tiny + fast" },
    ],
  },
  {
    id: "mistral",
    name: "Mistral La Plateforme",
    glyph: "🜚",
    tagline: "Whole catalog on the free “Experiment” plan — Codestral included.",
    baseUrl: "https://api.mistral.ai/v1",
    signupUrl: "https://console.mistral.ai",
    docsUrl: "https://docs.mistral.ai",
    limits: "Free Experiment plan: ~1 req/s, low priority (can queue at peak)",
    guide: [
      "Open console.mistral.ai and sign up (no card required).",
      "Accept the Experiment (free) plan when asked during onboarding.",
      "API Keys → create one (32-char string, no prefix).",
    ],
    models: [
      { id: "mistral-small-latest", label: "Mistral Small", note: "Best free default" },
      { id: "mistral-medium-latest", label: "Mistral Medium", note: "Stronger, still free" },
      { id: "codestral-latest", label: "Codestral", note: "Code specialist" },
      { id: "devstral-latest", label: "Devstral", note: "Agentic coding" },
    ],
  },
  {
    id: "zai",
    name: "Z.ai GLM Flash",
    glyph: "◉",
    tagline: "GLM-4.5/4.7 Flash are literally $0 on the public pricing page. Stealth gem.",
    baseUrl: "https://api.z.ai/api/paas/v4",
    signupUrl: "https://z.ai",
    docsUrl: "https://docs.z.ai",
    limits: "Free: unlimited-ish on Flash models · RPM unpublished",
    guide: [
      "Open z.ai and register an account.",
      "Go to the API console and create a key.",
      "Pick GLM-4.7-Flash or GLM-4.5-Flash below — both are $0.",
    ],
    models: [
      { id: "glm-4.7-flash", label: "GLM 4.7 Flash", note: "$0 · newest" },
      { id: "glm-4.5-flash", label: "GLM 4.5 Flash", note: "$0 · proven" },
    ],
  },
  {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    glyph: "🟩",
    tagline: "100+ hosted open models with 1,000 free API credits at signup.",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyPrefix: "nvapi-",
    signupUrl: "https://build.nvidia.com",
    docsUrl: "https://docs.api.nvidia.com",
    limits: "Free: ~1,000 credits (1 credit ≈ 1 call, not per token) · 40 RPM",
    guide: [
      "Open build.nvidia.com and join the (free) NVIDIA developer program.",
      "Pick any model page → “Get API Key” — starts with nvapi-.",
      "Credits are per CALL — avoid very long prompts to stretch them.",
    ],
    models: [
      { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B", note: "Meta flagship" },
      { id: "deepseek-ai/deepseek-r1", label: "DeepSeek R1", note: "Reasoning" },
      { id: "qwen/qwen2.5-coder-32b-instruct", label: "Qwen2.5 Coder 32B", note: "Code" },
      { id: "nvidia/llama-3.3-nemotron-super-49b-v1", label: "Nemotron Super 49B", note: "NVIDIA-tuned" },
    ],
  },
  {
    id: "sambanova",
    name: "SambaNova Cloud",
    glyph: "🔻",
    tagline: "Fast DeepSeek/Llama distills — free while no payment method is on file.",
    baseUrl: "https://api.sambanova.ai/v1",
    signupUrl: "https://cloud.sambanova.ai",
    docsUrl: "https://docs.sambanova.ai",
    limits: "Free tier: per-model RPM/RPD tables (~10-20 RPM) · stays free without a card",
    guide: [
      "Open cloud.sambanova.ai and sign up.",
      "Create an API key in the dashboard.",
      "Don't add a payment method — the free tier persists while none is on file.",
    ],
    models: [
      { id: "Meta-Llama-3.3-70B-Instruct", label: "Llama 3.3 70B", note: "Flagship" },
      { id: "DeepSeek-R1-Distill-Llama-70B", label: "DeepSeek R1 Distill 70B", note: "Reasoning" },
      { id: "Qwen3-32B", label: "Qwen3 32B", note: "Multilingual" },
    ],
  },
  {
    id: "cohere",
    name: "Cohere",
    glyph: "◍",
    tagline: "Command-A/R7b + Aya multilingual on a free trial key.",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    signupUrl: "https://dashboard.cohere.com/api-keys",
    docsUrl: "https://docs.cohere.com",
    limits: "Trial key: ~1,000 calls/month · 20 RPM — not for production",
    guide: [
      "Open dashboard.cohere.com/api-keys and register.",
      "Create a “trial” key (40-char string, no prefix).",
      "The OpenAI-compatible endpoint is pre-configured for you here.",
    ],
    models: [
      { id: "command-a-02-2025", label: "Command A", note: "Flagship" },
      { id: "command-r7b-12-2024", label: "Command R7b", note: "Fast + cheap" },
      { id: "aya-expanse-8b", label: "Aya Expanse 8B", note: "Multilingual" },
    ],
  },
  {
    id: "together",
    name: "Together AI",
    glyph: "◇",
    tagline: "Rotating “-Free” serverless endpoints (Llama 3.3 70B, R1 distills).",
    baseUrl: "https://api.together.xyz/v1",
    signupUrl: "https://api.together.ai",
    docsUrl: "https://docs.together.ai",
    limits: "Free endpoints are rate-limited (unpublished) and rotate periodically",
    guide: [
      "Open api.together.ai and sign up (no card for the free endpoints).",
      "Create an API key (64-hex string).",
      "Pick any model ending in “-Free” below.",
    ],
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", label: "Llama 3.3 70B Turbo", note: "Free endpoint" },
      { id: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-Free", label: "R1 Distill 70B", note: "Reasoning · free" },
    ],
  },
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    glyph: "☁",
    tagline: "~80 models behind 10,000 free “Neurons”/day. Needs your account id.",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1",
    keyPrefix: "cf-",
    signupUrl: "https://dash.cloudflare.com/profile/api-tokens",
    docsUrl: "https://developers.cloudflare.com/workers-ai/",
    needsAccountId: true,
    limits: "Free: 10,000 Neurons/day (a 70B chat ≈ 1-2K neurons) — light use",
    guide: [
      "In the Cloudflare dashboard create an API token (Workers AI edit permission).",
      "Copy your Account ID (dashboard home → right column).",
      "Paste BOTH below — the account id is spliced into the endpoint URL.",
    ],
    models: [
      { id: "@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B", note: "OpenAI open-weight" },
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B Fast", note: "fp8" },
      { id: "@cf/qwen/qwen2.5-coder-32b-instruct", label: "Qwen2.5 Coder 32B", note: "Code" },
    ],
  },
  {
    id: "pollinations",
    name: "Pollinations",
    glyph: "✿",
    tagline: "Zero signup, zero key — anonymous free tier. Perfect for a first test drive.",
    baseUrl: "https://text.pollinations.ai/openai",
    noKey: true,
    signupUrl: "https://pollinations.ai",
    limits: "Anonymous tier, rate-limited, “free forever” per freellm.sh — expect occasional queueing",
    guide: [
      "Nothing to register — just press “Use” and start chatting.",
      "Rate limits are stricter than keyed providers; consider Groq for heavy use.",
    ],
    models: [{ id: "openai-fast", label: "OpenAI Fast", note: "gpt-oss-20b class" }],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    glyph: "🧠",
    tagline: "Wafer-scale speed — but the trial needs a card ($5 credit / 30 days).",
    baseUrl: "https://api.cerebras.ai/v1",
    keyPrefix: "csk-",
    signupUrl: "https://cloud.cerebras.ai",
    cardRequired: true,
    limits: "Trial: $5 credits · 30 days · requires a verified payment method",
    guide: [
      "Open cloud.cerebras.ai and create an account.",
      "Add a payment method to activate the trial (card required — flagged honestly).",
      "Create a key — starts with csk-. Models run at extreme tokens/sec.",
    ],
    models: [
      { id: "gpt-oss-120b", label: "GPT-OSS 120B", note: "Fastest inference anywhere" },
      { id: "qwen-3.8-27b", label: "Qwen 3.8 27B", note: "Multilingual" },
    ],
  },
];

export function providerById(id: string | undefined): FreeProvider | undefined {
  if (!id) return undefined;
  return FREE_PROVIDERS.find((p) => p.id === id);
}

/** Resolve the endpoint URL, splicing the account id for Cloudflare-style providers. */
export function providerBaseUrl(p: FreeProvider, accountId?: string): string {
  if (!p.needsAccountId) return p.baseUrl;
  return p.baseUrl.replace("{ACCOUNT_ID}", (accountId ?? "").trim() || "YOUR_ACCOUNT_ID");
}

/** freellm.sh — the live community index this registry is curated against. */
export const FREELLM_SH_URL = "https://freellm.sh/?sort=newest#models";
