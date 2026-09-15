# Harness Adaptation Roadmap — PraisonAI Web

**Task ID:** phase-5 (research-only) · **Date:** 2026-09-15
**Source:** `upload/fancyHARNESSresearchGUIDEScurationPACK1.txt` (DAIR.AI "Harness Engineering" collection, YC Paper Club: Harness Edition, Aug 26 2026 + companion X threads), read in full (3,271 lines / ~127 KB).
**Grounding:** `src/lib/types.ts`, `src/lib/workflow-runner.ts`, `src/lib/memory.ts`, `src/lib/stores.ts`, `src/lib/constants.ts`, `worklog.md` r14–r16.

> The pack's thesis in one line: *"A harness is everything between the model weights and the world: the loop, the context it assembles, the tools and skills it can reach for, the sub-agents it can spawn, and lately the code of the harness itself"* — and *"the same weight file can score 30% or 95% on the same benchmark depending only on what surrounds it"* (Prime Agent on ARC-AGI-3). Every recommendation below is about improving what surrounds our model calls, with the weights (i.e., providers/models) held fixed.

---

## Part 1 — Knowledge artifact (curated by era)

### Era 0 · The V0 harness — a loop, examples, and tokens

**GPT-2 — "Language Models are Unsupervised Multitask Learners" (Radford et al., 2019).**
The baseline every later entry is measured against: *"no tool calling here, no skills, no memory: a while-not-EOS loop, top-p sampling, and an environment that scores whatever comes after the delimiter."* The talk opens here because so little is present, which makes six years of progress legible as one move repeated — *giving the loop something new it is allowed to do.*
→ **Transferable mechanism:** keep a "V0 control arm" — the bare loop with every harness extra switched off — as the baseline in every A/B test of a new feature. Our equivalent is an agent with `tools: []`, no memory, default instructions.

**GPT-3 — "Language Models are Few-Shot Learners" (Brown et al., 2020).**
The first thing anyone put in a harness. *"Nothing about the loop changes: you simply paste solved examples above the question and accuracy moves. That makes the context window the first place a system designer can spend effort, and every technique further down this list is a descendant of that realisation."*
→ **Transferable mechanism:** worked examples inside agent instructions are the cheapest lever we own — pure context editing, zero new code, directly testable via the task suite.

**Chain-of-Thought (Wei et al., 2022).**
*"Smear the computation over more tokens instead of demanding the answer in one. This is the first output-space intervention in the lineage, and the reason every harness since budgets tokens rather than calls."*
→ **Transferable mechanism:** we already persist `ChatMessage.reasoning`; budget-thinking is a per-agent knob (max iterations exists; a "think harder on step N" per-step token budget is the natural extension).

### Era 1 · Static harnesses — growing the action space (harness gets more functional, code stays fixed)

**WebGPT (Nakano et al., 2021).** *"The first time the loop reached outside itself"* — a browser plus human feedback on how it used one, *"turns retrieval from a preprocessing step into an action the model chooses to take."*
→ **Transferable:** treat retrieval (`web_search`, `read_url`) as loggable, gradeable *actions*, not plumbing — which actions were chosen and whether they paid off is harness signal.

**Toolformer (Schick et al., 2023).** Where tool calling comes from: *"Instead of computing five minus three in the weights, the model emits a call and the harness runs it. Declare the tools in the system prompt and the action space is suddenly whatever you are willing to execute."*
→ **Transferable:** the tool manifest is the action space — declaring *fewer* tools is a design decision with measurable effects (see the MCP caution in "What NOT to do").

**ReAct (Yao et al., 2022).** *"Interleave a thought and an action instead of choosing between them. ReAct is the shape almost every agent loop still has, and the talk's point is that models now do this natively, so a modern harness should stop imposing it."*
→ **Transferable:** our `/api/chat` loop already delegates to native tool calling; resist adding prompt-level "Thought:/Action:" scaffolding on top of models that do it natively.

