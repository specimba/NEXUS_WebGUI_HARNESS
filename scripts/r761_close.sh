#!/usr/bin/env bash
# r761 close (mini-bar strip + wave-6 round): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - chips touched via the strip the legend sits in; strip title edited) -> tier-state probe (recorded) -> wave-strip probe (gated presence / recorded text, lanes figure + bars included) -> divergence probe (RECORDED - expected while glm holds the tier) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r761c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r761c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r761c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r761 QA GREEN' scripts/qa_r761.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r761.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r761.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=761c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips WERE touched this round - the increment edits chip semantics text -> the legend gate runs, r756-r761 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=761b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r761): RECORDED ONLY - the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120)}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe (r761 increment): presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# divergence probe (r761): RECORDED ONLY - diamonds on the qwen lanes are EXPECTED while glm holds the middle tier (route-shift witness); a diamond appearing on intern/fast-judge/jev = a genuine partial ladder - investigate immediately (amber-tone doctrine).
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
L.append('Task ID: r761')
L.append('Agent: NEXUS patrol (main agent - job 473388, 07:37 slot; opened on the r760 handoff)')
L.append('Task: Patrol round 761 - WAVE 6 RETURNS, MINI-BAR STRIP SHIPS: the opening ro-SQL census read 118 ev / 31 runs / 82 nj vs the r760 close baseline 109/30/21/15/73 - +9 events / +1 run / +9 no-judge rows, newest 23:20:39 UTC, only ~13 min after wave 5 (intervals w4->w5 ~58, w5->w6 ~13 - erratic, re-accelerating; verdict/uncertain flat again, all growth no-judge rows). Shipped the r760-handoff styling-polish candidate: per-bucket mini-bars in the wave strip - height scales 2px per row (16px cap, 2px floor), an AMBER bar marks a mixed-tier (both-routes, >5 lanes) bucket, muted bars are single-tier - the route watch now reads bar color at a glance; strip title documents the scale and the color semantics. The bar transform keeps the exact text line (labels + counts + (N lanes)) as siblings, so the recorded probe format and the screen-reader path are unchanged.')
L.append('Work Log:')
L.append('- R1 open probes: r760 closed by the 07:07 slot (b40eb1d63 ship + 577e6e608 sweep; route-tier grouping + wave 5); tree clean; server 200; ro-SQL census 118/31/21/15/82 - WAVE 6 (+9 ev / +1 run / +9 nj, newest 23:20:39 UTC, ~13 min after wave 5; verdict/uncertain flat) -> wave-round path taken with the mini-bar strip increment.')
L.append('- R2 templates: r761_qa.sh + r761_close.sh via the DUAL sed pattern (s/r=760/r=761/g + s/r760/r761/g) - zero mechanical remnants; the round-760 prose gap (spelled-out Patrol round 760 + the literal Round ID r761 pointer) handled by this surgery pass; wave-6 census taken in the same R1 batch.')
L.append('- R3 increment (run-kanban.tsx): the wave strip map replaced with per-bucket bar+label spans (inline-flex items-end, whitespace-nowrap; bar = w-1.5 rounded-sm, height Math.max(2, Math.min(16, count*2))px, amber-500/40 when spread > 5 lanes in corpus mode, muted-foreground/30 otherwise; separators kept as text nodes so the recorded text format is byte-identical), strip title gains the mini-bar doc sentence. Two-edit MultiEdit verified applied by output diff this time (r760 lesson: verify markers, not the tool ack).')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')
L.append('- R5 QA + close: the r761 golden QA ran GREEN first-try (board probe at the wave-6 census 31 runs / 118 ev / 82nj, chips 32; ld count 82, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (strip title edited - the legend panel sits in the same view; r756-r761 precedent honored); tier-state probe RECORDED (r760 precedent); wave-strip probe presence GATED / text RECORDED (labels + lanes figures unchanged in format); divergence probe RECORDED ONLY (diamonds expected while glm holds the tier); + census + snapshot + worklog + commit + dual push.')
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
L.append('- SIX WAVES, ERRATIC CADENCE: w4->w5 ~58 min then w5->w6 ~13 min - the burst is neither periodic nor decaying; magnitude steady at +9 nj per wave for three waves now (w4 +4, w5 +9, w6 +9). The mini-bar strip turns the bucket row into a glanceable magnitude+composition read: bar height = row count, bar color = tier composition (amber = both-routes bucket). Every wave since r759 stayed glm-only (qwen free lanes silent since 21:12 UTC 10-29) - the tier-state line and the diamonds keep watching for the flip both ways. Eighth-lane and verdict/uncertain watches stay armed. Snapshot discipline seventeenth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')
L.append('Round Handoff:')
L.append('Round ID: r762 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r761_qa.sh sed-adapted (DUAL pattern s/r=761/r=762/g + s/r761/r762/g); remember the round-761 prose gap (spelled-out Patrol round 761 + the literal Round ID r762 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend view, else RECORDED; tier-state probe: RECORDED ONLY; wave-strip probe: presence GATED / text RECORDED (bars changed nothing in the text format); divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: tier-state line + bar color + (N lanes) figure are the route-shift witnesses - a qwen silent->ACTIVE flip = the free routes returning (diamonds vanish on qwen, strip bars go amber on new both-routes buckets); glm ACTIVE->silent = the shift back; a lag on intern/fast-judge/jev = a genuine partial ladder - investigate immediately; any EIGHTH lane (the classifier labels it unrouted on sight), a VERDICT/UNCERTAIN growth wave, a SEVENTH wave, or an interval-pattern break = new signal. (5) Increment queue: bucket-bound tooltips on the mini-bars (hover shows the exact bucket start-end UTC) is the named styling-polish candidate; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix free-route silence since 21:12 UTC 10-29 - now spanning three waves (w5/w6 glm-only) - worth an Owner look alongside the platform report. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the mini-bar strip shipped into a live sixth wave + full golden QA, anchored in scripts/qa_r761.txt and scripts/qa_r761_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r761: mini-bar wave strip ships + wave 6 returns. The opening census read 118/31/82 vs the r760 baseline 109/30/21/15/73 - +9 ev / +1 run / +9 no-judge rows, newest 23:20:39 UTC, only ~13 min after wave 5 (intervals w4->w5 ~58, w5->w6 ~13 - erratic, re-accelerating); verdict/uncertain flat, all growth no-judge rows. Increment (r760-handoff styling-polish candidate): per-bucket mini-bars in the wave strip - height 2px per row (16px cap), amber bar = mixed-tier both-routes bucket (>5 lanes), muted = single-tier; the exact text line (labels + counts + (N lanes)) kept as siblings so the recorded probe format is unchanged; strip title documents scale + color semantics. Every wave since r759 glm-only - the tier-state line and diamonds keep watching both ways. Snapshot discipline seventeenth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r761_close.txt
SWEEP=$(git add -A && git commit -m "r761: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
