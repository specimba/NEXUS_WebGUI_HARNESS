#!/usr/bin/env python3
"""r763 surgery: rewrite the sed-carried r762 prose in r763_close.sh.

Asserted all-or-nothing: every anchor must hit exactly one line; the file
is written only if EVERY replacement passes. Handles the two known prose
gaps (spelled-out 'Patrol round 762' Task line + the literal 'Round ID:
r763' pointer -> promoted to r764) plus the wholesale round-prose rewrite
(header, agent, task, R1/R2/R3/R5, stage summary, handoff, blockers,
commit message)."""
import sys

PATH = '/home/z/my-project/scripts/r763_close.sh'

REPL = [
    # 1. header comment
    ("# r763 close (bucket-bounds hover",
     "# r763 close (per-bucket route letters q/g/m + wave-8 watch): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - strip text edited, same view) -> tier-state probe (recorded - newest corpus bucket decides; qwen held it at open) -> wave-strip probe (gated presence / recorded text - now carries the route letters) -> divergence probe (RECORDED - both routes may hold diamonds while the tier alternates) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep"),
    # 2. agent line
    ("Agent: NEXUS patrol (main agent - job 473388, 08:07 slot",
     "L.append('Agent: NEXUS patrol (main agent - job 473388, 08:37 slot; opened on the r762 handoff - r762 found ALREADY CLOSED by the 08:07 slot, so this slot ran as r763)')"),
    # 3. task line (spelled-out round gap)
    ("L.append('Task: Patrol round 762 - WAVE 7 FLIPS",
     "L.append('Task: Patrol round 763 - ROUTE LETTERS SHIP, WAVE 8 PENDING: the opening ro-SQL census read 122 ev / 32 runs / 86 nj - IDENTICAL to the r762 close census (newest 00:03:15 UTC, wave 7); no wave 8 at open, the corpus ~34 min quiet (not yet an interval break - the max observed gap is ~58 min, w4->w5). Shipped the r762-handoff named candidate: per-bucket route letters in the wave strip text - q = qwen-only, g = glm-only, m = both middle-tier routes answered, derived from laneTierOf over the same laneBuckets scan (single dependency kept), corpus-mode only (a lane-filtered strip is about one lane, not the relay); the letter is styled font-medium text-foreground/70 (styling detail polish) and the strip title documents the q/g/m legend. The wave-by-wave relay alternation is now legible in the recorded probe text itself.')"),
    # 4. R1
    ("- R1 open probes: r761 closed by the 07:37 slot",
     "L.append('- R1 open probes: r762 closed by the 08:07 slot (d461ccdd7 ship + 973d0d5f6 sweep; bucket-bounds hover + wave 7 qwen flip + the r761 correction); tree clean; server 200; ro-SQL census 122/32/21/15/86 - FLAT vs the r762 close, no wave 8 at open (~34 min quiet, newest 00:03:15 UTC) -> steady-watch path with the route-letter increment.')"),
    # 5. R2 (double-sed garbled the DUAL patterns inside)
    ("- R2 templates: r763_qa.sh",
     "L.append('- R2 templates: r763_qa.sh + r763_close.sh via the DUAL sed pattern (s/r=762/r=763/g + s/r762/r763/g) - zero mechanical remnants, bash -n green; the round-762 prose gaps (spelled-out Patrol round 762 + the literal Round ID r763 pointer) handled by this surgery pass; wave-8 census taken in the R1 batch.')"),
    # 6. R3
    ("- R3 increment (run-kanban.tsx): laneBucketsOf",
     "L.append('- R3 increment (run-kanban.tsx): the waveStrip memo gains the route computation (per bucket key: sum middle-tier lane counts per route via laneTierOf, q/g/m letter, empty when no middle-tier rows answered), return widened with route, the bucket label span gains the letter (corpus mode only, styled font-medium text-foreground/70), strip title gains the q/g/m legend sentence. Single MultiEdit, all three edits verified applied in the returned diff this time (r760/r762 marker-verify discipline honored).')"),
    # 7. R5
    ("- R5 QA + close: the r763 golden QA",
     "L.append('- R5 QA + close: the r763 golden QA ran GREEN first-try (board probe at the wave-7 census 32 runs / 122 ev / 86nj, chips 33; ld count 86, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (strip text edited - same view; r756-r763 precedent honored); tier-state probe RECORDED (newest bucket still 00:00 qwen-only at open - mid-qwen ACTIVE / mid-glm silent expected unless wave 8 lands mid-round); wave-strip probe presence GATED / text RECORDED - the text now carries q/g/m letters per bucket; divergence probe RECORDED ONLY (both routes may hold diamonds while the tier alternates); + census + snapshot + worklog + commit + dual push.')"),
    # 8. stage summary line 1
    ("- THE FLIP WITNESSED",
     "L.append('- THE ALTERNATION GETS ITS LETTER: the route watch no longer needs the tier-state line cross-read - each strip bucket now self-describes its route composition (q/g/m) in plain text, so the recorded probe itself witnesses the relay alternation wave-by-wave. Cadence at open: corpus flat ~34 min since wave 7 (intervals w5->w6 ~13, w6->w7 ~42; max observed ~58) - a quiet opening is a datapoint, not a break; the close census re-reads. Route watch unchanged: flips normal, an m bucket (both routes, amber bar, 7 lanes) and a BOTH-SILENT bucket (3 lanes = genuine partial ladder) are the signals to investigate. Snapshot discipline nineteenth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')"),
    # 9. stage summary line 2 (r762 forward-correction note -> r763 semantics note)
    ("- FORWARD CORRECTION (r763",
     "L.append('- LETTER SEMANTICS (honest scoping): the letter is corpus-wide by design - it names which middle-tier routes answered in the bucket, not which lane a filtered view follows; in lane-filter mode the letters drop (the strip is about one lane there). An m-letter sighting would be the first witnessed both-routes bucket; none appeared at ship time (newest buckets: 00:00 qwen-only x4). No forward corrections owed this round - the r762 alternation narrative already matches the instruments.')"),
    # 10. pointer promotion (the literal Round ID line the prior surgery wrote)
    ("Round ID: r763 -> next patrol",
     "L.append('Round ID: r764 -> next patrol (job 473388)')"),
    # 11. next recommended action
    ("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r763_qa.sh",
     "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r763_qa.sh sed-adapted (DUAL pattern s/r=763/r=764/g + s/r763/r764/g); remember the round-763 prose gaps (spelled-out Patrol round 763 + the literal Round ID r764 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend view, else RECORDED; tier-state probe: RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED (text carries q/g/m letters since r763 - the recorded read IS the alternation witness); divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH (alternation era): tier-state flips, diamond handoffs, and the strip letters are the NORMAL signal - the first m bucket (both routes, amber, 7 lanes) or a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, an EIGHTH wave, or an interval-pattern break (gap far outside the 13-58 min band) = new signal. (5) Increment queue: no named candidate this handoff - candidates: (a) surfacing the newest-bucket letter in the tier-state line (mid-qwen ACTIVE (2/2) - letter q) if the Owner wants one-glance consistency; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay alternates routes wave-by-wave (glm/qwen handoffs witnessed r762) - describe the alternation, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"),
    # 12. blockers
    ("Blockers: none app-side",
     "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the route letters shipped into a live wave-8 watch + full golden QA, anchored in scripts/qa_r763.txt and scripts/qa_r763_close.txt).')"),
    # 13. commit message
    ("git commit -m \"r763: bucket-bounds hover ships",
     "git commit -m \"r763: per-bucket route letters ship (q/g/m) + wave 8 pending. Opening census 122/32/21/15/86 - IDENTICAL to the r762 close (newest 00:03:15 UTC, wave 7); corpus ~34 min quiet at open, not yet an interval break (max observed gap ~58 min). Increment (r762-handoff named candidate): per-bucket route letter in the wave strip text - q = qwen-only, g = glm-only, m = both middle-tier routes answered per 15-min bucket, derived from laneTierOf over the same laneBuckets scan, corpus-mode only; letter styled font-medium text-foreground/70 (styling polish); strip title documents the legend. The wave-by-wave relay alternation is now legible in the recorded probe text itself. QA GREEN first-try at the wave-7 census (32/122/86nj, seven lanes). Snapshot discipline nineteenth close.\""),
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
