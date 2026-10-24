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
- [ ] **P1** Recreate the z.ai-side dev patrol cron from YOUR account (the resilient control plane) — paste-ready task text in `GET /api/briefing` or the Strategy card's "Copy cron brief".
- [ ] **P2** Decide the 2 baselined preseed keys in `src/lib/constants.ts` (rotate + relocate to vault seed).
- [ ] **P2** Add a fine-grained read-only GitHub PAT to PlatformSetting → the engine's api research lane auto-resumes (currently html-fallback).

## Integrations (P1 — the sweep's combination plays)

- [ ] **P1** **9router auto-fallback ladder in relay.ts** — map current hop ladder in `provider-rotation.ts`, add decolua/9router-style auto-fallback (ladder walk on 429/403/5xx, token-lean shaping). *Acceptance: lane rotation survives provider storms with zero manual toggles, measured in a qa script.* (9router 31,313★)
- [ ] **P1** **Durable-step semantics for scheduled runs** — per-step retry + resume-after-restart (upstash/workflow-js invoke/retry/waitForEvent shape) on the existing QStash wiring, no new service. *Acceptance: a scheduled server run that dies mid-way resumes at the failed step; visible in the run archive.*
- [ ] **P1** **NEXUS_BOT adaptation wave** — port from `upload/NEXUSbot2210v3.tar`: server-side AES-256-GCM vault, single redaction choke point in front of every outbound LLM dial, Anthropic-dialect lanes, Exa/Bright Data acquisition lanes. *Acceptance: vault round-trips server-only; one redaction module covers relay + engine + radar dials.*

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

- [x] r515: AIE v1 — queue normalization, deterministic moves, safe execution, 10-min cycles, panel. (r515-a/b)
- [x] r515: repo sweep research — 54 URLs → docs/repo-sweep-report-2410.md, 56-row scored table. (r515-a)
- [x] r515-c: **Strategic Context Layer** — StrategyItem model, engine `advance-strategy` moves, await-owner cooldown (no more identical no-op spam), ADAPT→auto-backlog hook, digest stream, `GET /api/strategy` context pack, `GET /api/briefing`, Strategy card in Workflow Studio, AGENT/TASKS/WORKLOGS doctrine files, cron doctrine (3 layers).

## Round log pointer

Per-round details live in `/home/z/my-project/worklog.md` (append-only,
`---`-separated sections with Task ID / Agent / Task / Work Log / Stage
Summary / Round Handoff). See [WORKLOGS.md](./WORKLOGS.md) for the discipline.
