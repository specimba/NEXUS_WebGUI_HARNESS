#!/usr/bin/env bash
# r753 close: gates -> QA-green guard -> chip probe -> lane-legend probe (gated; chips edited) -> lane-filter probe (gated; exercises edited chip internals) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r753c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r753c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r753c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r753 QA GREEN' scripts/qa_r753.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r753.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r753.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=753c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips edited this round): click the nj button, verify the panel mounts. GATED.
timeout 60 agent-browser open "http://localhost:3000/?r=753b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
echo "$NJCLICK" | grep -q 'clicked' || { echo 'GUARD legend nj-button'; exit 1; }
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend panel'; exit 1; }
# lane-filter probe (exercises the edited chip internals): click the first legend chip, verify aria-pressed + the shown-count chip + the tally still describing the whole corpus, then untoggle. GATED.
LCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[data-testid=\"corpus-lane-legend\"] button'); if(!b) return 'legend-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "lane filter click: $LCLICK"
echo "$LCLICK" | grep -q 'clicked' || { echo 'GUARD lane-filter click'; exit 1; }
sleep 1
LF=$(timeout 30 agent-browser eval "(() => { const on=document.querySelector('[data-testid=\"corpus-lane-legend\"] button[aria-pressed=\"true\"]'); const shown=[...document.querySelectorAll('span')].some(x=>/ of .* shown/.test(x.textContent||'')); const tally=[...document.querySelectorAll('span')].some(x=>/runs . \\d+ ev/.test(x.textContent||'')); return JSON.stringify({pressed:!!on, shownChip:shown, tallyWholeCorpus:tally}); })()" 2>&1 | tail -1)
echo "lane filter: $LF"
echo "$LF" | grep -Eq 'pressed\\?":true' || { echo 'GUARD lane-filter state'; exit 1; }
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
export R753_TSC="$TSC" R753_LINT="$LTAIL" R753_GC="$GC" R753_CC="$CC" R753_CEN="$CEN" R753_SNAP="$SNAP" R753_QW="$QW" R753_QLD="$QLD" R753_CHIP="$CHIP" R753_LEG="$LEG" R753_LF="$LF"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r753')
L.append('Agent: NEXUS patrol (main agent - job 473388, 03:37 slot; opened on the r752 handoff verbatim)')
L.append('Task: Patrol round 753 - normal watch + the legend-ergonomics increment (both handoff candidates in one coherent ship): the legend chips now sort by dial-attempt count DESCENDING (stable sort; ties keep ledger insertion order) so the distress driver reads first, and each chip carries a second magnitude - DISTINCT runs affected (runs whose ledger rows name the lane) - beside the xN badge. The two figures answer different questions: how many dials vs how many runs. ALSO: QA-finding fix - the r752 close probe recorded tallyWholeCorpus:false on a PROBE-side regex bug (/ runs . ev/ cannot span "runs · 82 ev"; the app tally was fine and unconditional) - the r753 close probe uses /runs . \\d+ ev/ and GATES on it, turning the false negative into a real assertion.')
L.append('Work Log:')
L.append('- R1 open probes: r752 closed by the 03:07 slot (85f36165c ship + 8d2d7d65e sweep); tree clean; server 200; opened r753 on the handoff verbatim; r752 baseline census 82 rows / 24 runs / verdict 21 / uncertain 15 / nj 46.')
L.append('- R2 templates: r753_qa.sh + r753_close.sh via the DUAL sed pattern (s/r=752/r=753/g + s/r752/r753/g) - zero remnants; chip-render anchors known verbatim (authored r751/r752).')
L.append('- R3 increment (run-kanban.tsx, four edits): laneRunCountsOf helper (same verbatim scan as laneCountsOf, per-lane Set of runIds -> distinct-run counts); laneRunCounts memo; the legend map sorts a COPY by laneCounts desc; chip gains a muted "N runs" figure beside the xN badge and its title carries both magnitudes ("N dial attempt(s) across M run(s) affected").')
L.append('- R4 gates + QA: tsc 0, lint 0 errors / 33 warnings (baseline); r753 golden QA GREEN (census in GATES below); seven-lane set re-verified via the LD title probe - no EIGHTH lane.')
L.append('- R5 this close: chip probe (gated/tone recorded) + legend probe (GATED - the chip internals were edited) + lane-filter probe (GATED - it exercises the edited chips; its tally assertion now uses the FIXED regex) + census + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R753_QW','(missing)'))
L.append('  ' + os.environ.get('R753_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R753_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R753_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R753_LF','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R753_TSC','?') + ' - lint ' + os.environ.get('R753_LINT','?') + ' - qa-gate-census ' + os.environ.get('R753_GC','?') + ' - qa-cortex-census ' + os.environ.get('R753_CC','?') + ' - close census ' + os.environ.get('R753_CEN','?') + ' - snapshot: ' + os.environ.get('R753_SNAP','?'))
L.append('Stage Summary:')
L.append('- The legend now reads driver-first with TWO magnitudes per lane (dials xN, runs affected) - the instrument answers how often, where, and how broad, all on-page. Witness stays five-legged; the fifth leg deepened again. Judge-lane watch: census in GATES (r752 baseline 82/24/21/15/46); seven lanes steady; intern-systemone x46 slot-over-slot drift is the cadence signal. Snapshot discipline ninth close. Probe-honesty note: the r752 tally false-negative was probe-side and is now a gated assertion (disclosed above).')
L.append('Round Handoff:')
L.append('Round ID: r754 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r753_qa.sh sed-adapted (DUAL pattern s/r=753/r=754/g + s/r753/r754/g); close probes: chip presence gated / tone recorded; legend + lane-filter probes RECORDED unless the round touches the chips again (the fixed tally assertion stays gated - it is cheap and catches real regressions). (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; xN drift slot-over-slot = the cadence instrument; runs-affected figure now shows BREADTH - if intern dials grow while its runs figure stays flat, the failures concentrate in few runs; any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal. (5) Increment queue: still incident-driven while P1s stay Owner-blocked; if the corpus grows another wave, a "first seen" timestamp per lane (dials over time) is the next candidate; otherwise a pure watch round is legitimate. TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry; the intern lane awaits keys); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the legend-ergonomics increment + the probe-regex fix + full golden QA, all anchored in scripts/qa_r753.txt and scripts/qa_r753_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r753: legend ergonomics - driver-first sort + runs-affected magnitude. The legend chips now sort by dial-attempt count descending (stable sort; ties keep ledger insertion order) so the distress driver reads first, and each chip carries a second figure beside the xN badge: the number of DISTINCT runs whose ledger rows name the lane (laneRunCountsOf - same verbatim scan, per-lane runId sets), answering 'how many dials' and 'how many runs' as different questions. Chip titles carry both magnitudes. ALSO fixed a probe-side regex bug from r752 (tallyWholeCorpus:false was a false negative - / runs . ev/ cannot span 'runs · 82 ev'); the assertion now uses /runs . \d+ ev/ and is gated. Gates: tsc 0, lint 0E/33W; golden QA GREEN (seven lanes re-verified - no eighth; settings census/relay + radar frontier + 799-char paste, console 0 errors); chip + legend + lane-filter probes gated (chip internals edited). Snapshot discipline ninth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r753_close.txt
SWEEP=$(git add -A && git commit -m "r753: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