**Self-Refine (Madaan et al., 2023).** *"The cheapest feedback loop there is: the same model grades its own draft and rewrites it, with no extra training and no environment. This is the internal evaluator… the branch that never leaves the harness."*
→ **Transferable:** our workflow `kind: "review"` steps + `REWORK_LIMIT = 1` rework pass are literally this. It's already in `workflow-runner.ts`; tune the review prompt, don't build new machinery.

**Reflexion (Shinn et al., 2023).** *"Take the real reward signal from the environment and write it back into the context as words. Reflexion is where a failed episode stops being wasted, which is the seed of everything in the self-improving half of this list."*
→ **Transferable:** failed workflow runs are already classified (`RunErrorInfo` with kind, failed step, toolCallsOk) — the missing half is writing a verbal *lesson* back into the agent's context on retry. High-leverage, low-effort for us.

**InterCode (Yang et al., 2023).** *"Once the action is code, the tool list stops being finite"* — interactive coding with execution feedback as a standard environment; *"the direct ancestor of the persistent REPL that Prime Agent builds its whole design on."*
→ **Transferable:** `run_code` (node:vm, 4s timeout) is our REPL seed; making its state *persist across calls within a run* is the InterCode move.

**Multi-Agent Collaboration (Talebirad & Nadiri, 2023).** *"Spawning another agent becomes just another tool call. The framing here, agents with roles that persist and can be addressed, is what makes sub-agents an addressable resource rather than a one-shot fan-out."*
→ **Transferable:** our agents registry (`useAgentsStore`) is already a roster of persistent, named roles — exposing "call agent X" as a tool is a small step with the Prime Agent payoff (see rank 5).

**Voyager (Wang et al., 2023).** *"Where skills come from. Voyager chains tools into a routine, verifies it worked in Minecraft, and writes it back to a library the agent searches later. Read the skill library section and you are reading the design of the SKILLS.md sitting in your repo today."*
→ **Transferable:** a skill = verified routine text stored in a store, *promoted only after verification*; retrieval on demand, never bulk-injected (context bloat risk).

**MemGPT (Packer et al., 2023).** *"Before this, context could only be appended to. MemGPT gives the model create, read, update, and delete over a carved-out region of its own context, which is the move that turns a transcript into managed state."*
→ **Transferable:** `ConversationMemory` (Hermes-style folding, `MEMORY_MAX_CHARS = 1200`) is already a carved-out region — but today only the *system* writes it (auto-consolidation). The MemGPT move is giving the model read/update operations over it.

**Recursive Language Models (Zhang, Kraska, Khattab, 2025).** *"An LLM call inside a REPL can issue further LLM calls over slices of a document too big to read, so context stops being a wall and becomes a resource you program against. Prime Agent is built directly on this abstraction."*
→ **Transferable (adapted):** full REPL-embedded recursion is a server-side pattern; the browser-shaped version is a "slice-and-ask" tool that decomposes an oversized attachment into slices, asks a small model per slice, and synthesizes — without ever inlining the whole doc.

### Era 2 · Let the harness learn

**DSPy (Khattab et al., 2023).** *"The first entry where the harness stops being hand-written. You cannot backpropagate through a prompt, so DSPy searches over prompts against a small train set instead, and the system prompt becomes an optimised artifact rather than an author's guess."*
→ **Transferable:** treat `Agent.instructions` as a *versioned artifact with a score*, not a fixed string — which presupposes the task suite + traces (roadmap ranks 1–2).

**GEPA (Agrawal et al., 2025).** *"GEPA reads its own failed traces in natural language and mutates the prompt from what it saw, beating reinforcement learning at a fraction of the rollouts. Reflexion's idea, with a proper search loop around it."* The optimizer the OpenJarvis talk reaches for.
→ **Transferable:** our failed runs' traces + a verbal-lesson pass + a candidate-instructions variant store = a poor-man's GEPA that fits entirely in localStorage.

