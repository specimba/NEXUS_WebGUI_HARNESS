#!/usr/bin/env bash
# r742 close chain — watch round (worklog + gates + commit + dual push; r741 template)
set -u
cd /home/z/my-project
{
echo "== r742 close =="
echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r742_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r742_tsc.txt; exit 1; }
bun run lint > scripts/qa_r742_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r742_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r742_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }
echo "--- fresh cache-busted LD witness ---"
agent-browser open "http://localhost:3000/?r=742c#workflows" >/dev/null 2>&1 || true
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
export R742_W='{"strip":true,"tally":"25 runs · 79 ev · 23 verdicts· 15u· 41nj","chips":25}' \
       R742_LD='{"ld":true,"count":"41","hasIntern":true,"hasFast":true,"hasPaid":true,"lanes":"intern-systemone; fast-judge AIHubMix · qwen3.8-flash-free (qwen3.8-flash-free); fast-judge AIHubMix · qwen3.8-max-free (qwen3.8-max-free); fast-judge; jev (paid rung); fast-judge Z.ai · glm-5.3 (glm-5.3); fast-judge Intern TokenPlan · glm-5.3 (glm-5.3)"}' \
       R742_FLD="$FLD" \
       R742_SET='{"census":true,"relay":true}' R742_RAD='frontier-aria-clicked' \
       R742_PASTE='paste-len:799' R742_CRON='1/1' \
       R742_TSC="$TSC" R742_LINTLINE="$LINTLINE" R742_GC="$GC" R742_CC="$CC" R742_CEN="$CEN"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r742')
L.append('Agent: NEXUS patrol (main agent — job 473388, 22:07 slot; opened on the r741 handoff verbatim)')
L.append('Task: Patrol round 742 — watch round per the r741 handoff (no manufactured increments). The ledger is FROZEN at the r741 close state: 79 rows · 25 runs · verdict 23 (PASS 19 / FAIL 4) · uncertain 15 · nj 41 — ZERO new rows this slot (newest row remains run_839b9ce75fae at 21:12 +08; the gate traffic that drove +3..+4/slot went quiet). No third flicker sample yet (the pattern candidate stays 2-of-4 slots), no eighth lane (six entries unchanged), no re-store signal (verdict flat). Second frozen slot in the arc (r739 was the first) — the cadence itself is now a watched variable.')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): worklog tail read FIRST — r741 handoff followed verbatim; git top a494cb0c8 (r741 sweep); tree clean; server 200; quick_check ok. Census (ro-mode): 79 rows · 25 runs — verdict 23 (PASS 19 / FAIL 4) · uncertain 15 · no-judge 41; maxIso 13:12:36Z unchanged. Trend: nj 8→10→13→15→18→20→(20)→21→23→28→30→33→35→(35)→38→41→(41 frozen); verdict 21→22→23 across three slots, flat this slot.')
L.append('- JUDGE-LANE WATCH: six-lane STEADY-STATE holds; no eighth entry; no lanes vanishing; verdict FLAT — no re-store signal. The flicker hypothesis (flaky intern dial, ~1-in-4 gates) gets no new evidence this slot — zero gates ran at all. The distinguishing signatures stand: flicker = judged +1/slot alongside nj growth; re-store = verdict growth ACCELERATING (multiple +verdicts in one slot); outage-quiet = both counters frozen (this slot).')
L.append('- WITNESS HYGIENE (fourth slot running): board tally "25 runs · 79 ev · 23 verdicts· 15u· 41nj" (chips 25) == DB census byte-for-byte on the FIRST eval — three-way agreement (API shape r738 · DB ro-mode · fresh board), zero scare rounds. LD title: same six-lane dedup set at count 41.')
L.append('- GOLDEN QA: settings '+os.environ.get('R742_SET','')+' · radar '+os.environ.get('R742_RAD','')+' · workflows '+os.environ.get('R742_PASTE','')+' · cron chip '+os.environ.get('R742_CRON','')+' · console: HMR/DevTools info logs only, no errors · page errors: none')
L.append('- FRESH WITNESS (cache-busted close leg): '+os.environ.get('R742_FLD',''))
L.append('- NO-SHIP DISPOSITION: QA surfaced nothing broken; per the r741 handoff (hold steady, no manufactured increments) and the frame early-clean-exit clause, r742 closes as a clean WATCH round: zero code delta; named evaluation = the first-try three-way agreement witness + the fresh LD title witness above.')
L.append('- GATES: tsc_exit='+os.environ.get('R742_TSC','')+' · lint '+os.environ.get('R742_LINTLINE','')+' · qa-gate-census '+os.environ.get('R742_GC','')+' · qa-cortex-census '+os.environ.get('R742_CC','')+' · close census '+os.environ.get('R742_CEN',''))
L.append('- BUDGET: 7 rounds (five under the <=12 cap): R1 worklog-tail + git + server + probe batch, R2 census + flicker check, R3 qa script written (r742_qa.sh), R4 QA run green (first-try agreement), R5 this close chain written, R6 close run (guards abort BEFORE commit), R7 sweep + verification. Post-close tee sweep baked into this chain (r722..r741 precedent) — disclosed here and in the commit message.')
L.append('Stage Summary:')
L.append('- A frozen slot: zero gate traffic, the ledger held at the r741 close state, and all three watch signatures (flicker / re-store / outage) stay separable. The board self-verified first-try for the fourth slot running — the patrol is now a stable, low-cost instrument. Cure stays Owner-side: vault re-store BACKUP-FIRST + Cortex P1 v2 deploy.')
L.append('Round Handoff:')
L.append('Round ID: r743 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 79 rows baseline; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. Diff tooling: tuple-key on (runId, note, createdAt) — the /api/evals runs rows carry NO id (r735 lesson). (2) JUDGE-LANE WATCH: six-lane steady-state at nj 41; THREE signatures remain separable — (a) flicker: judged +1/slot with high-confidence PASSes beside nj rows in the same run (2-of-4 slots so far), (b) re-store: verdict growth ACCELERATING (multiple +verdicts in one slot), (c) outage-quiet: both counters frozen (r742). Watch which signature the next non-frozen slot shows; eighth lane entry still worth flagging. WITNESS HYGIENE (r738 lesson, r739-r742-proven): open board witnesses with a UNIQUE ?r=r743 query param — first-try board/DB agreement is the expected green. (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) NEXT INCREMENT CANDIDATES: the ergonomics arc is complete through r736 — hold steady on watch rounds while the Owner-side cures land, or fix whatever the golden QA surfaces first; no manufactured increments. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix (lives outside repo docs — needs Owner input); optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the first-try three-way agreement witness + fresh LD title witness is the named evaluation, evidence-anchored in scripts/qa_r742.txt and scripts/qa_r742_close.txt).')
with open('worklog.md','a') as f:
    f.write('\n'.join(L) + '\n')
