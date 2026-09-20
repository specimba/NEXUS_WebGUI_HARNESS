# Codebase Map — r26/r27 Audit (research-only, no code changes)

Task ID: r26-2b · Agent: research (codebase map) · Scope: verify user-reported bugs (A/B/C) + map 9 topic areas with file:line precision. Baseline commit `659fc9d` ("r27: System-One (Jev) decision tier + route receipts + relay roster truth pass + per-chat model pin"); working tree has ONE uncommitted change: the r26.1 `csrfOk` rebuild in `src/app/api/tools/execute/route.ts` + matching header in `src/lib/tools-defs.ts` (landed this round, NOT a bug).

---

## A. Model Relay catalog — fake `gemini-3.5-pro` (user bug A)

**Status: FIXED in r27 (verified absent from code).**

- Catalog: `ARENA_CATALOG` in `src/lib/relay.ts:57-163` — static doctrine roster `{ tier: 1|2|3, elo, note }` per provider.
- `gemini-3.5-pro` **deleted**; the audit comment sits at `relay.ts:88-91`. Current `google-ai-studio` block (`relay.ts:84-96`): `gemini-3.8-flash` T1 0.975 · `gemini-3.1-pro-preview` T1 0.96 "Strongest current Gemini" · `gemini-3.5-flash-lite` T2 0.88 · `gemini-2.5-pro` T2 0.92 "Legacy". The exact card the user quoted can no longer render — `grep -rn "gemini-3.5-pro" src/` matches only the audit comment.
- Where badges render: `src/components/praison/settings/model-relay.tsx` `HopRow` — `T{tier} {TIER_LABEL}` badge (:263-268, `TIER_LABEL` = Frontier/Modern/Legacy from `relay.ts:443-447`), `Elo {elo.toFixed(2)}` badge (:269-271), note string (:284-286). Label = `${catalog.label} · ${m.id}` (`relay.ts:348`).
- Ordering: health-demoted hops sorted to back, then tier asc → elo desc → task-boost (`relay.ts:378-388`), then saved `settings.relayOrder` respecting demotion (`relay.ts:394-406`), built-in engine pinned last (`relay.ts:409`). With the fake id gone the order is meaningful again.
- r27 truth badge: hops whose id exists in the user's own refreshed live roster get `note … "live ✓"` (`relay.ts:338-353`, `loadLiveCatalog()` from `providers.ts:417-424`); unverified entries render without it — this is the visible fake-vs-verified distinction.

**Residual (P2):** `elo` is a hand-authored 0–1 estimate — there is still no live leaderboard source; `Elo 0.96`-style badges remain on every row by design. The honest framing now is tier + "live ✓" evidence, but a one-line tooltip ("doctrine estimate, not a measured rating") on the Elo badge would remove all ambiguity.

## B. GLM / Z.ai entries (user bug B)

**Status: FIXED — glm-5.3-flash present in both catalog layers.**

- Relay catalog: `orcarouter` → `z-ai/glm-5.3` T1 0.97 (`relay.ts:76`) and `z-ai/glm-5.3-flash-free` T2 0.91 "$0 · GLM 5.3 Flash" (`relay.ts:79`); `zai` provider → `glm-5.3` T1 0.97 (`relay.ts:143`), `glm-5.3-flash` T2 0.92 "cheap tier" (`relay.ts:144`), `glm-4.7-flash` T3 0.86 "$0 Flash" (`relay.ts:145`).
- Provider registry (`src/lib/providers.ts`): `zai` roster = glm-5.3-flash / glm-5.3 / glm-4.7-flash / glm-4.5-flash (`providers.ts:224-230`); `orcarouter` roster includes `z-ai/glm-5.3-flash-free` (`providers.ts:102`). Z.ai guide updated to mention the 5.3 family (`providers.ts:222`).
- Relay task-fit keeps the flash lane fast-class: `FLAGSHIP_RE` uses negative lookahead `glm-5\.3(?!-flash)` (`relay.ts:290`).

