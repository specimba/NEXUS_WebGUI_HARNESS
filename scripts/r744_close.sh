#!/usr/bin/env bash
# r744 close chain — watch round (worklog + gates + commit + dual push; r743 template)
set -u
cd /home/z/my-project
{
echo "== r744 close =="
echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r744_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r744_tsc.txt; exit 1; }
bun run lint > scripts/qa_r744_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r744_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r744_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }
echo "--- fresh cache-busted LD witness ---"
agent-browser open "http://localhost:3000/?r=744c#workflows" >/dev/null 2>&1 || true
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
export R744_W='{"strip":true,"tally":"26 runs · 83 ev · 23 verdicts· 15u· 45nj","chips":26}' \
       R744_LD='{"ld":true,"count":"45","hasIntern":true,"hasFast":true,"hasPaid":true,"lanes":"intern-systemone; fast-judge AIHubMix · qwen3.8-flash-free (qwen3.8-flash-free); fast-judge AIHubMix · qwen3.8-max-free (qwen3.8-max-free); fast-judge; jev (paid rung); fast-judge Z.ai · glm-5.3 (glm-5.3); fast-judge Intern TokenPlan · glm-5.3 (glm-5.3)"}' \
       R744_FLD="$FLD" \
       R744_SET='{"census":true,"relay":true}' R744_RAD='frontier-aria-clicked' \
       R744_PASTE='paste-len:799' R744_CRON='1/1' \
       R744_TSC="$TSC" R744_LINTLINE="$LINTLINE" R744_GC="$GC" R744_CC="$CC" R744_CEN="$CEN"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r744')
L.append('Agent: NEXUS patrol (main agent — job 473388, 23:07 slot; opened on the r743 handoff verbatim)')
L.append('Task: Patrol round 744 — watch round per the r743 handoff (no manufactured increments). Second FROZEN slot inside the new rhythm: corpus 83 rows · 26 runs · verdict 23 (PASS 19 / FAIL 4) · uncertain 15 · nj 45 — ZERO new rows (newest remains run_81dbe4d56416 @22:18 +08). Lane set steady at SEVEN (no eighth entry), no flicker sample (zero gate traffic; the pattern candidate stays 2-of-4 slots), no re-store signal (verdict flat). CADENCE HYPOTHESIS (new watched variable): the last four slots read grind(+4) → frozen (r742) → grind(+4) → frozen (r744) — an alternating grind/quiet rhythm may be emerging; too early to call, tracked going forward.')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): worklog tail read FIRST — r743 handoff followed verbatim; git top 92af1e2f9 (r743 sweep); tree clean (the pulse file is clean this slot); server 200; quick_check ok. Census (ro-mode): 83 rows · 26 runs — verdict 23 (PASS 19 / FAIL 4) · uncertain 15 · no-judge 45; newest row run_81dbe4d56416 @22:18 +08 unchanged. Trend: nj 8→10→13→15→18→20→(20)→21→23→28→30→33→35→(35)→38→41→(41)→45→(45 frozen); verdict flat at 23 three slots running.')
L.append('- JUDGE-LANE WATCH: all four watch signatures quiet this slot — no eighth lane (seven steady since 03:57 +08), no flicker third sample (zero gate traffic at all), no re-store (verdict flat), outage-quiet confirmed as the slot signature. CADENCE NOTE: with the r742 and r744 slots both frozen and the r743 slot grinding +4, the alternating grind/quiet rhythm is now a named watched variable — if the alternation holds, r745 grinds again; a THIRD consecutive frozen slot would re-rank the hypothesis toward a bursty upstream scheduler; a grind-then-frozen-collapse would too.')
L.append('- WITNESS HYGIENE (sixth slot running): board tally "26 runs · 83 ev · 23 verdicts· 15u· 45nj" (chips 26) == DB census byte-for-byte on the FIRST eval — three-way agreement (API shape r738 · DB ro-mode · fresh board), zero scare rounds. LD title: the same seven-entry dedup set at count 45. TEMPLATE FIX APPLIED (the r743 handoff item): all four QA leg URLs carry unique r744 params (r=744 / r=744s / r=744r / r=744w, verified by grep before the run). Root cause of the r743 miss recorded: ?r=742 URLs contain no contiguous r742 substring, so a bare r742→r743 sed never touched them; the corrected DUAL-pattern sed (s/r=744/r=745/g for URLs + s/r744/r745/g for strings) is the new adaptation standard, recorded in the handoff.')
L.append('- GOLDEN QA: settings '+os.environ.get('R744_SET','')+' · radar '+os.environ.get('R744_RAD','')+' · workflows '+os.environ.get('R744_PASTE','')+' · cron chip '+os.environ.get('R744_CRON','')+' · console: HMR/DevTools info logs only, no errors · page errors: none')
L.append('- FRESH WITNESS (cache-busted close leg): '+os.environ.get('R744_FLD',''))
L.append('- NO-SHIP DISPOSITION: QA surfaced nothing broken; per the r743 handoff (hold steady, no manufactured increments) and the frame early-clean-exit clause, r744 closes as a clean WATCH round: zero code delta; named evaluation = the first-try three-way agreement witness + the fresh LD title witness + the applied dual-pattern template fix.')
L.append('- GATES: tsc_exit='+os.environ.get('R744_TSC','')+' · lint '+os.environ.get('R744_LINTLINE','')+' · qa-gate-census '+os.environ.get('R744_GC','')+' · qa-cortex-census '+os.environ.get('R744_CC','')+' · close census '+os.environ.get('R744_CEN',''))
L.append('- BUDGET: 7 rounds (five under the <=12 cap): R1 worklog-tail + git + server + probe batch, R2 census + signature check, R3 sed-adapt misfire (grep aborted the chain before any run — no cost), R4 fixed dual-pattern sed + QA run green, R5 this close chain written, R6 close run (guards abort BEFORE commit), R7 sweep + verification. Post-close tee sweep baked into this chain (r722..r743 precedent) — disclosed here and in the commit message.')
L.append('Stage Summary:')
L.append('- A second quiet slot inside the new rhythm: zero gate traffic, seven lanes steady, the board self-verified first-try for the sixth slot running, and the r743 template fix landed with zero drama. The alternating grind/quiet cadence is the newest watched variable; cure stays Owner-side: vault re-store BACKUP-FIRST + Cortex P1 v2 deploy.')
L.append('Round Handoff:')
L.append('Round ID: r745 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 83 rows baseline; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. Diff tooling: tuple-key on (runId, note, createdAt) — the /api/evals runs rows carry NO id (r735 lesson). (2) JUDGE-LANE WATCH: seven tried-lane entries steady since 03:57 +08; CADENCE HYPOTHESIS (r744): alternating grind/quiet rhythm — grind(+4) → frozen → grind(+4) → frozen across r742–r744; watch whether r745 grinds again (alternation holds), freezes a third consecutive time (rhythm collapse → bursty-scheduler re-rank), or shows (a) an EIGHTH lane entry (broadening signal), (b) the flicker THIRD sample (judged +1/slot beside same-run nj rows; candidate 2-of-4 slots), (c) re-store (verdict growth ACCELERATING). WITNESS HYGIENE (r738 lesson, r739-r744-proven): open board witnesses with a UNIQUE ?r=745 query param — the sed-adaptation standard is the DUAL pattern (s/r=744/r=745/g for the four URLs AND s/r744/r745/g for strings; the r743 miss is recorded in r744 prose). (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) NEXT INCREMENT CANDIDATES: the ergonomics arc is complete through r736 — hold steady on watch rounds while the Owner-side cures land, or fix whatever the golden QA surfaces first; no manufactured increments. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix (lives outside repo docs — needs Owner input); optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (first-try three-way agreement + fresh LD title + the applied dual-pattern template fix, evidence-anchored in scripts/qa_r744.txt and scripts/qa_r744_close.txt).')
with open('worklog.md','a') as f:
    f.write('\n'.join(L) + '\n')
