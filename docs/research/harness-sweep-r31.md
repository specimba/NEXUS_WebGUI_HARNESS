# Harness Sweep r31 — Agent Harness / GUI / Infrastructure SOTA, September 2026

Task ID: r31-2 · research-only (no app code touched). Raw artifacts: /tmp/r31/ (22 web searches s01–s22 + fetched pages).
Labels: **[VERIFIED-fetched]** = I fetched and read the primary source this round; **[snippet]** = search-result snippet only.
Sources verified by live fetch: DeepSeek Harness repo (README/architecture/Web-UI/plugin docs), OpenClaw CHANGELOG 2026.9.5 + 2026.9.1, MCP spec 2026-07-28 changelog, MCP Apps SEP-1865 spec, Agent Skills open-spec README, Devin release-notes page, Letta docs (nav + concept pages), live OpenRouter /api/v1/models probe.

---

## Theme 1 — Agent harness / GUI systems (Sept 2026)

### "DSH" = DeepSeek Harness [VERIFIED-fetched]
- `github.com/deepseek-ai/deepseek-harness` — **234k stars, 28.1k forks, 19,520 commits**, MIT. "Everything is a Plugin." Built on **Cordis** (cordiverse/cordis — same plugin framework family OpenClaw grew out of), design paper: *A Programming Paradigm for Spatiotemporal Composability* (arXiv 2608.25512). Developer preview, rapid compat-breaking iteration.
- Runs as **`npx @deepseek-ai/dsh web`** → starts a **browser Web UI at 127.0.0.1:3080** and opens it. Ships profiles: `web`, `headless`, `sdk`, `sdk-minimal`, `acp`.
- **dsh-base bundle** contents: model adapters, tools, persistence, **sandbox + approval policy**, settings, credentials, telemetry — i.e. exactly our app's layer list, minus tracker/radar.
- Web UI guide [VERIFIED]: Settings → Models = BYOK (DeepSeek key **+ custom OpenAI-compatible endpoints**, no restart); workspace selection gates the composer; sessions maintain a **plan**; UI "asks before operations that require approval under the active permission policy."
- Plugin model [VERIFIED]: TS module exporting `apply(ctx)`; `inject: ['tools']` dependency declaration; every registration is a **reversible effect** (auto-cleanup on unload); config = YAML **patch overlays** (`cordis.patch.yml`) targeting rows by id; config-only HMR. Repo carries both `AGENTS.md` and `CLAUDE.md`; `.agents/` folder at root.
- Integration move: borrow DSH's *vocabulary* — permission policy as a first-class subsystem, replaceable agent loop, reversible registrations — but not the Cordis framework itself (see "don'ts").

### OpenClaw (361k+ stars claim [snippet]; changelog [VERIFIED-fetched])
- **2026.9.5** [VERIFIED]: Atomic Updates (checks next version before switching); **plugins installable without gateway restart**; **shareable conversations**; conversation **archives**; guided setup creating a **specialist team** (chief of staff / researcher / writer / reviewer) behind an approval proposal; agent **avatars**; work on browser pages alongside the agent. 4,179 PRs / 502 contributors in one release.
- **2026.9.1** [VERIFIED]: **Mermaid blocks render as diagrams in chat** (with retry); quick-start lane that detects existing Claude Code / Codex logins+keys and verifies them live; **personal skill libraries** (`openclaw skills library`, import from ZIP, share per identity on team Gateways); durable tool approvals (**"Allow Always"** sticks per MCP tool, approvals follow session posture, reused across placements); gateway resilience (malformed cron rows quarantined instead of blocking boot; migration warnings degrade instead of refusing start).
- Integration moves: Mermaid in chat (S); skills library with ZIP import (S/M); durable per-tool approvals (S/M); "quarantine bad schedule rows, never block boot" for our workflows store.