## C. Per-chat model pin / "cannot select models from providers we choosed" (user bug C)

**Status: IMPLEMENTED in r27 — picker enumerates ALL keyed registry providers.**

- Type: `Conversation.modelOverride?: string` = `"providerId::model"` (`src/lib/types.ts:117-122`); store action `setModelOverride` (`src/lib/stores.ts:322-326`).
- Picker UI: composer hint-row `ModelPicker` (`src/components/praison/chat/composer.tsx:1027-1037`), options built at `:576-615`:
  - Group "Auto": "Follow global default" (`default`) + "Built-in engine" (`auto::builtin`) (:577-585).
  - Then **every** `FREE_PROVIDERS` entry passing `providerReady()` (`llm-config.ts:87-92` — key in vault, or `noKey`): curated `p.models` + up to 20 live-roster extras badged "live" (:587-613). That covers vyce, orcarouter, groq, google-ai-studio, openrouter, mistral, zai, nvidia-nim, sambanova, cohere, together, cloudflare, pollinations, cerebras — 14 providers.
- Resolution at send time: `chat-view.tsx:229-234` → `resolveExplicitLlm()` (`src/lib/llm-config.ts:99-131`) with graceful no-key/unknown-provider fallback + warning toast; relay wire excludes the pinned hop (`chat-view.tsx:235-237`).

**Remaining gaps (why a user could still feel "cannot select"):**
1. **Legacy custom endpoint** (`provider: "custom"`, arbitrary baseUrl): no curated list and no `/models` enumerator in the picker — if the active brain is a custom endpoint, the picker shows only Auto + keyed providers (P1, `composer.tsx:587` loops `FREE_PROVIDERS` only).
2. Live-roster extras appear **only after** the user pressed "Refresh models" for that provider (localStorage `praison-free-catalog`) — a keyed provider never refreshed shows only its curated rows (P2).
3. No free-text "type any model id" escape hatch in the chat picker (the agent editor has `withSavedOption` for stale ids; chat pin has none) (P2).

Fix sketch for (1): reuse the existing pattern — `providerModelOptions(p, loadLiveCatalog())` (`providers.ts:441-463`) is already the merged curated+live enumerator; add a synthetic provider-shaped entry for the legacy custom endpoint (baseUrl from settings, name = host) or a "Custom endpoint" group in `composer.tsx:576` offering `settings.defaultModel` plus a `<baseUrl>/models` probe via the existing `/api/providers/free-models` POST passthrough (KEYED_ENDPOINTS pattern in `provider-refresh.ts`).

---

## 1. Model Relay core + Route Receipts

- Chain build `buildRelayChain` (`relay.ts:324-411`); wire `buildRelayWire` caps 5 hops (`MAX_RELAY_HOPS` :177; filter :419-441). Failure demotion: `recordRelayHopResult` (:232-264) with hard/soft classification `isHardRelayFailure` (:204-207 — 429/quota never demote), 5-min cooldown (:212), OrcaRouter workspace-wide 429 stamping (:249-260). Health persists in `praison-relay-health`.
- Task fit: `RelayTaskFit = "research" | "quality" | "decision" | "any"` (:54); `taskBoost` (:292-313) — "decision" strongly prefers flash lanes (fast +2 / flagship −2). `FAST_RE`/`FLAGSHIP_RE` (:289-290). Consumed by workflow-runner and `systemone.ts:110`.
- Rotation engine: `runRelayedCustom` (`src/lib/agent-engine.ts:322-421`) — primary stamped with `providerId::model` health key (:335-347), `[hop:…]`/`[hopok:…]` status markers (:373, :416) feed the client health memory via `chat-view.tsx:289-299`; mid-stream death does NOT rotate (:406-409).
- **Route receipts (arXiv:2605.01710):** `RouteReceipt` v0.1 (`types.ts:131-154`: requested/resolved model, `model_identifier_type`, fallback `{status, reason ∈ rate_limit|provider_error|capacity|policy|unknown, from, to}`, `tools_used[]`, `completion_status`, `redactions`). Emitted: relay path `agent-engine.ts:375-401` (+ `receiptReason` :423-430), built-in engine `src/app/api/chat/route.ts:276-292`. Transport: `chat-client.ts:173-177` (browser-direct) and `:317-319` (server SSE). Persist: `chat-view.tsx:238-343` — merges the tool ledger client-side (:332-339) and rewrites `resolved_label` (:329-331). UI: `RouteReceiptChip` (`message-item.tsx:58-140`): consumer tier = quiet "route" chip, amber "fallback used" only when a rotation happened; popover developer tier = Requested / Answered by / Fallback path / Tools ledger / Completion / Redactions + paper citation. Chip renders when `message.receipt` exists and streaming ended (`:603`).

