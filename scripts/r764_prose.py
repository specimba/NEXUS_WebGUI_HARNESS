#!/usr/bin/env python3
"""r764 surgery: rewrite the sed-carried r763 prose in r764_close.sh.

Asserted all-or-nothing: every anchor must hit exactly one line; the file
is written only if EVERY replacement passes. Handles the two known prose
gaps (spelled-out 'Patrol round 763' Task line + the literal 'Round ID:
r764' pointer -> promoted to r765) plus the wholesale round-prose rewrite
(header, agent, task, R1/R2/R3/R5, stage summary, handoff, blockers,
commit message)."""
import sys

PATH = '/home/z/my-project/scripts/r764_close.sh'

REPL = [
    # 1. header comment
    ("# r764 close (per-bucket route letters",
     "# r764 close (tier-state letter tag + wave 8 qwen-holds): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - tier-state text edited, same view) -> tier-state probe (recorded - now carries the newest-bucket letter; witnessed q at ship time) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - both routes may hold diamonds while routes hand off) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep"),
    # 2. agent line
    ("Agent: NEXUS patrol (main agent - job 473388, 08:37 slot",
     "L.append('Agent: NEXUS patrol (main agent - job 473388, 09:07 slot; opened on the r763 handoff - HEAD 759b9dd3a = the r763 ship + sweep from the 08:37 slot, own-session lineage, no parallel round closed)')"),
    # 3. task line (spelled-out round gap)
    ("L.append('Task: Patrol round 763 - ROUTE LETTERS SHIP",
     "L.append('Task: Patrol round 764 - WAVE 8 RETURNS, QWEN HOLDS THE TIER, TIER-STATE LETTER TAG SHIPS: the opening ro-SQL census read 126 ev / 33 runs / 90 nj vs the r763 close baseline 122/32/21/15/86 - +4 events / +1 run / +4 no-judge rows, newest ~01:05:10 UTC, ~62 min after wave 7 - the LONGEST gap yet, marginally past the prior 58-min max (w4->w5); verdict/uncertain flat for the SEVENTH straight wave. The route: a live tier-state read witnesses bucket 10-30 01:00 letter q - mid-qwen ACTIVE (2/2) / mid-glm silent (0/2) - so wave 8 is QWEN-routed BACK-TO-BACK with wave 7: the first same-route repeat since the alternation began (glm, glm, qwen, glm, glm, qwen, qwen) - the near-per-wave alternation has BROKEN in favor of qwen (amber-tone: a pattern change, not a fault; the eighth-lane and both-silent watches stay armed). Shipped the r763-handoff candidate (a): the newest-bucket letter surfaced in the tier-state line - the line now opens with a (bucket MM-DD HH:MM - letter) tag before the per-route figures, corpus-wide semantics matching what the line already measured; title documents the q/g/m legend and the absent-means-no-middle-rows edge. The ship-time live read doubled as the acceptance witness.')"),
    # 4. R1
    ("- R1 open probes: r762 closed by the 08:07 slot",
     "L.append('- R1 open probes: no parallel session - HEAD 759b9dd3a was the r763 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 126/33/21/15/90 - WAVE 8 (+4 ev / +1 run / +4 nj, newest ~01:05:10 UTC, ~62 min after wave 7, longest gap yet) -> wave-round path with the tier-state letter-tag increment.')"),
    # 5. R2 (double-sed garbled the DUAL patterns inside)
    ("- R2 templates: r764_qa.sh",
     "L.append('- R2 templates: r764_qa.sh + r764_close.sh via the DUAL sed pattern (s/r=763/r=764/g + s/r763/r764/g) - zero mechanical remnants, bash -n green; the round-763 prose gaps (spelled-out Patrol round 763 + the literal Round ID r764 pointer) handled by this surgery pass; wave-8 census taken in the R1 batch.')"),
    # 6. R3
    ("- R3 increment (run-kanban.tsx): the waveStrip memo gains",
     "L.append('- R3 increment (run-kanban.tsx): the corpus-tier-state span gains the letter prefix (bucket key + q/g/m read from waveStrip.route[laneTiers.lastKey], rendered before the per-route ACTIVE/silent figures; omitted honestly when the newest bucket holds no middle-tier rows), title gains the q/g/m legend sentence. Two-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).')"),
    # 7. R5
    ("- R5 QA + close: the r764 golden QA",
     "L.append('- R5 QA + close: the r764 golden QA ran GREEN first-try (board probe at the WAVE-8 census 33 runs / 126 ev / 90nj, chips 34; ld count 90, seven lanes, no eighth, qwen pair 2nd/3rd in the count sort - the same order the wave-7 QA showed, consistent with a second qwen wave; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (tier-state text edited - same view; r756-r764 precedent honored); tier-state probe RECORDED (the letter tag is IN the recorded text now); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.')"),
    # 8. stage summary line 1
    ("- THE ALTERNATION GETS ITS LETTER",
     "L.append('- QWEN HOLDS: two consecutive qwen waves (00:03 + 01:05) break the near-per-wave alternation - the route sequence now reads glm, glm, qwen, glm, glm, qwen, qwen; whether this is a lean toward the free routes or noise needs wave 9 (the strip letters + the tier-state letter tag make that read one glance). Cadence: w6->w7 ~42, w7->w8 ~62 min - the gap band is stretching upward (13 -> 42 -> 62); magnitude +9/+9/+4/+4; verdict/uncertain flat seven waves. Snapshot discipline twentieth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')"),
    # 9. stage summary line 2
    ("- LETTER SEMANTICS (honest scoping)",
     "L.append('- LETTER-IN-TIER-STATE (scoping note): the tag reads the corpus-wide waveStrip.route for the newest bucket, matching the corpus semantics the tier-state line already had (it never was filter-aware); in lane-filter mode the strip letters drop but the tier-state tag stays - both are corpus truth by design. An m tag (both routes answered) or an ABSENT tag on a fresh bucket with both routes silent = the investigate-immediately signal (genuine partial ladder). No forward corrections owed this round.')"),
    # 10. pointer promotion (the literal Round ID line the prior surgery wrote)
    ("Round ID: r764 -> next patrol",
     "L.append('Round ID: r765 -> next patrol (job 473388)')"),
    # 11. next recommended action
    ("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r764_qa.sh",
     "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r764_qa.sh sed-adapted (DUAL pattern s/r=764/r=765/g + s/r764/r765/g); remember the round-764 prose gaps (spelled-out Patrol round 764 + the literal Round ID r765 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend view, else RECORDED; tier-state probe: RECORDED ONLY (carries the newest-bucket letter since r764); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the alternation is BROKEN (qwen held twice, 00:03 + 01:05) - a third straight qwen wave = a lean toward the free routes, a flip back to glm = alternation restored; the first m bucket (both routes, amber, 7 lanes) or a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NINTH wave, or an interval-pattern break (the band is stretching: 13 -> 42 -> 62 min - a gap far beyond ~62, or a sudden collapse back to ~13 after two long ones) = new signal. (5) Increment queue: no named candidate - candidates: (a) a per-bucket route history in the tier-state title (the letter sequence of the shown strip buckets, one glance beyond the newest) if the Owner wants the alternation story legible in one hover; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay alternation UPDATE (r764): qwen held twice back-to-back (00:03 + 01:05) - the platform report should describe the alternation AND its first pattern break, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"),
    # 12. blockers
    ("Blockers: none app-side",
     "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the tier-state letter tag shipped into a live wave-8 read - bucket 01:00 letter q witnessed at ship time - + full golden QA, anchored in scripts/qa_r764.txt and scripts/qa_r764_close.txt).')"),
    # 13. commit message
    ("git commit -m \"r764: per-bucket route letters ship",
     "git commit -m \"r764: tier-state letter tag ships + wave 8 returns, qwen holds. Census 126/33/21/15/90 vs the r763 baseline 122/32/86 - +4 ev / +1 run / +4 nj, newest ~01:05:10 UTC, ~62 min after wave 7 (longest gap yet, past the prior 58-max); verdict/uncertain flat seven waves. Live tier-state read: bucket 10-30 01:00 letter q, mid-qwen ACTIVE (2/2) / mid-glm silent (0/2) - wave 8 is QWEN-routed back-to-back with wave 7: the first same-route repeat of the alternation era (glm, glm, qwen, glm, glm, qwen, qwen). Increment (r763-handoff candidate a): the newest-bucket letter (q/g/m) surfaced in the tier-state line, corpus-wide semantics, title documents the legend + the absent-means-no-middle-rows edge; the ship-time read doubled as the acceptance witness. Snapshot discipline twentieth close.\""),
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
