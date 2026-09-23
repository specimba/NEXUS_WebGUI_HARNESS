# Jev / System-One — deep-research digest + tools expansion scan

**Round:** r26-2a · **Date:** 2026-09-20 · **Agent:** research (RESEARCH-ONLY — no app code touched)
**Scope:** (1) ground the "Jev / System One" claims from elvis @omarsar0's Sep-19-2026 X thread, (2) digest arXiv 2605.01710 / 2609.19425 / 2609.14987 + System-1/2 routing literature, (3) tools-expansion shortlist for our harness, (4) Jev integration design v0.2 for NEXUS.

---

## 1. Jev grounding — evidence + honest confidence

**Verdict: Jev is real, shipping, and early-access — a typed-decision API, not a chat model.** Confidence HIGH on existence, API surface, pricing *as published*; MEDIUM on latency/cost superiority (vendor benchmarks only).

### 1.1 Who makes it (re-verified today, 2026-09-20)

- **Vendor:** TypeSafe AI (typesafe.ai) — "AI lab building machine-native intelligence infrastructure for automation." Founder **Diogo Almeida** (ex-OpenAI, "research behind ChatGPT"). Launch post "Introducing System One Models & Jev" (2026-09-15); HN thread 49717558 (~500 comments).
- **Independent coverage (new today):** LangChain published a guide ("What Is Jev?"), DataCamp ("Jev: … Never Hallucinates" — 40–200x faster / 40–400x cheaper framing), flaviocopes deep dive, mindstudio, beam.ai, aihubmix, daily.dev hands-on (Jev + LangChain + Pydantic typed harness). The ecosystem has moved from launch-day posts to tutorials — this is a product with adoption, not vaporware.
- **HF reproductions (live hub query today):** `open-jev-deberta-v3-large` (32 likes, text-classification), `JEV-CPU` (zero-shot-classification), `modernbert-ja-310m-jev`, `jev-schema-scorer-deberta-v3-large`, `vagmi/jev-lite`. Repros confirm the *pattern* (runtime-defined classification scales down to 0.3B–large encoders) but not the vendor's accuracy/knowledge claims.
- ⚠️ **CORRECTION to r27-2a:** today's live OpenRouter catalog (`/api/v1/models`, 446 ids) contains **no** `jev`/`typesafe`/`systemone` id. The earlier "OpenRouter beta listing" note is not confirmed by the live roster (likely a docs/blog listing, or removed). Route Jev calls direct to `api.typesafe.ai` only.

### 1.2 API shape (verified from docs.typesafe.ai/api.md + primitives docs)

ONE endpoint, **NOT OpenAI-compatible**:

```
POST https://api.typesafe.ai/v1/systemone     Authorization: Bearer <key>
{ "state": string | object | array,
  "model": "jev-latest",
  "questions": { "<myId>": { "type": "choice"|"score"|"noul",
                             "instructions": string|object,
                             "criteria": … } } }
```

- **Question field is `instructions`** (optionally an object with named sub-fields referenced in backticks). **Choice options and Score levels live in `criteria`.**
- **Answers (verified shapes):**
  - `choice` → `{type, choice, confidence 0–1, probabilities{option: p}}`
  - `score` → `{type, score, legend, probabilities{level: p}, confidence}`
  - `noul` → `{type, noul: 0–1}` — **p(yes) only, no confidence field**
- Response wraps as `{model: "jev-1.13.0", answers: {…}, usage:{input_tokens, output_tokens}}`. Errors 401/422/429/529 (backoff on 429/529; `retry-after` honored). Docs also publish **patterns**: confidence-gated routing ("answer = what, confidence = whether to act"), composite scoring (atomic judgments + weights in code), intent routing, speculative fan-out.

### 1.3 Models / pricing / limits (docs.typesafe.ai/models, today)

| | jev-1.13.0 (`jev-latest` = `jev-preview` = same) |
|---|---|
| Price | **$42/Btok = $0.042/Mtok, input-only; output tokens free** |
| Rate limits | 250,000 tok/s · 1,200 RPM — "adjusting dynamically" |
| Context | 64k/request; state + longest question ≤ 32k |
| Input | Text only (pre-process images/audio to text) |
| Fine-tuning | None ("shape answers via state/instructions/criteria") |

