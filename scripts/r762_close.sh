#!/usr/bin/env bash
# r762 close (bucket-bounds hover + wave-7 route flip + r761 correction): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - strip title edited, same view) -> tier-state probe (recorded - EXPECTED FLIP: qwen ACTIVE / glm silent) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - both routes may hold diamonds while the tier alternates) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r762c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r762c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r762c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r762 QA GREEN' scripts/qa_r762.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r762.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r762.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=762c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips WERE touched this round - the increment edits chip semantics text -> the legend gate runs, r756-r762 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=762b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r762): RECORDED ONLY - the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120)}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe (r762 increment): presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# divergence probe (r762): RECORDED ONLY - with the middle tier alternating near-per-wave, BOTH routes can hold diamonds (each lags the newest-3 window when the other route holds the latest bucket); the SIGNAL is a diamond on intern/fast-judge/jev = a genuine partial ladder (amber-tone doctrine).
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
L.append('Task ID: r762')
L.append('Agent: NEXUS patrol (main agent - job 473388, 08:07 slot; opened on the r761 handoff)')
L.append('Task: Patrol round 762 - WAVE 7 FLIPS TO QWEN, BUCKET-BOUNDS HOVER SHIPS, r761 SILENCE CLAIM CORRECTED: the opening ro-SQL census read 122 ev / 32 runs / 86 nj vs the r761 close baseline 118/31/21/15/82 - +4 events / +1 run / +4 no-judge rows, newest 00:03:15 UTC (~42 min after wave 6; first 10-30 bucket - crossed midnight UTC); verdict/uncertain flat for the sixth straight wave. Full-trace read (ld lane ORDER shifted in QA - qwen pair moved 2nd/3rd in the count sort - investigated BEFORE narrating per the r758 lesson): wave 7 (run_9faf38f58f90) is QWEN-routed - the free routes returned; the middle tier is ALTERNATING near-per-wave (21:28 glm, 22:09 glm, 22:54 QWEN, 23:07 glm, 23:20 glm, 00:03 QWEN). Shipped the r761-handoff named candidate: bucket-bounds hover on the wave strip - laneBucketsOf tracks per-bucket min/max row epochs, the waveStrip memo passes bounds, each bucket span gains cursor-help + a title with the ACTUAL first/last corpus-row times (the MM-DD bucket key drops the year; the hover recovers it from the row epochs); strip title documents it.')
L.append('Work Log:')
L.append('- R1 open probes: r761 closed by the 07:37 slot (bf51262c7 ship + 300abb085 sweep; mini-bar strip + wave 6); tree clean; server 200; ro-SQL census 122/32/21/15/86 - WAVE 7 (+4 ev / +1 run / +4 nj, newest 00:03:15 UTC, ~42 min after wave 6, first 10-30 bucket) -> wave-round path with the bucket-bounds hover increment.')
L.append('- R2 templates: r762_qa.sh + r762_close.sh via the DUAL sed pattern (s/r=761/r=762/g + s/r761/r762/g) - zero mechanical remnants; the round-761 prose gap (spelled-out Patrol round 761 + the literal Round ID r762 pointer) handled by this surgery pass; wave-7 census taken in the R1 batch.')
L.append('- R3 increment (run-kanban.tsx): laneBucketsOf signature + body gain bucketBounds (min/max epoch tracked per bucket key in the same pass), return widened, waveStrip memo passes bounds through, each bucket span gains cursor-help + title (Bucket MM-DD HH:MM UTC (15-min slot) - corpus rows actually span YYYY-MM-DD HH:MM:SS to HH:MM:SS UTC), strip title gains the r762 hover sentence. MultiEdit partial-apply anomaly hit AGAIN (edits 1-3 applied, 4-6 skipped on a stale r759-era anchor missing the spread suffix) - tree verified marker-by-marker, the three missing edits re-applied cleanly with the corrected anchor (the anomaly is now a three-round pattern: r760, r762 - always verify markers, never trust the tool ack).')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')
L.append('- R5 QA + close: the r762 golden QA ran GREEN first-try (board probe at the wave-7 census 32 runs / 122 ev / 86nj, chips 33; ld count 86, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). The ld lane ORDER shift (qwen pair 2nd/3rd) triggered the pre-narration trace read that found the flip. Close probes: chip GATED presence / tone recorded; legend GATED (strip title edited - same view; r756-r762 precedent honored); tier-state probe RECORDED (EXPECTED FLIP: mid-qwen ACTIVE / mid-glm silent); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY (both routes may hold diamonds while the tier alternates); + census + snapshot + worklog + commit + dual push.')
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
L.append('- THE FLIP WITNESSED + THE RECORD STRAIGHTENED: wave 7 is qwen-routed - the newest bucket (00:00, x4) reads qwen-only, so the tier-state line is expected to read mid-qwen route ACTIVE (2/2) / mid-glm route silent (0/2) at close, the REVERSE of r760/r761; the alternation is near-per-wave and cyclical (glm and qwen hand the tier back and forth), so tier-state flips and diamond handoffs between the two routes are the NORMAL signal now - the instrument semantics were built for exactly this (r759). Cadence: w5->w6 ~13, w6->w7 ~42 min; magnitude +9/+9/+4; verdict/uncertain flat six waves running. Snapshot discipline eighteenth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')
L.append('- FORWARD CORRECTION (r762, honest re-read of the full trace): the r761 claim that the qwen free lanes were silent since 21:12 UTC 10-29 was WRONG - run_07a648a13e4e at 22:54:23 UTC (x5 rows, the 22:45 bucket the r761 close strip itself displayed) was QWEN-routed; the tier was never glm-locked, it was alternating wave-by-wave. The on-page instruments were honest (the 22:45 x5 (5 lanes) bucket witnessed it); the r761 prose narrative lagged the instruments. Corrections go forward; the r761 section text is untouched.')
L.append('Round Handoff:')
L.append('Round ID: r763 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r762_qa.sh sed-adapted (DUAL pattern s/r=762/r=763/g + s/r762/r763/g); remember the round-762 prose gap (spelled-out Patrol round 762 + the literal Round ID r763 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend view, else RECORDED; tier-state probe: RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED (hover added - text format unchanged); divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH (rewritten for the alternation era): tier-state flips and diamond handoffs between qwen/glm are the NORMAL signal - a flip back to glm, or a BOTH-ROUTES bucket ((N lanes)=7, amber bar), or a BOTH-SILENT bucket (3 lanes = genuine partial ladder - investigate immediately); a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (the classifier labels it unrouted on sight), a VERDICT/UNCERTAIN growth wave, or an EIGHTH wave = new signal. (5) Increment queue: a per-bucket route letter in the strip text (q/g/m suffix derived from which middle-tier routes answered in the bucket - makes the alternation legible in the recorded probe text itself) is the named candidate; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix free-route silence claim RETRACTED (r761 correction): the free routes are ALIVE (22:54 + 00:03 waves qwen-routed) - the relay alternates routes wave-by-wave; the platform report should describe the alternation, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the bucket-bounds hover shipped into a live seventh wave + the route flip witnessed + full golden QA, anchored in scripts/qa_r762.txt and scripts/qa_r762_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r762: bucket-bounds hover ships + wave 7 flips to qwen + r761 silence claim corrected. Census 122/32/86 vs the r761 baseline 118/31/82 - +4 ev / +1 run / +4 nj, newest 00:03:15 UTC (~42 min after wave 6, first 10-30 bucket); verdict/uncertain flat six waves. Full-trace read: wave 7 is QWEN-routed - the middle tier ALTERNATES near-per-wave (21:28 glm, 22:09 glm, 22:54 QWEN, 23:07 glm, 23:20 glm, 00:03 QWEN); r761 prose claimed qwen silent since 21:12 - WRONG, run_07a648a13e4e (22:54, the 22:45 bucket the strip displayed) was qwen-routed; instruments honest, narrative lagged; corrected forward, r761 text untouched. Increment (r761-handoff named candidate): bucket-bounds hover on the wave strip - laneBucketsOf tracks per-bucket min/max row epochs, bucket spans gain cursor-help + title with actual first/last row times (the MM-DD key drops the year; the hover recovers it); strip title documents. Snapshot discipline eighteenth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r762_close.txt
SWEEP=$(git add -A && git commit -m "r762: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
