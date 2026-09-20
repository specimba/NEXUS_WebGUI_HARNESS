# NEXUS WebGUI Harness — Platform Capability Expansion Decision Log

**Round:** r26 · **Date:** 2026-09-20 · **Scope:** Q3-2026 AI landscape → implemented platform enhancements
**Inputs:** GitHub asset audit (r26-2a, 960 starred + 181 owned repos), HF Hub trending scan + arXiv/alphaXiv sweep (r26-2b), codebase integration map (r26-2c).

---

## 1. Evaluated → ADOPTED (implemented this round)

| # | Candidate | Source | What landed | Why it won | Effort |
|---|-----------|--------|-------------|------------|--------|
| 1 | **arXiv search tool** (`arxiv_search`) | User directive (arXiv + alphaXiv reach); HF dataset `secemp9/arxiv-complete` analysis | New server tool: public arXiv Atom API, 15s deadline, abort-aware, every result carries `alphaxiv.org/abs/<id>` discussion mirror. Registered end-to-end (types, defs, executor, route allowlist, TOOL_META). | No key, no tracking, directly fixes the "briefings are shallow about AI" complaint; gives agents primary-source reach. | S |
| 2 | **Closed-world tool-call validation** | arXiv 2609.19425 (`Closed-World Resolution Against Tool Hallucination`) | `validateToolCall()` in tools-defs.ts wired into BOTH engines + both salvage paths: hallucinated tool names / undeclared argument keys / missing required args are rejected pre-dispatch; the error is fed back as the tool result for same-run self-correction. | ~1h of pure TS kills a whole failure class; highest reliability-per-effort of the 2026-09 paper harvest. | S |
| 3 | **Tool-output provenance fencing + injection scrubbing** | arXiv 2609.14987 (`ActGuard: pre-execution auditing vs indirect prompt injection`) | Every tool message the MODEL sees is wrapped in `<untrusted-tool-output>` fences + highest-signal injection patterns stripped (fake system/assistant separators, "ignore previous instructions", key-exfiltration asks); `composeSystem` now carries explicit injection-refusal rules. UI keeps raw content. | In a BYOK platform the keys live in the browser — tool-content→exfiltration is THE real threat model. Local-first security lynchpin. | S–M |
| 4 | **Security hardening pack** | r26-2c audit; starred security cluster (garak fork, PentestGPT, PurpleLlama) | (a) `node:vm` sandbox is now a **bare realm** — host-intrinsics seeding removed, so `Math.constructor.constructor("return process")()` RCE escape is **dead** (verified live); (b) same-origin gate on `/api/tools/execute` (cross-origin POST → 403, verified); (c) `guardPublicUrl()` SSRF guard on client-supplied relay baseUrls + read_url (metadata IP blocked, verified); (d) GitHub radar proxy sanitizes usernames. | User's standing security emphasis; all four verified by live tests, not just code review. | M |
| 5 | **Pipeline depth control (quick/standard/deep)** | User complaint ("shallow briefing") + dzhng/deep-research pattern + `deepagents` blueprint | `Workflow.depth`: deep = 2 extra deep-research passes cloned after step 1 (tool-union with web_search + arxiv_search) + auto "Verification & synthesis" pass (suppressed when an authored review gate exists); standard = verification only; quick = as authored. Editor segmented control, card/panel chips, export/import round-trip. **E2E verified: Morning Briefing ran 5/5 steps to done, output now carries verified-source annotations and dead-URL flagging.** | Direct fix for the reported product gap; reuses existing review-gate plumbing. | M |
| 6 | **Trend Radar view** | User directive ("check my stars and forked repositories… HF hub… papers reach") | New top-level view (⌘5, `#/radar`): GitHub Stars browser (3×100 pages via `/api/radar/github` proxy — server-side `GITHUB_TOKEN` opt-in for 5000 req/h, token never shipped to client; cluster chips + search; localStorage cache with fetchedAt), HF Trending (models/datasets/spaces by trendingScore, client-direct CORS fetch), Paper Radar (validated `/api/radar/papers` proxy over arXiv Atom with arXiv/alphaXiv/PDF link chips). Explicit fetch-only, cached locally — local-ephemeral-but-recoverable semantics. | Turns the round's research methodology into a permanent product feature. | M |

## 2. Evaluated → QUEUED (next rounds, ranked)

