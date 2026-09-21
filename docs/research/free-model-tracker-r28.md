# r28-3b — Vyce catalog enumeration + Qwen 3.8 Flash verification + free/new-model tracker design

**Agent:** research-only sub-agent (r28-3b) · **Date:** 2026-09-21 (01:10 UTC) · **Scope:** research only, 0 app-code changes.
**Method:** live `curl` keyless probes (no real API keys sent anywhere), SPA bundle analysis of vyceai.com, HF hub API, OpenRouter/OrcaRouter live catalogs, 2 web-search passes. Raw evidence cached in `/tmp/r28/`, prior-round Vyce key-authed evidence in `/tmp/r27/vyce_auth.json`.

---

## 1. Vyce catalog API findings

### 1.1 Endpoint map (live-probed 2026-09-21, all keyless)

| Endpoint | Status | Verdict |
|---|---|---|
| `GET https://vyceai.com/v1/models` (no auth) | **401** `{"error":{"message":"Invalid API key.","type":"authentication_error","code":"invalid_api_key"},"request_id":"req_…"}` (OpenAI-shaped JSON) | Key **required**. Matches r27 audit — `KEYED_ENDPOINTS.vyce.keyOptional:false` is correct. |
| `GET https://api.vyceai.com/v1/models` | **000** (host does not resolve) | `api.vyceai.com` does not exist — the API is served from the apex domain `vyceai.com/v1`. |
| `GET https://vyceai.com/api/models`, `/api/v1/models`, `/models`, `/leaderboard`, `/user/models`, `/api/status`, `/llms.txt` | 200 but identical **5309B SPA HTML shell** | Vite SPA catch-all; there is **no public JSON models API** outside `/v1/*`. |
| `GET https://vyceai.com/sitemap.xml` | 200 XML | Only `/`, `/login`, `/signup`, `/terms`, `/privacy` — no models route. |
| `GET https://vyceai.com/robots.txt` | 200 | Disallows `/dashboard`, `/dashboard-v2`, `/admin` — confirms the model table the user screenshotted lives behind dashboard auth or in the landing bundle. |
| `GET https://vyceai.com/user/dashboard` | **401** `not_authenticated` | Dashboard data is session-cookie-gated (web auth), separate from Bearer `/v1` auth. |
| `GET https://vyceai.com/v1/me` (no auth) | **401** `invalid_api_key` | Same Bearer gate; already wired as the provider's `mePath` credits widget. |

### 1.2 Key-authed `/v1/models` — documented shape (r27 evidence, /tmp/r27/vyce_auth.json)

The r27-2b round live-probed `GET https://vyceai.com/v1/models` **with the app's vault key** (Bearer, the OpenAI-compatible documented way for this gateway). We did NOT resend any key this round; the cached response documents the shape:

```json
{"object":"list","data":[
  {"id":"qwen3.8-flash","created":1719792000,"owned_by":"alibaba","object":"model","requires_verification":true,"context_window":1000000},
  {"id":"claude-sonnet-4-6","created":1719792000,"owned_by":"vyce",  "object":"model","requires_verification":true,"context_window":270000},
  ... 7 total: claude-sonnet-4-6, qwen3.8-flash, deepseek-v4-flash, deepseek-v4.1, agnes-3.0-flash, deepseek-v4-flash-lr, grok-imagine-2 ...
]}
```

- Fields available: `id`, `owned_by` (⚠ **"alibaba"** for qwen3.8-flash — Vyce itself attributes it to Alibaba), `context_window`, `requires_verification` (tier gate), `created`.
- ⚠ **`created` is a STATIC placeholder** — every model carries `1719792000` (2024-07-01). It is **useless for new-model diffing**; the tracker must stamp its own `first_seen`.
- **No pricing in `/v1/models`** — pricing lives on the landing page/dashboard only.
- This is exactly what the existing `POST /api/providers/free-models` + `KEYED_ENDPOINTS.vyce` path already does (key travels per-request from the vault, nothing stored server-side) — the tracker should reuse that transport, not invent a new one.

