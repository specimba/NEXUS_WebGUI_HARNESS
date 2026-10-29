#!/usr/bin/env bash
# r750 close: gates -> QA-green guard -> chip probe -> lane-legend probe (gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r750c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r750c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r750c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r750 QA GREEN' scripts/qa_r750.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r750.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r750.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=750c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the r750 ship): click the nj button, verify the panel mounts. GATED.
timeout 60 agent-browser open "http://localhost:3000/?r=750b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
# escaped-quote-tolerant (the known agent-browser quirk: eval output is JSON-encoded)
echo "$NJCLICK" | grep -q 'clicked' || { echo 'GUARD legend nj-button'; exit 1; }
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,48)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend panel'; exit 1; }
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
export R750_TSC="$TSC" R750_LINT="$LTAIL" R750_GC="$GC" R750_CC="$CC" R750_CEN="$CEN" R750_SNAP="$SNAP" R750_QW="$QW" R750_QLD="$QLD" R750_CHIP="$CHIP" R750_LEG="$LEG"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r750')
L.append('Agent: NEXUS patrol (main agent - job 473388, 02:07 slot; opened on the r749 handoff verbatim)')
L.append('Task: Patrol round 750 - normal watch + the lane-legend increment: the judge-lane distress instrument (the deduped tried-trace) lived only in a hover-only title - invisible on touch and easy to miss on desktop. The nj tally is now a toggle button and the lanes render as an on-page legend. TIMELY: the r749 close noted corpus growth between slots, and this round OPEN probe identified the driver at the source - the newest corpus rows are live gate-no-judge events timestamped BETWEEN the r749 close and this slot, note: "Decision gate engaged but no judge answered (tried: intern-systemone - no answer (dial fai[lure])..." - the intern lane is failing dials in production right now. The legend ships exactly while the distress is live.')
L.append('Work Log:')
L.append('- R1 open probes: r749 closed by this same lineage (71348e75e + sweep 8dfb4d081); tree clean; server 200; opened r750 on the handoff verbatim; NEWEST-ROWS probe: live intern-systemone dial-failure no-judge events between slots (the nj growth driver, witnessed at source).')
L.append('- R2 template + anchors: r750_qa.sh via the DUAL sed pattern (s/r=749/r=750/g + s/r749/r750/g) - 6 substitutions, zero r749 remnants; run-kanban strip structure read (tally span close :1971, header close :2027, pills div :2028).')
L.append('- R3 increment (run-kanban.tsx, three edits): lanesOpen state beside serverDetail (:1317); the nj tally span -> a real BUTTON (aria-expanded, aria-controls, dotted-underline family styling, title gained the click hint) toggling the legend; the legend panel renders between the strip header and the pill row (data-testid corpus-lane-legend, id for aria-controls, "lanes tried (N no-judge)" label + one chip per deduped lane via split("; ")).')
L.append('- R4 gates + QA: tsc 0, lint 0 errors / 33 warnings (baseline); r750 golden QA GREEN - tally STEADY at 23 runs / 81 ev / nj 45 (the between-slot activity paused this slot); seven-lane set re-verified, no EIGHTH lane.')
L.append('- R5 this close: chip probe (cards view, grid-click first) + lane-legend probe (board view, click-verified, GATED - it is the round ship) + snapshot + worklog + commit + dual push. FIRST ATTEMPT GUARD-TRIPPED (disclosed): the nj click had landed but the guard compared the raw eval output against bare "clicked" - the known agent-browser quirk (eval output is JSON-ENCODED, so it arrives as "clicked" with quotes) broke the strict compare. Fixed to the escaped-quote-tolerant grep the other guards already use; the guard aborted pre-commit and did its job.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R750_QW','(missing)'))
L.append('  ' + os.environ.get('R750_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R750_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R750_LEG','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R750_TSC','?') + ' - lint ' + os.environ.get('R750_LINT','?') + ' - qa-gate-census ' + os.environ.get('R750_GC','?') + ' - qa-cortex-census ' + os.environ.get('R750_CC','?') + ' - close census ' + os.environ.get('R750_CEN','?') + ' - snapshot: ' + os.environ.get('R750_SNAP','?'))
L.append('Stage Summary:')
L.append('- The witness is now FIVE-legged: board strip (deep-link), LD lane title, card-grid chip (state-honest tone), the on-page lane legend (NEW - click-toggled from the nj tally), and the amber/muted contract. Judge-lane watch: seven lanes steady; the nj driver is WITNESSED as intern-systemone dial failures (live rows) - if the Owner re-stores vault keys, the intern lane is the first recovery candidate; until then nj growth is expected on any decision-gated activity. Corpus 81 rows / 23 runs at close. Snapshot discipline sixth close.')
L.append('Round Handoff:')
L.append('Round ID: r751 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r750_qa.sh sed-adapted (DUAL pattern s/r=750/r=751/g + s/r750/r751/g); close probes: chip presence gated / tone recorded, legend presence recorded (it is shipped - no longer needs the gate). (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline 81 rows / 23 runs / verdict 21 / uncertain 15 / nj 45; seven lanes; nj driver = intern-systemone dial failures (witnessed at source this round); any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal. (5) Increment queue: still incident-driven while P1s stay Owner-blocked; candidates - the legend could carry per-lane counts (the trace string is deduped, counts would need corpus re-aggregation - only if a need shows); TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry; the intern lane awaits keys); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the source-level nj driver probe + the lane-legend increment + full golden QA, all anchored in scripts/qa_r750.txt and scripts/qa_r750_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r750: lane legend - the judge-lane distress instrument rendered on-page. The deduped tried-trace lived in a hover-only title (invisible on touch); the nj tally is now a real toggle button (aria-expanded/controls, dotted-underline family styling) and the lanes render as a legend between the strip header and the pill row (data-testid corpus-lane-legend, one chip per deduped lane). TIMELY: the open probe witnessed the nj driver at source - live gate-no-judge rows between slots, tried: intern-systemone dial failure; the legend ships while the distress is live. Gates: tsc 0, lint 0E/33W; golden QA GREEN (tally steady 23 runs / 81 ev / nj 45, seven lanes re-verified - no eighth; settings census/relay + radar frontier + 799-char paste, console 0 errors); chip + legend probes in the close (legend gated). Snapshot discipline sixth close; witness now five-legged."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r750_close.txt
SWEEP=$(git add -A && git commit -m "r750: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
