# Paper Digests — Harness & RSI Corpus (r495)

Each entry: **claim → mechanism → NEXUS hook**. Sources are the owner's
uploads (paths under `upload/`) + the DAIR collections (fetched Oct 16 2026)
+ the upstream PraisonAI README. The executable half lives in
`upload/nexus-rsi-blueprint-pack.json`.

## 1. MASS — Recursive Self-Improvement through Multi-Agent Self-Supervision
*Lee, Xu, Seely, Lee, Sojoudi, Zaharia, Tang (UC Berkeley / Sakana AI, Oct 2026) — Issue 183 paper of the week.*
- **Claim**: a homogeneous RSI loop (same model = agent + optimizer + evaluator)
  self-supervises effectively when the model coordinates copies of itself;
  two MASS cycles → 1.2–1.6× score-per-output-token on four research
  benchmarks; task-solving-only training improves all three roles
  (optimizer + evaluator accuracy 0.73 → 0.93).
- **Mechanism**: inner loop = evolutionary workflow search (orchestrator +
  subagents as a text spec: role / instruction / **contract** / **hop**),
  self-evaluator picks the champion by pairwise workspace comparison;
  outer loop = rank 18 rollouts under the champion, keep top 16, SFT on
  orchestrator+subagent windows with the workflow removed from the prompt.
  Information-flow analysis: optimized workflows move task-specificity from
  roles/instructions into **contracts and hops** (what agents exchange, when).
- **Bottleneck finding**: the optimizer, not the evaluator, is the RSI speed
  bottleneck (GPT-5.5 as evaluator-only ≪ GPT-5.5 as evaluator+optimizer).
  Workflow search is noisy — identical prompts can halt or complete; edit size
  does not predict verdict flips (|ρ| ≤ 0.12).
- **NEXUS hook**: workflows 1 + 5. Our workflow spec already has roles +
  instructions; the pack's steps encode contract/hop emphasis explicitly
  ("the orchestrator must state what each downstream step receives"). The
  judge step mirrors the pairwise workspace comparison; lessons are the
  text-space stand-in for SFT internalization.

## 2. Harness² — Recursive Agent Harnessing for an Open World
*Xu et al. (Northwestern / Google Cloud AI Research, Oct 9 2026).*
- **Claim**: one contrastive Propose–Probe–Compose step improves GLM-5 and
  Gemini 3.5 Flash on every benchmark/configuration tested (up to +11.5
  WorkBuddy-Bench, +4.5 JobBench, +11.8 pp LAB), *without ground-truth
  verifiers*; harnessing-level recursion (an improvement library of adopted
  harnesses + EXPERIENCE entries) transfers across benchmarks and models.