print('worklog appended')
PY
echo "--- commit + push ---"
cat > scripts/r742_commitmsg.txt <<'MSG'
r742: watch round — ledger FROZEN at the r741 close state (79 rows · 25 runs ·
verdict 23 PASS 19/FAIL 4 · uncertain 15 · nj 41; ZERO new rows this slot,
newest row still run_839b9ce75fae @21:12) — gate traffic went quiet; no
third flicker sample (pattern candidate stays 2-of-4 slots), lane set
unchanged at six entries, no re-store signal (verdict flat). Three watch
signatures stay separable: flicker (judged +1/slot beside same-run nj),
re-store (verdict growth accelerating), outage-quiet (frozen — this slot).
Witness hygiene fourth slot running: ?r=742 opener matched the DB census
BYTE-FOR-BYTE on the first eval (three-way agreement, zero scare rounds).
Golden QA green (settings census/relay, radar frontier, paste-799, cron 1/1,
console 0 errors); gates green (tsc 0, lint 0 errors / 33-warning baseline,
qa-gate-census 48/48, qa-cortex-census 23/23); ZERO code delta — clean
watch disposition per r741 handoff (named evaluation = first-try three-way
agreement + fresh LD title witness, scripts/qa_r742.txt). Post-close tee
sweep baked into the close chain (r722..r741 precedent).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r742_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main >/dev/null 2>&1 || { echo 'GUARD push origin'; exit 1; }
git push fork main >/dev/null 2>&1 || { echo 'GUARD push fork'; exit 1; }
echo "--- verify ---"
git log --oneline -1 | cat
git status --porcelain | head -3
echo "== r742 CLOSED =="
} 2>&1 | tee scripts/qa_r742_close.txt
exit ${PIPESTATUS[0]}
