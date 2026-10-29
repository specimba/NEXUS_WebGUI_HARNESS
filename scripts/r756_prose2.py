#!/usr/bin/env python3
# r756 prose rewrite v2 (wave pivot): R2 read steady, R3 QA caught the live
# wave (89 ev / 26 runs / 53nj) - the round ships the per-lane LAST-SEEN
# sibling and GATES the legend probe (chips touched). Collect-all-failures:
# every old string must match exactly once; nothing written unless all pass.
import io, sys

P = 'scripts/r756_close.sh'
s = io.open(P, encoding='utf-8').read()
fails = []
applied = 0

def rep(tag, old, new):
    global s, applied
    n = s.count(old)
    if n != 1:
        fails.append(tag + ': match count ' + str(n))
        return
    s = s.replace(old, new)
    applied += 1

rep('header',
    "# r756 close (growth wave): gates",
    "# r756 close (mid-round wave pivot): gates")

rep('agent',
    """L.append('Agent: NEXUS patrol (main agent - job 473388, 04:37 slot; opened on the r754 handoff verbatim)')""",
    """L.append('Agent: NEXUS patrol (main agent - job 473388, 05:07 slot; opened on the r755 handoff verbatim)')""")

rep('task',
    """L.append('Task: Patrol round 755 - THE GROWTH-WAVE ROUND: the census moved 82/24/21/15/46 -> 85 rows / 25 runs / verdict 21 / uncertain 15 / nj 49 (three fresh full-ladder no-judge rows from run_2330a9a2e94e at ~20:56 UTC - the first wave since r751), so the deferred "first seen" per-lane instrument SHIPS per the r754 handoff: each legend chip now shows the earliest fetched ledger row naming that lane (UTC date on the chip face, full UTC timestamp in the title). On the full-ladder shape first-seen is predicted near-uniform across lanes - which is itself the time-axis witness of total ladder failure.')""",
    """L.append('Task: Patrol round 756 - MID-ROUND WAVE PIVOT: the R2 ro-SQL read was STEADY (85/25/21/15/49, newest row 20:16:04 UTC predating the slot) and the pure-watch path was taken; by the R3 golden QA the live board read 89 ev / 26 runs / 53nj - a fresh wave (+4 no-judge rows / +1 run, ~21:0x UTC, the SECOND consecutive growth slot) landed between the R2 read and QA, so the round pivots to the wave path per the r755 handoff increment queue and ships the per-lane LAST-SEEN sibling: laneLastSeenOf (the mirror of laneFirstSeenOf, latest row naming each lane), a chip-face last-seen span (time-of-day when same UTC day as first-seen, date otherwise, hidden when identical), the full last-seen UTC timestamp in the chip title, and panel-title bracket semantics. First/last pairs bracket each wave; a lane whose last-seen lags the others is the partial-ladder signal. The bigger dials-over-time mini-strip named by the handoff stays queued.')""")

rep('r1',
    """L.append('- R1 open probes: r754 closed by the 04:07 slot (791fb0969 ship + 5841894fc sweep); tree clean; server 200; opened r756 on the r754 handoff verbatim.')""",
    """L.append('- R1 open probes: r755 closed by the 04:37 slot (e2769dd97 ship + 2d562ddc4 sweep); tree clean; server 200; opened r756 on the r755 handoff verbatim.')""")

rep('r2',
    """L.append('- R2 templates + census: r756_qa.sh + r756_close.sh via the DUAL sed pattern (s/r=754/r=756/g + s/r754/r756/g) - zero r754 remnants (uppercase env-var names R754_ remain, self-consistent, cosmetic only); ro-SQL census 85/25/21/15/49 - GROWTH WAVE: +3 no-judge rows / +1 run (run_2330a9a2e94e, three full-ladder rows at 20:56 UTC), verdict/uncertain flat.')""",
    """L.append('- R2 templates + census: r756_qa.sh + r756_close.sh via the DUAL sed pattern (s/r=755/r=756/g + s/r755/r756/g) - zero r755 remnants; ro-SQL census 85/25/21/15/49 - read STEADY at ~05:08 (newest row run_2330a9a2e94e 20:16:04 UTC predating the slot) and the pure-watch path taken; the wave arrived minutes later (caught by the R3 QA). Forward correction: the r755 R2 line said 20:56 UTC, actual 20:16:04 UTC.')""")

