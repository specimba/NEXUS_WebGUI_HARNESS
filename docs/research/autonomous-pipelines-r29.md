# Autonomous Pipeline Patterns — Industry Best Practices (r29)

Task ID: r29-2 · research-only · Sources: 22 web searches + direct fetches of vendor docs & source code (raw results in `/tmp/r29/`).
Scope: concrete mechanisms and defaults from LangGraph, CrewAI, AutoGen/Magentic-One, OpenAI Agents SDK, Temporal, Airflow/Prefect, n8n, Tavily/OpenSearch — mapped onto our workflows engine (sequential agent steps, tool-call budgets, scheduled recurring runs).

Key verified-from-source facts used throughout:

| Mechanism | Verified value | Source |
|---|---|---|
| LangGraph `RetryPolicy` defaults | `initial_interval=0.5s, backoff_factor=2.0, max_interval=128s, max_attempts=3 (incl. first), jitter=True, retry_on=default_retry_on` | langgraph `types.py` (fetched source) |
| LangGraph `TimeoutPolicy` | `run_timeout` (hard wall-clock cap per node attempt) + `idle_timeout` (max time w/o observable progress), `refresh_on="auto"` heartbeats | langgraph `types.py` (fetched source) |
| Temporal default Retry Policy | Initial Interval **1s**, Backoff Coefficient **2.0**, Maximum Interval **100× initial**, Maximum Attempts **∞**, Non-Retryable Errors `[]`; `non_retryable` flag on ApplicationError | docs.temporal.io/encyclopedia/retry-policies (fetched) |
| OpenAI Agents SDK turn limit | `DEFAULT_MAX_TURNS = 10`; "If we exceed the max_turns passed, we raise a MaxTurnsExceeded exception"; final output = text of desired type **with no tool calls** | `run_config.py:45` + docs (fetched) |
| AutoGen Magentic-One orchestrator | `max_turns=20`, `max_stalls=3` ("maximum number of stalls allowed before re-planning. Defaults to 3"), dedicated `ORCHESTRATOR_FINAL_ANSWER_PROMPT` for the final answer | `_magentic_one_group_chat.py` (fetched source) |
| n8n Retry On Fail | Max Tries capped at **5**, Wait Between Tries capped at **5000 ms**; per-workflow **error workflow** in Workflow Settings | n8n docs + community/GitHub note |
| Prefect task retry defaults | `retries: Optional[int] = None` (0 by default), `retry_delay_seconds`, optional `retry_jitter_factor` + `retry_backoff_callable` | prefect `tasks.py` (fetched source) |
| Tavily recency controls | `time_range` (day/week/month), `start_date`/`end_date` (YYYY-MM-DD), `topic=news`, `include_domains`/`exclude_domains`, `include_published_date` | docs.tavily.com API reference (fetched) |

---

## Problem 1 — Tool-budget exhaustion: forcing a final synthesis instead of returning the raw dump

**What we observed:** the research step spends all tool iterations gathering; the engine then returns the raw gathered dump because no forced synthesis pass exists.

1. **Final-output rule = "text, no tool calls" (turn-limited agent loop).** The OpenAI Agents SDK defines a run as finished only when "the LLM output is considered as a 'final output' is that it produces text output with the desired type, and there are no tool calls", and enforces it with `max_turns` (`DEFAULT_MAX_TURNS = 10`, else `MaxTurnsExceeded` is raised). Adoptable mechanically: a step is *not done* until it produced a text/JSON answer with zero tool calls in that turn.
   — https://openai.github.io/openai-agents-python/running_agents/ ; source `src/agents/run_config.py:45`
2. **Reserve a slice of the tool budget for synthesis ("forced last mile").** Practitioner write-up of research agents: "Gather and Analyze absorb almost all of the extra budget on longer turns. The forced last mile. Reserve the last slice of the budget (by step…)". Concretely: when `tool_calls_used >= budget - reserve`, the engine strips tool definitions from the next request and instructs the model to answer now. Reserve = `max(1, ceil(0.15 × budget))` — ≥1 full no-tool pass.
   — https://mukulchugh.com (search snippet, s19)
