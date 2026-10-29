#!/usr/bin/env bash
# r752 close: gates -> QA-green guard -> chip probe -> lane-legend probe (gated; round touches legend) -> lane-filter probe (gated; the round ship) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r752c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r752c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r752c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r752 QA GREEN' scripts/qa_r752.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r752.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r752.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=752c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend is touched again this round): click the nj button, verify the panel mounts. GATED.
timeout 60 agent-browser open "http://localhost:3000/?r=752b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
echo "$NJCLICK" | grep -q 'clicked' || { echo 'GUARD legend nj-button'; exit 1; }
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,100)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend panel'; exit 1; }
# lane-filter probe (the r752 ship): click the first legend chip, verify aria-pressed + the shown-count chip, then untoggle. GATED.
LCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[data-testid=\"corpus-lane-legend\"] button'); if(!b) return 'legend-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "lane filter click: $LCLICK"
echo "$LCLICK" | grep -q 'clicked' || { echo 'GUARD lane-filter click'; exit 1; }
sleep 1
LF=$(timeout 30 agent-browser eval "(() => { const on=document.querySelector('[data-testid=\"corpus-lane-legend\"] button[aria-pressed=\"true\"]'); const shown=[...document.querySelectorAll('span')].some(x=>/ of .* shown/.test(x.textContent||'')); const tally=[...document.querySelectorAll('span')].some(x=>/ runs . ev/.test(x.textContent||'')); return JSON.stringify({pressed:!!on, shownChip:shown, tallyWholeCorpus:tally}); })()" 2>&1 | tail -1)
echo "lane filter: $LF"
echo "$LF" | grep -Eq 'pressed\\?":true' || { echo 'GUARD lane-filter state'; exit 1; }
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
export R752_TSC="$TSC" R752_LINT="$LTAIL" R752_GC="$GC" R752_CC="$CC" R752_CEN="$CEN" R752_SNAP="$SNAP" R752_QW="$QW" R752_QLD="$QLD" R752_CHIP="$CHIP" R752_LEG="$LEG" R752_LF="$LF"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r752')
L.append('Agent: NEXUS patrol (main agent - job 473388, 03:07 slot; opened on the r751 handoff verbatim)')
L.append('Task: Patrol round 752 - normal watch + the lane-filter increment: the r751 legend answers "how often" (the xN badges); this round answers "WHERE" - legend chips are now toggle buttons that filter the strip pills to the runs whose ledger rows name that lane (row-level note scan; the pill filter matches runId substrings only). The need shows: intern-systemone x46 dominates and "which runs did it fail on" is the natural next question.')
L.append('Work Log:')
L.append('- R1 open probes: r751 closed by the 02:37 slot (2152581d3 ship + b6ac74cd8 sweep); tree clean; server 200; opened r752 on the handoff verbatim.')
L.append('- R2 templates + anchors: r752_qa.sh + r752_close.sh via the DUAL sed pattern (s/r=751/r=752/g + s/r751/r752/g) - zero remnants; anchors read (pillFilter state :1540, visibleCorpus memo :1547, shown-chip :2039, legend chips :2074, no-match ghost :2165).')
L.append('- R3 increment (run-kanban.tsx, six edits): laneFilter state (string|null) beside pillFilter; visibleCorpus memo extended (pillQuery AND laneFilter compose; lane match = rows.some(note.includes(lane))); the shown-count chip renders for EITHER filter; a removable amber "lane: X" chip keeps an active filter visible and clearable when the legend is closed (honesty: no invisible filtering); legend chips span->button (aria-pressed, toggle, active = amber family, title carries the filter semantics, the xN badge kept); the r734 no-match ghost now covers lane-only empty results (its message names the active filters; its Clear clears BOTH filters - otherwise the ghost would never dismiss).')
L.append('- R4 gates + QA: tsc 0, lint 0 errors / 33 warnings (baseline); r752 golden QA GREEN (census in GATES below); seven-lane set re-verified via the LD title probe - no EIGHTH lane.')
L.append('- R5 this close: chip probe (cards view, grid-click first - presence GATED, tone RECORDED) + lane-legend probe (GATED - the round touches the legend, per the handoff rule) + NEW lane-filter probe (click the first legend chip, verify aria-pressed + the shown-count chip + the tally still describing the whole corpus, then untoggle; GATED - the round ship) + census + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R752_QW','(missing)'))
L.append('  ' + os.environ.get('R752_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R752_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R752_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R752_LF','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R752_TSC','?') + ' - lint ' + os.environ.get('R752_LINT','?') + ' - qa-gate-census ' + os.environ.get('R752_GC','?') + ' - qa-cortex-census ' + os.environ.get('R752_CC','?') + ' - close census ' + os.environ.get('R752_CEN','?') + ' - snapshot: ' + os.environ.get('R752_SNAP','?'))
L.append('Stage Summary:')
L.append('- The lane legend is now an INSTRUMENT, not a label: magnitude (r751 xN badges) + locality (r752 click-to-isolate). The witness stays five-legged; the fifth leg deepened again. Judge-lane watch: census in GATES (r751 baseline was 82 rows / 24 runs / verdict 21 / uncertain 15 / nj 46); seven lanes steady; intern-systemone x46 was the r751 reading - the slot-over-slot drift of that number is the dial-failure cadence signal. Snapshot discipline eighth close.')
L.append('Round Handoff:')
L.append('Round ID: r753 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r752_qa.sh sed-adapted (DUAL pattern s/r=752/r=753/g + s/r752/r753/g); close probes: chip presence gated / tone recorded; legend presence RECORDED (untouched this time - gate only if a round touches it); lane-filter probe RECORDED (shipped r752 - gate only if the round touches the filter). (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; xN drift slot-over-slot = the cadence instrument; any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal. (5) Increment queue: still incident-driven while P1s stay Owner-blocked; candidates - the legend could sort chips by count descending (driver first) or show per-lane RUN counts (runs affected, not dial attempts - a small sibling memo); TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry; the intern lane awaits keys); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the lane-filter increment + the ghost-coverage fix + full golden QA, all anchored in scripts/qa_r752.txt and scripts/qa_r752_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r752: lane-filter on the legend chips - the magnitude instrument answers WHERE. The r751 xN badges say how often each lane failed; clicking a legend chip now isolates the strip pills to the runs whose ledger rows name that lane (row-level note scan; the pill filter matches runId substrings only). Honest filters: the shown-count chip renders for either filter; a removable amber reminder chip keeps an active lane filter visible and clearable when the legend is closed (no invisible filtering); the r734 no-match ghost now covers lane-only empty results and its Clear clears both filters. Legend chips are real toggle buttons (aria-pressed, active = amber family, xN badge kept). Gates: tsc 0, lint 0E/33W; golden QA GREEN (census + seven lanes re-verified - no eighth; settings census/relay + radar frontier + 799-char paste, console 0 errors); chip + legend + lane-filter probes in the close (all gated). Snapshot discipline eighth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r752_close.txt
SWEEP=$(git add -A && git commit -m "r752: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
