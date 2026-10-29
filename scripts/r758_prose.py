#!/usr/bin/env python3
"""r758 close-script surgery: asserted, all-or-nothing (write happens only if every assert passes)."""

PATH = '/home/z/my-project/scripts/r758_close.sh'
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
    '# r758 close (three-wave burst + mini-strip ship): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - chips touched) -> wave-strip probe (gated presence / recorded text) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep',
    '# r758 close (mid-round wave pivot - divergence debuts into wave 4): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - chips touched) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - zero is correct) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep',
    'header')

edit_sub(
    '# lane-legend probe (board view; chips WERE touched this round - the increment edits chip titles -> the legend gate runs, r756 precedent).',
    '# lane-legend probe (board view; chips WERE touched this round - the increment edits chip faces -> the legend gate runs, r756/r757 precedent).',
    'legend comment')

insert_after(
    "|| { echo 'GUARD wave-strip probe'; exit 1; }",
    [
        '# divergence probe (r758 increment): RECORDED ONLY - zero diamonds is the CORRECT muted state under the full-ladder shape (amber-tone doctrine).',
        'DIV=$(timeout 30 agent-browser eval "(() => { const d=[...document.querySelectorAll(\'[data-testid=\\"corpus-lane-legend\\"] [data-div=\\"1\\"]\')]; return JSON.stringify({divBadges:d.length}); })()" 2>&1 | tail -1)',
        'echo "divergence: $DIV"',
    ],
    'divergence probe')

edit_sub('R754_STRIP="$STRIP"', 'R754_STRIP="$STRIP" R758_DIV="$DIV"', 'export line')

insert_after(
    "L.append('  wave strip: ' + os.environ.get('R754_STRIP','(missing)'))",
    ["L.append('  divergence: ' + os.environ.get('R758_DIV','(missing)'))"],
    'qa probes div line')

# --- worklog prose ---
replace_line(
    "L.append('Agent: NEXUS patrol (main agent - job 473388, 05:37 slot",
    "L.append('Agent: NEXUS patrol (main agent - job 473388, 06:07 slot; opened on the r757 handoff verbatim)')",
    'agent')

replace_line(
    "L.append('Task: Patrol round 757",
    "L.append('Task: Patrol round 758 - MID-ROUND WAVE PIVOT, THE DIVERGENCE INSTRUMENT DEBUTS INTO A LIVE FOURTH WAVE: the R2 ro-SQL census read 96/27/21/15/60 - EXACTLY the r757 close baseline (newest row 21:28:47 UTC) - and the steady-slot path was taken with the r757 handoff named candidate (the divergence auto-highlight) shipping pre-armed; by the R5 golden QA the live board read 100 ev / 28 runs / 64nj (+4 no-judge rows / +1 run; run_918b2b94af40 at 22:09:21 UTC, ~1 min after the R2 read) - a FOURTH consecutive growth slot landed between the R2 read and QA, extending the unprecedented burst to four waves (the r756 census-latency lesson repeated verbatim). Shipped: laneDivergenceOf (each lane 15-min bucket profile vs the corpus strip over the LAST 3 buckets; a lag = the partial-ladder signal), amber divergence diamonds on chip faces (data-div=1, aria-labeled), bucket detail in chip titles, legend title doc. Zero diamonds on-page under the full-ladder shape is the CORRECT muted state - the instrument debuted muted and correct, into the wave it was pre-armed for.')",
    'task')

replace_line(
    "L.append('- R1 open probes: r756 closed",
    "L.append('- R1 open probes: r757 closed by the 05:37 slot (95c787277 ship + 6bdbb3f61 sweep); tree clean; server 200; opened r758 on the r757 handoff verbatim.')",
    'r1')

replace_line(
    "L.append('- R2 templates + census:",
    "L.append('- R2 templates + census: r758_qa.sh + r758_close.sh via the DUAL sed pattern (s/r=757/r=758/g + s/r757/r758/g) - zero r757 remnants (the round-757 prose gap handled by this surgery pass); ro-SQL census 96/27/21/15/60 STEADY (exact baseline match, newest 21:28:47 UTC) -> steady-slot path taken with the divergence instrument pre-armed; wave 4 landed at 22:09:21 UTC, ~1 min after the read (caught by the R5 QA).')",
    'r2')

replace_line(
    "L.append('- R3 increment (run-kanban.tsx): laneBucketsOf",
    "L.append('- R3 increment (run-kanban.tsx): laneDivergenceOf helper (last-3-corpus-buckets comparison; per-lane lag list with x-of-x detail per bucket), laneDivergence memo, amber divergence diamond span on the chip face (data-div=1, aria-label, title carries the divergent buckets), chip title gains the DIVERGES-from-corpus clause, legend title documents the diamond semantics and the pre-arm rationale.')",
    'r3')

