#!/usr/bin/env python3
"""r757 close-script surgery: asserted, all-or-nothing (write happens only if every assert passes)."""

PATH = '/home/z/my-project/scripts/r757_close.sh'
lines = open(PATH).read().split('\n')


def edit_sub(old, new, tag):
    hits = [i for i, l in enumerate(lines) if old in l]
    assert len(hits) == 1, tag + ': ' + str(len(hits)) + ' hits'
    lines[hits[0]] = lines[hits[0]].replace(old, new)


def replace_line(prefix, new, tag):
    hits = [i for i, l in enumerate(lines) if l.startswith(prefix)]
    assert len(hits) == 1, tag + ': ' + str(len(hits)) + ' hits'
    lines[hits[0]] = new


def insert_after(needle, block, tag):
    hits = [i for i, l in enumerate(lines) if needle in l]
    assert len(hits) == 1, tag + ': ' + str(len(hits)) + ' hits'
    for off, bl in enumerate(block, 1):
        lines.insert(hits[0] + off, bl)


# --- comments + probe block ---
edit_sub(
    '# r757 close (mid-round wave pivot): gates -> QA-green guard -> chip probe (gated) -> legend probe (recorded) -> lane-filter probe (recorded; tally assertion stays gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep',
    '# r757 close (three-wave burst + mini-strip ship): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - chips touched) -> wave-strip probe (gated presence / recorded text) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep',
    'header')

edit_sub(
    '# lane-legend probe (board view; chips UNTOUCHED this round -> RECORDED, the QA ld leg already gates the nj token).',
    '# lane-legend probe (board view; chips WERE touched this round - the increment edits chip titles -> the legend gate runs, r756 precedent).',
    'legend comment')

insert_after(
    "|| { echo 'GUARD legend probe'; exit 1; }",
    [
        '# wave-strip probe (r757 increment): presence GATED (corpus non-empty -> the strip must render), text RECORDED.',
        'STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector(\'[data-testid=\\"corpus-wave-strip\\"]\'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)',
        'echo "wave strip: $STRIP"',
        'echo "$STRIP" | grep -Eq \'strip\\\\?":true\' || { echo \'GUARD wave-strip probe\'; exit 1; }',
    ],
    'strip probe')

edit_sub('R754_LF="$LF"', 'R754_LF="$LF" R754_STRIP="$STRIP"', 'export line')

insert_after(
    "L.append('  lane filter: ' + os.environ.get('R754_LF','(missing)'))",
    ["L.append('  wave strip: ' + os.environ.get('R754_STRIP','(missing)'))"],
    'qa probes strip line')

# --- worklog prose ---
replace_line(
    "L.append('Agent: NEXUS patrol (main agent - job 473388, 05:07 slot",
    "L.append('Agent: NEXUS patrol (main agent - job 473388, 05:37 slot; opened on the r756 handoff verbatim)')",
    'agent')

replace_line(
    "L.append('Task: Patrol round 756",
    "L.append('Task: Patrol round 757 - THREE-WAVE BURST + THE QUEUED MINI-STRIP SHIPS: the R2 ro-SQL census read 96 ev / 27 runs / 60nj vs the r756 close baseline 89/26/21/15/53 (+7 no-judge rows / +1 run, verdict+uncertain unchanged; newest row run_01ed7e7b3ef9 at 21:28:47 UTC, postdating the r756 close) - the THIRD consecutive growth slot, the first three-wave burst on record (both prior bursts were two-wave), so the wave path fired and the r756 increment-queue candidate shipped: laneBucketsOf (per-lane dial attempts AND corpus-wide no-judge rows bucketed into 15-minute UTC slots - fine enough to resolve the 20:16 / ~21:0x / ~21:28 waves separately where hour buckets would merge the last two), a visible wave strip under the lane legend (corpus-wide nj rows by bucket, switching to the filtered lane dials when a lane filter is active, last 6 buckets shown with an older-count disclosed), per-lane bucket lists appended to every chip title, and the legend title documenting the strip semantics. Under the full-ladder shape every no-judge row names every lane, so per-lane bucket profiles coincide with the corpus strip - a lane whose profile DIVERGES is the partial-ladder signal, the strip standing watch value.')",
    'task')

replace_line(
    "L.append('- R1 open probes: r755 closed",
    "L.append('- R1 open probes: r756 closed by the 05:07 slot (a821de161 ship + b0eae32b9 sweep); tree clean; server 200; opened r757 on the r756 handoff verbatim.')",
    'r1')

replace_line(
    "L.append('- R2 templates + census:",
    "L.append('- R2 templates + census: r757_qa.sh + r757_close.sh via the DUAL sed pattern (s/r=756/r=757/g + s/r756/r757/g) - zero r756 remnants (the round-756 prose gap handled by this surgery pass); ro-SQL census 96/27/21/15/60 - THIRD consecutive growth slot (+7 nj / +1 run over the r756 close baseline 89/26/21/15/53), newest row run_01ed7e7b3ef9 at 21:28:47 UTC postdating the r756 close -> the wave path fired per the handoff (three consecutive growth slots = new burst shape) and the queued mini-strip became this round increment.')",
    'r2')

