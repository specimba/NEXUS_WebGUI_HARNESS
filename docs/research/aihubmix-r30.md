# AIHubMix (aihubmix.com) — Provider Research r30-2

**Scope:** keyless-only investigation for integrating AIHubMix as an OpenAI-compatible LLM provider. No API key was created or sent in any request; all probes are unauthenticated.
**Date:** 2026-09-22 · **Evidence:** `/tmp/r30/` (llms.txt index, 10+ doc pages, OpenAPI spec, live JSON probes, SSR HTML extracts, 2 web searches)

---

## 1. Verified base URLs & auth shape

| Role | URL | Evidence |
|---|---|---|
| **Primary (production)** | `https://aihubmix.com/v1` | OpenAPI spec `servers[]` + all docs (quick-start, llm-router) |
| **Alias (edge)** | `https://api.aihubmix.com` | site `llms.txt`: "Base URL: https://aihubmix.com (alias: https://api.aihubmix.com)" — served byte-identical `/v1/models` |
| **Backup domain** | `https://api.inferera.com` | OpenAPI spec: "Backup (use when the primary domain is unreachable)" + quick-start note; served byte-identical `/v1/models` (35,100 B) |
| Gemini native lane | `https://aihubmix.com/gemini/v1beta/...` | agents.md, third-party guide |
| Anthropic native lane | `POST /v1/messages` with `x-api-key` + `anthropic-version: 2023-06-01` | agents.md |
| Console / manage API | `https://console.aihubmix.com`, CLI manage keys are `fd***` (separate from call keys `sk***`) | aihubmix-cli.md |

**Auth:** standard `Authorization: Bearer sk-...` on all OpenAI-shaped endpoints (Chat Completions, Responses, embeddings, images…). No OAuth; least-privilege is per-key (model allowlist, IP/CIDR allowlist, spend cap, expiry).

## 2. Keyless endpoint probe evidence table

| Probe (no Authorization header) | Status | Size | Result |
|---|---|---|---|
| `GET https://aihubmix.com/v1/models` | **200** | 35,100 B | OpenAI shape `{data:[{id,object,created,owned_by}]}` — 407 models (default group), 44 `-free` ids. NOT 401 — the legacy `/v1/models` is public per docs ("no user logged in → default group") |
| `GET https://api.inferera.com/v1/models` | **200** | 35,100 B | byte-identical to primary |
| `GET https://api.aihubmix.com/v1/models` | **200** | 35,100 B | byte-identical to primary |
| `GET https://aihubmix.com/api/v1/models` | **200** | 595,550 B | **Rich public catalog**: 852 models, `{data:[…], success:true}` with `model_id, pricing{input,output,cache_read,cache_write,tiers} (USD/1M), context_length, max_output, features, input_modalities, output_modalities, endpoints, reasoning, tool_call, reasoning_options, retire_stage, deprecated_at, retired_at, successor_model, promotion, vendor, open_weights, schema_checked`. HTTP cache 300 s + ETag (`If-None-Match` → 304). Filters: `type, modalities, model, features, endpoints, developer_id, tag, schema_checked, sort_by, sort_order` |
| `GET https://aihubmix.com/call/free_quota_config` | **200** | 439 B | **Live enforced free-quota config** (see §3) |
| `GET https://aihubmix.com/api/router/leaderboard` | **200** | 20,947 B | Login-free router leaderboard: `dims` (5 categories / 23 sub-dimensions, each model `m/v/s/pin/pout/lat`), `pool` (routable pool by vendor, currently 17 models), `poolCount`. CORS enabled |
| `GET https://aihubmix.com/api/v1/router/leaderboard` | **404** | — | wrong path; error body is OpenAI-style `{"error":{"message","type":"invalid_request_error","request_id",…}}` |
| `GET https://aihubmix.com/model/<id>/llms.txt` | **200** | 3.9 KB | per-model machine-readable guide (endpoints, curl example, error codes, free-limit sentence) |
| `GET https://aihubmix.com/model-data/index.json` | **200** | 341 KB | per-model parameter-schema index (schema v2.0.0, content-addressed paths) |
| `GET https://aihubmix.com/agents.md`, `/llms.txt`, `/llms-full.txt` | **200** | 9 KB / 11 KB / — | keyless onboarding docs |
| `GET https://aihubmix.com/models/free`, `/models/retirements` | **200** | 412 KB / 219 KB | SSR pages: free page links **60** free models; retirements page lists ~7 "Deprecating" + ~35 "Retired" entries |
| 404 probe error shape | 404 | 254 B | `{"error":{"code":"not_found","hint":…,"message":…,"request_id":"2026…","type":"invalid_request_error"}}` — OpenAI-compatible |

