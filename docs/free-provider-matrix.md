# Free Frontier LLM Provider Matrix

- **Date:** 2026-09-15 (live research day)
- **Method:** live web search (web-search skill) + direct HTTP probes of live API endpoints (`integrate.api.nvidia.com/v1/models`, `opencode.ai/zen/v1/*`, `openrouter.ai/api/v1/models`, `api.kilo.ai` docs endpoints) + official vendor docs fetches. Third-party rate-limit claims are marked with their as-of date and source.
- **Project context:** PraisonAI Web is **local-first, BYOK, localStorage-only, zero telemetry**. Every key below is pasted by the user into their browser and sent only to the provider they chose, only when they chat. Nothing is proxied or logged anywhere else.
- **Legend for "In registry?"** — refers to `src/lib/providers.ts` (`FREE_PROVIDERS`, the 12-provider vault added in r14). Registry ids are given where known.
- **Confidence marks:** ✅ verified live or from official docs on 2026-09-15 · 🕐 as-of (dated secondary source, not re-verified live) · ⚠️ UNVERIFIED (do not trust without checking).

---

## 1. Comparison matrix

**Integration effort rubric**

| Effort | Meaning |
|---|---|
| **S** | OpenAI-compatible `POST /chat/completions` + static Bearer key — drops straight into the existing `llm-config.ts` registry path (baseUrl + keyPrefix + models list). |
| **M** | Works with the existing code path but needs one extra: an extra param/endpoint quirk, an accountId in the URL, an OAuth-ish login, or a non-default endpoint per model family. |
| **L** | Needs a server-side proxy, a special SDK, or a fully non-OpenAI protocol (Responses API / Anthropic Messages / gRPC). |

