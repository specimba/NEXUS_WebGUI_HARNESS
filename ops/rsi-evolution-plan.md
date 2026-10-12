# RSI Evolution Plan — Decided Implementation Roadmap

**Created**: r66 (2026-09-26) · **Sources**: 65-a (Pipeline Reliability Archaeologist) + 65-b (Model & Deep-Search Recipe Designer) research rounds · **Status**: DECIDED — future review rounds execute phases in order, one increment per round, each behind tsc+lint and the r26 A/B-gate doctrine (any harness/recipe change can be reverted; harness can add negative value).

---

## 0. Cron Automation Usefulness Assessment (user-directed audit)

**Verdict: KEEP — the platform cron is the RSI loop's heartbeat and has earned its slot.**

- **Evidence of usefulness**: since r56 the 2-job fleet (T0 patrol :07/:37, T1 review :23) has shipped r57→r64 unattended — quota governor visibility (r57), the 30s stall window that fixed the 12-run death loop (r58), stall telemetry (r59), one-click re-arm (r60), lane attribution (r61), vault stale-hint pruning (r62), chip triage (r63), sidebar fleet liveness (r64). The user's own sidebar now shows `cron 2/2 · next in 14m` — the loop is visible and alive.
- **Death-table discipline still holds**: agentTurn-only, hard round budgets, mutual resurrection via ops/cron.jobs.json. The cron-cli session outage is a known dispatch glitch; census rests on fire evidence.
- **Upgrade adopted this round**: patrol fires now EXECUTE the plan below (one phase per T1 round) instead of only picking ad-hoc candidates — the review loop becomes the RSI executor, not just a watchdog. This is the "cron evolves with the platform" mechanism: as phases complete, ops/cron.jobs.json worklog candidates are replaced by the next phase from this document.

## 1. What already exists (do NOT rebuild)

~70% of a classical RSI loop is already shipped: **bake-offs = evaluator** (suite A/B, r36-a), **auto-adopt = selection** (r39-a), **prompt-evolution = mutation** (r35-b, Laplace scoring, 4-variant budget), **lessons = memory** (per-workflow ring buffer), **dream = consolidation** (r33), **stall telemetry + lane attribution = self-diagnosis** (r59/r61/r63), **quota governor = resource safety** (r56), **vault prune = hygiene** (r62).

## 2. Decided phases (in execution order)

### Phase A — Reliability quick wins (S size, execute first)
- **A1. Retry-time lane pre-rotation** ← *this round*: when a step burns stalls on a fail-dominant lane (relay health: fail ≥4 && fail > ok), the step-level retry must START from a different lane instead of re-dialing the same pool (the exact "2/2 failed, same death" pattern from the user's 12-run forensics). Automata-paper-inspired heuristic: "burned N stalls on a fail-dominant lane → rotate before retry".
- **A2. Orphan-run detection + resume-from-step-k for scheduled runs** — a scheduled run killed by tab/cron death mid-step leaves orphans; detect on scheduler tick and offer resume-from-last-complete-step (branch-from-step-k machinery already exists, r35-a).
- **A3. Cross-workflow shared lesson pool** — lessons are per-workflow; add a shared pool injected into bake-off lanes so one pipeline's scar tissue protects all pipelines (S/M).

### Phase B — Model-role matrix + deep-search recipes (65-b)
- **B1. `roles[]` tags on ProviderModel + role→lane default map** in providers.ts (scout / tool-loop / synthesist / verifier / writer), + groq gpt-oss-120b/20b catalog lines. Matrix (free lanes only): Scout=vyce::deepseek-v4-flash(-lr) + groq::gpt-oss-20b overflow; Tool-loop=vyce::deepseek-v4.1-flash (user's collaborator pick) + groq::gpt-oss-120b; Synthesist=aihubmix::coding-kimi-k3-free (1M ctx); Verifier=cross-family only (groq::gpt-oss-120b / glm-5.3-free — never same family as synthesist); Writer=glm-5.3-free / vyce::agnes-3.0-flash; overflow=orcarouter + OpenRouter :free (never role-critical).
- **B2. Deep-research preset + Scout prompt contract**: harness=deep, contextBudgetChars 60k, stall-resume 3, Scout prompt with fan-out×3 → triage-top-8 citation-ledger ([S#]) → 2-hop batched reads (arXiv HTML>PDF, raw GitHub) → cited synthesis → cross-family verify. Per-tool-class result clips (page_reader 5k, arXiv 4k, GitHub raw 6k) in the engine shrink path.
- **B3. Quota-shaped recipes**: aihubmix {5rpm/100rpd} = synthesis/writer reserve, never fan-out; groq {30rpm/1000rpd} = high-frequency free slot; vyce = volume lane, v4.1 deep-harness-only (watchdog 30fail/17ok).

### Phase C — RSI loop closure (the actual self-improvement)
- **C1. Suite-scored prompt evolution (GEPA gap)**: prompt-evolution variants currently mutate reactively; wire suite aggregates in as the fitness function → variants must WIN a bake-off before adoption (auto-adopt already exists — this feeds it real fitness).
- **C2. Frozen-memory evaluation + curriculum-lite (RSIAgent gap)**: evaluate adopted variants against a frozen lesson snapshot (prevent test-time learning from inflating scores); curriculum-lite = the planner step orders exploration targets by the last bake-off's weakest metric.
- **C3. Per-step durable checkpoint (LangGraph/Temporal gap)**: persist engine msgs/tool-findings per step so tab/cron death mid-step resumes without losing the step (largest item — schedule after A/B prove value).

### Phase D — Doctrine
- Every phase lands with: worklog section (Task ID rN), tsc+lint clean, honest limits stated.
- Nothing auto-flips model/prompt behavior without a bake-off win (r26 doctrine).
- The watchdog ledger stays the source of truth for lane health; UI heuristics (r63) may mirror it but never override.

## 3. Immediate next actions
1. r66 (this round): this plan persisted + **A1 implemented**.
2. r67+: A2 → A3 → B1 → B2 → B3 → C1 → C2 → C3, one per review round, reassessing after each.
