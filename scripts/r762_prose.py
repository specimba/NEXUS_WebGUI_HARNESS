#!/usr/bin/env python3
"""r762 close-script surgery: rewrite the sed-carried r761 prose for the
bucket-bounds hover + wave-7 route-flip round (+ the r761 silence-claim
forward correction). Asserted all-or-nothing: every helper asserts exactly
1 hit before mutating; the file is written only if every edit passes.
Known prose gaps handled: the spelled-out 'Patrol round 761' and the
literal 'Round ID: r762' next-round pointer."""

PATH = '/home/z/my-project/scripts/r762_close.sh'
src = open(PATH).read()
out = src.split('\n')
fails = []

def line_index(pred, desc):
    hits = [i for i, l in enumerate(out) if pred(l)]
    if len(hits) != 1:
        fails.append(desc + ': ' + str(len(hits)) + ' hits')
        return -1
    return hits[0]

def replace_line(prefix, new, desc):
    i = line_index(lambda l: l.startswith(prefix), desc)
    if i >= 0:
        out[i] = new

def insert_after(prefix, new_lines, desc):
    i = line_index(lambda l: l.startswith(prefix), desc)
    if i >= 0:
        out[i + 1:i + 1] = new_lines

# --- sanity: sed carry-over must already name r762 where expected ---
for must in ["L.append('Task ID: r762')",
             "L.append('Round ID: r762 -> next patrol (job 473388)')",
             "grep -q 'r762 QA GREEN' scripts/qa_r762.txt"]:
    if src.count(must) != 1:
        fails.append('sanity missing/ambiguous: ' + must)

# --- tier env pair: the R-prefix is uppercase (R760_TIER) so the lowercase
# seds never rotate it - what matters is that export and prose-get agree ---
import re as _re
_exps = _re.findall(r'(R\d+_TIER)="\$TIER"', src)
_gets = _re.findall(r"os\.environ\.get\('(R\d+_TIER)','\(missing\)'\)", src)
if len(_exps) != 1 or len(_gets) != 1:
    fails.append('tier env pair: export=%d prose=%d' % (len(_exps), len(_gets)))
elif _exps[0] != _gets[0]:
    fails.append('tier env name mismatch: %s vs %s' % (_exps[0], _gets[0]))

# --- header comment (line 2) ---
replace_line('# r762 close (',
             '# r762 close (bucket-bounds hover + wave-7 route flip + r761 correction): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - strip title edited, same view) -> tier-state probe (recorded - EXPECTED FLIP: qwen ACTIVE / glm silent) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - both routes may hold diamonds while the tier alternates) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep',
             'header comment')

# --- divergence-probe comment: alternation-era semantics ---
replace_line('# divergence probe (',
             '# divergence probe (r762): RECORDED ONLY - with the middle tier alternating near-per-wave, BOTH routes can hold diamonds (each lags the newest-3 window when the other route holds the latest bucket); the SIGNAL is a diamond on intern/fast-judge/jev = a genuine partial ladder (amber-tone doctrine).',
             'divergence comment')

# --- Round ID pointer: promote r762 -> r763 ---
replace_line("L.append('Round ID: r762 -> next patrol (job 473388)')",
             "L.append('Round ID: r763 -> next patrol (job 473388)')",
             'round id line')

# --- Agent line ---
replace_line("L.append('Agent: NEXUS patrol",
             "L.append('Agent: NEXUS patrol (main agent - job 473388, 08:07 slot; opened on the r761 handoff)')",
             'agent line')