replace_line(
    "L.append('- R3 QA + wave catch:",
    "L.append('- R3 increment (run-kanban.tsx): laneBucketsOf helper (the tried-trace scan with a 15-minute UTC bucket key per row: corpus-wide nj-row counts plus per-lane dial counts in one pass), laneBuckets + waveStrip memos, a visible wave strip between the lane legend and the run pills (data-testid corpus-wave-strip; label and title disclose the last-6-of-N cap and the newest-400-rows window bound), per-lane by-15-min-UTC-bucket lists appended to every chip title, legend title documents the bucket semantics and the divergence signal.')",
    'r3')

replace_line(
    "L.append('- R4 increment (run-kanban.tsx): laneLastSeenOf",
    "L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')",
    'r4')

replace_line(
    "L.append('- R5 gates + QA re-run",
    "L.append('- R5 QA + close: the r757 golden QA ran GREEN with its board probe reading 27 runs / 96 ev / 60nj - exactly matching the R2 census (no latency gap this slot); ld count 60, seven lanes, no EIGHTH lane; console 0 errors. Close probes: chip GATED presence / tone recorded; legend GATED (chips touched - the increment edits chip titles; r756 precedent honored); lane-filter RECORDED with the fixed tally assertion staying GATED; NEW wave-strip probe: presence GATED, text RECORDED; + census + snapshot + worklog + commit + dual push.')",
    'r5')

replace_line(
    "L.append('- TWO CONSECUTIVE GROWTH SLOTS",
    "L.append('- THREE-WAVE BURST confirmed: cadence record now growth r749->r750, r750->r751, steady r751->r754, wave r754->r755, wave r755->r756, wave r756->r757 - the first three-slot burst on record (both prior bursts were two-wave), with escalating magnitude (+3, +4, +7 no-judge rows) and accelerating intervals (w1 20:16, w2 ~21:0x, w3 21:28 UTC). The dials-over-time mini-strip shipped INTO the third wave: the corpus strip renders the burst as 15-minute UTC buckets on-page, per-lane bucket lists live in the chip titles, and under the full-ladder shape the per-lane profiles coincide with the corpus strip - divergence is now watchable on-page as the partial-ladder signal. Seven lanes re-verified via the ld leg; no EIGHTH lane. Snapshot discipline thirteenth close. Witness six-legged (board, ld, chip, legend, lane filter, wave strip), all legs green.')",
    'stage')

replace_line(
    "L.append('Round ID: r757 -> next patrol (job 473388)')",
    "L.append('Round ID: r758 -> next patrol (job 473388)')",
    'round id')

replace_line(
    "L.append('Next recommended action: (1) NORMAL WATCH",
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r757_qa.sh sed-adapted (DUAL pattern s/r=757/r=758/g + s/r757/r758/g); remember the round-757 prose gap (third explicit edit in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the chips, else RECORDED; wave-strip probe (r757 precedent): presence GATED / text RECORDED; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; BUCKET DIVERGENCE is the new on-page instrument - a lane whose 15-min bucket profile diverges from the corpus strip = the partial-ladder signal; a NEW lane (outlier first-seen) = the broadening signal; any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal; a FOURTH consecutive growth slot would extend the unprecedented three-wave burst (w1 20:16, w2 ~21:0x, w3 21:28 UTC - intervals ~50 then ~28 min, accelerating). (5) Increment queue: a per-bucket lane-divergence auto-highlight (amber the chip whose bucket profile lags the corpus) is the named candidate; pure watch is legitimate while steady; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')",
    'next action')

replace_line(
    "L.append('Blockers: none app-side",
    "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the dials-over-time mini-strip shipped into a live third wave + full golden QA, anchored in scripts/qa_r757.txt and scripts/qa_r757_close.txt).')",
    'blockers')

replace_line(
    'git commit -m "r757: mid-round wave pivot',
    'git commit -m "r757: three-wave burst + the queued mini-strip ships - R2 census 96/27/21/15/60 vs r756 baseline 89/26/21/15/53 (+7 nj / +1 run, newest 21:28:47 UTC) = the THIRD consecutive growth slot, the first three-wave burst on record (both prior bursts were two-wave; magnitude escalating +3/+4/+7, intervals accelerating). Shipped laneBucketsOf (per-lane dials + corpus-wide nj rows in 15-minute UTC buckets), a visible wave strip under the lane legend (corpus-wide by default, filtered lane dials when a filter is active, last-6-of-N cap disclosed), per-lane bucket lists in every chip title, legend title bucket semantics. Under the full-ladder shape per-lane profiles coincide with the corpus strip - divergence = the partial-ladder signal, now watchable on-page. Wave-strip probe: presence GATED / text RECORDED. Snapshot discipline thirteenth close."',
    'commit')

open(PATH, 'w').write('\n'.join(lines))
print('surgery ok: all asserts passed, file written')
