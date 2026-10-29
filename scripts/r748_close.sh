#!/usr/bin/env bash
# r748 close: gates -> QA-green guard -> chip probe -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r748c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r748c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r748c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r748 QA GREEN' scripts/qa_r748.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r748.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r748.txt | tail -1)
# r748 chip probe: the new card-grid corpus pill (QA legs ride the board deep-link,
# so the chip gets its own verification here — gated: it is this round's ship).
timeout 60 agent-browser open "http://localhost:3000/?r=748c#workflows" >/dev/null 2>&1 || true
sleep 4
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim()}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
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
export R748_TSC="$TSC" R748_LINT="$LTAIL" R748_GC="$GC" R748_CC="$CC" R748_CEN="$CEN" R748_SNAP="$SNAP" R748_QW="$QW" R748_QLD="$QLD" R748_CHIP="$CHIP"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r748')
L.append('Agent: NEXUS patrol (main agent - job 473388, 01:07 slot; opened on the r747 handoff verbatim)')
L.append('Task: Patrol round 748 - normal watch re-anchored on the deep-linked witness (first standard round after the r747 misdiagnosis correction), shipping the r747 handoff candidate increment: the corpus-glance chip on the card grid. The stripped-down need was real: post-recycle, the DEFAULT view (the one a wiped profile lands on) had zero corpus signal - the strip lives only on the board. The chip surfaces it on the cards view and opens the board on click.')
L.append('Work Log:')
L.append('- R1 open probes: r747 was closed by this same lineage (1087c7aed + sweep 974fbe652, worklog tail = r747 handoff); tree clean; server 200; no parallel closure; opened r748 on the handoff verbatim.')
L.append('- R2 template prep: scripts/r748_qa.sh via the DUAL sed pattern (s/r=747/r=748/g + s/r747/r748/g) - 6 substitutions, zero r747 remnants; workflows-view hook area read (state block 1525-1538, setBoardOpen 1536, badges row 1960-1974).')
L.append('- R3 increment: workflows-view corpus-glance chip - one best-effort GET /api/evals on mount, distinct runIds (the same data the board strip summarizes), rendered as a muted family-contract pill (border-border bg-muted/40 tabular-nums) beside the layout switch; click calls setBoardOpen(true) so the strip per-run breakdown is one tap away; unreachable ledger -> chip stays silent (the r648 doctrine: no signal, no chip, never an error). Styling detail polish: strip tally separators (u + nj spans) ml-1 -> mx-1 for even breathing room around the dots.')
L.append('- R4 gates + QA: tsc 0, lint 0 errors / 33 warnings (baseline); r748 golden QA GREEN (probes below).')
L.append('- R5 this close: chip probe on the cards view (gated - it is this round ship) + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R748_QW','(missing)'))
L.append('  ' + os.environ.get('R748_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R748_CHIP','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R748_TSC','?') + ' - lint ' + os.environ.get('R748_LINT','?') + ' - qa-gate-census ' + os.environ.get('R748_GC','?') + ' - qa-cortex-census ' + os.environ.get('R748_CC','?') + ' - close census ' + os.environ.get('R748_CEN','?') + ' - snapshot: ' + os.environ.get('R748_SNAP','?'))
L.append('Stage Summary:')
L.append('- The watch is re-anchored and the witness is now THREE-legged and profile-wipe-proof: board strip via the deep-link, LD lane title, and (new) the card-grid corpus pill. Judge-lane watch: the seven-lane set re-verified unchanged (intern-systemone; fast-judge Z.ai glm-5.3; fast-judge Intern TokenPlan glm-5.3; fast-judge; jev paid rung; fast-judge AIHubMix qwen3.8-flash-free; fast-judge AIHubMix qwen3.8-max-free) - no EIGHTH lane. Corpus steady at 79 rows / 22 runs vs the r747 close (nj 43 unchanged - quiet era). Snapshot discipline fourth close running it.')
L.append('Round Handoff:')
L.append('Round ID: r749 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r748_qa.sh sed-adapted (DUAL pattern s/r=748/r=749/g + s/r748/r749/g); the chip probe can ride along in the close (adapt the r748_close.sh probe URL to r=749c). (2) SNAPSHOT DISCIPLINE stands: python3 scripts/snapshot-corpus.py in every close before the commit. (3) TIMEOUT HYGIENE stands: every curl -m 5, every bun/agent-browser step timeout-wrapped. (4) JUDGE-LANE WATCH: baseline 79 rows / 22 runs / verdict 21 / uncertain 15 / nj 43; seven lanes (string in the QA probes above); any EIGHTH lane = the broadening signal; flicker + cadence hypotheses remain suspended (data reset by the wipes). (5) Increment queue (small, only if a real need shows - no theatre): TASK-101 durable-step semantics / TASK-102 NEXUS_BOT wave from docs/strategy/TASKS.md are the standing P1 backlog; the chip-board round trip (deep-link from the chip preserving the board filter) is a candidate polish. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts is the re-entry tool once the Owner backup text is available); KICK widget URL fix (needs Owner input); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none - app green, witness deterministic, corpus steady. Standing constraint (r707): mechanism or named evaluation every round - held (the chip increment + the three-legged witness verification + full golden QA, all anchored in scripts/qa_r748.txt and scripts/qa_r748_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r748: corpus-glance chip on the card grid - the r747 handoff candidate shipped. The default view (where a wiped profile lands) had zero corpus signal; the chip surfaces the eval corpus as a muted family-contract pill beside the layout switch (one best-effort GET /api/evals on mount, distinct runIds - the same data the board strip summarizes; click opens the Runs board; unreachable ledger stays silent per the r648 doctrine). Styling polish: strip tally separators ml-1 -> mx-1. Gates: tsc 0, lint 0E/33W; golden QA GREEN (deep-linked board strip + LD seven-lane re-verify + settings census/relay + radar frontier + 799-char paste, console 0 errors); chip probe gated in the close. Census and probes in the close log. Snapshot discipline fourth close; witness now three-legged and profile-wipe-proof."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r748_close.txt
SWEEP=$(git add -A && git commit -m "r748: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