Docs index: `https://docs.aihubmix.com/llms.txt` (158 EN pages; `/en/<path>.md` returns raw markdown). Key pages fetched: `api/llm-router`, `api/Model-Mapping-Fallback`, `api/structured-output-repair`, `api/aihubmix-cli`, `api/Models-API`, `api-reference/openai-compatible/create-a-chat-completion` (= full OpenAPI spec, also at `/openapi.json`, 899 KB), `blogs/free-ai-models`, `quick-start`, `api/App-code`, `api/unified-inference`, `FAQs/HTTP-Codes`, `api/RouterEndpoints/leaderboard`, `update/News`.

## 3. Rate limits & free tier (verified)

**Enforced gateway config — live JSON `GET /call/free_quota_config` (keyless, 2026-09-22):**
```json
{"daily_request_limit": 100, "daily_token_limit": 1000000, "minute_limit": 10,
 "paid_threshold_usd": 1, "trial_unpaid_request_limit": 10,
 "weight_map": {"gpt-4o-free": 5, "gemini-3.1-flash-image-preview-free": 10,
                "step-3.7-flash-free": 1, "coding-glm-5-turbo-free": 2, …}}
```
**Per-model page / per-model llms.txt wording (SSR-verified):** "To maintain reliable service, each account is limited to **5 requests per minute, 100 requests per day, and 1 million tokens per day**."

→ **Verdict on the 5 rpm / 100 req/day / 1M tok/day claim: CONFIRMED** as the base free budget (per account, not per key). Live config shows `minute_limit: 10` with a per-model `weight_map` that charges heavier models multiple units against the same buckets; the docs explicitly say to read this endpoint rather than memorize numbers (ops changes them). No credit card is required for free models ("A new account can call the free models before adding any payment method" — agents.md); new accounts additionally get `trial_unpaid_request_limit: 10` calls before first top-up.

- 429 = rate limited (honor `Retry-After`; IETF `RateLimit` / `RateLimit-Policy` headers describe the gateway limiter when present). Popular free models (e.g. `coding-glm-5.2-free`) openly warn of "a large number of 429 errors".
- 403 `insufficient_user_quota` = balance empty; 503 = provider throttling.
- **Deprecation policy:** RFC 9745 `Deprecation: @<unix>` + RFC 8594 `Sunset: <HTTP-date>` + `Link rel="deprecation"/"successor-version"` headers per model; retired ids → `404 model_retired`; removed ids → `410 Gone`; index at `/models/retirements`. **No fixed notice window** ("no universal advance-notice duration"). The user-reported "60 models deprecating" is not what the live page shows (~7 deprecating / ~35 retired today, e.g. `gpt-5.6-sol`, `gpt-5.6-terra`, `mimo-v2.6-pro` deprecating; `gpt-4o-free`, `gpt-4.1-free`, `gpt-5.5-free`, `gemini-3.x-flash-free` already retired) — but **free-model churn is real and fast**: of the 60 links on `/models/free`, only 45 are live-and-free in the catalog JSON. `gpt-5.6-sol`/`-terra` (paid) are mid-deprecation — treat any specific id as perishable.
- Blog "27+ free models" is outdated marketing; live count is **45 free (`pricing 0/0`, active)**.

## 4. Models catalog (as verified 2026-09-22)