### Devin / Cognition [VERIFIED-fetched]
- Sept 21, 2026: **SWE-2 research preview in the agent selector** with **reasoning effort (Medium/High/Max), switchable mid-session**; **folder attach** (compressed to zip in the browser); auto merge-conflict fixes on PRs; **shell command durations shown in the session worklog**; full links for PRs/issues/commits; **file tree + Smart diffs + "Open in editor"** in PR tab.
- Integration moves: shell/tool durations per step in run worklog (S); reasoning-effort selector wired to providers that accept it (S); browser-side zip attach for context packs (M, optional).

### Others [snippet]
- **Claude Agent SDK**: hooks (before/after tool calls, on errors) + subagents; nested subagents to depth 5; custom subagents as markdown files in `.claude/agents/`; changelog at code.claude.com. Move: adopt lifecycle hooks vocabulary in our engine docs; markdown-defined subagent presets.
- **OpenAI AgentKit / Agent Builder / ChatKit** (launched Oct 2025, still the reference): visual canvas for graph workflows + embeddable ChatKit. Move: our workflow editor stays form-based; a read-only graph view is the cheap 80% (see ranked ideas).
- **Manus 1.6**: **Wide Research** = many parallel sub-agents across a landscape; faster Chat Mode. Move: fan-out step type in workflows.
- **Google Jules**: async coding agent; 2026 update closes the CI loop (reacts when CI fails); Jules Tools CLI; $0–$125/mo tiers. Move: our schedules are already async; nothing urgent.
- **Roo/Cline/browser-use**: Roo modes (Code/Architect/Ask), plan mode + checkpoints standard across coding agents (hermosaai matrix: 61 capabilities across 28 tools incl. plan mode, subagents, hooks, memory, MCP, checkpoints). Move: our per-step instructions ≈ plan mode; checkpoint/restore of runs is the gap.

---

## Theme 2 — Protocols (MCP / A2A / AGENTS.md / Skills)

### MCP 2026-07-28 spec: **stateless-first** [VERIFIED-fetched]
Major changes since 2025-11-25:
- **Protocol-level sessions removed** (Mcp-Session-Id gone); list endpoints no longer vary per-connection; cross-call state = explicit server-minted handles as tool args (SEP-2567).
- **No initialize/initialized handshake**: every request carries protocol version + client capabilities in `_meta` (`io.modelcontextprotocol/protocolVersion`, `clientCapabilities`, `clientInfo`); servers self-identify in each result's `_meta` (SEP-2575).
- **`server/discover`** RPC advertises versions/capabilities/identity.
- **`subscriptions/listen`**: single long-lived POST stream for opted-in change notifications (replaces HTTP GET + resources/subscribe).
- `ping`, `logging/setLevel`, roots/list_changed removed; per-request `io.modelcontextprotocol/logLevel`.
- **Tasks → official extension `io.modelcontextprotocol/tasks`**: polling via `tasks/get`, new `tasks/update` for client→server input, unsolicited task handles (SEP-2663).
- **MRTR (Multi Round-Trip Requests)**: replaces server-initiated sampling/elicitation — server returns `InputRequiredResult` (`resultType: "input_required"`, `inputRequests[]`); client **retries the original request with `inputResponses`**. All results carry required `resultType` ("complete" | "input_required").
- SSE resumability / Last-Event-ID removed.
- Why this matters for us: a **browser client can now call MCP HTTP servers with zero session state** — no handshake to persist across reloads, each request self-contained. MRTR's retry-with-inputResponses maps 1:1 onto an approval/clarify dialog + re-POST. CORS remains the practical blocker → proxy through our existing SSRF-guarded API route.

### MCP Apps (SEP-1865, stable 2026-01-26) [VERIFIED-fetched]
- First official MCP extension (`io.modelcontextprotocol/ui`): tools return **UI resources with `ui://` URIs** (`text/html;profile=mcp-app`), linked to tools via metadata; rendered in a **mandatory-sandboxed iframe**; **bidirectional JSON-RPC over postMessage** with the host. Converged from MCP-UI (mcpui.dev; adopters Postman, HuggingFace, Shopify, Goose, ElevenLabs) and OpenAI's Apps SDK. Interactive dashboards/forms/charts inside the chat surface.
- Integration move: render `ui://` payloads from whitelisted servers in a sandboxed iframe (no allow- top-navigation, no same-origin), read-only v1.