3. **Budget-awareness injected into context.** "Budget Tracker augments a ReAct agent with continuous awareness of its remaining tool-call budget" — inject `remaining_tool_calls: N` into the system/step context each turn so the model self-ration and de-escalates to writing. Academic backing: Budget-Aware Value Tree Search "studies test-time scaling for tool-augmented LLM agents under a hard budget constraint" (finds brute-force gathering quickly exhausts budget); sibling paper BATS: "Budget-Aware Test-time Scaling framework for tool-augmented agents under explicit budget".
   — https://github.com (Budget Tracker, s19) ; https://arxiv.org (BAVT, s23) ; https://openreview.net (BATS, s23)
4. **Planning-then-answering: split gather and write into separate steps.** LangChain's deep-research guide "decomposes research questions into focused tasks" and produces the report in a dedicated phase; our two-step "Research Scout → Tech Writer" is the right shape — the failure is that the *engine* falls back to raw material when the writer didn't run, rather than synthesizing. Mature engines treat "budget exhausted, no synthesis" as a **partial outcome**, never as content.
   — https://docs.langchain.com (Build a deep research agent, s19)
5. **Exhaustion ≠ content: treat budget exhaustion like LangGraph treats retry exhaustion.** "When a node exceeds its retry policy, LangGraph stops retrying and treats the failure as final. What happens next depends on your graph design" — i.e., the engine, not the model, decides the degraded path (routed to a fallback node / partial state), and "RetryPolicy has no built-in 'on exhaustion, go to X' hook. When a node still fails after all retries, it raises." Our engine should raise → emit a "materials-only, partial" artifact with a failure record.
   — https://dev.to (s1) ; https://forum.langchain.com (s1)

**Parameters to adopt:** budget reserve ≥15% (min 1 pass); reservation trigger at `used ≥ budget − reserve`; forced pass runs with tools removed + structured-output schema; if the forced pass errors → synthesize a fallback digest from structured gather-records (never the raw dump), flag run `partial`.

---

## Problem 2 — Dead URLs: fetch-failure hygiene (403/404 must never become digest content)

