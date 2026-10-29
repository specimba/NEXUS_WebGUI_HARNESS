#!/usr/bin/env python3
# r756 prose rewrite: r755_close.sh carries wave-round prose; r756 is a PURE
# WATCH round (census steady at the r755 baseline) + a forward timestamp
# correction (r755 said ~20:56 UTC; actual newest-row time 20:16:04 UTC).
# Collect-all-failures: every old string must match exactly once; nothing is
# written unless ALL replacements succeed.
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
    "# r756 close (steady watch): gates")

rep('agent',
    """L.append('Agent: NEXUS patrol (main agent - job 473388, 04:37 slot; opened on the r754 handoff verbatim)')""",
    """L.append('Agent: NEXUS patrol (main agent - job 473388, 05:07 slot; opened on the r755 handoff verbatim)')""")

rep('task',
    """L.append('Task: Patrol round 755 - THE GROWTH-WAVE ROUND: the census moved 82/24/21/15/46 -> 85 rows / 25 runs / verdict 21 / uncertain 15 / nj 49 (three fresh full-ladder no-judge rows from run_2330a9a2e94e at ~20:56 UTC - the first wave since r751), so the deferred "first seen" per-lane instrument SHIPS per the r754 handoff: each legend chip now shows the earliest fetched ledger row naming that lane (UTC date on the chip face, full UTC timestamp in the title). On the full-ladder shape first-seen is predicted near-uniform across lanes - which is itself the time-axis witness of total ladder failure.')""",
    """L.append('Task: Patrol round 756 - PURE WATCH round (the handoff-legitimate path): the census holds STEADY at 85 rows / 25 runs / verdict 21 / uncertain 15 / nj 49 - the first steady slot after the r754->r755 wave, newest row still predating this slot - so no code ships; the full golden QA is the named evaluation for this round per the r707 constraint. FORWARD CORRECTION (honesty doctrine - prose fixes go forward, never backward): the r755 worklog timestamps the wave rows ~20:56 UTC; the actual newest-row time is 20:16:04 UTC (re-read this slot from the same ro-mode query).')""")

rep('r1',
    """L.append('- R1 open probes: r754 closed by the 04:07 slot (791fb0969 ship + 5841894fc sweep); tree clean; server 200; opened r756 on the r754 handoff verbatim.')""",
    """L.append('- R1 open probes: r755 closed by the 04:37 slot (e2769dd97 ship + 2d562ddc4 sweep); tree clean; server 200; opened r756 on the r755 handoff verbatim.')""")

rep('r2',
    """L.append('- R2 templates + census: r756_qa.sh + r756_close.sh via the DUAL sed pattern (s/r=754/r=756/g + s/r754/r756/g) - zero r754 remnants (uppercase env-var names R754_ remain, self-consistent, cosmetic only); ro-SQL census 85/25/21/15/49 - GROWTH WAVE: +3 no-judge rows / +1 run (run_2330a9a2e94e, three full-ladder rows at 20:56 UTC), verdict/uncertain flat.')""",
    """L.append('- R2 templates + census: r756_qa.sh + r756_close.sh via the DUAL sed pattern (s/r=755/r=756/g + s/r755/r756/g) - zero r755 remnants; ro-SQL census 85/25/21/15/49 - STEADY, first steady slot after the wave (newest row run_2330a9a2e94e at 20:16:04 UTC predates this slot) - pure watch path taken per the handoff; forward correction: the r755 R2 line said 20:56 UTC, actual is 20:16:04 UTC.')""")

rep('r3',
    """L.append('- R3 increment (run-kanban.tsx): laneFirstSeenOf helper (the same verbatim tried-trace scan as laneCountsOf, tracking the earliest row createdAt per lane; createdAt read structurally/optional so a missing field degrades to no date, never an error), laneFirstSeen memo, chip face gains a muted UTC first-seen date span, chip title gains the full UTC timestamp with the newest-400-rows window disclosure, legend panel title documents the first-seen semantics.')""",
    """L.append('- R3 gates + QA: tsc 0 / lint 0 errors (33 warnings baseline) / r756 golden QA GREEN (probes below; seven lanes re-verified via the LD title - no EIGHTH lane; the first-seen reading held near-uniform; console 0 errors).')""")

rep('r4',
    """L.append('- R4 gates + QA + close: tsc 0 / lint 0 errors (33 warnings baseline) / r756 golden QA GREEN (probes below; seven lanes re-verified via the LD title - no EIGHTH lane through the wave; console 0 errors); close probes per the handoff (chip GATED presence / tone recorded; legend + lane-filter RECORDED; the fixed tally assertion stays GATED) + census + snapshot + worklog + commit + dual push.')""",
    """L.append('- R4 close: chip probe (GATED presence / tone recorded - standing) + legend + lane-filter probes (RECORDED - chips untouched this round; the fixed tally assertion stays GATED per the handoff) + census + snapshot + worklog + commit + dual push.')""")

