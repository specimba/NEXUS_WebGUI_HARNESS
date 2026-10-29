#!/usr/bin/env bash
# r737 close chain — watch round (worklog append + gates + commit + dual push; r736 template)
set -u
cd /home/z/my-project
{
echo "== r737 close =="
echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r737_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r737_tsc.txt; exit 1; }
bun run lint > scripts/qa_r737_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r737_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r737_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }
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
export R737_W='{"strip":true,"tally":"21 runs · 66 ev · 21 verdicts· 15u· 30nj","chips":21}' \
       R737_LD='{"ld":true,"hasIntern":true,"hasFast":true,"hasTokenPlan":true,"hasAIHubMix":true,"lanes":"intern-systemone; fast-judge Z.ai · glm-5.3 (glm-5.3); fast-judge Intern TokenPlan · glm-5.3 (glm-5.3); fast-judge; jev (paid rung); fast-judge AIHubMix · qwen3.8-flash-free (qwen3.8-flash-free); fast-judge AIHubMix · qwen3.8-max-free (qwen3.8-max-free)"}' \
       R737_SET='{"census":true,"relay":true}' R737_RAD='frontier-aria-clicked' \
       R737_PASTE='paste-len:799' R737_CRON='1/1' \
       R737_TSC="$TSC" R737_LINTLINE="$LINTLINE" R737_GC="$GC" R737_CC="$CC" R737_CEN="$CEN"
python3 - <<'PY'
import os, datetime
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r737')
L.append('Agent: NEXUS patrol (main agent — job 473388, 19:37 slot; opened on the r736 handoff verbatim)')
L.append('Task: Patrol round 737 — watch round per the r736 handoff (ergonomics arc complete; no manufactured increments). Parallel-session check at open: r736 found ALREADY CLOSED by the 19:07 session (commits d3dbe245f + 9784c5816 verified at top of git log, clean tree, server 200) — slot taken cleanly, r737 opened on the r736 handoff. The judge-lane watch CAUGHT THE BROADENING: the r736 nj-token title now names SEVEN distinct tried-lane entries (was three at r736) — the fast-judge family is churning through its provider rotation (Z.ai glm-5.3, Intern TokenPlan glm-5.3, AIHubMix qwen3.8-flash-free, AIHubMix qwen3.8-max-free, plus a bare fast-judge) alongside intern-systemone and a "jev (paid rung)" trace — ALL failing. Corpus 64→66 (+2), verdict 21 FLAT, uncertain 15 FLAT, nj 28→30 (+2, pace moderated from +5). Board tally matches the DB census byte-for-byte.')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): worklog tail read FIRST — r736 handoff followed verbatim; server 200; quick_check ok. Corpus census (READ-ONLY uri mode, no stray-file trap): 66 rows · 21 runs — verdict 21 (PASS 17 / FAIL 4) · uncertain 15 · no-judge 30. Tuple-keyed attribution (the r735 lesson, applied): +2 rows on ONE new run (run_e1c68c05c52d), both gate-no-judge naming intern-systemone AND fast-judge Z.ai · glm-5.3. Trend: nj 8→10→13→15→18→20→(20)→21→23→28→30. No recycle wipe; snapshot road idle.')
L.append('- JUDGE-LANE WATCH (the round named evaluation): fresh load, board digest + LD witness on the nj token title: '+os.environ.get('R737_LD','')+' — the handoff early-warning surface FIRED: not a third lane but a SEVEN-entry rotation; even a paid rung was tried and failed. The vault (0 lanes) starves every rung of both families — the rotation is the harness scraping the bottom of the relay list. Cure stays Owner-side (vault re-store BACKUP-FIRST + Cortex P1 v2 deploy). BOARD/LEDGER AGREEMENT witnessed: tally "21 runs · 66 ev · 21 verdicts· 15u· 30nj" equals the DB census exactly ('+os.environ.get('R737_CEN','')+').')
L.append('- GOLDEN QA: settings '+os.environ.get('R737_SET','')+' · radar '+os.environ.get('R737_RAD','')+' · workflows '+os.environ.get('R737_PASTE','')+' · cron chip '+os.environ.get('R737_CRON','')+' · console: Fast-Refresh logs only, no errors · page errors: none')
L.append('- DISCLOSURE (honest witness, no defect): the board-layout radio eval returned "radio-MISS" on the fresh load — the strip digest and all board legs green regardless (the board view renders by default in this session; radio absent or already-selected). No guard was placed on the radio; nothing to fix. Second disclosure: the title carries "jev (paid rung)" verbatim — an older row wording faithfully lifted by laneDistressOf; not a parser artifact.')
L.append('- NO-SHIP DISPOSITION: golden QA surfaced nothing broken; per the r736 handoff (hold steady, no manufactured increments) and the frame early-clean-exit clause, r737 closes as a clean WATCH round: the named evaluation (seven-lane title witness + board/ledger agreement) is the round evidence; ZERO code delta; gates re-run fresh and green below.')
L.append('- GATES: tsc_exit='+os.environ.get('R737_TSC','')+' · lint '+os.environ.get('R737_LINTLINE','')+' · qa-gate-census '+os.environ.get('R737_GC','')+' · qa-cortex-census '+os.environ.get('R737_CC',''))
L.append('- BUDGET: 9 rounds (three under the <=12 cap): R1 worklog-tail + git + server + probe batch, R2 tight re-check (handoff + git + probe tail), R3 census + lane extraction + script map, R4 golden-leg recovery from r736_close.sh, R5 qa script written (r737_qa.sh), R6 QA run green, R7 this close chain written, R8 close run (guards abort BEFORE commit), R9 verification. Post-close tee sweep baked into this chain (close log captures its own post-commit status line; r722..r736 precedent) — disclosed here and in the commit message.')
L.append('Stage Summary:')
L.append('- The r736 lane-naming ship proved its worth one slot later: the early-warning surface caught the outage BROADENING (three → seven tried-lane entries) with zero new code. The rotation exhaustion picture (free rungs AND a paid rung all failing) strengthens the Owner-side case: only the vault re-store + Cortex P1 v2 can answer gates again. Watch posture continues; the title is the slot-to-slot evidence road.')
L.append('Round Handoff:')
L.append('Round ID: r738 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 66 rows; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. Diff tooling: tuple-key on (runId, note, createdAt) — the /api/evals runs rows carry NO id (r735 lesson). (2) JUDGE-LANE WATCH — the title now names SEVEN tried-lane entries: watch for (a) an EIGHTH entry (rotation exhausting the last rungs of the relay list), (b) entries VANISHING while judged growth resumes (the re-store landing — the title is the early-warning surface), (c) the pace: nj ...→28→30; +2/slot is a slower flood than the +5 scare, but judged FLAT at 21 means nothing is being answered — the vault cure is the only lever. (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) NEXT INCREMENT CANDIDATES: the ergonomics arc is complete through r736 — hold steady on watch rounds while the Owner-side cures land, or fix whatever the golden QA surfaces first; no manufactured increments. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix (lives outside repo docs — needs Owner input); optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the seven-lane title witness + board/ledger byte-for-byte agreement is the named evaluation, evidence-anchored in scripts/qa_r737.txt and scripts/qa_r737_close.txt).')
with open('worklog.md','a') as f:
    f.write('\n'.join(L) + '\n')
