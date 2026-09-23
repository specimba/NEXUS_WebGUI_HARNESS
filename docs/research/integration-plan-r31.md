# Integration Plan — r31 (reference-repo re-sweep + 2026-09 deep search)

**Round:** r31 · **Date:** 2026-09-21 · **Rollback:** `rollback/r31-base` @ 121f9e7 (r30), pushed to both remotes
**Inputs:** r31-1 gap sweep (local, evidence-cited) · r31-2 external sweep (22 searches, 9 primary sources fetched → `docs/research/harness-sweep-r31.md`) · phase-5 `docs/harness-adaptation-roadmap.md`

> Owner directive: "think again that reference repo's we made research and development with integration possibilities … named reference praison AI autonomousity advantages with combination of successful harnesses like DSH … aware up to date 2026 september knowledge and developments ready to integration available ideas actually needed."

---

## 1 · Reference-repo re-sweep — verdict

### 1.1 DSH identity (resolved, was open since project start)

**DSH = DeepSeek Harness** — two layers:

1. **The owner's own local harness** (`~/.dsh/settings.yaml` on their Windows box), recovered from a deleted upload via git pickaxe (`022c3d9:upload/Pasted Content_1789688339747.txt`). Its sibling **ModelRelay/"Genius rotator" doctrine was already ported** (r21 → `src/lib/relay.ts`). Un-ported DSH advantages: **automatic turn compaction** (bounded context → summarization; praisonAI only caps history by message count), **health-ledger pre-warm**, **registry codegen** (single-source roster generation).
2. **`github.com/deepseek-ai/deepseek-harness`** — 234k★, MIT, Cordis-based, "Everything is a Plugin"; `npx @deepseek-ai/dsh web` boots a browser Web UI (:3080) that is architecturally our twin (BYOK settings → models incl. custom OpenAI-compatible endpoints, workspace-gated composer, plan-maintaining sessions, **permission-policy approvals as a first-class subsystem**). Dev preview, breaking changes — **borrow concepts, never the Cordis framework** (YAML patch overlays, service graph = Node-server patterns).

### 1.2 Harness roadmap gap matrix (phase-5 ranks vs shipped tree @ r30)

| Rank | Item | Status @ r30 | This round |
|---|---|---|---|
| 1 | Replayable task suite + versioned traces | **MISSING** (building blocks exist: `executeWorkflowRun`, runs cap 12, `runToMarkdown`, RunComparison) | ✅ **SHIP** |
| 2 | Logging triad (loop/LLM/tool I/O) | **PARTIAL** — r19 shipped run-level `callLog` + per-step `ToolCallInfo`; per-iteration trace missing | ✅ **SHIP** (`llmCalls[]` per step) |
| 3 | Reflexion lessons from failed runs | **MISSING** (all hooks present: `RunErrorInfo`, verdict, resumeCount) | ✅ **SHIP** |
| 4 | GEPA prompt evolution | MISSING — blocked on 1+2 | defer (r32+) |
| 5 | MemGPT managed memory | MISSING (`memory.ts` is auto-rewrite only) | defer (r32+, "dreaming-lite" variant) |
| 6 | Addressable sub-agents (`agent_call`) | MISSING (closed-world 13 tools) | defer (gated, suite-first) |
| 7 | RLM slice-and-ask | MISSING (attachments inlined, 4×128KB cap) | defer |
| 8 | Skill library + DGM archive | MISSING — correctly stage-2 (needs 1–4) | defer |

**Sequencing truth:** only rank-2's first slice ever shipped (r19). Ranks 1–3 were re-listed as next-candidates in worklogs r17→r21 but never landed. Ranks 1→2→3 are each ≤1 session and unblock 4–8 — this is the panel's own ordering, now executed.

### 1.3 NEW findings the roadmap didn't cover (r31-1)

1. **Run-level watchdog** — r29 policy pack (heartbeat/idle-kill/run-cap) still unimplemented at run level. (defer; step-level self-heal exists)
2. **Shared retry-policy object** — retry numbers scattered inline. (defer; SELF_HEAL_KINDS works)
3. **Scheduled-run idempotency + catch-up** — no `(workflowId, slot)` key. (defer)
4. **`praison-conversations` is unbounded + quota errors silently swallowed** (`stores.ts` debouncedStorage catch{}) — silent data-loss landmine under the 5MB ceiling. → **FIX THIS ROUND**
5. **System-One only wired to verify-gate** — review verdicts + digest un-judged. (defer)

### 1.4 External sweep (2026-09) — top integration-ready ideas

Ranked (evidence in `harness-sweep-r31.md`): ① SKILL.md user skills (M) ② stateless MCP client — **2026-07-28 spec removed sessions/handshakes** (L) ③ MCP Apps `ui://` sandboxed rendering (M) ④ Letta "dreaming-lite" scheduled memory consolidation (M) ⑤ memory blocks + thread compaction (S/M) ⑥ run replay/timeline + re-run-from-step-k (M) ⑦ **`openrouter/free` router lane** (S — **verified live this round**: $0/$0, 200k ctx, text+image) ⑧ durable approvals once/session/always (S/M) ⑨ Mermaid in chat (S) ⑩ reasoning-effort per chat/step (S) ⑪ Wide-Research fan-out ≤5 (M) ⑫ AGENTS.md/llms.txt context-pack ingester (S) ⑬ **boot resilience: quarantine malformed schedules, never block boot** (S) ⑭ shareable read-only run links (M) ⑮ System-One gate records as first-class suite data (S/M).

