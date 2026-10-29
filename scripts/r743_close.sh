#!/usr/bin/env bash
# r743 close chain — watch round (worklog + gates + commit + dual push; r742 template)
set -u
cd /home/z/my-project
{
echo "== r743 close =="
echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r743_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r743_tsc.txt; exit 1; }
bun run lint > scripts/qa_r743_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r743_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r743_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }
echo "--- fresh cache-busted LD witness ---"
agent-browser open "http://localhost:3000/?r=743c#workflows" >/dev/null 2>&1 || true
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
export R743_W='{"strip":true,"tally":"26 runs · 83 ev · 23 verdicts· 15u· 45nj","chips":26}' \
       R743_LD='{"ld":true,"count":"45","hasIntern":true,"hasFast":true,"hasPaid":true,"lanes":"intern-systemone; fast-judge AIHubMix · qwen3.8-flash-free (qwen3.8-flash-free); fast-judge AIHubMix · qwen3.8-max-free (qwen3.8-max-free); fast-judge; jev (paid rung); fast-judge Z.ai · glm-5.3 (glm-5.3); fast-judge Intern TokenPlan · glm-5.3 (glm-5.3)"}' \
       R743_FLD="$FLD" \
       R743_SET='{"census":true,"relay":true}' R743_RAD='frontier-aria-clicked' \
       R743_PASTE='paste-len:799' R743_CRON='1/1' \
       R743_TSC="$TSC" R743_LINTLINE="$LINTLINE" R743_GC="$GC" R743_CC="$CC" R743_CEN="$CEN"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r743')
L.append('Agent: NEXUS patrol (main agent — job 473388, 22:37 slot; opened on the r742 handoff verbatim)')
L.append('Task: Patrol round 743 — watch round per the r742 handoff (no manufactured increments). Gate traffic RESUMED after the r742 frozen slot: corpus 79→83 rows (+4), runs 25→26 (ONE new run run_81dbe4d56416 — four gate-no-judge rows, all at 22:18 +08, same dead-lane note shape), verdict 23 FLAT (PASS 19 / FAIL 4), uncertain 15 FLAT, nj 41→45 (+4). No third flicker sample (the pattern candidate stays 2-of-4 slots) and no re-store signal (verdict flat) — the non-frozen slot the r742 handoff asked about shows the plain outage grind. PLUS a lane-count correction under the honesty doctrine: the corpus holds SEVEN distinct tried-lane entries, not the six that r738–r742 prose claimed — the bare fast-judge fallback has been present since 03:24 +08 and the r741/r742 witness env values both carried seven; the board title was always accurate, the prose miscounted. No eighth lane: the set is unchanged since 03:57.')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): worklog tail read FIRST — r742 handoff followed verbatim; r742 itself was closed by the parallel 22:07 session (commits c7c687618 + sweep ccccb963b, verified in-repo — parallel-session protocol held, this agent took r743 cleanly on its handoff); git top ccccb963b; tree clean except db/gateway-pulse.json (runtime self-update — rides this commit, disclosed); server 200; quick_check ok. Census (ro-mode): 83 rows · 26 runs — verdict 23 (PASS 19 / FAIL 4) · uncertain 15 · no-judge 45; newest row 22:18 +08 on run_81dbe4d56416. Trend: nj 8→10→13→15→18→20→(20)→21→23→28→30→33→35→(35)→38→41→(41)→45; verdict flat at 23 two slots running.')
L.append('- JUDGE-LANE WATCH: the resumed slot answers the r742 question — the non-frozen signature is the OUTAGE GRIND (+4 nj, zero verdicts), not the flicker (no judged +1: no third sample, candidate stays 2-of-4) and not the re-store (no verdict growth). All four new rows are gate-no-judge on one run at one timestamp with intern-systemone + fast-judge dead-lane notes. LANE-COUNT CORRECTION (honesty doctrine, r707 mechanism): a per-lane first-appearance query shows SEVEN distinct tried-lane entries — intern-systemone, fast-judge AIHubMix qwen3.8-flash-free, fast-judge AIHubMix qwen3.8-max-free, fast-judge (bare fallback), jev (paid rung) all first seen 03:24 +08; fast-judge Z.ai glm-5.3 and fast-judge Intern TokenPlan glm-5.3 first seen 03:57 +08. The r741 and r742 witness env values BOTH carry the same seven entries — the board rendered the DB truth all along; the six-lane steady-state phrasing in r738–r742 prose was a persistent miscount of the witness value, now corrected. Watch item (a) stands: any EIGHTH entry is the broadening signal.')
L.append('- WITNESS HYGIENE (fifth slot running): board tally "26 runs · 83 ev · 23 verdicts· 15u· 45nj" (chips 26) == DB census byte-for-byte on the FIRST eval — three-way agreement (API shape r738 · DB ro-mode · fresh board), zero scare rounds. LD title: the same seven-entry dedup set at count 45. PROCEDURE NOTE (disclosed): the sed adaptation of the QA template replaced r742→r743 in most URLs but the leg params ?r=742s/742r/742w carry the pattern r=742x which the substitution missed — those three QA legs reused the r742-era params; freshness is proven by the tally content itself (83 ev is a state that never existed when those params were last used); the close leg below uses the unique ?r=743c; the handoff records the template fix (a r743→r744 sed must also rewrite the leg params).')
L.append('- GOLDEN QA: settings '+os.environ.get('R743_SET','')+' · radar '+os.environ.get('R743_RAD','')+' · workflows '+os.environ.get('R743_PASTE','')+' · cron chip '+os.environ.get('R743_CRON','')+' · console: HMR/DevTools info logs only, no errors · page errors: none')
L.append('- FRESH WITNESS (cache-busted close leg): '+os.environ.get('R743_FLD',''))
L.append('- NO-SHIP DISPOSITION: QA surfaced nothing broken; per the r742 handoff (hold steady, no manufactured increments) and the frame early-clean-exit clause, r743 closes as a clean WATCH round: zero code delta; named evaluation = the first-try three-way agreement witness + the fresh LD title witness + the per-lane first-appearance query that corrected the lane count.')
L.append('- GATES: tsc_exit='+os.environ.get('R743_TSC','')+' · lint '+os.environ.get('R743_LINTLINE','')+' · qa-gate-census '+os.environ.get('R743_GC','')+' · qa-cortex-census '+os.environ.get('R743_CC','')+' · close census '+os.environ.get('R743_CEN',''))
L.append('- BUDGET: 10 rounds (two under the <=12 cap): R1 worklog-tail + git batch, R2 server + probe + template listing, R3 close/qa template reads, R4 census + flicker check, R5 per-lane history + r741 witness compare, R6 qa script sed-adapt (bun misfire on bash file, no cost), R7 QA run green, R8 this close chain written, R9 close run (guards abort BEFORE commit), R10 sweep + verification. Post-close tee sweep baked into this chain (r722..r742 precedent) — disclosed here and in the commit message.')
L.append('Stage Summary:')
L.append('- The outage grind resumed exactly as watched: +4 nj, judged flat, and the lane count is now officially SEVEN (a prose miscount corrected — the board never lied). The three watch signatures stay separable: flicker (2-of-4 slots, silent this slot), re-store (no verdict growth), outage grind (this slot). The board self-verified first-try for the fifth slot running. Cure stays Owner-side: vault re-store BACKUP-FIRST + Cortex P1 v2 deploy.')
L.append('Round Handoff:')
L.append('Round ID: r744 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 83 rows baseline; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. Diff tooling: tuple-key on (runId, note, createdAt) — the /api/evals runs rows carry NO id (r735 lesson). (2) JUDGE-LANE WATCH: SEVEN tried-lane entries steady since 03:57 +08 (count corrected in r743 prose — the witnesses always showed seven); watch for (a) an EIGHTH entry (broadening signal), (b) the flicker THIRD sample (judged +1/slot beside same-run nj rows; candidate 2-of-4 slots), (c) re-store (verdict growth ACCELERATING), (d) pace off the 45 baseline (+3..4/slot grind). WITNESS HYGIENE (r738 lesson, r739-r743-proven): open board witnesses with a UNIQUE ?r=744 query param — AND when sed-adapting the QA template, rewrite the leg params too (r=743s/743r/743w → r=744s/744r/744w; the r743 round disclosed this miss). (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) NEXT INCREMENT CANDIDATES: the ergonomics arc is complete through r736 — hold steady on watch rounds while the Owner-side cures land, or fix whatever the golden QA surfaces first; no manufactured increments. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix (lives outside repo docs — needs Owner input); optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (first-try three-way agreement + fresh LD title + per-lane first-appearance correction, evidence-anchored in scripts/qa_r743.txt and scripts/qa_r743_close.txt).')
with open('worklog.md','a') as f:
    f.write('\n'.join(L) + '\n')