rep('stage',
    """L.append('- THE WAVE THE HANDOFF WAITED FOR: cadence record now growth r749->r750, r750->r751, three steady slots (r751->r754), then this wave (r754->r756) - waves come in bursts, confirmed. The first-seen instrument shipped INTO the wave: near-uniform first-seen across the seven lanes re-witnesses the full-ladder failure shape from the time axis (every no-judge step names every lane, so every lane debuts together); a LATE lane (outlier first-seen) would be the r751-defined broadening signal. First-seen is bounded by the newest-400-rows fetch window and disclosed as such in the chip titles. Snapshot discipline eleventh close. Witness five-legged, all legs green.')""",
    """L.append('- FIRST STEADY SLOT AFTER THE WAVE: cadence record now growth r749->r750, r750->r751, steady r751->r754, wave r754->r755, steady r755->r756 - burst cadence confirmed twice over. The first-seen instrument held its near-uniform reading (no late joiner, no eighth lane); xN drift (46->49 through the wave) resumes as the dial-failure cadence signal on the next wave. FORWARD CORRECTION carried: r755 worklog said ~20:56 UTC, actual 20:16:04 UTC (disclosed forward, r755 text untouched). Snapshot discipline twelfth close. Witness five-legged, all legs green.')""")

rep('handoff',
    """L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r756_qa.sh sed-adapted (DUAL pattern s/r=756/r=756/g + s/r756/r756/g); close probes: chip presence gated / tone recorded; legend + lane-filter probes RECORDED (gate only if a round touches the chips); the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; FIRST-SEEN CADENCE is the new instrument - on the next wave, slot-over-slot first-seen spread distinguishes a whole-ladder relight (near-uniform timestamps) from a NEW lane joining (outlier timestamp = the r751-defined broadening signal); any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal. (5) Increment queue: if the corpus grows again, a per-lane dials-over-time mini-strip (last three waves) is the candidate; pure watch is legitimate while steady; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')""",
    """L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r756_qa.sh sed-adapted (DUAL pattern s/r=756/r=757/g + s/r756/r757/g); close probes: chip presence gated / tone recorded; legend + lane-filter probes RECORDED (gate only if a round touches the chips); the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; FIRST-SEEN CADENCE: on the next wave, slot-over-slot first-seen spread distinguishes a whole-ladder relight (near-uniform timestamps) from a NEW lane joining (outlier timestamp = the r751-defined broadening signal); any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal. (5) Increment queue: if the corpus grows again, the smallest real candidate is a per-lane LAST-SEEN sibling (latest row naming the lane - brackets the wave against first-seen); the dials-over-time mini-strip stays the bigger option; pure watch is legitimate while steady; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')""")

rep('roundid',
    """L.append('Round ID: r756 -> next patrol (job 473388)')""",
    """L.append('Round ID: r757 -> next patrol (job 473388)')""")

rep('blockers',
    """L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the first-seen instrument shipped into a live growth wave + full golden QA, anchored in scripts/qa_r756.txt and scripts/qa_r756_close.txt).')""",
    """L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (full golden QA + the steady-census witness + the forward timestamp correction, anchored in scripts/qa_r756.txt and scripts/qa_r756_close.txt).')""")

rep('commit',
    """git commit -m "r756: growth-wave round - census moved 82/24/21/15/46 -> 85/25/21/15/49 (three fresh full-ladder no-judge rows from run_2330a9a2e94e, first wave since r751); shipped the deferred first-seen per-lane instrument per the handoff: laneFirstSeenOf (earliest fetched ledger row naming each lane), UTC date on each legend chip face, full UTC timestamp + newest-400-rows window disclosure in each chip title. On the full-ladder shape first-seen reads near-uniform across lanes - the time-axis witness of total ladder failure; a late lane would be the broadening signal. Snapshot discipline eleventh close.\"""",
    """git commit -m "r756: pure watch round - census steady (85 rows / 25 runs / 21 verdicts / 15u / 49nj, first steady slot after the r754->r755 wave); no code changes, full golden QA as the named evaluation (r707). Forward correction (honesty doctrine): the r755 worklog said the wave rows hit ~20:56 UTC - the actual newest-row time is 20:16:04 UTC (re-read from the same ro-mode query this slot). First-seen witness held near-uniform across the seven lanes (no late joiner, no eighth lane). Snapshot discipline twelfth close.\"""")

if fails:
    print('PROSE FAILURES:')
    for f in fails:
        print(' - ' + f)
    sys.exit(1)
io.open(P, 'w', encoding='utf-8').write(s)
print('prose edits OK - ' + str(applied) + ' replacements applied')