1. **Run replay fixtures from callLog** (arXiv 2609.20625 Chronicle) — export a failed run's deterministic prefix, stub tool results, replay. Turns user bug reports into reproducible tests. Effort M.
2. **Versioned Reflexion lessons store** (arXiv 2609.19128 + 2609.05329 memory-portability) — localStorage lessons with model/schema version stamps injected into self-heal retries. Maps to the user's own NEXUS_SAGE/consequenceflow governance concepts. Effort M.
3. **Budget-aware tool-result digest** (arXiv 2609.04915 + 2609.08279) — rolling digest atoms + re-fetch pointers instead of raw truncation in long runs. Effort M.
4. **Skills registry (SKILL.md format)** — anthropics/skills + VoltAgent/awesome-agent-skills ecosystem as loadable system-prompt modules; zero backend. Effort S–M.
5. **mem0-style cross-session memory** — post-run fact extraction into an inspectable localStorage store, injected as context prefix. Effort M.
6. **Trace timeline view** (langfuse pattern) — per-step tokens/latency/error-kind from the already-persisted callLog. Effort S–M.
7. **MCP Streamable-HTTP client** (fastmcp) — server-side `/api/mcp` proxy mapping remote tools into the registry. Effort M–L.

## 3. Evaluated → REJECTED (with reasons)

| Candidate | Reason |
|-----------|--------|
| RL-training / SFT-corpus papers (UltraData-2609, Dual-Axis PO) | Need GPU training racks; we are BYOK + browser-first. |
| Networked/multi-user agent memory (2609.19502, 2609.12320) | Violates local-first, single-user, zero-telemetry doctrine. |
| GPU Spaces integrations (LTX-2.5 video, MiniMax-H3, wan2.2) | Server-GPU bound; Image Studio's BYOK-API path already covers media. |
| GGUF "uncensored" hype forks (zero-download trend-riders) | Hype without substance — filtered per directive. |
| Remotion in-app video rendering | Heavy bundle for marginal value now; revisit on demand. |
| isolated-vm for run_code | Native dep + build complexity; the bare-realm fix already removes the escape path (verified). Residual: vm remains sync-CPU-bounded only — acceptable for a local tool. |

## 4. Security posture (this round's changes)

- **Fixed:** node:vm host-realm escape (RCE) — bare realm, console capture realm-local; verified `process is not defined`.
- **Fixed:** unauthenticated cross-origin tool execution — same-origin gate; verified 403.
- **Fixed:** SSRF on relay baseUrls + read_url — scheme/host/IP-literal guard; verified metadata-IP block.
- **Hardened:** indirect prompt injection — provenance fences + scrubbing + system-prompt refusal rules.
- **Residual (documented):** DNS rebinding of public names in read_url (redirect hops not re-resolved); node:vm is not a hardened multi-tenant boundary (sync-only CPU budget); GitHub radar proxy trusts the server env token. All accepted for a local-first single-user platform; revisit if multi-user ever lands.
- **Telemetry:** unchanged — zero. Radar fetches are explicit user actions; caches stay in localStorage.

## 5. Verification evidence (r26)

- `bunx tsc --noEmit`: 0 errors under `src/`; `bun run lint`: clean.
- Live tool tests (server): arxiv_search returns real papers + alphaXiv links; run_code escape → `ReferenceError: process is not defined`; normal compute intact; cross-origin 403; read_url SSRF block.
- Browser E2E (agent-browser): Radar view — 3 tabs render, GitHub grid = 300 real starred repos via proxy, HF links real, Paper Radar 36 arXiv/alphaXiv links; Workflows — depth control persists (`Morning Briefing → deep`), deep run completed 5/5 steps with detailed, source-annotated output; mobile 390px: no horizontal overflow; 0 console errors.
- Both engines share the new validation/fencing (browser-direct + server auto-engine).

---

# r27 · Jev / System-One tier · Route Receipts · roster truth-pass (2026-09-20)

**Inputs:** elvis/@omarsar0 Jev thread (user-supplied), Jev deep-dive (r27-2a: docs.typesafe.ai llms-full.txt 895KB, HN 49717558, HF hub reproductions, OpenRouter/Cloudflare listings), model-roster truth pass (r27-2b: Google/Z.ai/Cohere/Together docs + live OrcaRouter 197-model roster + HF), user complaint ("gemini-3.5-pro doesn't exist — where is glm-5.3-flash?"), paper arXiv:2605.01710 (Route Receipts, user-supplied PDF).

## 1. ADOPTED (implemented this round)