print('worklog appended')
PY
echo "--- commit + push ---"
cat > scripts/r737_commitmsg.txt <<'MSG'
r737: watch round — the nj title caught the outage BROADENING (3→7 tried-lane
entries: fast-judge rotation Z.ai/TokenPlan/AIHubMix flash+max, bare
fast-judge, jev paid rung, intern-systemone — all failing); corpus 66 (+2),
nj 30 (+2), verdict 21 flat, uncertain 15 flat; board tally == DB census
(byte-for-byte); golden QA green (settings census/relay, radar frontier,
paste-799, cron 1/1, console 0 errors); gates green (tsc 0, lint 0 errors /
33-warning baseline, qa-gate-census 48/48, qa-cortex-census 23/23); ZERO
code delta — clean watch disposition per r736 handoff (no manufactured
increments; named evaluation = seven-lane title witness + board/ledger
agreement, scripts/qa_r737.txt). Disclosures: radio-MISS on fresh load
(board renders by default — no defect); "jev (paid rung)" verbatim in title
(faithful lift, not a parser artifact). Post-close tee sweep baked into the
close chain (r722..r736 precedent).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r737_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main >/dev/null 2>&1 || { echo 'GUARD push origin'; exit 1; }
git push fork main >/dev/null 2>&1 || { echo 'GUARD push fork'; exit 1; }
echo "--- verify ---"
git log --oneline -2
git status --porcelain | head -3
echo "== r737 CLOSED =="
} 2>&1 | tee scripts/qa_r737_close.txt
exit ${PIPESTATUS[0]}
