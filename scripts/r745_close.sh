#!/usr/bin/env bash
# r745 close chain — RECOVERY round, honest-close variant.
# Restructure vs r722..r744 precedent (disclosed): the sweep runs INSIDE this
# script AFTER the tee pipeline, so no separate sweep round is needed and the
# close log artifact still lands committed.
set -u
cd /home/z/my-project
{
echo "== r745 close (recovery round) =="
echo "--- seedwrite non-interactive probe (r746 handoff data) ---"
SW=$(timeout 20 bun scripts/seedwrite.ts < /dev/null 2>&1 | head -3 || echo 'seedwrite-eof-FAILED')
echo "seedwrite_probe: $SW"
echo "--- server state ---"
SRV=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "http://localhost:3000/?r=745c#workflows" || echo 'curl-DEAD')
echo "server:$SRV"
echo "--- strip check (timeout-wrapped browser) ---"
STRIP=$(timeout 20 agent-browser eval "JSON.stringify({strip:!!document.querySelector('[data-testid=\"corpus-only-runs\"]'),wfChips:document.querySelectorAll('[data-testid=\"server-lane-unregistered-chip\"]').length,empty:!!document.querySelector('[data-testid=\"evo-inbox-empty\"]')})" 2>/dev/null || echo 'browser-WEDGED-OR-TIMEOUT')
echo "strip: $STRIP"
echo "--- gates (timeout-wrapped; results RECORDED not gated — QA red round, no ship) ---"
timeout 120 bunx tsc --noEmit > scripts/qa_r745_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"
timeout 120 bun run lint > scripts/qa_r745_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r745_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"
GC=$(timeout 30 bun scripts/qa-gate-census.ts 2>&1 | tail -1)
CC=$(timeout 30 bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "cortex: $CC"
echo "--- DB-level snapshot (durability increment) ---"
SNAP=$(timeout 30 python3 scripts/snapshot-corpus.py || echo 'snapshot-FAILED')
echo "snapshot: $SNAP"
CEN=$(python3 -c "
import sqlite3,json
c=sqlite3.connect('file:/home/z/my-project/db/custom.db?mode=ro',uri=True)
n=c.execute('select count(*) from EvalEvent').fetchone()[0]
nj=c.execute(\"select count(*) from EvalEvent where kind='gate-no-judge'\").fetchone()[0]
vd=c.execute(\"select count(*) from EvalEvent where kind='gate-verdict'\").fetchone()[0]
un=c.execute(\"select count(*) from EvalEvent where kind='gate-uncertain'\").fetchone()[0]
rn=c.execute('select count(distinct runId) from EvalEvent').fetchone()[0]
wf=c.execute('select count(*) from AutomationWorkflow').fetchone()[0]
print(json.dumps({'total':n,'runs':rn,'verdict':vd,'uncertain':un,'nj':nj,'wf':wf}))
")
echo "census: $CEN"
export R745_TSC="$TSC" R745_LINTLINE="$LINTLINE" R745_GC="$GC" R745_CC="$CC" \
       R745_CEN="$CEN" R745_SRV="$SRV" R745_STRIP="$STRIP" R745_SW="$SW" R745_SNAP="$SNAP"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r745')
L.append('Agent: NEXUS patrol (main agent — job 473388, 23:37 slot; opened on the r744 handoff verbatim)')
L.append('Task: Patrol round 745 — RECOVERY round. The sandbox rolled back to the 10-28 snapshot (r724 era) between the 23:07 and 23:37 slots: worklog tail read r724, git top 58c565474, zero r725..r744 artifacts, EvalEvent 0 rows — the SECOND recycle wipe (r725 first). Recovery executed from remote truth: origin/main verified at 6708180d7 (r744 sweep, remote worklog tail = the r745 handoff); git reset --hard origin/main restored the full tree; corpus restored from db/corpus-snapshots/latest.json = 64 rows (the 19:14 +08 snapshot; the post-snapshot tail of 19 rows — nj 28→45 growth incl. both flicker PASSes — is lost from the DB, disclosed; the worklog/git retain the full record). Dev server restarted once (the round single allowed restart). APP RESTORATION INCOMPLETE: AutomationWorkflow/AutomationRun/AutomationVault all 0 (the r725-class wipe profile) — the workflows inbox renders evo-inbox-empty + six server-lane-unregistered-chip and the corpus-only-runs strip does NOT mount, so the golden-QA board leg stayed RED (strip:false, three attempts). Golden QA therefore NOT green this round — per the no-ship-on-red rule, ZERO code delta shipped; the round ships recovery state + tooling only.')
L.append('Work Log:')
L.append('- RECOVERY SEQUENCE: R1 assess batch (worklog tail r724 + git 58c565474 + server 200 + probe ok) → R2 remote-truth assessment (fetch: origin/main 6708180d7 advanced from local; remote worklog tail = r745 handoff; local DB {"rows":0,"runs":0}; local r725..r744 scripts: 0) → R3 git reset --hard origin/main (tree back to r744; worklog tail r744; r744 templates + corpus snapshots present) → R4 corpus-restore.ts (64 rows restored: 20 runs · verdict 21 · uncertain 15 · nj 28; PASS 17 / FAIL 4) + dev-restart (the ONE restart) → R5..R7 QA strip:false ×2, warm retry strip:false, diagnosis: API /api/evals serves the corpus fine (total 64), console clean, tables show the wipe profile (wf 0 / runs 0 / vault 0 / TrackedModel 1368 survived); .next cleared → rebuild request returned 500 (root SSR crashes on the empty AutomationWorkflow state) → R8 seed-mechanism hunt (corpus-recover-r725.ts found — the r725 precedent) → R9 ran it: correctly REFUSED (one-shot for the empty case; corpus already 64) and it covers EvalEvent only, not workflows → R10 seed attempt chain TIMED OUT at the 300s tool cap → R11 timeout-wrapped dual-seeder chain TIMED OUT again at 280s (two consecutive tool-call timeouts — per the timeout protocol the Owner is advised: if the next slot also stalls, restart the session; the prime suspect is curl without -m hanging on a wedged dev server, plus a possible interactive prompt inside seedwrite.ts).')
L.append('- SEEDWRITE PROBE (this close, non-interactive stdin): '+os.environ.get('R745_SW','')+' — r746 handoff data: if seedwrite.ts dies immediately on EOF stdin it is prompt-gated (run it with answers piped or fix the prompt); if it hangs anyway the hang is elsewhere.')
L.append('- SERVER + STRIP (this close): server '+os.environ.get('R745_SRV','')+' · strip probe '+os.environ.get('R745_STRIP','')+' — recorded as-is; the r746 opener re-checks both.')
L.append('- GATES (recorded, not gated — QA red round): tsc_exit='+os.environ.get('R745_TSC','')+' · lint '+os.environ.get('R745_LINTLINE','')+' · qa-gate-census '+os.environ.get('R745_GC','')+' · qa-cortex-census '+os.environ.get('R745_CC','')+' · close census '+os.environ.get('R745_CEN',''))
L.append('- INCREMENT (durability tooling, DB-level, app-independent): scripts/snapshot-corpus.py — dumps EvalEvent to db/corpus-snapshots/ in the exact {takenAt,count,rows} shape corpus-restore.ts reads, written at every close from now on. Motivated directly by THIS incident: the stale snapshotter stopped at 19:14 +08 and cost 19 rows. Close log: '+os.environ.get('R745_SNAP','')+' — r746+ close chains must call it before the commit so every recycle loses at most one slot.')
L.append('- NO-SHIP DISPOSITION: golden QA RED (board leg strip:false ×3 across attempts; settings/radar/paste legs never reached) → no code ship, no gates-gated commit of src (zero src delta exists); the frame commit requirement is satisfied by the recovery state + worklog + tooling + snapshot artifact, with the red QA disclosed here and in the commit message. Witness hygiene count: NOT counted this round (no three-way agreement was possible); the r739-r744 streak (six slots) is recorded as historically intact.')
L.append('- BUDGET: 12/12 — AT the cap, disclosed: R1 assess, R2 remote-truth, R3 reset, R4 restore+restart, R5 QA attempt (guard trip), R6 warm+retry (trip), R7 diagnosis+cache clear, R8 seed hunt, R9 r725-recover refusal, R10 seed chain timeout, R11 wrapped recovery timeout, R12 this single-turn honest close (snapshot script + close script + run + in-script sweep). The restructure (sweep inside the script, post-tee) saves the old separate sweep round and is the new template going forward.')
L.append('Stage Summary:')
L.append('- The recycle struck between slots and the patrol recovered the tree and corpus from remote truth, but the app is not fully back: workflows tables empty, board strip blocked, QA red — and the two seed attempts timed out. The honest close commits the recovery state, the durability increment, and the full evidence trail. r746 must finish app restoration BEFORE anything else: seed workflows (probe-guided), verify strip mounts, then the standard watch. Platform carry UPGRADED to urgent: two recycle wipes now (r725, r745) — report the runtime-table wipe pattern + the .archive-snapshot-1028 disposition to the platform; vault re-store BACKUP-FIRST + Cortex P1 v2 unchanged.')
L.append('Round Handoff:')
L.append('Round ID: r746 -> next patrol (job 473388)')
L.append('Next recommended action: (1) APP RESTORATION FIRST (blocking everything): check server (curl -m 5), then seed AutomationWorkflow — run the seedwrite probe result from the r745 close log (scripts/qa_r745_close.txt): if it is prompt-gated, pipe the answers or fix the prompt; if it hangs, try db-recover.sh / r693-recover.sh / qa-seedwrite.ts as alternates; verify wf>0 then the corpus-only-runs strip mounts (?r=746#workflows), then run the FULL golden QA (r745_qa.sh sed-adapted to r746, dual pattern s/r=745/r=746/g + s/r745/r746/g) and only then proceed as a normal round. (2) TIMEOUT HYGIENE (this round lesson): every curl gets -m 5; every bun/agent-browser step gets timeout-wrapped; the R10/R11 tool-call timeouts are the documented failure shape. (3) SNAPSHOT DISCIPLINE (r745 increment): close chains call python3 scripts/snapshot-corpus.py before the commit — every close refreshes db/corpus-snapshots/latest.json so recycles lose at most one slot. (4) JUDGE-LANE WATCH (re-anchored): restored baseline 64 rows · 20 runs · verdict 21 (PASS 17 / FAIL 4) · uncertain 15 · nj 28; the flicker candidate DB evidence is wiped (hypothesis survives in worklog history, 2-of-4 slots); the cadence hypothesis is suspended (data reset); the seven-lane set survives in the restored corpus (verify via the LD title once the strip mounts); any EIGHTH lane is the broadening signal. (5) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (6) Owner queue (r693 carry + r745 upgrade): PLATFORM REPORT URGENT — two recycle wipes (r725, r745) + .archive-snapshot-1028 disposition; sibling-sandbox push history; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix (needs Owner input); optional v29c-f re-download. (7) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: app restoration incomplete (workflows tables empty; seed attempts timed out — probe data in the close log). Standing constraint (r707): mechanism or named evaluation every round — held (the recovery sequence itself + the snapshot increment + the recorded gates/census evidence, all anchored in scripts/qa_r745_close.txt and the snapshot artifact).')
with open('worklog.md','a') as f:
    f.write('\n'.join(L) + '\n')
print('worklog appended')
PY
echo "--- commit + push ---"
cat > scripts/r745_commitmsg.txt <<'MSG'
r745: RECOVERY round — sandbox rolled back to the 10-28 snapshot (r724 era)
between the 23:07 and 23:37 slots: worklog tail r724, git top 58c565474,
EvalEvent 0 rows — the SECOND recycle wipe (r725 first). Recovered from
remote truth: origin/main verified at 6708180d7 (r744 sweep), git reset
--hard origin/main, corpus restored from latest.json = 64 rows (20 runs ·
verdict 21 PASS 17/FAIL 4 · uncertain 15 · nj 28; the post-snapshot tail of
19 rows is lost from the DB — disclosed; worklog/git retain the record).
App restoration INCOMPLETE: AutomationWorkflow/Run/Vault all 0 — board strip
does not mount (strip:false ×3, evo-inbox-empty + six lane-unregistered
chips), golden QA RED, so ZERO code delta shipped per the no-ship-on-red
rule; seed attempts timed out twice (R10/R11 tool-call timeouts disclosed;
seedwrite non-interactive probe recorded in the close log for r746).
INCREMENT (durability, DB-level): scripts/snapshot-corpus.py — EvalEvent
dump to db/corpus-snapshots/ in the corpus-restore.ts shape, to be called by
every future close so recycles lose at most one slot (the stale 19:14
snapshotter cost 19 rows this time). Gates recorded: tsc/lint/censuses in
scripts/qa_r745_*.txt. Close-chain restructure: sweep runs inside the script
post-tee (no separate sweep round; new template). r746: finish app
restoration FIRST (seed workflows, verify strip, full QA), then standard
watch; platform report upgraded to urgent (two wipes + snapshot disposition).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r745_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main >/dev/null 2>&1 || { echo 'GUARD push origin'; exit 1; }
git push fork main >/dev/null 2>&1 || { echo 'GUARD push fork'; exit 1; }
echo "--- verify ---"
git log --oneline -1 | cut -c1-50
git status --porcelain | head -3
echo "== r745 CLOSED (recovery, QA red disclosed) =="
} 2>&1 | tee scripts/qa_r745_close.txt
# post-tee sweep (inside the script, outside the pipeline — r745 restructure)
git add -A
git commit -m "r745: sweep — tee artifact (in-script sweep; new template)" >/dev/null 2>&1 || true
git push origin main >/dev/null 2>&1 || true
git push fork main >/dev/null 2>&1 || true
echo "== r745 SWEEP DONE =="
git log --oneline -2 | cut -c1-40
git status --porcelain | head -3
exit 0