### 1.3 Keyless enumeration fallback — the landing bundle (works TODAY, brittle)

`vyceai.com` serves a public Vite bundle (`/assets/index-vi5lGFii.js`, 596KB) containing the landing-page Models table **as static data** — fetchable with zero auth:

- Featured-free list `ub`: `gpt-5.6-new, claude-sonnet-4-6, qwen3.8-flash, deepseek-v4-flash, deepseek-v4.1, agnes-3.0-flash`; paid list `mb`: `gpt-astra, gpt-5.6-sol, grok-4.6, gpt-5.6-terra, deepseek-v4-pro (status:"coming")`.
- Full context map `cb` (24 entries), incl. `"qwen3.8-flash":"1M","qwen3.8-max":"1M","deepseek-v4-pro":"1M","agnes-3.0-flash":"512K","glm-5.3-flash":"500K"`.
- Featured spec objects `hb`, e.g. `{"id":"qwen3.8-flash","name":"Qwen 3.8 Flash","description":"Alibaba Cloud's ultra-fast flagship…","inputPrice:.1,outputPrice:.4,status:"healthy",requiredTier:"free",contextWindow:"1M"}`.
- The bundle even hardcodes a shimmer highlight badge for `qwen3.8-flash` — Vyce is actively marketing it as the new arrival.

