#!/usr/bin/env bash
# r741 close chain — watch round (worklog + gates + commit + dual push; r740 template)
set -u
cd /home/z/my-project
{
echo "== r741 close =="
echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r741_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r741_tsc.txt; exit 1; }
bun run lint > scripts/qa_r741_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r741_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r741_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }
echo "--- fresh cache-busted LD witness ---"
agent-browser open "http://localhost:3000/?r=741c#workflows" >/dev/null 2>&1 || true
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
export R741_W='{"strip":true,"tally":"25 runs · 79 ev · 23 verdicts· 15u· 41nj","chips":25}' \
       R741_LD='{"ld":true,"count":"41","hasIntern":true,"hasFast":true,"hasPaid":true,"lanes":"intern-systemone; fast-judge AIHubMix · qwen3.8-flash-free (qwen3.8-flash-free); fast-judge AIHubMix · qwen3.8-max-free (qwen3.8-max-free); fast-judge; jev (paid rung); fast-judge Z.ai · glm-5.3 (glm-5.3); fast-judge Intern TokenPlan · glm-5.3 (glm-5.3)"}' \
       R741_FLD="$FLD" \
       R741_SET='{"census":true,"relay":true}' R741_RAD='frontier-aria-clicked' \
       R741_PASTE='paste-len:799' R741_CRON='1/1' \
       R741_TSC="$TSC" R741_LINTLINE="$LINTLINE" R741_GC="$GC" R741_CC="$CC" R741_CEN="$CEN"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r741')
L.append('Agent: NEXUS patrol (main agent — job 473388, 21:37 slot; opened on the r740 handoff verbatim)')
L.append('Task: Patrol round 741 — watch round per the r740 handoff (no manufactured increments). The ledger climbed at the acceleration edge: corpus 75→79 (+4 — the biggest single-slot climb since the r736 acceleration), runs 24→25, verdict 22→23 (+1: PASS@87%), uncertain 15 FLAT, nj 38→41 (+3). THE FLICKER RETURNED AND STRENGTHENED: run_839b9ce75fae carries THREE nj rows AND one PASS@87% (intern-systemone · cross-family) at the same timestamp — the SECOND sample of the intermittent pattern (r739: 1-of-3 @94%; r741: 1-of-4 @87%), high confidence whenever the intern lane answers. Lane set UNCHANGED at six entries — the fast-judge family stays 100% dead, so this remains a flaky dial, NOT a re-store landing (a real re-store would lift the whole ladder, not one gate in four).')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): worklog tail read FIRST — r740 handoff followed verbatim; git top d6f72bfbb (r740 sweep); tree clean; server 200; quick_check ok. Census (ro-mode): 79 rows · 25 runs — verdict 23 (PASS 19 / FAIL 4) · uncertain 15 · no-judge 41. Tuple attribution: +4 rows on ONE new run (run_839b9ce75fae, 21:12 +08: 3× gate-no-judge + 1× gate-verdict PASS@87). Trend: nj 8→10→13→15→18→20→(20)→21→23→28→30→33→35→(35)→38→41; verdict 21→22→23 across three slots — the intermittent lane has now answered in TWO of the last three slots.')
L.append('- JUDGE-LANE WATCH: six-lane STEADY-STATE holds; no eighth entry; no lanes vanishing. The flicker is now a PATTERN CANDIDATE: two samples in three slots, both high-confidence PASSes on the intern-systemone lane, both beside multiple nj rows in the SAME run. Working hypothesis: the intern dial succeeds at the edge of its timeout/rate window — worth watching for a THIRD sample (three-of-four slots would make it a real intermittent lane, and the +1/slot judged growth would be its signature, distinct from a re-store which would flood verdicts).')
L.append('- WITNESS HYGIENE (third slot running): board tally "25 runs · 79 ev · 23 verdicts· 15u· 41nj" (chips 25) == DB census byte-for-byte on the FIRST eval — three-way agreement (API shape r738 · DB ro-mode · fresh board), zero scare rounds. LD title: same six-lane dedup set at count 41.')
L.append('- GOLDEN QA: settings '+os.environ.get('R741_SET','')+' · radar '+os.environ.get('R741_RAD','')+' · workflows '+os.environ.get('R741_PASTE','')+' · cron chip '+os.environ.get('R741_CRON','')+' · console: HMR/DevTools info logs only, no errors · page errors: none')
L.append('- FRESH WITNESS (cache-busted close leg): '+os.environ.get('R741_FLD',''))
L.append('- NO-SHIP DISPOSITION: QA surfaced nothing broken; per the r740 handoff (hold steady, no manufactured increments) and the frame early-clean-exit clause, r741 closes as a clean WATCH round: zero code delta; named evaluation = the first-try three-way agreement witness + the fresh LD title witness above.')
L.append('- GATES: tsc_exit='+os.environ.get('R741_TSC','')+' · lint '+os.environ.get('R741_LINTLINE','')+' · qa-gate-census '+os.environ.get('R741_GC','')+' · qa-cortex-census '+os.environ.get('R741_CC','')+' · close census '+os.environ.get('R741_CEN',''))
L.append('- BUDGET: 7 rounds (five under the <=12 cap): R1 worklog-tail + git + server + probe batch, R2 census + lane watch, R3 qa script written (r741_qa.sh), R4 QA run green (first-try agreement), R5 this close chain written, R6 close run (guards abort BEFORE commit), R7 sweep + verification. Post-close tee sweep baked into this chain (r722..r740 precedent) — disclosed here and in the commit message.')
L.append('Stage Summary:')
L.append('- The outage grind continues (+3/slot nj) but the one live thread thickened: the intern lane answered twice in three slots, always high-confidence, always beside failures in the same run. The patrol now tracks a named hypothesis — flaky-intern-dial (1-in-4 gates) — distinguishable from a re-store by its +1/slot judged signature. The board self-verified first-try for the third slot running. Cure stays Owner-side: vault re-store BACKUP-FIRST + Cortex P1 v2 deploy.')
L.append('Round Handoff:')
L.append('Round ID: r742 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 79 rows baseline; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. Diff tooling: tuple-key on (runId, note, createdAt) — the /api/evals runs rows carry NO id (r735 lesson). (2) JUDGE-LANE WATCH: six-lane steady-state at nj 41; the flicker is a PATTERN CANDIDATE (2 samples in 3 slots, high-confidence PASSes on intern-systemone beside nj rows in the same run) — watch for (a) a THIRD flicker sample (three-of-four slots = real intermittent lane, judged +1/slot signature), (b) an eighth lane entry, (c) verdict GROWTH ACCELERATING (multiple +verdicts in one slot = the re-store landing, distinct from the flicker), (d) pace off the 41 baseline (+3/slot). WITNESS HYGIENE (r738 lesson, r739-r741-proven): open board witnesses with a UNIQUE ?r=r742 query param — first-try board/DB agreement is the expected green. (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) NEXT INCREMENT CANDIDATES: the ergonomics arc is complete through r736 — hold steady on watch rounds while the Owner-side cures land, or fix whatever the golden QA surfaces first; no manufactured increments. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix (lives outside repo docs — needs Owner input); optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the first-try three-way agreement witness + fresh LD title witness is the named evaluation, evidence-anchored in scripts/qa_r741.txt and scripts/qa_r741_close.txt).')
with open('worklog.md','a') as f:
    f.write('\n'.join(L) + '\n')
