#!/usr/bin/env bash
# r770 close (burst-end witness + live quiet meter): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r770c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r770c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r770c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r770 QA GREEN' scripts/qa_r770.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r770.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r770.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=770c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r770 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=770b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r770): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r770); the route-state line is a witness, not a gate (amber-tone doctrine).
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
L.append('Task ID: r770')
L.append('Agent: NEXUS patrol (main agent - job 473388, 12:07 slot; opened on the r769 handoff - HEAD 8811b25cb = the r769 terminal sweep, own-session lineage, no parallel round closed)')
L.append('Task: Patrol round 770 - BURST-END SIGNAL WITNESSED, QUIET METER GOES LIVE: the opening ro-SQL census read 133 ev / 35 runs / 97 nj - FLAT vs the r769 close (newest ~03:03:43 UTC = wave 10); no wave 11, quiet 64m at open - PAST the ~62 ceiling of the recorded band (13-42-62-57-61), the burst-end signal condition FIRST MET at open; verdict/uncertain flat 21/15 for the eleventh straight wave; lean CEMENTED q x4 held. Shipped the live quiet meter: the quiet value re-ticks every 30s while the board is open (a tick state driven by a 30s setInterval with cleanup in the mount effect, added to the laneQuiet deps) so the staleness readout stays honest on a quiet board - the exact scenario it monitors - and past the QUIET_CEILING constant (62, the recorded band max) the quiet tag takes the amber signal tone (text-amber-600 dark:text-amber-400, the house amber) - the burst-ended witness, same convention as the divergence diamonds, a signal not a fault; the span title and the tier-state title document the tick and the tone. The close tier-state probe gains a quietAmber read (the quiet span class) so the burst-end witness is a probe witness. Honest scoping: no new data source; the ceiling constant is the recorded band max, not a new threshold.')
L.append('Work Log:')
L.append('- R1 open probes: no parallel session - HEAD 8811b25cb = the r769 terminal sweep (own-session lineage); tree clean; server 200; ro-SQL census 133/35/21/15/97 FLAT, quiet 64m at open - past the ~62 ceiling = the burst-end signal condition met -> burst-end-witness path with the live-quiet-meter increment.')
L.append('- R2 templates: r770_qa.sh + r770_close.sh via the DUAL sed pattern (s/r=769/r=770/g + s/r769/r770/g) from the IN-TREE r769 scripts (no git-history recovery needed this round) - zero mechanical remnants, bash -n green; the close heredoc rebuilt by BLOCK replacement (the whole python3 heredoc swapped, wrappers by construction) with a compile() pre-flight check - the definitive wrapper/quote gate after the r767 and r769 heredoc deaths.')
L.append('- R3 increment (run-kanban.tsx): quietTick state + a 30s setInterval in the mount effect (clearInterval cleanup) added to the laneQuiet deps, so the quiet value re-ticks every 30s while the board is open; QUIET_CEILING = 62 (the recorded band max) and the quiet span takes the amber signal tone (text-amber-600 dark:text-amber-400) when laneQuiet exceeds it, defaulting back to the strip-letter treatment below the ceiling; the span title and the tier-state title document the tick and the tone. Four-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree.')
L.append('- R5 QA + close: the r770 golden QA ran GREEN (board probe at the wave-10 steady census, chips per the artifact; ld seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (the tier-state line inside the legend was edited - same view; r756-r770 precedent honored); tier-state probe RECORDED with the NEW quietAmber read (the quiet span class - amber expected while the quiet stretch holds, a wave 11 landing would clear it; either outcome is the watch working); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; lane-filter tally assertion gated-run; census + snapshot + worklog + commit + dual push.')
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
L.append('- BURST-END ON-PAGE: the burst-end signal condition was met at open (quiet 64m, past the ~62 ceiling, census flat) and the instrument now states it live - the quiet meter re-ticks every 30s and takes the amber signal tone past the ceiling, so the end of the wave burst is a recorded probe witness (quietAmber) without cross-reading the strip or the census. A new wave resets the meter and clears the amber automatically - the watch works both ways. Snapshot discipline twenty-sixth close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the r769 handoff named no increment candidate (queue: builtin box Owner-asked / TASKS.md re-triage / QA bugs first); this round continued the r759-r769 instrument line with the live quiet meter - the burst-end watch became a self-declaring on-page signal. The builtin box extraction stays parked for an explicitly requested refactor round.')
L.append('Round Handoff:')
L.append('Round ID: r771 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r770_qa.sh sed-adapted (DUAL pattern s/r=770/r=771/g + s/r770/r771/g; the r769/r770 scripts are committed in-tree; if swept, recover from git history); remember the surgery lessons: new-texts apostrophe-free AND single-quote-free AND full-line replacements must preserve the L.append( wrapper (the r767 quote defect and the r769 wrapper defect - two heredoc deaths); the r770 close used BLOCK replacement with a compile() pre-flight - keep that pattern; close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe: RECORDED ONLY (carries the lean tag since r767, the interval readout since r768, the quiet readout since r769, the amber burst-end tone + the quietAmber read since r770); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the lean is CEMENTED (q x4, 00:03 through 03:03) - a fifth q deepens it, a g return resets the counter (alternation resumed), an m bucket or m run (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight) or a VERDICT/UNCERTAIN growth wave = new signal. (5) BURST-END WATCH (the live story): the burst-end signal condition was met at the r770 open (quiet 64m past the ~62 ceiling, census flat); the close probe records the quietAmber state as-is - if amber held, the burst ended; if wave 11 landed mid-round, the meter reset and the new interval is the first data point of the next band; either way the meter self-declares from here - a LONG amber stretch across multiple rounds with no new wave and no lane churn means stop treating the wave cadence as the primary clock and watch the relay lanes directly; an interval-pattern break inside a new band = new signal. (6) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay: LEAN CEMENTED (r768, q x4) and the wave burst ending per the r770 burst-end witness - the platform report should describe the lean and the burst end, not an outage. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the live quiet meter shipped into a met burst-end signal - quiet 64m at open past the ~62 ceiling, the amber tone and the quietAmber probe read witnessing it - + full golden QA, anchored in scripts/qa_r770.txt and scripts/qa_r770_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r770: burst-end witnessed + the quiet meter goes live. Census flat 133/35/21/15/97 at open with quiet 64m - PAST the ~62 ceiling of the recorded band (13-42-62-57-61): the burst-end signal condition first met on-page; verdict/uncertain flat eleventh wave; lean CEMENTED q x4 held. Increment: the quiet meter goes live - a 30s tick keeps the staleness readout honest while the board is open, and past the QUIET_CEILING (62, the recorded band max) the quiet tag takes the house amber signal tone (text-amber-600 dark:text-amber-400, divergence-diamond convention, a witness not a fault); the tier-state probe gains a quietAmber class read - the burst-end witness as a probe witness. Close heredoc rebuilt by block replacement with a compile() pre-flight (the r767/r769 wrapper lessons). Snapshot discipline twenty-sixth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r770_close.txt
SWEEP=$(git add -A && git commit -m "r770: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
