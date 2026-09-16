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
  liveCatalog?: "openrouter" | "pollinations";
}

export const FREE_PROVIDERS: FreeProvider[] = [
  {
    id: "vyce",
    name: "Vyce AI",
    glyph: "◈",
    tagline:
      "Daily free credits ($10/day, streaks to $30) — DeepSeek V4.1, Claude 4.6 & Agnes 3.0 behind one OpenAI-compatible gateway.",
    baseUrl: "https://vyceai.com/v1",
    keyPrefix: "sk-",
    signupUrl: "https://vyceai.com",
    featured: true,
    limits:
      "Free $10.00 credits every day (resets 00:00 UTC) · key limit 150 RPM · per-1M token pricing from $0.05",
    guide: [
      "Open vyceai.com and sign up — every account gets $10.00 in free credits daily.",
      "Claim the Daily Reward (streaks grow it up to $30/day), then create a key in the API Keys tab — it starts with sk-.",
      "Paste it here — this app talks to https://vyceai.com/v1 (OpenAI-compatible, streaming verified).",
      "DeepSeek V4.1 is preselected — the current efficiency-frontier pick; Claude Sonnet 4.6, V4 Flash and Agnes 3.0 (512K ctx) are one click away.",
      "Bonus endpoints: /v1/messages (Anthropic-style) and /v1/images/generations (Grok Imagine 2, $0.50/img).",
    ],
    models: [
      { id: "deepseek-v4.1", label: "DeepSeek V4.1", note: "Flagship MoE · 270K ctx · tools · $0.15/$0.60 per 1M" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", note: "Ultra-fast · 270K ctx · tools · $0.22/$0.66" },
      { id: "agnes-3.0-flash", label: "Agnes 3.0 Flash", note: "Agentic · 512K ctx · tools · cheapest $0.05/$0.15" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", note: "Frontier coding · 270K ctx · $3/$15" },
      { id: "deepseek-v4-flash-lr", label: "DeepSeek V4 Flash LR", note: "Long-run variant · $0.15/$0.60" },
    ],
  },
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
      { id: "nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra 550B", note: "Flagship MoE · live 2026-09" },
      { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B", note: "Strong + cheaper" },
      { id: "moonshotai/kimi-k3", label: "Kimi K3", note: "Moonshot frontier" },
      { id: "deepseek-ai/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash", note: "Fast reasoning" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", note: "OpenAI open-weight" },
      { id: "nvidia/nemotron-3.5-lightning-30b-a3b", label: "Nemotron 3.5 Lightning 30B", note: "Fastest" },
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
    tagline: "OpenAI-compatible text API with a live model roster — free keys, no card.",
    baseUrl: "https://text.pollinations.ai/openai",
    keyPrefix: "sk_",
    signupUrl: "https://enter.pollinations.ai",
    liveCatalog: "pollinations",
    limits:
      "Anonymous tier shares a global IP budget (usually exhausted) · free keys carry a per-key budget you can raise at enter.pollinations.ai",
    guide: [
      "Keyless anonymous access works from some IPs but shares a global budget — mostly exhausted.",
      "Create a free key at enter.pollinations.ai (starts with sk_) for reliable keyed access.",
      "If a chat replies with a “key budget” notice, raise the budget on your key's page, then retry.",
      "The online roster is small right now (GPT-OSS 20B, reasoning + tools) — “Refresh live catalog” pulls what's up.",
    ],
    models: [{ id: "openai-fast", label: "OpenAI Fast", note: "GPT-OSS 20B · reasoning + tools · online now" }],
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

// ─── Model catalog helpers (shared by gallery / wizard / agent editor) ──────
// One source of truth for "what are the selectable models for provider X":
// curated registry models merged with the persisted live :free catalog, each
// tagged with a status badge. Keeps every picker consistent and fixes the
// "saved live model invisible in curated-only lists" bug class.

export interface LiveModel {
  id: string;
  label?: string;
  contextLength?: number;
}

export type LiveCatalog = Record<string, LiveModel[]>;

export const LIVE_CATALOG_KEY = "praison-free-catalog";

export function loadLiveCatalog(): LiveCatalog {
  try {
    const raw = localStorage.getItem(LIVE_CATALOG_KEY);
    return raw ? (JSON.parse(raw) as LiveCatalog) : {};
  } catch {
    return {};
  }
}

export interface CatalogModelOption {
  id: string;
  label: string;
  note?: string;
  badge?: string;
  badgeTone?: "violet" | "emerald" | "amber" | "muted";
}

/**
 * Merged model options for one provider: curated models first ("curated"),
 * then live-catalog extras ("live", violet), then — if the currently saved
 * value matches none of them — the saved id itself ("saved", amber) so a
 * stale/removed model stays visible and re-selectable instead of blanking
 * the picker.
 */
export function providerModelOptions(
  p: FreeProvider,
  live?: LiveCatalog
): CatalogModelOption[] {
  const base: CatalogModelOption[] = p.models.map((m) => ({
    id: m.id,
    label: m.label,
    note: m.note ?? m.id,
    badge: "curated",
    badgeTone: "muted",
  }));
  const extra = (live?.[p.liveCatalog ?? ""] ?? []).filter((m) => !base.some((b) => b.id === m.id));
  for (const m of extra) {
    base.push({
      id: m.id,
      label: m.label || m.id,
      note: m.contextLength ? `${m.id} · ${Math.round(m.contextLength / 1000)}K ctx` : m.id,
      badge: "live",
      badgeTone: "violet",
    });
  }
  return base;
}

/** Append the saved value as a visible option when it's missing from the list. */
export function withSavedOption(
  options: CatalogModelOption[],
  savedId: string | undefined
): CatalogModelOption[] {
  if (!savedId || options.some((o) => o.id === savedId)) return options;
  return [...options, { id: savedId, label: savedId, note: "previously saved", badge: "saved", badgeTone: "amber" }];
}
