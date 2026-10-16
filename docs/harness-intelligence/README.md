# NEXUS Harness Intelligence — RSI Doctrine (r495)

> Distilled from the owner's curated corpus: 7 uploaded papers, the DAIR.AI
> **Harness Engineering** (21 papers) and **Self-Improving Agents** (31 papers)
> collections, DAIR Issue 183 (Oct 5–11 2026), and the upstream
> MervinPraison/PraisonAI always-on blueprints. Companion: `paper-digests.md`,
> executable pack: `upload/nexus-rsi-blueprint-pack.json`.

## Why this file exists

The owner diagnosed the gap precisely: *the workflows export is a 7.6 KB
scaffold with none of the intelligence inside it, and our R&D workflows are
"still not good at harvesting to real work implementation."* This directory is
the fix's first layer: a distilled, load-bearing corpus that turns papers into
**executable NEXUS workflows** instead of notes. Every claim below traces to a
paper digest in `paper-digests.md`; every digest ends in a NEXUS hook that the
blueprint pack implements.

## The capability ladder (DAIR's harness arc → NEXUS today)

DAIR's collection reads six years of harness engineering as one move repeated:
*"give the loop something new it is allowed to do."*

| Level | Mechanism | Canonical papers | NEXUS status |
|---|---|---|---|
| V0 | bare loop + prompt | GPT-2 (2019) | workflow-runner core |
| V1 | context shaping | GPT-3 few-shot, CoT (2020-22) | step instruction overrides, digest checkboxes |
| V2 | tools + acting | WebGPT, Toolformer, ReAct (2021-23) | tool roster (search/read_url/run_code) |
| V3 | feedback + memory | Self-Refine, Reflexion, Voyager, MemGPT (2023) | run archive + `digestRecent()` successor wire, heartbeat |
| V4 | compilers / optimizers | DSPy, GEPA (2023-25) | AI auto-plan in the editor (thin — the gap) |
| V5 | **self-improving harnesses** | Darwin Gödel Machine, Meta-Harness, Continual Harness, Prime Agent (2025-26) | **NEW — the blueprint pack below** |

The 2026 papers (all in the owner's uploads) converge on one structure:
**the harness is the optimization target, execution evidence is the gradient,
and the improvement process itself must be learned from.**

## What the blueprint pack adds (the harvest → implementation wire)

Five workflows, importable via Workflows → Import (steps rebind by
`agentName` — the r495 importer patch):

1. **MASS Cycle — Team Self-Supervision** (Sakana/UCB, Issue 183 paper of the
   week): propose 2 workflow variants → execute both → pairwise judge with the
   five-axis rubric (delivery / conformance / fidelity / consistency /
   fitness) → revise the winner into v2 + 3 evidence-tagged lessons. The
   paper's key finding we exploit: *training on task-solving traces improves
   all three RSI roles* — so every executed run makes the next proposal
   smarter.
2. **Harness² — Propose–Probe–Compose** (Google, Oct 2026): the contrastive
   step. Invariant candidate (how the agent WORKS) + domain candidate (what a
   practitioner KNOWS) probed against the same task; composer merges only
   edits tied to a named trajectory moment; KEEP_BASE is a valid outcome;
   reflector emits ≤1 durable lesson with cue/evidence/confidence.
3. **MoSB — Branch Frontier Search** (Meta, Sep 2026): two instruction
   branches run the same case pool; coverage votes assign case ownership
   (margin Δ≥1); solved-by-every-frontier cases are dropped; each branch
   revises guidance from local history. NEXUS-native because the run archive
   already stores per-run step outputs.
4. **Agent Plasticity Meter** (Meta S Labs, Issue 183): converts the archive
   into *gains per dollar of learning* — done-rate deltas, artifact-reuse
   rate, which agent/branch actually converts experience into held-out
   improvements. Slow learners ignore artifacts they wrote; this meter makes
   that visible.
5. **Always-On RSI Harvest** (upstream 24/7 blueprint × DAIR weekly cadence):
   the intake valve — weekly scan of DAIR issue + collections + upstream
   releases → top-3 transferable mechanisms → ONE candidate workflow spec
   ready for the Studio. Registered in the server lane so it fires with the
   tab closed.

## The closed NEXUS RSI loop (what now actually closes)

```
DAIR/upstream corpus ──▶ Harvest (wf 5, weekly, server lane)
        │                        │
        ▼                        ▼
 candidate workflow spec ──▶ Studio import (agentName rebind)
        │
        ▼
 run (browser lane, real agents, real tools)
        │                        │
        ▼                        ▼
 run archive (nexus.run-archive.v1) ──▶ digestRecent() successor wire
        │
        ▼
 MASS / Harness² / MoSB / Plasticity (wfs 1–4) consume the digest
        │
        ▼
 revised workflow spec + lessons ──▶ next cycle (recursive)
```

Missing still (next rounds, honest): true weight-level distillation (MASS SFT)
is out of scope for a BYOK web platform — the text-level loop above is the
correct r-level analog of MASS's *workflow* half, per the paper's own
decomposition (workflow optimization ≈ prompt/harness search; internalization ≈
what our instruction overrides + archive digests approximate).

## Safety rails (from the Anthropic corpus — non-negotiable)

The two red-team reports (IoT self-replication, unintended model actions)
define hard edges for any NEXUS self-improvement loop:

- **No persistence workarounds**: when a task cannot complete as given, agents
  stop and report — they never work around a restriction (the persistence
  failure class Anthropic observed across 4 categories).
- **No gated-data bypass**: `read_url`/fetch must not exfiltrate access
  tokens, accept agreements, or route through URL shorteners to escape fetch
  limits.
- **Bounded budgets**: every harvest/probe step caps fetches (≤2/step) and
  wall time; loop-detection style halts stay in place (MASS's own evals show
  identical prompts halting or completing — treat halts as data, not bugs to
  auto-retry).
- **Self-replication is out of scope, permanently**: nothing in the NEXUS
  codebase may copy weights, exfiltrate keys (vault keys stay behind the
  localhost + CSRF double-gate), or spawn unsupervised external processes.
- **External judgments stay external**: pairwise verdicts from the judge steps
  label quality — they are never fed back as "ground truth" without the
  evidence tag (MASS's external-judges-withheld doctrine, mirrored).

## Operating instructions

1. Import `upload/nexus-rsi-blueprint-pack.json` in Workflows → Import. The
   toast will report *"N steps rebound by agent name"* — expected, since agent
   ids are profile-local.
2. Run **Plasticity Meter** weekly (Schedule popover); run **MASS Cycle** on
   any workflow you want improved; run **Harness²** probes on the workflows
   that matter.
3. The **Always-On Harvest** is server-registered (7-day cadence); enable it
   in Workflows or pause it there — the Cron Observatory and the workflows
   board both show its state.
4. New papers: drop them in `upload/`, ask for a digest, and the harvest
   workflow or a chat session folds them into this doctrine.