# --- Task line (spelled-out round-761 prose gap) ---
replace_line("L.append('Task: Patrol round 761",
             "L.append('Task: Patrol round 762 - WAVE 7 FLIPS TO QWEN, BUCKET-BOUNDS HOVER SHIPS, r761 SILENCE CLAIM CORRECTED: the opening ro-SQL census read 122 ev / 32 runs / 86 nj vs the r761 close baseline 118/31/21/15/82 - +4 events / +1 run / +4 no-judge rows, newest 00:03:15 UTC (~42 min after wave 6; first 10-30 bucket - crossed midnight UTC); verdict/uncertain flat for the sixth straight wave. Full-trace read (ld lane ORDER shifted in QA - qwen pair moved 2nd/3rd in the count sort - investigated BEFORE narrating per the r758 lesson): wave 7 (run_9faf38f58f90) is QWEN-routed - the free routes returned; the middle tier is ALTERNATING near-per-wave (21:28 glm, 22:09 glm, 22:54 QWEN, 23:07 glm, 23:20 glm, 00:03 QWEN). Shipped the r761-handoff named candidate: bucket-bounds hover on the wave strip - laneBucketsOf tracks per-bucket min/max row epochs, the waveStrip memo passes bounds, each bucket span gains cursor-help + a title with the ACTUAL first/last corpus-row times (the MM-DD bucket key drops the year; the hover recovers it from the row epochs); strip title documents it.')",
             'task line')

# --- R1 line ---
replace_line("L.append('- R1 open probes:",
             "L.append('- R1 open probes: r761 closed by the 07:37 slot (bf51262c7 ship + 300abb085 sweep; mini-bar strip + wave 6); tree clean; server 200; ro-SQL census 122/32/21/15/86 - WAVE 7 (+4 ev / +1 run / +4 nj, newest 00:03:15 UTC, ~42 min after wave 6, first 10-30 bucket) -> wave-round path with the bucket-bounds hover increment.')",
             'r1 line')

# --- R2 line ---
replace_line("L.append('- R2 templates:",
             "L.append('- R2 templates: r762_qa.sh + r762_close.sh via the DUAL sed pattern (s/r=761/r=762/g + s/r761/r762/g) - zero mechanical remnants; the round-761 prose gap (spelled-out Patrol round 761 + the literal Round ID r762 pointer) handled by this surgery pass; wave-7 census taken in the R1 batch.')",
             'r2 line')

# --- R3 line ---
replace_line("L.append('- R3 increment (run-kanban.tsx): the wave strip map replaced",
             "L.append('- R3 increment (run-kanban.tsx): laneBucketsOf signature + body gain bucketBounds (min/max epoch tracked per bucket key in the same pass), return widened, waveStrip memo passes bounds through, each bucket span gains cursor-help + title (Bucket MM-DD HH:MM UTC (15-min slot) - corpus rows actually span YYYY-MM-DD HH:MM:SS to HH:MM:SS UTC), strip title gains the r762 hover sentence. MultiEdit partial-apply anomaly hit AGAIN (edits 1-3 applied, 4-6 skipped on a stale r759-era anchor missing the spread suffix) - tree verified marker-by-marker, the three missing edits re-applied cleanly with the corrected anchor (the anomaly is now a three-round pattern: r760, r762 - always verify markers, never trust the tool ack).')",
             'r3 line')

# --- R5 line ---
replace_line("L.append('- R5 QA + close:",
             "L.append('- R5 QA + close: the r762 golden QA ran GREEN first-try (board probe at the wave-7 census 32 runs / 122 ev / 86nj, chips 33; ld count 86, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). The ld lane ORDER shift (qwen pair 2nd/3rd) triggered the pre-narration trace read that found the flip. Close probes: chip GATED presence / tone recorded; legend GATED (strip title edited - same view; r756-r762 precedent honored); tier-state probe RECORDED (EXPECTED FLIP: mid-qwen ACTIVE / mid-glm silent); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY (both routes may hold diamonds while the tier alternates); + census + snapshot + worklog + commit + dual push.')",
             'r5 line')

# --- Stage Summary ---
replace_line("L.append('- SIX WAVES, ERRATIC CADENCE:",
             "L.append('- THE FLIP WITNESSED + THE RECORD STRAIGHTENED: wave 7 is qwen-routed - the newest bucket (00:00, x4) reads qwen-only, so the tier-state line is expected to read mid-qwen route ACTIVE (2/2) / mid-glm route silent (0/2) at close, the REVERSE of r760/r761; the alternation is near-per-wave and cyclical (glm and qwen hand the tier back and forth), so tier-state flips and diamond handoffs between the two routes are the NORMAL signal now - the instrument semantics were built for exactly this (r759). Cadence: w5->w6 ~13, w6->w7 ~42 min; magnitude +9/+9/+4; verdict/uncertain flat six waves running. Snapshot discipline eighteenth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')",
             'stage summary')