print('worklog appended')
PY
echo "--- commit + push ---"
cat > scripts/r741_commitmsg.txt <<'MSG'
r741: watch round — ledger climbed at the acceleration edge: corpus 75→79
(+4, one new run run_839b9ce75fae x4), verdict 22→23 (+1: PASS@87%),
uncertain 15 flat, nj 38→41 (+3). THE FLICKER RETURNED AND STRENGTHENED:
3 nj + 1 PASS@87% (intern-systemone cross-family) on the SAME run — second
sample of the intermittent pattern in three slots (r739 1-of-3 @94%,
r741 1-of-4 @87%), high confidence whenever it answers; fast-judge family
still 100% dead (lane set unchanged at six, no eighth entry) — flaky
intern dial, NOT a re-store landing (that would flood verdicts, not +1/slot).
Witness hygiene third slot running: ?r=741 opener matched the DB census
BYTE-FOR-BYTE on the first eval (three-way agreement, zero scare rounds).
Golden QA green (settings census/relay, radar frontier, paste-799, cron 1/1,
console 0 errors); gates green (tsc 0, lint 0 errors / 33-warning baseline,
qa-gate-census 48/48, qa-cortex-census 23/23); ZERO code delta — clean
watch disposition per r740 handoff (named evaluation = first-try three-way
agreement + fresh LD title witness, scripts/qa_r741.txt). Post-close tee
sweep baked into the close chain (r722..r740 precedent).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r741_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main >/dev/null 2>&1 || { echo 'GUARD push origin'; exit 1; }
git push fork main >/dev/null 2>&1 || { echo 'GUARD push fork'; exit 1; }
echo "--- verify ---"
git log --oneline -1 | cat
git status --porcelain | head -3
echo "== r741 CLOSED =="
} 2>&1 | tee scripts/qa_r741_close.txt
exit ${PIPESTATUS[0]}