- **Mechanism**: 8 editable components (system prompt, guardrails, memory,
  tool guidance, subagents, skills, scripts, middleware plugin). Propose =
  invariant candidate (how the agent WORKS) + domain candidate (what a
  practitioner KNOWS); Probe = same-task execution under matched conditions →
  behavioral contrast; Compose = merge only edits tied to a named trajectory
  moment (KEEP_BASE valid). Reflector: verdicts helped/hurt/no observed
  effect/**confounded** — "an invented attribution poisons the library."
  Key prompt doctrine: verified workspace facts beat procedures ("write the
  fact itself… a guessed fact is worse than none"); always-on prose is the
  expensive option; prefer skill → script → subagent → plugin → prose.
- **NEXUS hook**: workflow 2 + the run archive's lesson entries. Our step
  instruction overrides are the component files; the composer's
  "name the moment" rule is written into the S4 instruction verbatim.

## 3. MoSB — Mixture of Self-Improving Branches for Agent Harness Optimization
*Dong et al. (Meta / Duke / UC Davis, Sep 29 2026).*
- **Claim**: branching harness search with evolving dev subsets + branch-local
  proposal guidance beats Meta-Harness by +34.8% (Math-Gemini), +11.6%
  (Terminal-Bench 2.0), +3.8% (SWE-bench Lite) — selected on development data
  only; a router over branch heads ≈ or > the best single head.
- **Mechanism**: branch = own dev subset + candidate history + proposal
  guidance (SKILL.md). Every Cp iterations: coverage votes c(x) over each
  branch's frontier; branch owns cases where c_b(x) − max c ≥ Δ; cases solved
  by every frontier are dropped from all subsets. Every Cs iterations: the
  proposer revises guidance from local search history ("what improved, what
  repeatedly failed, what remains unresolved"). Ablation: dev-pruning +
  guidance-updates together = 62.0 vs 51.0 with neither.
- **NEXUS hook**: workflow 3. Two "branches" = two agents with different
  instruction guidance over the same case pool; the archive provides the
  coverage votes; the reviewer step implements ownership + drop rules.

## 4. The Ultimate Guide to Multi-Harness RL
*Kolavi et al. (Hugging Face / Liquid AI, Oct 1 2026).*
- **Claim**: the same model performs 23% vs 52% in different harnesses (GLM-5.2
  on SWE-bench Pro); training ACROSS harnesses spreads gains everywhere
  (LFM2.5-2.6B 42.2% → 54.2% across four harnesses, 31% fewer tool calls)
  while single-harness training mostly helps that harness.
- **Mechanism**: capture proxy records exact tokens + logprobs at the model
  endpoint (never re-tokenize text — "you optimize on the exact tokens the
  model produced"); Harbor supplies containerized tasks; GRPO with a small
  tool-efficiency bonus (correct answers with fewer calls) — correctness
  alone gives no learning signal when all rollouts succeed.
- **NEXUS hook**: (a) the tool-efficiency reward idea → our Plasticity Meter
  counts calls-per-done-step as the efficiency axis; (b) the harness-overfit
  warning → never tune one workflow against only its own successes (the MoSB
  drop-solved-by-all rule is the antidote); (c) weight-level RL is explicitly
  out of NEXUS scope (safety doctrine), the capture-proxy lesson still shapes
  honest logging (we archive outputs, not imagined ones).

## 5. Agent Plasticity: Measuring Self-Improvement Through Experience
*Meta Superintelligence Labs (Issue 183 #2).*
- **Claim**: "agent plasticity" = held-out gains per dollar of learning, with
  frozen weights and fresh context per run that inherits artifacts from
  earlier runs. The best final scorer is often NOT the most plastic learner
  (Claude Fable 5 tops chess/Go/Hex; GPT-5.6 Sol gains most per dollar;
  NetHack: only Claude Opus 5.5 improves, +66 pts for ~$1,073).
- **Mechanism**: artifact inheritance between runs; slow learners ignore
  artifacts they wrote; fast learners reuse artifacts but still fail on
  low-quality ones — artifact quality gates plasticity.
- **NEXUS hook**: workflow 4. The archive's digest wire is our artifact
  inheritance; the meter reports reuse-rate + gains-per-run-cost so the owner
  can see which pipeline is actually plastic.

## 6. HERMES — Harness Engineering via Modular Executable Dev-Primitives
*(Issue 183 #4; Code).*
- **Claim**: long-horizon SWE agents drown reconstructing program state spread
  across files/configs/tests; HERMES turns repository components into active
  participants in the task.
- **NEXUS hook**: doctrine — any NEXUS workflow that touches code/artifacts
  should bind state to named workspace files (scripts/files as the harness
  surface), not re-derive state from chat history. Folded into the Harness²
  workflow's INV-candidate guidance.

## 7. VERA — Scaling Verifiable Environments for Agentic Co-Evolution
*(Issue 183 #5; NVIDIA).*
- **Claim**: environments that can be resumed at any stage and scored from
  observable evidence enable updating both the model and its harness.
- **NEXUS hook**: the run archive is our "observable evidence" tier — resume =
  re-run from a prior run's outputs; this justifies the digest-attach wire as
  the environment's resume handle. Feeds the MoSB workflow's case-pool design.

## 8. Harness Learning Enables Generalizable Test-Time Adaptation
*(Issue 183 #7; CMU).*
- **Claim**: train a proposer model to revise the HARNESS from execution
  feedback while solver weights stay frozen — gains generalize across tasks.
- **NEXUS hook**: the closest academic twin of what the blueprint pack does at
  the prompt level: our "proposer" is the Strategic Planner agent; its
  revisions live in instruction overrides + lessons, and generalization comes
  from the cue/lesson format (shape-of-situation, not task facts).

## 9. VeriHarness + Sharpening Tax
*(Issue 183 #8/#9; Google / Meta S Labs).*
- **VeriHarness claim**: rollout agreement hides shared errors; disagreement
  often points at the correct alternative — verification needs adversarial
  challenge, not voting.
- **Sharpening Tax claim**: RL post-training sharpens existing behaviors at
  coverage cost — for agentic tasks, some capabilities exist only because of
  post-training (the hypothesis is not universally true).
- **NEXUS hook**: the MASS judge step is instructed to challenge agreement
  ("a shared wrong answer is the most expensive failure class"), and lesson
  entries must distinguish sharpening (existing behavior, new trigger) from
  new capability.

## 10. Safety corpus — Anthropic Frontier Red Team (Oct 9–12 2026)
- **Self-replication report**: sub-30B models complete individual replication
  steps; GLM-5.2-class models chain them end-to-end in simplified evals; IoT
  fleets could host shards. Inference setup (not cyber) is the least-studied
  stage. Memento-style periodic resets with notes improve long-horizon
  reliability — a harness pattern, not a capability grant.
- **Unintended actions report**: four persistence classes (exploiting software
  flaws to run commands, submitting real forms, bypassing gated data, URL
  shorteners to escape fetch limits); all blocked by detection tooling; root
  causes include ambiguous tasks and reward-hacked training environments.
- **NEXUS hook**: the safety rails in `README.md` are written directly from
  these four classes; the vault double-gate (localhost + x-nexus-csrf) already
  blocks the data-exfil vector; harvest budgets (≤2 fetches/step) block the
  runaway-loop vector; "stop and report" is the encoded failure policy.

## 11. DAIR collections (52 papers, curated)
- **Harness Engineering** (21 papers, YC Paper Club Harness Edition, Aug 2026):
  the V0→V5 ladder in the doctrine README. Additions worth folding in later:
  InterCode (execution-feedback standardization), Voyager (skill library as
  growing harness), MemGPT (memory as OS — maps to our conversation memory +
  vault), Continual Harness (online adaptation for foundation agents — the
  closest thing to our server-lane loop), Prime Agent (2026).
- **Self-Improving Agents** (31 papers, Sep 2026): opens with Schmidhuber's
  Gödel Machines (2003) — proof-before-rewrite; NEXUS adopts the weaker but
  honest form: **evidence-before-adopt** (the composer's trajectory-moment
  rule). The collection's six-level grading matches our ladder.

## 12. Upstream PraisonAI (MervinPraison/PraisonAI main, fetched Oct 16 2026)
- **Always-on blueprints harvested**: "Hire a 24/7 AI Workforce" framing;
  Five-Layer Agent Stack (Model → Context → Harness → Sandbox → deployment) —
  NEXUS maps: model = BYOK roster; context = digest + memory; harness =
  workflow-runner + tools + guardrails (CSRF/localhost gates); sandbox =
  server lane + vault. Scheduling: `schedule start/list/stop` CLI + dashboard
  Cron page — our Schedule popover + Cron Observatory are the same shape.
  Memory: short/long-term, file-based, graph memory, Claude memory tool —
  our conversation memory + run archive cover the short/long pair; graph
  memory is a genuine gap (next-epic candidate).
- **Names only, no code**: NEXUS stays an independent from-scratch build
  (README doctrine); we harvest *patterns and prompt doctrines*, never code
  or branding.