print('worklog appended')
PY
echo "--- commit + push ---"
cat > scripts/r744_commitmsg.txt <<'MSG'
r744: watch round — second FROZEN slot inside the new rhythm (83 rows · 26 runs ·
verdict 23 PASS 19/FAIL 4 · uncertain 15 · nj 45; zero new rows, newest still
run_81dbe4d56416 @22:18) — lane set steady at SEVEN (no eighth entry), no
flicker sample (candidate stays 2-of-4 slots), no re-store signal. CADENCE
HYPOTHESIS: the last four slots read grind(+4) → frozen → grind(+4) → frozen
— an alternating grind/quiet rhythm is now a watched variable (a third
consecutive freeze would re-rank toward a bursty upstream scheduler).
Witness hygiene sixth slot running: tally matched the DB census
BYTE-FOR-BYTE on the first eval; the r743 template fix is APPLIED — all four
QA leg URLs carry unique r=744 params (root cause of the r743 miss recorded:
?r=742 URLs hold no contiguous r742 substring; dual-pattern sed is the new
standard). Golden QA green (settings census/relay, radar frontier, paste-799,
cron 1/1, console 0 errors); gates green (tsc 0, lint 0 errors / 33-warning
baseline, qa-gate-census 48/48, qa-cortex-census 23/23); ZERO code delta —
clean watch disposition per r743 handoff (named evaluation = first-try
three-way agreement + fresh LD title + applied template fix,
scripts/qa_r744.txt). Post-close tee sweep baked into the close chain
(r722..r743 precedent).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r744_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main >/dev/null 2>&1 || { echo 'GUARD push origin'; exit 1; }
git push fork main >/dev/null 2>&1 || { echo 'GUARD push fork'; exit 1; }
echo "--- verify ---"
git log --oneline -1 | cat
git status --porcelain | head -3
echo "== r744 CLOSED =="
} 2>&1 | tee scripts/qa_r744_close.txt
exit ${PIPESTATUS[0]}
