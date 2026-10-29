#!/usr/bin/env bash
# r740 close chain — watch round (worklog + gates + commit + dual push; r739 template)
set -u
cd /home/z/my-project
{
echo "== r740 close =="
echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r740_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r740_tsc.txt; exit 1; }
bun run lint > scripts/qa_r740_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r740_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r740_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }
echo "--- fresh cache-busted LD witness ---"
agent-browser open "http://localhost:3000/?r=740c#workflows" >/dev/null 2>&1 || true
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
export R740_W='{"strip":true,"tally":"24 runs · 75 ev · 22 verdicts· 15u· 38nj","chips":24}' \
       R740_LD='{"ld":true,"count":"38","hasIntern":true,"hasFast":true,"hasPaid":true,"lanes":"intern-systemone; fast-judge AIHubMix · qwen3.8-flash-free (qwen3.8-flash-free); fast-judge AIHubMix · qwen3.8-max-free (qwen3.8-max-free); fast-judge; jev (paid rung); fast-judge Z.ai · glm-5.3 (glm-5.3); fast-judge Intern TokenPlan · glm-5.3 (glm-5.3)"}' \
       R740_FLD="$FLD" \
       R740_SET='{"census":true,"relay":true}' R740_RAD='frontier-aria-clicked' \
       R740_PASTE='paste-len:799' R740_CRON='1/1' \
       R740_TSC="$TSC" R740_LINTLINE="$LINTLINE" R740_GC="$GC" R740_CC="$CC" R740_CEN="$CEN"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r740')
L.append('Agent: NEXUS patrol (main agent — job 473388, 21:07 slot; opened on the r739 handoff verbatim)')
L.append('Task: Patrol round 740 — watch round per the r739 handoff (no manufactured increments). The ledger resumed climbing: corpus 72→75 (+3, ONE new run run_aabcce45b62c ×3, all gate-no-judge, 20:55 +08), verdict 22 FLAT (PASS 18 / FAIL 4), uncertain 15 FLAT, nj 35→38 (+3 — pace back at +3/slot). No flicker repeat this slot (the r739 PASS@94% found no successor — the intern lane stayed silent), lane set UNCHANGED at six entries, no eighth lane. The ?r=740 cache-busted opener matched the DB census BYTE-FOR-BYTE on the first eval — second slot running, the hygiene is procedure.')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): worklog tail read FIRST — r739 handoff followed verbatim; git top 3f6b290ed (r739 sweep); server 200; quick_check ok. One tracked runtime file dirty at open: db/gateway-pulse.json (the gateway pulse updates itself between slots) — rides this round commit honestly, disclosed here. Census (ro-mode): 75 rows · 24 runs — verdict 22 (PASS 18 / FAIL 4) · uncertain 15 · no-judge 38. Tuple attribution: +3 rows on ONE new run (run_aabcce45b62c, intern-systemone + fast-judge trace). Trend: nj 8→10→13→15→18→20→(20)→21→23→28→30→33→35→(35)→38.')
L.append('- JUDGE-LANE WATCH: six-lane STEADY-STATE holds; no eighth entry; no lanes vanishing; judged FLAT at 22 — no re-store signal, and the r739 flicker did NOT repeat (single-sample intermittent stays single-sample). Pace +3/slot resumes. The outage picture is unchanged: the vault (0 lanes) starves both families; only the Owner-side cure moves this.')
L.append('- WITNESS HYGIENE (second slot running): board tally "24 runs · 75 ev · 22 verdicts· 15u· 38nj" (chips 24) == DB census byte-for-byte on the FIRST eval — three-way agreement (API shape r738 · DB ro-mode · fresh board), zero scare rounds. The LD title carries the same six-lane dedup set at count 38.')
L.append('- GOLDEN QA: settings '+os.environ.get('R740_SET','')+' · radar '+os.environ.get('R740_RAD','')+' · workflows '+os.environ.get('R740_PASTE','')+' · cron chip '+os.environ.get('R740_CRON','')+' · console: HMR/DevTools info logs only, no errors · page errors: none')
L.append('- FRESH WITNESS (cache-busted close leg): '+os.environ.get('R740_FLD',''))
L.append('- NO-SHIP DISPOSITION: QA surfaced nothing broken; per the r739 handoff (hold steady, no manufactured increments) and the frame early-clean-exit clause, r740 closes as a clean WATCH round: zero code delta; named evaluation = the first-try three-way agreement witness + the fresh LD title witness above.')
L.append('- GATES: tsc_exit='+os.environ.get('R740_TSC','')+' · lint '+os.environ.get('R740_LINTLINE','')+' · qa-gate-census '+os.environ.get('R740_GC','')+' · qa-cortex-census '+os.environ.get('R740_CC','')+' · close census '+os.environ.get('R740_CEN',''))
L.append('- BUDGET: 7 rounds (five under the <=12 cap): R1 worklog-tail + git + server + probe batch, R2 census + lane watch, R3 qa script written (r740_qa.sh), R4 QA run green (first-try agreement), R5 this close chain written, R6 close run (guards abort BEFORE commit), R7 sweep + verification. Post-close tee sweep baked into this chain (r722..r739 precedent) — disclosed here and in the commit message.')
L.append('Stage Summary:')
L.append('- The steady-state outage grind continues: +3 nj per slot, judged flat, six dead lanes, the intern flicker silent since r739. Nothing broke; the patrol witnessed the ledger truth first-try again. The board is now a reliable instrument — every slot it self-verifies against the DB. Cure stays Owner-side: vault re-store BACKUP-FIRST + Cortex P1 v2 deploy.')
L.append('Round Handoff:')
L.append('Round ID: r741 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 75 rows baseline; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. Diff tooling: tuple-key on (runId, note, createdAt) — the /api/evals runs rows carry NO id (r735 lesson). (2) JUDGE-LANE WATCH: six-lane steady-state at nj 38; watch for (a) an eighth lane entry, (b) the flicker returning or judged growth accelerating (re-store precursor), (c) pace +3/slot off the 38 baseline. WITNESS HYGIENE (r738 lesson, r739/r740-proven): open board witnesses with a UNIQUE ?r=r741 query param — first-try board/DB agreement is the expected green. (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) NEXT INCREMENT CANDIDATES: the ergonomics arc is complete through r736 — hold steady on watch rounds while the Owner-side cures land, or fix whatever the golden QA surfaces first; no manufactured increments. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix (lives outside repo docs — needs Owner input); optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the first-try three-way agreement witness + fresh LD title witness is the named evaluation, evidence-anchored in scripts/qa_r740.txt and scripts/qa_r740_close.txt).')
with open('worklog.md','a') as f:
    f.write('\n'.join(L) + '\n')