Latency/speed claims (70–500ms; homepage "193.6x faster / 444.6x cheaper") remain **vendor-published**; the mechanism (non-autoregressive single-pass over one state, many questions in parallel) is consistent with independent repros.

### 1.4 Known jagged edges (official `model-jaggedness/jev-1.13`, 2026-09-17)

Literal reading of instructions; no in-model math/counting/date math ("keep arithmetic in code"); indirection hurts; **distractor-heavy state degrades accuracy — "filter first; send only what the question needs"**; adversarial content moves answers ("state is data and jev does not treat it as hostile by default" — pairs with our `fenceToolOutput`); contradictory criteria confuse it; noul↔choice invariants not guaranteed; confidence is version-sensitive ("pin the version if you tuned thresholds").

### 1.5 🔴 Bugs found in our r27 Jev rung (`src/lib/systemone.ts`) — fix in next dev round

Fresh API-doc read (today) vs our implementation:

1. **`askJev` sends `prompt:` but the API field is `instructions`** — Jev would 422 or misread every question.
2. **Choice questions send `options:` but the API expects `criteria`** (options list / rubric levels).
3. **Noul answers are parsed from `a.p` but the API returns them under `a.noul`** (p(yes), no confidence field) — so even a successful Jev noul would surface as `answer:""` and silently drop to the fast-judge rung.

All three are ~5-line fixes inside `askJev`/`SystemOneQuestion` mapping; until then the "jev" rung of the ladder is effectively dead code and everything runs via ② fast-model JSON judge (which is fine — the ladder was designed to degrade gracefully, and did).

---

## 2. Paper digests

### 2.1 arXiv 2605.01710 — "Model Routing as a Trust Problem: Route Receipts for Adaptive AI Systems" (V. Schmalbach, 2026-05-03, 30pp, cs.AI+cs.CY)

**Thesis:** routing (aliases, tiers, tool choices, regional endpoints, fallbacks, safety handling) is a documented product surface, yet no portable **per-answer** record exists anywhere — model cards describe design time, nothing describes runtime. Proposal: the **route receipt** — a compact, redacted, per-answer transparency artifact; consumer tier = a few visible indicators, developer tier = full record. Not an OpenTelemetry replacement: receipts are portable and user-showable, traces are operator-side.

**Canonical v0.1 JSON schema (verified LIVE at `routereceipt.org/schemas/route-receipt/v0.1/schema.json` today).** Required: `schema_version, receipt_id, request_id, served_at, model_identifier_type, fallback, safety, region_class, completion_status, redactions`. Optional: `requested_model, resolved_model, service_tier{requested,effective,change_reason}, effort{requested,effective_status}, tools{allowed,used,retrieval_summary}, context{input_truncated,context_window_class}`. Enums that matter: `model_identifier_type ∈ fixed|moving_alias|router|unknown`; `fallback.reason ∈ none|rate_limit|provider_error|moderation_refusal|capacity|policy|unknown|redacted`; `safety{status ∈ none|intervened|…, visible_action ∈ none|blocked|masked|rewritten|…}`; `context.input_truncated ∈ false|true|unknown|redacted`. Section 8 ("What a receipt should cover"): never expose chain-of-thought; say "fallback occurred because primary was rate-limited" without publishing thresholds; receipts record *material serving conditions*, not reproducibility guarantees.

**Adoption steps for our relay (receipt v0.1 → v0.2)** — current `RouteReceipt` (types.ts) covers requested/resolved model, identifier type, fallback{status,reason,from,to}, tool ledger, completion, `redactions: []`. Gaps vs canonical, in priority order:

1. **Honesty about the schema marker:** we stamp `"route-receipt.v0.1"` but omit required canonical fields (`receipt_id`, `request_id`, `served_at`, `safety`, `region_class`). Either add them (cheap: `crypto.randomUUID()`, message id as request_id, `createdAt` as served_at) or rename our marker to `route-receipt.v0.1-nexus` so we don't claim conformance we don't have. **Pick the former** — all missing fields are free.
2. **Add `safety` — we already have interventions to record:** `stripInjectionPatterns` filtered-span counts, `guardPublicUrl` blocks, `validateToolCall` rejections. `safety.status:"intervened", visible_action:"masked"` turns silent fencing into auditable fact (paper §11 threat-model-aligned: record the intervention, not the attack payload).
3. **Add `context.input_truncated`** — we hard-clip tool output at 7,000 chars and state at 8k in the fast judge; "true" is information the paper explicitly wants surfaced.
4. **Add `tools.allowed`** (the run's granted ToolId set) alongside `tools_used`.
5. **Extend enums:** `model_identifier_type += "moving_alias"` (live-roster aliases / `jev-latest`-style pins); `fallback.reason += "moderation_refusal"`.
6. **Defer `service_tier`/`effort`/`region_class`** (no tiers/effort knobs in our relay; single-user local — `region_class:"unknown"` is the honest value if the field is added).
7. **Receipt the gate:** System-One gate verdicts (verify-skip decisions) deserve their own receipt line in `RunCallLogEntry.note` (already partially done) — same doctrine: judge decisions are routing decisions.

### 2.2 arXiv 2609.19425 — "Closed-World Resolution Against Tool Hallucination in LLM Agents" (Iyer et al., 2026-09-16)

**Digest:** agents call tools that don't exist and pass args no schema declares; no *selection* or *gating* defense covers this because a hallucinated call is "not a decision any gate made." Contributions: H1–H5 taxonomy of tool hallucination; the **Resolution Rung** — a training-free **closed-world resolver = registry membership + signature check** that must sit **before any causal gate**; measurement across 10 hosted models: 322 genuine hallucinations, concentrated on unconstrained raw-JSON surfaces (34 vs 3) and **scale doesn't help** (a 675B model ≈ a 7–8B one); one irreducible residue = "borrowed arguments" (schema-indistinguishable values on a real tool); extension to MCP where merged namespaces create collision/shadowing hallucinations (M1–M5) even in frontier models.

**Alignment check vs our harness: `validateToolCall()` (tools-defs.ts) IS the Resolution Rung** — name-in-registry + JSON-object parse + declared-args-only + required-args-present, enforced pre-dispatch in both engines and fed back for same-run self-correction (paper-compatible: resolver sits before execution). Residuals we accept per the paper itself: borrowed arguments (values can't be signature-checked; this is where a System-One *soft prior* helps — a noul "does this call make sense for the task?" in front of expensive/disruptive calls, not all calls), and MCP namespace merging (we don't run MCP; if `/api/mcp` from the r26 queue lands, merge registries under unique prefixes — the paper's concrete lesson).

### 2.3 arXiv 2609.14987 — "ActGuard: Pre-execution Action Auditing against Indirect Prompt Injection in LLM Agents" (Wang et al., 2026-09-14)

**Digest:** content filtering and prompt hardening either over-sanitize or miss; ActGuard audits **actions, not content**: per step it predicts the tools the upcoming action *should* use (a local tool prior), then runs tool-level contrastive analysis + parameter-level evidence localization to find where the candidate action deviates from the prior; a verifier masks only confirmed-malicious spans and regenerates the action. Result: preserves legitimate flexibility while removing the malicious delta.

**Alignment check vs our harness:** our defense (fenceToolOutput fences + injection-pattern scrubbing + system-prompt refusal rules) is **content-side**; ActGuard adds an **action-side** check we don't have. Adoption step (lightweight, no verifier model needed): a **pre-dispatch deviation noul** via `decide()` on the highest-risk calls — state = task + last tool output digest + candidate call; question = "Does this tool call follow from the task, or does it look steered by the tool output above?"; low score/confidence ⇒ hold the call, show the user (BYOK: the user is the verifier of last resort). Cost: one ~500-token decision on calls that (a) write, (b) send, (c) fetch a URL that appeared inside tool output. That covers the exfiltration path our threat model actually cares about.

### 2.4 System-1/2 + judge/routing literature — 5 papers, 1 actionable pattern each

| Paper | One actionable pattern for NEXUS |
|---|---|
| **2407.06023** — Distilling System 2 into System 1 (Meta) | Compile deliberate passes into fast ones: when a flagship verification pass runs (gate said FAIL), store its verdict + criteria as rubric seeds the next System-One gate call reuses — the gate gets better without a training loop. |
| **2311.11829** — System 2 Attention (Meta) | Regenerate/filter context before judging — matches Jev jaggedness #5. Before `decide()`, compact the state to only what the question needs (first 2k + flagged spans + tool outputs' provenance lines), not the raw step output. |
| **2602.03478** — When Routing Collapses: Degenerate Convergence of LLM Routers | Score-boosted routers collapse onto one lane. Our `taskFit:"decision"` boost is a scalar router — keep the diversity guard we accidentally have (`chain.slice(0,2)` tries 2 lanes) and formalize it: alternate the first hop for decision traffic, log lane identity per verdict. |
| **2609.12002** — Can We Trust LLM Judges (multi-judge WMV) | Judge accuracy tracks task accuracy (r ≥ 0.90) and stronger examinees get leniency (r ≥ 0.83); calibrated weighted majority voting fixes bias. For gate decisions that flip *expensive* work: ask the 2 fastest lanes and require agreement (cheap WMV); for routine checks, one lane is enough. |
| **2606.01416** — Self-Healing Agentic Orchestrators | Reliability = bounded runtime control: failure signals → classes → targeted recovery → **verify the recovered trajectory**. Our runner rebuilds the relay wire per attempt; add a post-recovery noul ("is this step now complete?") before proceeding — closes the loop we opened in r25. |

*(Also screened: 2609.12439 judge debiasing can destroy measurement resolution — don't over-scrub judge inputs; 2512.07094 VIGIL reflective runtime; 2608.01955 vendor-agnostic agentic self-healing for pipelines.)*

---

## 3. Tools expansion — Adopt / Reject / Defer shortlist

**Landscape (what leading harnesses ship in 2026):** upstream **PraisonAI-Tools ships 253 tool modules** (live GitHub tree read: wikipedia, hackernews, archive, github/repo, json/yaml/xml/csv/excel, image/tts/transcribe/vision, weather, pubmed, sourcegraph, jina, newspaper, yfinance, searxng…); smolagents' default toolbox = web search + visit-webpage + code interpreter (+ image-gen / STT in extras); CrewAI ≈ 75+ tools in 8 categories (file/doc, scraping/browsing, search/research…); OpenHands/LangChain community = browser + shell + file-edit + API wrappers. The gap for us is not exotic tools — it's the **keyless, server-side, read-only** core set plus cheap wrappers over the z-ai SDK we already ship.

All ADOPT rows were live-probed from this sandbox (HTTP 200) unless noted. Every candidate is: server-executable in `src/lib/server/tools.ts`'s switch, no API key (server `GITHUB_TOKEN` opt-in only, mirroring `/api/radar/github`), registration cost = the r26-2c 4-edit path (types.ts ToolId → tools-defs.ts → server/tools.ts → execute allowlist + TOOL_META).

| # | Tool | Value to user | Cost | Risk | Verdict |
|---|------|---------------|------|------|---------|
| 1 | **`page_markdown`** (html→markdown fetch+extract upgrade for `read_url`) | Biggest single quality win: our `htmlToText` is regex-kludge; markdown-preserving extraction (turndown + linkedom, no native deps) fixes tables/code/links in every deep briefing | S | Low (pure JS) | **ADOPT** (as read_url output upgrade or sibling tool) |
| 2 | **`wikipedia_search`** — `en.wikipedia.org/w/api.php` list=search + extracts | Grounding for factual/briefing asks; keyless, clean JSON | S | Low | **ADOPT** (live-verified 200) |
| 3 | **`hacker_news_search`** — hn.algolia.com API v1 | Community signal, launch/feedback research; powers "what does HN think of X" | XS | Low | **ADOPT** (live-verified 200) |
| 4 | **`github_repo_read`** — repo meta + README (base64→text) + open issues via api.github.com | We are a GitHub-centric shop (Radar, PAT); agents can now cite repos directly | S–M | Low (60/h keyless; server token opt-in) | **ADOPT** |
| 5 | **`package_info`** — npm `registry.npmjs.org/<pkg>/latest` + downloads + PyPI `/pypi/<pkg>/json` | Dep checks, "is this lib alive", supply-chain sanity in code answers | S | Low | **ADOPT** (live-verified 200/200) |
| 6 | **`wayback_lookup`** — archive.org/wayback/available + snapshot fetch as read_url fallback on 404/403 | Deep briefings already flag dead URLs — this *rescues* them | S | Low (sandbox network blocked archive.org today — implement with graceful error; endpoint is standard) | **ADOPT** |
| 7 | **`market_rates`** — coingecko simple/price + open.er-api.com FX (combined) | Briefings + casual finance; two keyless JSON GETs | XS | Low (rate limits → cache 10 min) | **ADOPT** (live-verified 200/200) |
| 8 | **`uuid_hash`** — node:crypto randomUUID/sha256/hmac/base64 | Models must not invent randomness/hashes (same doctrine as jaggedness #2: keep crypto in code) | XS | Zero (no network) | **ADOPT** |
| 9 | **`image_generate`** — z-ai SDK image gen → data-URL/asset link | Media capability the SDK already provides; pairs with Image Studio | S | Low | **ADOPT** |
| 10 | **`tts_speak`** — z-ai SDK TTS → audio for briefings/read-aloud | SDK provides it; voices already in Settings | S | Low | **ADOPT** |
| 11 | `code_search` (grep.app) | Nice-to-have | — | **429/Cloudflare from our IP today**; GH code search needs auth | **DEFER** |
| 12 | `wolfram_alpha` | Math grounding | — | Needs API key (BYOK-optional) | **DEFER (optional key)** |
| 13 | `http_request` generic | Flexibility | — | SSRF/method amplification/intranet probing — highest-risk tool in class | **DEFER** (only behind guardPublicUrl + method allowlist + no-intranet, per-request user approval) |
| 14 | `translate` | LLM chat already does it inline; a tool adds determinism for batch/radar use | S | Low | **DEFER** (registry noise today) |
| 15 | diff / yaml-json transform | — | — | run_code already covers these in-sandbox | **REJECT** (duplicate capability) |
| 16 | Email/Slack/social *posting*, browser automation, vector-DB/memory/MCP tools | — | — | Side effects, creds, or already queued (r26 §2) | **REJECT for now** |

**Shortlist = 10 ADOPT (rows 1–10)**; expected result: 5 → 15 server tools, all keyless/read-only except the two SDK wrappers, zero new vault entries.

---

## 4. Jev integration design v0.2 for NEXUS (file-level)

**What exists (r27, keep):** `src/lib/systemone.ts` `decide()` ladder (① Jev native 5s → ② fast-model JSON judge via `buildRelayChain(taskFit:"decision")`, 2 lanes, strict-JSON + closed option-set, 9s → ③ null = status quo); `SYSTEMONE_GATE_CONFIDENCE = 0.75`; relay `taskBoost` decision branch (FAST +2 / FLAGSHIP −2, `FAST_RE += bonsai`); System-One gate before the pipeline verification pass (workflow-runner, skips flagship verify on confident PASS); `settings.typesafeKey` + Settings card.

**(a) Fix the wire first (§1.5):** rename `prompt→instructions`, `options→criteria` in the request mapper; read noul answers from `answer.noul` (not `p`); treat `confidence` as absent for noul (use the p(yes) directly). This makes rung ① actually live for BYOK typesafe.ai users.

**(b) Decision call-sites to add (all client-side — keys stay in the browser, consistent with BYOK doctrine):**

| Call-site | Question (typed) | Where |
|---|---|---|
| Tool-result relevance gate | noul: "Is this tool result relevant to the current step task?" — if NO + confident, replace the appended output with a 300-char digest + provenance line (queued r27 budget-digest item, now concrete) | `agent-engine.ts` tool loop after `fenceToolOutput` |
| Typed review-gate verdicts | choice over {pass, rework} + confidence instead of prose parsing of review steps | `workflow-runner.ts` kind:"review" branch |
| Morning Briefing fact-check | speculative fan-out (docs pattern): batch noul per claim-line ("Is this claim supported by the cited source snippet?") in ONE request — 64k state budget makes single-request batch checking cheap | verification pass instruction post-processing |
| Radar batch labeling | choice over the cluster chips (Agents/Inference/Memory/RAG/…) per starred repo/paper — 50 repos = 1 request | `radar-view.tsx` |
| ActGuard-lite pre-dispatch audit (§2.3) | noul deviation check on high-risk tool calls | `agent-engine.ts` before execute |

**(c) Config shape (evolve, don't break):** keep `settings.typesafeKey` for compat; add `settings.systemOne?: { enabled: boolean; lane: "auto" | "jev" | "fast"; maxLatencyMs?: number }` — `lane` skips rung ① (fast-only, for CORS-hostile setups) or ② (Jev-only); `maxLatencyMs` overrides the 5s/9s deadlines per user. Settings card gains a three-way lane segmented control next to the existing key input.

**(d) Code placement:** decision logic stays in `src/lib/systemone.ts` (single file); add exported **question-builder recipes** there (`relevanceQuestion(task, digest)`, `gateQuestions(output)`, `deviationQuestion(task, call, outputDigest)`) so call-sites stay declarative and question wording is frozen in one auditable place. No server route needed — every consumer (workflow-runner, agent-engine, radar-view) already runs client-side.

**(e) Eval-loop sketch (continuous checks inside execution):** after each *generate* step, fire one decide() with two noul (`task_completed`, `unsupported_claims`) + one score 1–5 (`quality`); append the verdict to `RunCallLogEntry {engine:"systemone", note:"spot-check PASS 0.9 via Jev"}` (persistence already exists); two consecutive FAIL spot-checks ⇒ trigger the existing self-heal rework path with the verdict text as the rework reason. This is the elvis "continuous evals" claim reduced to our plumbing — no eval harness product, just checks inside the loop we already run.

**(f) Prompt-sensitivity caveat (flagged, per jaggedness doc + the unverified X reply):** freeze all question texts as constants; treat confidence as a prior, not a probability; before changing `SYSTEMONE_GATE_CONFIDENCE`, A/B on 10–20 real run outputs; log `via` + model version (`jev-1.13.0` vs fast lane) on every verdict so threshold drift across judge versions is auditable after a vendor model bump.

---

## 5. References

**Primary / verified today**
- TypeSafe AI launch: https://typesafe.ai · docs: https://docs.typesafe.ai (llms.txt; /api.md, /models.md, /primitives.md, /primitives/choice.md, /primitives/noul.md, /patterns/confidence-routing.md, /patterns/intent-routing.md, /model-jaggedness/jev-1.13)
- HN: https://news.ycombinator.com/item?id=49717558 · third-party: langchain.com guide, datacamp.com, flaviocopes.com, daily.dev, beam.ai, mindstudio.ai, aihubmix.com
- HF reproductions: huggingface.co/api/models?search=jev (open-jev-deberta-v3-large, JEV-CPU, jev-schema-scorer, modernbert-ja-310m-jev, vagmi/jev-lite)
- Canonical receipt schema: https://routereceipt.org/schemas/route-receipt/v0.1/schema.json (live-verified)

**arXiv**
- 2605.01710 — Model Routing as a Trust Problem: Route Receipts (Schmalbach, 2026) — arxiv.org/abs/2605.01710
- 2609.19425 — Closed-World Resolution Against Tool Hallucination in LLM Agents (2026)
- 2609.14987 — ActGuard: Pre-execution Action Auditing against Indirect Prompt Injection (2026)
- 2407.06023 — Distilling System 2 into System 1 · 2311.11829 — System 2 Attention
- 2602.03478 — When Routing Collapses: Degenerate Convergence of LLM Routers
- 2609.12002 — Can We Trust LLM Judges (multi-judge WMV) · 2609.12439 — Judge debiasing vs resolution loss
- 2606.01416 — Self-Healing Agentic Orchestrators · 2512.07094 — VIGIL · 2608.01955 — Agentic self-healing pipelines

**Harness tool inventories (2026)**
- PraisonAI-Tools: github.com/MervinPraison/PraisonAI-Tools (253 tool modules, live tree read)
- smolagents default toolbox (huggingface.co/docs/smolagents guided tour) · CrewAI tools (docs.crewai.com; ~75+ tools / 8 categories) · LangChain community tools

**Keyless endpoints live-probed for the shortlist:** en.wikipedia.org/w/api.php · hn.algolia.com/api/v1 · api.github.com · registry.npmjs.org · pypi.org/pypi · api.coingecko.com/api/v3/simple/price · open.er-api.com/v6 · archive.org/wayback/available (blocked from this sandbox — re-verify from prod) · grep.app/api (429 — defer).