### Agent Skills open standard [VERIFIED-fetched]
- `agentskills/agentskills` (Apache-2.0, docs CC-BY-4.0; originally Anthropic, opened Dec 18, 2025 [snippet for date]). **A skill = folder with `SKILL.md`** (YAML metadata: `name`, `description` minimum) + optional `scripts/`, `references/`, `assets/`.
- **Progressive disclosure**: (1) discovery — only name+description loaded at startup; (2) activation — full SKILL.md read when task matches; (3) execution — bundled code runs / references load. Client showcase: agentskills.io/clients; examples: github.com/anthropics/skills.
- Ecosystem [snippet]: skills repo 62k+ stars early 2026; directories/marketplaces forming. OpenClaw ships personal skill libraries w/ ZIP import [VERIFIED]. Letta docs list Skills + Mods as config surfaces [VERIFIED-fetched nav].
- Integration move: adopt SKILL.md verbatim as our user-authored skill format (localStorage/IndexedDB), progressive disclosure in system-prompt assembly, scripts only via our node:vm sandbox.

### A2A [snippet]
- Linux Foundation-hosted; **150+ supporting orgs by April 2026** (PRNewswire Apr 9, 2026); cloud integrations shipped early 2026. It's inter-org server-to-server plumbing — low value for a single-user browser BYOK client today (see don'ts).

### AGENTS.md / llms.txt [snippet]
- AGENTS.md = open convention, plain markdown at repo root with build/test context for coding agents; llms.txt = machine-readable site surface ("B2A"). Both mainstream across 2026 guides. Move: an "Add repo context" flow that fetches AGENTS.md/llms.txt from a URL into a context pack.

---

## Theme 3 — Memory + context engineering

- **Letta** [VERIFIED-fetched nav + snippet]: docs structure shows the production memory stack — **memory blocks** (bounded, editable), **MemFS**, **shared memory**, **compaction** (conversation summarization), and **Memory & dreaming**: "Dreaming uses background subagents to review recent conversations, consolidate useful lessons, and update memory without interrupting your active work." Letta's "Memory Models" post: memory models trained to generate memories during **sleep-time ("agent dreaming")** improving test-time performance.
- **Sleep-time compute** origin: arXiv "Sleep-time Compute: Beyond Inference Scaling at Test-time" (Apr 2025) [snippet].
- **Mem0** [snippet]: persistent memory across users/sessions/agents/orgs; markets sleep-time compute; Letta-alternative positioning (Jul 2026).
- Browser-adaptable patterns (no server, localStorage-only):
  1. **Bounded memory blocks** per domain (persona / project / lessons) with revision counters, injected into system prompt with token budgets.
  2. **Compaction**: when a thread exceeds N tokens, summarize-to-block + trim, keep pinned receipts.
  3. **Dreaming-lite**: on idle (or as a scheduled workflow step), a cheap model reviews the last K runs and appends 3–5 "lessons" to a lessons block (deduped, LRU-capped).
- Integration moves: lessons-block dreaming-lite (S/M); thread compaction (S); memory-block editor UI in Settings (M).

---

## Theme 4 — Evals + self-improvement

