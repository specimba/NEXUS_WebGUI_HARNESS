#!/usr/bin/env bash
# r764 close (tier-state letter tag + wave 8 qwen-holds): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - tier-state text edited, same view) -> tier-state probe (recorded - now carries the newest-bucket letter; witnessed q at ship time) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - both routes may hold diamonds while routes hand off) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r764c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r764c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r764c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r764 QA GREEN' scripts/qa_r764.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r764.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r764.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=764c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips WERE touched this round - the increment edits chip semantics text -> the legend gate runs, r756-r764 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=764b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r764): RECORDED ONLY - the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120)}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe (r764 increment): presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# divergence probe (r764): RECORDED ONLY - with the middle tier alternating near-per-wave, BOTH routes can hold diamonds (each lags the newest-3 window when the other route holds the latest bucket); the SIGNAL is a diamond on intern/fast-judge/jev = a genuine partial ladder (amber-tone doctrine).
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
L.append('Task ID: r764')
L.append('Agent: NEXUS patrol (main agent - job 473388, 09:07 slot; opened on the r763 handoff - HEAD 759b9dd3a = the r763 ship + sweep from the 08:37 slot, own-session lineage, no parallel round closed)')
L.append('Task: Patrol round 764 - WAVE 8 RETURNS, QWEN HOLDS THE TIER, TIER-STATE LETTER TAG SHIPS: the opening ro-SQL census read 126 ev / 33 runs / 90 nj vs the r763 close baseline 122/32/21/15/86 - +4 events / +1 run / +4 no-judge rows, newest ~01:05:10 UTC, ~62 min after wave 7 - the LONGEST gap yet, marginally past the prior 58-min max (w4->w5); verdict/uncertain flat for the SEVENTH straight wave. The route: a live tier-state read witnesses bucket 10-30 01:00 letter q - mid-qwen ACTIVE (2/2) / mid-glm silent (0/2) - so wave 8 is QWEN-routed BACK-TO-BACK with wave 7: the first same-route repeat since the alternation began (glm, glm, qwen, glm, glm, qwen, qwen) - the near-per-wave alternation has BROKEN in favor of qwen (amber-tone: a pattern change, not a fault; the eighth-lane and both-silent watches stay armed). Shipped the r763-handoff candidate (a): the newest-bucket letter surfaced in the tier-state line - the line now opens with a (bucket MM-DD HH:MM - letter) tag before the per-route figures, corpus-wide semantics matching what the line already measured; title documents the q/g/m legend and the absent-means-no-middle-rows edge. The ship-time live read doubled as the acceptance witness.')
L.append('Work Log:')
L.append('- R1 open probes: no parallel session - HEAD 759b9dd3a was the r763 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 126/33/21/15/90 - WAVE 8 (+4 ev / +1 run / +4 nj, newest ~01:05:10 UTC, ~62 min after wave 7, longest gap yet) -> wave-round path with the tier-state letter-tag increment.')
L.append('- R2 templates: r764_qa.sh + r764_close.sh via the DUAL sed pattern (s/r=763/r=764/g + s/r763/r764/g) - zero mechanical remnants, bash -n green; the round-763 prose gaps (spelled-out Patrol round 763 + the literal Round ID r764 pointer) handled by this surgery pass; wave-8 census taken in the R1 batch.')
L.append('- R3 increment (run-kanban.tsx): the corpus-tier-state span gains the letter prefix (bucket key + q/g/m read from waveStrip.route[laneTiers.lastKey], rendered before the per-route ACTIVE/silent figures; omitted honestly when the newest bucket holds no middle-tier rows), title gains the q/g/m legend sentence. Two-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')
L.append('- R5 QA + close: the r764 golden QA ran GREEN first-try (board probe at the WAVE-8 census 33 runs / 126 ev / 90nj, chips 34; ld count 90, seven lanes, no eighth, qwen pair 2nd/3rd in the count sort - the same order the wave-7 QA showed, consistent with a second qwen wave; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (tier-state text edited - same view; r756-r764 precedent honored); tier-state probe RECORDED (the letter tag is IN the recorded text now); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.')
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
L.append('- QWEN HOLDS: two consecutive qwen waves (00:03 + 01:05) break the near-per-wave alternation - the route sequence now reads glm, glm, qwen, glm, glm, qwen, qwen; whether this is a lean toward the free routes or noise needs wave 9 (the strip letters + the tier-state letter tag make that read one glance). Cadence: w6->w7 ~42, w7->w8 ~62 min - the gap band is stretching upward (13 -> 42 -> 62); magnitude +9/+9/+4/+4; verdict/uncertain flat seven waves. Snapshot discipline twentieth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')
L.append('- LETTER-IN-TIER-STATE (scoping note): the tag reads the corpus-wide waveStrip.route for the newest bucket, matching the corpus semantics the tier-state line already had (it never was filter-aware); in lane-filter mode the strip letters drop but the tier-state tag stays - both are corpus truth by design. An m tag (both routes answered) or an ABSENT tag on a fresh bucket with both routes silent = the investigate-immediately signal (genuine partial ladder). No forward corrections owed this round.')
L.append('Round Handoff:')
L.append('Round ID: r765 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r764_qa.sh sed-adapted (DUAL pattern s/r=764/r=765/g + s/r764/r765/g); remember the round-764 prose gaps (spelled-out Patrol round 764 + the literal Round ID r765 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend view, else RECORDED; tier-state probe: RECORDED ONLY (carries the newest-bucket letter since r764); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the alternation is BROKEN (qwen held twice, 00:03 + 01:05) - a third straight qwen wave = a lean toward the free routes, a flip back to glm = alternation restored; the first m bucket (both routes, amber, 7 lanes) or a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NINTH wave, or an interval-pattern break (the band is stretching: 13 -> 42 -> 62 min - a gap far beyond ~62, or a sudden collapse back to ~13 after two long ones) = new signal. (5) Increment queue: no named candidate - candidates: (a) a per-bucket route history in the tier-state title (the letter sequence of the shown strip buckets, one glance beyond the newest) if the Owner wants the alternation story legible in one hover; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay alternation UPDATE (r764): qwen held twice back-to-back (00:03 + 01:05) - the platform report should describe the alternation AND its first pattern break, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the tier-state letter tag shipped into a live wave-8 read - bucket 01:00 letter q witnessed at ship time - + full golden QA, anchored in scripts/qa_r764.txt and scripts/qa_r764_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r764: tier-state letter tag ships + wave 8 returns, qwen holds. Census 126/33/21/15/90 vs the r763 baseline 122/32/86 - +4 ev / +1 run / +4 nj, newest ~01:05:10 UTC, ~62 min after wave 7 (longest gap yet, past the prior 58-max); verdict/uncertain flat seven waves. Live tier-state read: bucket 10-30 01:00 letter q, mid-qwen ACTIVE (2/2) / mid-glm silent (0/2) - wave 8 is QWEN-routed back-to-back with wave 7: the first same-route repeat of the alternation era (glm, glm, qwen, glm, glm, qwen, qwen). Increment (r763-handoff candidate a): the newest-bucket letter (q/g/m) surfaced in the tier-state line, corpus-wide semantics, title documents the legend + the absent-means-no-middle-rows edge; the ship-time read doubled as the acceptance witness. Snapshot discipline twentieth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r764_close.txt
SWEEP=$(git add -A && git commit -m "r764: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
