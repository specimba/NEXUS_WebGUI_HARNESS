#!/usr/bin/env python3
"""r765 surgery: rewrite the sed-carried r764 prose in r765_close.sh.

Asserted all-or-nothing: every anchor must hit exactly one line; the file
is written only if EVERY replacement passes. Handles the two known prose
gaps (spelled-out 'Patrol round 764' Task line + the literal 'Round ID:
r765' pointer -> promoted to r766) plus the wholesale round-prose rewrite
(header, agent, task, R1/R2/R3/R5, stage summary, handoff, blockers,
commit message)."""
import sys

PATH = '/home/z/my-project/scripts/r765_close.sh'

REPL = [
    # 1. header comment
    ("# r765 close (tier-state letter tag",
     "# r765 close (tier-state letter history + steady watch): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - tier-state title edited, same view) -> tier-state probe (recorded - hover now carries the letter history) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - both routes may hold diamonds while routes hand off) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep"),
    # 2. agent line
    ("Agent: NEXUS patrol (main agent - job 473388, 09:07 slot",
     "L.append('Agent: NEXUS patrol (main agent - job 473388, 09:37 slot; opened on the r764 handoff - HEAD 2625b044e = the r764 ship + sweep from the 09:07 slot, own-session lineage, no parallel round closed)')"),
    # 3. task line (spelled-out round gap)
    ("L.append('Task: Patrol round 764 - WAVE 8 RETURNS",
     "L.append('Task: Patrol round 765 - LETTER HISTORY SHIPS, QUIET OPEN: the opening ro-SQL census read 126 ev / 33 runs / 90 nj - IDENTICAL to the r764 close census (newest ~01:05:10 UTC, wave 8); no wave 9 at open, ~32 min quiet (within the stretching 13-62 min band). Shipped the r764-handoff candidate (a): the per-bucket letter history in the tier-state title - the hover now lists the route letter of each shown strip bucket oldest first (e.g. 10-29 22:00 g - 10-29 22:45 q - ... - 10-30 01:00 q), a dash = no middle-tier rows there; the visible tier-state tag gained the font-medium text-foreground/70 treatment for consistency with the strip letters (styling polish), textContent byte-identical so the recorded probe format is unchanged.')"),
    # 4. R1
    ("- R1 open probes: no parallel session - HEAD 759b9dd3a",
     "L.append('- R1 open probes: no parallel session - HEAD 2625b044e was the r764 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 126/33/21/15/90 - FLAT vs the r764 close, no wave 9 at open (~32 min quiet, newest ~01:05:10 UTC) -> steady-watch path with the letter-history increment.')"),
    # 5. R2 (double-sed garbled the DUAL patterns inside)
    ("- R2 templates: r765_qa.sh",
     "L.append('- R2 templates: r765_qa.sh + r765_close.sh via the DUAL sed pattern (s/r=764/r=765/g + s/r764/r765/g) - zero mechanical remnants, bash -n green; the round-764 prose gaps (spelled-out Patrol round 764 + the literal Round ID r765 pointer) handled by this surgery pass; wave-9 census taken in the R1 batch.')"),
    # 6. R3
    ("- R3 increment (run-kanban.tsx): the corpus-tier-state span gains",
     "L.append('- R3 increment (run-kanban.tsx): the corpus-tier-state title gains the letter-history sentence (waveStrip.shown + waveStrip.route joined oldest first, dash for buckets without middle-tier rows), the visible bucket tag restructured into its own span with the font-medium text-foreground/70 treatment matching the strip letters. Two-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).')"),
    # 7. R5
    ("- R5 QA + close: the r765 golden QA",
     "L.append('- R5 QA + close: the r765 golden QA ran GREEN first-try (board probe at the steady wave-8 census 33 runs / 126 ev / 90nj, chips 34; ld count 90, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (tier-state title edited - same view; r756-r765 precedent honored); tier-state probe RECORDED (the hover carries the letter history); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.')"),
    # 8. stage summary line 1
    ("- QWEN HOLDS: two consecutive qwen waves",
     "L.append('- STEADY SLOT, INSTRUMENT DEEPENS: the quiet open is itself a datapoint - the gap band has stretched 13 -> 42 -> 62 and wave 9 is pending past ~32 min; the letter history turns the tier-state hover into the single-glance alternation story (route sequence readable without cross-reading the strip). Watches armed for wave 9: a third straight q = a lean toward the free routes, a flip back to g = alternation restored, an m bucket or a both-silent bucket = investigate. Snapshot discipline twenty-first close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')"),
    # 9. stage summary line 2
    ("- LETTER-IN-TIER-STATE (scoping note)",
     "L.append('- HOVER SCOPING (honest): the letter history mirrors the strip shown-window (last 6 buckets) - it is a convenience read of the same data, not a new source; the recorded probe text is unchanged (textContent byte-identical), so the wave-strip probe format and the tally assertions hold. No forward corrections owed this round.')"),
    # 10. pointer promotion (the literal Round ID line the prior surgery wrote)
    ("Round ID: r765 -> next patrol",
     "L.append('Round ID: r766 -> next patrol (job 473388)')"),
    # 11. next recommended action
    ("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r765_qa.sh",
     "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r765_qa.sh sed-adapted (DUAL pattern s/r=765/r=766/g + s/r765/r766/g); remember the round-765 prose gaps (spelled-out Patrol round 765 + the literal Round ID r766 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend view, else RECORDED; tier-state probe: RECORDED ONLY (hover carries the letter history since r765); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: alternation broken (qwen held twice, 00:03 + 01:05); a third straight q wave = a lean toward the free routes, a flip back to g = alternation restored; the first m bucket (both routes, amber, 7 lanes) or a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NINTH wave, or an interval-pattern break (band 13 -> 42 -> 62 and stretching - a gap far beyond ~62, or a sudden collapse back to ~13 after two long ones) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) if the Owner wants a refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay alternation + first pattern break (qwen held twice, 00:03 + 01:05) - describe the alternation and its break, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')"),
    # 12. blockers
    ("Blockers: none app-side",
     "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the letter history shipped into a live steady-watch + full golden QA, anchored in scripts/qa_r765.txt and scripts/qa_r765_close.txt).')"),
    # 13. commit message
    ("git commit -m \"r765: tier-state letter tag ships",
     "git commit -m \"r765: tier-state letter history ships + quiet open. Census 126/33/21/15/90 - IDENTICAL to the r764 close (newest ~01:05:10 UTC, wave 8); ~32 min quiet at open, within the stretching 13-62 min band. Increment (r764-handoff candidate a): the per-bucket letter history in the tier-state title (shown strip buckets oldest first, dash = no middle-tier rows) - the alternation story reads in one hover; the visible bucket tag gained the font-medium treatment matching the strip letters (styling polish), textContent byte-identical so the recorded probe format is unchanged. QA GREEN first-try at the steady census. Snapshot discipline twenty-first close.\""),
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