**Explicit DON'Ts (binding):** no stateful MCP transport (dead revision); no A2A in a single-user BYOK client; don't mirror DSH/Cordis architecture; never run skill `scripts/` outside the node:vm sandbox; tools ship OFF by default and must win on the suite.

---

## 2 · This round's implementation cut (r31)

**Theme: "make the harness measurable" — ship the suite, learn from failures, stop the silent landmines.**

| # | Deliverable | Source | Files |
|---|---|---|---|
| 1 | **Replayable task suite**: `praison-suites` store, `Suite/SuiteCase/SuiteResult` types, `WorkflowRun.schemaVersion=2 + suiteCaseId/suiteRunId`, `suite-runner.ts` (sequential cases × repeats 1–3, abortable, done-rate + degraded + rework + tool-call metrics, diff-vs-previous verdicts, markdown export), seeded **Harness Baseline Suite** + **Loop Health Check** workflow (the roadmap's mandatory "correct action is to stop" cheap case), Suites board UI (third layout in Workflow Studio), "suite" chips on kanban/run panel | roadmap rank 1 + r31-2 #6/#15 | types, stores, constants, suite-runner, workflows-view, suites-board (new), run-kanban, run-panel |
| 2 | **Per-iteration LLM trace** (`WorkflowRunStep.llmCalls[]`: iter, ms-at-boundary, contentChars-so-far, promptChars@1) from the engine's existing `iteration` events; "N calls" chip on step cards | roadmap rank 2 | types, workflow-runner, run-panel |
| 3 | **Reflexion lessons**: `Workflow.lessons[]` (cap 5 × ≤300 chars, kind-tagged), written on run error + review rework, injected into the first executed step's context on fresh runs AND resumes, visible + deletable in the workflow editor (UX verdict: model-written docs must be inspectable) | roadmap rank 3 + r31-1 #3 | types, helpers (`buildLessonsBlock`), workflow-runner, editor dialog |
| 4 | **Conversations storage guard**: hard message cap with oldest-trim, strip attachment payloads from messages beyond the latest 12 (text stub kept), quota-failure surfaced via `praison:storage-quota` window event → shell toast (once/session) instead of silent swallow | r31-1 #4 (landmine) + DSH turn-compaction doctrine (lite) | stores, constants, shell |
| 5 | **Boot resilience — schedule quarantine**: malformed schedules (interval < 60s, non-finite nextRunAt) disabled + flagged at hydration, never thrown | r31-2 #13 (OpenClaw 9.1 doctrine) | stores |
| 6 | **`openrouter/free` relay lane** (Free Models Router, T2, $0/$0, 200k ctx — live-verified) + tracker metadata | r31-2 #7 | relay, tracker-types |

**Deferred to r32+ (in priority order):** GEPA variant store (needs suite), dreaming-lite scheduled memory consolidation (Letta), stateless MCP client (2026-07-28 spec), SKILL.md skill files + library, run replay timeline + re-run-from-step-k, run-level watchdog (r29 policy), reasoning-effort selector, Mermaid renderer, AGENTS.md ingester, shareable run links, Wide-Research fan-out step.

## 3 · Suite design notes

- **Runs are real**: suite runs flow through `executeWorkflowRun` with `source:"suite"` (toasts suppressed — the board reports aggregate), tagged `suiteCaseId`/`suiteRunId`, `schemaVersion: 2`. They appear in the normal runs list (transparency) and are subject to the 12-run cap.
- **Sequential, abortable**: one pipeline at a time (respects `activeRuns` guard, rate-polite); Stop aborts the current run; results recorded incrementally so a stopped suite keeps partial results.
- **Metrics per case×repeat**: status, stepsDone/stepsTotal, ms, degraded count, rework count, toolCallsOk. Case `doneRate` = mean(done) across repeats. Verdict vs previous result: improved / flat / regressed / new (done-rate Δ > 0 / = 0 / < 0).
- **Storage discipline**: suite results store aggregates only (never outputs) — history capped at 5 per suite.
- **Loop Health Check** (`wf-loop-health`, depth quick, single `a-assistant` step, "Reply with exactly OK. Do not use any tools.") implements the roadmap's "include one case whose correct behavior is to stop early" — expected: done, 0 tool calls, ~1s.
- **Baseline suite** (`suite-baseline`): loop-health probe → Build & Verify (sandbox-only, cheap) → Research Brief (web) → Morning Briefing (web, the r29 production pipeline). Deep Dossier deliberately excluded (cost).

## 4 · Acceptance criteria

1. Suites board renders the seeded baseline suite; "Run suite" executes sequentially with live progress; Stop works; results card shows per-case rows + diff chips.
2. A failed run writes a lesson (visible in editor); the next run/resume of that workflow injects the lessons block (verifiable in context via diagnostics).
3. Step cards show llmCalls chip when iteration data exists.
4. Conversations with 130+ messages trim to the hard cap; old image payloads are stripped; a forced quota failure toasts instead of vanishing.
5. A corrupted schedule never blocks boot — it's disabled + flagged.
6. `openrouter/free` appears in the relay roster + picker (OpenRouter group).
7. lint + tsc clean; dev.log clean; regression: manual run, resume, scheduled quick-retry unaffected.
