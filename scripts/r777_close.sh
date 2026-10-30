#!/usr/bin/env bash
# r777 close (census flat second straight round; the r777 keyboard bridge on the strip chips; the amber fired live past the 62 ceiling): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r777c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r777c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r777c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r777 QA GREEN' scripts/qa_r777.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r777.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r777.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=777c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r777 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=777b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r777): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r777); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r777: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r777/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "$BR" | grep -Eq 'broken\\?":true' || { echo 'GUARD broken note'; exit 1; }
echo "$BR" | grep -Eq 'was q ×2' || { echo 'GUARD broken run'; exit 1; }
KB=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1]:null; return JSON.stringify({chips:c.length,kb:!!t&&t.getAttribute('tabindex')==='0',ring:/focus-visible:ring-1/.test(t?t.getAttribute('class')||'':'')}); })()" 2>&1 | tail -1)
echo "$KB" | grep -Eq 'kb\\?":true' || { echo 'GUARD keyboard bridge'; exit 1; }
LL=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/no route letter/.test(e.getAttribute('title')||'')):[]; const t=c.length?c[0].getAttribute('title'):''; return JSON.stringify({letterless:c.length>0,hasWhy:/no route letter: no middle-tier lane dialed/.test(t),hasLanes:/lanes named here/.test(t)}); })()" 2>&1 | tail -1)
echo "letterless chip: $LL"
echo "$LL" | grep -Eq 'letterless\\?":true' || { echo 'GUARD letterless chip'; exit 1; }
echo "$LL" | grep -Eq 'hasWhy\\?":true' || { echo 'GUARD letterless why'; exit 1; }
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
export R754_TSC="$TSC" R754_LINT="$LTAIL" R754_GC="$GC" R754_CC="$CC" R754_CEN="$CEN" R754_SNAP="$SNAP" R754_QW="$QW" R754_QLD="$QLD" R754_CHIP="$CHIP" R754_LEG="$LEG" R754_LF="$LF" R754_STRIP="$STRIP" R758_DIV="$DIV" R760_TIER="$TIER" R774_LT="$LT" R774_LL="$LL" R776_BR="$BR" R777_KB="$KB"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r777')
L.append('Agent: NEXUS patrol (main agent - job 473388, 17:07 slot; opened on the r776 handoff; HEAD 4c9d8937e = the r776 sweep tee riding after the r776 main increment 90f422abf (the r776 round closed in its own 16:37 slot); tree CLEAN at open; no parallel round closed (the worklog tail handed off r777; git log showed no r777 commit))')
L.append('Task: Patrol round 777 - CENSUS FLAT SECOND STRAIGHT ROUND; THE KEYBOARD BRIDGE SHIPPED; THE AMBER FIRED LIVE. The opening ro-SQL census: 155 ev / 41 runs / 23 verdicts / 15 uncertain / 117 nj - FULLY FLAT vs the r776 close (no growth, no wave 16; newest row still epoch 1793347835110 = 08:10:35 UTC; the band stays 13/16/41/58/13/42/62/57/61/70/6/73/55/59). The quiet readout crossed the 62 ceiling during the round - the amber tone fired on-page (the second true firing after the r774 mid-lull; the r775 re-look already held the ceiling, so this is a live lull witness on a settled regime, not a fault; the close probes carry the rendered quiet value). Golden QA GREEN FIRST-TRY (tally 41/155/23/15/117, TEN lane labels - no eleventh, console 0 errors). Shipped: the r777 keyboard bridge - the strip bucket chips gained tabIndex 0 and a focus-visible ring (rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:text-foreground/90), so the hover-only bucket data (lanes named, counts, the max-to-max gap, the letterless why-sentence) is reachable by keyboard focus (Chromium and Firefox surface title tooltips on focus); the strip container title documents the bridge. Styling polish: the focus ring plus the focused-chip text emphasis.')
L.append('Work Log:')
L.append('- R1 open: parallel-session check clean (worklog tail = the r776 section with the r777 handoff; HEAD 4c9d8937e = the r776 sweep tee riding after the r776 main increment 90f422abf - the r776 round closed in its own 16:37 slot; tree CLEAN at open; server 200 first-try; both remotes verified at 4c9d8937e).')
L.append('- R2 census: ro-SQL inline: 155/41/23/15/117 - FULLY FLAT vs the r776 close (newest row still epoch 1793347835110 = 08:10:35 UTC, ~+63m quiet at reading - already past the 62 ceiling); no wave 16 - the band stays /55/59; r777_qa.sh + r777_close.sh generated via the DUAL sed + bare-label sed from the in-tree r776 scripts.')
L.append('- R3 QA: the r777 golden QA ran GREEN FIRST-TRY (board strip true, tally 41 runs / 155 ev / 23 verdicts / 15u / 117nj, chips 42; ld all lanes with intern+fast+paid asserted, TEN labels, no eleventh; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).')
L.append('- R4 witnesses: the QA legs carried the witnesses (the census was flat - no separate witness pass needed): the tier-state note lean run broken (was q ×2) stayed live (the wave-bound r776 probe holds on the flat census); the quiet readout climbed past the 62 ceiling while the round ran (amber territory - the rendered value lands in the close probes); the r773-r775 chip affordances held (lanes + counts + gap 59 + the why-sentence on the letterless hover).')
L.append('- R5 increment (run-kanban.tsx, two edits): the r777 keyboard bridge - tabIndex 0 + a focus-visible ring (rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:text-foreground/90) on the strip bucket chips, the hover-only bucket data reachable by keyboard focus (Chromium and Firefox surface title tooltips on focus); the strip container title documents the bridge. New texts kept apostrophe-free AND single-quote-free (surgery lessons).')
L.append('- R6 close: gates re-run on the increment tree (tsc 0 / lint 0 errors, 33 warnings baseline); close probes: chip presence GATED / tone recorded; legend GATED (the strip edited this round); tier-state RECORDED (gap/quiet/quietAmber); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip + the letterless chip in-window); the r776 broken-note probe GATED wave-bound (still true on the flat census); the NEW r777 keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-third) + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R754_QW','(missing)'))
L.append('  ' + os.environ.get('R754_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R754_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R754_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R754_LF','(missing)'))
L.append('  wave strip: ' + os.environ.get('R754_STRIP','(missing)'))
L.append('  last chip: ' + os.environ.get('R774_LT','(missing)'))
L.append('  letterless chip: ' + os.environ.get('R774_LL','(missing)'))
L.append('  broken note: ' + os.environ.get('R776_BR','(missing)'))
L.append('  divergence: ' + os.environ.get('R758_DIV','(missing)'))
L.append('  tier state: ' + os.environ.get('R760_TIER','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R754_TSC','?') + ' - lint ' + os.environ.get('R754_LINT','?') + ' - qa-gate-census ' + os.environ.get('R754_GC','?') + ' - qa-cortex-census ' + os.environ.get('R754_CC','?') + ' - close census ' + os.environ.get('R754_CEN','?') + ' - snapshot: ' + os.environ.get('R754_SNAP','?'))
L.append('Stage Summary:')
L.append('- CENSUS FLAT SECOND STRAIGHT ROUND; AMBER LIVE: zero growth through the round (155/41/23/15/117, newest row still 08:10:35 UTC) - the quiet crossed the 62 ceiling during the round and the amber tone fired on-page (the second true firing; the r774 mid-lull was the first; the probes carry the rendered value); the band stays 13/16/41/58/13/42/62/57/61/70/6/73/55/59; the r776 break note stayed live (the wave-bound probe true on the flat census); GLM-SILENT unchanged (no glm dial in any shown bucket). Snapshot discipline thirty-third close. Witness nine-legged + the r777 keyboard-bridge probe (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA green first-try (no bugs found); no new doc debt queued (the r777 bridge is documented in the strip container title).')
L.append('Round Handoff:')
L.append('Round ID: r778 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r777_qa.sh sed-adapted (DUAL pattern s/r=777/r=778/g + bare-label s/r777/r778/g; the r769-r777 scripts are committed in-tree; if swept, recover from git history); surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r775, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775, break note r776, keyboard bridge r777); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip + the letterless chip in-window while the 08:00 bucket stays newest); the r776 broken-note probe GATED WAVE-BOUND (newest bucket letterless, run-below q×2 - when the next lettered bucket lands the note unrenders and the gate degrades to RECORDED with the bound disclosed); the r777 keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; tally gated. (2) SNAPSHOT DISCIPLINE (thirty-fourth). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the lean run restarts at the next lettered bucket (x1 no tag, x2 tag; a g return resumes the alternation; an m bucket = the first both-routes witness). GLM-SILENT WATCH: no glm dial in any shown bucket - if the next lettered bucket is again q with no glm, the standing-laggard reading firms up (r759 semantics: check the laggard lanes before interpreting); BOTH-SILENT lettered-bucket test still cleared. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59 - the quiet crossed the 62 ceiling LIVE at r777 (the amber fired, the second true firing after the r774 mid-lull); wave 16 = the next interval point, recorded forward by the round that witnesses it (QUOTE THE RENDERED VALUE - the r775 correction convention); the witnessing round updates the band docs at the four sites + the wave framing. (6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay update for the report: zero growth two straight rounds (r776 + r777), verdicts flat 23, glm silent across the window, the quiet now PAST the 62 ceiling with the amber live - the relay reads DEEP-ADRIFT; the platform report should carry the arc (r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull). (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the r777 keyboard bridge is a named mechanism gated-witnessed in scripts/qa_r777_close.txt - a real accessibility gap closed; the amber firing is recorded as a live cadence datum; full golden QA anchored in scripts/qa_r777.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r777: census flat second straight round - the band holds /55/59 and the quiet crossed the 62 ceiling live (the amber fired, the second true firing after the r774 mid-lull). Increment: the r777 keyboard bridge - the strip bucket chips gained tabIndex 0 + a focus-visible ring, the hover-only bucket data (lanes, counts, max-to-max gap, the letterless why-sentence) reachable by keyboard focus (Chromium/Firefox surface title tooltips on focus); the strip container title documents the bridge. Styling polish: the focus ring + focused-chip text emphasis. Snapshot discipline thirty-third close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r777_close.txt
SWEEP=$(git add -A && git commit -m "r777: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