**Darwin Gödel Machine (Zhang et al., 2025).** *"Agents sample from an archive of their own ancestors, rewrite their own scaffolding, get scored on coding benchmarks, and go back into the archive. Empirical validation replaces the original Gödel machine's proof requirement."* Turing Post's map: DGM evolves the *scaffold* (tools, prompts, workflows, code) with the model frozen; temporary performance dips are allowed as stepping stones.
→ **Transferable:** an archive of agent-variant JSON rows (ancestors kept, never overwritten) with suite-score-driven parent selection — cheap rows, no code self-modification needed to get the benefit.

**Meta-Harness (Lee et al., 2026).** *"A harness whose job is producing harnesses. A coding agent is handed the full search history, source, traces, and scores, and rewrites the retrieval, memory, and prompt-assembly code around a fixed model. State of the art on Terminal-Bench 2 without touching the weights."*
→ **Transferable:** the *input bundle* is the pattern — history + source + traces + scores is exactly what our suite + logging triad (ranks 1–2) would hand to any optimizing agent. The output (rewriting our own `buildSequentialContext` etc.) is a later-stage, diff-reviewed idea.

**Continual Harness (Karten et al., 2026).** *"Keeps history, memory, skills, prompts, and sub-agent specs across trajectories and mutates them while the agent runs, then goes further and updates the weights DAgger-style from what just happened. The presenter calls test-time training the direction that matters most."*
→ **Transferable (half of it):** cross-trajectory persistence of memory/skills/prompts — yes, that's stores we can build. The DAgger/weight half is out of scope for a browser app (see "What NOT to do").

### Era 3 · Shipped 2026 systems

**Prime Agent (Karten et al., 2026).** *"A persistent IPython REPL, recursive sub-agents that stay addressable after they finish, and continual refinement of prompts and skills. On identical weights it takes ARC-AGI-3 from 30% to 95.5%, which is the number the whole evening is arguing about."*
→ **Transferable mechanisms (two):** (a) a *persistent* REPL whose state survives across tool calls and steps; (b) sub-agents that remain *addressable after completion* — you can call back with follow-ups instead of re-spawning. Both are statefulness plays; both fit our stores.

**OpenJarvis (Saad-Falcon et al., 2026).** *"Decompose the personal AI stack into five primitives, then let a frontier cloud model search over that spec while everything runs locally at inference. Roughly 800x lower marginal cost, with the harness rather than the model closing the gap."*
→ **Transferable:** radical minimalism of the primitive set (we have exactly 4 tools + 2 frameworks — a feature, not a gap), and "search over the spec" maps to suite-driven search over *configurations* (model choice per agent, tool subsets, framework) rather than code changes. Resonates directly with our free-provider multi-model design (r14).

**QM (YC; no paper, MIT-licensed).** *"The third talk of the night. YC's internal work harness, open sourced under MIT, with the brain pulled out of the sandbox and into Postgres."*
→ **Transferable:** the inverse storage bet — durable, queryable state *outside* the agent. We can't (and shouldn't) ship Postgres, but studying QM's state schema shows what a harness considers durable enough to outlive the process: run state, traces, coordination. Our analog is the workflows store with runs + the roadmap's trace schema v2.

### Era 4 · How you know it worked

**"Measuring AI Ability to Complete Long Software Tasks" (Kwa et al. [METR], 2025).** *"Measuring capability as the length of task a system completes, rather than a single-turn score, is what makes harness progress visible at all: the static-harness era and the self-improving era are two slopes on this chart."*
→ **Transferable:** our task suite should record *time-horizon* measures (steps completed, wall-clock, longest successful pipeline) not just pass/fail — harness wins show up as longer horizons on identical weights.

### Supporting finds from the wider pack (not in the 21, but load-bearing)

