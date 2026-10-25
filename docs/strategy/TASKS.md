# TASKS.md — the living integration backlog (versioned mirror)

> The DB (`StrategyItem`) is the runtime source of truth — the AIE advances
> rows there every 10-min cycle, and `GET /api/strategy` serves them. This file
> is the git-versioned mirror the chat-side architect updates each round, so
> every agent (and the Owner) can see the strategy without a running server.
> Sync action: POST /api/strategy {action:"sync"} seeds the DB from the same
> list idempotently (dedupeKey per title).

Status legend: `proposed → ready → in-progress → done` · `blocked` = waiting
on the Owner. Priority P1/P2/P3. "advanced" = AIE cycles touched it
(data-only), which is a heartbeat, not implementation — implementation is the
architect's dev-round lane (see [AGENT.md](./AGENT.md) §2).

## Owner actions (blocked on the Owner — surfaced in every briefing)

- [ ] **P1** Rotate the GitHub PAT exposed in bb6120b31 (public history). `scripts/backup-push.sh` already refuses to run without an exported `GITHUB_BACKUP_PAT`. → TASK (seed)
- [ ] **P1** Paste the real Webshare token on Settings → Egress → witness groq probe flip 403 (WAF) → 401 (key-level, via pool).
- [x] **P1** ~~Recreate the z.ai-side dev patrol cron~~ **ARMED r517 — job 473388** (agentTurn, every 30 min :07/:37 Europe/Istanbul, priority 10, 1517-char message). Root cause of every past failure distilled into `docs/platform/cron-creation-criteria.md` (≤2000 chars · agentTurn-only · ≥30-min cadence · 6-field-with-seconds expr · explicit tz · round budget). If the registry wipes again: re-create from the paste block in that doc.
- [ ] **P2** Create the Supabase Storage bucket `nexus-backups` on vwottesqbdgcsmvvvzok (policies: anon insert ALLOWED, anon select DENIED) → `scripts/backup-shard.sh` output (4 × ≤49MiB shards + sha256 manifest) gets a durable offsite home; 1GB free ≈ 5 generations. See `docs/platform/zai-storage-deep-dive.md`.
- [ ] **P2** Decide the 2 baselined preseed keys in `src/lib/constants.ts` (rotate + relocate to vault seed).
- [ ] **P2** Add a fine-grained read-only GitHub PAT to PlatformSetting → the engine's api research lane auto-resumes (currently html-fallback).

## Integrations (P1 — the sweep's combination plays)

