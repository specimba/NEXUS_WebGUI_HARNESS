#!/usr/bin/env bash
# r771 close (band-doc catch-up + amber-flip polish; re-labeled round): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r771c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r771c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r771c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r771 QA GREEN' scripts/qa_r771.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r771.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r771.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=771c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r771 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=771b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r771): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r771); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# divergence probe: RECORDED ONLY - diamonds on the middle-tier routes are the normal handoff/lean signal (amber-tone doctrine); the SIGNAL is a diamond on intern/fast-judge/jev = a genuine partial ladder.
DIV=$(timeout 30 agent-browser eval "(() => { const d=[...document.querySelectorAll('[data-testid=\"corpus-lane-legend\"] [data-div=\"1\"]')]; return JSON.stringify({divBadges:d.length}); })()" 2>&1 | tail -1)
echo "divergence: $DIV"
# lane-filter probe (the legend view WAS touched this round - the gate above runs; the fixed tally assertion stays GATED).
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
L.append('Task ID: r771')
L.append('Agent: NEXUS patrol (main agent - job 473388, 12:37 slot; opened on the r770 handoff and RE-LABELED r770 -> r771 - the 12:07 slot already closed r770 (ship 953264f61, addendum e88f24967, wave 11 landed mid-round = the pre-declared reset case); own-session lineage per the r768->r769 precedent)')
L.append('Task: Patrol round 771 - BAND DOCS CATCH UP TO WAVE 11 + the quiet tag amber flip gets a transition polish: the opening ro-SQL census read 136 ev / 36 runs / 21 verdicts / 15 uncertain / 100 nj - FLAT vs the r770 close (newest ~04:13:18 UTC = wave 11, the +70m interval); no wave 12, quiet ~28m at open - the amber cleared, the meter honest. Lane census corrected FORWARD: the ld witness lists NINE lane labels in BOTH qa_r770 and qa_r771 (intern-systemone; fast-judge Inception mercury-3; fast-judge Google gemini-3.8-flash; fast-judge plain; jev paid rung; fast-judge AIHubMix qwen3.8-flash-free; fast-judge AIHubMix qwen3.8-max-free; fast-judge Z.ai glm-5.3; fast-judge Intern TokenPlan glm-5.3) - the seven-lane handoff phrasing was stale prose, NOT a new-lane signal; no tenth-lane event. Shipped the cadence-band doc catch-up: the interval span title, the quiet span title and BOTH band mentions inside the tier-state title now record 13/16/41/58/13/42/62/57/61/70 - the 70 is the wave-11 interval (03:03:43 -> 04:13:18 = 69m35s, rounds to 70; the r770 addendum prose wrote 71, the witnessed readout said +70m, the titles follow the witnessed readout) - plus a transition-colors polish on the quiet tag so the amber flip at the ceiling animates instead of snapping. QUIET_CEILING stays 62: one new data point is not a retune, and wave 11 landed exactly where the old plateau ceiling predicted the burst end - the meter worked as designed.')
L.append('Work Log:')
L.append('- R1 open: parallel-session check found r770 ALREADY CLOSED by the 12:07 slot (worklog Task ID r770, addendum commit e88f24967 on top of ship 953264f61) -> re-labeled to r771 per lineage precedent; server 200 first-try; tree clean.')
L.append('- R2 census + templates: ro-SQL via scripts/r771_census.py (sqlite3 CLI absent in this sandbox - python sqlite3 module, ro-mode URI) read 136/36/21/15/100 FLAT, newest gate-no-judge ~04:13:18 UTC; the DB run tables (AutomationRun / RunReport / EvalEvent) carry NO route/model column - route letters stay an on-page strip witness, not a SQL read; r771_qa.sh + r771_close.sh + r771_close_build.py via the DUAL sed from the in-tree r770 scripts (no git-history recovery needed).')
L.append('- R3 QA: the r771 golden QA ran GREEN FIRST-TRY (board strip true, tally 36 runs / 136 ev / 21 verdicts / 15u / 100nj, chips 37; ld all lanes with intern+fast+paid asserted; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors, page errors empty). Lane-list diff vs qa_r770: IDENTICAL nine labels - the carried lane-watch item resolves as stale prose, corrected forward.')
L.append('- R4 increment (run-kanban.tsx, six edits): band strings 13/16/41/58/13/42/62/57/61 -> 13/16/41/58/13/42/62/57/61/70 in the interval span title, the quiet span title, and BOTH the interval phrase and the quiet phrase of the tier-state title; the pre-burst comment block at the QUIET_CEILING constant reworded (plateau ceiling; wave 11 landed at +70m, first data point of the post-burst band); transition-colors added to BOTH branches of the quiet tag class ternary (the amber flip animates). Carried items re-read: divergence badges 2 -> 6 = the r758 semantics witnessing the wave-11 bucket shift (the 04:00 bucket entering the trailing 3-bucket windows) - amber doctrine, investigated, no fault; the mid-qwen ACTIVE 1/2 stays a watch item for the next wave.')
L.append('- R5 gates + close: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree; close probes: chip presence GATED / tone recorded; legend GATED (the tier-state view edited again this round; r756-r771 precedent); tier-state probe RECORDED (quietSpan + quietAmber reads carry over from r770); wave-strip presence GATED / text RECORDED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (twenty-seventh) + worklog + commit + dual push.')
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
L.append('- BAND DOCS HONEST: the cadence-watch titles now carry the full recorded band including the wave-11 +70m interval - the first data point of the post-burst band - and the quiet tag amber flip animates; the meter cleared its amber on the wave-11 reset and the close probe records the post-reset state as-is (quietAmber false expected while quiet stays under the 62 ceiling; either state is the watch working). Nine-lane census corrected forward; the divergence 2 -> 6 move investigated under the amber doctrine (bucket-shift witness, no fault). Snapshot discipline twenty-seventh close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA found no bugs this round (green first-try) - the increment continued the r759-r770 instrument line with the band-doc catch-up + flip polish.')
L.append('Round Handoff:')
L.append('Round ID: r772 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r771_qa.sh sed-adapted (DUAL pattern s/r=771/r=772/g + s/r771/r772/g; the r769-r771 scripts are committed in-tree; if swept, recover from git history); surgery lessons stand (apostrophe-free AND single-quote-free new texts; full-line replacements preserve the L.append( wrapper; block replacement with a compile() pre-flight is the kept pattern). Probes: chip presence gated / tone recorded; legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone + quietAmber r770, band docs /70 since r771); wave-strip presence GATED / text RECORDED; divergence RECORDED ONLY; tally assertion gated. (2) SNAPSHOT DISCIPLINE stands (twenty-eighth close next). (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; NINE lane labels (corrected r771, was seven in stale prose); a TENTH label = new signal, labeled unrouted on sight; ROUTE WATCH: the 04:00 bucket was the FIFTH straight q (lean deepened x5 at r770) - a sixth q deepens further, a g return resets (alternation resumed), an m bucket or m run (both routes, amber, nine lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; a VERDICT/UNCERTAIN growth wave = new signal. (5) CADENCE WATCH: the post-burst band is OPEN with one data point (70); the quiet meter self-declares (amber past the 62 ceiling, 30s tick); wave 12 = a new interval data point - the band grows in the titles only when a round records it forward; a quiet stretch firing amber across two rounds with no wave = the post-burst lull signal - then watch the relay lanes directly per the r770 doctrine. CARRIED: mid-qwen ACTIVE 1/2 (one qwen lane silent at the 04:00 bucket) - re-read at the next wave; divergence badge count re-read at the next wave. (6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay: lean deepened to q x5 at the wave-11 bucket and the burst ended per the r770 witness - the platform report should describe the deepened lean and the ended burst, not an outage. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the band docs caught up to the witnessed wave-11 interval and the amber flip got its transition polish, anchored in scripts/qa_r771.txt and scripts/qa_r771_close.txt + full golden QA).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r771: band docs catch up to wave 11 + the quiet-tag amber flip gets its transition polish. Re-labeled round: the 12:07 slot already closed r770 (ship 953264f61 + addendum e88f24967, wave 11 landed mid-round = the pre-declared reset case). Census flat at open 136/36/21/15/100 (newest ~04:13:18 UTC, the +70m wave-11 interval; no wave 12, quiet ~28m, amber cleared). Lane census corrected FORWARD: nine lane labels in both qa_r770 and qa_r771 - the seven-lane handoff phrasing was stale prose, not a new-lane signal. Increment: the interval title, quiet title and both tier-state band mentions now record 13/16/41/58/13/42/62/57/61/70 (the 70 = the witnessed wave-11 readout; the addendum prose 71 noted as the same data point) + transition-colors on both branches of the quiet tag ternary (amber flip animates). QUIET_CEILING held at 62 - one data point is not a retune. Snapshot discipline twenty-seventh close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r771_close.txt
SWEEP=$(git add -A && git commit -m "r771: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