- **The omarsar0 "build a harness from scratch" thread** (Sep 14, 2026) is effectively a protocol review of this roadmap: three modules (LLM module, tools module, agent loop); *"log inputs/outputs to the loop, inputs/outputs from LLMs, and inputs/outputs from tool calls as a starting point"*; *"set up a simple set of diverse tasks to test your agent loop on. So with every change, you can run the tasks and inspect the results manually."* Reply (D. Arnal): *"make the task suite replayable and version every trace. Then harness changes become measurable experiments rather than vibes — especially when model nondeterminism otherwise masks regressions."* Reply (M. Pavlenko): *"include a task where the right action is to stop, since logging a loop that never reaches its exit only gives you a perfect trace of failure."* And the caution from M. Campbell that becomes our "What NOT to do" headline.
- **Stellar Colosseum (Google, arXiv:2609.15983):** a staged many-agent harness — strategy exploration, a *readiness gate* before decomposition, section-level subproblems, verifier findings routed back to the affected stage; parallel candidates + targeted falsification + aggregation. 218/222 on Codeforces *with execution feedback*. Mechanism for us: the review-gate's verdict routing ("route verifier findings back to the affected part") is the same shape as our rework pass.
- **The Mechanics of a Swarm (arXiv:2609.12748):** a forensic reconstruction of ~876 unintended agent-episodes on a public wiki; the evals *couldn't answer causal questions because there were no read logs or outcomes* — *"read and outcome logging are requirements for agent-evaluation environments."* Direct support for roadmap rank 2.
- **Turing Post "9 Paths Toward RSI":** the improvement-loop map (strategy → memory → skills → policy → weights → scaffold → evaluator); SkillGLoW (consolidate local skills into families, keep only what improves downstream execution, −3.6× library size, unseen-task gains 73.9→83.9); Mendel Gödel Machine (*"better comparisons give better self-edits"* — compare across tasks *and* across agent versions before editing); RQGM (co-evolve the evaluator, frozen within an epoch, challenger must beat it on a fixed ground-truth anchor).

---

## Part 2 — Reference implementations to clone & study

> ⚠️ **Link honesty note:** the pack lists all GitHub entries as *"Prime Agent (GitHub) ↗"* style placeholders — **no URLs are present in the pack text**. Per task constraints, links below are flagged **`find repo URL`** rather than invented. The only concrete URLs in the pack are: the DAIR collection page (`https://academy.dair.ai/papers/collections/harness-engineering`), ReAct's arXiv id `2210.03629` (embedded in an academy link), `arXiv:2609.15983` (Stellar Colosseum), and `arXiv:2609.12748` (Swarm mechanics).

| # | Repo | What to study in it | Link |
|---|------|--------------------|------|
| 1 | **Prime Agent** | The persistent-REPL implementation (how state survives across calls/steps); the sub-agent addressing protocol (call-after-completion semantics, what context the parent passes and gets back); how "continual refinement of prompts and skills" writes to disk; the exact harness delta that moves ARC-AGI-3 30%→95.5% on identical weights. | **find repo URL** (pack: "The harness behind the 95.5% ARC-AGI-3 result") |
| 2 | **verifiers package** (ships with Prime Agent) | How evals are structured so they're reproducible: task definition, scoring, rollout loop. This is the reference design for our replayable task-suite runner (rank 1). | **find repo URL** (same repo per pack: "with the verifiers package used to reproduce the evals") |
| 3 | **OpenJarvis** | The five-primitive spec — the *minimum* vocabulary a personal-AI harness needs; how the cloud optimizer expresses a config over those primitives; the local-inference boundary (relevant to our WebLLM work, r14–r16). | **find repo URL** |
| 4 | **QM** | The Postgres-backed state schema: what a serious harness considers durable (runs, traces, coordination state) and what it leaves ephemeral; MIT-licensed, no paper. Directly comparable to our workflows-store-as-state-machine; informs trace schema v2 fields. | **find repo URL** |
| 5 | **Darwin Gödel Machine** | The archive data structure (ancestors, scores, parent links); parent-selection policy; how scaffold edits are validated before admission to the archive; how "stepping stone" regressions are allowed. Blueprint for our agent-variant archive (rank 7). | **find repo URL** |
| 6 | **Meta-Harness** | What bundle is handed to the optimizing agent (search history, source, traces, scores) and *which files* it rewrites (retrieval, memory, prompt assembly). Maps to what ranks 1–2 must capture so any future optimizer has its inputs. | **find repo URL** |
| 7 | **DSPy** (GEPA ships there) | The GEPA optimizer implementation: how failed traces are summarized into reflective feedback, how candidate prompts are proposed/validated, rollout budgeting ("a fraction of the rollouts" vs RL), metric-function interface. | **find repo URL** |
| 8 | **ARC-AGI-3 benchmark** | The task interface that made the harness gap legible (30%→95.5% same weights); how episodes are scored; what "persistent REPL + addressable sub-agents" buys on genuinely novel tasks. | **find repo URL** |
| 9 | *(bonus, in-pack arXiv)* **Stellar Colosseum** | Staged decomposition with readiness gates; routing verifier findings back to affected sections; execution-feedback loops. arXiv:2609.15983 | `https://arxiv.org/abs/2609.15983` (in pack) |
| 10 | *(bonus, in-pack arXiv)* **The Mechanics of a Swarm** | The logging post-mortem: which missing logs made the study non-causal (reads, outcomes). Justifies the logging triad as an eval-infrastructure requirement, not a nice-to-have. arXiv:2609.12748 | `https://arxiv.org/abs/2609.12748` (in pack) |