rep('r3',
    """L.append('- R3 increment (run-kanban.tsx): laneFirstSeenOf helper (the same verbatim tried-trace scan as laneCountsOf, tracking the earliest row createdAt per lane; createdAt read structurally/optional so a missing field degrades to no date, never an error), laneFirstSeen memo, chip face gains a muted UTC first-seen date span, chip title gains the full UTC timestamp with the newest-400-rows window disclosure, legend panel title documents the first-seen semantics.')""",
    """L.append('- R3 QA + wave catch: tsc 0 / lint 0 errors (33 warnings baseline) on the unchanged tree; the r756 golden QA ran GREEN but its board probe read 26 runs / 89 ev / 53nj - the live WAVE (+4 no-judge rows / +1 run at ~21:0x UTC, second consecutive growth slot) landed between R2 and QA; ld count 53, seven lanes, no EIGHTH lane. Census-instrument latency lesson recorded: an R2 ro-SQL read can be stale within minutes.')""")

rep('r4',
    """L.append('- R4 gates + QA + close: tsc 0 / lint 0 errors (33 warnings baseline) / r756 golden QA GREEN (probes below; seven lanes re-verified via the LD title - no EIGHTH lane through the wave; console 0 errors); close probes per the handoff (chip GATED presence / tone recorded; legend + lane-filter RECORDED; the fixed tally assertion stays GATED) + census + snapshot + worklog + commit + dual push.')""",
    """L.append('- R4 increment (run-kanban.tsx): laneLastSeenOf helper (mirror scan of laneFirstSeenOf, tracking the latest createdAt per lane), laneLastSeen memo, chip face gains a conditional last-seen span (HH:MMZ when the last-seen UTC date equals first-seen, MM-DD otherwise, hidden when identical), chip title gains the full last-seen UTC timestamp, legend panel title documents the bracket semantics (first/last pairs bound each wave; a lagging last-seen = partial-ladder signal).')
L.append('- R5 gates + QA re-run after the increment: tsc 0 / lint 0 errors (33 warnings baseline) / r756 golden QA GREEN (probes below; seven lanes re-verified via the LD title - no EIGHTH lane; console 0 errors); close probes: chip GATED presence / tone recorded; legend probe GATED this round (chips touched - doctrine honored, the gate was added to this close script); lane-filter RECORDED with the fixed tally assertion staying GATED; + census + snapshot + worklog + commit + dual push.')""")

rep('legendgate',
    'echo "legend: $LEG"',
    'echo "legend: $LEG"\necho "$LEG" | grep -Eq \'legend\\\\?":true\' || { echo \'GUARD legend probe\'; exit 1; }')

rep('lfcomment',
    '# lane-filter probe (RECORDED - chips untouched; the fixed tally assertion stays GATED per the handoff).',
    '# lane-filter probe (chips WERE touched this round - the legend gate above runs; the fixed tally assertion stays GATED).')

rep('stage',
    """L.append('- THE WAVE THE HANDOFF WAITED FOR: cadence record now growth r749->r750, r750->r751, three steady slots (r751->r754), then this wave (r754->r756) - waves come in bursts, confirmed. The first-seen instrument shipped INTO the wave: near-uniform first-seen across the seven lanes re-witnesses the full-ladder failure shape from the time axis (every no-judge step names every lane, so every lane debuts together); a LATE lane (outlier first-seen) would be the r751-defined broadening signal. First-seen is bounded by the newest-400-rows fetch window and disclosed as such in the chip titles. Snapshot discipline eleventh close. Witness five-legged, all legs green.')""",
    """L.append('- TWO CONSECUTIVE GROWTH SLOTS: cadence record now growth r749->r750, r750->r751, steady r751->r754, wave r754->r755, wave r755->r756 - the two-wave burst shape repeats (the r749->r751 burst was also two consecutive growth slots). The last-seen sibling shipped INTO the fresh wave: all seven lanes re-verified via the ld leg; the first/last-seen pair on each chip now brackets the wave on-page (face shows first-seen date + last-seen time-of-day when both fall on the same UTC day). Census-instrument latency lesson recorded: an R2 ro-SQL read can be stale within minutes - the R3 QA board probe caught what the R2 read missed. FORWARD CORRECTION carried: r755 worklog said ~20:56 UTC, actual 20:16:04 UTC (disclosed forward, r755 text untouched). Snapshot discipline twelfth close. Witness five-legged, all legs green.')""")

