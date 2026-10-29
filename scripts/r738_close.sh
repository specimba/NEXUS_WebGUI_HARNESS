#!/usr/bin/env bash
# r738 close chain — watch round + false-alarm disclosure (worklog + gates + commit + dual push; r737 template)
set -u
cd /home/z/my-project
{
echo "== r738 close =="
echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r738_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r738_tsc.txt; exit 1; }
bun run lint > scripts/qa_r738_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r738_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r738_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }
echo "--- fresh cache-busted board + LD witness ---"
agent-browser open "http://localhost:3000/?r=738c#workflows" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 4
W1F=$(agent-browser eval "(() => { const strip=document.querySelector('[data-testid=\"corpus-only-runs\"]'); if(!strip) return JSON.stringify({strip:false}); const tally=[...strip.querySelectorAll('span')].find(e=>/runs . \d+ ev/.test(e.textContent||'')); return JSON.stringify({tally:tally?tally.textContent:'TALLY-MISS',hasNewRun:/run_639dba91249e/.test(strip.textContent)}); })()" || true)
echo "board-fresh: $W1F"
echo "$W1F" | grep -Eq 'hasNewRun\\?":true' || { echo 'GUARD fresh board hasNewRun'; exit 1; }
FLD=$(agent-browser eval "(() => { const el=[...document.querySelectorAll('[data-testid=\"corpus-only-runs\"] [title]')].find(e=>/no-judge failures/.test(e.getAttribute('title')||'')); if(!el) return JSON.stringify({ld:false,note:'no-nj-title'}); const t=el.getAttribute('title'); return JSON.stringify({ld:true,count:(t.match(/these (\d+) no-judge/)||[])[1]||'',hasIntern:/intern-systemone/.test(t),hasFast:/fast-judge/.test(t),hasPaid:/paid rung/.test(t),lanes:(t.match(/deduped\):\s*([\s\S]*)$/)||[])[1]||''}); })()" || true)
echo "fld: $FLD"
echo "$FLD" | grep -Eq 'ld\\?":true' || { echo 'GUARD fld'; exit 1; }
echo "$FLD" | grep -Eq 'hasIntern\\?":true' || { echo 'GUARD fld intern'; exit 1; }
echo "$FLD" | grep -Eq 'hasFast\\?":true' || { echo 'GUARD fld fast'; exit 1; }
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
export R738_W="$W1F" R738_LD="$FLD" \
       R738_SET='{"census":true,"relay":true}' R738_RAD='frontier-aria-clicked' \
       R738_PASTE='paste-len:799' R738_CRON='1/1' \
       R738_TSC="$TSC" R738_LINTLINE="$LINTLINE" R738_GC="$GC" R738_CC="$CC" R738_CEN="$CEN"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r738')
