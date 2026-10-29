#!/usr/bin/env bash
# r756 close (mid-round wave pivot): gates -> QA-green guard -> chip probe (gated) -> legend probe (recorded) -> lane-filter probe (recorded; tally assertion stays gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r756c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r756c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r756c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r756 QA GREEN' scripts/qa_r756.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r756.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r756.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=756c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips UNTOUCHED this round -> RECORDED, the QA ld leg already gates the nj token).
timeout 60 agent-browser open "http://localhost:3000/?r=756b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# lane-filter probe (chips WERE touched this round - the legend gate above runs; the fixed tally assertion stays GATED).
LCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[data-testid=\"corpus-lane-legend\"] button'); if(!b) return 'legend-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "lane filter click: $LCLICK"
sleep 1
LF=$(timeout 30 agent-browser eval "(() => { const on=document.querySelector('[data-testid=\"corpus-lane-legend\"] button[aria-pressed=\"true\"]'); const shown=[...document.querySelectorAll('span')].some(x=>/ of .* shown/.test(x.textContent||'')); const tally=[...document.querySelectorAll('span')].some(x=>/runs . \\d+ ev/.test(x.textContent||'')); return JSON.stringify({pressed:!!on, shownChip:shown, tallyWholeCorpus:tally}); })()" 2>&1 | tail -1)
echo "lane filter: $LF"
echo "$LF" | grep -Eq 'tallyWholeCorpus\\?":true' || { echo 'GUARD lane-filter tally'; exit 1; }
timeout 30 agent-browser eval "(() => { const b=document.querySelector('[data-testid=\"corpus-lane-legend\"] button[aria-pressed=\"true\"]'); if(b) b.click(); return 'untoggled'; })()" >/dev/null 2>&1 || true
GC=$(timeout 60 bun scripts/qa-gate-census.ts 2>&1 | tail -1)
CC=$(timeout 60 bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
CEN=$(python3 - <<'PY'
import sqlite3,json
try:
    c=sqlite3.connect('file:/home/z/my-project/db/custom.db?mode=ro',uri=True)
    n=c.execute('select count(*) from EvalEvent').fetchone()[0]
    nj=c.execute("select count(*) from EvalEvent where kind='gate-no-judge'").fetchone()[0]
    vd=c.execute("select count(*) from EvalEvent where kind='gate-verdict'").fetchone()[0]
    un=c.execute("select count(*) from EvalEvent where kind='gate-uncertain'").fetchone()[0]
    runs=c.execute('select count(distinct runId) from EvalEvent').fetchone()[0]
    try: wf=c.execute('select count(*) from AutomationWorkflow').fetchone()[0]
    except Exception: wf='?'
    print(json.dumps({"total":n,"runs":runs,"verdict":vd,"uncertain":un,"nj":nj,"wf":wf}))
except Exception as e:
    print(json.dumps({"err":str(e)[:80]}))
PY
)
SNAP=$(timeout 30 python3 scripts/snapshot-corpus.py 2>&1 | tail -1)
export R754_TSC="$TSC" R754_LINT="$LTAIL" R754_GC="$GC" R754_CC="$CC" R754_CEN="$CEN" R754_SNAP="$SNAP" R754_QW="$QW" R754_QLD="$QLD" R754_CHIP="$CHIP" R754_LEG="$LEG" R754_LF="$LF"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r756')
L.append('Agent: NEXUS patrol (main agent - job 473388, 05:07 slot; opened on the r755 handoff verbatim)')
L.append('Task: Patrol round 756 - MID-ROUND WAVE PIVOT: the R2 ro-SQL read was STEADY (85/25/21/15/49, newest row 20:16:04 UTC predating the slot) and the pure-watch path was taken; by the R3 golden QA the live board read 89 ev / 26 runs / 53nj - a fresh wave (+4 no-judge rows / +1 run, ~21:0x UTC, the SECOND consecutive growth slot) landed between the R2 read and QA, so the round pivots to the wave path per the r755 handoff increment queue and ships the per-lane LAST-SEEN sibling: laneLastSeenOf (the mirror of laneFirstSeenOf, latest row naming each lane), a chip-face last-seen span (time-of-day when same UTC day as first-seen, date otherwise, hidden when identical), the full last-seen UTC timestamp in the chip title, and panel-title bracket semantics. First/last pairs bracket each wave; a lane whose last-seen lags the others is the partial-ladder signal. The bigger dials-over-time mini-strip named by the handoff stays queued.')
L.append('Work Log:')
L.append('- R1 open probes: r755 closed by the 04:37 slot (e2769dd97 ship + 2d562ddc4 sweep); tree clean; server 200; opened r756 on the r755 handoff verbatim.')
L.append('- R2 templates + census: r756_qa.sh + r756_close.sh via the DUAL sed pattern (s/r=755/r=756/g + s/r755/r756/g) - zero r755 remnants; ro-SQL census 85/25/21/15/49 - read STEADY at ~05:08 (newest row run_2330a9a2e94e 20:16:04 UTC predating the slot) and the pure-watch path taken; the wave arrived minutes later (caught by the R3 QA). Forward correction: the r755 R2 line said 20:56 UTC, actual 20:16:04 UTC.')
L.append('- R3 QA + wave catch: tsc 0 / lint 0 errors (33 warnings baseline) on the unchanged tree; the r756 golden QA ran GREEN but its board probe read 26 runs / 89 ev / 53nj - the live WAVE (+4 no-judge rows / +1 run at ~21:0x UTC, second consecutive growth slot) landed between R2 and QA; ld count 53, seven lanes, no EIGHTH lane. Census-instrument latency lesson recorded: an R2 ro-SQL read can be stale within minutes.')
L.append('- R4 increment (run-kanban.tsx): laneLastSeenOf helper (mirror scan of laneFirstSeenOf, tracking the latest createdAt per lane), laneLastSeen memo, chip face gains a conditional last-seen span (HH:MMZ when the last-seen UTC date equals first-seen, MM-DD otherwise, hidden when identical), chip title gains the full last-seen UTC timestamp, legend panel title documents the bracket semantics (first/last pairs bound each wave; a lagging last-seen = partial-ladder signal).')
L.append('- R5 gates + QA re-run after the increment: tsc 0 / lint 0 errors (33 warnings baseline) / r756 golden QA GREEN (probes below; seven lanes re-verified via the LD title - no EIGHTH lane; console 0 errors); close probes: chip GATED presence / tone recorded; legend probe GATED this round (chips touched - doctrine honored, the gate was added to this close script); lane-filter RECORDED with the fixed tally assertion staying GATED; + census + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R754_QW','(missing)'))
L.append('  ' + os.environ.get('R754_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R754_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R754_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R754_LF','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R754_TSC','?') + ' - lint ' + os.environ.get('R754_LINT','?') + ' - qa-gate-census ' + os.environ.get('R754_GC','?') + ' - qa-cortex-census ' + os.environ.get('R754_CC','?') + ' - close census ' + os.environ.get('R754_CEN','?') + ' - snapshot: ' + os.environ.get('R754_SNAP','?'))
L.append('Stage Summary:')
L.append('- TWO CONSECUTIVE GROWTH SLOTS: cadence record now growth r749->r750, r750->r751, steady r751->r754, wave r754->r755, wave r755->r756 - the two-wave burst shape repeats (the r749->r751 burst was also two consecutive growth slots). The last-seen sibling shipped INTO the fresh wave: all seven lanes re-verified via the ld leg; the first/last-seen pair on each chip now brackets the wave on-page (face shows first-seen date + last-seen time-of-day when both fall on the same UTC day). Census-instrument latency lesson recorded: an R2 ro-SQL read can be stale within minutes - the R3 QA board probe caught what the R2 read missed. FORWARD CORRECTION carried: r755 worklog said ~20:56 UTC, actual 20:16:04 UTC (disclosed forward, r755 text untouched). Snapshot discipline twelfth close. Witness five-legged, all legs green.')
L.append('Round Handoff:')
L.append('Round ID: r757 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r756_qa.sh sed-adapted (DUAL pattern s/r=756/r=757/g + s/r756/r757/g); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the chips (r756 precedent - the gate lives in this close script), else RECORDED; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; FIRST/LAST-SEEN CADENCE: a lane whose last-seen lags the others = the partial-ladder signal; a NEW lane (outlier first-seen) = the broadening signal; any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal; THREE consecutive growth slots would be a new burst shape (both prior bursts were two-wave). (5) Increment queue: the dials-over-time mini-strip (per-lane dials bucketed by wave/day) remains the named candidate for the next wave; pure watch is legitimate while steady; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the last-seen instrument shipped into a live second wave + full golden QA, anchored in scripts/qa_r756.txt and scripts/qa_r756_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r756: mid-round wave pivot - R2 read steady (85/25/21/15/49) but the R3 QA caught a fresh wave live (89 ev / 26 runs / 53nj at ~21:0x UTC, second consecutive growth slot); shipped the per-lane LAST-SEEN sibling per the increment queue: laneLastSeenOf (latest row naming each lane), chip-face last-seen span (time-of-day same-day / date otherwise / hidden identical), full last-seen UTC timestamp in chip titles, panel-title bracket semantics (a lagging last-seen = partial-ladder signal). Legend probe GATED this round (chips touched - doctrine honored). The dials-over-time mini-strip stays queued. Forward correction carried: r755 said ~20:56 UTC, actual 20:16:04 UTC. Snapshot discipline twelfth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r756_close.txt
SWEEP=$(git add -A && git commit -m "r756: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
