#!/usr/bin/env bash
# r759 close (diamond investigation + semantics correction + lanes figure): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - chips touched) -> wave-strip probe (gated presence / recorded text, lanes figure included) -> divergence probe (RECORDED - expected while glm holds the tier) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r759c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r759c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r759c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r759 QA GREEN' scripts/qa_r759.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r759.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r759.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=759c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips WERE touched this round - the increment edits chip semantics text -> the legend gate runs, r756-r759 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=759b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# wave-strip probe (r759 increment): presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# divergence probe (r759 increment): RECORDED ONLY - zero diamonds is the CORRECT muted state under the full-ladder shape (amber-tone doctrine).
DIV=$(timeout 30 agent-browser eval "(() => { const d=[...document.querySelectorAll('[data-testid=\"corpus-lane-legend\"] [data-div=\"1\"]')]; return JSON.stringify({divBadges:d.length}); })()" 2>&1 | tail -1)
echo "divergence: $DIV"
# lane-filter probe (chips WERE touched this round - the legend gate above runs; the fixed tally assertion stays GATED).
LCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[data-testid=\"corpus-lane-legend\"] button'); if(!b) return 'legend-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "lane filter click: $LCLICK"
sleep 1
LF=$(timeout 30 agent-browser eval "(() => { const on=document.querySelector('[data-testid=\"corpus-lane-legend\"] button[aria-pressed=\"true\"]'); const shown=[...document.querySelectorAll('span')].some(x=>/ of .* shown/.test(x.textContent||'')); const tally=[...document.querySelectorAll('span')].some(x=>/runs . \\d+ ev/.test(x.textContent||'')); return JSON.stringify({pressed:!!on, shownChip:shown, tallyWholeCorpus:tally}); })()" 2>&1 | tail -1)
echo "lane filter: $LF"
echo "$LF" | grep -Eq 'tallyWholeCorpus\\?":true' || { echo 'GUARD lane-filter tally'; exit 1; }
timeout 30 agent-browser eval "(() => { const b=document.querySelector('[data-testid=\"corpus-lane-legend\"] button[aria-pressed=\"true\"]'); if(b) b.click(); return 'untoggled'; })()" >/dev/null 2>&1 || true
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
export R754_TSC="$TSC" R754_LINT="$LTAIL" R754_GC="$GC" R754_CC="$CC" R754_CEN="$CEN" R754_SNAP="$SNAP" R754_QW="$QW" R754_QLD="$QLD" R754_CHIP="$CHIP" R754_LEG="$LEG" R754_LF="$LF" R754_STRIP="$STRIP" R758_DIV="$DIV"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r759')
L.append('Agent: NEXUS patrol (main agent - job 473388, 06:37 slot; opened on the r758 handoff + forward correction)')
L.append('Task: Patrol round 759 - THE DIAMOND INVESTIGATION (the r758 correction first action) + SEMANTICS CORRECTED ON-PAGE: the wave-2/4 verbatim trace diff found the truth - every row ever names a 5-LANE CHAIN (intern-systemone, two middle-tier routes, fast-judge, jev paid rung; relay chain exhausted (top 2 hops, no verdict) and jev not armed (no key) unchanged across all eras) whose middle tier ALTERNATES ROUTES: either the qwen free pair (AIHubMix flash+max) or the glm-5.3 pair (Z.ai + Intern TokenPlan), never all four. Wave-2 alternated WITHIN one run (rows 0-1 qwen, rows 2-3 glm, same 21:12:23 timestamp); waves 3-4 standardized on glm (qwen free lanes silent since ~21:12 UTC). So the r758 contraction/truncation interpretation was WRONG in mechanism - traces were never 7-wide; the divergence diamonds fired on a ROUTE-PREFERENCE SHIFT. Shipped: the instrument on-page text corrected (diamond span titles, chip-title clause, legend title, helper comments now say recent-bucket lag - route-preference shift or partial ladder - check the laggards before interpreting; stale full-ladder premise sentences removed), and the named-candidate increment sharpened: laneSpread (distinct lanes named per bucket) rendered in the wave strip as (N lanes) - a mixed-tier bucket reads 7, single-tier 5, making route alternation an on-page witness.')
L.append('Work Log:')
L.append('- R1 open probes: r758 closed by the 06:07 slot (3455b7bc6 ship + a617ac734 sweep + 42e58ecdc forward correction); tree clean; server 200; census 100/28/21/15/64 STEADY at the close baseline (no wave 5); opened r759 with the correction first action.')
L.append('- R2 trace diff + templates: wave-2 run_23430243dca4 vs wave-4 run_918b2b94af40 verbatim notes plus old-row baselines (16:36 glm, 17:17 qwen): ALL rows 5 lanes; middle tier alternates qwen pair / glm pair; wave-2 rows 0-1 qwen + rows 2-3 glm inside one run; wave-4 all glm; relay chain exhausted (top 2 hops) + jev not armed (no key) unchanged. The alternation predates the waves, so nothing was removed from any config - the qwen free routes simply stopped being picked. r759_qa.sh + r759_close.sh via the DUAL sed pattern (s/r=758/r=759/g + s/r758/r759/g) - zero r758 remnants (the round-758 prose gap handled by this surgery pass).')
L.append('- R3 increment (run-kanban.tsx): laneBucketsOf gains laneSpread (distinct lanes named per bucket, computed from the per-lane bucket counts in one post-pass), the wave strip renders (N lanes) per bucket in corpus mode (filtered mode unchanged), strip title documents the lanes figure + the route-alternation shape, diamond semantics text corrected on-page (span title, chip-title clause, legend title), stale full-ladder premise sentences removed from the strip title and helper comments.')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')
L.append('- R5 QA + close: the r759 golden QA ran GREEN (board probe steady 28 runs / 100 ev / 64nj; ld count 64, seven lanes - the ld title lists all seven including the silent qwen pair; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (chips touched - semantics text edits; r756-r759 precedent honored); wave-strip probe presence GATED / text RECORDED (now carrying the lanes figure); divergence probe RECORDED ONLY (four diamonds were live at the r758 close and are EXPECTED while glm holds the tier); + census + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R754_QW','(missing)'))
L.append('  ' + os.environ.get('R754_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R754_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R754_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R754_LF','(missing)'))
L.append('  wave strip: ' + os.environ.get('R754_STRIP','(missing)'))
L.append('  divergence: ' + os.environ.get('R758_DIV','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R754_TSC','?') + ' - lint ' + os.environ.get('R754_LINT','?') + ' - qa-gate-census ' + os.environ.get('R754_GC','?') + ' - qa-cortex-census ' + os.environ.get('R754_CC','?') + ' - close census ' + os.environ.get('R754_CEN','?') + ' - snapshot: ' + os.environ.get('R754_SNAP','?'))
L.append('Stage Summary:')
L.append('- THE DIAMONDS DECODED: the r758 four-diamond debut was a route-preference shift, not a partial ladder - the middle tier of the 5-lane chain stopped routing through the qwen free pair after ~21:12 UTC (last qwen appearance 21:12:23; wave-3 at 21:28 onward is glm-only). The 5-lane chain shape holds across ALL eras (16:36 glm, 17:17 qwen), so no config change is witnessable in the trace: the qwen free routes stopped being picked. Candidate causes are Owner-queue items (AIHubMix free-quota exhaustion or a route-priority change upstream - the relay lives outside this repo; the app reads the trace verbatim). The wave strip (N lanes) figure turns route alternation into an on-page witness: the 21:00 bucket reads 7 lanes (both routes named in one bucket), single-tier buckets 5. Instrument semantics corrected forward: a diamond = recent-bucket lag = route shift OR partial ladder - the interpretation step is mandatory before reacting. Cadence record unchanged: the four-wave burst stands (w5 watch continues). Snapshot discipline fifteenth close. Witness six-legged, all green.')
L.append('Round Handoff:')
L.append('Round ID: r760 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r759_qa.sh sed-adapted (DUAL pattern s/r=759/r=760/g + s/r759/r760/g); remember the round-759 prose gap (third explicit edit in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the chips, else RECORDED; wave-strip probe: presence GATED / text RECORDED (lanes figure included); divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH (new, r759): the (N lanes) figure is the route-shift witness - a bucket reading 7 = both routes named; while glm holds the tier, diamonds on the qwen lanes are EXPECTED (muted-until-shift both ways: a diamond VANISHING on qwen = the free routes returning; a diamond appearing on intern/fast-judge/jev = a genuine partial ladder - investigate immediately); any EIGHTH lane, a VERDICT/UNCERTAIN growth wave, or a FIFTH consecutive/returning wave = new signal. (5) Increment queue: on-page route-tier grouping of the legend chips (label the qwen pair + glm pair as one middle tier with per-route state) is the named candidate; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; NEW: AIHubMix free-route silence since 21:12 UTC 10-29 (route-preference shift witness - the free-reach census in Settings may already reflect it; worth an Owner look alongside the platform report). (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the diamond investigation discharged with the route-shift finding + semantics corrected on-page + the lanes figure shipped, anchored in scripts/qa_r759.txt and scripts/qa_r759_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r759: diamonds decoded - route-preference shift, not contraction; lanes figure ships. The wave-2/4 trace diff found every row names a 5-lane chain whose middle tier ALTERNATES routes (qwen free pair vs glm-5.3 pair, never all four); wave-2 alternated within one run (rows 0-1 qwen, rows 2-3 glm, 21:12:23 UTC), waves 3-4 are glm-only (qwen free lanes silent since ~21:12 UTC; alternation predates the waves so no config change is witnessable). The r758 truncation interpretation was wrong in mechanism - traces were never 7-wide; the diamonds fired on the route shift. On-page corrections: diamond titles, chip-title clause and legend text now say recent-bucket lag (route shift or partial ladder - check the laggards before interpreting); stale full-ladder premise sentences removed. Increment: laneSpread in the wave strip - (N lanes) per bucket makes route alternation an on-page witness (mixed-tier bucket = 7 lanes). Snapshot discipline fifteenth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r759_close.txt
SWEEP=$(git add -A && git commit -m "r759: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