**Receipt gaps vs the paper (P2):** no cost or latency fields (the paper's transparency trio is model/why/**cost**); `completion_status` is hardcoded `"complete"` (`chat-view.tsx:340`, engines emit pre-`done`) so stopped/errored turns never carry an honest receipt; pipeline steps get only `RunCallLogEntry.note` strings, not receipts. Minimal fix: add optional `ms` + `cost_estimate?` fields (schema v0.2) and derive `completion_status` from the run result instead of hardcoding.

## 2. System-One / Jev decision tier

- `src/lib/systemone.ts` (234 lines): Jev native `askJev` → `api.typesafe.ai/v1/systemone`, 5s deadline (:22-96); fast-model JSON judge over `buildRelayChain({taskFit:"decision"})` first 2 non-auto hops, 9s deadline, closed-option-set check (:104-165); ladder `decide()` returns `null` = "no opinion" (:196-220); `SYSTEMONE_GATE_CONFIDENCE = 0.75` (:26).
- Wired: workflow-runner synthetic verification pass consults the gate first (`workflow-runner.ts:714-758`) — confident PASS copies the draft, logs `System-One gate PASS N% (via) — flagship verification pass skipped` (:749) and skips the frontier call; FAIL/uncertain/no-judge runs today's verification unchanged.
- Settings UI: "System-One decisions (Jev)" block in the Model Relay card with `typesafeKey` password input (`model-relay.tsx:199-225`); `Settings.typesafeKey` (`types.ts:328-333`).
- **Not yet wired (queued per decision-log):** typed verdicts for `kind:"review"` gates (review steps still use LLM prose + rework), tool-result noul digest in the agent loop, radar batch labeling. Review-gate wiring point: `workflow-runner.ts:632/653` where `kind:"review"` verdicts are parsed.

## 3. Chat model selection end-to-end

Picker (composer, §C) → `Conversation.modelOverride` → `chat-view.runTurn` (`chat-view.tsx:203-345`): `resolveExplicitLlm` (:231) → `buildRelayWire` excluding the pin (:235-237) → `runAgentChat` params provider/apiKey/baseUrl/model/relay (:241-256) → transports: browser-direct `runRelayedCustom` in-page (`chat-client.ts:197-206`, receipt forwarded :173-177) or server `POST /api/chat` (`:213+`, relay passed :244; receipt forwarded :317-319). `/api/chat` guards baseUrls then runs the same engine (`route.ts:104-121`). Agent-level `model` still flows as `agentModel` fallback inside `resolveLlm` (`llm-config.ts:41-84`). What a user can pick today: global default, built-in engine, any curated/live model of any keyed provider — missing: legacy-custom endpoint models, free-text ids (see §C).

## 4. Pipeline depth control

- Type `PipelineDepth` (`types.ts:163`), `Workflow.depth` (:280). Materializer `materializeRunSteps` (`workflow-runner.ts:170-240`, pure; fresh-run branch only :300 — resume untouched): quick = as-authored; standard/deep append synthetic `Verification & synthesis` step when no `kind:"review"` step exists (:219-238); deep inserts 2 deep-research passes cloning the first step's agent with merged `web_search+arxiv_search` tools only if the base agent has tools (:192-216). `VERIFICATION_INSTRUCTION` hardened "your reply IS the deliverable" (:143-150).
- Verification step RUNS (normal generate step at :760) unless the System-One gate skips it (:714-758).
- UI: editor segmented control + live summary (`workflow-editor-dialog.tsx:95-111, 264-271, 318-381`; depth persisted via follow-up `updateWf` because store `add()` drops unknown fields); DepthChip on cards/run-panel; export/import round-trip. Seeded "Morning Briefing" (`stores.ts:612-631`) has no depth → reads "standard".

## 5. Tools

- 5 tools: `web_search, read_url, run_code, current_time, arxiv_search` (`types.ts:8`; schemas `tools-defs.ts:25-107`; `TOOL_META` `constants.ts:66`).
- Closed-world validation: `validateToolCall` (`tools-defs.ts:127-172`) — registry membership, JSON-object args, undeclared-property rejection, required-arg check, error fed back for self-correction. Wired in both engines (`route.ts:241-244`; agent-engine salvage paths).
- Injection fencing: `fenceToolOutput` (:185-187) wraps every model-visible tool result in an `<untrusted-tool-output>` data-not-instructions banner; `stripInjectionPatterns` (:195-210) scrubs fake role tags / "ignore previous instructions" / key-exfil asks; UI keeps raw. Injection-refusal rules in `composeSystem` (agent-engine).
- Executors: server `executeTool` (`server/tools.ts:22-61`); browser-direct `httpToolExecutor` (`tools-defs.ts:254-288`) POSTs `/api/tools/execute` with the `x-praison-csrf: 1` header (:265) + 30s deadline.
- `/api/tools/execute`: `KNOWN` allowlist (:14), **r26.1 `csrfOk`** (:30-41, uncommitted): custom-header gate + Sec-Fetch-Site gate; CLI clients (no Origin/Sec-Fetch-Site) still allowed — do not flag.

## 6. Security surfaces (hardening audit)

| Surface | State | Minimal fix |
|---|---|---|
| `read_url` SSRF | `guardPublicUrl(allowHttp)` pre-flight (`server/tools.ts:108`; guard `url-guard.ts:49-76`: loopback/private/CGNAT/metadata/IPv6-ULA/link-local, `.internal/.local` suffixes) — **but `redirect: "follow"` (:117) means redirect hops are NOT re-checked** despite `url-guard.ts:8` claiming "re-checked per redirect hop". DNS rebinding documented residual. | Manual redirect loop: `redirect: "manual"`, re-run `guardPublicUrl(location)` per hop (max 3). ~15 lines in `doReadUrl`. |
| Relay baseUrls | Guarded https-only per request + per hop (`route.ts:104-115`). OK. | — |
| `run_code` | Bare-realm `vm.createContext({})` (`server/tools.ts:181`) + realm-local console (:183-197) — the `Math.constructor.constructor` RCE class is dead (r26 live-verified). Sync-only 4s budget remains. | Optional async budget; documented. |
| Same-origin on other routes | `/api/chat` has **no** origin/CSRF gate (mitigated: keys come from page localStorage, not cookies, so a cross-site page cannot attach them; residual abuse = server-egress wear). `/api/radar/*` are GET proxies (no state). | Low priority; reuse the `csrfOk()` helper on `/api/chat` if hardening continues. |
| Secrets | Vault keys: browser localStorage only; travel per-request to the chosen provider — never persisted/logged server-side (`free-models/route.ts:7-10`). `GITHUB_TOKEN`: server-side env only, attached in `/api/radar/github` (:44-45), never shipped to client. | — |
| CSP / headers | **None**: `next.config.ts` has no `headers()` and there is no `middleware.ts`. Also `typescript.ignoreBuildErrors: true` (`next.config.ts:6-8`) hides type breakage at build. | Add `headers()`: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP with `frame-ancestors 'none'`; keep `connect-src *` explicit because the browser-direct engine calls arbitrary provider hosts. |

## 7. Trend Radar

`radar-view.tsx` (3 tabs; caches `praison-radar-gh` / `praison-radar-hf` / `praison-radar-arxiv` + username `praison-radar-user`, `:32-35`; cached-Xm-ago + Refresh, explicit fetch; GitHub never auto-fetches). Routes: `/api/radar/github` (username regex :36, PAT env :44-45, trimmed fields, 404/429/502 mapping) and `/api/radar/papers` (query ≤300, max 1–20, sort allow-list, reuses exported `parseArxivFeed` from `server/tools.ts:307-340`). HF tab fetches the public HF API directly from the browser (keyless). Papers proxy has no server-side TTL cache.

## 8. Scheduled pipelines / Morning Briefing

Client-side only: `workflow-scheduler.tsx` — `setInterval` tick every 10s (:70), fires enabled schedules whose `nextRunAt <= now`, min effective interval 60s (:38), misses skipped (app closed = no run). Runs the full pipeline incl. depth materialization + System-One gate. Morning Briefing is a seeded fixed-id workflow (`stores.ts:612-631`), schedule opt-in via the Schedule popover; depth unset → standard (+verification).

## 9. Settings view

Sticky chip-nav (`settings-view.tsx:73-81` sections: usage / providers / local-models / relay / behavior / profile / appearance / data; sticky bar :260, scroll-spy :109-120). Providers = vault gallery (`provider-gallery.tsx`, `provider-card.tsx`, per-provider "Refresh models", credits `mePath`) + setup wizard. Model Relay card incl. System-One key block (`model-relay.tsx`). Local models panel (`local-models.tsx`, WebGPU). "Your Data" = JSON export via `downloadJson("praisonai-export.json", …)` (:148-155) + import with validation (:181-183).

---

## GAP LIST (ranked)

**P0 — none.** All three user-reported bugs (A: fake gemini-3.5-pro; B: missing GLM-5.3-Flash; C: chat picker ignoring keyed providers) are fixed at `659fc9d` and verified above. The r26.1 `csrfOk` change is pending commit only (intentional, just landed).

**P1**
1. `read_url` redirect hops unguarded — `server/tools.ts:117` `redirect:"follow"` contradicts `url-guard.ts:8`. Fix: manual-redirect loop re-running `guardPublicUrl` per hop (max 3 hops, then abort).
2. Chat model picker has no group for the legacy custom endpoint (`composer.tsx:576-615` loops `FREE_PROVIDERS` only) — users on a custom OpenAI-compatible URL cannot pick its models in chat. Fix: synthesize a "Custom endpoint" group from `settings.baseUrl` + `settings.defaultModel`, extendable with a `<baseUrl>/models` probe via the `/api/providers/free-models` POST (KEYED_ENDPOINTS pattern).
3. Receipt `completion_status` hardcoded "complete" (`chat-view.tsx:340`; engines emit before `done`) — stopped/errored turns carry a false receipt. Fix: set it from the run result / error branch of `runTurn`.

**P2**
4. Elo badges read as measured ratings (`model-relay.tsx:269`) — add tooltip "doctrine estimate · evidence = live ✓ badge".
5. No CSP/security headers; `ignoreBuildErrors: true` (`next.config.ts:3-10`).
6. Live-roster extras in the chat picker require a prior per-provider "Refresh models"; a stale pinned id can disappear from the options list (agent editor has `withSavedOption`; chat pin does not).
7. Receipts lack cost/latency fields; pipeline steps have notes but no receipts (schema v0.2: `ms`, `cost_estimate?`; reuse `RunCallLogEntry`).
8. System-One not yet wired into review-gate verdicts / tool-result digest (decision-log queued; hook points `workflow-runner.ts:632/653`, agent-engine tool loop).
9. arXiv papers proxy has no TTL cache; GitHub radar falls back to the unauthenticated 60 req/h pool when `GITHUB_TOKEN` is absent.
10. Scheduler is tab-open-only by design — consider a `lastRunAt` catch-up prompt for missed briefs.
