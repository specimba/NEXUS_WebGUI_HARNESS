#!/usr/bin/env python3
"""r766 surgery: rewrite the sed-carried r765 prose in r766_close.sh.

Asserted all-or-nothing: every anchor must hit exactly one line; the file
is written only if EVERY replacement passes. Handles the two known prose
gaps (spelled-out 'Patrol round 765' Task line + the literal 'Round ID:
r766' pointer -> promoted to r767) plus the wholesale round-prose rewrite
(header, agent, task, R1/R2/R3/R5, stage summary, handoff, blockers,
commit message)."""
import sys

PATH = '/home/z/my-project/scripts/r766_close.sh'

REPL = [
    # 1. header comment
    ("# r766 close (tier-state letter history",
     "# r766 close (per-run route letters + wave 9 qwen-lean): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - run-card label edited, same view) -> tier-state probe (recorded - witnessed q, third straight) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - both routes may hold diamonds) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep"),
    # 2. agent line
    ("Agent: NEXUS patrol (main agent - job 473388, 09:37 slot",
     "L.append('Agent: NEXUS patrol (main agent - job 473388, 10:07 slot; opened on the r765 handoff - HEAD fbcb161d7 = the r765 ship + sweep from the 09:37 slot, own-session lineage, no parallel round closed)')"),
    # 3. task line (spelled-out round gap)
    ("L.append('Task: Patrol round 765 - LETTER HISTORY SHIPS",
     "L.append('Task: Patrol round 766 - WAVE 9 RETURNS, QWEN LEANS, PER-RUN ROUTE LETTERS SHIP: the opening ro-SQL census read 129 ev / 34 runs / 93 nj vs the r765 close baseline 126/33/21/15/90 - +3 events / +1 run / +3 no-judge rows, newest ~02:02:18 UTC, ~57 min after wave 8 - back INSIDE the band after the ~62 outlier; verdict/uncertain flat for the EIGHTH straight wave. Route: the live tier-state read witnesses bucket 10-30 02:00 letter q - mid-qwen ACTIVE (2/2) / mid-glm silent (0/2) - a THIRD straight qwen wave (00:03, 01:05, 02:02); per the r765 watch definition that is the LEAN-toward-the-free-routes signal (route sequence now glm, glm, qwen, glm, glm, qwen, qwen, qwen; amber-tone: a pattern shift to investigate, not a fault). Shipped the per-run route letter on the corpus run cards (deviation from handoff candidate (a) disclosed below - the builtin box extraction is a pure refactor parked for an Owner-asked round): laneRunLetterOf reuses the exact laneCountsOf tried-trace extraction + the laneTierOf heuristic per run (q = qwen-only, g = glm-only, m = both; an m run = a genuine both-routes run - investigate signal); the letter renders on each run pill with its own title. ACCEPTANCE WITNESSED LIVE: 34 run pills read back, tails evq / evq / evq / evg / evg - the run list now IS the wave-route history, and the newest three q runs match waves 7/8/9 (run_9faf38f58f90 = the wave-7 run recorded in r762).')"),
    # 4. R1
    ("- R1 open probes: no parallel session - HEAD 2625b044e",
     "L.append('- R1 open probes: no parallel session - HEAD fbcb161d7 was the r765 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 129/34/21/15/93 - WAVE 9 (+3 ev / +1 run / +3 nj, newest ~02:02:18 UTC, ~57 min after wave 8, back inside the band) -> wave-round path with the per-run letter increment.')"),
    # 5. R2 (double-sed garbled the DUAL patterns inside)
    ("- R2 templates: r766_qa.sh",
     "L.append('- R2 templates: r766_qa.sh + r766_close.sh via the DUAL sed pattern (s/r=765/r=766/g + s/r765/r766/g) - zero mechanical remnants, bash -n green; the round-765 prose gaps (spelled-out Patrol round 765 + the literal Round ID r766 pointer) handled by this surgery pass; wave-9 census taken in the R1 batch.')"),
    # 6. R3
    ("- R3 increment (run-kanban.tsx): the corpus-tier-state title gains",
     "L.append('- R3 increment (run-kanban.tsx): laneRunLetterOf helper inserted after laneCountsOf (same gateCensusOf noJudge gate + the same tried-trace regex, laneTierOf per extracted lane, q/g/m letter, empty when no middle-tier lanes), each run pill gains the letter span (font-medium text-foreground/70, own title documenting the semantics). Two-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).')"),
    # 7. R5
    ("- R5 QA + close: the r766 golden QA",
     "L.append('- R5 QA + close: the r766 golden QA ran GREEN first-try (board probe at the WAVE-9 census 34 runs / 129 ev / 93nj, chips 35; ld count 93, seven lanes, no eighth, qwen pair still 2nd/3rd in the count sort; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (run-card label edited - same view; r756-r766 precedent honored); tier-state probe RECORDED (witnessed bucket 02:00 letter q); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.')"),
    # 8. stage summary line 1
    ("- STEADY SLOT, INSTRUMENT DEEPENS",
     "L.append('- THE LEAN IS THE STORY: three straight qwen waves - the wave-by-wave alternation era is over, the relay is favoring the free routes (or glm is saturated); the cadence band held (57 min inside 13-62) while the route did not. Magnitude +9/+9/+4/+4/+3 - decaying since w5; verdict/uncertain flat eight waves. The run-card letters make the lean visible in the primary scan surface. Watches for wave 10: a g return = the alternation resumes (or load-balancing caught up), an m run = the first both-routes run (investigate), a zero-growth slot = the burst is ending. Snapshot discipline twenty-second close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the run-pill letter census (34 pills, newest three q) + the divergence census, all green.')"),
    # 9. stage summary line 2
    ("- HOVER SCOPING (honest)",
     "L.append('- CANDIDATE DEVIATION (disclosed): the handoff named the builtin box extraction (a) - a pure refactor with no user-facing change, and its own phrasing conditioned it on an Owner ask; this round shipped the letter instrument into the run list instead (the alternation era makes per-run route legibility the highest-value read), leaving the builtin box parked for an explicitly requested refactor round. The extraction regex is shared verbatim with laneCountsOf - one extraction truth, two consumers.')"),
    # 10. pointer promotion (the literal Round ID line the prior surgery wrote)
    ("Round ID: r766 -> next patrol",
     "L.append('Round ID: r767 -> next patrol (job 473388)')"),
    # 11. next recommended action
    ("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r766_qa.sh",
     "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r766_qa.sh sed-adapted (DUAL pattern s/r=766/r=767/g + s/r766/r767/g); remember the round-766 prose gaps (spelled-out Patrol round 766 + the literal Round ID r767 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/run-card view, else RECORDED; tier-state probe: RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: QWEN LEAN confirmed (three straight q, 00:03 + 01:05 + 02:02) - a fourth q cements the lean, a g return = alternation resumed, an m run or m bucket (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a TENTH wave, or an interval-pattern break (band 13 -> 42 -> 62 -> 57 - a gap far outside, or a zero-growth slot) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay LEAN UPDATE (r766): three straight qwen waves (00:03, 01:05, 02:02) after the wave-by-wave alternation - the platform report should describe the lean, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"),
    # 12. blockers
    ("Blockers: none app-side",
     "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the per-run route letters shipped into a live wave-9 read - 34 run pills witnessed with the newest three q - + full golden QA, anchored in scripts/qa_r766.txt and scripts/qa_r766_close.txt).')"),
    # 13. commit message
    ("git commit -m \"r766: tier-state letter history ships",
     "git commit -m \"r766: per-run route letters ship + wave 9 leans qwen. Census 129/34/21/15/93 vs the r765 baseline 126/33/90 - +3 ev / +1 run / +3 nj, newest ~02:02:18 UTC, ~57 min after wave 8 (back inside the band); verdict/uncertain flat eight waves. Live tier-state read: bucket 10-30 02:00 letter q - a THIRD straight qwen wave (00:03, 01:05, 02:02): the wave-by-wave alternation era is over, the relay leans toward the free routes. Increment: laneRunLetterOf (same tried-trace extraction as laneCountsOf + laneTierOf per run; q/g/m, an m run = the both-routes investigate signal) rendering on every corpus run pill - acceptance witnessed live: 34 pills, tails evq/evq/evq/evg/evg, the run list is now the wave-route history (handoff candidate (a) builtin-box refactor deferred: pure refactor, Owner-ask gated). Snapshot discipline twenty-second close.\""),
]


def main():
    with open(PATH, 'r', encoding='utf-8') as f:
        lines = f.read().split('\n')
    out = list(lines)
    ok = True
    for anchor, new in REPL:
        hits = [i for i, ln in enumerate(out) if anchor in ln]
        if len(hits) != 1:
            print('ASSERT FAIL: %r -> %d hits' % (anchor[:70], len(hits)))
            ok = False
            continue
        out[hits[0]] = new
    if not ok:
        print('file untouched')
        sys.exit(1)
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    print('surgery applied: %d lines rewritten' % len(REPL))


if __name__ == '__main__':
    main()
