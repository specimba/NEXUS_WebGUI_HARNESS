# Paper digest — arXiv 2610.31421: depth growth, looping, and in-context learning

> **Paper**: Kapl, Maile, Bauer, von Oswald — *How Depth Growth and Looping
> Shape In-Context Learning in Language Models* (TU Munich / Helmholtz AI /
> MCML / Google Paradigms of Intelligence Team), arXiv:2610.31421, 22 Oct 2026.
> Local PDF: `upload/How Depth Growth and Looping Shape In-Context Learning in
> Language Models.pdf`. Distilled r643 (Owner-directed deep-dive).

**One-line thesis.** Reusing computation across depth — *looping* a tied
block r times per forward pass, or *growing* depth by duplicating early
blocks whose copies then specialize — gives a model a shared inductive bias
toward learning FROM CONTEXT: earlier ICL acquisition, stronger ICL retention
against in-weights displacement, and induction-head circuits propagated from
a handful of early ancestors.

**Verdict for the harness.** Adopt the SHAPES (looped passes, precedent
anchoring, reassigned-label probes, growth-event recovery windows), never
claim the mechanism. Every adaptation below is a behavioral analogy witnessed
dial-free; none of our tools measures attention heads.

---

## 1. What the paper actually established (evidence-anchored)

| # | Finding | Evidence |
|---|---------|----------|
| F1 | Grown/looped 3B models convert more context into lower loss (ICL-Score = NLL(pos 40–60) − NLL(pos 490–510)); grown also beats dense on absolute late-token NLL after ~pos 1000 | Fig 1a,b; App B.2 |
| F2 | Few-shot GSM8K: both beat dense at every shot count; **grown WIDENS its gap with more shots (+7% @ 8)**; looped keeps the advantage but dense closes by 8 shots | Fig 1c, 8 |
| F3 | Unseen formal languages (RegBench, held-out DFAs): grown/looped lower TVD; **advantage emerges within the first string (~15 symbols), then holds constant** | Fig 2 |
| F4 | ICL vs IWL competition (Omniglot, bursty P=1): grown/looped RETAIN higher ICL and show LOWER IWL than dense-12L; dense ICL decays as IWL grows (transience replicated) | Fig 3a |
| F5 | ICL-only setting (labels re-dealt every sequence): grown/looped/4L-dense acquire ICL EARLIER than dense-12L | Fig 3b |
| F6 | Lineage: 12 final top-2% induction heads in the grown model descend from 4 ancestors of the initial 4-layer model; **two early heads (L2H9/L2H10, high PS before the first growth event) account for 10/12** — depth growth PROPAGATES early context-copying circuits | Fig 5; App E.2 |
| F7 | Ablations: FV-head ablation hurts few-shot F1 most in ALL models (task identity, early tokens, plateau); **induction-head ablation hurts late-token prediction more, grows with position, and hits grown/looped harder than dense** | Fig 6, 20, 21 |
| F8 | Growth events transiently DISRUPT induction behavior, then recover during further training | Fig 4 hollow markers; Fig 13 |
| F9 | Economics: growing saves ~26% training FLOPs at 3B; looped 10-8×2-10 reaches 36-layer effective depth with 28 unique layers (~2.45B params) | App A |

## 2. Expert panel

### E1 — The Mechanist (interpretability)
F6+F7 read as one sentence: *what gets copied early and reused becomes the
load-bearing path for using context.* The induction head's operation — attend
to the token FOLLOWING an earlier occurrence — is precedent-continuation.
Two consequences with teeth:
- **Two-occurrence rule.** A copy-from-precedent circuit needs the pattern to
  OCCUR, and needs the copy target near where generation happens. F7 says
  induction importance GROWS with position while FV (task identity) dominates
  early tokens and plateaus. So: task definition early (FV carrier); format
  exemplar BOTH early (anchor) and immediately before the generation point
  (target). One exemplar, two occurrences, fixed roles.
- **Precedent lane.** Our run archive IS our early layers. Steps should
  receive exemplars drawn from past successful runs of the same step type —
  that is grown-model behavior (early context-circuits propagated forward),
  not prompt decoration.

### E2 — The Systems Architect
- The loop is **prelude → shared block × r → coda**. Tied = the SAME block
  prompt every pass (looped); copies specialize per pass (grown). Loop first:
  one prompt to maintain, and the paper shows tied reuse produces the same
  repetition patterns across applications.
- **Cap r ≤ 3.** F3 shows the iterative advantage plateaus — it emerges in
  the first ~15 symbols / first strings and then holds constant. Extra passes
  buy the plateau, not more. Budget-capped, verdict-gated early exit.