### Free lane (exact live ids, all `pricing {input:0, output:0}`, `retire_stage: active`, 45 total)
Best relay-safe picks (text, tool-calling flagged, ≥256k ctx unless noted):
`xiaomi-mimo-v2.6-pro-free` (1M ctx, text+image+audio+video in) · `xiaomi-mimo-v2.6-flash-free` (1M, omni-in) · `coding-glm-5.3-free` (1M, thinking/tools/fc/structured) · `coding-glm-5.3-flash-free` (1M, same feats, video-in) · `coding-glm-5.2-free` (1M, same feats) · `coding-kimi-k3-free` (1M, thinking/fc/structured, image+video in) · `coding-minimax-m3-free` (1M) · `nemotron-3-ultra-550b-a55b-free` (1M) · `nemotron-3-super-120b-a12b-free` (1M) · `nemotron-3.5-lightning-free` (1M) · `laguna-s-2.1-free` (1M) · `nemotron-3-nano-30b-a3b-free` (1M) · `qwen3.6-plus-preview-free` (1M, thinking) · `hy3-free` (256k, web+thinking+tools) · `minimax-m2.7-free` (200k) · `union-alpha-free` / `agents-a1-free` / `intern-s2-free` (262k, image-in) · `kimi-for-coding-free` (256k) · `nemotron-3-nano-omni-30b-a3b-reasoning-free` (262k, omni-in) · `nemotron-nano-12b-v2-vl-free` (131k, vision) · `lfm-2.5-2.6b-free` (131k, tiny) · `ling-3.0-flash-free` / `ling-3.0-tiny-free` (262k) · `north-mini-code-free`, `laguna-xs-2.1-free`, `nemotron-3.5-content-safety-free`, `dots-3-note-preview-free`, `glm-4.7-flash-free`, `coding-minimax-m2.7-free`, `k2.6-code-preview-free`, plus legacy `coding-glm-5.1/5/5-turbo/4.7/4.6-free`, `coding-minimax-m2.5/m2.1/m2-free`, `xiaomi-mimo-v2*/v2.5*-free`, `mimo-v2-flash-free`. (User-listed `jina-ocr-v1` is free but `type=ocr` — not a chat model; `dots3-note-preview-free` is actually `dots-3-note-preview-free`.)

### Frontier lane (exact ids + verified USD/1M pricing + ctx)
| id | in/out $ | ctx | feats |
|---|---|---|---|
| `claude-opus-5` | 5 / 25 | 1,000,000 | thinking, tools, structured, web |
| `claude-sonnet-5` | 2 / 10 | 1,000,000 | thinking, tools, fc, structured |
| `gpt-5.6-luna` | 0.2 / 1.2 | 1,050,000 | tools, thinking, structured |
| `gemini-3.6-flash` | 1.5 / 7.5 | 1,048,576 | thinking, tools, fc, structured, web |
| `grok-4.5` | 2 / 6 | 500,000 | thinking, tools, fc, structured |
| `qwen3.8-max` | 1.69 / 5.07 | 1,000,000 | tools, fc, structured, web, thinking |
| `deepseek-v4-flash` | 0.142 / 0.284 | 1,000,000 | tools, fc, structured, thinking |
| `glm-5.2` | 1.1268 / 3.9438 | 1,000,000 | thinking, tools, fc, structured |
| `glm-5.3-flash` | 0.1127 / 0.394 | 1,048,576 | thinking, tools, fc, structured |
| `kimi-k3` | 3 / 15 | 1,048,576 | thinking, fc, structured |
| `gpt-6-astra` | 10 / 50 | 1,050,000 | flagship OpenAI (spec example model) |
| `auto` | (router) | — | see §5 |

All user-named frontier ids verified **except** `glm-5.2-free` (does not exist; free GLM ids are `coding-glm-5.x-free`).

## 5. LLM Router (`model: auto`) — verdict