L.append('Agent: NEXUS patrol (main agent — job 473388, 20:07 slot; opened on the r737 handoff verbatim)')
L.append('Task: Patrol round 738 — watch round per the r737 handoff (no manufactured increments). JUDGE-LANE WATCH: NO eighth lane — the rotation stopped discovering new rungs and settled into STEADY-STATE failure on the same six-entry set (intern-systemone; fast-judge Z.ai glm-5.3; fast-judge Intern TokenPlan glm-5.3; bare fast-judge; jev paid rung; fast-judge AIHubMix flash-free; fast-judge AIHubMix max-free). Corpus 66→69 (+3, ONE new manual test run run_639dba91249e ×3 — its workflow name literally carries an unbalanced double-quote), verdict 21 FLAT, uncertain 15 FLAT, nj 30→33 (+3). The round scar: the first board witness read STALE (66-ev state) — root-caused to warm-session hash-nav staleness, NOT a data or board defect; resolved and re-witnessed by a cache-busted document reload. Disclosed as a false alarm per the honesty doctrine (r735 precedent).')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): worklog tail read FIRST — r737 handoff followed verbatim; git top 32052f732 (r737 sweep); tree clean; server 200. Census (ro-mode): 69 rows · 22 runs — verdict 21 (PASS 17 / FAIL 4) · uncertain 15 · no-judge 33. Tuple attribution: +3 rows on ONE new run (run_639dba91249e — workflow name "test run \"Continuous Research & Evaluation" with an UNBALANCED quote; a manual test run), all three gate-no-judge naming intern-systemone AND fast-judge AIHubMix · qwen3.8-flash-free. Trend: nj 8→10→13→15→18→20→(20)→21→23→28→30→33.')
L.append('- JUDGE-LANE WATCH: lane set UNCHANGED at six entries — no eighth lane; the rotation has EXHAUSTED the relay list and now cycles the same dead rungs (steady-state outage). Judged FLAT at 21 → no re-store signal (no lanes vanishing, no verdict growth). Pace +3/slot, holding.')
L.append('- FALSE ALARM + ROOT CAUSE (disclosed): the r738_qa.sh opener board witness read "21 runs · 66 ev · 30nj" while the DB held 69/22/33 — the gap EXACTLY the new run three rows, suspicious because that run workflow name carries an unbalanced quote. Disambiguated in one round: API truth via curl /api/evals = 69 rows / 22 runs / target-run 3 rows (the quote is served fine); DB 69/22; and a cache-busted DOCUMENT reload (?r=738) re-witnessed "22 runs · 69 ev · 21 verdicts· 15u· 33nj" with hasNewRun:true chips:22 — THREE-WAY AGREEMENT (API == DB == fresh board). Verdict: NOT a data defect, NOT a board defect — SPA hash-nav on the warm persistent agent-browser session served the previous page-load corpus fetch; the malformed-looking workflow name was a red herring. TOOLING LESSON (r738, recorded): board witnesses on the persistent agent-browser session must force a DOCUMENT navigation via a unique query param (?r=r7XX#workflows) — hash-nav alone can serve stale data; r737 QA matched only by luck of session state.')
L.append('- GOLDEN QA: settings '+os.environ.get('R738_SET','')+' · radar '+os.environ.get('R738_RAD','')+' · workflows '+os.environ.get('R738_PASTE','')+' · cron chip '+os.environ.get('R738_CRON','')+' · console: Fast-Refresh logs only, no errors · page errors: none. Board radio: radio-MISS again (non-guarded; board renders by default — r737 disclosure stands).')
L.append('- FRESH WITNESSES (cache-busted, this close chain): board '+os.environ.get('R738_W','')+' · LD title '+os.environ.get('R738_LD',''))
L.append('- NO-SHIP DISPOSITION: QA surfaced no defect (the scare root-caused to witness hygiene, fixed by the cache-busted opener, not by code); per the r737 handoff (hold steady, no manufactured increments) and the frame early-clean-exit clause, r738 closes as a clean WATCH round: zero code delta; named evaluation = the three-way agreement witness (API==DB==fresh board) + the fresh LD title witness above.')
L.append('- GATES: tsc_exit='+os.environ.get('R738_TSC','')+' · lint '+os.environ.get('R738_LINTLINE','')+' · qa-gate-census '+os.environ.get('R738_GC','')+' · qa-cortex-census '+os.environ.get('R738_CC','')+' · close census '+os.environ.get('R738_CEN',''))
L.append('- BUDGET: 8 rounds (four under the <=12 cap): R1 worklog-tail + git + server + probe batch, R2 census + lane watch, R3 qa script written (r738_qa.sh), R4 QA run green, R5 false-alarm disambiguation (API + DB + cache-busted reload, one round), R6 this close chain written, R7 close run (guards abort BEFORE commit), R8 sweep + verification. Post-close tee sweep baked into this chain (r722..r737 precedent) — disclosed here and in the commit message.')
L.append('Stage Summary:')
L.append('- The judge-lane outage is now steady-state dead on six rungs; the only movement is nj volume (+3/slot). The stale-witness scare bought a real tooling upgrade — the cache-busted witness opener — at zero code cost, and the three-way agreement witness (API/DB/board) is now the strongest ledger-truth check the patrol has. Cure stays Owner-side: vault re-store BACKUP-FIRST + Cortex P1 v2 deploy.')
L.append('Round Handoff:')
L.append('Round ID: r739 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 69 rows; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. Diff tooling: tuple-key on (runId, note, createdAt) — the /api/evals runs rows carry NO id (r735 lesson). (2) JUDGE-LANE WATCH: six-lane STEADY-STATE; watch for (a) an eighth entry (a deeper rung discovered), (b) entries VANISHING while judged growth resumes (the re-store landing — the title is the early-warning surface), (c) pace nj ...→30→33; if +3/slot holds, the corpus still floods no-judge over time — the Owner-side cure (vault re-store BACKUP-FIRST + Cortex P1 v2 deploy) is the only lever. WITNESS HYGIENE (r738 lesson): open board witnesses with a UNIQUE ?r=r739 query param — hash-nav alone serves stale data on the warm session. (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) NEXT INCREMENT CANDIDATES: the ergonomics arc is complete through r736 — hold steady on watch rounds while the Owner-side cures land, or fix whatever the golden QA surfaces first; no manufactured increments. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix (lives outside repo docs — needs Owner input); optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the three-way agreement witness + fresh LD title witness is the named evaluation, evidence-anchored in scripts/qa_r738.txt and scripts/qa_r738_close.txt).')
with open('worklog.md','a') as f:
    f.write('\n'.join(L) + '\n')
print('worklog appended')
PY
echo "--- commit + push ---"
cat > scripts/r738_commitmsg.txt <<'MSG'
r738: watch round — judge-lane rotation STEADY-STATE on the same six dead
rungs (no eighth lane; intern-systemone + fast-judge Z.ai/TokenPlan/
AIHubMix-flash/max + bare fast-judge + jev paid rung); corpus 69 (+3, one
manual test run whose workflow name carries an unbalanced quote — red
herring), nj 33 (+3), verdict 21 flat, uncertain 15 flat. FALSE ALARM
disclosed + root-caused: the warm persistent browser session's SPA hash-nav
served a STALE board witness (66-ev state) — disambiguated in one round via
API truth (69/22, target run served fine) + cache-busted document reload
re-witnessing three-way agreement (API==DB==board 69/22/33, hasNewRun true).
Tooling lesson recorded: board witnesses must open with a unique ?r=r7XX
query param. Golden QA green (settings census/relay, radar frontier,
paste-799, cron 1/1, console 0 errors); gates green (tsc 0, lint 0 errors /
33-warning baseline, qa-gate-census 48/48, qa-cortex-census 23/23); ZERO
code delta — clean watch disposition per r737 handoff (named evaluation =
three-way agreement + fresh LD title witness, scripts/qa_r738.txt).
Post-close tee sweep baked into the close chain (r722..r737 precedent).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r738_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main >/dev/null 2>&1 || { echo 'GUARD push origin'; exit 1; }
git push fork main >/dev/null 2>&1 || { echo 'GUARD push fork'; exit 1; }
echo "--- verify ---"
git log --oneline -1 | cat
git status --porcelain | head -3
echo "== r738 CLOSED =="
} 2>&1 | tee scripts/qa_r738_close.txt
exit ${PIPESTATUS[0]}
