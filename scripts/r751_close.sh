#!/usr/bin/env bash
# r751 close: gates -> QA-green guard -> chip probe -> lane-legend probe (gated; counts are the round ship) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r751c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r751c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r751c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r751 QA GREEN' scripts/qa_r751.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r751.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r751.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=751c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the r751 ship: per-lane counts): click the nj button, verify the panel mounts. GATED.
timeout 60 agent-browser open "http://localhost:3000/?r=751b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
# escaped-quote-tolerant (the known agent-browser quirk: eval output is JSON-encoded)
echo "$NJCLICK" | grep -q 'clicked' || { echo 'GUARD legend nj-button'; exit 1; }
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,80)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
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
export R751_TSC="$TSC" R751_LINT="$LTAIL" R751_GC="$GC" R751_CC="$CC" R751_CEN="$CEN" R751_SNAP="$SNAP" R751_QW="$QW" R751_QLD="$QLD" R751_CHIP="$CHIP" R751_LEG="$LEG"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r751')
L.append('Agent: NEXUS patrol (main agent - job 473388, 02:37 slot; opened on the r750 handoff verbatim)')
L.append('Task: Patrol round 751 - normal watch + the legend-counts increment: the r750 legend NAMED the failing lanes but carried no magnitude; the handoff flagged per-lane counts as needing corpus re-aggregation "only if a need shows" - the need shows (intern-systemone dial failures live at source, witnessed r750 at the newest rows). laneCountsOf tallies every tried-trace match behind the same noJudge gate; the legend chips now carry xN badges so the distress driver is measurable, not just nameable.')
L.append('Work Log:')
L.append('- R1 open probes: r750 closed by the 02:07 slot (032e58d06 ship + a3416cf77 sweep); tree clean; server 200; opened r751 on the handoff verbatim.')
L.append('- R2 templates + anchors: r751_qa.sh + r751_close.sh via the DUAL sed pattern (s/r=750/r=751/g + s/r750/r751/g) - zero r750 remnants (the uppercase R750_ env names fixed in the close rewrite); anchors read (laneDistressOf :279, strip memos :1517, legend :2064).')
L.append('- R3 increment (run-kanban.tsx, four edits): laneCountsOf helper beside laneDistressOf (same regex, same gateCensusOf noJudge gate, tallying Record instead of the dedup push); laneCounts memo beside laneDistress; panel title states the honest semantics (counts are trace ENTRIES - a step that tried several lanes counts each, so the sum can exceed the no-judge step count); each legend chip gains a count badge (rounded-full bg-amber-500/10 px-1 font-semibold tabular-nums text-amber-700 dark:text-amber-400, per-chip title) rendering the xN figure. The badge is the styling polish; the magnitude is the feature.')
L.append('- R4 gates + QA: tsc 0, lint 0 errors / 33 warnings (baseline); r751 golden QA GREEN (census recorded in GATES below); seven-lane set re-verified via the LD title probe - no EIGHTH lane.')
L.append('- R5 this close: chip probe (cards view, grid-click first - presence GATED, tone RECORDED) + lane-legend probe (board view, nj-click verified, GATED - the legend is the round ship again this round; the label slice widened 48->80 so the count badges surface in the probe line) + census + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R751_QW','(missing)'))
L.append('  ' + os.environ.get('R751_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R751_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R751_LEG','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R751_TSC','?') + ' - lint ' + os.environ.get('R751_LINT','?') + ' - qa-gate-census ' + os.environ.get('R751_GC','?') + ' - qa-cortex-census ' + os.environ.get('R751_CC','?') + ' - close census ' + os.environ.get('R751_CEN','?') + ' - snapshot: ' + os.environ.get('R751_SNAP','?'))
L.append('Stage Summary:')
L.append('- The fifth witness leg (the lane legend) now carries MAGNITUDE, not just membership: the per-lane xN badges make the distress driver measurable on-page - intern-systemone is expected to dominate while the vault keys stay unrestored, and slot-over-slot drift in its count is the dial-failure cadence instrument the suspended hypotheses needed. Judge-lane watch: seven lanes steady; census at close in GATES; any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal. Snapshot discipline seventh close. Witness stays five-legged with a deeper fifth leg.')
L.append('Round Handoff:')
L.append('Round ID: r752 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r751_qa.sh sed-adapted (DUAL pattern s/r=751/r=752/g + s/r751/r752/g); close probes: chip presence gated / tone recorded; legend presence RECORDED (counts shipped r751 - gate it only if the round touches the legend again). (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: new baseline = the GATES census line of this close; seven lanes; the xN badges now give the cadence instrument - if intern-systemone\'s count climbs slot over slot while others hold, that is the dial-failure cadence signal; any EIGHTH lane = broadening. (5) Increment queue: still incident-driven while P1s stay Owner-blocked; candidates - legend chips could filter the strip pills by lane (honest note: pillFilter matches runId substrings only, lane filtering needs a row-level scan of which runs\' notes contain the lane - feasible if a need shows); TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry; the intern lane awaits keys); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the laneCountsOf re-aggregation increment + full golden QA + the counts-bearing legend probe, all anchored in scripts/qa_r751.txt and scripts/qa_r751_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r751: legend per-lane counts - the distress driver is measurable, not just nameable. The r750 legend carried deduped lane names only; laneCountsOf (same verbatim tried-trace scan as laneDistressOf - same regex, same noJudge gate - tallying instead of deduping) puts an xN badge on every legend chip (rounded-full amber-tinted tabular-nums, per-chip + panel titles stating the honest semantics: counts are trace entries, a step that tried several lanes counts each, so the sum can exceed the no-judge step count). TIMELY: intern-systemone dial failures (witnessed at source r750) now read as a number on-page. Gates: tsc 0, lint 0E/33W; golden QA GREEN (settings census/relay + radar frontier + 799-char paste, console 0 errors; seven lanes re-verified - no eighth); chip probe gated/tone-recorded; legend probe gated (round ship). Snapshot discipline seventh close; the fifth witness leg now carries magnitude."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r751_close.txt
SWEEP=$(git add -A && git commit -m "r751: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
