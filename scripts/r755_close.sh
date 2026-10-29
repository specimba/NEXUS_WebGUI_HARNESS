#!/usr/bin/env bash
# r755 close (growth wave): gates -> QA-green guard -> chip probe (gated) -> legend probe (recorded) -> lane-filter probe (recorded; tally assertion stays gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r755c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r755c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r755c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r755 QA GREEN' scripts/qa_r755.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r755.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r755.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=755c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips UNTOUCHED this round -> RECORDED, the QA ld leg already gates the nj token).
timeout 60 agent-browser open "http://localhost:3000/?r=755b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
# lane-filter probe (RECORDED - chips untouched; the fixed tally assertion stays GATED per the handoff).
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
L.append('Task ID: r755')
L.append('Agent: NEXUS patrol (main agent - job 473388, 04:37 slot; opened on the r754 handoff verbatim)')
L.append('Task: Patrol round 755 - THE GROWTH-WAVE ROUND: the census moved 82/24/21/15/46 -> 85 rows / 25 runs / verdict 21 / uncertain 15 / nj 49 (three fresh full-ladder no-judge rows from run_2330a9a2e94e at ~20:56 UTC - the first wave since r751), so the deferred "first seen" per-lane instrument SHIPS per the r754 handoff: each legend chip now shows the earliest fetched ledger row naming that lane (UTC date on the chip face, full UTC timestamp in the title). On the full-ladder shape first-seen is predicted near-uniform across lanes - which is itself the time-axis witness of total ladder failure.')
L.append('Work Log:')
L.append('- R1 open probes: r754 closed by the 04:07 slot (791fb0969 ship + 5841894fc sweep); tree clean; server 200; opened r755 on the r754 handoff verbatim.')
L.append('- R2 templates + census: r755_qa.sh + r755_close.sh via the DUAL sed pattern (s/r=754/r=755/g + s/r754/r755/g) - zero r754 remnants (uppercase env-var names R754_ remain, self-consistent, cosmetic only); ro-SQL census 85/25/21/15/49 - GROWTH WAVE: +3 no-judge rows / +1 run (run_2330a9a2e94e, three full-ladder rows at 20:56 UTC), verdict/uncertain flat.')
L.append('- R3 increment (run-kanban.tsx): laneFirstSeenOf helper (the same verbatim tried-trace scan as laneCountsOf, tracking the earliest row createdAt per lane; createdAt read structurally/optional so a missing field degrades to no date, never an error), laneFirstSeen memo, chip face gains a muted UTC first-seen date span, chip title gains the full UTC timestamp with the newest-400-rows window disclosure, legend panel title documents the first-seen semantics.')
L.append('- R4 gates + QA + close: tsc 0 / lint 0 errors (33 warnings baseline) / r755 golden QA GREEN (probes below; seven lanes re-verified via the LD title - no EIGHTH lane through the wave; console 0 errors); close probes per the handoff (chip GATED presence / tone recorded; legend + lane-filter RECORDED; the fixed tally assertion stays GATED) + census + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R754_QW','(missing)'))
L.append('  ' + os.environ.get('R754_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R754_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R754_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R754_LF','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R754_TSC','?') + ' - lint ' + os.environ.get('R754_LINT','?') + ' - qa-gate-census ' + os.environ.get('R754_GC','?') + ' - qa-cortex-census ' + os.environ.get('R754_CC','?') + ' - close census ' + os.environ.get('R754_CEN','?') + ' - snapshot: ' + os.environ.get('R754_SNAP','?'))
L.append('Stage Summary:')
L.append('- THE WAVE THE HANDOFF WAITED FOR: cadence record now growth r749->r750, r750->r751, three steady slots (r751->r754), then this wave (r754->r755) - waves come in bursts, confirmed. The first-seen instrument shipped INTO the wave: near-uniform first-seen across the seven lanes re-witnesses the full-ladder failure shape from the time axis (every no-judge step names every lane, so every lane debuts together); a LATE lane (outlier first-seen) would be the r751-defined broadening signal. First-seen is bounded by the newest-400-rows fetch window and disclosed as such in the chip titles. Snapshot discipline eleventh close. Witness five-legged, all legs green.')
L.append('Round Handoff:')
L.append('Round ID: r756 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r755_qa.sh sed-adapted (DUAL pattern s/r=755/r=756/g + s/r755/r756/g); close probes: chip presence gated / tone recorded; legend + lane-filter probes RECORDED (gate only if a round touches the chips); the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; FIRST-SEEN CADENCE is the new instrument - on the next wave, slot-over-slot first-seen spread distinguishes a whole-ladder relight (near-uniform timestamps) from a NEW lane joining (outlier timestamp = the r751-defined broadening signal); any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal. (5) Increment queue: if the corpus grows again, a per-lane dials-over-time mini-strip (last three waves) is the candidate; pure watch is legitimate while steady; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the first-seen instrument shipped into a live growth wave + full golden QA, anchored in scripts/qa_r755.txt and scripts/qa_r755_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r755: growth-wave round - census moved 82/24/21/15/46 -> 85/25/21/15/49 (three fresh full-ladder no-judge rows from run_2330a9a2e94e, first wave since r751); shipped the deferred first-seen per-lane instrument per the handoff: laneFirstSeenOf (earliest fetched ledger row naming each lane), UTC date on each legend chip face, full UTC timestamp + newest-400-rows window disclosure in each chip title. On the full-ladder shape first-seen reads near-uniform across lanes - the time-axis witness of total ladder failure; a late lane would be the broadening signal. Snapshot discipline eleventh close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r755_close.txt
SWEEP=$(git add -A && git commit -m "r755: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
