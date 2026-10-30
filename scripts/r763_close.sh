#!/usr/bin/env bash
# r763 close (per-bucket route letters q/g/m + wave-8 watch): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - strip text edited, same view) -> tier-state probe (recorded - newest corpus bucket decides; qwen held it at open) -> wave-strip probe (gated presence / recorded text - now carries the route letters) -> divergence probe (RECORDED - both routes may hold diamonds while the tier alternates) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r763c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r763c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r763c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r763 QA GREEN' scripts/qa_r763.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r763.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r763.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=763c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips WERE touched this round - the increment edits chip semantics text -> the legend gate runs, r756-r763 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=763b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r763): RECORDED ONLY - the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120)}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe (r763 increment): presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# divergence probe (r763): RECORDED ONLY - with the middle tier alternating near-per-wave, BOTH routes can hold diamonds (each lags the newest-3 window when the other route holds the latest bucket); the SIGNAL is a diamond on intern/fast-judge/jev = a genuine partial ladder (amber-tone doctrine).
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
L.append('Task ID: r763')
L.append('Agent: NEXUS patrol (main agent - job 473388, 08:37 slot; opened on the r762 handoff - r762 found ALREADY CLOSED by the 08:07 slot, so this slot ran as r763)')
L.append('Task: Patrol round 763 - ROUTE LETTERS SHIP, WAVE 8 PENDING: the opening ro-SQL census read 122 ev / 32 runs / 86 nj - IDENTICAL to the r762 close census (newest 00:03:15 UTC, wave 7); no wave 8 at open, the corpus ~34 min quiet (not yet an interval break - the max observed gap is ~58 min, w4->w5). Shipped the r762-handoff named candidate: per-bucket route letters in the wave strip text - q = qwen-only, g = glm-only, m = both middle-tier routes answered, derived from laneTierOf over the same laneBuckets scan (single dependency kept), corpus-mode only (a lane-filtered strip is about one lane, not the relay); the letter is styled font-medium text-foreground/70 (styling detail polish) and the strip title documents the q/g/m legend. The wave-by-wave relay alternation is now legible in the recorded probe text itself.')
L.append('Work Log:')
L.append('- R1 open probes: r762 closed by the 08:07 slot (d461ccdd7 ship + 973d0d5f6 sweep; bucket-bounds hover + wave 7 qwen flip + the r761 correction); tree clean; server 200; ro-SQL census 122/32/21/15/86 - FLAT vs the r762 close, no wave 8 at open (~34 min quiet, newest 00:03:15 UTC) -> steady-watch path with the route-letter increment.')
L.append('- R2 templates: r763_qa.sh + r763_close.sh via the DUAL sed pattern (s/r=762/r=763/g + s/r762/r763/g) - zero mechanical remnants, bash -n green; the round-762 prose gaps (spelled-out Patrol round 762 + the literal Round ID r763 pointer) handled by this surgery pass; wave-8 census taken in the R1 batch.')
L.append('- R3 increment (run-kanban.tsx): the waveStrip memo gains the route computation (per bucket key: sum middle-tier lane counts per route via laneTierOf, q/g/m letter, empty when no middle-tier rows answered), return widened with route, the bucket label span gains the letter (corpus mode only, styled font-medium text-foreground/70), strip title gains the q/g/m legend sentence. Single MultiEdit, all three edits verified applied in the returned diff this time (r760/r762 marker-verify discipline honored).')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')
L.append('- R5 QA + close: the r763 golden QA ran GREEN first-try (board probe at the wave-7 census 32 runs / 122 ev / 86nj, chips 33; ld count 86, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (strip text edited - same view; r756-r763 precedent honored); tier-state probe RECORDED (newest bucket still 00:00 qwen-only at open - mid-qwen ACTIVE / mid-glm silent expected unless wave 8 lands mid-round); wave-strip probe presence GATED / text RECORDED - the text now carries q/g/m letters per bucket; divergence probe RECORDED ONLY (both routes may hold diamonds while the tier alternates); + census + snapshot + worklog + commit + dual push.')
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
L.append('- THE ALTERNATION GETS ITS LETTER: the route watch no longer needs the tier-state line cross-read - each strip bucket now self-describes its route composition (q/g/m) in plain text, so the recorded probe itself witnesses the relay alternation wave-by-wave. Cadence at open: corpus flat ~34 min since wave 7 (intervals w5->w6 ~13, w6->w7 ~42; max observed ~58) - a quiet opening is a datapoint, not a break; the close census re-reads. Route watch unchanged: flips normal, an m bucket (both routes, amber bar, 7 lanes) and a BOTH-SILENT bucket (3 lanes = genuine partial ladder) are the signals to investigate. Snapshot discipline nineteenth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')
L.append('- LETTER SEMANTICS (honest scoping): the letter is corpus-wide by design - it names which middle-tier routes answered in the bucket, not which lane a filtered view follows; in lane-filter mode the letters drop (the strip is about one lane there). An m-letter sighting would be the first witnessed both-routes bucket; none appeared at ship time (newest buckets: 00:00 qwen-only x4). No forward corrections owed this round - the r762 alternation narrative already matches the instruments.')
L.append('Round Handoff:')
L.append('Round ID: r764 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r763_qa.sh sed-adapted (DUAL pattern s/r=763/r=764/g + s/r763/r764/g); remember the round-763 prose gaps (spelled-out Patrol round 763 + the literal Round ID r764 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend view, else RECORDED; tier-state probe: RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED (text carries q/g/m letters since r763 - the recorded read IS the alternation witness); divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH (alternation era): tier-state flips, diamond handoffs, and the strip letters are the NORMAL signal - the first m bucket (both routes, amber, 7 lanes) or a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, an EIGHTH wave, or an interval-pattern break (gap far outside the 13-58 min band) = new signal. (5) Increment queue: no named candidate this handoff - candidates: (a) surfacing the newest-bucket letter in the tier-state line (mid-qwen ACTIVE (2/2) - letter q) if the Owner wants one-glance consistency; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay alternates routes wave-by-wave (glm/qwen handoffs witnessed r762) - describe the alternation, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the route letters shipped into a live wave-8 watch + full golden QA, anchored in scripts/qa_r763.txt and scripts/qa_r763_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r763: per-bucket route letters ship (q/g/m) + wave 8 pending. Opening census 122/32/21/15/86 - IDENTICAL to the r762 close (newest 00:03:15 UTC, wave 7); corpus ~34 min quiet at open, not yet an interval break (max observed gap ~58 min). Increment (r762-handoff named candidate): per-bucket route letter in the wave strip text - q = qwen-only, g = glm-only, m = both middle-tier routes answered per 15-min bucket, derived from laneTierOf over the same laneBuckets scan, corpus-mode only; letter styled font-medium text-foreground/70 (styling polish); strip title documents the legend. The wave-by-wave relay alternation is now legible in the recorded probe text itself. QA GREEN first-try at the wave-7 census (32/122/86nj, seven lanes). Snapshot discipline nineteenth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r763_close.txt
SWEEP=$(git add -A && git commit -m "r763: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