# --- Forward correction line (after Stage Summary) ---
insert_after("L.append('- THE FLIP WITNESSED + THE RECORD STRAIGHTENED:",
             ["L.append('- FORWARD CORRECTION (r762, honest re-read of the full trace): the r761 claim that the qwen free lanes were silent since 21:12 UTC 10-29 was WRONG - run_07a648a13e4e at 22:54:23 UTC (x5 rows, the 22:45 bucket the r761 close strip itself displayed) was QWEN-routed; the tier was never glm-locked, it was alternating wave-by-wave. The on-page instruments were honest (the 22:45 x5 (5 lanes) bucket witnessed it); the r761 prose narrative lagged the instruments. Corrections go forward; the r761 section text is untouched.')"],
             'forward correction insert')

# --- Handoff next-action ---
replace_line("L.append('Next recommended action:",
             "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r762_qa.sh sed-adapted (DUAL pattern s/r=762/r=763/g + s/r762/r763/g); remember the round-762 prose gap (spelled-out Patrol round 762 + the literal Round ID r763 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend view, else RECORDED; tier-state probe: RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED (hover added - text format unchanged); divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH (rewritten for the alternation era): tier-state flips and diamond handoffs between qwen/glm are the NORMAL signal - a flip back to glm, or a BOTH-ROUTES bucket ((N lanes)=7, amber bar), or a BOTH-SILENT bucket (3 lanes = genuine partial ladder - investigate immediately); a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (the classifier labels it unrouted on sight), a VERDICT/UNCERTAIN growth wave, or an EIGHTH wave = new signal. (5) Increment queue: a per-bucket route letter in the strip text (q/g/m suffix derived from which middle-tier routes answered in the bucket - makes the alternation legible in the recorded probe text itself) is the named candidate; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix free-route silence claim RETRACTED (r761 correction): the free routes are ALIVE (22:54 + 00:03 waves qwen-routed) - the relay alternates routes wave-by-wave; the platform report should describe the alternation, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')",
             'handoff line')

# --- Blockers line ---
replace_line("L.append('Blockers: none app-side;",
             "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the bucket-bounds hover shipped into a live seventh wave + the route flip witnessed + full golden QA, anchored in scripts/qa_r762.txt and scripts/qa_r762_close.txt).')",
             'blockers line')

# --- Commit message ---
replace_line('git commit -m "r762: mini-bar wave strip ships',
             'git commit -m "r762: bucket-bounds hover ships + wave 7 flips to qwen + r761 silence claim corrected. Census 122/32/86 vs the r761 baseline 118/31/82 - +4 ev / +1 run / +4 nj, newest 00:03:15 UTC (~42 min after wave 6, first 10-30 bucket); verdict/uncertain flat six waves. Full-trace read: wave 7 is QWEN-routed - the middle tier ALTERNATES near-per-wave (21:28 glm, 22:09 glm, 22:54 QWEN, 23:07 glm, 23:20 glm, 00:03 QWEN); r761 prose claimed qwen silent since 21:12 - WRONG, run_07a648a13e4e (22:54, the 22:45 bucket the strip displayed) was qwen-routed; instruments honest, narrative lagged; corrected forward, r761 text untouched. Increment (r761-handoff named candidate): bucket-bounds hover on the wave strip - laneBucketsOf tracks per-bucket min/max row epochs, bucket spans gain cursor-help + title with actual first/last row times (the MM-DD key drops the year; the hover recovers it); strip title documents. Snapshot discipline eighteenth close."',
             'commit message')

if fails:
    print('SURGERY FAILED - file untouched')
    for f in fails:
        print('  -', f)
    raise SystemExit(1)

open(PATH, 'w').write('\n'.join(out))
print('surgery ok: all asserts passed, r762_close.sh rewritten')
