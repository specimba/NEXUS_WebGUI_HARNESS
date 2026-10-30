#!/usr/bin/env bash
# r766 close (per-run route letters + wave 9 qwen-lean): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - run-card label edited, same view) -> tier-state probe (recorded - witnessed q, third straight) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - both routes may hold diamonds) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r766c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r766c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r766c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r766 QA GREEN' scripts/qa_r766.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r766.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r766.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=766c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips WERE touched this round - the increment edits chip semantics text -> the legend gate runs, r756-r766 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=766b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r766): RECORDED ONLY - the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120)}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe (r766 increment): presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# divergence probe (r766): RECORDED ONLY - with the middle tier alternating near-per-wave, BOTH routes can hold diamonds (each lags the newest-3 window when the other route holds the latest bucket); the SIGNAL is a diamond on intern/fast-judge/jev = a genuine partial ladder (amber-tone doctrine).
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
export R754_TSC="$TSC" R754_LINT="$LTAIL" R754_GC="$GC" R754_CC="$CC" R754_CEN="$CEN" R754_SNAP="$SNAP" R754_QW="$QW" R754_QLD="$QLD" R754_CHIP="$CHIP" R754_LEG="$LEG" R754_LF="$LF" R754_STRIP="$STRIP" R758_DIV="$DIV" R760_TIER="$TIER"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r766')
L.append('Agent: NEXUS patrol (main agent - job 473388, 10:07 slot; opened on the r765 handoff - HEAD fbcb161d7 = the r765 ship + sweep from the 09:37 slot, own-session lineage, no parallel round closed)')
L.append('Task: Patrol round 766 - WAVE 9 RETURNS, QWEN LEANS, PER-RUN ROUTE LETTERS SHIP: the opening ro-SQL census read 129 ev / 34 runs / 93 nj vs the r765 close baseline 126/33/21/15/90 - +3 events / +1 run / +3 no-judge rows, newest ~02:02:18 UTC, ~57 min after wave 8 - back INSIDE the band after the ~62 outlier; verdict/uncertain flat for the EIGHTH straight wave. Route: the live tier-state read witnesses bucket 10-30 02:00 letter q - mid-qwen ACTIVE (2/2) / mid-glm silent (0/2) - a THIRD straight qwen wave (00:03, 01:05, 02:02); per the r765 watch definition that is the LEAN-toward-the-free-routes signal (route sequence now glm, glm, qwen, glm, glm, qwen, qwen, qwen; amber-tone: a pattern shift to investigate, not a fault). Shipped the per-run route letter on the corpus run cards (deviation from handoff candidate (a) disclosed below - the builtin box extraction is a pure refactor parked for an Owner-asked round): laneRunLetterOf reuses the exact laneCountsOf tried-trace extraction + the laneTierOf heuristic per run (q = qwen-only, g = glm-only, m = both; an m run = a genuine both-routes run - investigate signal); the letter renders on each run pill with its own title. ACCEPTANCE WITNESSED LIVE: 34 run pills read back, tails evq / evq / evq / evg / evg - the run list now IS the wave-route history, and the newest three q runs match waves 7/8/9 (run_9faf38f58f90 = the wave-7 run recorded in r762).')
L.append('Work Log:')
L.append('- R1 open probes: no parallel session - HEAD fbcb161d7 was the r765 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 129/34/21/15/93 - WAVE 9 (+3 ev / +1 run / +3 nj, newest ~02:02:18 UTC, ~57 min after wave 8, back inside the band) -> wave-round path with the per-run letter increment.')
L.append('- R2 templates: r766_qa.sh + r766_close.sh via the DUAL sed pattern (s/r=765/r=766/g + s/r765/r766/g) - zero mechanical remnants, bash -n green; the round-765 prose gaps (spelled-out Patrol round 765 + the literal Round ID r766 pointer) handled by this surgery pass; wave-9 census taken in the R1 batch.')
L.append('- R3 increment (run-kanban.tsx): laneRunLetterOf helper inserted after laneCountsOf (same gateCensusOf noJudge gate + the same tried-trace regex, laneTierOf per extracted lane, q/g/m letter, empty when no middle-tier lanes), each run pill gains the letter span (font-medium text-foreground/70, own title documenting the semantics). Two-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')
L.append('- R5 QA + close: the r766 golden QA ran GREEN first-try (board probe at the WAVE-9 census 34 runs / 129 ev / 93nj, chips 35; ld count 93, seven lanes, no eighth, qwen pair still 2nd/3rd in the count sort; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (run-card label edited - same view; r756-r766 precedent honored); tier-state probe RECORDED (witnessed bucket 02:00 letter q); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R754_QW','(missing)'))
L.append('  ' + os.environ.get('R754_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R754_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R754_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R754_LF','(missing)'))
L.append('  wave strip: ' + os.environ.get('R754_STRIP','(missing)'))
L.append('  divergence: ' + os.environ.get('R758_DIV','(missing)'))
L.append('  tier state: ' + os.environ.get('R760_TIER','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R754_TSC','?') + ' - lint ' + os.environ.get('R754_LINT','?') + ' - qa-gate-census ' + os.environ.get('R754_GC','?') + ' - qa-cortex-census ' + os.environ.get('R754_CC','?') + ' - close census ' + os.environ.get('R754_CEN','?') + ' - snapshot: ' + os.environ.get('R754_SNAP','?'))
L.append('Stage Summary:')
L.append('- THE LEAN IS THE STORY: three straight qwen waves - the wave-by-wave alternation era is over, the relay is favoring the free routes (or glm is saturated); the cadence band held (57 min inside 13-62) while the route did not. Magnitude +9/+9/+4/+4/+3 - decaying since w5; verdict/uncertain flat eight waves. The run-card letters make the lean visible in the primary scan surface. Watches for wave 10: a g return = the alternation resumes (or load-balancing caught up), an m run = the first both-routes run (investigate), a zero-growth slot = the burst is ending. Snapshot discipline twenty-second close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the run-pill letter census (34 pills, newest three q) + the divergence census, all green.')
L.append('- CANDIDATE DEVIATION (disclosed): the handoff named the builtin box extraction (a) - a pure refactor with no user-facing change, and its own phrasing conditioned it on an Owner ask; this round shipped the letter instrument into the run list instead (the alternation era makes per-run route legibility the highest-value read), leaving the builtin box parked for an explicitly requested refactor round. The extraction regex is shared verbatim with laneCountsOf - one extraction truth, two consumers.')
L.append('Round Handoff:')
L.append('Round ID: r767 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r766_qa.sh sed-adapted (DUAL pattern s/r=766/r=767/g + s/r766/r767/g); remember the round-766 prose gaps (spelled-out Patrol round 766 + the literal Round ID r767 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/run-card view, else RECORDED; tier-state probe: RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: QWEN LEAN confirmed (three straight q, 00:03 + 01:05 + 02:02) - a fourth q cements the lean, a g return = alternation resumed, an m run or m bucket (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a TENTH wave, or an interval-pattern break (band 13 -> 42 -> 62 -> 57 - a gap far outside, or a zero-growth slot) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay LEAN UPDATE (r766): three straight qwen waves (00:03, 01:05, 02:02) after the wave-by-wave alternation - the platform report should describe the lean, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the per-run route letters shipped into a live wave-9 read - 34 run pills witnessed with the newest three q - + full golden QA, anchored in scripts/qa_r766.txt and scripts/qa_r766_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r766: per-run route letters ship + wave 9 leans qwen. Census 129/34/21/15/93 vs the r765 baseline 126/33/90 - +3 ev / +1 run / +3 nj, newest ~02:02:18 UTC, ~57 min after wave 8 (back inside the band); verdict/uncertain flat eight waves. Live tier-state read: bucket 10-30 02:00 letter q - a THIRD straight qwen wave (00:03, 01:05, 02:02): the wave-by-wave alternation era is over, the relay leans toward the free routes. Increment: laneRunLetterOf (same tried-trace extraction as laneCountsOf + laneTierOf per run; q/g/m, an m run = the both-routes investigate signal) rendering on every corpus run pill - acceptance witnessed live: 34 pills, tails evq/evq/evq/evg/evg, the run list is now the wave-route history (handoff candidate (a) builtin-box refactor deferred: pure refactor, Owner-ask gated). Snapshot discipline twenty-second close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r766_close.txt
SWEEP=$(git add -A && git commit -m "r766: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