- F2's shape is a routing hint: few-shot-heavy GENERATION steps benefit most
  from exemplar conditioning (and at 3B the looped advantage concentrates in
  generation, not multiple-choice). And the dense baseline closing on looped
  at 8 shots says: prefer filling the context before looping the compute.

### E3 — The Evaluator
Figure 3 is a protocol, not just a result. Port both probes:
- **ICL probe** (held-out, labels re-dealt per sequence): re-mint every
  fixture identifier per run. A step that still passes on freshly minted
  identifiers is using the context, not memory.
- **IWL probe** (fixed associations, identifiers absent from context):
  passing while the identifier is absent means the weights knew it — the
  leak-detection direction.
- **Burstiness.** P(bursty)=1 in the retention experiment: demonstrations
  CLUSTERED by type encourage in-context use. Pack similar exemplars
  together; do not interleave heterogeneous ones.
- **Transience is the enemy.** F4 shows dense ICL decays as IWL grows.
  Rotating fixture identifiers in golden QA is our anti-transience discipline.

### E4 — The Operator (reliability / radar)
F8 maps directly onto our incident history: growth events (schema pushes,
template upgrades, engine changes) temporarily degrade capability, then
recover. The radar should ANNOTATE digests inside a post-change window
("post-growth recovery window") instead of raising fresh criticals — we have
chased false P0s of exactly this shape. Severity downgrades one level inside
the window; the next digest must show recovery or escalate.

### E5 — The Economist
Compute-matched discipline: the paper's comparisons hold data, optimizer
steps AND inference FLOPs constant — that is why the conclusions are clean.
Our A/B discipline (decision gates vs none, peer blind-score, looped passes)
must match TOKEN budgets, not call counts; otherwise "more passes" wins by
spending more — the exact confound the paper controls away. And looped =
28 unique layers at 36-layer effective depth is the same lesson token-lean
(r533) taught: reuse-shaped compute, not raw scale, is the cheap axis.

## 3. Adaptation mapping

| Paper mechanism | Harness analog | Slice |
|---|---|---|
| Loop p-b×r-c (tied block, r applications) | `loopedPlan`: prelude → tied block × r≤3 → coda | 1 ✅ r643 |
| Growth = copy + independent specialization | `grownPlan`: block + per-copy delta, mismatch-refusing | 1 ✅ r643 |
| Verdict-gated stopping (plateau, bounded rework) | `loopExit`: pass→exit, fail→one rework, unsure→cap | 1 ✅ r643 |
| Induction copies an earlier occurrence's continuation | `twoOccurrencePrompt`: anchor early + target at the generation point | 1 ✅ r643 |
| Fig 3(b) re-dealt labels probe | `reassignLabels`: salted per-run minted identifiers | 1 ✅ r643 |
| Fig 3 ICL/IWL probes | `iclIwlSplit`: held-out reassigned vs fixed+absent, honest disjoint flag | 1 ✅ r643 |
| Early-ancestor propagation (F6) | precedent-exemplar lane: top-2 similar past-successful outputs via the r579 RRF shim | 2 |
| Tied block executor in the engine | workflow-runner `loopedPasses` field + amber "↻ looped k/r" chip + call-log notes | 2 |
| F8 growth-event dip | radar post-growth recovery-window annotation | 3 |
| F4 anti-transience | golden fixture identifier rotation schedule | 3 |

## 4. Honest boundaries

- We do not run or train the paper's models. Every claim above was checked
  against the provided 38-page PDF; the harness adaptations are BEHAVIORAL
  analogies — no witness here measures attention heads, PS or FV scores.
- The paper's looped advantage concentrates in GENERATION tasks at 3B
  (multiple-choice favors grown/dense) — expect looped passes to help
  generative workflow steps, not classification-style gates.
- Concurrent SMELT (Wang et al., 2026) reports looped-MoE gains that grow
  with context length and demonstration count — consistent direction from an
  independent group; noted, not verified here.
- The r643 QA self-caught two fixture-level lessons worth keeping: (a) an
  occurrence counter counts against the WHOLE prompt — tag text can collide
  with a degenerate exemplar; (b) an identifier leak rides undeclared PROMPT
  TEXT, and the split must REPORT it, not silently assume disjointness.

## 5. Slice 1 witness

- `src/lib/looped-icl.ts` — pure, isomorphic, zero imports, never-throw
  envelopes on the planners.
- `scripts/qa-looped-icl.ts` — dial-free, **51/51 checks PASS** (tsc rc=0).
- TASKS.md: P2 experiment entry "Looped-depth harness semantics" under
  Experiments, slices 2–3 staged.
