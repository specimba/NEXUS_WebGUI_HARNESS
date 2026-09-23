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
  /**
   * Live catalog key — when set, the roster can be refreshed at runtime via
   * /api/providers/free-models (GET for keyless rotating catalogs, POST with
   * the vault key for key-authed /models). The value doubles as the key into
   * the persisted LiveCatalog map; it is the provider id for every provider.
   */
  liveCatalog?: string;
  /** Optional account-info endpoint (relative to baseUrl) for a credits widget, e.g. "/v1/me". */
  mePath?: string;
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
    // r28: signup link carries the platform's public referral code (referee
    // gets $50 instead of the base $10/day — see src/lib/referral-registry.ts).
    signupUrl: "https://vyceai.com/signup?ref=VYCE_8ZYQDC",
    featured: true,
    limits:
      "Free $10.00 credits every day (resets 00:00 UTC) · key limit 150 RPM · per-1M token pricing from $0.05",
    guide: [
      "Open vyceai.com and sign up — every account gets $10.00 in free credits daily. Sign up through our referral link and you start with $50 in credits instead.",
      "Claim the Daily Reward (streaks grow it up to $30/day), then create a key in the API Keys tab — it starts with sk-.",
      "Paste it here — this app talks to https://vyceai.com/v1 (OpenAI-compatible, streaming verified).",
      "DeepSeek V4.1 is preselected — the current efficiency-frontier pick; Qwen 3.8 Flash (1M ctx), Claude Sonnet 4.6, V4 Flash and Agnes 3.0 (512K ctx) are one click away.",
      "Bonus endpoints: /v1/messages (Anthropic-style) and /v1/images/generations (Grok Imagine 2, $0.50/img).",
    ],
    liveCatalog: "vyce",
    models: [
      { id: "deepseek-v4.1", label: "DeepSeek V4.1", note: "Flagship MoE · 270K ctx · tools · $0.15/$0.60 per 1M" },
      { id: "qwen3.8-flash", label: "Qwen 3.8 Flash", note: "Alibaba Cloud · 1M ctx · tools · $0.10/$0.40 — ultra-fast flagship" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", note: "Ultra-fast · 270K ctx · tools · $0.22/$0.66" },
      { id: "agnes-3.0-flash", label: "Agnes 3.0 Flash", note: "Agentic · 512K ctx · tools · cheapest $0.05/$0.15" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", note: "Frontier coding · 270K ctx · $3/$15" },
      { id: "deepseek-v4-flash-lr", label: "DeepSeek V4 Flash LR", note: "Long-run variant · $0.15/$0.60" },
    ],
    mePath: "/v1/me",
  },
  {
    id: "aihubmix",
    name: "AIHubMix",
    glyph: "⬢",
    tagline:
      "One OpenAI-compatible gateway over 850+ models — 45 live $0 lanes (GLM/Kimi/Nemotron/MiMo coding bots) plus frontier Claude 5, GPT-5.6, Gemini 3.6, Grok 4.5 at list price.",
    baseUrl: "https://aihubmix.com/v1",
    keyPrefix: "sk-",
    signupUrl: "https://aihubmix.com/models",
    docsUrl: "https://docs.aihubmix.com/en/api/llm-router",
    featured: true,
    limits:
      "Free lanes: 5 RPM · 100 req/day · 1M tokens/day per account (heavy models eat quota faster via weight_map) · frontier pay-as-you-go from $0.142/1M (DeepSeek V4 Flash) · backup base: api.inferera.com/v1",
    guide: [
      "Create a key at console.aihubmix.com (starts with sk-) — free models work before any payment method; fresh accounts get 10 trial calls pre-top-up.",
      "Paste it here — the app talks to https://aihubmix.com/v1 (vanilla OpenAI wire, streaming + tools verified). Backup domain: https://api.inferera.com/v1.",
      "coding-glm-5.3-free is preselected: 1M ctx, thinking + tool-calling, $0. Hit Refresh models to pull the live roster (45 free lanes right now).",
      "Free-lane budget is per account: 5 req/min, 100 req/day, 1M tokens/day — heavier models consume 2-10 quota units per call (weight_map). Expect routine 429s on popular ids; the relay rotates.",
      "Frontier one click away: claude-sonnet-5 ($2/$10), gpt-5.6-luna ($0.20/$1.20), gemini-3.6-flash ($1.50/$7.50), grok-4.5 ($2/$6). model 'auto' = the platform's LLM Router picks per request and bills at the resolved model.",
    ],
    liveCatalog: "aihubmix",
    models: [
      { id: "coding-glm-5.3-free", label: "GLM 5.3 Coding (Free)", note: "1M ctx · thinking + tools + structured · $0" },
      { id: "coding-kimi-k3-free", label: "Kimi K3 Coding (Free)", note: "1M ctx · thinking + tools · image/video in · $0" },
      { id: "coding-glm-5.2-free", label: "GLM 5.2 Coding (Free)", note: "1M ctx · tools · $0" },
      { id: "coding-minimax-m3-free", label: "MiniMax M3 Coding (Free)", note: "1M ctx · $0" },
      { id: "xiaomi-mimo-v2.6-pro-free", label: "MiMo V2.6 Pro (Free)", note: "1M ctx · omni-in (text/image/audio/video) · $0" },
      { id: "nemotron-3-ultra-550b-a55b-free", label: "Nemotron 3 Ultra 550B (Free)", note: "550B MoE (55B active) · 1M ctx · frontier reasoning · $0" },
      { id: "nemotron-3.5-lightning-free", label: "Nemotron 3.5 Lightning (Free)", note: "30B MoE (3B active) · 1M ctx · high-throughput · $0" },
      { id: "hy3-free", label: "Hunyuan Hy3 (Free)", note: "295B MoE (21B active) · 256K ctx · 3 thinking modes · $0" },
      { id: "auto", label: "AIHubMix Router (auto)", note: "Platform auto-router · auto:balanced/quality_first/latency_critical · bills at resolved model" },
      // r34: explicit LLM Router policies (advisory doc, verified pasted docs).
      // The resolved model comes back in the body + x-aihubmix-router-* headers
      // and is shown as a router receipt chip on the reply.
      { id: "auto:quality_first", label: "Router · Quality first", note: "LLM Router picks the most capable model per request" },
      { id: "auto:balanced", label: "Router · Balanced", note: "LLM Router weighs capability / cost / latency" },
      { id: "auto:latency_critical", label: "Router · Latency critical", note: "LLM Router prefers the fastest responding model" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "Frontier workhorse · 1M ctx · $2/$10" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", note: "OpenAI fast flagship · 1.05M ctx · $0.20/$1.20" },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", note: "Google current-gen · 1M ctx · thinking + tools · $1.50/$7.50" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", note: "Budget frontier · 1M ctx · $0.142/$0.284" },
      { id: "glm-5.3-flash", label: "GLM 5.3 Flash", note: "Z.ai fast lane · 1M ctx · $0.11/$0.39" },
    ],
  },
  {
    // r32: the user called it "OpenCore" — the platform is OpenCode Zen
    // (opencode.ai/zen). Live-verified 2026-09-23: GET /zen/v1/models answers
    // 200 keyless with 80 lanes — the ENTIRE frontier (claude-fable-5,
    // opus-5-5, gpt-6-astra/sol/luna, gemini-3.8, grok-4.7) plus a standing
    // -free lane family (nemotron-3-ultra-free, mimo-v2.6-flash-free,
    // deepseek-v4-flash-free, jev-1.13-free, space-bunny-free, …).
    id: "opencode",
    name: "OpenCode Zen",
    glyph: "◮",
    tagline:
      "The open coding-agent gateway that freed the frontier: Claude Fable 5, GPT-6 Astra, Gemini 3.8, Grok 4.7 — plus standing free lanes (Nemotron 3 Ultra 550B, MiMo V2.6 Flash) behind one OpenAI-compatible endpoint.",
    baseUrl: "https://opencode.ai/zen/v1",
    signupUrl: "https://opencode.ai/zen",
    docsUrl: "https://opencode.ai/docs/zen",
    featured: true,
    limits:
      "Free lanes (-free suffix): rate-capped, included with a free account key · frontier lanes metered per-token, often below list · roster refreshes live (80 lanes right now)",
    guide: [
      "Open opencode.ai/zen and create an account — the key is issued from the dashboard (no card needed for the -free lanes).",
      "Paste it here — the app talks to https://opencode.ai/zen/v1 (vanilla OpenAI wire, streaming + tools).",
      "nemotron-3-ultra-free is preselected: a 550B-A55B frontier MoE on a standing free lane. mimo-v2.6-flash-free, deepseek-v4-flash-free, jev-1.13-free and space-bunny-free are one click away.",
      "The whole frontier is on the same key — claude-fable-5, gpt-6-astra, gemini-3.8-flash, grok-4.7 — hit Refresh models to pull all 80 live lanes.",
    ],
    liveCatalog: "opencode",
    models: [
      { id: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra (Free)", note: "550B MoE (55B active) · standing free lane" },
      { id: "mimo-v2.6-flash-free", label: "MiMo V2.6 Flash (Free)", note: "Xiaomi omnimodal · 1M ctx · free lane" },
      { id: "deepseek-v4-flash-free", label: "DeepSeek V4 Flash (Free)", note: "Fast reasoning · free lane" },
      { id: "jev-1.13-free", label: "Jev 1.13 (Free)", note: "Standing free lane" },
      { id: "space-bunny-free", label: "Space Bunny (Free)", note: "Standing free lane" },
      { id: "nemotron-3.5-lightning-free", label: "Nemotron 3.5 Lightning (Free)", note: "Fast MoE · free lane" },
      { id: "claude-fable-5", label: "Claude Fable 5", note: "Frontier apex · on the same key" },
      { id: "gpt-6-astra", label: "GPT-6 Astra", note: "OpenAI flagship · on the same key" },
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Google current-gen" },
      { id: "grok-4.7", label: "Grok 4.7", note: "xAI frontier" },
    ],
  },
  {
    // r32: Kilo Gateway (kilo.ai — the KiloCode rebrand). Live-verified
    // 2026-09-23: GET /api/gateway/v1/models answers 200 KEYLESS with 393
    // OpenRouter-shaped lanes (id/created/pricing/context_length/isFree) —
    // kilo-auto/free rotates free models with no credits required.
    id: "kilo",
    name: "Kilo Gateway",
    glyph: "❖",
    tagline:
      "The KiloCode gateway: 393 lanes including kilo-auto/free (rotating free pool, no credits required), 20+ :free models, Auto-Efficient routing, and the new MiMo V2.6 family at shockingly low prices.",
    baseUrl: "https://api.kilo.ai/api/gateway/v1",
    signupUrl: "https://kilo.ai",
    docsUrl: "https://kilo.ai/docs/gateway/overview",
    featured: true,
    limits:
      "kilo-auto/free: rotating free models, no credits required · :free lanes rate-capped · Auto Efficient routes each request to the cheapest capable model · roster is public (393 lanes right now)",
    guide: [
      "The model roster is PUBLIC — hit Refresh models even before adding a key to see all 393 live lanes.",
      "Create a key at kilo.ai (simple registration, built-in provider) and paste it here.",
      "The app talks to https://api.kilo.ai/api/gateway/v1 (OpenRouter-shaped, streaming + tools).",
      "kilo-auto/free is preselected: it rotates through available free models per request — zero cost. kilo-auto/efficient picks the cheapest capable model when you want paid quality at minimum price.",
    ],
    liveCatalog: "kilo",
    models: [
      { id: "kilo-auto/free", label: "Kilo Auto Free", note: "Rotating free pool · no credits required · the no-brainer default" },
      { id: "kilo-auto/efficient", label: "Kilo Auto Efficient", note: "Routes to the cheapest capable model per request" },
      { id: "kilo-auto/balanced", label: "Kilo Auto Balanced", note: "Price/quality balance router" },
      { id: "xiaomi/mimo-v2.6-pro", label: "MiMo V2.6 Pro", note: "1T+ MoE flagship · 1M ctx · $0.435/$0.87 — absurdly cheap frontier" },
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra 550B (Free)", note: "Frontier reasoning MoE · :free lane" },
      { id: "poolside/laguna-s-2.1:free", label: "Laguna S 2.1 (Free)", note: "118B coding agent · :free lane" },
      { id: "nex-agi/nex-n2.5-pro:free", label: "Nex N2.5 Pro (Free)", note: "Agentic coding · :free lane" },
      { id: "inclusionai/ling-3.0-flash-vl:free", label: "Ling 3.0 Flash VL (Free)", note: "Vision-language · :free lane" },
      { id: "qwen/qwen3.8-27b:free", label: "Qwen 3.8 27B (Free)", note: "Dense VLM · :free lane" },
      { id: "z-ai/glm-5.2:free", label: "GLM 5.2 (Free)", note: "1M ctx reasoning · :free lane" },
    ],
  },
  {
    id: "orcarouter",
    name: "OrcaRouter",
    glyph: "🐋",
    tagline:
      "One OpenAI-compatible gateway over 190+ frontier models — Gemini 3.8, GLM 5.3, Kimi K3, MiniMax M3, DeepSeek V4 — plus a free difficulty-routing pool.",
    baseUrl: "https://api.orcarouter.ai/v1",
    signupUrl: "https://www.orcarouter.ai/console/token",
    docsUrl: "https://docs.orcarouter.ai/",
    featured: true,
    limits:
      "Free: orcarouter/free routes every request by difficulty across the workspace's free models — rate-capped, never touches your wallet · paid models metered per-token",
    guide: [
      "Open orcarouter.ai → console → API Keys (console/token) and create a key.",
      "Paste it here — the app talks to https://api.orcarouter.ai/v1 (OpenAI-compatible, streaming + tools).",
      "orcarouter/free is preselected: a meta-router that picks free models per request by difficulty — zero cost, rate-capped.",
      "Frontier picks one click away: google/gemini-3.8-flash, z-ai/glm-5.3, kimi/kimi-k3, minimax/minimax-m3, deepseek/deepseek-v4.1-flash.",
      "The model roster is PUBLIC — hit Refresh models even before adding a key to see all 190+ live lanes.",
    ],
    liveCatalog: "orcarouter",
    models: [
      { id: "orcarouter/free", label: "OrcaRouter Free", note: "Difficulty-routed free pool · never bills · the no-brainer default" },
      { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Current-gen Gemini · fast + vision + 1M ctx" },
      { id: "z-ai/glm-5.3-flash-free", label: "GLM 5.3 Flash (Free)", note: "Z.ai flagship class · 1M ctx · free tier" },
      { id: "deepseek/deepseek-v4-flash-free", label: "DeepSeek V4 Flash (Free)", note: "284B MoE · 1M ctx · tools · free tier" },
      { id: "tencent/hy3-free", label: "Hunyuan Hy3 (Free)", note: "295B MoE (21B active) · 262K ctx · reasoning + tools" },
      { id: "kimi/kimi-k3", label: "Kimi K3", note: "Moonshot frontier · long-horizon agentic" },
      { id: "minimax/minimax-m3", label: "MiniMax M3", note: "Efficiency frontier · ~1.1s canary" },
      { id: "orcarouter/fusion", label: "OrcaRouter Fusion", note: "Routes across the whole pool by quality bar · 1M ctx" },
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
    liveCatalog: "groq",
    guide: [
      "Open console.groq.com/keys and sign up (Google or email, ~2 minutes).",
      "Click “Create API Key” and copy it — it starts with gsk_.",
      "Paste it here and hit Validate. That's it.",
      "Groq ships new open models weekly — hit Refresh models to pull the current roster.",
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
    liveCatalog: "google-ai-studio",
    guide: [
      "Open aistudio.google.com/apikey and sign in with a Google account.",
      "“Create API key” — starts with AIza. No credit card needed.",
      "Paste it here. Note: free-tier data may be used by Google for training.",
      "Gemini ships fast — hit Refresh models to pull the current roster straight from Google.",
    ],
    models: [
      { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", note: "Current generation · fast + vision + 1M ctx" },
      // r27 roster audit: gemini-3.5-pro / gemini-3.8-flash-lite do not exist
      // (Google docs + live rosters) — replaced with the real current ids.
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", note: "Strongest current Gemini" },
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", note: "Highest free quota" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "Legacy · still available" },
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
      "Use the “Refresh models” button below — the free roster rotates weekly.",
    ],
    models: [
      { id: "nvidia/nemotron-3.5-lightning:free", label: "Nemotron 3.5 Lightning", note: "1M ctx · NVIDIA" },
      // r32: MiMo V2.6 family verified live on OpenRouter (pricing strings
      // parsed from /api/v1/models 2026-09-23) — Xiaomi's open-sourced
      // omnimodal flagship line, absurdly cheap for the frontier class.
      { id: "xiaomi/mimo-v2.6-pro", label: "MiMo V2.6 Pro", note: "1T+ MoE · 1M ctx · $0.435/$0.87 · omni-in" },
      { id: "xiaomi/mimo-v2.6-flash", label: "MiMo V2.6 Flash", note: "309B MoE · 1M ctx · $0.14/$0.28" },
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
    liveCatalog: "mistral",
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
    liveCatalog: "zai",
    guide: [
      "Open z.ai and register an account.",
      "Go to the API console and create a key.",
      "GLM-4.7-Flash / GLM-4.5-Flash below are $0; GLM-5.3-Flash is the cheap flagship-class pick.",
    ],
    models: [
      // r27 roster audit: GLM-5.3 family verified (docs.z.ai + HF zai-org).
      { id: "glm-5.3-flash", label: "GLM 5.3 Flash", note: "Flagship class · cheap · 1M ctx" },
      { id: "glm-5.3", label: "GLM 5.3", note: "Flagship · reasoning · 1M ctx" },
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
    liveCatalog: "nvidia-nim",
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
    liveCatalog: "sambanova",
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
    liveCatalog: "cohere",
    guide: [
      "Open dashboard.cohere.com/api-keys and register.",
      "Create a “trial” key (40-char string, no prefix).",
      "The OpenAI-compatible endpoint is pre-configured for you here.",
    ],
    models: [
      { id: "command-a-03-2025", label: "Command A", note: "Flagship (03-2025 refresh)" },
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
    liveCatalog: "together",
    guide: [
      "Open api.together.ai and sign up (no card for the free endpoints).",
      "Create an API key (64-hex string).",
      "Pick any model ending in “-Free” below.",
    ],
    models: [
      // r27: the -Free Llama endpoint was retired; free serverless today =
      // Ternary-Bonsai-27B (ternary-quantized 27B MoE lineage).
      { id: "Prism-ML/Ternary-Bonsai-27B", label: "Ternary Bonsai 27B", note: "Free serverless" },
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B Turbo", note: "Paid · reliable fallback" },
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
    liveCatalog: "cloudflare",
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
      "The online roster is small right now (GPT-OSS 20B, reasoning + tools) — “Refresh models” pulls what's up.",
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
    liveCatalog: "cerebras",
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