| # | Candidate | Source | What landed | Why it won |
|---|-----------|--------|-------------|------------|
| 1 | **System-One decision tier** (`src/lib/systemone.ts`) | Jev (TypeSafe AI) — `POST /v1/systemone`, choice/score/noul, $0.042/Mtok input-only, 250K tok/s; elvis doctrine "not everything requires a frontier model" | `decide()` ladder: ① Jev native (5s deadline, optional `typesafeKey` in Settings → Model Relay card) → ② fast-model JSON judge over the vault with new relay `taskFit: "decision"` (flash lanes first, flagships demoted −2) → ③ `null` = keep current behavior. First consumer: **System-One gate** before the pipeline verification pass — confident PASS (≥0.75) skips the flagship verify call; worst case = status quo. | Jev is NOT a relay hop (different wire API) — the ladder keeps the Genius-rotator model-agnostic while adding the cheap-judging primitive. Works TODAY with zero new keys via ②. |
| 2 | **Route Receipts v0.1** (arXiv:2605.01710) | User: "this paper also very useful for us" | Engine emits `{type:"receipt"}` on every answered run (both transports + built-in path): requested vs resolved model, `model_identifier_type` fixed/router, fallback {status, coarse reason, from→to}, completion status, structural `redactions: []`. Client merges tool counts (§6 tool ledger) and persists on the message; UI chip = consumer tier (amber "fallback used" only when it happened; hover-quiet "route" otherwise) → popover = developer tier with the full record. Zero telemetry: stored in localStorage only. | Turns relay rotations from invisible magic into auditable runtime facts — exactly the paper's "consumer tier + developer tier" design. "No fallback" is information too. |
| 3 | **Roster truth pass** (relay + registry) | r27-2b evidence: Google docs (no gemini-3.5-pro / no 3.8-flash-lite; Pro line = 3.1-pro-preview), docs.z.ai pricing (glm-5.3-flash exists, cheap-NOT-free; glm-5.3 flagship), OrcaRouter live roster (z-ai/glm-5.3-flash-free verified), Cohere docs (command-a-03-2025), Together serverless list (Turbo-Free retired → Ternary-Bonsai-27B) | DELETED: `gemini-3.5-pro`, `gemini-3.8-flash-lite`, `command-a-02-2025`, `Llama-3.3-70B-Instruct-Turbo-Free`. ADDED: `glm-5.3` (T1 .97) + `glm-5.3-flash` (T2 .92) on Z.ai, `z-ai/glm-5.3-flash-free` (T2 .91) on OrcaRouter, `gemini-3.1-pro-preview` + `gemini-3.5-flash-lite` on Google, Cohere 03-2025, Together Bonsai+Turbo. "Ordering fixed by removing fiction": fake T1 .965 entries no longer outrank real models. Live-roster-verified hops now carry a **"live ✓"** note. vyce `keyOptional` staleness fixed (keyless /v1/models now 401s). | User-reported + independently evidence-verified. The relay's Elo ordering is only meaningful if the models exist. |
| 4 | **Per-chat model pin** | User: "why still cannot select models from providers we choosed? at chat etc. that is big fault" | `Conversation.modelOverride` ("providerId::model" / "auto::builtin" / unset = global) + `setModelOverride` in the conversations store + searchable ModelPicker in the composer hint row listing ONLY keyed providers (registry rosters + live-catalog extras badged "live") + "Follow global default". `resolveExplicitLlm()` resolves the pin with graceful fallback (keyless → global + warning toast). | The missing BYOK surface: model choice must live where the conversation lives. Never dead-ends by design. |

## 2. QUEUED (from this round's research)

- Jev-powered **tool-result relevance noul** (LiteLLM compaction pattern) for the budget-digest queue item.
- Typed **noul verdicts for review gates** (structured pass/rework with confidence instead of prose parsing).
- Radar triage labeling at scale (System-One batch labeling of starred repos).
- REJECTED (documented): Jev as primary router (vendor lock-in — Genius-rotator doctrine stays model-agnostic), dynamic UIs, RSI/data-synthesis, ambient autonomy (breaks explicit-action privacy doctrine).

## 3. Verification evidence (r27)

- `bunx tsc --noEmit`: 0 errors in app `src/`; `bun run lint`: clean.
- Browser E2E (agent-browser): composer picker renders groups (Auto / keyed providers), pin → toast "This chat now runs on DeepSeek V4.1", trigger label updates; chat round-trip answered "R27-RECEIPT-OK" with ROUTE chip; receipt popover = Requested `deepseek-v4.1` / Answered by primary / Fallback `none` / Tools `no tools used` / Completion `complete` / Redactions `none`; Settings → Model Relay shows the System-One (Jev) key card; mobile 390px `scrollWidth == innerWidth` (no overflow); 0 console errors.
- Security posture unchanged this round (receipts and pins are localStorage-only; Jev key is opt-in, stored locally, sent only to api.typesafe.ai on an explicit decision call).
