# Paper digest — arXiv 2610.32285: Trial by Trace (harness reliability & failure attribution)

> **Paper**: Cao, Zhu, Wang, Li, …, Zhou (TraceLite / CASIA / Zhongguancun Academy /
> IIE-CAS / Tsinghua / BIT) — *Trial by Trace: Benchmarking AI Agent Harnesses for
> Reliability and Failure Attribution*, arXiv:2610.32285, 23 Oct 2026.
> Sources verified in-conversation: arXiv abstract + full-text HTML (taxonomy table
> §3.2.1, FA §3.5). Distilled r647 (Owner-directed; surfaced by our own Research
> Scout automation — the platform found its own upgrade manual).

**One-line thesis.** Task outcomes alone cannot distinguish model errors from
harness shortfalls: TraceTrial-Bench evaluates the HARNESS as a first-class
subject across seven reliability components, captures native execution traces,
and attributes failures through explicit mechanism chains — finding that
**31.1% of successful runs still violate ≥1 harness criterion** and that
task-success and harness-criterion rankings disagree.

**Verdict for the harness.** This paper is a mirror, not a metaphor: it
benchmarks artifacts of exactly our class (agent harnesses managing context,
tools, lifecycle, governance). Adopt the two-layer discipline, the seven-
component vocabulary, and the bypass/chain semantics — dial-free, as pure
classification over run artifacts we already produce (call logs, statuses,
verdicts). We do not implement their judge or benchmark; we implement their
*questions*.

---

## 1. What the paper actually established (evidence-anchored)

| # | Finding | Evidence |
|---|---------|----------|
| F1 | Harness reliability decomposes into 7 components: **Context** (information preservation/disclosure across boundaries), **Execution** (faithful process semantics, state, result delivery), **Governance** (approvals, guardrails, secret redaction, trust boundaries), **Lifecycle** (state transitions, recovery, idempotent retries), **Observability** (model-visible diagnostics, replayable logs, provenance), **Tools** (valid interfaces, faithful transport, discovery), **Verification** (completion claims vs authoritative outcomes) | §3.2.1 taxonomy table; 40 mechanism-level properties, 95 tasks (C:15 E:27 G:9 L:19 O:7 T:17 V:1) |
| F2 | Two-layer evaluation: agent task performance and harness reliability are scored SEPARATELY; the layers yield **different rankings** | Abstract; §3.4; §5.2 |
| F3 | **31.1% of runs achieve task success despite failing ≥1 harness criterion** — outcome-only evaluation systematically overrates unreliable harnesses | Abstract; §5.2 |
| F4 | Trajectory Tracing (TT) + Multi-source Evidence Acquisition (MEA) capture native traces + evidence from agent context, harness, and execution environment; a Trace IR normalizes events with **call–result correlation and execution lineage** | Abstract; §3.3 |
| F5 | Failure Attribution (FA) connects failed harness/agent criteria through **predefined mechanism chains**; co-occurrence is NOT propagation — candidate links require evidence review to validate | §3.5; contributions |
| F6 | **Measurement bypass**: an agent action can make a property unobservable (e.g., a wrapper replacing the exit status under test). Bypassed criteria stay visible as zeros but are EXCLUDED from the harness failure set: Z_H = F_H ∖ B | §3.5 eq. 4 |
| F7 | Mechanism inclusion requires the trigger, expected behavior, observation boundary, and verdict conditions specified BEFORE execution ("admission gate") | §3.1/§3.2.1 |
| F8 | Macro harness scores across 4 harnesses × 9 models × 95 tasks (3,420 runs): **59.8%–72.0%** — even good harnesses fail ~1/3 of criteria | Abstract; §5.1 |

## 2. Expert panel

### E1 — The Trace-keeper (observability)
Our `pushCall` call-log notes ARE the TT analog, and `toolCalls[]` on run rows
is our Trace IR — but ours is prose-first where the paper is schema-first.
F4's "call–result correlation and execution lineage" is the gap: every tool
call must correlate to its result and to the step that spawned it. The
adaptation is not new infrastructure; it is a countable, canonical NOTE
VOCABULARY (the house already does countable notes — "Looped pass k/r",
"Peer blind score") extended with a component tag so traces become queryable
reliability evidence.

### E2 — The Systems Architect (two layers, one run)
F2+F3 with teeth: our golden QA and run panels report the AGENT layer
(step done, gate pass). The harness layer is implicit. Adaptation: derive
harness-criteria verdicts from run artifacts we ALREADY materialize —
reworked steps → Lifecycle question; tool calls → Tools/Execution;
gate verdicts vs final output → Verification; vault/redaction → Governance;
skipped rows → bypass (F6: visible as zero, excluded from the harness set).
No new runtime: a pure classifier over the run shape, rendered as chips.

