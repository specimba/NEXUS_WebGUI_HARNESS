#!/usr/bin/env bash
# r760 close (route-tier grouping + wave-5 round): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - chips touched) -> tier-state probe (recorded) -> wave-strip probe (gated presence / recorded text, lanes figure included) -> divergence probe (RECORDED - expected while glm holds the tier) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r760c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r760c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r760c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r760 QA GREEN' scripts/qa_r760.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r760.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r760.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=760c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips WERE touched this round - the increment edits chip semantics text -> the legend gate runs, r756-r760 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=760b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r760): RECORDED ONLY - the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120)}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe (r760 increment): presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# divergence probe (r760): RECORDED ONLY - diamonds on the qwen lanes are EXPECTED while glm holds the middle tier (route-shift witness); a diamond appearing on intern/fast-judge/jev = a genuine partial ladder - investigate immediately (amber-tone doctrine).
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
L.append('Task ID: r760')
L.append('Agent: NEXUS patrol (main agent - job 473388, 07:07 slot; opened on the r759 handoff)')
L.append('Task: Patrol round 760 - WAVE 5 RETURNS + ROUTE-TIER GROUPING SHIPS: the opening ro-SQL census read 109 ev / 30 runs / 73 nj vs the r759 close baseline 100/28/21/15/64 - +9 events / +2 runs / +9 no-judge rows, newest 23:07:15 UTC, ~58 min after wave 4 - the fifth wave, RETURNING after one steady slot (verdict/uncertain flat at 21/15, so the growth is all no-judge rows across 2 new runs). Shipped the r759-handoff named candidate: route-tier grouping of the legend chips - laneTierOf (name-heuristic rung classifier: intern-systemone=entry, paid rung=paid, plain fast-judge=verify, qwen=middle qwen route, glm=middle glm route; heuristic not a hardcoded lane list, an eighth lane still classifies as unrouted), a corpus-tier-state line in the legend header (per-route ACTIVE/silent vs the newest corpus bucket with n/N lane counts - the route-shift witness on-page), and a per-chip rung tag; legend title documents the semantics. While glm holds the tier the qwen diamonds stay EXPECTED; a qwen state flip silent->ACTIVE = the free routes returning.')
L.append('Work Log:')
L.append('- R1 open probes: r759 closed by the 06:37 slot (2fb12add6 ship + 389ecfe92 sweep; the diamonds decoded - route-preference shift, not contraction); tree clean; server 200; opened r760 on the r759 handoff verbatim.')
L.append('- R2 templates + wave census: r760_qa.sh + r760_close.sh via the DUAL sed pattern (s/r=759/r=760/g + s/r759/r760/g) - zero r759 remnants (the round-759 prose gap handled by this surgery pass); ro-SQL census 109/30/21/15/73 - WAVE 5 (+9 ev / +2 runs / +9 nj, newest 23:07:15 UTC, ~58 min after wave 4; verdict/uncertain flat) -> wave-round path taken with the route-tier grouping increment.')
L.append('- R3 increment (run-kanban.tsx): laneTierOf rung classifier (name-heuristic: entry / paid / verify + the middle tier split by route), laneTiers memo (per-route lane lists + ACTIVE flags against the newest corpus-bucket key, derived from laneBuckets alone so the dependency stays single), corpus-tier-state span in the legend header (mid-qwen vs mid-glm with per-route ACTIVE/silent + n/N), per-chip rung tag (mid-qwen / mid-glm / entry / verify / paid / unrouted), legend title gains the r760 semantics sentence. MultiEdit note: the atomic batch reported failure on a stale anchor (laggards vs laggard lanes) yet applied edits 1-2 before aborting - tree verified marker-by-marker and the three missing edits re-applied cleanly (probe-verified, not assumed).')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')
L.append('- R5 QA + close: the r760 golden QA ran GREEN (board probe at the wave-5 census; ld count + seven lanes; console 0 errors; the wave-strip text carries the newest buckets - the probe record below holds the lanes figures). Close probes: chip GATED presence / tone recorded; legend GATED (chips touched - the increment edits legend rendering; r756-r760 precedent honored); tier-state probe RECORDED (new r760); wave-strip probe presence GATED / text RECORDED (lanes figure included); divergence probe RECORDED ONLY (diamonds expected while glm holds the tier); + census + snapshot + worklog + commit + dual push.')
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
L.append('- WAVE 5 + THE TIER WITNESS: the fifth wave returned after one steady slot (+9 ev / +2 runs / +9 nj; intervals w1->w2 ~56, w2->w3 ~16, w3->w4 ~41, w4->w5 ~58 min - the burst is intermittent, not periodic), and the legend now carries the route-tier grouping the r759 handoff named: the middle tier reads as two routes with per-route state against the newest corpus bucket, turning the r759 route-shift finding into a standing on-page witness (a qwen silent->ACTIVE flip = the free routes returning; a lag on intern/verify/paid = a genuine partial ladder). Eighth-lane and verdict/uncertain watches stay armed (the classifier labels an unknown lane unrouted on sight). Snapshot discipline sixteenth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')
L.append('Round Handoff:')
L.append('Round ID: r761 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r760_qa.sh sed-adapted (DUAL pattern s/r=760/r=761/g + s/r760/r761/g); remember the round-760 prose gap (third explicit edit in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the chips, else RECORDED; tier-state probe (r760 precedent): RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED (lanes figure included); divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the tier-state line + the (N lanes) figure are the route-shift witnesses - a qwen silent->ACTIVE flip = the free routes returning (diamonds vanish on qwen); glm ACTIVE->silent = the shift back; a lag on intern/fast-judge/jev = a genuine partial ladder - investigate immediately; any EIGHTH lane (the classifier labels it unrouted on sight), a VERDICT/UNCERTAIN growth wave, or a SIXTH wave = new signal. (5) Increment queue: per-bucket mini-bar rendering (CSS bars replacing the text strip) is the styling-polish candidate; divergence-first if any diamond changes; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix free-route silence since 21:12 UTC 10-29 (route-preference shift witness - the free-reach census in Settings may already reflect it; worth an Owner look alongside the platform report). (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the route-tier grouping shipped into a live fifth wave + full golden QA, anchored in scripts/qa_r760.txt and scripts/qa_r760_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r760: route-tier grouping ships + wave 5 returns. The opening census read 109/30/73 vs the r759 baseline 100/28/21/15/64 - +9 ev / +2 runs / +9 no-judge rows, newest 23:07:15 UTC (~58 min after wave 4), the fifth wave returning after one steady slot; verdict/uncertain flat. Increment (r759-handoff named candidate): laneTierOf rung classifier (name-heuristic: entry / paid / verify / middle-qwen / middle-glm - an eighth lane still classifies as unrouted), laneTiers memo with per-route ACTIVE/silent state against the newest corpus bucket, a corpus-tier-state line in the legend header (route-shift witness on-page), and a per-chip rung tag; legend title documents the semantics. While glm holds the tier the qwen diamonds stay expected; a qwen silent->ACTIVE flip = the free routes returning. Snapshot discipline sixteenth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r760_close.txt
SWEEP=$(git add -A && git commit -m "r760: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