**Caveats:** (a) the full static list ≠ live free-tier roster (r27 key-authed /v1/models returned only 7 ids; e.g. `gpt-5.6-new` is on the landing page but not in a free account's API roster); (b) the bundle hash changes on every deploy — this is a manual/fallback technique, never an automated tracker source. Recommended parsing trigger: regex the newest `/assets/index-*.js` referenced by `https://vyceai.com/` for `"inputPrice":` blocks.

### 1.4 Verdict + tracker recommendation for Vyce

- **Best enumeration strategy: key-authed `GET https://vyceai.com/v1/models` (Bearer = the vault's Vyce key) via the existing `POST /api/providers/free-models` route.** OpenAI-compatible, returns id + ctx + owned_by; no pricing; `created` unusable.
- Keyless automated enumeration: **not possible** (401). Web fallback: static bundle scrape (manual / low-frequency sanity check only).
- Tracker design under each outcome: when a Vyce key is saved → poll with the key (tier-B source, full fidelity); when no key → Vyce drops to "corroborated by public gateway listings" (qwen3.8-flash is visible keylessly on OpenRouter + OrcaRouter) or the manual bundle check.

---

## 2. Qwen 3.8 Flash verification — **VERDICT: REAL** ✅

Claim under test (user's screenshot of Vyce's site): *"Qwen 3.8 Flash — Alibaba Cloud's ultra-fast flagship model with 1M context, high-throughput inference, and full function calling. qwen3.8-flash, online, 48438ms, $0.1 in / $0.4 out."*

### 2.1 Independent evidence (4 sources beyond Vyce)

| # | Source | Evidence |
|---|---|---|
| 1 | **HuggingFace, official Qwen org** (live API, 200): `huggingface.co/api/models/Qwen/Qwen3.8-Flash-Next` | Created **2026-08-24**, 761,112 downloads, 5,492 likes, `pipeline_tag: image-text-to-text` (multimodal). The gateway-facing "Qwen 3.8 Flash" maps to this release (OpenRouter's `hugging_face_id` for `qwen/qwen3.8-flash` = `Qwen/Qwen3.8-Flash-Next`). Note: `Qwen/Qwen3.8-Flash` (non-Next) 401s on HF — the public release is Flash-**Next**. |
| 2 | **OpenRouter live catalog** (keyless 200, 446 models): `qwen/qwen3.8-flash` | ctx **1,000,000**, created **2026-08-26**, pricing **$0.15/M in · $0.47/M out** (`prompt:"0.00000015"`, `completion:"0.00000047"`), tools supported (`supported_parameters` incl. tools), HF id as above. |
| 3 | **OrcaRouter live catalog** (keyless 200, 197 models): `qwen/qwen3.8-flash` | Present alongside `qwen/qwen3.8-max`, `qwen/qwen3.8-max-0902`, `qwen/qwen3.8-27b`, `obsidian/Qwen3.8-27B`. |
| 4 | **Web search** (2 passes, ≥6 independent hosts) | qwen.ai official: *"Today, we are officially releasing Qwen 3.8-Max"* (Aug 2, 2026); SCMP Aug 3: Qwen3.8-Max 2.4T MoE flagship; AI Business Aug 26: *Qwen 3.8 Flash-Next* = multimodal early preview of the **Qwen 4 architecture** (125B-class); InferenceX (SemiAnalysis): Qwen3.8-Flash-Next **176B-A6B** live evals; kie.ai Aug 29 + codersera Sep 3 ("$0.15/$0.47") + baseer.dev Sep 12 ("native 1M context") — all describing **Qwen 3.8 Flash** as Alibaba's fast multimodal MoE with 1M ctx and function calling; DataCamp Sep 18: Qwen3.8-Omni-Flash + third-party "Qwen 3.8 Flash" routes at $0.14–$0.15/$0.47–$0.49; HN thread "Qwen 3.8 Omni Flash" (Sep 18). Family context: Groq already serves `qwen/qwen3.8-27b` (r27-verified), Cerebras `qwen-3.8-27b`. |

### 2.2 Record

- **Exact id on Vyce:** `qwen3.8-flash` (confirmed in r27's key-authed `/v1/models` response with `owned_by:"alibaba"`, `context_window:1000000`, and in Vyce's landing bundle with `status:"healthy"`, `requiredTier:"free"`, `inputPrice:.1`, `outputPrice:.4`).
- **Cross-gateway id:** `qwen/qwen3.8-flash` (OpenRouter, OrcaRouter).
- **Context:** 1,000,000 tokens (OpenRouter + OrcaRouter + Vyce all agree).
- **Pricing:** Vyce-specific rate **$0.10/$0.40 per 1M** (cheaper than OpenRouter's $0.15/$0.47 and other listings $0.14–0.15/$0.47–0.49 — a plausible gateway undercut, consistent with Vyce's discount-proxy positioning).
- **Tool calling:** yes (`supported_parameters` includes tools on OpenRouter; "full function calling" in Vyce's description).
- **Genuinely new:** release cadence — Qwen 3.8 family previewed ~Jul 19–20, Max shipped Aug 2–3, Flash(-Next) weights landed on HF **2026-08-24** / OpenRouter **2026-08-26**; Vyce added it to its roster around Sep 19–20 (absent from all pre-r27 app data, flagged "(NEW)" in r27-2b's first sighting on Sep 20, user saw it Sep 21). So: ~4 weeks old upstream, **days old on Vyce** — exactly the "first 1–2 days" window the tracker targets.
- **Honesty notes:** (a) "Qwen 3.8 Flash" as served by gateways maps to the official **Qwen3.8-Flash-Next** weights (some press distinguishes Flash vs Flash-Next naming; the gateway id is uniformly `qwen3.8-flash`); (b) Vyce's "48438ms" is its own latency probe (live metric, not a spec); (c) Vyce's "$0.1/$0.4" is Vyce's rate, not Alibaba's list price; (d) we could not fetch Alibaba Model Studio/Bailian docs from the sandbox to see Alibaba's own API id — the 4 sources above are deemed sufficient (2+ live machine-readable catalogs + official HF org page + press).

**Conclusion: REAL — safe to add to the relay as `vyce / qwen3.8-flash` (T1/T2 flash-class, 1M ctx, tools, $0.10/$0.40 per 1M).** Implementation is a dev-round task (research-only here); integration points: `src/lib/relay.ts` ARENA_CATALOG.vyce + `src/lib/providers.ts` FREE_PROVIDERS.vyce.models. NB: "flash" is in FAST_RE, so task-fit ordering handles it automatically; it would join the chain as a live-✓ hop.

---

## 3. Keyless source probe table (live, 2026-09-21)

| Endpoint | HTTP | Usable fields | Notes / rating |
|---|---|---|---|
| `https://openrouter.ai/api/v1/models` | **200** (738KB, 446 models) | `id`, `name`, `created` (**real unix ts**, newest 2026-09-18), `context_length`, `pricing.prompt/completion` (string $/tok), `supported_parameters`, `architecture`, `hugging_face_id` | ⭐ **Best tracker source.** Free filter = `pricing.prompt=="0" && pricing.completion=="0"` → **24 models today** (better than the app's current `id.endsWith(":free")` heuristic — catches free promos without the suffix). Has everything: price, ctx, created-date for diffing. |
| `https://api.orcarouter.ai/v1/models` | **200** (154KB, 197 models) | `id`, `created` (real ts), `owned_by`, `supported_endpoint_types` | ⭐ Second keyless source, already used keylessly by the app (KEYED_ENDPOINTS `keyOptional:true`). **No pricing** — join pricing from OpenRouter by id when present. |
| `https://text.pollinations.ai/models` | **200** (286B) | `name`, `description`, `tier`, `tools`, `input/output_modalities`, `aliases` | Tiny roster (1 text model today: `openai-fast`). No pricing, no created. Marginal but cheap to poll (app already does). |
| `https://image.pollinations.ai/models` | **200** (8B → `["sana"]`) | name array | Image models only; out of ticker scope (text-only tracker), keep optional. |
| `https://huggingface.co/api/models?search=…&sort=createdAt&direction=-1` | **200** | `id`, `createdAt` (ISO, real), `downloads`, `likes`, `pipeline_tag` | ⭐ **Early-warning source**: open-weight releases appear here days/weeks before gateways list them (e.g. Qwen3.8-27B community mirrors uploaded within the last hour). Filter `pipeline_tag:text-generation` + `downloads/likes` thresholds to cut noise. Also supports per-repo GET (`…/api/models/Qwen/Qwen3.8-Flash-Next` → 200). |
| `https://api.groq.com/openai/v1/models` (keyless) | **403** `{"error":{"message":"Forbidden"}}` | — | Key required (and console.groq.com pages 403 datacenter IPs — r23 known; browser fallback exists). Tier-B (key-authed) only. |
| `https://models.github.ai/catalog` | **404** | — | Not a public JSON catalog. |
| `https://models.inference.ai.azure.com/models` | **000** (no connect) | — | Old GitHub Models endpoint dead/unreachable from sandbox. |
| `https://freellm.sh/api/models`, `/models.json` | **404** (HTML shell) | — | freellm.sh (cited in providers.ts as curation source) is a JS-rendered site with no discoverable public JSON API → manual reference only. |
| `https://artificialanalysis.ai/api/models` | **404** (HTML) | — | No public unauth JSON API found; JS-heavy site. Skip. |
| `https://api.vyce.ai/v1/models` | **000** | — | Domain does not exist (correct host is `vyceai.com`, apex-served API). |
| `https://vyceai.com/v1/models` (keyless) | **401** | — | See §1. Tier-B key-authed only. |

**Other tier-B (key-authed, when the user has the key)** — all already wired through `KEYED_ENDPOINTS` in `src/lib/provider-refresh.ts` (google-ai-studio, mistral, zai, nvidia-nim, sambanova, cohere, together, cerebras, cloudflare): the tracker should reuse that table rather than duplicate endpoints.

---

## 4. Tracker architecture recommendation

### 4.1 Source tiers

- **Tier A — keyless always-on (poll unconditionally):** OpenRouter (primary: full pricing+ctx+created), OrcaRouter (secondary roster), HF hub (early-warning: recent text-generation models with downloads/likes threshold), Pollinations text (cheap completeness).
- **Tier B — key-authed when the user has the key** (reuse `KEYED_ENDPOINTS` + the vault-key-per-request transport of `POST /api/providers/free-models`; keys never persist server-side): Vyce (the whole point for this user), Groq, Google, Z.ai, etc. Store which providers were key-covered in each snapshot so the ticker can say "via your Vyce key".
- **Manual fallback tier:** Vyce landing-bundle scrape (§1.3) and freellm.sh — humans/agents only, never automated.

### 4.2 Cadence + scheduling (client-side-first app)

- **Server route `GET /api/tracker/sync`** (mirror of the free-models route pattern): in-memory + durable `lastSyncAt` guard with `MIN_INTERVAL = 4h` (and a `?force=1` for a manual refresh button); if the TTL is fresh it returns the cached snapshot, else it polls Tier A (+ Tier B only for providers whose key the client supplied in the request body — same no-storage rule).
- **Client poll:** on app open, every 15–30 min `setInterval` while the app is open (same pattern as the workflow scheduler's 10s tick), plus on window `focus` (catches "opened the laptop after 6h" → instant catch-up). The 4–8h upstream cadence is enforced server-side by the TTL; the client can poll more often safely.
- No cron needed — a local-first single-user app doesn't need background collection while closed; the first sync after any ≥4h gap is the "tick".

### 4.3 Snapshot + diff storage

- **Durable: Prisma SQLite** (the schema already exists but is unused demo — add `TrackedModelSnapshot` rows). Proposed minimal model:
  - `TrackedModel`: `id (= providerId + "::" + modelId)`, `providerId`, `modelId`, `firstSeenAt`, `lastSeenAt`, `removedAt?`, `metaJson` (ctx, priceIn, priceOut, name, hfId, upstream created).
  - `TrackerEvent`: `type ∈ {added, removed, price_changed, back}`, `trackedModelId`, `at`, `detailJson`. The ticker renders events of the last N days ordered by `at desc`.
- **Instant render: localStorage mirror** (`praison-model-tracker`) holding the last snapshot + unresolved events, so the ticker paints before the server answers (matches the app's localStorage-doctrine for relay health / live catalog).
- Diff algorithm per source: compare new `{providerId, modelId}` set vs snapshot → added/removed; for surviving ids compare price/ctx → `price_changed` (OpenRouter only, where pricing exists).

### 4.4 Dedup / id strategy

- Stable key = `providerId::modelId` — identical to the relay's `hopKey()` (relay.ts:179) and the per-chat pin format, so a ticker row can offer **"Add to relay"** that maps 1:1 onto an ARENA_CATALOG/live-catalog entry.
- Keep variants distinct (`qwen/qwen3.8-flash` vs `qwen/qwen3.8-flash:free` are different lanes) but group them under a normalized display family (strip owner prefix + suffixes) so 3 listings of one release read as one ticker item with per-provider badges.

### 4.5 Avoiding false "new" alerts (churn defense)

1. **Baseline-first:** the very first sync only records the snapshot — never alerts.
2. **Confirm-on-second-sight:** an `added` event is emitted only when the id is seen in **two consecutive polls** (i.e. ≥4h persistence) OR appears in ≥2 independent sources in the same sweep (e.g. Vyce + OpenRouter same-day, which is exactly the qwen3.8-flash signature).
3. **Filter non-text/internal ids** with the existing `NON_TEXT_RE` (provider-refresh.ts:44) and drop ids matching `/embed|whisper|tts|imagine|image/i`.
4. **Removal grace:** a missing id becomes `removed` only after 2 consecutive misses (gateways blip).
5. **Ignore upstream `created`-field quirks** (Vyce's static 1719792000; OpenRouter's created = gateway-listing date, not upstream release) — first_seen is the tracker's own clock; the UI labels it "first seen by tracker", never "released".
6. **Rate-limit hygiene:** 4h TTL → ~6 upstream calls/day/source; set 10–12s `AbortSignal.timeout`, honor 429 with a backoff stamp (reuse `isHardRelayFailure` soft-fail doctrine).

### 4.6 Ticker UI fields (per event row)

`provider glyph + name` · `model id (click-to-copy)` · `ctx` (e.g. "1M") · `$in / $out per 1M` · badge: **FREE** (both prices == 0) / **CHEAP** (in ≤ $0.25/M) / **NEW** · `first_seen age` ("3h ago") · source note ("via your Vyce key" / "keyless") · action: *Add to relay* (deep-link into Settings → Model Relay) and *dismiss*. Sort: FREE/CHEAP first, then first_seen desc. Keep it a slim bar above the composer/chat (ticker-style), full history in a Radar-style panel later.

### 4.7 Risks

- **Sandbox/region egress:** Groq/Cerebras/Google 403 datacenter IPs (known since r23) → tier-B sources must keep the existing browser-fallback path (`browserRefreshModels`) when the server is blocked; ticker marks such providers "unpolled this cycle" instead of failing loudly.
- **Rate limits:** trivial at 4–8h cadence; OpenRouter/HF tolerate far more — but a "force refresh" button must be debounced.
- **Model-id churn / re-listing:** gateways rename (`-free` suffixes, `-0902` date stamps, Flash→Flash-Next mapping); the confirm-on-second-sight + family-grouping rules absorb most of it; accept residual: a rename may show as added+removed pair (UI can auto-link same-family pairs within 48h).
- **Static-placeholder dates:** never trust upstream `created` for "newness" (Vyce's is constant; documented above).
- **Pricing skew:** gateway price ≠ vendor list price (Vyce $0.1/$0.4 vs OR $0.15/$0.47 for the same weights) — always label price with the provider it came from.
- **Prisma drift:** the tracker is the first real Prisma consumer — needs `prisma migrate dev` in the dev round; if that's unwanted, the whole thing can run on a versioned localStorage snapshot (fallback design, same diff logic, weaker durability).

---

## 5. References

- Vyce live probes (this round, /tmp/r28/): `vy_v1models` 401 JSON, SPA shell duplicates, sitemap.xml, robots.txt, `vy_index.js` bundle (static model list, context map `cb`, featured specs `hb`, highlight badge code for qwen3.8-flash).
- Vyce key-authed shape: /tmp/r27/vyce_auth.json (r27-2b live probe, 7 models, `owned_by:"alibaba"` for qwen3.8-flash).
- OpenRouter: https://openrouter.ai/api/v1/models (446 models, `created`+`pricing`; `qwen/qwen3.8-flash` row).
- OrcaRouter: https://api.orcarouter.ai/v1/models (197 models, `created`; qwen3.8 family rows).
- HuggingFace: https://huggingface.co/api/models/Qwen/Qwen3.8-Flash-Next (created 2026-08-24, 761K dl); `?search=qwen3.8&sort=createdAt`.
- Press/family: qwen.ai Qwen3.8-Max release (Aug 2, 2026); SCMP Aug 3; AI Business Aug 26 (Flash-Next = Qwen 4 architecture preview); InferenceX (semianalysis) Flash-Next 176B-A6B; kie.ai Aug 29; codersera Sep 3; baseer.dev Sep 12; DataCamp Sep 18 (Qwen3.8-Omni-Flash, Venice $0.14/$0.49); HN "Qwen 3.8 Omni Flash".
- App integration targets: src/lib/relay.ts (ARENA_CATALOG.vyce, hopKey), src/lib/providers.ts (FREE_PROVIDERS.vyce), src/lib/llm-config.ts (resolveExplicitLlm), src/lib/provider-refresh.ts (KEYED_ENDPOINTS, NON_TEXT_RE, browserRefreshModels), src/app/api/providers/free-models/route.ts (GET/POST cache pattern), prisma/schema.prisma.
- Prior context: docs/decision-log.md r27 §1.3 (roster truth pass — Vyce keyless 401, qwen3.8-flash first sighting), worklog r27-2b.
