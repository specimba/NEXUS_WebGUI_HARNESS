# Repo Sweep Report — Harness Curation (r515-a)

Date: 2026-10-24 · Agent: Explore (research-only) · Input: `upload/githubREPOsweepHARNESS2410.txt` (54 URLs → 51 unique targets after dedupe: 1 user profile, 1 topic page, 1 org page, 48 repos)

**Method & honesty note:** GitHub API was rate-limited from this sandbox (shared egress IP, 403 on all calls). Fallback: scraped each GitHub repo's HTML (embedded `stargazerCount`/`createdAt` + og:description) and each repo's `commits.atom` for last-commit date — all star counts, activity dates, and descriptions below were **verified today** unless marked **[KB]** (knowledge-based, unverified today). GitCode has no API; its pages expose og:description meta, which I scraped — so GitCode descriptions are verified, but GitCode star counts are **n/a**. Several GitCode URLs are mirrors of GitHub repos; where I found and verified the GitHub twin I cite the twin's numbers. "Sandbox today" ≈ 2026-10-24 (commits.atom feeds show commits timestamped that morning).

Platform lens for scoring (from worklog r498→r514): Next.js 16 WebGUI harness; BYOK provider vault + lane rotation; relay chain with tiered hops (Intern SystemOne → vault fast judge → paid Jev); workflow engine with server-lane scheduled runs (automation-executor); capability radar; Supabase mirror; Cortex Edge function wired to Upstash Redis/Vector/QStash/Box; Webshare egress pool with CONNECT-tunnel routing (r514); Hyperbrowser direct lane planned; crew system + frontier scout.

---

## A. Executive summary — Top 10 by adaptability

The curation's jackpot is that three of its repos are literally converging on our architecture from different directions: **deepseek-ai/deepseek-harness** (260k★ in ~10 weeks — "everything is a plugin") validates a uniform plugin-manifest doctrine we should adopt for tools/lanes/crew packs; **decolua/9router** (31k★) proves the market wants multi-provider auto-fallback with token-lean routing, which maps 1:1 onto hardening our relay's hop ladder; and **upstash/workflow-js** is the missing durable-execution semantics for our server-lane scheduled runs — our Cortex already owns QStash credentials, so modeling each scheduled run as retryable steps with `waitForEvent` human-gates is an adaptation, not a new integration. **HarnessRouter** contributes the harness-agnostic adapter surface (one config fronting Claude Code/Codex/DSH-style harnesses), **nexent** contributes constraint-bound auto-generation of agents (fuel for our spawn-proposal), **awslabs/cli-agent-orchestrator** contributes tmux-isolated CLI-agent lanes with supervision, **SakanaAI/mass** contributes free peer self-supervision as a quality gate for our crew (judged by our intern decision tier = zero marginal cost), **inclusionAI/AWorld** contributes the parallel explore→reproduce→improve loop to upgrade frontier-scout from "find" to "verify", **hermes-zvec-memory** contributes cheap hybrid BM25+vector RRF retrieval over Markdown (bolt-on for Cortex Vector), and **eigent** contributes the workforce-decomposition UX patterns for a crew-first WebGUI. Total realistic effort across the top 10 is ~6–10 rounds; nothing requires new paid services.

---

## B. Full table

Verdicts: ADAPT = concrete adoption target for our platform; WATCH = track, adopt only if a trigger fires; SKIP = no realistic adaptation. Stars verified today unless "est."/[KB]/n/a. Activity = last commit date.