Watch item: the pack's author (elvis/DAIR.AI) states his own *"meta harness is built on FastAPI, Python, and TS"* and *"I am also going to release something soon to help with this"* — worth tracking.

---

## Part 3 — Adaptation roadmap (expert-panel evaluation, ranked)

**Panel verdicts** (architect / reliability engineer / UX designer / research scientist), summarized per candidate, then the ranked table.

**1 · Replayable task suite + versioned traces** — *Architect:* foundational; everything else consumes it. Runs are already persisted per workflow (`WorkflowRun.steps[]` with outputs, toolCalls, status, ms) — what's missing is (a) a fixed, named task corpus and (b) a schema version so trace shape can evolve. *Reliability:* this is the only defense against silent regression; nondeterminism means n≥3 repeats per task. *UX:* a "Run suite" button on the workflows view; suite results as a diff card. **Accept — rank 1.**

**2 · Logging triad** (loop I/O / LLM-call I/O / tool-call I/O) — *Reliability:* tool-call I/O is already captured (`ToolCallInfo.args/result/ok/ms`); loop-level context assembly and per-iteration LLM requests are not persisted. The swarm paper elevates this from hygiene to eval requirement. *Architect:* persist client-side from existing `ChatStreamEvent`s (`iteration`, `tool_call`, `tool_result`, `done`) — no server changes. *UX:* hidden by default, "show trace" expander; hard cap + pruning for the 5MB budget. **Accept — rank 2.**

**3 · Reflexion lessons + GEPA-style prompt evolution** — *Research scientist:* Reflexion's write-back is the cheapest proven win and we have all the hooks (`RunErrorInfo`, review `verdict`, `resumeCount`, and the `memory.ts` consolidation pattern as a template). Splitting it: **3a** verbal lessons from failed episodes into context (S), **3b** GEPA-style evolution of `Agent.instructions` from accumulated failed traces (M, needs 1+2). *UX:* lessons must be visible and editable — a model-written doc users can't inspect will erode trust. **Accept both — ranks 3 and 4.**

**4 · MemGPT-style managed memory** — *Research scientist:* extend, don't replace. `ConversationMemory` is already a carved-out region with auto-consolidation (`MEMORY_CONSOLIDATE_EVERY = 10`, `MEMORY_MAX_CHARS = 1200`); the MemGPT move is giving the *model* update operations (add/remove/correct facts) instead of only full rewrites, plus keeping the previous version for rollback. *Reliability:* model-writable memory needs a rollback (store previous text) — cheap in localStorage. **Accept (extend) — rank 5.**