| # | Provider | Auth method | Free tier mechanics | Rate limits | Frontier models available | SDK / API style | Effort | In registry? |
|---|---|---|---|---|---|---|---|---|
| 1 | **NVIDIA NIM** (build.nvidia.com) | Static API key, `nvapi-` prefix, Bearer | 1,000 free API credits at signup (≈1 credit per call, not per token) — no card | 🕐 ~40 RPM per account (as-of Jul–Aug 2026, NVIDIA forum credit-increase requests) | **Live ✅ (82 models today):** Nemotron 3 Ultra 550B-A55B, Nemotron 3 Super 120B, Nemotron 3.5 Lightning 30B, Kimi K2.6 / K3, DeepSeek V4 Flash, GPT-OSS 20B, Mistral Large 2, Llama 3.2 90B Vision. Llama 3.3 70B is **EOL (410 Gone)** | OpenAI-compatible `/v1/chat/completions` | **S** | ✅ yes — `nvidia-nim` (model list is **stale** — see §5) |
| 2 | **OpenCode Zen** (opencode.ai/zen) | Static API key from Zen console (browser login; CLI uses `opencode auth login` OAuth) | Pay-as-you-go; **6 permanently-$0 models** (Big Pickle, MiMo-V2.5 Free, Ling 3.0 Flash Fin Free, Nemotron 3 Ultra Free, Nemotron 3.5 Lightning Free, Muse Spark 1.3 Contributor Free) — **BUT live probe ✅ shows free tier is session-gated to OpenCode clients** ("MissingSessionID — OpenCode's free tier can only be used in OpenCode"). Free models = training-data trade; paid models need credits | Rate limits unpublished ⚠️ UNVERIFIED; monthly spend limit configurable | Kimi K2.7 Code, Kimi K3, DeepSeek V4 Pro/Flash, GLM 5.3 / 5.3 Flash, MiniMax M3, Qwen3.7 Plus (paid); 6 free models (gated) | Split protocol by family: `/zen/v1/chat/completions` (open models), `/zen/v1/responses` (GPT/Grok), `/zen/v1/messages` (Claude/Qwen), `/zen/v1/models/{id}` (Gemini) | **S** for the `/chat/completions` subset (paid) · **M/L** for full catalog · free tier = **L/blocked** | ❌ no — new discovery |
| 3 | **Kilo Gateway** (kilo.ai — Kilo Code, **acquired by Anaconda**) | Static API key from app.kilo.ai profile page, Bearer | **Free models** (not credits): several models at $0 for authenticated users; **anonymous (no key) = 200 req/hour per IP ✅ official**. Frontier routing (Claude/GPT/Gemini) requires paid credits. No signup bonus credits 🕐 (as-of Aug 25 2026) | Authenticated free-model RPM unpublished ⚠️ UNVERIFIED; anonymous 200 req/h ✅ | Free (rotating): Qwen3 Coder, GLM 4.5 Air, DeepSeek R1 0528 🕐 (Nov 2025) + `kilo-auto/free` router. Paid frontier: Claude Opus 4.7 / Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro, Grok 4, Kimi K2.5, DeepSeek v3.2 | OpenAI-compatible `https://api.kilo.ai/api/gateway/chat/completions`, model = `provider/model-name` (OpenRouter-style); public models list `GET /api/gateway/models` (no auth) ✅ | **S** | ❌ no — new discovery |
| 4 | **OpenRouter** | Static key `sk-or-v1-` | 50 free-model req/day (0 cost); **1,000/day after a one-time $10 top-up** (credits never expire) | ✅ 20 RPM (fixed even with credits); 50→1,000 RPD | Live ✅: 446 models, **20 `:free`** right now — Nemotron 3 Ultra 550B `:free`, GLM 5.2 `:free`, Nex N2.5 Pro, Inkling / Inkling Small, Poolside Laguna S/XS, Ling 3.0 Flash VL/Fin/Sante, Gemma 4 31B, North Mini Code | OpenAI-compatible `/api/v1` | **S** | ✅ yes — `openrouter` (+ live `:free` catalog already wired) |
| 5 | **Google AI Studio** | Static key `AIza` | Free tier per model on the Gemini API; no card; free-tier data may be used for training | 🕐 per-project, per-model; ~5–15 RPM, 100–1,000 RPD, reset midnight PT (as-of Jan–Sep 2026 secondary sources; official numbers live on aistudio.google.com/rate-limit) | Gemini 3.8 Flash (newest ✅), Gemini 3.x/2.5 Pro + Flash families | OpenAI-compatible shim `/v1beta/openai/` (native API also exists) | **S** | ✅ yes — `google-ai-studio` |
| 6 | **Groq** | Static key `gsk_` | Free tier, no card, full model lineup at $0 | 🕐 ~30 RPM · 14,400 RPD · ~6,000–8,000 TPM depending on model (as-of Mar–Sep 2026, conflicting secondaries; official console.groq.com/docs/rate-limits is per-model). Sandbox geo-blocked (403) — not live-verifiable from here | GPT-OSS 120B/20B, Llama 4 family, Kimi K2-style open models, Qwen 3.8, Groq Compound | OpenAI-compatible `/openai/v1` | **S** | ✅ yes — `groq` |
| 7 | **Mistral La Plateforme** | Static key (32-char, no prefix) | Free **"Experiment" plan**, whole catalog incl. Codestral/Devstral, no card | 🕐 ~1 req/s, low priority (may queue at peak) — as-of Jan 2026, GitHub issue + vendor docs | Mistral Large 3, Mistral Medium, Codestral, Devstral, Magistral | OpenAI-compatible `/v1` | **S** | ✅ yes — `mistral` |
| 8 | **Cerebras** | Static key `csk-` | **No no-cost tier** — official docs ✅: "Cerebras doesn't currently offer a no-cost tier. API and Playground access stop on the Free Trial tier until you purchase credits." Third-party "1M tokens/day free, no card" claims are **outdated** | Trial tier limits moot until credits purchased; paid tiers use dual-bucket token limits ✅ | GPT-OSS 120B (~3,000 tok/s), Qwen 3.8 27B, Llama 4 | OpenAI-compatible `/v1` | **S** | ✅ yes — `cerebras` (honestly flagged `cardRequired`) |
| 9 | **GitHub Models** | GitHub PAT | **RETIRED 2026-07-30** ✅ (github.blog, docs.github.com): playground, catalog, inference API and BYOK are all gone. Use Azure AI Foundry instead | — | — | was OpenAI-compatible `/catalog/github/models` | — | ❌ **not in registry — correctly so; DEAD, do not add** |
| 10 | **HuggingFace Inference Providers** | HF token (`hf_`), Bearer | Tiny monthly credits with a free account (~$0.10/mo 🕐), ~$2/mo credits on PRO ($9/mo subscription). Routes each request to the cheapest matching provider | 🕐 small; PRO = 20× higher limits (as-of Dec 2025–Apr 2026) | Whatever partner providers serve: GPT-OSS, Kimi, DeepSeek, Llama, Qwen, Gemma — via one router | OpenAI-compatible router `https://router.huggingface.co/v1/chat/completions`, model = `provider/model` or `model:provider` | **S** | ❌ no — new discovery |
| 11 | **Cloudflare Workers AI** | API token + **Account ID in URL** | 10,000 Neurons/day free, resets 00:00 UTC ✅ official (≈1–2K neurons per 70B chat) | ✅ 10,000 Neurons/day is the free cap | GPT-OSS 120B, Llama 3.3 70B fp8-fast, Qwen2.5 Coder 32B | OpenAI-compatible REST under `/accounts/{ACCOUNT_ID}/ai/v1` | **M** (accountId splice — already solved in registry) | ✅ yes — `cloudflare` |
| 12 | **SambaNova Cloud** | Static key | Free tier applies **while no payment method is linked** ✅ official | 🕐 per-model RPM/RPD tables; ~20 RPM observed on free tier (as-of Mar 2026 community) | Llama 3.3 70B / 405B, DeepSeek R1 distills, Qwen3 | OpenAI-compatible `/v1` | **S** | ✅ yes — `sambanova` |
| 13 | **Z.ai** | Static key | **GLM-4.7-Flash and GLM-4.5-Flash are literally $0 on the official pricing page ✅** (all four price columns = "Free") | RPM unpublished ⚠️ UNVERIFIED ("unlimited-ish" per r14 research) | GLM 4.7-Flash / 4.5-Flash ($0); GLM 5.3-Flash is cheap ($0.15/$0.50) but **not** free | OpenAI-compatible `/api/paas/v4` | **S** | ✅ yes — `zai` |
| 14 | **Together AI** | Static key (64-hex) | Rotating `-Free` serverless endpoints 🕐 (as-of r14 research, Sept 2026; docs are JS-walled today — ⚠️ not re-verified live on 2026-09-15) | Unpublished ⚠️ | Llama 3.3 70B Turbo-Free, DeepSeek R1 Distill 70B Free | OpenAI-compatible `/v1` | **S** | ✅ yes — `together` |
| 15 | **Pollinations** | **No key** (anonymous) · free key `sk_` from enter.pollinations.ai (keyed tier) | Anonymous free tier shares a global IP budget — mostly exhausted in practice ✅ (r18 live probe); keyed tier carries a **per-key budget** the owner can raise on the key page | Anonymous: shared, usually exhausted ✅ · Keyed: per-key budget, live probe returned an in-200-stream budget notice after 2 OK calls (r18) | Live ✅ (r18, keyed tier): `openai-fast` / `openai` = GPT-OSS 20B (reasoning + tools) is the only text model online right now; `openai-large` / `gemini` / `mistral` / `qwen-coder` → 502, `openai-reasoning` → 404 | OpenAI-compatible `/openai` ✅ streaming works; injects sponsored chunks from a separate `ad-system` model into the stream (r18) | **S** | ✅ yes — `pollinations` (r18: keyed w/ pre-seeded key, live roster via `/api/providers/free-models?provider=pollinations`, budget-notice + ad-chunk handling in `/api/chat`) |
| 16 | **Chutes.ai** | API key | ⚠️ UNVERIFIED — the 200-req/day "Early Access perk" was being retired per a Feb 27, 2026 community announcement (page 404s from sandbox; content not read). Treat as paid-only today | ⚠️ UNVERIFIED | DeepSeek/Kimi/Qwen/Llama hosted on Bittensor subnet | OpenAI-compatible | — | ❌ not added — cannot verify free tier |
| 17 | **Meta "Llama API"** | OAuth/key | **Public Preview retired 2026-07-06** 🕐 (promptfoo). New "Meta Model API" (Muse Spark / Muse Code) exists at developer.meta.com — free tier ⚠️ UNVERIFIED | ⚠️ | Muse Spark 1.3 (also on Zen, $1.25/$4.25 paid) | Custom SDK + OpenAI-compat variants | — | ❌ not added |
| 18 | **Scaleway Generative APIs** | Static key | ⚠️ UNVERIFIED — could not confirm a standing free tier from docs reachable today (rate-limit page exists; free allowance unclear) | 🕐 Batches API: no rate limit, −50% billing | Llama/Qwen/Mistral hosted EU | OpenAI-compatible | — | ❌ not added — unverified |
| 19 | **Vyce AI** (vyceai.com) | Static key `sk-` | **Daily free credits: $10.00/day free tier (resets 00:00 UTC), streaks up to $30/day** ✅ live-verified r18 (user dashboard + live API probe); no card | Key limit 150 RPM ✅ (read from `GET /v1/me` live); per-1M-token pricing from balance | Live ✅ via `GET /v1/models` (r18): DeepSeek V4.1 (flagship MoE, 270K), DeepSeek V4 Flash (270K), Agnes 3.0 Flash (512K agentic), Claude Sonnet 4.6 (270K), DeepSeek V4 Flash LR; `grok-imagine-2` (image, $0.50/img, `/v1/images/generations`); paid tier adds GPT 5.6/Astra/Grok 4.6 routes (not exposed to this key) | OpenAI-compatible `https://vyceai.com/v1` ✅ (streaming verified r18: proper SSE chunks + `[DONE]`); also Anthropic-compatible `/v1/messages` | **S** | ✅ yes — `vyce` (r18: featured, pre-seeded key, `deepseek-v4.1` default — current efficiency-frontier pick) |

