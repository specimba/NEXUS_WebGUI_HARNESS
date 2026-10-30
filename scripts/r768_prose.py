#!/usr/bin/env python3
# r768 prose surgery - asserted, all-or-nothing rewrite of the r767-narrative
# strings left in the sed-created r768_close.sh template. Every anchor must
# hit exactly once; the file is written only if ALL anchors pass.
# r767 LESSON APPLIED: all NEW texts are apostrophe-free AND single-quote-free
# (the close heredoc embeds them in single-quoted Python literals - the r767
# R3 quote defect and the line-96 apostrophe both killed that heredoc; this
# surgery also replaces both defective lines with clean text).
import sys

P = 'scripts/r768_close.sh'
src = open(P, encoding='utf-8').read()

PAIRS = []

# 1. header comment - increment description
PAIRS.append((
"r768 close (qwen-lean counter + quiet open): gates",
"r768 close (interval readout + wave 10 lands): gates",
))
# 2. header comment - tier-state annotation
PAIRS.append((
"tier-state probe (recorded - carries the lean tag)",
"tier-state probe (recorded - carries the lean tag + the interval readout)",
))
# 3. tier-state probe comment
PAIRS.append((
"now carries the lean tag (r768 increment)",
"now carries the lean tag (r767) and the interval readout (r768 increment)",
))
# 4. Agent line
PAIRS.append((
"10:37 slot; opened on the r766 handoff - HEAD 490adc44d = the r766 ship + sweep from the 10:07 slot, own-session lineage, no parallel round closed",
"11:07 slot; opened on the r767 handoff - HEAD fc697e123 = the r767 ship + worklog-fix + sweep from the 10:37 slot, own-session lineage, no parallel round closed",
))
# 5. Task line
PAIRS.append((
"Task: Patrol round 767 - QWEN-LEAN COUNTER SHIPS, QUIET OPEN: the opening ro-SQL census read 129 ev / 34 runs / 93 nj - IDENTICAL to the r766 close census (newest ~02:02:18 UTC, wave 9); no wave 10 at open, ~35 min quiet - inside the 13-62 band, no interval break to declare; verdict/uncertain flat for the NINTH straight wave. Shipped the lean counter (the r766 watch made the qwen lean the live story - three straight q waves 00:03/01:05/02:02 ended the wave-by-wave alternation): laneLean computes the trailing run of identical route letters over the wave-strip route letters within the shown strip window (last 6 corpus buckets, newest backward; an absent letter - a bucket without middle-tier rows - breaks the run; window caps at 6); a run of 2+ renders the lean tag in the corpus tier-state line (q-lean ×N style, font-medium text-foreground/70 matching the strip letters) with its own title documenting the semantics, and the tier-state title gains the lean sentence. The lean is now an on-page read: the recorded tier-state probe carries it live each round, so a fourth q (cement) or a g return (alternation resumed) is witnessed in the probe text without deriving it from the strip. Honest scoping: no new data source - the counter reads the same route map the strip letters use.",
"Task: Patrol round 768 - WAVE 10 LANDS INSIDE THE BAND, LEAN CEMENTED, INTERVAL READOUT SHIPS: the opening ro-SQL census read 97 nj / 35 runs vs the r767 close 93/34 - +4 nj / +1 run, newest ~03:03:43 UTC, ~61 min after wave 9 - inside the band (13-42-62-57-61, plateauing near ~60, no break); verdict/uncertain flat for the TENTH straight wave (21/15). Route: the newest-bucket rows name the qwen pair with zero glm mentions (SQL pre-read: 4 rows, 4 qwen3.8 traces each) - a FOURTH straight q (00:03, 01:05, 02:02, 03:03): per the r767 watch definition the lean is CEMENTED, and the on-page counter should read q-lean ×4. Shipped the interval readout (the cadence-band watch made on-page, pairing with the lean counter): laneGap computes minutes between the newest corpus-row timestamps of the two newest strip buckets (bucketBounds max-to-max, the same pair the manual cadence track used); the readout renders in the corpus tier-state line after the lean tag (+61m since prior style, font-medium text-foreground/70, own title), and the tier-state title gains the interval sentence. Honest scoping: no new data source - the gap reads the same bounds the strip hover shows.",
))
# 6. R1 line
PAIRS.append((
"- R1 open probes: no parallel session - HEAD 490adc44d was the r766 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 129/34/21/15/93 - FLAT vs the r766 close, no wave 10 at open (~35 min quiet, newest ~02:02:18 UTC) -> steady-watch path with the lean-counter increment.",
"- R1 open probes: no parallel session - HEAD fc697e123 was the r767 ship + worklog-fix + sweep (own-session lineage); tree clean; server 200; ro-SQL census 97 nj / 35 runs / 21 verdict / 15 uncertain - WAVE 10 (+4 nj / +1 run, newest ~03:03:43 UTC, ~61 min after wave 9, inside the band) -> wave-round path with the interval-readout increment.",
))
# 7. R2 line
PAIRS.append((
"- R2 templates: r768_qa.sh + r768_close.sh via the DUAL sed pattern (s/r=766/r=768/g + s/r766/r768/g) - zero mechanical remnants, bash -n green; the round-766 prose gaps (spelled-out Patrol round 766 + the literal Round ID r768 pointer) handled by this surgery pass; wave-10 census taken in the R1 batch.",
"- R2 templates: r768_qa.sh + r768_close.sh via the DUAL sed pattern (s/r=767/r=768/g + s/r767/r768/g) - zero mechanical remnants, bash -n green; the round-767 prose gaps (spelled-out Patrol round 767 + the literal Round ID r768 pointer) handled by this surgery pass, new-texts apostrophe-free per the r767 lesson; wave-10 witnessed in the R1 batch, wave-11 watch armed.",
))
# 8. R3 line - replaces the r767 quote-defective text
PAIRS.append((
"- R3 increment (run-kanban.tsx): laneLean memo inserted after laneTiers - a trailing-run read over the wave-strip route letters within the shown strip window (last 6 corpus buckets, newest backward; an absent letter - a bucket without middle-tier rows - breaks the run, window caps it at 6); run >= 2 renders the lean tag in the corpus tier-state line (' q-lean ×N — ' style, font-medium text-foreground/70 matching the strip letters, own title documenting semantics), and the tier-state title gains the lean sentence. Three-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).",
"- R3 increment (run-kanban.tsx): laneGap memo inserted after laneLean - minutes between the newest corpus-row timestamps of the two newest strip buckets (waveStrip.shown last two keys, bucketBounds max-to-max, null-guarded when a bound is missing); the readout renders in the corpus tier-state line after the lean tag (+Nm since prior style, font-medium text-foreground/70 matching the strip letters, own title documenting semantics), and the tier-state title gains the interval sentence. Three-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).",
))
# 9. R5 line
PAIRS.append((
"- R5 QA + close: the r768 golden QA ran GREEN first-try (board probe at the steady wave-9 census 34 runs / 129 ev / 93nj, chips 35; ld count 93, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (the tier-state line inside the legend was edited - same view; r756-r768 precedent honored); tier-state probe RECORDED (the recorded text now carries the lean tag); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.",
"- R5 QA + close: the r768 golden QA ran GREEN first-try (board probe at the WAVE-10 census 35 runs / 133 ev / 97nj, chips 36; ld count 97, seven lanes, no eighth, qwen pair still 2nd/3rd in the count sort; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (the tier-state line inside the legend was edited - same view; r756-r768 precedent honored) - the legend label carries the lean tag and the interval readout; tier-state probe RECORDED (witnessed q-lean ×4 and +61m since prior); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.",
))
# 10. Stage summary - replaces the r767 apostrophe-defective text
PAIRS.append((
"- LEAN MADE FIRST-CLASS: the qwen lean is now stated by the instrument itself - the tier-state line's lean tag turns the trailing-run count into a recorded probe witness, so cement (q ×4+) or reset (g return) is readable in the QA artifact without cross-reading the strip. Zero-growth open (~35 min, inside the band) keeps the burst-ending watch (r766) armed but declares nothing. Snapshot discipline twenty-third close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.",
"- WAVE 10 INSIDE THE BAND, LEAN CEMENTED ON-PAGE: the interval readout completes the watch pair - the tier-state line now states both the route lean (q-lean ×N) and the cadence gap (+Nm since prior), so the two standing watches (route + interval) are recorded-probe witnesses every round. Wave 10 at ~61 min keeps the band plateau near ~60 (13-42-62-57-61) - no break; magnitude +4/+4 holds the w7/w8 level; verdict/uncertain flat ten waves. Snapshot discipline twenty-fourth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.",
))
# 11. Candidate note
PAIRS.append((
"- CANDIDATE NOTE (no deviation): the r766 handoff named no increment candidate (queue: builtin box Owner-asked / TASKS.md re-triage / QA bugs first); this round continued the r759-r766 route-instrument line with the lean counter - the live story (the relay lean) became a first-class on-page read. The builtin box extraction stays parked for an explicitly requested refactor round.",
"- CANDIDATE NOTE (no deviation): the r767 handoff named no increment candidate (queue: builtin box Owner-asked / TASKS.md re-triage / QA bugs first); this round continued the r759-r767 instrument line with the interval readout - the cadence-band watch became a first-class on-page read. The builtin box extraction stays parked for an explicitly requested refactor round.",
))
# 12. Handoff pointer
PAIRS.append((
"Round ID: r768 -> next patrol (job 473388)",
"Round ID: r769 -> next patrol (job 473388)",
))
# 13. Handoff action line
PAIRS.append((
"Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r768_qa.sh sed-adapted (DUAL pattern s/r=768/r=768/g + s/r768/r768/g); remember the round-767 prose gaps (spelled-out Patrol round 767 + the literal Round ID r768 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe: RECORDED ONLY (carries the lean tag since r768); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the lean counter in the tier-state line is the live read (r768) - a growing q-run cements the qwen lean, a g return resets the counter (alternation resumed), an m bucket or m run (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NEW wave beyond the close census's newest (the strip bucket total rises), or an interval-pattern break (band 13 -> 42 -> 62 -> 57 - a gap far outside, or a zero-growth stretch past ~62 = the burst ended) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay LEAN UPDATE (r766/r768): three straight qwen waves (00:03, 01:05, 02:02) after the wave-by-wave alternation, now surfaced as the on-page lean counter - the platform report should describe the lean, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.",
"Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r768_qa.sh sed-adapted (DUAL pattern s/r=768/r=769/g + s/r768/r769/g); remember the round-768 prose gaps (spelled-out Patrol round 768 + the literal Round ID r769 pointer - both handled in the close-script surgery) AND the surgery quote lesson: new-text strings must be apostrophe-free AND single-quote-free (the close heredoc embeds them in single-quoted Python literals - the r767 R3 quote defect and the line-96 apostrophe both killed that heredoc; r768 rebuilt both lines clean); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe: RECORDED ONLY (carries the lean tag since r767 and the interval readout since r768); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the lean is CEMENTED (four straight q, 00:03 through 03:03) - a fifth q deepens it, a g return resets the counter (alternation resumed), an m bucket or m run (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NEW wave beyond the close census newest (the strip bucket total rises), or an interval-pattern break (band 13-42-62-57-61 plateauing near ~60 - the on-page readout is the witness now; a gap far outside, or a zero-growth stretch past ~62, = the burst ended) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay LEAN CEMENTED (r768): four straight qwen waves (00:03, 01:05, 02:02, 03:03) after the wave-by-wave alternation, now surfaced as the on-page lean counter - the platform report should describe the lean, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.",
))
# 14. Blockers line
PAIRS.append((
"Standing constraint (r707): mechanism or named evaluation every round - held (the lean counter shipped into a live steady-watch + full golden QA, anchored in scripts/qa_r768.txt and scripts/qa_r768_close.txt).",
"Standing constraint (r707): mechanism or named evaluation every round - held (the interval readout shipped into a live wave-10 read - the recorded tier-state probe carries q-lean ×4 and +61m since prior - + full golden QA, anchored in scripts/qa_r768.txt and scripts/qa_r768_close.txt).",
))
# 15. Commit message
PAIRS.append((
"r768: qwen-lean counter ships + quiet open. Census flat at 129/34/21/15/93 vs the r766 close - no wave 10 at open (~35 min quiet, newest ~02:02:18 UTC, inside the band); verdict/uncertain flat ninth wave. Increment: laneLean - a trailing-run read over the wave-strip route letters (shown window, newest backward, absent letter breaks the run); run >= 2 renders the lean tag in the corpus tier-state line (q-lean ×N, font-medium text-foreground/70, own title) and the title gains the lean sentence - the r766 relay-lean watch is now an on-page read, carried live by the recorded tier-state probe (styling polish: the tag matches the strip-letter treatment). Snapshot discipline twenty-third close.",
"r768: interval readout ships + wave 10 lands inside the band, lean cemented. Census 97 nj / 35 runs vs the r767 close 93/34 - +4 nj / +1 run, newest ~03:03:43 UTC, ~61 min after wave 9 (band 13-42-62-57-61, plateau near ~60, no break); verdict/uncertain flat tenth wave. Route: fourth straight q (00:03, 01:05, 02:02, 03:03) - the lean is CEMENTED. Increment: laneGap - minutes between the newest corpus-row timestamps of the two newest strip buckets (bounds max-to-max), rendered as +61m since prior in the corpus tier-state line after the lean tag (font-medium text-foreground/70, own title) with the interval sentence in the title - the cadence-band watch made on-page, pairing with the lean counter (styling polish: the tag matches the strip-letter treatment). Surgery new-texts apostrophe-free per the r767 lesson. Snapshot discipline twenty-fourth close.",
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