**5 · Addressable sub-agents** — *Architect:* agents already live in a persistent registry; an `agent_call` pseudo-tool with depth-1 recursion is a moderate change to the `/api/chat` loop. *Reliability:* recursion cost + the tool-manifest bloat risk (MCP caution) — must ship behind the suite and default OFF per agent. **Accept, gated — rank 6.**

**6 · RLM pattern (REPL-embedded LLM calls over sliced context)** — *Architect:* full recursion (LLM calls issued from inside `run_code`) doesn't fit our sandbox (node:vm, no network, 4s timeout) without server orchestration. The browser-shaped adaptation — a server-side slice-and-ask tool for oversized attachments — is worthwhile but waits for real user pain (attachments are currently inlined whole). **Conditional accept — rank 7.**

**7 · Skill/prompt library with archive-based selection (DGM)** — *Research scientist:* powerful but strictly later; it compounds only once 1–3 exist (skills need verification = suite scores, selection needs an archive = versioned artifacts). *Architect:* a `skills` store + agent-variant archive (ancestor rows kept, never mutated) is pure localStorage — feasible, but context-injection discipline is critical. **Accept as stage-2 — rank 8.**

### Ranked roadmap

| Rank | Proposal | Source paper(s)/system | Effort | Expected impact | Measurable test via the task suite |
|---|---|---|---|---|---|
| **1** | **Replayable task suite + versioned traces.** New `praison-suites` store: `{id, name, cases:[{id, task, workflowId, expect}]}`; add `schemaVersion: 2` (+ `suiteCaseId?`) to `WorkflowRun` so trace shape can evolve; "Run suite" executes n≥3 repeats per case reusing `executeWorkflowRun`. Export via existing `runToMarkdown`. | omarsar0 thread (D. Arnal: replayable suite + versioned traces); METR long-tasks paper; verifiers package design | **S** | Foundational — converts every later change from vibes to experiment; protects against silent regressions from provider drift | *Metric:* per-case done-rate (steps done/total), rework count, wall-clock; *corpus:* 8–12 fixed cases over the seeded workflows (Research Brief, Build & Verify, Morning Briefing) incl. one "correct action is to stop" case; *comparison:* pre/post change, same model, n=3 — regression flagged if done-rate drops or wall-clock grows >20% |
| **2** | **Logging triad: loop I/O, per-LLM-call I/O, per-tool-call I/O.** Extend `WorkflowRunStep` with optional `llmCalls?: {iter, model, promptChars, contentChars, ms}[]` populated from existing `ChatStreamEvent`s; persist final assembled context (truncated) per step; keep `ToolCallInfo` as-is. Ring-buffer cap per run. | omarsar0 thread (explicit triad); Mechanics of a Swarm ("read and outcome logging are requirements"); QM's durable-state schema | **S** | Debuggability of every later feature; the input bundle a future optimizer (GEPA/Meta-Harness style) consumes | *Metric:* trace completeness (runs where every step has ≥1 LLM-call row + full toolCall results = 100% target), log size per run (budget check ≤100KB/run); *corpus:* same suite as rank 1; *comparison:* before/after — failure attribution time on 3 injected faults (dead endpoint, bad key, oversized doc) via `runDiagnostics` output |
| **3** | **Reflexion lessons from failed runs.** On `status:"error"` (or review `verdict:"rework"`), a silent pass writes a ≤300-char lesson ("what failed, what to try instead") into a per-workflow `lessons` doc (template: `memory.ts` consolidation); injected on retry/resume via the same pattern as `buildMemoryBlock`. | Reflexion (2023); Continual Harness (cross-trajectory state) | **S** | Failed episodes stop being wasted; retries succeed more often — the recovery card (r15) becomes *learning*, not just recovery | *Metric:* retry success rate — failed→resumed runs that finish done, and repeat-failure rate (same kind twice on same case); *corpus:* suite + 3 deliberately flaky cases (transient network); *comparison:* resume-with-lessons vs resume-without (toggle), n=3 each — expect ↑ retry success, ↓ repeat failures |
| **4** | **GEPA-style prompt evolution of `Agent.instructions`.** After ≥k failed traces accumulate for an agent, a proposal pass drafts a candidate instructions variant; suite runs score parent vs child; child promoted only if it wins on the suite. Ancestor rows kept (never overwritten). | GEPA (2025); DSPy (prompts as optimized artifacts); DGM (archive + empirical validation) | **M** | The harness stops being hand-written; per-agent prompts adapt to our actual failure modes at a fraction of RL-style rollouts | *Metric:* suite score delta of evolved vs original instructions (done-rate primary; rework-rate secondary); *corpus:* the 2 workflows with the most failed traces; *comparison:* parent vs child, n=3 per case, promote only if child ≥ parent on ≥70% of cases with no case regressing >1 step |
| **5** | **MemGPT-style managed memory — extend `ConversationMemory`.** Add optional `sections?: {facts, decisions, openThreads}` + a `memory_update` action the model may call during chat (add/correct/remove one fact); keep previous text (`previousText?`) for rollback; auto-consolidation stays as fallback. | MemGPT (2023) — CRUD over carved-out context | **M** | Fewer stale-memory errors in long chats; memory becomes correctable without a full consolidation rewrite | *Metric:* memory accuracy on 5 scripted long chats (10 facts planted, 3 mutated mid-chat) — % facts correct at end; consolidation-pass count (target: fewer full rewrites); *comparison:* current auto-only vs model-update+auto, n=3 chats each |
| **6** | **Addressable sub-agents (`agent_call` tool).** Depth-1 callable agents from the registry; sub-agent results return to parent context; sub-agent conversation persists (addressable after completion, Prime Agent style — callback via its conversation id). Default OFF per agent; bounded iterations. | Prime Agent (2026); Multi-Agent Collaboration (2023) | **M** | Complex tasks decompose without manual workflow authoring; the single biggest harness-leverage datapoint in the pack (30%→95.5% is built on REPL + this) | *Metric:* done-rate on 3 decomposition-heavy suite cases (multi-part research brief) vs single-agent baseline; tool-call count & wall-clock (guard against explosion); *comparison:* with vs without `agent_call`, n=3 — promote only if done-rate ↑ and wall-clock ≤ 2× baseline |
| **7** | **RLM-adapted oversized-doc tool ("slice-and-ask").** Server-side tool: splits an oversized attachment/URL into slices, asks a small model per slice, synthesizes — never inlines the whole doc into context. (Full REPL-embedded recursion rejected for browser; see What-NOT-to-do.) | Recursive Language Models (2025) | **L** | Unlocks document classes that today blow the context window or degrade answers | *Metric:* QA accuracy over 3 oversized docs (50+ pages) — answers requiring cross-slice synthesis; prompt chars consumed (target: ≤30% of full-inline); *comparison:* inline-full vs slice-and-ask, n=3 questions per doc |
| **8** | **Skill library + archive-based selection (stage 2, only after 1–4).** Verified routines (Voyager-style: verify-then-promote via suite) in a `skills` store; retrieval = top-k by suite score per task type; agent-variant archive with parent links (DGM/MGM: "better comparisons give better self-edits"). | Voyager (2023); DGM (2025); SkillGLoW (consolidation, keep-only-if-it-improves); Meta-Harness (input bundle) | **L** | Compounding: proven routines amortize across tasks; the archive enables safe experimentation | *Metric:* suite done-rate with skill retrieval ON vs OFF; library size vs one-skill-per-task (SkillGLoW reports 3.6× smaller with gains); *comparison:* n=3 per case; a skill is retired if its cases regress |