- **METR time horizons** [snippet; metr.org primary known]: TH 1.1 update (Jan 2026) with 228 tasks; all-time doubling ≈ 188 days, recent trend ≈ 3.5 months; "Time Horizon 2.0" framing (Jul 2026) measures 50%/80% success task durations. Frontier agents now handle multi-hour tasks. Relevance: our workflow step budgets/timeouts (r29 policy pack) should assume 30–60+ min autonomous stretches for deep runs, not chat-length ones.
- **GEPA / DSPy** [snippet + dspy.ai]: GEPA (reflective prompt evolution, Pareto filtering; beats GRPO ~10% with 35× fewer rollouts) **ICLR 2026 oral**, shipped as `dspy.GEPA`; can act as test-time search with `track_best_outputs`; Fireworks "self-improving agents powered by your evals" (EP+GEPA, Dec 2025). Move: offline prompt optimization is a plausible later feature — run our step-instructions against a stored eval set; not now.
- **Replay/debug tooling** [snippet]: LangGraph Studio pulls production traces from LangSmith and replays locally; session captures traces/evals/CLI/notes in one place. Move: our runs already persist steps — add a replay/scrub view (ranked idea #6).
- **Letta Evals** [VERIFIED-fetched nav]: Suites / Datasets / Targets / **Graders (tool graders, rubric graders, multi-metric)** / Extractors / **Gates** + Suite YAML. Move: "gate" concept maps to our System-One verification pass — persist gate results as structured records.

---

## Theme 5 — Free/open model landscape (Sept 2026)

### Live OpenRouter probe [VERIFIED-fetched 2026-09]
455 models total; **24 free ($0/$0) lanes**. Notable **new orgs/lanes we don't yet surface**:
- `openrouter/free` — the **Free Models Router** (200k ctx), released Feb 1, 2026, revealed as NVIDIA Nemotron Nano 2 VL [snippet from openrouter.ai page] — a free auto-router lane.
- **NVIDIA Nemotron 3 family free lanes**: `nvidia/nemotron-3.5-lightning:free` (**1M ctx**), `nemotron-3-ultra-550b-a55b:free` (1M), `nemotron-3-super-120b-a12b:free` (262k), `nemotron-3-nano-omni-30b:free`, `nemotron-3.5-content-safety:free`.
- **Thinking Machines**: `thinkingmachines/inkling:free` + `inkling-small:free` (**1M ctx**).
- **Poolside**: `laguna-s-2.1:free`, `laguna-xs-2.1:free`. **Cohere**: `north-mini-code:free`. **Nex AGI**: `nex-n2.5-mini/pro:free`. **InclusionAI**: `ling-3.0-flash-vl/fin/sante:free`. `dots-3-note-preview:free` (512k). `liquid/lfm-2.5-2.6b:free`. `google/gemma-4-26b/31b-it:free`. `qwen/qwen3.8-27b:free`. `z-ai/glm-5.2:free`. (Also `google/lyria-3-*` mispriced $0 — audio models, our NON_TEXT_RE filter correctly excludes.)
- Open-frontier ranking [snippet]: Qwen3.8 Max tops Sept 2026 open-weight boards (73.1) ahead of GLM-5.3; DeepSeek V4 = two large **MIT** tiers; Kimi K3 / MiniMax M3 / GLM-5.2 launched Apr–Jul 2026 (fireworks.ai roundup). Matches our AIHubMix r30 verified roster (glm-5.3, kimi-k3, deepseek-v4-flash live there).
- Free-tier sources beyond our tracked set [snippet]: Google AI Studio free tier, Groq, Cloudflare Workers AI (dataiku Aug 2026 list); LiteLLM/Bifrost as self-host gateways (not catalog sources). `MrFadiAi/free-llm-gateway` (14+ providers w/ fallback) exists but README unfetchable (404) — skip.
- Integration moves: add `openrouter/free` as relay hop candidate (S); surface tracker "new org" signals for thinkingmachines/poolside/nex-agi/cohere (S); nemotron-3.5-lightning:free as a 1M-ctx coding lane (S).

---

## Theme 6 — Agent UX research (transparency / HITL / supervision)

- **Risk-tiered HITL escalation** [snippet]: action classification → escalation layer; **staged actions** ("model proposes/stages, human approves before execution"), async approval workflows, **context packaging** (give the approver what they need to decide). Move: our approval UI should show tool name + args + cost/risk class + last similar decision.
- **Durable approvals** [VERIFIED OpenClaw 9.1]: "Allow Always" persists per tool; approvals follow session posture; reused across placements. Move: approval cache with scope once/session/always.
- **Run transparency** [VERIFIED Devin]: shell durations in worklog, smart diffs, file-tree diff nav. [VERIFIED OpenClaw]: Mermaid diagrams, shareable conversations/archives, team onboarding proposals behind approval. Move: step durations + token counts on run cards (S); shareable read-only run links are a differentiator (M).
- **Supervision dashboards** [snippet]: 2026 enterprise HITL guides converge on structured escalation paths + oversight dashboards rather than one approval button. Our run-kanban + "Needs you" queue is already the right shape; add reason-code chips (r29 statuses) to the queue.

---

## Theme 7 — Skills pattern (summary verdict)

SKILL.md is **the** open convention as of Sept 2026: Anthropic-originated, Apache-2.0 spec, progressive disclosure, adopted across clients (showcase page), plus harness-native libraries (OpenClaw ZIP-import personal libraries; Letta Skills/Mods; Claude Code `.claude/agents/*.md`; DSH `.agents/`). A browser app can adopt it fully client-side: parse YAML frontmatter, store folder-as-JSON in IndexedDB, import via ZIP/URL/paste, expose name+description to the planner, load body on activation, execute `scripts/` only inside our existing node:vm closed-world sandbox.

---

## Ranked integration-ready ideas (for the lead to triage)

1. **SKILL.md skills for users (import + progressive disclosure + vm-gated scripts)** — [VERIFIED agentskills spec + OpenClaw 9.1] Fits: pure browser, reuses vm sandbox + settings UI patterns. Effort **M** (import S, disclosure S, editor M).
2. **Stateless MCP HTTP client (2026-07-28 spec) via our SSRF-guarded API proxy** — [VERIFIED spec changelog] No handshake/session to persist = browser-native; `server/discover` + `tools/list` + `tools/call` with `_meta`; MRTR `input_required` → our approval dialog → retry with `inputResponses`. Effort **L** (but incremental: read-only tools first).
3. **MCP Apps rendering: `ui://` HTML in a sandboxed iframe w/ postMessage bridge** — [VERIFIED SEP-1865] Render tool-returned dashboards/forms in chat; read-only v1, strict sandbox attrs. Effort **M**.
4. **Dreaming-lite: idle/scheduled lesson consolidation into a bounded memory block** — [VERIFIED Letta docs nav + concept] Uses our cheap-lane relay + schedules; localStorage blocks injected into system prompts. Effort **M**.
5. **Thread compaction + memory blocks** — [VERIFIED Letta nav] Summarize-to-block at token threshold; keep receipts pinned. Effort **S/M**.
6. **Run replay/timeline viewer** (scrubber, per-step durations/tokens, re-run-from-step-k, export JSON) — [VERIFIED Devin worklog timings; snippet LangGraph Studio] Builds on our persisted step records. Effort **M**.
7. **`openrouter/free` router lane + new free orgs (inkling, laguna, nex, north) in relay/tracker surfaces** — [VERIFIED live probe] Effort **S**.
8. **Durable tool approvals (once/session/always) + reason-coded "Needs you" queue** — [VERIFIED OpenClaw 9.1; snippet HITL guides] Effort **S/M**.
9. **Mermaid rendering in the markdown renderer** — [VERIFIED OpenClaw 9.1] Big UX win for plans/architecture answers; add fail-retry like OpenClaw. Effort **S**.
10. **Reasoning-effort selector per chat + per workflow step** — [VERIFIED Devin SWE-2] Providers already accept it for thinking models; r29 next-candidate list already had per-step overrides. Effort **S**.
11. **Wide Research fan-out step type** (≤5 parallel sub-runs + reduce, per r29 policy) — [snippet Manus 1.6] Effort **M**.
12. **AGENTS.md/llms.txt context-pack ingester** (fetch from URL → attach to chat/workflow) — [snippet conventions] Reuses SSRF-guarded fetch; cheap differentiator. Effort **S**.
13. **Checkpoints: re-run-from-step-k** (subset of #6 if split) — [snippet hermosaai matrix: plan mode + checkpoints are standard] Effort **M**.
14. **Boot resilience doctrine for workflows store: quarantine malformed schedules, never block app boot** — [VERIFIED OpenClaw 9.1 gateway behavior] Effort **S**.
15. **Shareable read-only run links (export bundle)** — [VERIFIED OpenClaw 9.5 conversations share] Effort **M**.

## Explicit DON'Ts

1. **Don't build stateful MCP transport (sessions, SSE resumability, handshake) for pre-2026-07-28 semantics** — the spec just removed them; implement stateless + `_meta` + `server/discover` only, or we'd be writing against the dead protocol version.
2. **Don't adopt A2A in the client** — server-to-server inter-org protocol (150+ orgs, but cloud/enterprise plumbing); zero payoff for a single-user BYOK browser app vs. MCP+skills; revisit only if we ever expose our workflows as callable agent endpoints.
3. **Don't mirror DSH's Cordis plugin architecture (YAML patch overlays, profiles, service graph) into our stack** — it's a Node server/desktop harness pattern; our Next.js browser app has no plugin lifecycle need. Borrow concepts (permission policy as subsystem, reversible registrations, replaceable agent loop) via plain TS modules instead. Also it's a developer preview with self-declared breaking changes — don't pin to its plugin API.
4. (Bonus) **Don't execute skill `scripts/` outside the node:vm sandbox** — the Agent Skills spec explicitly allows bundled executable code; our closed-world vm + validation stays mandatory.

## Searches executed (22, raw JSON in /tmp/r31/s01–s22.json)
1. open-source agent harness comparison Sept 2026 (OpenClaw/Cline/Goose/browser-use)
2. "DSH" DeepSeek harness identity
3. OpenClaw 2026 release features/changelog
4. Claude Agent SDK 2026 features/changelog
5. OpenAI AgentKit/Agent Builder update
6. Manus 1.6 / Wide Research / Devin 2026
7. Google Jules / Gemini agent tooling 2026
8. MCP Sept 2026 registry/elicitation/sampling status
9. Agent Skills / SKILL.md ecosystem 2026
10. A2A protocol adoption 2026 (Linux Foundation)
11. Letta sleep-time compute / Mem0 / context engineering 2026
12. METR time-horizon update / GEPA / DSPy 2026
13. new open LLMs Sept 2026 (Qwen/GLM/DeepSeek/Kimi/MiniMax)
14. NVIDIA Nemotron router / free model routers
15. agent UX HITL approval/interrupt patterns 2026
16. AGENTS.md / llms.txt convention status 2026
17. MCP-UI / MCP Apps spec 2026
18. agent evals / verifiers / GEPA 2026
19. browser-use / Cline / Roo UI features 2026
20. free LLM gateways keyless OpenAI-compatible 2026
21. agent session replay / LangGraph Studio traces 2026
22. Letta memory-models exact URL hunt

## Primary sources fetched (curl/raw)
- github.com/deepseek-ai/deepseek-harness (README.md, docs/architecture.md, docs/user/guide/index.md, docs/user/develop/basic/index.md)
- github.com/openclaw/openclaw CHANGELOG.md + CHANGELOG/2026.9.5.md + CHANGELOG/2026.9.1.md
- modelcontextprotocol.io/specification/2026-07-28/changelog
- github.com/modelcontextprotocol/ext-apps specification/2026-01-26/apps.mdx (SEP-1865)
- github.com/agentskills/agentskills README.md
- docs.devin.ai/release-notes (Sept 2026 entries)
- docs.letta.com (docs nav incl. Memory & dreaming / Skills / Evals structure)
- openrouter.ai/api/v1/models (live probe: 455 models, 24 free lanes enumerated)