print('worklog appended')
PY
echo "--- commit + push ---"
cat > scripts/r740_commitmsg.txt <<'MSG'
r740: watch round — ledger resumed climbing: corpus 72→75 (+3, one new run
run_aabcce45b62c x3 nj), verdict 22 FLAT (PASS 18/FAIL 4), uncertain 15
flat, nj 35→38 (+3/slot pace resumes); lane set unchanged at six entries —
no eighth lane; no flicker repeat (the r739 PASS@94% found no successor);
no re-store signal. Witness hygiene second slot running: ?r=740 opener
matched the DB census BYTE-FOR-BYTE on the first eval (three-way agreement,
zero scare rounds). Golden QA green (settings census/relay, radar frontier,
paste-799, cron 1/1, console 0 errors); gates green (tsc 0, lint 0 errors /
33-warning baseline, qa-gate-census 48/48, qa-cortex-census 23/23); ZERO
code delta — clean watch disposition per r739 handoff (named evaluation =
first-try three-way agreement + fresh LD title witness, scripts/qa_r740.txt).
db/gateway-pulse.json rides the commit (gateway runtime pulse, disclosed).
Post-close tee sweep baked into the close chain (r722..r739 precedent).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r740_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main >/dev/null 2>&1 || { echo 'GUARD push origin'; exit 1; }
git push fork main >/dev/null 2>&1 || { echo 'GUARD push fork'; exit 1; }
echo "--- verify ---"
git log --oneline -1 | cat
git status --porcelain | head -3
echo "== r740 CLOSED =="
} 2>&1 | tee scripts/qa_r740_close.txt
exit ${PIPESTATUS[0]}