replace_line(
    "L.append('- R4 gates:",
    "L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')",
    'r4')

replace_line(
    "L.append('- R5 QA + close:",
    "L.append('- R5 QA + close: the r758 golden QA ran GREEN and its board probe caught WAVE 4 live: 28 runs / 100 ev / 64nj (+4 nj / +1 run vs the R2 read, FOURTH consecutive growth slot); ld count 64, seven lanes, no EIGHTH lane; console 0 errors. Close probes: chip GATED presence / tone recorded; legend GATED (chips touched - the increment edits chip faces; r756/r757 precedent honored); wave-strip probe presence GATED / text RECORDED (r757 precedent); divergence probe RECORDED ONLY (zero diamonds correct under the full-ladder shape - the amber-tone doctrine); + census + snapshot + worklog + commit + dual push.')",
    'r5')

replace_line(
    "L.append('- THREE-WAVE BURST confirmed:",
    "L.append('- FOUR-WAVE BURST, the new cadence record: growth r749->r750, r750->r751, steady r751->r754, wave r754->r755, wave r755->r756, wave r756->r757, wave r757->r758 - magnitude now +3/+4/+7/+4, wave times 20:16 / 21:12 / 21:28 / 22:09 UTC (intervals ~56 / ~16 / ~41 min). The r758 slot nearly masqueraded as steady: the R2 read at ~22:08 UTC matched the baseline exactly and wave 4 landed ~1 min later - the r756 census-latency lesson repeated verbatim (an R2 ro-SQL read can be stale within minutes; the QA board probe is the truer instrument). The divergence auto-highlight DEBUTED into the wave it was pre-armed for: zero diamonds is the correct muted state under the full-ladder shape (per-lane bucket counts equal corpus counts); the instrument now stands watch for the first partial ladder. Seven lanes re-verified via the ld leg; no EIGHTH lane. Snapshot discipline fourteenth close. Witness six-legged (board, ld, chip, legend, lane filter, wave strip) + the divergence census, all green.')",
    'stage')

replace_line(
    "L.append('Round ID: r758 -> next patrol (job 473388)')",
    "L.append('Round ID: r759 -> next patrol (job 473388)')",
    'round id')

replace_line(
    "L.append('Next recommended action: (1) NORMAL WATCH",
    "L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r758_qa.sh sed-adapted (DUAL pattern s/r=758/r=759/g + s/r758/r759/g); remember the round-758 prose gap (third explicit edit in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the chips, else RECORDED; wave-strip probe (r757 precedent): presence GATED / text RECORDED; divergence probe (r758 precedent): RECORDED ONLY - gate nothing, zero diamonds is correct; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; DIVERGENCE DIAMONDS are live - any diamond = the partial-ladder signal, investigate immediately (which lane lags, which bucket, what answered); a NEW lane (outlier first-seen) = the broadening signal; any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal; a FIFTH consecutive growth slot would extend the four-wave burst again; also watch the interval pattern (w1->w2 ~56 min, w2->w3 ~16 min, w3->w4 ~41 min - no simple period). (5) Increment queue: per-bucket mini-bar rendering (CSS bars replacing the text strip) is the styling-polish candidate; divergence-first if any diamond fires; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')",
    'next action')

replace_line(
    "L.append('Blockers: none app-side",
    "L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the divergence instrument shipped pre-armed and debuted into a live fourth wave + full golden QA, anchored in scripts/qa_r758.txt and scripts/qa_r758_close.txt).')",
    'blockers')

replace_line(
    'git commit -m "r758: three-wave burst',
    'git commit -m "r758: mid-round wave pivot - the divergence instrument debuts into a live fourth wave. R2 read steady (96/27/21/15/60, exactly the r757 baseline, newest 21:28:47 UTC) but the R5 QA board probe caught wave 4 live (100 ev / 28 runs / 64nj; run_918b2b94af40 22:09:21 UTC, ~1 min after the read) - the FOURTH consecutive growth slot, extending the record burst to four waves (+3/+4/+7/+4); the r756 census-latency lesson repeated verbatim. Shipped pre-armed per the r757 handoff: laneDivergenceOf (each lane last-3-bucket profile vs the corpus strip; a lag = the partial-ladder signal), amber divergence diamonds on chip faces (data-div=1, aria-labeled, bucket detail in titles + legend doc). Zero diamonds = the correct muted state under the full-ladder shape. Divergence probe RECORDED-only (amber-tone doctrine). Snapshot discipline fourteenth close."',
    'commit')

open(PATH, 'w').write('\n'.join(lines))
print('surgery ok: all asserts passed, file written')