---

## 2. Big-three deep dive

### 2.1 NVIDIA NIM — `integrate.api.nvidia.com/v1`

**Signup URL:** https://build.nvidia.com

**Get a key (3–5 steps):**
1. Open build.nvidia.com and create / verify a NVIDIA developer-program account (free, email verification + occasionally phone OTP — forum reports of OTP delivery issues exist).
2. Pick any model card on the site (e.g. Nemotron, Kimi, DeepSeek) and click **"Get API Key"** (or go to your account's API-keys settings page).
3. Generate the key — it starts with `nvapi-`. Copy it once.
4. Point any OpenAI client at `https://integrate.api.nvidia.com/v1` with `Authorization: Bearer nvapi-…`.
5. (Optional) Browse the live catalog yourself: `GET https://integrate.api.nvidia.com/v1/models` is public — we pulled 82 models live on 2026-09-15.

**Rate limits & free tier mechanics:**
- 🕐 **~40 requests/minute + 1,000 free API credits** per account (as-of Jul 6 2026 and Aug 7 2026 NVIDIA developer-forum threads where users request increases to 200 RPM / 5,000 credits — the "current limit" quoted in their posts matches). High confidence, matches r14 registry notes.
- Credits are consumed **per call**, not per token — long-context agent loops burn them fast. When credits run out the account is capped until NVIDIA grants more (or you qualify for higher tiers).

**Top 5 models for coding/research agents (all live in the 2026-09-15 catalog ✅):**
1. `moonshotai/kimi-k3` — strongest open coding/agentic model on the host
2. `nvidia/nemotron-3-ultra-550b-a55b` — NVIDIA flagship reasoner (550B MoE)
3. `nvidia/nemotron-3-super-120b-a12b` — sweet spot of quality vs. credits
4. `deepseek-ai/deepseek-v4-flash-0731` — fast, cheap-class reasoning
5. `openai/gpt-oss-20b` — small, tool-calling-friendly workhorse

**Quirks / gotchas:**
- ⚠️ **Model EOLs are aggressive** — `meta/llama-3.3-70b-instruct` returned `410 Gone … end of life on 2026-08-26` in our live probe; `deepseek-ai/deepseek-r1` and `qwen/qwen2.5-coder-32b-instruct` (in our registry) are **no longer in the live catalog**. Validate against `/v1/models` instead of hardcoding.
- Auth is checked **after** model-name validation (a dead model returns 410 even with no key; a live model with no key returns 403 `Authorization failed`).
- Free-tier data handling: NVIDIA trial endpoints log sessions for security/improvement (mirrored in Kilo/Zen docs) — no confidential data.
- Sandbox note (from r14): reachable from the sandbox; no geo-block observed on the models endpoint.

### 2.2 OpenCode Zen — `https://opencode.ai/zen/v1/...`

**Signup URL:** https://opencode.ai/zen (docs: https://opencode.ai/docs/zen/) — console login at opencode.ai (the `/console` path 307-redirects to the auth flow).

**Get a key (3–5 steps):**
1. Open opencode.ai/zen and click **Login / Get started**; sign in (email/SSO) — this is a browser flow, no card strictly required to create the account.
2. In the Zen console, add billing details **only if you want paid models** (credits, pay-as-you-go, optional auto-reload of $20 when balance < $5, optional monthly cap).
3. Copy your **API key** from the console (or run `opencode auth login` → OpenCode Zen inside the CLI for the OAuth flow).
4. Use the endpoints below. Model metadata is public: `GET https://opencode.ai/zen/v1/models`.

**Endpoints (per model family — this is the big quirk):**
| Family | Endpoint | SDK style |
|---|---|---|
| DeepSeek V4, MiniMax M3, GLM 5.x, Kimi K2.x/K3, **the six free models** | `POST https://opencode.ai/zen/v1/chat/completions` | OpenAI-compatible |
| GPT 5.x / GPT 6 Astra / Grok 4.x | `POST https://opencode.ai/zen/v1/responses` | OpenAI **Responses** API |
| Claude Opus/Sonnet/Haiku, Qwen3.7 Max/Plus | `POST https://opencode.ai/zen/v1/messages` | Anthropic Messages |
| Gemini 3.x | `POST https://opencode.ai/zen/v1/models/{model}` | Google style |

**Rate limits & free tier mechanics:**
- Pricing is per-request/1M-token, sold at cost (+ card fees passed through). **Six models are priced $0**: `big-pickle`, `mimo-v2.5-free`, `ling-3.0-flash-fin-free`, `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`, `muse-spark-1.3-contributor-free` ✅ (official pricing table).
- **CRITICAL (live-verified ✅):** the free tier is **gated to OpenCode clients**. Our probe of `/zen/v1/chat/completions` (model `big-pickle`, no session) returned:
  `{"error":{"type":"MissingSessionID","message":"Error from provider (Console): OpenCode's free tier can only be used in OpenCode"}}`
  → A plain OpenAI-compatible client (our app) **cannot use Zen's free models**; it can only use Zen with a funded account on the paid models.
- Rate limits for paid use: unpublished ⚠️ UNVERIFIED. Monthly workspace/member spend limits are configurable.

**Top 5 recommended models (for coding agents, paid /chat/completions subset):**
1. `kimi-k2.7-code` — $0.95/$4.00, coding-specialized
2. `deepseek-v4-flash` — $0.14/$0.28, best price/perf
3. `glm-5.3-flash` — $0.15/$0.50, fast + cheap
4. `minimax-m3` — $0.30/$1.20, agentic MoE
5. `glm-5.3` / `kimi-k3` — heavyweight open reasoning

**Quirks / gotchas:**
- Free models are a **data-for-usage trade**: Big Pickle / MiMo / Ling / Nemotron free may train on your prompts; Muse Spark Contributor Free explicitly trades training rights for the $0 price; NVIDIA free endpoints are trial-only and logged. Our zero-telemetry stance is unaffected (keys stay local) but users should know.
- Deprecations move fast (a whole GPT-5.x-Codex + GLM-4.x generation was retired mid-2026) — pin model ids loosely.
- For our app: only worth adding the `/chat/completions` subset (S effort); full multi-protocol support would be L.

### 2.3 Kilo Gateway — `https://api.kilo.ai/api/gateway`

**Signup URL:** https://kilo.ai (console: https://app.kilo.ai) — Kilo Code was **acquired by Anaconda** (banner on official docs).

**Get a key (3–5 steps):**
1. Sign up at kilo.ai (Google/GitHub/email SSO — same account as the Kilo Code extension).
2. Go to **app.kilo.ai → Your Profile** (personal account, not an organization).
3. Scroll to the **bottom of the profile page** and copy your **API key**.
4. Call `POST https://api.kilo.ai/api/gateway/chat/completions` with `Authorization: Bearer <key>` and `model: "provider/model-name"`.
5. Browse the catalog with the public (no-auth) endpoint: `GET https://api.kilo.ai/api/gateway/models`.

**Rate limits & free tier mechanics:**
- The free tier is **free models, not free credits**: several models cost $0 for authenticated users, and `kilo-auto/free` is a virtual model that routes to whatever free models are currently available. ✅ Official docs.
- **Anonymous access (no key at all): 200 requests/hour per IP** ✅ official (models-and-providers page) — genuinely zero-signup usage, like Pollinations.
- Frontier models (Claude Opus 4.7 / Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro, Grok 4, Kimi K2.5, DeepSeek v3.2) **require paid credits** — the task's assumption "free credits for new users" is **outdated**: no signup bonus as of Aug 25 2026 🕐 (an old "$20 first top-up bonus" existed as of May 2026; current pricing page says $0/mo with free-model routing only).
- Authenticated free-model RPM: unpublished ⚠️ UNVERIFIED. New accounts may hit a temporary identity-verification "hold" to prevent misuse (official docs mention it without numbers).

**Top 5 models for coding/research agents:**
1. `kilo-auto/free` — zero-config free router (no key management at all, hops between whatever is free)
2. `moonshotai/kimi-k2.5` — strong coding model (paid)
3. `deepseek/deepseek-v3.2` — strong coding/reasoning (paid)
4. `anthropic/claude-sonnet-4.6` — best-in-class agentic coding (paid)
5. `x-ai/grok-code-fast-1` — fast free-ish coding option when rotated into the free set ⚠️ (rotation changes)

**Quirks / gotchas:**
- Model ids are **OpenRouter-style `provider/model`** — our registry's model picker just needs different id strings.
- `kilo-auto/*` virtual models are handy but server-side mappings change silently.
- Data caveat: Auto-Free may route to NVIDIA free endpoints (logged, trial terms) — official warning.
- Public models endpoint (no auth) is perfect for a live-catalog integration like our OpenRouter one.

---

## 3. Recommended additions (ranked)

1. **Kilo Gateway** — effort **S**. OpenAI-compatible single endpoint, OpenRouter-style model ids, **free models + an anonymous no-key tier (200 req/h/IP)**, public model catalog for live refresh, and a paid path to Claude/GPT/Gemini in one vault entry. Best free-tier/effort ratio of anything new we found.
2. **HuggingFace Inference Providers** — effort **S**. One HF token routes to ~18 providers (Groq, Cerebras, DeepInfra, Novita, Together, Scaleway, Z.ai, …) through `router.huggingface.co/v1` (OpenAI-compatible). Free credits are tiny (~$0.10/mo) so it's a fallback/router play, not a volume play — but it multiplies every other provider for free.
3. **OpenCode Zen** — effort **S** for the `/chat/completions` subset, **positioned honestly as a cheap (not free) option**: the six $0 models are session-gated to OpenCode clients (verified live), so from our browser app only paid credits work. Value = at-cost pricing on Kimi K2.7 Code / DeepSeek V4 Flash / GLM 5.3 Flash with zero markup. Add only with a "not free" badge.
4. *(registry fix, not a new provider)* **Refresh `nvidia-nim` model list** — effort **S**. Three of four curated ids are dead/EOL (Llama 3.3 70B 410-Gone live-verified); swap to Nemotron 3 Ultra/Super, Kimi K2.6/K3, DeepSeek V4 Flash, GPT-OSS 20B.
5. *(excluded, with reasons)* **GitHub Models** (retired 2026-07-30 ✅ — dead), **Chutes** (free perk retirement ⚠️ unverified), **Scaleway** (free tier ⚠️ unverified), **Meta Llama API** (preview retired 2026-07-06 🕐).

---

## 4. Contradictions vs. what the project currently assumes

| Project assumption (registry/worklog) | Reality (2026-09-15) |
|---|---|
| `nvidia-nim` models: Llama 3.3 70B, DeepSeek R1, Qwen2.5 Coder 32B | **Dead/EOL** — Llama 3.3 70B returns 410 Gone (EOL 2026-08-26); R1 + Qwen2.5 Coder absent from the live 82-model catalog. Replace (see §3.4). |
| OpenCode Zen hypothesis: "free coding models (grok-code-fast, qwen3-coder), maybe OpenAI-compatible" | Free models exist but are **locked to OpenCode clients** (MissingSessionID gate, live-verified). grok-code-fast/qwen3-coder are gone from the catalog (deprecated Feb–Mar 2026); current free set = Big Pickle, MiMo-V2.5, Ling 3.0 Flash Fin, Nemotron 3 Ultra/Lightning, Muse Spark Contributor. |
| KiloCode "free credits for new users?" | **No credits** — the free tier is free models (+ anonymous 200 req/h/IP); no signup bonus as of Aug 2026 🕐. Also note the Anaconda acquisition. |
| Task brief: "GitHub Models — free with GitHub account" | **Retired 2026-07-30** ✅ (github.blog, docs.github.com) — must not be added. |
| Cerebras "free tier with card" | Correct per official docs ✅ — and third-party blogs claiming "1M tokens/day, no card" are outdated. Keep the honest `cardRequired` flag. |
| Together `-Free` endpoints | Could not be re-verified live from the sandbox (JS-walled docs) — keep the existing entry but treat its limits line as 🕐 as-of Sept 2026. |

---

## 5. Sources (used live on 2026-09-15)

**Official / primary:**
- https://opencode.ai/docs/zen/ — Zen endpoints, pricing table, free models, privacy, deprecations (last updated Sep 14, 2026)
- https://opencode.ai/zen/v1/models — public live model list
- Live probe: `POST https://opencode.ai/zen/v1/chat/completions` (MissingSessionID gate)
- https://kilo.ai/docs/gateway/models-and-providers — free models, anonymous 200 req/h, auto models, NVIDIA-endpoint warning
- https://kilo.ai/docs/getting-started/setup-authentication — API key location (app.kilo.ai profile)
- https://kilo.ai/docs/gateway/quickstart — OpenAI-compatible base URL + cURL example
- https://kilo.ai/docs/ai-providers/kilocode — built-in provider, free models, identity-verification hold, Anaconda banner
- https://integrate.api.nvidia.com/v1/models — live 82-model catalog (public)
- Live probe: `POST https://integrate.api.nvidia.com/v1/chat/completions` (410 EOL for Llama 3.3 70B; 403 without key)
- https://inference-docs.cerebras.ai/support/rate-limits — "no no-cost tier" statement, dual-bucket limits
- https://developers.cloudflare.com/workers-ai/platform/pricing/ — 10,000 Neurons/day free (updated Aug 28, 2026)
- https://docs.z.ai/guides/overview/pricing — GLM-4.7-Flash / GLM-4.5-Flash = Free
- https://ai.google.dev/gemini-api/docs/rate-limits — per-project/per-model limits, midnight-PT reset (updated Sep 2, 2026)
- https://docs.sambanova.ai (rate-limits) — "Free Tier applied when no payment method linked"
- https://docs.github.com + https://github.blog — GitHub Models retirement (Jul 30, 2026)
- https://huggingface.co/docs/inference-providers/index — router + provider list

**Secondary (dated):**
- NVIDIA developer forums (Jul 6, 2026 & Aug 7, 2026) — 40 RPM / 1,000 credits current-limit quotes
- https://openrouter.ai blog "Free LLM API in 2026: 13 Options Ranked and Compared" (Jun 15, 2026) + truefoundry (Aug 25, 2026) + pricepertoken — OpenRouter 50/1,000 RPD, 20 RPM
- cloudzero.com (Sep 4, 2026) / klymentiev.com (May 10, 2026) / getaiperks (May 8, 2026) — Groq free-tier RPM/RPD/TPM (conflicting TPM figures; per-model)
- GitHub issue mistralai/mistral-vibe #275 (Jan 26, 2026) + pricepertoken — Mistral Experiment 1 req/s, low priority
- discuss.huggingface.co (Dec 22, 2025) + deepinfra.com (Apr 29, 2026) + metronome (Feb 4, 2026) — HF credits $0.10 free / $2 PRO
- community.sambanova.ai (Mar 25, 2026) — SambaNova free tier ~20 RPM
- vibecoding.app (Aug 24, 2026) — no Kilo signup bonus; cursor-alternatives.com (May 28, 2026) — the old $20 bonus
- reddit.com/r/kilocode (Nov 27, 2025) — Kilo free model ids (Qwen3 Coder, GLM 4.5 Air, R1 0528)
- promptfoo.dev — Meta Llama API Public Preview retired Jul 6, 2026
- chutes.ai community announcement (Feb 27, 2026, search snippet only — page unreachable)

**Project-internal:** `src/lib/providers.ts` (registry ids/limits), `worklog.md` r14/r15 (sandbox geo-blocks Groq/Cerebras; freellm.sh + live-catalog wiring).