rep('handoff',
    """L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r756_qa.sh sed-adapted (DUAL pattern s/r=756/r=756/g + s/r756/r756/g); close probes: chip presence gated / tone recorded; legend + lane-filter probes RECORDED (gate only if a round touches the chips); the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; FIRST-SEEN CADENCE is the new instrument - on the next wave, slot-over-slot first-seen spread distinguishes a whole-ladder relight (near-uniform timestamps) from a NEW lane joining (outlier timestamp = the r751-defined broadening signal); any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal. (5) Increment queue: if the corpus grows again, a per-lane dials-over-time mini-strip (last three waves) is the candidate; pure watch is legitimate while steady; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')""",
    """L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r756_qa.sh sed-adapted (DUAL pattern s/r=756/r=757/g + s/r756/r757/g); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the chips (r756 precedent - the gate lives in this close script), else RECORDED; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; FIRST/LAST-SEEN CADENCE: a lane whose last-seen lags the others = the partial-ladder signal; a NEW lane (outlier first-seen) = the broadening signal; any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal; THREE consecutive growth slots would be a new burst shape (both prior bursts were two-wave). (5) Increment queue: the dials-over-time mini-strip (per-lane dials bucketed by wave/day) remains the named candidate for the next wave; pure watch is legitimate while steady; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')""")

rep('roundid',
    """L.append('Round ID: r756 -> next patrol (job 473388)')""",
    """L.append('Round ID: r757 -> next patrol (job 473388)')""")

rep('blockers',
    """L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the first-seen instrument shipped into a live growth wave + full golden QA, anchored in scripts/qa_r756.txt and scripts/qa_r756_close.txt).')""",
    """L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the last-seen instrument shipped into a live second wave + full golden QA, anchored in scripts/qa_r756.txt and scripts/qa_r756_close.txt).')""")

rep('commit',
    """git commit -m "r756: growth-wave round - census moved 82/24/21/15/46 -> 85/25/21/15/49 (three fresh full-ladder no-judge rows from run_2330a9a2e94e, first wave since r751); shipped the deferred first-seen per-lane instrument per the handoff: laneFirstSeenOf (earliest fetched ledger row naming each lane), UTC date on each legend chip face, full UTC timestamp + newest-400-rows window disclosure in each chip title. On the full-ladder shape first-seen reads near-uniform across lanes - the time-axis witness of total ladder failure; a late lane would be the broadening signal. Snapshot discipline eleventh close.\"""",
    """git commit -m "r756: mid-round wave pivot - R2 read steady (85/25/21/15/49) but the R3 QA caught a fresh wave live (89 ev / 26 runs / 53nj at ~21:0x UTC, second consecutive growth slot); shipped the per-lane LAST-SEEN sibling per the increment queue: laneLastSeenOf (latest row naming each lane), chip-face last-seen span (time-of-day same-day / date otherwise / hidden identical), full last-seen UTC timestamp in chip titles, panel-title bracket semantics (a lagging last-seen = partial-ladder signal). Legend probe GATED this round (chips touched - doctrine honored). The dials-over-time mini-strip stays queued. Forward correction carried: r755 said ~20:56 UTC, actual 20:16:04 UTC. Snapshot discipline twelfth close.\"""")

if fails:
    print('PROSE FAILURES:')
    for f in fails:
        print(' - ' + f)
    sys.exit(1)
io.open(P, 'w', encoding='utf-8').write(s)
print('prose edits OK - ' + str(applied) + ' replacements applied')