1. **Classify every fetch error as retryable vs terminal before acting.** "Classify errors as retryable or terminal, retry with growing [backoff]" (Scrapfly's error-handling guidance). Retryable: timeouts, 429, 5xx, network resets. Terminal (do not retry): 404, 410; 401/403 usually terminal *unless* fixable by headers (see #3).
   — https://scrapfly.io (s6)
2. **Retry policy: few attempts, exponential backoff + jitter.** "The best practices involve a combination of techniques: 1) Randomized Delays (jitter) 2) Exponential Backoff" (scraping best-practice write-ups). Concretely: initial + 1 retry (2 attempts total) with ~2s backoff + jitter; this mirrors Temporal's shape (1s initial, ×2 coefficient) compressed to interactive fetch scale.
   — https://dev.to (s6) ; https://www.capsolver.com (s6)
3. **403 hygiene = presentation fix, then give up.** "The fix is almost always one of four layers: set a real browser User-Agent, send the full browser header set, rotate through residential or…" (ScrapeOps on 403s; same for Zenrows' "seven easy techniques"). Adoptable: on 403, retry exactly once with a browser-like UA + Accept headers; if still blocked → terminal. Do **not** escalate into bypass arms races for a briefing tool.
   — https://scrapeops.io (s6) ; https://www.zenrows.com (s6)
4. **Alternative-source fallback for dead links.** For a briefing pipeline, the fallback for a dead URL is (a) another search restricted to the same claim/domain-neighborhood, or (b) an archival copy (Wayback Machine) before dropping the item. Never silently drop: emit a structured failure record.
5. **Structured failure reporting; failures are metadata, never content.** Every failed fetch produces a typed record `{url, status, error_class, attempts, final_action: skipped|fallback|archived}` that flows into the run report (e.g., "2 sources failed: …"), while the digest body only contains successful extractions. This is the same separation n8n makes between data flow and its error workflow, and matches the idempotent-retry doctrine of treating a duplicate/known-failure as a handled outcome: "When an idempotency-enabled API returns a duplicate-request error on retry, it usually means the first attempt already succeeded. Handle that error as success" (AWS) — i.e., retry logic must produce a definite, recorded disposition per attempt.
   — https://docs.n8n.io/flow-logic/error-handling/ (fetched) ; https://docs.aws.amazon.com (s10)

**Parameters to adopt:** max 2 attempts per URL (initial + 1 retry); retry backoff 2s + jitter (5s for 403/429 with UA fix); no retry on 404/410; per-run failure cap = 30% of fetched sources (exceed → run `needs-review`, don't ship); failure records always excluded from digest body and rendered as a footer/triage entry.

---

## Problem 3 — Search relevance drift: date-anchored queries, recency gates, allowlists

1. **Date-anchor every scheduled query + provider-side recency filters.** Tavily exposes `time_range` (`day|week|month`), `start_date`/`end_date` (YYYY-MM-DD), `topic: "news"`, and `include_published_date`; our search tool calls for scheduled briefings should always set a recency window and append the date anchor to the query itself (e.g., "AI news", time_range=week). The baseball story happened because an un-anchored entity query matched an acronym ("A's"/"AI") with no recency gate.
   — https://docs.tavily.com/documentation/api-reference/endpoint/search (fetched)
2. **Source allowlists/denylists per briefing type.** Tavily `include_domains` / `exclude_domains` (verified in the API payload: `"include_domains": [], "exclude_domains": []`). For "daily AI news", an allowlist of AI-press domains plus an exclusion list (sports/general outlets) removes most drift deterministically — cheaper than judging.
3. **Topic-gate before LLM-judge.** "Topic-Specific Classifiers are Better Relevance Judges than LLM-as-a-Judge… Our relevance classifier correlates reliably with human judgments even under limited judgment depth, while outperforming LLM-as-a-judge" (arXiv 2510.04633). Adoptable: first a cheap deterministic gate (required topic keyword/synonym set must appear in title+snippet), then an LLM judge for the remainder.
   — https://arxiv.org/html/2510.04633v1
4. **LLM-as-judge relevance scoring on the result page.** "LLM-as-a-judge approaches are a scalable alternative for evaluating the relevance of search engine result pages (SERPs)" (arXiv 2607.01040); OpenSearch 3.5 ships "LLM as a Judge" for scaling search relevance evaluation. Adoptable: score each candidate 1–5 against the briefing charter; keep only ≥4 (or drop <3 with per-item reason).
   — https://arxiv.org/html/2607.01040v1 ; https://arxiv.org/html/2504.14401v2 ; https://opensearch.org/blog/introducing-llm-as-a-judge-scaling-search-relevance-evaluation-with-ai
5. **Published-date verification / staleness cutoff.** Require an extractable publish date within the staleness window; items without a verifiable date get flagged or dropped for news briefings (Tavily `include_published_date`/`filter_by_published_date` exist exactly for this). Also verify the *query template* is entity-unambiguous: for scheduled briefings, freeze per-topic query templates with explicit disambiguator terms ("artificial intelligence" not "AI" alone).

**Parameters to adopt:** staleness cutoff 36h (daily briefing) / 7d (weekly); query template + `time_range=day` for daily with automatic fallback to `week` if <3 results pass; deterministic topic gate (required keywords present) → LLM judge 1–5, keep ≥4; per-domain cap 2 results; run ships only if ≥60% of candidates pass the gate and ≥2 items survive, else status `low-yield → needs-review`.

---

## Problem 4 — Autonomous resilience: retries, idempotency, watchdogs, partial success

1. **Step-level retry with exponential backoff + jitter (bounded).** LangGraph's per-node `RetryPolicy` defaults are `initial_interval=0.5s, backoff_factor=2.0, max_interval=128s, max_attempts=3 (including the first), jitter=True`, with `retry_on=default_retry_on` (transient API errors only). Temporal's default Retry Policy: Initial Interval **1s**, Backoff Coefficient **2.0**, Maximum Interval **100× initial**; Maximum Attempts defaults to ∞ but production policies set a finite number (community example: 5s initial / 1h max / 2.0 / 4-day close timeout / "Max retries: Infinite" for infra-level waits — deliberately differentiated per error class). n8n caps Retry On Fail at **5 tries / 5000 ms between tries**. Airflow gives per-task `retries`, `retry_delay`, `max_retry_delay`, `retry_exponential_backoff` (a bool today; "In Airflow 3.2+ you can set retry_exponential_backoff to a float to directly specify the factor").
   — langgraph source; docs.temporal.io (fetched); community.temporal.io (s2); n8n GitHub note (s9); airflow.apache.org (fetched); astronomer.io (s8)
2. **Non-retryable classification.** Temporal: raise `ApplicationError(..., non_retryable=True)` so auth/validation/credit errors bypass the retry loop entirely; LangGraph's `retry_on` predicate does the same per-node. Our engine needs the same error taxonomy (auth/credit/schema → no retry; timeout/429/5xx → retry).
   — https://docs.temporal.io/encyclopedia/retry-policies (fetched)
3. **Watchdog: heartbeats + idle timeouts for stuck runs.** "Without a HeartbeatTimeout, Temporal cannot detect a stuck or crashed Worker until the StartToCloseTimeout expires" — heartbeats let the platform reschedule quickly on worker/infra failure. LangGraph now ships exactly this at node granularity: `TimeoutPolicy(run_timeout=…, idle_timeout=…, refresh_on="auto")` where `run_timeout` is "a hard wall-clock cap for a single node attempt" and `idle_timeout` is "maximum time a single node attempt may go without observable progress" refreshed by stream events/heartbeats. Adoptable: per-step wall-clock cap + per-step idle detector fed by tool-call/stream events.
   — https://docs.temporal.io (heartbeat docs, s21) ; keithtenzer.com (s21) ; langgraph `types.py` (fetched)
4. **Idempotent re-runs.** Temporal: "Activities should be designed to be safely executed multiple times without causing unexpected or undesired side effects." AWS: on retry, a duplicate-request error means the first attempt succeeded — "Handle that error as success." GitLab's scheduler dedups: "A job scheduled for an idempotent worker is deduplicated when an unstarted job with the same arguments is already in the queue." trigger.dev scopes idempotency keys per attempt. Adoptable: run key = `(workflowId, scheduledSlot)` (slot = schedule time truncated to the interval); claim atomically at start; a completed-success record for the same key → skip; duplicate live claim → no-op.
   — https://temporal.io (s15) ; docs.temporal.io (s15) ; docs.aws.amazon.com (s10) ; docs.gitlab.com (s10) ; trigger.dev (s10)
5. **Partial-success semantics + "needs you" triage queue.** LangGraph's HITL model is exactly this shape: "Interrupts allow you to pause graph execution at specific points and wait for external input before continuing", persisted by checkpointing so the run can resume (and be rewound via time travel) after human input. n8n adds the org-level pattern: a per-workflow **error workflow** "runs if an execution fails" — i.e., failures route into a handling pipeline, not silence. Adoptable: run statuses `ok | partial | needs-you`; `needs-you` items land in a triage queue with reason codes (low-yield, failure-cap-exceeded, step-failed), auto-retry at the next scheduled slot, human alert after N consecutive.
   — https://docs.langchain.com/oss/python/langgraph/interrupts (fetched/search) ; https://docs.n8n.io/flow-logic/error-handling/ (fetched)
6. **Run-level circuit breaker.** "When the failure count exceeds your configured threshold, like five consecutive failures or 30% of calls failing, the circuit breaker trips open"; the breaker then transitions Open → Half-Open to probe recovery (Microsoft Learn's state machine). Adoptable per workflow: consecutive failed runs trip the breaker; the next scheduled run acts as the half-open probe; persistent failure pauses the workflow and notifies the owner.
   — https://www.groundcover.com (s16) ; https://learn.microsoft.com (s16) ; https://oneuptime.com (s16)

**Parameters to adopt:** step retry = 3 attempts total (initial + 2 retries), 2s initial, ×2 backoff, cap 60s, full jitter; non-retryable classes skip the loop. Watchdog: step wall-clock cap 10 min; idle kill at 5 min without a tool event; run-level cap 30 min; a sweeper every 10 min force-fails runs exceeding 2× expected duration. Idempotency: `(workflowId, slot)` dedup key. Breaker: 3 consecutive failed runs → skip next slot; probe after cooldown (next scheduled run); 5 consecutive → pause + alert.

---

## Problem 5 — Pipeline structuring: planner→executor→critic→writer, gates, fan-out, contracts, compression

1. **Orchestrator with task/progress ledgers and stall-triggered replanning (Magentic-One).** "The Orchestrator begins by creating a plan… gathering needed facts and educated guesses in a Task Ledger… At each step of its plan, the Orchestrator creates a Progress Ledger where it self-reflects on task progress and checks whether the task is completed"; "If the Orchestrator finds that progress is not being made for enough steps, it can update the Task Ledger and create a new plan." Concrete knobs (source): `max_turns=20`, `max_stalls=3` ("maximum number of stalls allowed before re-planning"), and a dedicated `ORCHESTRATOR_FINAL_ANSWER_PROMPT` so the final answer is produced by a distinct, tool-free prompt. Community analyses summarize: "Orchestrator maintains a task ledger of facts and plan, uses a progress ledger to self-reflect each step, detects stalls by counter, and replans when stuck."
   — microsoft.github.io (Magentic-One, s12/fetched) ; `_magentic_one_group_chat.py` source ; https://www.microsoft.com (s12) ; agentic-design.ai (s12)
2. **Hierarchical delegation with a manager (CrewAI).** "Hierarchical: Organizes tasks in a managerial hierarchy, where tasks are delegated and executed based on a structured chain of command. A manager language model (manager_llm) or a custom manager agent (manager_agent) must be specified… facilitating the creation and management of tasks by the manager." The manager "can provide feedback for retries, re-…" — i.e., retry/escalation logic lives in the manager's directive, not the engine. For our small platform, adoptable as: the writer step may return structured "retry/escalate" feedback consumed by the engine.
   — https://docs.crewai.com/concepts/processes (fetched)
3. **Critic/verifier loop with a strict iteration cap (Self-Refine / Reflexion).** "Self-Refine (Madaan et al., 2023) uses one LLM in three roles — generate, feedback, refine — in a loop. Average gain: +20 absolute on 7 tasks"; Reflexion "combines self-criticism, external knowledge integration, and…" and the Reflection architecture "separates response generation into three distinct phases." For briefing scale: 1 critic pass max (cost-bounded), producing a structured verdict + patch.
   — aiengineeringfromscratch.com (s13) ; ai.plainenglish.io (s13) ; pub.towardsai.net (s13) ; learnprompting.org (s13)
4. **Structured JSON contracts between steps.** "Structured outputs… turn LLM responses into reliable contracts for production" with "schema validation, retries" (TrueFoundry); Agenta's guide covers "API-native methods, schema validation" and repair-on-failure loops. Adoptable: every inter-step payload is a schema-validated JSON artifact (step output = `{summary, items[], citations[], failures[]}`); on validation failure → 1 repair retry that feeds the validator error back to the model. This is also the guardrail philosophy of the OpenAI Agents SDK: "Input guardrails run on the initial user input, Output guardrails run on the final agent output," with a `tripwire` that "can immediately raise an error, saving time and money," and blocking vs parallel execution modes (blocking guarantees the expensive model doesn't start).
   — truefoundry.com (s14) ; agenta.ai (s14) ; https://openai.github.io/openai-agents-python/guardrails/ (fetched)
5. **Map-reduce fan-out for wide gathering.** LangGraph's map-reduce pattern uses the `Send` API to fan a state out to N parallel worker branches whose outputs merge through reducers — the standard shape for "fetch/summarize 10 sources in parallel, then reduce into one brief." Keep the fan-out width bounded (token/cost ceiling) and merge with a reducer that dedups by URL and drops failed branches.
   — https://docs.langchain.com/oss/python/langgraph/use-map-reduce
6. **Context compression between stages.** Magentic-One's ledgers are themselves compression: facts + plan + per-step progress, not raw transcripts; and the Agents SDK handoff guidance warns "Each handoff replays…" (context cost grows with every handoff). Adoptable: between stages pass compressed artifacts (per-item summary ≤ ~200 tokens, digest charter, failure list), keep full fetches in a side artifact the digest cites, not copies.

**Parameters to adopt:** briefings = `planner (charter+queries) → executor (gather, budgeted) → gate (topic+recency+judge) → writer (tool-free, structured JSON) → critic (1 pass, verdict+patch)`; stall counter 3 (Magentic) reused as "no new usable item for 3 turns → replan or end gather phase"; inter-step contracts schema-validated with 1 repair retry; fan-out ≤5 parallel fetch branches.

---

## Recommended policy pack (exact numbers to implement)

### Tool budget & forced synthesis
| Policy | Value |
|---|---|
| Synthesis reserve | `max(1, ceil(0.15 × budget))` final passes (e.g., budget 12 → reserve 2) |
| Reservation trigger | engine strips tools when `tool_calls_used ≥ budget − reserve` |
| Forced-pass rejection | model requests a tool during forced pass → tool call rejected with system note "budget exhausted; produce final answer now" (max 1 such rejection, then synthesize from structured records) |
| Exhaustion fallback | no synthesis achieved → engine emits "materials digest" from structured gather-records, run status `partial` (never the raw dump) |
| Gather stall counter | 3 consecutive turns with no new usable item → end gather phase early (Magentic `max_stalls=3`) |

### URL fetch hygiene
| Policy | Value |
|---|---|
| Max attempts per URL | 2 (initial + 1 retry); no retry on 404/410 |
| Retry backoff | 2s + jitter (403/429: 5s, with browser-like UA on the retry) |
| Terminal classes | 404, 410, 401; 403 after UA-fix retry |
| Failure record | `{url, status, error_class, attempts, final_action}` — metadata only |
| Failure promotion rule | failures NEVER enter digest body; footer line "N sources failed" |
| Per-run failure cap | >30% of fetched sources failed → run `needs-review`, do not ship |

### Search relevance (scheduled briefings)
| Policy | Value |
|---|---|
| Query template | per-topic frozen template with explicit disambiguators + date anchor; never raw entity term alone |
| Recency filter | `time_range=day` for daily (auto-fallback to `week` if <3 gated results); staleness cutoff: publish date ≤36h (daily) / ≤7d (weekly) |
| Deterministic gate | required topic-keyword set must hit title+snippet (classifier-style gate, arXiv 2510.04633) |
| LLM judge gate | score 1–5 vs briefing charter; keep ≥4; drop <3 with per-item reason |
| Source allowlist | `include_domains` per briefing type + `exclude_domains` denylist |
| Per-domain cap | 2 results |
| Ship gate | ≥60% of candidates pass gates AND ≥2 items survive → ship; else `low-yield → needs-review` |

### Retry / watchdog / idempotency / breaker
| Policy | Value |
|---|---|
| Step retry | 3 attempts total, initial 2s, ×2 backoff, cap 60s, full jitter (LangGraph shape: 0.5s/×2/3 attempts/jitter — we scale initial to LLM latency) |
| Non-retryable | auth, credits/billing, schema-invalid after repair retry (Temporal `non_retryable` doctrine) |
| Schema repair | 1 repair retry feeding validator error text |
| Step wall-clock cap | 10 min hard (`run_timeout`) |
| Idle kill | 5 min with no tool event / stream progress (`idle_timeout`, heartbeats every 30s) |
| Run cap | 30 min; sweeper every 10 min force-fails runs >2× expected duration |
| Idempotency key | `(workflowId, scheduledSlot)`; atomic claim at start; success record on key → skip; duplicate claim → no-op (treat as success) |
| Partial success | `ok` = all steps ok; `partial` = ≥1 step failed but digest passed gates; `needs-you` = below gate thresholds → triage queue with reason codes; auto-retry next slot; alert owner after 2 consecutive `needs-you` |
| Circuit breaker | 3 consecutive failed runs → skip next scheduled slot (Open); next scheduled run = half-open probe; 5 consecutive → pause workflow + notify |

### Step graph & contracts
| Policy | Value |
|---|---|
| Briefing graph | planner → executor → gate → writer (tool-free) → critic (≤1 pass, verdict+patch) |
| Inter-step contract | schema-validated JSON `{summary, items[], citations[], failures[]}` |
| Fan-out | ≤5 parallel fetch branches, reducer dedups by URL, drops failed branches |
| Context compression | per-item summary ≤~200 tokens between stages; full text stays in side artifacts |

---

## References

**Fetched directly (docs / source):**
1. Temporal — Retry Policies (defaults, non-retryable errors): https://docs.temporal.io/encyclopedia/retry-policies
2. Temporal — Activity heartbeats / HeartbeatTimeout: https://docs.temporal.io/activities
3. LangGraph — `RetryPolicy` / `TimeoutPolicy` source (defaults verified): https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/pregel/_retry.py and https://raw.githubusercontent.com/langchain-ai/langgraph/main/libs/langgraph/types.py
4. LangGraph — Interrupts (HITL pause/resume): https://docs.langchain.com/oss/python/langgraph/interrupts ; Time travel: https://docs.langchain.com/oss/python/langgraph/use-time-travel
5. LangGraph — Map-reduce (`Send` API): https://docs.langchain.com/oss/python/langgraph/use-map-reduce
6. OpenAI Agents SDK — Running agents (max_turns, final-output rule): https://openai.github.io/openai-agents-python/running_agents/ ; source `DEFAULT_MAX_TURNS=10`: https://github.com/openai/openai-agents-python/blob/main/src/agents/run_config.py
7. OpenAI Agents SDK — Guardrails (input/output, tripwires, blocking vs parallel): https://openai.github.io/openai-agents-python/guardrails/
8. AutoGen — Magentic-One (task/progress ledger, stall → replan): https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/magentic-one.html ; source `max_stalls=3, max_turns=20`: https://github.com/microsoft/autogen/blob/main/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_group_chat.py
9. CrewAI — Processes (hierarchical, manager_llm/manager_agent): https://docs.crewai.com/concepts/processes
10. n8n — Error handling / error workflows: https://docs.n8n.io/flow-logic/error-handling/ ; Retry On Fail caps (5 tries / 5000 ms): https://community.n8n.io + https://github.com (n8n issues)
11. Airflow — Tasks & retry params (`retries`, `retry_delay`, `retry_exponential_backoff`, `max_retry_delay`): https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/tasks.html ; Astronomer on Airflow 3.2+ float backoff factor: https://www.astronomer.io
12. Prefect — task retry defaults (`retries=None`, `retry_delay_seconds`, `retry_jitter_factor`): https://github.com/PrefectHQ/prefect/blob/main/src/prefect/tasks.py ; https://docs.prefect.io/v3/concepts/tasks
13. Tavily — Search API (time_range, start_date/end_date, topic, include/exclude_domains, include_published_date): https://docs.tavily.com/documentation/api-reference/endpoint/search

**Search-surfaced (snippets, domain-level URLs):**
14. Scrapfly — error classification (retryable vs terminal): https://scrapfly.io
15. ScrapeOps — 403 causes & fixes (UA/header layers): https://scrapeops.io ; Zenrows — fixing 403 in scraping: https://www.zenrows.com
16. dev.to / capsolver — retry with exponential backoff + jitter best practices: https://dev.to ; https://www.capsolver.com
17. AWS — idempotency duplicate-as-success: https://docs.aws.amazon.com ; GitLab — idempotent worker dedup: https://docs.gitlab.com ; trigger.dev — idempotency key attempt scopes: https://trigger.dev ; Temporal — "Activities should be idempotent": https://temporal.io / https://docs.temporal.io
18. groundcover — circuit breaker thresholds (5 consecutive / 30% failure rate): https://www.groundcover.com ; Microsoft Learn — closed/open/half-open state machine: https://learn.microsoft.com ; OneUptime — circuit breaker from scratch: https://oneuptime.com
19. "Reserve the last slice of the budget — the forced last mile" (research-agent budget practice): https://mukulchugh.com ; Budget Tracker (ReAct + remaining-budget awareness): https://github.com ; Budget-Aware Value Tree Search (arXiv): https://arxiv.org ; BATS — Budget-Aware Test-time Scaling: https://openreview.net
20. LangChain — Build a deep research agent (decomposition into focused tasks): https://docs.langchain.com ; LangGraph forum — RetryPolicy exhaustion behavior: https://forum.langchain.com ; dev.to — node retry exhaustion = final failure: https://dev.to
21. arXiv 2510.04633 — Topic-Specific Classifiers are Better Relevance Judges than LLM-as-a-Judge: https://arxiv.org/html/2510.04633v1 ; arXiv 2607.01040 — LLM-as-a-judge for SERP relevance: https://arxiv.org/html/2607.01040v1 ; arXiv 2504.14401 — LLM-driven usefulness judgment: https://arxiv.org/html/2504.14401v2 ; OpenSearch 3.5 "LLM as a Judge": https://opensearch.org/blog/introducing-llm-as-a-judge-scaling-search-relevance-evaluation-with-ai
22. Self-Refine / Reflexion critiques: https://aiengineeringfromscratch.com ; https://ai.plainenglish.io ; https://pub.towardsai.net ; https://learnprompting.org ; TrueFoundry — structured outputs as production contracts: https://www.truefoundry.com ; Agenta — structured data from LLMs: https://agenta.ai

*Raw search/reader artifacts: `/tmp/r29/s1–s23.json`, `/tmp/r29/*.html`, `/tmp/r29/*.py` (fetched sources).*