- [ ] **P1** **9router auto-fallback ladder in relay.ts** — hop ladder already walks 429/403/5xx with health memory + provider breaker (r504/r493, delivered earlier); remaining slice = token-lean request shaping (9router-style budget-aware max_tokens / context trims per hop class). *Acceptance: qa script witnesses a provider storm survivable with zero manual toggles + measured token deltas.* (9router 31,313★)
- [x] **P1** **Benchmark-led lane ordering ("not on words only")** — r516 intelligence index: server producer distills arena.ai WebDev/Agent + Artificial Analysis intelligence/coding-agents (live parse → honest curated-snapshot fallback → 6h PlatformSetting cache, GET /api/intelligence), relay chain sorts within class by 65% benchmark · 35% catalog Elo. Mercury-3 (0.90) no longer outranks qwen3.8-max-free (0.95). UI: Benchmark intelligence panel + Intel badges (Settings → Model Relay).
- [x] **P1** **Decision models in workflows (System-One everywhere)** — r516 per-step Decision Gates: after every regular generate step the free ladder (Intern Decision-4B 200 RPM quota → fast flash judge → Jev only if ever keyed) judges output vs step assignment; confident FAIL → one bounded free rework pass; toggle in Model Relay card (`decisionGates`, default on). Joins the r512 crew role-gates + r27 verify gate.
- [ ] **P1** **Durable-step semantics for scheduled runs** — per-step retry + resume-after-restart (upstash/workflow-js invoke/retry/waitForEvent shape) on the existing QStash wiring, no new service. *Acceptance: a scheduled server run that dies mid-way resumes at the failed step; visible in the run archive.*
- [ ] **P1** **NEXUS_BOT adaptation wave** — port from `upload/NEXUSbot2210v3.tar`: server-side AES-256-GCM vault, single redaction choke point in front of every outbound LLM dial, Anthropic-dialect lanes, Exa/Bright Data acquisition lanes. *Acceptance: vault round-trips server-only; one redaction module covers relay + engine + radar dials.* (r524 slice 1: `src/lib/redaction.ts` choke on engine + autonomy dials; r525 slice 2: module moved to shared `src/lib/` (isomorphic) + wired into the agent-engine tool-loop dial and the SystemOne fast-judge dial — 5 of 5 known LLM dial bodies covered — plus live telemetry `GET /api/automation/redaction` surfaced as a Redaction cell on the Engine panel's Automation pulse. `scripts/qa-redaction.ts` 9/9; note: the tar holds NO redaction module, its `lib/guard.ts` is a rate limiter. r526 slice 3: vault at-rest AES-256-GCM live (`src/lib/server/vault-crypto.ts` — WebCrypto, env-or-machine-file master key, honest legacy read path, idempotent boot migration; all 8 vault touch points encrypt/decrypt server-side; `scripts/qa-vault-crypto.ts` 9/9; vault card carries an "AES-256-GCM at rest" badge). r527: `scripts/seedwrite.ts` upgraded to a two-way bridge — export decrypts to the plaintext seed backup, `--import` writes keys encrypted through the same module (owner re-entry path after the r521 rollback), E2E-proven by `scripts/qa-seedwrite.ts`. Remaining: Anthropic-dialect + Exa/BrightData lanes.)

## Integrations (P2)

- [ ] **P2** **Plugin-manifest doctrine** — one JSON manifest registering a tool+lane+crew pack without code edits ("Everything is a Plugin", deepseek-harness 260k★ ecosystem anchor). *Acceptance: sample pack drops into a watched folder, appears in the tools registry after reload.*
- [ ] **P2** **Harness-agnostic lane-adapter spec** (HarnessRouter 3,290★) — adapter interface so NEXUS lanes can serve foreign harnesses. *Acceptance: spec doc + one reference adapter passing a fixture test.*
- [ ] **P2** **url-kind research lane** — direct page reader in `autonomy.ts` (og:description + title scrape, same scoring shape) so ~10 queued gitcode rows stop waiting honestly forever. *Acceptance: queued url rows flip to researched/skipped with honest notes within one cycle budget.*

## Experiments (P2/P3 — budget 1-2 rounds each)

- [ ] **P2** Peer blind-scoring quality gate on crew steps (SakanaAI/mass × Intern tier): second cheap-lane pass blind-scores each crew step; below-threshold triggers one revise pass. *Acceptance: crew run log shows scorer verdicts.*
- [ ] **P3** hermes-zvec-memory RRF hybrid retrieval shim (BM25 + vector) over existing notes/research stores. *Acceptance: script comparing BM25-only vs RRF on real research rows.*
- [ ] **P3** AWorld explore→reproduce→improve loop for frontier-scout v2. *Acceptance: scout marks each seed reproduced/not-reproduced with evidence.*
- [ ] **P3** nexent constraint-bound agent auto-generation → spawn-proposal fuel. *Acceptance: spawn proposals carry a constraint block the editor validates.*

## Done (this round + carried)

- [x] r517: **Free reach census (freellm.sh filtered view)** — the REACH half of "reach × intelligence": server producer parses the site's RSC flight payload once (`/api/freellm`, 6h PlatformSetting cache, fail-open, no invented data) and derives the Owner's filtered view server-side (access ∈ free-tier/free-forever/signup-credits ∧ operational, newest-first); Model Relay gains the teal Free-reach panel (filter chips, NEW/gated badges, operational dots, scrolling census) + per-hop `reach` badges on the relay ladder; live: 153 sources → 151 free+operational.
- [x] r517: **Cron failure root-caused + patrol re-armed** — job 473327 (r516-b) died from the triple violation (>2000 chars · webDevReview class · 15-min cadence); criteria doc + compliant patrol 473388 armed (see Owner actions).
- [x] r517: **Storage deep dive + sharded backup pipeline** — chat.z.ai 2GB storage is browser-session-gated (backend BLOCKED, verdict + evidence in docs/platform/zai-storage-deep-dive.md); `scripts/backup-shard.sh` ships the proven 4×≤49MiB pipeline (excludes .chrome-qa-profile/.env, sha256 manifest, restore recipe).
- [x] r517: **r515/r516 recovery** — local repo had regressed to r514 (another sandbox rollback); fast-forwarded from origin (01644552d), worklog spliced whole (r515→r515-c→r516→517-a/b), prisma client regenerated (r515 models), db:push clean.
- [x] r516: **Benchmark intelligence routing** — intelligence-index producer + API + relay blend sort + Benchmark panel/Intel badges; snapshot honest-fallback witnessed live (arena 403 from sandbox IP, AA JS-rendered).
- [x] r516: **Scroll-bug class closure** — radar TabsContent all scroll containers (frontier/github/hf/papers); run-panel task box capped (max-h + internal scroll, shrink-0 controls, min-h-0 log); editor dialog textareas capped. Owner's recurring complaint addressed at the CLASS level.
- [x] r516: **Per-step Decision Gates** in workflow-runner (free SystemOne ladder, one rework, never blocks) + toggle.
- [x] r516: **GitHub radar pool escape hatch** — 403/429 → Webshare pool retry (honest `via: "pool"` + toast); fixes specimba stale refresh path.
- [x] r516: **Webshare knowledge distilled** — CLI/MCP/Skills surfaces noted (ops doc); mirror lone-surrogate sanitizer verified present (r510, cloud-mirror.ts).
- [x] r515: AIE v1 — queue normalization, deterministic moves, safe execution, 10-min cycles, panel. (r515-a/b)
- [x] r515: repo sweep research — 54 URLs → docs/repo-sweep-report-2410.md, 56-row scored table. (r515-a)
- [x] r515-c: **Strategic Context Layer** — StrategyItem model, engine `advance-strategy` moves, await-owner cooldown (no more identical no-op spam), ADAPT→auto-backlog hook, digest stream, `GET /api/strategy` context pack, `GET /api/briefing`, Strategy card in Workflow Studio, AGENT/TASKS/WORKLOGS doctrine files, cron doctrine (3 layers).

## Round log pointer

Per-round details live in `/home/z/my-project/worklog.md` (append-only,
`---`-separated sections with Task ID / Agent / Task / Work Log / Stage
Summary / Round Handoff). See [WORKLOGS.md](./WORKLOGS.md) for the discipline.