**Sequencing note:** ranks 1–2 are prerequisites for 3–8 (each later rank consumes suite scores or traces). Ranks 1–3 are each ≤1 session of work with zero new storage backends; 4–6 are the first "self-improving era" steps; 7–8 are stage-2.

---

## What NOT to do (constraints honored)

1. **Don't expose more tools to "add capability" — the pack's hardest warning.** @kanwisher: *"Most harnesses add negative value, we found exposing mcps made the models worse at performing the task over just letting it figure itself out,"* and elvis's answer — *"Can't shortcut evals."* Our `Agent.tools` manifests stay minimal; every new tool (`agent_call`, `slice-and-ask`, `memory_update`) ships OFF by default and must win on the task suite before it's default-on.
2. **Don't ship Postgres/IndexedDB state machinery (QM's bet) — and don't blow the ~5MB localStorage ceiling.** Concretely: ring-buffer trace logs (hard per-run cap), prune old runs per workflow (keep last N + last M failed), never store raw LLM request payloads or base64 attachments inside traces, keep `runDiagnostics` key-free as it is today. If a feature can't live within these caps, it's the wrong feature for this app.
3. **Don't chase weight-updating self-improvement.** Continual Harness's DAgger/test-time-training half is a no-go: no training loop in a browser, BYOK providers are read-only. Only its *state* half (history/memory/skills/prompts persisted across trajectories) applies.
4. **Don't auto-apply harness self-modification to live agents.** DGM/Meta-Harness-style self-rewrites without a diff-review step would corrupt localStorage state with no version control to fall back on (r16 proved even *humans* lose files to cutoffs). Any evolution (rank 4, 8) = propose → suite-score → human-visible diff → keep ancestors.
5. **Don't impose ReAct formatting on native tool-calling models** (pack: models do this natively now; a modern harness should stop imposing it). Keep `/api/chat`'s loop thin.
6. **Don't build full RLM/REPL recursion in the browser sandbox** (node:vm can't make LLM calls; token costs multiply silently). Use the server-side slice-and-ask adaptation only when oversized-doc pain is real.
7. **Don't let written-back lessons or skills bloat context unboundedly.** Budget them like `MEMORY_MAX_CHARS` (1,200 chars today); SkillGLoW's lesson is that *consolidated* libraries (3.6× smaller) beat one-per-task piles.
8. **Don't skip the "stop" case in the suite.** Per the pack: a loop that never reaches exit only logs a perfect trace of failure — include one case whose correct behavior is to stop early (deterministic code condition, not just prompt instruction).