| # | Repo | Stars | Activity | What it is | Verdict | Specific adaptation for our platform |
|---|------|-------|----------|------------|---------|--------------------------------------|
| 1 | deepseek-ai/deepseek-harness | 260,145 | 2026-10-23 | DeepSeek's official agent harness; "Everything is a Plugin" (created 2026-08-13) | **ADAPT** | Plugin-manifest doctrine: wrap our tools/lanes/crew in a uniform drop-in pack format (id/caps/permissions) so community packs install without code |
| 2 | morluto/rea | 376,235 | 2026-10-24 | "Reverse engineer anything with agents — app behavior down to native binaries" | WATCH | Pattern only: bounded agent loops over opaque black boxes → template for a deep tool-use lane; core function is out of our product scope |
| 3 | decolua/9router | 31,313 | 2026-10-23 | Free-AI coding router: 40+ providers, auto-fallback, "RTK −40% tokens" | **ADAPT** | Auto-fallback ladder + token-lean request shaping (prompt-prefix caching hints, RTK-style trimming) for relay hop selection |
| 4 | eigent-ai/eigent | 15,652 | 2026-10-23 | Open-source local "Cowork" desktop; multi-agent workforce | **ADAPT** | Workforce UX: task→subtask decomposition cards, per-worker evidence panels in the run drawer |
| 5 | f/prompts.chat | 174,345 | 2026-10-24 | Community prompt library, self-hostable | WATCH | Seed-prompt packs for new-agent templates; zero architecture value |
| 6 | astral-sh/ruff | 50,251 | 2026-10-23 | Rust Python linter/formatter | SKIP | Dev tooling only; nothing for the harness |
| 7 | supabase/supabase | 113,868 | 2026-10-23 | Our own backend (mirror + edge) | SKIP | Already load-bearing; nothing new to adapt |
| 8 | iflytek/astron-agent (gitcode mirror) | 8,917 (twin) | twin active [KB] | iFLYTEK enterprise agentic workflow platform ("SuperAgents") | WATCH | Workflow-node taxonomy + enterprise permission model to compare against our workflow defs |
| 9 | ModelEngine-Group/nexent (gitcode mirror) | 6,025 (twin) | twin active [KB] | Zero-code auto-generation of prod-grade agents using "Harness Engineering principles"; unified tools/skills/memory + built-in constraints | **ADAPT** | Constraint-bound spawn: generate candidate agents from radar/tool registry with built-in constraint scaffolding before human approve |
| 10 | ageerle/ruoyi-ai (gitcode mirror) | 5,774 (twin) | twin active [KB] | Java enterprise AI framework (RAG, workflows, multi-agent) | SKIP | Java/Spring stack; only generic RAG patterns, which we already have |
| 11 | deepseek-ai/deepseek-recipe | 2,351 | 2026-10-19 | Official DeepSeek recipes/examples (bilingual README) | WATCH | Recipe seeds for deepseek lanes' system prompts; no architecture value |
| 12 | PrimeIntellect-ai/prime-rl | 2,191 | 2026-10-24 | Agentic RL training at scale | SKIP | Training infra; our platform trains nothing |
| 13 | HarnessRouter/harnessrouter | 3,290 | 2026-10-24 | Self-hosted Apache-2.0 unified interface for agent harnesses (Codex, Claude Code, Hermes, PI, DSH…) | **ADAPT** | Harness-agnostic lane adapter spec: one normalized config/profile that fronts heterogeneous harness CLIs as interchangeable lanes |
| 14 | Tongyi-MAI/MAI-UI | 2,418 | 2026-08-19 | Qwen GUI-agent foundation model (real-world UI control) | WATCH | Pair with the Hyperbrowser lane when browser automation ships; heavy model otherwise |
| 15 | awslabs/cli-agent-orchestrator | 1,467 | 2026-10-24 | Orchestrates coding CLIs (Claude Code, Kiro, Codex…) in isolated tmux sessions | **ADAPT** | tmux-isolated CLI lanes with session supervision + failure capture for server-lane runs |
| 16 | inclusionAI/AWorld | 1,246 | 2026-10-14 | Ant's agent framework: "search, understand, reproduce, improve an idea"; large-scale parallel agents | **ADAPT** | Parallel explore→reproduce→improve loop as frontier-scout v2 (verify findings, not just list them) |
| 17 | inclusionAI/Avernet | 593 | 2026-10-24 | Distributed agent coordination "like an organization" (new, 2026-07) | WATCH | Org-structure role model for crew (manager/peer/audit roles) once crew grows past a handful |
| 18 | adithya-s-k/FineEnvs | 530 | 2026-10-22 | "RL Environments 101" — building/scaling RL environments | WATCH | Reading material for eval-environment thinking; no code to adopt |
| 19 | thesysdev/openui | 13,553 | 2026-10-23 | Open standard for generative UI | WATCH | Later: generated step-result widgets inside run drawer; needs sanitization doctrine first |
| 20 | OpenCoven/coven | 73 | 2026-10-24 | Local-first runtime for coding-agent sessions: durable state, authority boundaries, multi-harness interop | **ADAPT** | Authority-boundary model: which lanes may write vs propose vs approve — encode into workflow defs |
| 21 | PrimeIntellect-ai/prime-agent | 22,302 | 2026-10-23 | Self-improving RLM (recursive-LM) agent for long-running coding tasks | WATCH | RLM-style outer-loop self-critique for long runs; needs cost guardrails |
| 22 | upstash/workflow-js | 156 | 2026-10-06 | Durable serverless workflows on QStash (TS SDK) | **ADAPT** | Durable-step semantics (invoke-URL, per-step retry, `waitForEvent`) for scheduled server-lane runs via our existing QStash wiring |
| 23 | upstash/workflow-py | 33 | 2026-08-21 | Same, Python SDK | SKIP | We are a TS/Next.js stack; js SDK covers it |
| 24 | upstash/vector-js | 72 | 2026-03-09 | Upstash Vector TS SDK | WATCH | We already call Vector via Cortex; SDK idioms (namespaces, metadata filters) for semantic-memory upgrades |
| 25 | upstash/vector-py | 20 | 2025-10-21 | Upstash Vector Python SDK | SKIP | Wrong language |
| 26 | webshare-proxy/webshare-python | 3 | 2026-09-29 | Official Webshare proxy API SDK | **ADAPT** (small) | Cross-check our hand-rolled egress client against the official SDK's auth (`Authorization: Token`), `mode=direct`, pagination and error envelopes — corroborates r514 facts; possibly replace our parser edge cases |
| 27 | webshare-proxy (org) | n/a (6 repos) | n/a | Org page | n/a | Not a repo; pointer to SDK above |
| 28 | deepseek-ai/deepseek-harness → see #1 | — | — | — | — | — |
| 29 | decolua/9remote | 215 | 2026-10-23 | "Terminal in your pocket": control Claude Code/Codex/Gemini CLI from phone | WATCH | Mobile command surface for scheduled runs (we're already mobile-clean at 390px); later |
| 30 | thesysdev/openui — see #19 | — | — | — | — | — |
| 31 | morluto/rea — see #2 | — | — | — | — | — |
| 32 | SakanaAI/mass | 304 | 2026-10-09 | "Multi-Agent Self-Supervision" (new, 2026-09) | **ADAPT** | Peer self-supervision gate: crew agents score each step; intern decision tier as judge = free quality metric fed to radar |
| 33 | tmux/tmux | 49,975 | 2026-10-24 | Terminal multiplexer | SKIP | Ambient infra (and cli-agent-orchestrator's substrate); nothing to adapt |
| 34 | PostHog/posthog | 40,405 | 2026-10-24 | Product analytics + AI observability, self-hostable | SKIP | Heavy self-host for a single-owner harness; revisit only if usage analytics ever matter |
| 35 | coollabsio/coolify | 63,680 | 2026-10-24 | Self-hosted PaaS | WATCH | Only if the harness ever leaves this sandbox and needs self-hosted deploys |
| 36 | RooCodeInc/Roomote | 308 | 2026-10-24 | "Your own cloud coding agent" — remote-controlled Roo | WATCH | Remote session-control model (task queue + live status) mirrors our server-lane runs; compare UX later |
| 37 | a2aproject/a2a-cli | 162 | 2026-10-16 | Official CLI for A2A (Agent2Agent) agents | SKIP | Cross-org agent mesh protocol; no second org to talk to |
| 38 | agntcy/slim | 231 | 2026-10-20 | Secure low-latency messaging for agents (Linux Foundation) | SKIP | Same reason as a2a — interop infra without an interop partner |
| 39 | bruc3van/dsh-desktop | 93 | 2026-10-20 | Community DeepSeek Harness desktop client; tray-resident long tasks; built-in "safe market", 600+ [KB: exact 600+ what — plugins from og:description truncation] | WATCH | Tray-resident long-task UX + market-catalog curation ideas; depends on deepseek-harness pack format |
| 40 | r0b0tlab/hermes-zvec-memory | 93 | 2026-10-17 | Local-first memory provider: hybrid BM25+vector RRF over a Markdown vault | **ADAPT** | RRF hybrid retrieval shim over Cortex Vector + our Markdown context files — cheap, dependency-free relevance win |
| 41 | github.com/n24q02m | n/a (user; 54 repos) | n/a | User profile [KB: identity unclear — possibly the curator] | n/a | Not a repo; ask owner if one of its 54 repos was intended |
| 42 | github.com/topics/dsh-plugin | n/a (topic page) | n/a | Directory of "dsh-plugin" ecosystem repos | WATCH | Directory source for deepseek-harness plugin packs; periodic re-crawl, not a dependency |
| 43 | GitHub_Trending/orca48/orca (gitcode) | n/a (gitcode) | n/a [KB: likely a trending mirror; GitHub original unverified] | Terminal agent controlling IDEs: git-worktree management, multi-terminal, smart notifications, GitHub integration (desc verified via GitCode) | **ADAPT** | Git-worktree-per-run isolation + smart-notification triggers for long workflow runs |
| 44 | openJiuwen/agent-studio (gitcode) | n/a | n/a | Visual agent/workflow dev studio, dev→deploy full stack (desc verified) | WATCH | Visual editor patterns vs our workflow editor; [KB] attribution: openJiuwen = Chinese telco-linked open-source agent family |
| 45 | openJiuwen/agent-core (gitcode) | n/a | n/a | Agent runtime SDK: agent creation, workflow orchestration, LLM/tool-call interfaces, high-perf runtime (desc verified) | WATCH | Runtime API shape to skim for lane/step abstractions |
| 46 | openJiuwen/jiuwenswarm (gitcode) | n/a | n/a | LLM swarms driven via everyday messaging apps; Huawei Cloud MaaS support (desc verified) | WATCH | Messaging-app command channel for runs (Telegram-style control); niche |
| 47 | ModelEngine/fit-framework (gitcode) | n/a | n/a | Multi-language function engine + streaming orchestration; Java LangChain alternative; hot-plug plugins (desc verified) | SKIP | Java ecosystem; our stack is TS |
| 48 | DevCloudFE/MateChat (gitcode, twin 176★) | 176 (twin) | n/a | Huawei Vue AI-chat UI component library | SKIP | Vue vs our React/shadcn kit; UX inspiration only, and ours is already deep |
| 49 | datawhalechina/hello-agents (gitcode, twin 84,409★) | 84,409 (twin) | n/a | Chinese textbook: build agents from scratch | SKIP | Great onboarding reading; zero code to adopt |
| 50 | moeru-ai/airi (gitcode, twin 50,664★) | 50,664 (twin) | n/a | Self-hosted AI companion/vtuber container | SKIP | Entertainment vertical; no harness capability |
| 51 | Panniantong/Agent-Reach (gitcode) | n/a | n/a | Toolkit letting agents read web/video/social content across channels (desc verified) | **ADAPT** (small) | Channel matrix for our read tools: map each channel (page/video/social) to Hyperbrowser vs Exa vs fetch in one resolver |
| 52 | B1gmoon/Software-Copyright-Rapid-Template-Generation-Tool (gitcode) | n/a | n/a [KB] | Chinese software-copyright (软著) application doc generator (desc verified) | SKIP | Niche paperwork tool |
| 53 | ageerle/ruoyi-ai — see #10 | — | — | — | — | — |
| 54 | javabetter/PaiAgent (gitcode) | n/a | n/a | Zero-code drag-drop AI workflow builder, OpenAI/Qwen models (desc verified) | SKIP | We already shipped a workflow editor; nothing beyond parity |
| 55 | ElonMusk666/springboot-openai-chatgpt (gitcode) | n/a | n/a | SpringBoot full-stack GPT demo app (desc verified) | SKIP | Tutorial-grade demo |
| 56 | javabetter/paicoding (gitcode) | n/a | n/a [KB: Java 技术派 community platform; desc verified: Spring Boot forum with users/articles/comments/search] | Java learning community platform | SKIP | Off-domain |

Raw-line accounting: 54 lines → duplicates (`hello-agents` listed twice, once glued to `airi` on one line), non-repos (n24q02m profile, topics/dsh-plugin, webshare-proxy org), and `deepseek-ai/deepseek-harness` appearing once = 48 unique repos + 3 non-repo targets. All 54 lines are accounted for in the table above.

---

## C. Three combination plays

**1. Durable scheduled runs: upstash/workflow-js × our Cortex QStash wiring × automation-executor.** Re-emit each server-lane scheduled run as a workflow-js-style durable function: QStash publishes to our edge (Cortex already holds the credentials and endpoint), each workflow step becomes an individually-retried invoke with `waitForEvent` for human approval gates, so a crashed or redeployed run resumes instead of dying mid-ladder. Honest effort: medium — the QStash transport exists today (r513/r514 proved it), but our runner's state machine lives in Postgres/Supabase, so the work is a step-boundary redesign plus idempotency keys, realistically 2–3 rounds, not a drop-in library install (workflow-js expects to own the publish loop).

**2. Free peer quality gate: SakanaAI/mass + inclusionAI/AWorld × our crew system × Intern SystemOne.** Replace the current "one output, one human read" flow with a self-supervision ring: each workflow step's output is blind-scored by 2–3 peer crew agents (mass-style multi-agent self-supervision), using the free intern decision tier as judges so marginal cost stays ~zero; AWorld's explore→reproduce→improve loop then becomes the escalation path — low-scoring steps trigger one bounded re-run with the judges' critiques injected. Honest effort: medium; the crew panel and relay tiers already exist, the new parts are the blind-scoring prompt protocol, a scores→radar feed, and a runaway guard (max 1 auto-rerun), ~1–2 rounds.

**3. Two-tier routing doctrine: decolua/9router × HarnessRouter × our relay + Webshare egress.** Borrow 9router's auto-fallback ladder (provider health scores, hop demotion, token-lean request shaping) *beneath* HarnessRouter's harness-agnostic adapter idea *above*: one normalized lane-descriptor schema so a "lane" can be a plain OpenAI-compatible endpoint (today) or a full harness CLI (Claude Code/Codex-style, via cli-agent-orchestrator's tmux pattern) later, with the r514 egress routing map deciding per-upstream transport. Honest effort: the fallback-ladder half is cheap (health memory + demotion already exist in embryo in relay.ts); the harness-CLI adapter tier is a bigger lift (process supervision, auth, output parsing) and should be gated behind an owner decision, 1 round for tier 1, 2–3+ for tier 2.

---

## D. Not worth it (with reasons)

- **supabase/supabase** — already our backend; adopting upstream code is a maintenance liability, not a capability.
- **tmux/tmux, astral-sh/ruff** — ambient dev infra; no harness capability to port.
- **PrimeIntellect-ai/prime-rl** — RL training cluster infra; our platform trains nothing and BYOK doctrine points the other way.
- **adithya-s-k/FineEnvs** — RL-environments guide; worth *reading*, not adopting.
- **deepfates/imp** — elegant self-improving-program DSL, but Elixir-native; concept overlap with mass/prime-agent which land closer to our stack.
- **PostHog/posthog** — self-hosting a product-analytics suite for a single-owner harness is overhead without an audience problem.
- **coollabsio/coolify** — only relevant the day this leaves the sandbox; today it solves a problem we don't have.
- **agntcy/slim + a2aproject/a2a-cli** — interop/mesh protocols with no second party to interop with; revisit if the harness ever exposes agent endpoints to others.
- **DevCloudFE/MateChat** — Vue component library against our Next.js/React shadcn kit; pure rewrite cost.
- **ModelEngine/fit-framework, ageerle/ruoyi-ai, javabetter/PaiAgent, ElonMusk666/springboot-openai-chatgpt, javabetter/paicoding** — Java/Spring ecosystem, tutorial-to-community grade; our workflow editor, RAG, and chat stack already exceed what they'd contribute, and porting across language boundaries is pure loss.
- **moeru-ai/airi** — companion/vtuber vertical; delightful, off-mission.
- **datawhalechina/hello-agents** — excellent textbook (84k★ proves reach), zero adoptable code.
- **B1gmoon/Software-Copyright-Rapid-Template-Generation-Tool** — 软著 paperwork generator; niche and jurisdiction-specific [KB].
- **openJiuwen/agent-studio + agent-core, jiuwenswarm** — WATCH not SKIP, but be honest: GitCode-only, stars unverifiable, and their visual-studio/runtime patterns duplicate what we already shipped; revisit only if the owner wants the messaging-app command channel.
- **morluto/rea** — spectacular numbers (376k★) but reverse-engineering binaries is a different product; we borrow only its bounded-loop pattern (see WATCH row).

---

### Cross-cutting observation worth the owner's attention

The curation quietly maps the entire deepseek-harness ecosystem: the harness itself (#1), its desktop client (dsh-desktop), a router that fronts it (HarnessRouter), its plugin topic page (dsh-plugin), and its recipe repo (deepseek-recipe). That family is currently the strongest gravitational center in agent tooling (260k★ in ~10 weeks), and its "everything is a plugin" manifest is the single highest-leverage thing on this list for making our tool/lane/crew surface extensible without monorepo growth. Recommended reading order if the owner wants a deep-dive next: deepseek-harness → HarnessRouter → 9router → workflow-js → nexent.
