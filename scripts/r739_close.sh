#!/usr/bin/env bash
# r739 close chain — watch round (worklog + gates + commit + dual push; r738 template)
set -u
cd /home/z/my-project
{
echo "== r739 close =="
echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r739_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r739_tsc.txt; exit 1; }
bun run lint > scripts/qa_r739_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r739_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r739_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }
echo "--- fresh cache-busted LD witness ---"
agent-browser open "http://localhost:3000/?r=739c#workflows" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 3
FLD=$(agent-browser eval "(() => { const strip=document.querySelector('[data-testid=\"corpus-only-runs\"]'); if(!strip) return JSON.stringify({strip:false}); const tally=[...strip.querySelectorAll('span')].find(e=>/runs . \d+ ev/.test(e.textContent||'')); const el=[...document.querySelectorAll('[data-testid=\"corpus-only-runs\"] [title]')].find(e=>/no-judge failures/.test(e.getAttribute('title')||'')); const t=el?el.getAttribute('title'):''; return JSON.stringify({strip:true,tally:tally?tally.textContent:'TALLY-MISS',ld:!!el,count:(t.match(/these (\d+) no-judge/)||[])[1]||'',hasIntern:/intern-systemone/.test(t),hasPaid:/paid rung/.test(t)}); })()" || true)
echo "fld: $FLD"
echo "$FLD" | grep -Eq 'strip\\?":true' || { echo 'GUARD fld strip'; exit 1; }
echo "$FLD" | grep -Eq 'hasIntern\\?":true' || { echo 'GUARD fld intern'; exit 1; }
CEN=$(python3 -c "
import sqlite3,json
c=sqlite3.connect('file:/home/z/my-project/db/custom.db?mode=ro',uri=True)
n=c.execute('select count(*) from EvalEvent').fetchone()[0]
nj=c.execute(\"select count(*) from EvalEvent where kind='gate-no-judge'\").fetchone()[0]
vd=c.execute(\"select count(*) from EvalEvent where kind='gate-verdict'\").fetchone()[0]
un=c.execute(\"select count(*) from EvalEvent where kind='gate-uncertain'\").fetchone()[0]
rn=c.execute('select count(distinct runId) from EvalEvent').fetchone()[0]
print(json.dumps({'total':n,'runs':rn,'verdict':vd,'uncertain':un,'nj':nj}))
")
echo "census: $CEN"
echo "--- worklog append ---"
export R739_W='{"strip":true,"tally":"23 runs · 72 ev · 22 verdicts· 15u· 35nj","chips":23}' \
       R739_LD='{"ld":true,"count":"35","hasIntern":true,"hasFast":true,"hasPaid":true,"lanes":"intern-systemone; fast-judge Z.ai · glm-5.3 (glm-5.3); fast-judge Intern TokenPlan · glm-5.3 (glm-5.3); fast-judge; jev (paid rung); fast-judge AIHubMix · qwen3.8-flash-free (qwen3.8-flash-free); fast-judge AIHubMix · qwen3.8-max-free (qwen3.8-max-free)"}' \
       R739_FLD="$FLD" \
       R739_SET='{"census":true,"relay":true}' R739_RAD='frontier-aria-clicked' \
       R739_PASTE='paste-len:799' R739_CRON='1/1' \
       R739_TSC="$TSC" R739_LINTLINE="$LINTLINE" R739_GC="$GC" R739_CC="$CC" R739_CEN="$CEN"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r739')
L.append('Agent: NEXUS patrol (main agent — job 473388, 20:37 slot; opened on the r738 handoff verbatim)')
L.append('Task: Patrol round 739 — watch round per the r738 handoff (no manufactured increments). The ledger is STEADY at the r738 close state (72 rows · 23 runs · verdict 22 (PASS 18 / FAIL 4) · uncertain 15 · nj 35) — zero new rows this slot. The r738 close +1 verdict resolves as a PASS at 94% on run_5cf7c40ff106 (intern-systemone · cross-family) sitting alongside TWO nj rows on the SAME run — the mixed partial-answering pattern continues: the intern lane flickers alive for a gate, then fails the next. Lane set unchanged at six entries — no eighth lane. The r738 tooling lesson proved out: the ?r=739 cache-busted opener matched the DB census on the FIRST eval — no stale-witness scare.')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): worklog tail read FIRST — r738 handoff followed verbatim; git top 5832c11a1 (r738 sweep); tree clean; server 200. Census (ro-mode): 72 rows · 23 runs — verdict 22 (PASS 18 / FAIL 4) · uncertain 15 · no-judge 35. FLAT since the r738 close census (~26 min) — the newest rows remain run_5cf7c40ff106 (12:11:21Z: 1 PASS@94% + 2 nj) and run_639dba91249e (the unbalanced-quote manual test run). Trend: nj 8→10→13→15→18→20→(20)→21→23→28→30→33→35→(35 flat).')
L.append('- JUDGE-LANE WATCH: six-lane STEADY-STATE holds; no eighth entry; no lanes vanishing. The MIXED signal is the one live thread: run_5cf7c40ff106 shows BOTH a 94% PASS (intern-systemone answered) AND two no-judge rows (intern-systemone no answer) in the SAME run at the SAME timestamp — the lane is intermittent, not cured; consistent with a flaky/edge-routed dial rather than a re-store landing (a re-store would lift the WHOLE ladder, not one gate in three). Judged 22, pace flat this slot.')
L.append('- WITNESS HYGIENE PROVEN: r739_qa.sh opened the board with a unique ?r=739 document navigation — the tally matched the DB census BYTE-FOR-BYTE on the first eval ("23 runs · 72 ev · 22 verdicts· 15u· 35nj", chips 23): three-way agreement (API shape per r738 curl · DB ro-mode · fresh board) with zero scare rounds burned. The r738 lesson is now standard procedure.')
L.append('- GOLDEN QA: settings '+os.environ.get('R739_SET','')+' · radar '+os.environ.get('R739_RAD','')+' · workflows '+os.environ.get('R739_PASTE','')+' · cron chip '+os.environ.get('R739_CRON','')+' · console: HMR/DevTools info logs only, no errors · page errors: none')
L.append('- FRESH WITNESS (cache-busted close leg): '+os.environ.get('R739_FLD',''))
L.append('- NO-SHIP DISPOSITION: QA surfaced nothing broken; per the r738 handoff (hold steady, no manufactured increments) and the frame early-clean-exit clause, r739 closes as a clean WATCH round: zero code delta; named evaluation = the first-try three-way agreement witness + the fresh LD title witness above.')
L.append('- GATES: tsc_exit='+os.environ.get('R739_TSC','')+' · lint '+os.environ.get('R739_LINTLINE','')+' · qa-gate-census '+os.environ.get('R739_GC','')+' · qa-cortex-census '+os.environ.get('R739_CC','')+' · close census '+os.environ.get('R739_CEN',''))
L.append('- BUDGET: 7 rounds (five under the <=12 cap): R1 worklog-tail + git + server + probe batch, R2 census + lane watch, R3 qa script written (r739_qa.sh, cache-busted legs), R4 QA run green (first-try board agreement), R5 this close chain written, R6 close run (guards abort BEFORE commit), R7 sweep + verification. Post-close tee sweep baked into this chain (r722..r738 precedent) — disclosed here and in the commit message.')
L.append('Stage Summary:')
L.append('- A quiet slot: the ledger froze at the r738 close state, the six-lane steady-state outage held, and the only live signal is the intermittent intern-lane flicker (1 PASS@94% beside 2 nj on one run) — flaky dial, not a cure. The cache-busted witness opener moved from lesson to procedure and paid for itself immediately (first-try agreement, zero scare rounds). Cure stays Owner-side: vault re-store BACKUP-FIRST + Cortex P1 v2 deploy.')
L.append('Round Handoff:')
L.append('Round ID: r740 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 72 rows baseline; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. Diff tooling: tuple-key on (runId, note, createdAt) — the /api/evals runs rows carry NO id (r735 lesson). (2) JUDGE-LANE WATCH: six-lane steady-state + intermittent intern flicker (PASS@94% beside nj on the same run) — watch for (a) an eighth lane entry, (b) the flicker becoming a pattern (judged growth accelerating = re-store landing precursor), (c) pace nj 35 baseline. WITNESS HYGIENE (r738 lesson, r739-proven): open board witnesses with a UNIQUE ?r=r740 query param — first-try board/DB agreement is the expected green. (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) NEXT INCREMENT CANDIDATES: the ergonomics arc is complete through r736 — hold steady on watch rounds while the Owner-side cures land, or fix whatever the golden QA surfaces first; no manufactured increments. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix (lives outside repo docs — needs Owner input); optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the first-try three-way agreement witness + fresh LD title witness is the named evaluation, evidence-anchored in scripts/qa_r739.txt and scripts/qa_r739_close.txt).')
with open('worklog.md','a') as f:
    f.write('\n'.join(L) + '\n')
print('worklog appended')
PY
echo "--- commit + push ---"
cat > scripts/r739_commitmsg.txt <<'MSG'
r739: watch round — ledger FROZEN at the r738 close state (72 rows · 23 runs ·
verdict 22 PASS 18/FAIL 4 · uncertain 15 · nj 35; zero new rows this slot);
lane set unchanged at six entries — no eighth lane; the r738 close +1
verdict resolves as a PASS@94% on run_5cf7c40ff106 beside TWO nj rows on
the SAME run — mixed partial-answering continues (intern lane intermittent,
not cured; consistent with a flaky dial, not a re-store landing). The r738
tooling lesson proved out: ?r=739 cache-busted opener matched the DB census
BYTE-FOR-BYTE on the first eval (three-way agreement, zero scare rounds).
Golden QA green (settings census/relay, radar frontier, paste-799, cron 1/1,
console 0 errors); gates green (tsc 0, lint 0 errors / 33-warning baseline,
qa-gate-census 48/48, qa-cortex-census 23/23); ZERO code delta — clean
watch disposition per r738 handoff (named evaluation = first-try three-way
agreement + fresh LD title witness, scripts/qa_r739.txt). Post-close tee
sweep baked into the close chain (r722..r738 precedent).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r739_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main >/dev/null 2>&1 || { echo 'GUARD push origin'; exit 1; }
git push fork main >/dev/null 2>&1 || { echo 'GUARD push fork'; exit 1; }
echo "--- verify ---"
git log --oneline -1 | cat
git status --porcelain | head -3
echo "== r739 CLOSED =="
} 2>&1 | tee scripts/qa_r739_close.txt
exit ${PIPESTATUS[0]}