---

## Method note

- Read the full source pack (`upload/fancyHARNESSresearchGUIDEScurationPACK1.txt`, 3,271 lines / 127,292 bytes) in sequential chunks — it contains: the DAIR.AI Harness Engineering collection page (21 papers × era blurbs + tools/beyond-papers section), the omarsar0 "build a harness from scratch" thread with replies (incl. the MCP degradation caution), the ReAct paper page, Turing Post's "9 Paths Toward RSI" (Metaⁿ, Recuris, MetaSkill-Evolve, Q-Evolve, RISE, SkillGLoW, MGM, RQGM, DGM), OpenAI/Noam Brown RSI news, Stellar Colosseum (arXiv:2609.15983), The Mechanics of a Swarm (arXiv:2609.12748), and unrelated context (DeepSeek essay, Radio agent chat rooms, byte-model scaling).
- Grounding reads: `worklog.md` (r14–r16 in detail), `src/lib/types.ts` (full), `src/lib/workflow-runner.ts` (full), `src/lib/memory.ts` (full), plus targeted greps of `stores.ts` (persist keys: praison-settings / praison-agents / praison-conversations / praison-workflows / praison-ui) and `constants.ts` (`REWORK_LIMIT=1`, `MEMORY_CONSOLIDATE_EVERY=10`, `MEMORY_MAX_CHARS=1200`, `MEMORY_SOURCE_MESSAGES=24`, `MAX_ITERATIONS_DEFAULT=6`), `helpers.ts` (`runToMarkdown`, `runDiagnostics`, context builders).
- All GitHub links for Prime Agent / OpenJarvis / QM / DGM / Meta-Harness / DSPy / ARC-AGI-3 / verifiers are **absent from the pack text** (placeholder "↗" only) → flagged "find repo URL" above; none invented.
- No app code, no git, no dev server touched. Sole artifact: this file.

*Compiled 2026-09-15 by phase-5 research agent.*
