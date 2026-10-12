
---
Task ID: r439
Agent: main (platform dev agent)
Task: r438 handoff — ROTATE to chat surfaces. Composer probe found a live r434/r435-class reachability gap in the model picker: the composer capped every provider's LIVE model roster at 20 BEFORE passing options to ModelPicker, so live models 21+ were unsearchable and unselectable — while the picker's own header promises "models stay findable when a provider's list grows past a screenful (live catalogs)". Fixed with the honest-cap doctrine, benefiting all four picker consumers.

Work Log:
- Verified lineage: HEAD 240c49787 (r438 snapshot); health 200; tree clean. No user reply this round.
- SURVEY (staleness-probe-before-deep-read held — 6 rounds incl. the picker read): chat-view (1225 ln) probed CLEAN (slices are text-processing, catches honest, aria near-complete); composer (1164 ln) carried the one real gap: `(live[p.id] ?? []).slice(0, 20)` at the options build. ModelPicker (217 ln, shared by composer/provider-gallery/setup-wizard/agent-form-dialog) renders everything it is given — the knowledge cap upstream defeated its findability promise.
- SHIPPED (2 files): (1) composer.tsx — the slice(0, 20) knowledge cap removed; the WHOLE live roster (still deduped + embed/whisper/tts/image-filtered) feeds the picker; (2) model-picker.tsx — the picker now OWNS its search: controlled query state (cleared on close AND on select — a stale query can never silently narrow the next open), `shouldFilter={false}` + self-filtering over label/id/note/keywords (plain case-insensitive substring, r434/r435 doctrine), RENDER_CAP=60 applied strictly AFTER the filter, honest caption with aria-live="polite" (searching: "N of M match · first 60 shown" when capped; idle+capped: "first 60 of N shown — search reaches the rest"; idle under cap: silence — no noise), and a no-match empty state ("No model matches "…"" — a knowable claim) kept DISTINCT from the no-options-at-all emptyTitle/emptyHint path. The r28 pinned-row synthesis now carries group:"Pinned" so it keeps its own heading in the pool flow (regression caught in self-review before the gate).
- VERIFICATION: unmasked tsc exit 0; lint 0 errors / 33 warnings (baseline exact, PIPESTATUS). LIVE QA (HARNESS rules applied from this session's r438 read — synthetic native-setter input events + independent eval round-trips): idle = 31 rows, NO idle caption (pool ≤ 60 → silence correct), groups intact (Auto/Vyce AI/AIHubMix/Pollinations/groq); "glm" → "3 of 31 match" + 3 rows; garbage "zzqqx" → "No model matches "zzqqx" | Labels, ids, notes and keywords all count."; clear → 31 rows back, caption gone; console clean (HMR only); zero residue (no persisted state touched).
- HONEST CAP: the >60 render-cap branch (idle "first 60 of N shown" + capped match caption) is not witnessable with today's live rosters (31 options total) — code-reviewed + tsc-clean; it fires the day a live roster grows past 60. The stale-query reset on select was exercised implicitly (synthetic clear = same path).
- ON BUDGET: 12 rounds (lineage 1, probe 2, opts/picker trace 3, edits 2 incl. self-review catch, gate 1, QA 3, worklog+snapshot 1 round / 2 guarded calls).

Stage Summary:
- The model picker keeps its own promise now: every model a provider actually serves is searchable and selectable, the 60-row render cap is stated instead of silent, and the search match counts are honest — the composer can no longer silently shrink what the picker knows. All four consumers (chat composer, provider gallery, setup wizard, agent form) inherit the protection for free.

Round Handoff:
Round ID: r440
Task owner: main (platform dev agent)
Scope committed: src/components/praison/chat/composer.tsx (live-roster knowledge cap removed), src/components/praison/model-picker.tsx (self-owned search + honest render cap + match counts + no-match state).
Open risks: >60 render-cap branch unexercised live (fires when a live roster grows); picker search is plain substring (cmdk's old fuzzy ranking traded for determinism + honest counts — r434 precedent); image-studio blob-download path carried from r432; radar papers live-network path inherited.
Blockers: none
Next recommended action: r440 — (1) FIRST re-read any user reply. (2) Verify HEAD lineage (expect the r439 snapshot) + health. (3) Rotation candidates: (a) agents/agent-form-dialog or settings surfaces (the two other picker consumers — verify their option arrays aren't knowledge-capped too, same probe pattern); (b) radar view polish (verify a gap first); (c) any user-reported issue outranks all. (4) Standing: unmasked tsc TRUE exit; lint 0/33 pipefail; worklog BEFORE snapshot on its OWN tool call; HARNESS.md re-read before QA; survey HARD-CAP 3 rounds; STALENESS-PROBE-BEFORE-DEEP-READ; land on budget — early exit IS success.