print('worklog appended')
PY
echo "--- commit + push ---"
cat > scripts/r743_commitmsg.txt <<'MSG'
r743: watch round — gate traffic RESUMED after the r742 frozen slot (79→83 rows
+4, 25→26 runs, one new run run_81dbe4d56416 ×4 gate-no-judge @22:18, verdict
23 FLAT PASS 19/FAIL 4, uncertain 15, nj 41→45) — the non-frozen signature is
the plain outage grind: no third flicker sample (candidate stays 2-of-4
slots), no re-store signal (verdict flat). LANE-COUNT CORRECTION (honesty
doctrine): the corpus holds SEVEN distinct tried-lane entries, not six as
r738–r742 prose claimed — the bare fast-judge fallback has been present since
03:24 +08; r741/r742 witness env values both carried seven; the board title
was always accurate, the prose miscounted; no eighth lane (set unchanged
since 03:57). Witness hygiene fifth slot running: board tally matched the DB
census BYTE-FOR-BYTE on the first eval (three-way agreement; three QA legs
disclosed as reusing r742-era params — sed missed the r=742x pattern,
freshness proven by tally content; close leg unique at ?r=743c). Golden QA
green (settings census/relay, radar frontier, paste-799, cron 1/1, console
0 errors); gates green (tsc 0, lint 0 errors / 33-warning baseline,
qa-gate-census 48/48, qa-cortex-census 23/23); ZERO code delta — clean watch
disposition per r742 handoff (named evaluation = first-try three-way
agreement + fresh LD title + per-lane first-appearance correction,
scripts/qa_r743.txt). Post-close tee sweep baked into the close chain
(r722..r742 precedent).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r743_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main >/dev/null 2>&1 || { echo 'GUARD push origin'; exit 1; }
git push fork main >/dev/null 2>&1 || { echo 'GUARD push fork'; exit 1; }
echo "--- verify ---"
git log --oneline -1 | cat
git status --porcelain | head -3
echo "== r743 CLOSED =="
} 2>&1 | tee scripts/qa_r743_close.txt
exit ${PIPESTATUS[0]}
