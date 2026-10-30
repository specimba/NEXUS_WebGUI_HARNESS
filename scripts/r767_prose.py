#!/usr/bin/env python3
# r767 prose surgery - asserted, all-or-nothing rewrite of the r766-narrative
# strings left in the sed-created r767_close.sh template. Every anchor must
# hit exactly once; the file is written only if ALL anchors pass.
import sys

P = 'scripts/r767_close.sh'
src = open(P, encoding='utf-8').read()

PAIRS = []

# 1. header comment - increment description + probe annotations
PAIRS.append((
"r767 close (per-run route letters + wave 9 qwen-lean): gates",
"r767 close (qwen-lean counter + quiet open): gates",
))
PAIRS.append((
"legend probe (GATED - run-card label edited, same view)",
"legend probe (GATED - tier-state line edited, same view)",
))
PAIRS.append((
"tier-state probe (recorded - witnessed q, third straight)",
"tier-state probe (recorded - carries the lean tag)",
))
# 2. lane-legend probe comment
PAIRS.append((
"chips WERE touched this round - the increment edits chip semantics text -> the legend gate runs, r756-r767 precedent",
"the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r767 precedent",
))
# 3. tier-state probe comment
PAIRS.append((
"# tier-state probe (r767): RECORDED ONLY - the route-state line is a witness, not a gate (amber-tone doctrine).",
"# tier-state probe (r767): RECORDED ONLY - now carries the lean tag (r767 increment); the route-state line is a witness, not a gate (amber-tone doctrine).",
))
# 4. wave-strip probe comment
PAIRS.append((
"# wave-strip probe (r767 increment): presence GATED",
"# wave-strip probe: presence GATED",
))
# 5. divergence probe comment
PAIRS.append((
"# divergence probe (r767): RECORDED ONLY - with the middle tier alternating near-per-wave, BOTH routes can hold diamonds (each lags the newest-3 window when the other route holds the latest bucket); the SIGNAL is a diamond on intern/fast-judge/jev = a genuine partial ladder (amber-tone doctrine).",
"# divergence probe: RECORDED ONLY - diamonds on the middle-tier routes are the normal handoff/lean signal (amber-tone doctrine); the SIGNAL is a diamond on intern/fast-judge/jev = a genuine partial ladder.",
))
# 6. lane-filter probe comment
PAIRS.append((
"# lane-filter probe (chips WERE touched this round - the legend gate above runs; the fixed tally assertion stays GATED).",
"# lane-filter probe (the legend view WAS touched this round - the gate above runs; the fixed tally assertion stays GATED).",
))
# 7. Agent line
PAIRS.append((
"10:07 slot; opened on the r765 handoff - HEAD fbcb161d7 = the r765 ship + sweep from the 09:37 slot, own-session lineage, no parallel round closed",
"10:37 slot; opened on the r766 handoff - HEAD 490adc44d = the r766 ship + sweep from the 10:07 slot, own-session lineage, no parallel round closed",
))
# 8. Task line
PAIRS.append((
"Task: Patrol round 766 - WAVE 9 RETURNS, QWEN LEANS, PER-RUN ROUTE LETTERS SHIP: the opening ro-SQL census read 129 ev / 34 runs / 93 nj vs the r765 close baseline 126/33/21/15/90 - +3 events / +1 run / +3 no-judge rows, newest ~02:02:18 UTC, ~57 min after wave 8 - back INSIDE the band after the ~62 outlier; verdict/uncertain flat for the EIGHTH straight wave. Route: the live tier-state read witnesses bucket 10-30 02:00 letter q - mid-qwen ACTIVE (2/2) / mid-glm silent (0/2) - a THIRD straight qwen wave (00:03, 01:05, 02:02); per the r765 watch definition that is the LEAN-toward-the-free-routes signal (route sequence now glm, glm, qwen, glm, glm, qwen, qwen, qwen; amber-tone: a pattern shift to investigate, not a fault). Shipped the per-run route letter on the corpus run cards (deviation from handoff candidate (a) disclosed below - the builtin box extraction is a pure refactor parked for an Owner-asked round): laneRunLetterOf reuses the exact laneCountsOf tried-trace extraction + the laneTierOf heuristic per run (q = qwen-only, g = glm-only, m = both; an m run = a genuine both-routes run - investigate signal); the letter renders on each run pill with its own title. ACCEPTANCE WITNESSED LIVE: 34 run pills read back, tails evq / evq / evq / evg / evg - the run list now IS the wave-route history, and the newest three q runs match waves 7/8/9 (run_9faf38f58f90 = the wave-7 run recorded in r762).",
"Task: Patrol round 767 - QWEN-LEAN COUNTER SHIPS, QUIET OPEN: the opening ro-SQL census read 129 ev / 34 runs / 93 nj - IDENTICAL to the r766 close census (newest ~02:02:18 UTC, wave 9); no wave 10 at open, ~35 min quiet - inside the 13-62 band, no interval break to declare; verdict/uncertain flat for the NINTH straight wave. Shipped the lean counter (the r766 watch made the qwen lean the live story - three straight q waves 00:03/01:05/02:02 ended the wave-by-wave alternation): laneLean computes the trailing run of identical route letters over the wave-strip route letters within the shown strip window (last 6 corpus buckets, newest backward; an absent letter - a bucket without middle-tier rows - breaks the run; window caps at 6); a run of 2+ renders the lean tag in the corpus tier-state line (q-lean ×N style, font-medium text-foreground/70 matching the strip letters) with its own title documenting the semantics, and the tier-state title gains the lean sentence. The lean is now an on-page read: the recorded tier-state probe carries it live each round, so a fourth q (cement) or a g return (alternation resumed) is witnessed in the probe text without deriving it from the strip. Honest scoping: no new data source - the counter reads the same route map the strip letters use.",
))
# 9. R1 line
PAIRS.append((
"- R1 open probes: no parallel session - HEAD fbcb161d7 was the r765 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 129/34/21/15/93 - WAVE 9 (+3 ev / +1 run / +3 nj, newest ~02:02:18 UTC, ~57 min after wave 8, back inside the band) -> wave-round path with the per-run letter increment.",
"- R1 open probes: no parallel session - HEAD 490adc44d was the r766 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 129/34/21/15/93 - FLAT vs the r766 close, no wave 10 at open (~35 min quiet, newest ~02:02:18 UTC) -> steady-watch path with the lean-counter increment.",
))
# 10. R2 line
PAIRS.append((
"- R2 templates: r767_qa.sh + r767_close.sh via the DUAL sed pattern (s/r=765/r=767/g + s/r765/r767/g) - zero mechanical remnants, bash -n green; the round-765 prose gaps (spelled-out Patrol round 765 + the literal Round ID r767 pointer) handled by this surgery pass; wave-9 census taken in the R1 batch.",
"- R2 templates: r767_qa.sh + r767_close.sh via the DUAL sed pattern (s/r=766/r=767/g + s/r766/r767/g) - zero mechanical remnants, bash -n green; the round-766 prose gaps (spelled-out Patrol round 766 + the literal Round ID r767 pointer) handled by this surgery pass; wave-10 census taken in the R1 batch.",
))
# 11. R3 line
PAIRS.append((
"- R3 increment (run-kanban.tsx): laneRunLetterOf helper inserted after laneCountsOf (same gateCensusOf noJudge gate + the same tried-trace regex, laneTierOf per extracted lane, q/g/m letter, empty when no middle-tier lanes), each run pill gains the letter span (font-medium text-foreground/70, own title documenting the semantics). Two-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).",
"- R3 increment (run-kanban.tsx): laneLean memo inserted after laneTiers - a trailing-run read over the wave-strip route letters within the shown strip window (last 6 corpus buckets, newest backward; an absent letter - a bucket without middle-tier rows - breaks the run, window caps it at 6); run >= 2 renders the lean tag in the corpus tier-state line (' q-lean ×N — ' style, font-medium text-foreground/70 matching the strip letters, own title documenting semantics), and the tier-state title gains the lean sentence. Three-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).",
))
# 12. R5 line
PAIRS.append((
"- R5 QA + close: the r767 golden QA ran GREEN first-try (board probe at the WAVE-9 census 34 runs / 129 ev / 93nj, chips 35; ld count 93, seven lanes, no eighth, qwen pair still 2nd/3rd in the count sort; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (run-card label edited - same view; r756-r767 precedent honored); tier-state probe RECORDED (witnessed bucket 02:00 letter q); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.",
"- R5 QA + close: the r767 golden QA ran GREEN first-try (board probe at the steady wave-9 census 34 runs / 129 ev / 93nj, chips 35; ld count 93, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (the tier-state line inside the legend was edited - same view; r756-r767 precedent honored); tier-state probe RECORDED (the recorded text now carries the lean tag); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.",
))
# 13. Stage summary line 1
PAIRS.append((
"- THE LEAN IS THE STORY: three straight qwen waves - the wave-by-wave alternation era is over, the relay is favoring the free routes (or glm is saturated); the cadence band held (57 min inside 13-62) while the route did not. Magnitude +9/+9/+4/+4/+3 - decaying since w5; verdict/uncertain flat eight waves. The run-card letters make the lean visible in the primary scan surface. Watches for wave 10: a g return = the alternation resumes (or load-balancing caught up), an m run = the first both-routes run (investigate), a zero-growth slot = the burst is ending. Snapshot discipline twenty-second close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the run-pill letter census (34 pills, newest three q) + the divergence census, all green.",
"- LEAN MADE FIRST-CLASS: the qwen lean is now stated by the instrument itself - the tier-state line's lean tag turns the trailing-run count into a recorded probe witness, so cement (q ×4+) or reset (g return) is readable in the QA artifact without cross-reading the strip. Zero-growth open (~35 min, inside the band) keeps the burst-ending watch (r766) armed but declares nothing. Snapshot discipline twenty-third close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.",
))
# 14. Candidate deviation line
PAIRS.append((
"- CANDIDATE DEVIATION (disclosed): the handoff named the builtin box extraction (a) - a pure refactor with no user-facing change, and its own phrasing conditioned it on an Owner ask; this round shipped the letter instrument into the run list instead (the alternation era makes per-run route legibility the highest-value read), leaving the builtin box parked for an explicitly requested refactor round. The extraction regex is shared verbatim with laneCountsOf - one extraction truth, two consumers.",
"- CANDIDATE NOTE (no deviation): the r766 handoff named no increment candidate (queue: builtin box Owner-asked / TASKS.md re-triage / QA bugs first); this round continued the r759-r766 route-instrument line with the lean counter - the live story (the relay lean) became a first-class on-page read. The builtin box extraction stays parked for an explicitly requested refactor round.",
))
# 15. Handoff pointer
PAIRS.append((
"Round ID: r767 -> next patrol (job 473388)",
"Round ID: r768 -> next patrol (job 473388)",
))
# 16. Handoff action line
PAIRS.append((
"Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r767_qa.sh sed-adapted (DUAL pattern s/r=767/r=767/g + s/r767/r767/g); remember the round-766 prose gaps (spelled-out Patrol round 766 + the literal Round ID r767 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/run-card view, else RECORDED; tier-state probe: RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: QWEN LEAN confirmed (three straight q, 00:03 + 01:05 + 02:02) - a fourth q cements the lean, a g return = alternation resumed, an m run or m bucket (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a TENTH wave, or an interval-pattern break (band 13 -> 42 -> 62 -> 57 - a gap far outside, or a zero-growth slot) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay LEAN UPDATE (r767): three straight qwen waves (00:03, 01:05, 02:02) after the wave-by-wave alternation - the platform report should describe the lean, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.",
"Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r767_qa.sh sed-adapted (DUAL pattern s/r=767/r=768/g + s/r767/r768/g); remember the round-767 prose gaps (spelled-out Patrol round 767 + the literal Round ID r768 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe: RECORDED ONLY (carries the lean tag since r767); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the lean counter in the tier-state line is the live read (r767) - a growing q-run cements the qwen lean, a g return resets the counter (alternation resumed), an m bucket or m run (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NEW wave beyond the close census's newest (the strip bucket total rises), or an interval-pattern break (band 13 -> 42 -> 62 -> 57 - a gap far outside, or a zero-growth stretch past ~62 = the burst ended) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay LEAN UPDATE (r766/r767): three straight qwen waves (00:03, 01:05, 02:02) after the wave-by-wave alternation, now surfaced as the on-page lean counter - the platform report should describe the lean, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.",
))
# 17. Blockers line
PAIRS.append((
"Standing constraint (r707): mechanism or named evaluation every round - held (the per-run route letters shipped into a live wave-9 read - 34 run pills witnessed with the newest three q - + full golden QA, anchored in scripts/qa_r767.txt and scripts/qa_r767_close.txt).",
"Standing constraint (r707): mechanism or named evaluation every round - held (the lean counter shipped into a live steady-watch + full golden QA, anchored in scripts/qa_r767.txt and scripts/qa_r767_close.txt).",
))
# 18. Commit message
PAIRS.append((
"r767: per-run route letters ship + wave 9 leans qwen. Census 129/34/21/15/93 vs the r765 baseline 126/33/90 - +3 ev / +1 run / +3 nj, newest ~02:02:18 UTC, ~57 min after wave 8 (back inside the band); verdict/uncertain flat eight waves. Live tier-state read: bucket 10-30 02:00 letter q - a THIRD straight qwen wave (00:03, 01:05, 02:02): the wave-by-wave alternation era is over, the relay leans toward the free routes. Increment: laneRunLetterOf (same tried-trace extraction as laneCountsOf + laneTierOf per run; q/g/m, an m run = the both-routes investigate signal) rendering on every corpus run pill - acceptance witnessed live: 34 pills, tails evq/evq/evq/evg/evg, the run list is now the wave-route history (handoff candidate (a) builtin-box refactor deferred: pure refactor, Owner-ask gated). Snapshot discipline twenty-second close.",
"r767: qwen-lean counter ships + quiet open. Census flat at 129/34/21/15/93 vs the r766 close - no wave 10 at open (~35 min quiet, newest ~02:02:18 UTC, inside the band); verdict/uncertain flat ninth wave. Increment: laneLean - a trailing-run read over the wave-strip route letters (shown window, newest backward, absent letter breaks the run); run >= 2 renders the lean tag in the corpus tier-state line (q-lean ×N, font-medium text-foreground/70, own title) and the title gains the lean sentence - the r766 relay-lean watch is now an on-page read, carried live by the recorded tier-state probe (styling polish: the tag matches the strip-letter treatment). Snapshot discipline twenty-third close.",
))

ok = True
for i, (o, n) in enumerate(PAIRS):
    c = src.count(o)
    if c != 1:
        print(f'ANCHOR {i} count={c}')
        ok = False
if not ok:
    print('SURGERY ABORTED - all-or-nothing guard')
    sys.exit(1)
for o, n in PAIRS:
    src = src.replace(o, n)
open(P, 'w', encoding='utf-8').write(src)
print(f'surgery applied: {len(PAIRS)} replacements')