### E3 — The Evaluator (success ≠ reliable)
F3 is our anti-theatre rule made citable: a run that "worked" while violating
a harness criterion is a DEBT, not a success. The `31.1%` shape belongs in
our run summary: "N runs succeeded with ≥1 harness violation" as a first-class
counter next to done/error counts — the radar and run panel should never let
green masks red underneath.

### E4 — The Operator (radar chains)
F5 maps onto our radar finding discipline: today a finding's `evidence` field
states facts; the paper demands candidate-vs-validated CHAINS. Our history
already contains one validated chain (vault-empty → closed-tab lane failure,
r640) and one near-miss where co-occurrence almost became a false P0 (the
r643 gate-FAIL-vs-ladder-429 window). Adaptation: findings that assert a
propagation must name their chain type — `candidate` (co-occurrence) vs
`validated` (mechanism declared + evidence reviewed) — and the R7-symmetry
recovery witness (r646) becomes the first `validated` positive chain.

### E5 — The Economist (bypass honesty, normalized cost)
F6 is the sharpest transferable rule: when an agent action makes a property
unobservable, the criterion is not "passed" — it is BYPASSED, still visible.
Our house already learned this twice (r29 auto-digest chips: a sentinel
digest must not read as a real answer; r183 skipped rows must not read as
stopped-mid-flight). Formalize it: a third verdict state, `bypassed`, that
keeps the zero visible but refuses attribution. And §4.3's normalized token
cost reporting matches the r643 Economist: match TOKEN budgets, not call
counts.

## 3. Adaptation mapping

| Paper mechanism | Harness analog | Slice |
|---|---|---|
| 7-component taxonomy (C/E/G/L/O/T/V) | `HARNESS_COMPONENTS` data + component tags in countable call-log notes | 1 ✅ r647 |
| Two-layer verdicts over native artifacts | `classifyRunCriteria`: pure classifier over the run shape (statuses, reworked, verdicts, toolCalls, sentinels) | 1 ✅ r647 |
| Measurement bypass Z_H = F_H ∖ B | `attributeFailure`: bypass set keeps zeros visible, excludes from harness failure set | 1 ✅ r647 |
| Mechanism chains: candidate vs validated | `attributeFailure` emits chains labeled candidate/validated against a declared-chain list | 1 ✅ r647 |
| F3 success-despite-violation counter | run summary "succeeded with ≥1 harness violation" (harness layer of the run panel) | 2 |
| F4 call–result correlation | call-log lineage: every tool call carries result status + step id (schema-hardening of pushCall) | 2 |
| F5 radar chain semantics | radar findings gain chain-typed evidence (candidate/validated); R7 recovery = first validated positive | 3 |
| F7 admission gate for mechanisms | TASKS.md experiment entries gain "trigger/expected/boundary/verdict specified before execution" checkboxes | 3 |

## 4. Honest boundaries

- We did not run TraceTrial-Bench; we read the abstract + full-text HTML
  (taxonomy table, FA section). All numbers above are the paper's, cited to
  sections; every harness adaptation is a behavioral/structural port witnessed
  dial-free — no LLM-judge is implemented here.
- The paper's Verification component has only ONE task (V:1) — the authors
  are honest that coverage is uneven; our Verification analog (Decision
  gates) is strong precisely where the benchmark is thin. Asymmetry noted,
  not hidden.
- Secondary papers surfaced by our own scout, read at abstract level only:
  **DynaFlow** (arXiv:2610.34467 — free-form orchestration learned by the
  main agent, sub-agents fixed; verification/refinement of UPSTREAM outputs
  as a trained behavior) maps to our fixed pipelines + depth materialization —
  candidate future slice, NOT claimed as read; **Harness Self-Evolution via
  Skill Adaptation** (arXiv:2610.33024 — skills that help strong models
  degrade weak ones, +31.1 vs −8.8; 86% of weak-model failures had the
  requirement already stated in the skill) maps to per-step lane pins (r503):
  the same step instruction may need capability-matched reformulation per
  lane. Both staged in TASKS.md as abstract-level leads.
- The r646 recovery-witness rule and this paper's FA converge on the same
  discipline from opposite directions; the overlap is a confirmation, not a
  dependency.

## 5. Slice 1 witness

- `src/lib/trace-trial.ts` — pure, isomorphic, zero imports: the 7-component
  data (with the paper's task counts), `classifyRunCriteria` (two-layer
  criterion derivation from the run shape), `attributeFailure` (bypass
  subtraction, candidate/validated chains, never-throw envelope),
  `harnessSummary` (F3-style success-despite-violation counter), countable
  note vocabulary.
- `scripts/qa-trace-trial.ts` — dial-free: bypass math, chain labeling,
  layer separation, score determinism, never-throw on degenerate runs.
- TASKS.md: P1 experiment entry "TraceTrial harness-reliability layer"
  under Experiments, slices 2–3 staged.
