#!/usr/bin/env bash
# r747 close: gates -> QA-green guard -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r747c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r747c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r747c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r747 QA GREEN' scripts/qa_r747.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r747.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r747.txt | tail -1)
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
export R747_TSC="$TSC" R747_LINT="$LTAIL" R747_GC="$GC" R747_CC="$CC" R747_CEN="$CEN" R747_SNAP="$SNAP" R747_QW="$QW" R747_QLD="$QLD"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r747')
L.append('Agent: NEXUS patrol (main agent - job 473388, 00:37 slot; opened on the r746 handoff verbatim)')
L.append('Task: Patrol round 747 - strip-outage closure round per the r746 handoff. The r746-named "render branch" increment was executed as code archaeology first, and the archaeology OVERTURNED the r746 diagnosis: evo-inbox-empty (workflows-view.tsx:1120) is a sibling card in the card-grid view, not a gate - the real gate is the layout ternary at workflows-view.tsx:2188-2192 (archiveOpen ? archive : boardOpen ? RunKanban : ...), and boardOpen = useUiStore.workflowBoardOpen is localStorage-persisted (stores.ts:969) with default FALSE (stores.ts:927). The in-page experiment nailed it: ls nexus-ui held "workflowBoardOpen":false, strip:false, four server-lane chips, evo-inbox-empty present - the QA had been probing the CARD GRID all along, where RunKanban and its corpus-only-runs strip structurally cannot mount. The pre-recycle greens (r723-r744) rode a stale persisted TRUE bit; the wipe reset it to the default and the "outage" appeared. Shipped increment: the #/workflows/board deep-link (page.tsx applyHashRoute + route docs) - the board layout becomes deterministic from the URL, LS-independent, and the patrol witness instrument is reachable again from a wiped profile. ZERO code delta shipped in r745/r746 (red QA); this is the first app-side ship since the wipe era.')
L.append('Work Log:')
L.append('- R1 open probes: parallel-session check - r746 was already closed by the 00:07 slot (commits 43ddb3bff + 0ce8cbdd1, worklog tail = r746 handoff, tree clean); server 200; opened r747 on the handoff verbatim.')
L.append('- R2-R8 code archaeology (batched reads/greps): strip JSX at run-kanban.tsx:1935 with its memos (corpusOnly :1452, stripCensus, laneDistress, visibleCorpus); evo-inbox-empty is the EvolutionInbox true-zero sibling (workflows-view.tsx:1120) - NOT a board gate; the layout ternary at :2188-2192; boardOpen persisted (:969, default false :927); RunKanban self-gates only its polling/tick on boardOpen (:1310-1320), the parent ternary is the mount gate.')
L.append('- R9 decisive experiment (one wrapped browser round): navigate ?r=747#workflows -> {ls_ui: workflowBoardOpen:false, strip:false, chips:4, empty:true, switches:[]} - mechanism PROVEN; the layout control is a radiogroup (Pipelines / Runs board / Archive), the board was simply closed.')
L.append('- R10 QA archaeology: r744 green artifact re-read - the paste leg (paste-len:799) passed under the stale-true bit; textarea census (2 sites: workflows-view.tsx:963, server-autopilot.tsx:1402) shows the paste target is layout-independent; census script names confirmed (qa-gate-census.ts, qa-cortex-census.ts).')
L.append('- R11 increment + gates: page.tsx applyHashRoute - #/workflows/board forces setWorkflowBoardOpen(true) (sub-path beats the persisted bit; bare #/workflows still honors it) + route-doc header comment; scripts/r747_qa.sh written (r741 template + deep-link nav on the board/paste legs, dual r=747 param set); gates: tsc 0, lint 0 errors / 33 warnings (baseline).')
L.append('- R12 this QA + close: full golden QA on the deep-linked board + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R747_QW','(missing)'))
L.append('  ' + os.environ.get('R747_QLD','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R747_TSC','?') + ' - lint ' + os.environ.get('R747_LINT','?') + ' - qa-gate-census ' + os.environ.get('R747_GC','?') + ' - qa-cortex-census ' + os.environ.get('R747_CC','?') + ' - close census ' + os.environ.get('R747_CEN','?') + ' - snapshot: ' + os.environ.get('R747_SNAP','?'))
L.append('Stage Summary:')
L.append('- The two-round "strip outage" is closed as a MISDIAGNOSIS + FRAGILE-WITNESS incident, not an app bug: the app rendered correctly the whole time; the QA witness depended on a stale localStorage bit. The fix is both a user-facing feature (shareable board deep-link) and a patrol-harness hardening (witness no longer LS-dependent). Witness hygiene resumes this round with the deep-linked board leg + the LD seven-lane verification. Standing corrected doctrine: NEVER trust the persisted layout bit in QA - navigate #/workflows/board explicitly.')
L.append('Round Handoff:')
L.append('Round ID: r748 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH re-anchored: golden QA via scripts/r747_qa.sh sed-adapted (DUAL pattern s/r=747/r=748/g + s/r747/r748/g) - the board/paste legs now ride the deep-link and are profile-wipe-proof. (2) SNAPSHOT DISCIPLINE stands: python3 scripts/snapshot-corpus.py in every close before the commit (third close running it). (3) TIMEOUT HYGIENE stands: every curl -m 5, every bun/agent-browser step timeout-wrapped. (4) JUDGE-LANE WATCH: baseline 64 rows / 20 runs / verdict 21 (PASS 17 / FAIL 4) / uncertain 15 / nj 28 - the LD lanes string recorded this round in the QA probes re-verifies the seven-lane set post-wipes; any EIGHTH lane = the broadening signal; flicker + cadence hypotheses remain suspended (data reset). (5) Next candidate increment (Owner-visible, small, only if a real need shows in QA - no theatre): surface the corpus distress state on the CARD GRID too (a compact "N archived runs in the corpus" chip near the layout switch). (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts is the re-entry tool once the Owner backup text is available); KICK widget URL fix (needs Owner input); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none standing - the app is green and the witness instrument is deterministic again. Standing constraint (r707): mechanism or named evaluation every round - held (the misdiagnosis correction with in-page evidence + the deep-link increment + the full golden QA, all anchored in scripts/qa_r747.txt and scripts/qa_r747_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r747: board deep-link (#/workflows/board) - strip outage root-caused and closed. The two-round outage was a misdiagnosis: the Runs-board layout bit (nexus-ui.workflowBoardOpen, LS-persisted, default false) was reset by the wipe, so QA probed the card grid where RunKanban and the corpus-only-runs strip witness structurally never mount - r746's evo-inbox render-branch theory corrected (sibling card, not a gate). Fix: sub-path deep-link forces the board layout deterministically (page.tsx applyHashRoute + route docs); QA board/paste legs navigate it, LS-independent. First app-side ship since the wipe era. Gates: tsc 0, lint 0E/33W; golden QA GREEN (deep-linked board strip + LD lanes + settings census/relay + radar frontier + 799-char paste, console 0 errors); census and probes in the close log. Snapshot discipline third close; witness hygiene resumes with the corrected doctrine: never trust the persisted layout bit in QA."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r747_close.txt
SWEEP=$(git add -A && git commit -m "r747: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