**What it is:** gateway-side per-request model selection. Set `model` to `auto` (or `auto:balanced` / `auto:quality_first` / `auto:latency_critical`; bare `auto` = `cost_optimized`; **unknown suffix silently falls back to cost_optimized, no error**). The gateway extracts request features → hard-filters (modality, context, circuit-breaker, key's allowed models) → weighted-scores capability/cost/latency → rewrites the model. ~1 ms overhead, works with `stream: true` (routing happens before upstream).

**Exact request format:**
```bash
curl https://aihubmix.com/v1/chat/completions \
  -H "Authorization: Bearer <AIHUBMIX_API_KEY>" -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "…"}]}'
```
Response body `model` is backfilled with the real resolved model; headers: `x-aihubmix-router-resolved-model`, `-policy`, `-dimension`, `-decision-id`, `-reason` (`policy=… dim=… top=… survivors=20/33`), `-fallback: true` (no-candidate fallback), `-sticky: true` (session reuse). Session stickiness via `X-Aihubmix-Session-Id: <id>` header (Claude Code/Codex/OpenCode session ids auto-recognized). Billed at the resolved model's list price — **no surcharge**.

**Scope/limits:** chat completions + `/v1/images/*` only — **not** `/v1/embeddings`, `/v1/rerank`, audio. `?router=off` or header `X-Router-Off` + `model:auto` → explicit 400. Key's model allowlist constrains candidates (out-of-range → never resolved; nothing fits → 403). Can be restricted to a price tier via key allowlist.

**Verdict: YES — usable as a single `aihubmix-router` lane.** It is a genuine platform-hosted auto-router with observable resolution (headers + body), fallback built in, and a keyless scoreboard (`GET /api/router/leaderboard`) we can poll to know the current pool (currently 17 models: claude-opus-5, claude-sonnet-5, gpt-5.6-sol, gpt-6-astra, kimi-k3, kimi-k2.7-code, qwen3.8-max(+flash/-0902), qwen3.7-max, deepseek-v4-flash-0731, deepseek-v4-pro-0813, glm-5.3-flash, gemini-3.8-flash, hy4-preview, solar-pro4, claude-fable-5-1). Caveats for an agentic client: resolution is non-deterministic by design (pool/price drift; use `-sticky` + session id for cache reuse; pin concrete ids when determinism matters), and `auto` will never pick free models reliably (cost_optimized picks cheapest *paid-capable* fit; free models have their own budget walls).

**Complementary Key-level features (console, zero client code):** *Model Mapping* (char-for-char alias → real model, per key) and *Error Fallback* (ordered backup list; triggers only when all channels of the primary fail retryably **before first byte**; key-quota/ban errors never fall back; **free models are silently skipped in fallback lists — free may only be primary**; fallback to paid after free-primary hits limits is the documented pattern). Verification headers: `X-Aihubmix-Fallback: true`, `X-Aihubmix-Model`. *Structured Output Repair* (Key toggle, off by default): gateway auto-repairs malformed JSON (truncation, code fences, trailing commas, single quotes, unquoted keys, mixed text) for non-streaming requests that declare `response_format json_object/json_schema`.

## 6. Nonstandard-vs-OpenAI quirks list (relay-relevant)

1. **Body params** = vanilla OpenAI plus: `top_k` (passed to Anthropic<4.6/Gemini/Cohere, ignored by OpenAI), `verbosity` (low/medium/high), `web_search_options`. Both `max_tokens` and `max_completion_tokens` accepted. `reasoning_effort` enum: none/minimal/low/medium/high/xhigh (mapped per vendor: xhigh→claude max; kimi-k3 adds `max` via reasoning_options); alternative `reasoning:{effort}` or `reasoning:{max_tokens}` accepted ("Unified Reasoning Parameters").
2. **Extra response fields:** thinking models add `message.reasoning_content` (string) + `message.reasoning_details` (object with `type:"thinking"`, `signature` — preserve for multi-turn quality); usage may add vendor detail blocks e.g. `usage.claude_cache_tokens_details`.
3. **Extra request headers:** `APP-Code: <code>` (10% discount on all models except Claude series, from aihubmix.com/appstore), `X-Aihubmix-Session-Id`, `X-Router-Off`, `anthropic-version` on `/v1/messages`. Router/fallback response headers are `x-aihubmix-*` (lowercase on HTTP/2).
4. **Error contract** is OpenAI-shaped `{error:{message,type,…}}` + `request_id`/`tid` trace ids; statuses: 429 (Retry-After; IETF RateLimit headers), 403 `insufficient_user_quota`, 503 (provider throttled), **404 `model_retired`** (explicit code), **410 Gone** (id removed from catalog), 400 passthrough upstream param errors.
5. **Model mapping/renaming surprises:** removed models can be **auto-remapped** by the platform (e.g. date-suffixed Claude ids silently routed to newer series per changelog); Key-level mapping rewrites aliases char-for-char; free models silently skipped in fallback; fallback may swap the responding model (read `X-Aihubmix-Model`, never trust request `model` for billing/capability).
6. **Free-model budget wall:** 429s are routine on popular free ids (documented per-model-page warning); weight_map means "1 request" can consume 2–10 quota units on heavier free models.
7. **Streaming:** standard SSE `data:` chunks → `data: [DONE]` (per-model llms.txt); router treats stream/non-stream identically; fallback impossible after first byte.
8. **tools/function calling on free models:** catalog `features` marks `tools/function_calling` for most `coding-*-free` ids (coding-glm-5.2/5.3, coding-minimax-*, kimi-for-coding-free, hy3, k2.6-code-preview-free…) — supported at the gateway via vanilla `tools`/`tool_choice`; some free ids carry **no capability flags at all** (xiaomi-mimo-v2.6-*-free, agents-a1-free, union-alpha-free, intern-s2-free: "absence means unverified, not unsupported" — per-model llms.txt). Verify with a minimal real call per id before relying on tools.
9. **Catalog count reality:** 892 claimed → 852 in live JSON (`types` incl. non-LLM); 407 in keyless `/v1/models` default group. `/models/free` page (60) overstates vs. live 45 — page includes retired ids. Catalog rotates weekly (changelog shows ~20 new models/month).
10. Not supported: fine-tuning, no sandbox host ("free models on production base URL are the test path").

## 7. Recommended integration config

```yaml
provider: aihubmix
baseUrl: https://aihubmix.com/v1        # backup lane: https://api.inferera.com/v1 (byte-identical probe)
auth: Authorization: Bearer ${AIHUBMIX_API_KEY}   # sk-… key; key-level allowlist+spend cap recommended
apiStyle: openai-chat                    # vanilla OpenAI wire; SSE streaming supported
extraHeaders:
  APP-Code: ${AIHUBMIX_APP_CODE}        # optional 10% off (non-Claude), from aihubmix.com/appstore
timeoutBudget: { firstByte: 60s }        # fallback only pre-first-byte, so retries are safe
```

**Free lane roster (exact ids, tools-capable first, all verified live $0):**
`coding-glm-5.3-free`, `coding-glm-5.3-flash-free`, `coding-glm-5.2-free`, `coding-kimi-k3-free`, `coding-minimax-m3-free`, `xiaomi-mimo-v2.6-pro-free`, `xiaomi-mimo-v2.6-flash-free`, `nemotron-3-ultra-550b-a55b-free`, `nemotron-3-super-120b-a12b-free`, `nemotron-3.5-lightning-free`, `qwen3.6-plus-preview-free`, `laguna-s-2.1-free`, `hy3-free`, `kimi-for-coding-free`, `minimax-m2.7-free` *(fallback pool: `nemotron-3-nano-30b-a3b-free`, `ling-3.0-flash-free`, `union-alpha-free`, `intern-s2-free`, `agents-a1-free`)*

**Frontier lane roster (exact ids, verified pricing):**
`claude-opus-5`, `claude-sonnet-5`, `gpt-5.6-luna`, `gemini-3.6-flash`, `grok-4.5`, `qwen3.8-max`, `deepseek-v4-flash`, `glm-5.3-flash`, `glm-5.2`, `kimi-k3` *(budget pick: `deepseek-v4-flash` at $0.142/$0.284)*

**Safe as relay hops:** paid frontier ids are safe (no budget wall, fallback-eligible). Free ids are safe as **primary/hop** but expect 429 under load → order roster heavy→light and rotate on 429; **never configure free ids as the fallback target of another lane** (AIHubMix silently skips them; our relay must do its own failover). Keep `max_tokens` (not `max_completion_tokens`) for widest free-model compatibility; treat `reasoning_content` as pass-through opaque.

**Tracker polling (all keyless, ETag/304-friendly):**
1. `GET https://aihubmix.com/api/v1/models` (300 s cache; filter `types` contains `llm`, `pricing.input==0 && pricing.output==0` → free lane; `retire_stage`/`retired_at`/`successor_model` → lifecycle; diffs → roster add/remove alerts)
2. `GET https://aihubmix.com/call/free_quota_config` (live enforced limits/weight_map)
3. `GET https://aihubmix.com/api/router/leaderboard` (router pool drift)
4. `GET https://aihubmix.com/models/retirements` (SSR; deprecation list) + per-model `GET https://aihubmix.com/model/<id>/llms.txt` (returns 200 with retirement notice even after retirement — cheap liveness probe before calling; call itself → 404 `model_retired`)
5. Poll cadence: catalog+quota every 6 h; leaderboard every 1 h; per-model llms.txt on 404 `model_retired` before dropping an id.

**Router lane verdict:** add `aihubmix-auto` as a pseudo-model lane sending `model:"auto"` (optionally `auto:balanced`), set `X-Aihubmix-Session-Id` per conversation for stickiness, read `x-aihubmix-router-resolved-model` from the response for logging/billing truth, and accept 400 if we ever send `auto` with `X-Router-Off`. Not usable for embeddings/rerank lanes.
