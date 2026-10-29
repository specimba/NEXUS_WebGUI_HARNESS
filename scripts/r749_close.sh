#!/usr/bin/env bash
# r749 close: gates -> QA-green guard -> chip probe (tone recorded) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r749c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r749c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r749c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r749 QA GREEN' scripts/qa_r749.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r749.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r749.txt | tail -1)
# r749 chip probe: presence GATED; the amber distress tone RECORDED only —
# the tone is state-honest (amber iff corpus non-empty AND store has no runs),
# so which tone shows depends on live store state, not on correctness.
timeout 60 agent-browser open "http://localhost:3000/?r=749c#workflows" >/dev/null 2>&1 || true
sleep 4
# never trust the persisted layout bit (the r747 doctrine): the QA board leg
# just persisted boardOpen:true — force the card grid before probing the chip.
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
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
export R749_TSC="$TSC" R749_LINT="$LTAIL" R749_GC="$GC" R749_CC="$CC" R749_CEN="$CEN" R749_SNAP="$SNAP" R749_QW="$QW" R749_QLD="$QLD" R749_CHIP="$CHIP"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r749')
L.append('Agent: NEXUS patrol (main agent - job 473388, 01:37 slot; opened on the r748 handoff verbatim)')
L.append('Task: Patrol round 749 - normal watch + incident-driven increment: the corpus-DISTRESS tone on the chip. Backlog triage FIRST (disclosed): the task frame TASK-101/TASK-102 IDs are STALE - docs/platform/cron-creation-criteria.md:49 marks them gone ("do not chase them"); the real open P1 rows in docs/strategy/TASKS.md are Owner-blocked (GitHub PAT rotation needs the Owner PAT; Webshare token paste needs the Owner token) or key-blocked (NEXUS_BOT wave remaining item = live-wire keyed proofs, vault empty post-wipe); the harness-adapter-spec NEXT slice (HTTP route) explicitly "needs an Owner nod". With every documented row blocked, the round ships the r745-lesson feature instead: the post-wipe distress shape (corpus non-empty, pipeline store zero runs) now renders as an amber chip on the default view - the exact signal whose absence cost r745-r746 three diagnostic rounds.')
L.append('Work Log:')
L.append('- R1 open probes: r748 closed by this same lineage (bfac100e1 + sweep 2ae12026f); tree clean; server 200; no parallel closure; opened r749 on the handoff verbatim.')
L.append('- R2 backlog triage + template: r749_qa.sh via the DUAL sed pattern (s/r=748/r=749/g + s/r748/r749/g) - 6 substitutions, zero r748 remnants; TASKS.md / cron-creation-criteria.md / harness-adapter-spec.md read - all open rows blocked on Owner input or keys (sources above).')
L.append('- R3 increment: workflows-view - storeRunCount memo + corpusDistress const (corpus non-empty AND store zero runs); the chip now renders amber (border-amber-500/40 bg-amber-500/10 text-amber-600 - the r718 u/uncertain family tone) with a "board empty" suffix + distress title when the shape holds, muted otherwise; chip hidden while the board is open (the strip already lives there - dedup, not removal); aria-label gained the distress clause for screen readers.')
L.append('- R4 gates + QA: tsc 0, lint 0 errors / 33 warnings (baseline); r749 golden QA GREEN. NOTED: the corpus GREW between slots - tally 23 runs / 81 ev / nj 45 (was 22/79/43 at the r748 close): gate activity resumed; the seven-lane set re-verified unchanged, no EIGHTH lane.')
L.append('- R5 this close: chip probe (presence gated, tone recorded) + snapshot + worklog + commit + dual push. FIRST ATTEMPT GUARD-TRIPPED (disclosed): chip:false - the QA board leg had just persisted boardOpen:true via the deep-link (the r747 design: bare #/workflows honors the persisted bit), so the card grid was not showing and the chip (correctly hidden while the board is open) was absent. The guard aborted BEFORE any commit - it did its job. The probe now clicks the Card-grid radio first (the same never-trust-the-persisted-bit doctrine the deep-link taught), then re-probes.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R749_QW','(missing)'))
L.append('  ' + os.environ.get('R749_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R749_CHIP','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R749_TSC','?') + ' - lint ' + os.environ.get('R749_LINT','?') + ' - qa-gate-census ' + os.environ.get('R749_GC','?') + ' - qa-cortex-census ' + os.environ.get('R749_CC','?') + ' - close census ' + os.environ.get('R749_CEN','?') + ' - snapshot: ' + os.environ.get('R749_SNAP','?'))
L.append('Stage Summary:')
L.append('- The witness is now FOUR-legged: board strip (deep-link), LD lane title, card-grid chip (tone carries the r745 distress semantics), and the amber/muted state contract. Judge-lane watch: seven lanes steady through the first post-wipe corpus growth (+2 events / +1 run / +2 nj) - no broadening. Corpus 81 rows / 23 runs at close. Snapshot discipline fifth close. Backlog honesty recorded: every open P1 row is Owner-blocked or key-blocked - the patrol ships incident-driven increments until the Owner unblocks (PAT, Webshare token, vault backup text, harness-adapter nod).')
L.append('Round Handoff:')
L.append('Round ID: r750 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r749_qa.sh sed-adapted (DUAL pattern s/r=749/r=750/g + s/r749/r=750/g - careful: use the proven pair s/r=749/r=750/g + s/r749/r750/g); chip probe in the close adapted to r=750c - GATE only chip presence, RECORD the tone (amber iff store holds zero runs; if runs returned to the store the muted tone is CORRECT, do not "fix" it). (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline now 81 rows / 23 runs / verdict 21 / uncertain 15 / nj 45; seven lanes (string in the QA probes); any EIGHTH lane = the broadening signal - the corpus just showed first growth, watch the next slots for cadence. (5) Increment queue: still incident-driven while P1s stay blocked; candidates - the chip deep-link could carry boardWorkflowFilter once filters matter; TASKS.md re-triage if the Owner unblocks any row. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts is the re-entry tool); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress probe 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; all remaining P1 backlog rows blocked on Owner input (disclosed above with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the backlog triage with sources + the distress-tone increment + full golden QA, all anchored in scripts/qa_r749.txt and scripts/qa_r749_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r749: corpus-distress tone on the chip - the r745 lesson rendered. Backlog triage disclosed: TASK-101/102 IDs are stale (cron-creation-criteria.md:49); every open TASKS.md P1 row is Owner-blocked (GitHub PAT, Webshare token) or key-blocked (NEXUS_BOT live-wire proofs, vault empty); harness-adapter HTTP route needs an Owner nod. Increment: when the corpus holds runs but the pipeline store holds zero runs (the exact post-wipe shape that cost r745-r746 three diagnostic rounds), the card-grid chip renders amber with a board-empty suffix and a distress title; muted otherwise; hidden while the board is open (strip dedup); aria-label carries the state. Gates: tsc 0, lint 0E/33W; golden QA GREEN (board strip + LD seven-lane re-verify - corpus GREW to 23 runs / 81 ev / nj 45 between slots, no eighth lane - settings census/relay + radar frontier + 799-char paste, console 0 errors); chip probe gated in the close. Census and probes in the close log. Snapshot discipline fifth close; witness now four-legged."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r749_close.txt
SWEEP=$(git add -A && git commit -m "r749: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
