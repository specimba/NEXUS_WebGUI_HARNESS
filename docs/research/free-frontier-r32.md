# r32 Research — The Frontier-Freedom Gateways (OpenCode Zen, Kilo Gateway, MiMo V2.6)

> Live-verified 2026-09-23 (curl probes from the sandbox + tracker ingest).
> Companion to `integration-plan-r31.md`; feeds the Free/New Model Tracker.

## 1. The two "big providers free frontier LLMs to the public"

The user's directive named them "OpenCore" and "the KiloCode gateway".
Identity resolution (evidence-first, no fabrication):

### 1.1 "OpenCore" → **OpenCode Zen** (`opencode.ai/zen`)
- `GET https://opencode.ai/zen/v1/models` → **200 keyless, 80 lanes** [VERIFIED-fetched]
  - The ENTIRE closed frontier on one platform: `claude-fable-5(-1)`,
    `claude-opus-5-5 → 4-5`, `gpt-6-astra/sol/luna`, `gpt-5.6-*`,
    `gemini-3.8/3.7/3.6-flash`, `grok-4.7/4.6/4.5`, `deepseek-v4.1-flash`,
    `glm-5.3`, `kimi-k3`, `minimax-m3`, `qwen3.8-flash`, `jev-1.13`…
  - Standing **free lanes** (suffix `-free`): `nemotron-3-ultra-free`
    (550B-A55B frontier MoE!), `mimo-v2.6-flash-free`, `deepseek-v4-flash-free`,
    `jev-1.13-free`, `space-bunny-free`, `ling-3.0-flash-fin-free`,
    `nemotron-3.5-lightning-free`, `muse-spark-1.3/1.2-contributor-free`.
  - Chat endpoint `POST /zen/v1/chat/completions` requires a key (AuthError
    "Missing API key" verified) → BYOK pattern identical to our other providers.
- Verdict: this is the platform the user means. Integrate as `opencode`.

### 1.2 "KiloCode gateway" → **Kilo Gateway** (`kilo.ai`, ex-KiloCode)
- `GET https://api.kilo.ai/api/gateway/v1/models` → **200 KEYLESS, 393 lanes**,
  OpenRouter-shaped (`id/name/created/pricing/context_length/isFree`)
  [VERIFIED-fetched]
  - `kilo-auto/free` — "Rotates through available free models. Limited
    capability and **no credits required**" — Kilo's answer to `openrouter/free`.
  - `kilo-auto/efficient` — routes each request to the cheapest capable model;
    `kilo-auto/balanced` — price/quality router.
  - 20+ `:free` lanes incl. `nvidia/nemotron-3-ultra-550b-a55b:free`,
    `poolside/laguna-s-2.1:free` (118B coding agent),
    `nex-agi/nex-n2.5-pro:free`, `inclusionai/ling-3.0-flash-vl:free`,
    `qwen/qwen3.8-27b:free`, `z-ai/glm-5.2:free`,
    `thinkingmachines/inkling-small:free`, `dots-studio/dots-3-note-preview:free`.
  - Keyless chat attempt routed to the upstream lane and returned a lane-level
    429 (Poolside) — the gateway itself accepted the request; free lanes
    rate-limit. Key from kilo.ai (simple registration) for reliable use.
- Verdict: integrate as `kilo`. NOTE: `opencore.dev` is an unrelated parking
  page — documented here so nobody chases it again.

## 2. MiMo V2.6 family (Xiaomi — released Sep 21, 2026, open-sourced)

OpenRouter `/api/v1/models` (parsed live, USD per 1M):

| lane | ctx | $in | $out | note |
|---|---|---|---|---|
| `xiaomi/mimo-v2.6-pro` | 1,048,576 | **$0.435** | **$0.87** | 1T+ MoE omni flagship — cheapest frontier lane in our vault |
| `xiaomi/mimo-v2.6-flash` | 1,048,576 | $0.14 | $0.28 | 309B MoE workhorse |
| `xiaomi/mimo-v2.6-pro-ultraspeed` | 1,048,576 | $4.35 | $8.70 | speed edition |
| `xiaomi/mimo-v2.5-pro` / `v2.5` | 1,050,000 | — | — | previous gen, still up |

- Also live on Kilo Gateway (same ids) and OpenCode Zen (`mimo-v2.6-flash-free`).
- AIHubMix already carries `xiaomi-mimo-v2.6-pro-free` (r30). Sources: mimo.xiaomi.com
  ("MiMo-V2.6 series… two natively omnimodal models"), testingcatalog.com
  ("Xiaomi open-sources MiMo-V2.6 Pro and Flash"), aihubmix free-lane page.

## 3. What shipped (r32-3)

| layer | change |
|---|---|
| `src/lib/providers.ts` | + `opencode` (OpenCode Zen) + `kilo` (Kilo Gateway) featured registry entries w/ verified lanes; OpenRouter curated models + `xiaomi/mimo-v2.6-pro` + `xiaomi/mimo-v2.6-flash` |
| `src/lib/provider-refresh.ts` | `KEYED_ENDPOINTS` + `opencode` / `kilo` (both `keyOptional: true` — public rosters) |
| `src/lib/tracker-sources.ts` | Tier-A keyless sources `fetchKilo` (rich: pricing/created/isFree) + `fetchOpencode` (sparse: free by `-free` suffix only — never inferred) |
| `src/lib/relay.ts` | ARENA_CATALOG + `opencode` (frontier T1 + free-lane T2 hops) + `kilo` (mimo T1, auto/free + :free T2 hops); OpenRouter + 2 MiMo hops |

All 7 tracker sources green on first ingest: aihubmix 412 · openrouter 455 ·
orcarouter 182 · pollinations 1 · **kilo 392** · **opencode 80** · hf-signals 60.

## 4. Upstream-stall hardening (r32-4) — the "upstream stalled: no data for 15s" class

Production failure (user screenshot): a 15-tool web-research turn died at the
finish line with `upstream stalled: no data for 15s` — everything lost. Root
cause chain: idle-chunk deadline fires mid-answer → `streamedAny=true` blocks
the pre-stream retry → `clientSawTokens=true` blocks relay rotation → honest
error → whole turn wasted.

Fixes (`src/lib/agent-engine.ts`):
1. **Mid-run stall resume** (custom/relay engine): when an
   `UpstreamDeadlineError` fires after tokens streamed or tools executed, the
   engine now keeps the executed tool results (already in `msgs`) and re-asks
   for a **full self-contained answer** (`STALL_RESUME_NUDGE`), capped by
   `MAX_STALL_RESUMES = 2`. Labeled `iterationLoop` so the resume continues
   the outer iteration loop; boundary-guarded so a resume can never fall off
   the iteration cap.
2. **Built-in engine pre-stream retry** (relay runner): the auto hop now gets
   ONE transparent retry when a transient error fires before the first token
   (`autoRetried` flag); after tokens the honest-error path is unchanged
   (no duplication ever).

Suite-facing effect: the two web pipelines that "caught real provider stalls"
in r31's maiden run now survive the stall class instead of failing honestly.

## 5. Don'ts (unchanged doctrine)
- No stateful MCP transport; no A2A; no Cordis; skill scripts never leave the
  node:vm sandbox; free-lane freeness is never inferred — only suffix/flag/price
  evidence counts (`big-pickle` on Zen has no `-free` suffix → NOT marked free).
