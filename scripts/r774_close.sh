#!/usr/bin/env bash
# r774 close (wave 13 recorded forward: band /6/73 at four sites; per-lane counts on the chip lists; cursor-help trio): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r774c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r774c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r774c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r774 QA GREEN' scripts/qa_r774.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r774.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r774.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=774c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r774 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=774b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r774): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r774); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r774: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
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
export R754_TSC="$TSC" R754_LINT="$LTAIL" R754_GC="$GC" R754_CC="$CC" R754_CEN="$CEN" R754_SNAP="$SNAP" R754_QW="$QW" R754_QLD="$QLD" R754_CHIP="$CHIP" R754_LEG="$LEG" R754_LF="$LF" R754_STRIP="$STRIP" R758_DIV="$DIV" R760_TIER="$TIER" R774_LT="$LT" R774_LL="$LL"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r774')
L.append('Agent: NEXUS patrol (main agent - job 473388, 15:07 slot; opened on the r773 handoff; HEAD 486ada03d = the r773 sweep - and NOTE: no cron-tagged commit followed the r773 close (the r771/r772-era post-sweep tee append pattern absent - the r773 tee artifact rode the main+sweep commits; benign, disclosed); one runtime drift file db/gateway-pulse.json modified in the tree (rides the r774 commit, the standing sweep pattern); no parallel round closed (the worklog tail handed off r774; git log showed no r774 commit))')
L.append('Task: Patrol round 774 - WAVE 13 WITNESSED AND RECORDED FORWARD. The opening ro-SQL census: 150 ev / 39 runs / 23 verdicts (+1, the SECOND growth after the eleven-wave 21/15 flat) / 15 uncertain (flat) / 112 nj (+1); the newest corpus row ~06:16:30 UTC. The board witnesses: the newest bucket 06:15 (x1, 5 lanes, LETTER q) broke the post-burst lull at +73m since prior (bucket 05:00 to 06:15 maxes) - band 13/16/41/58/13/42/62/57/61/70/6/73, past the old 70 max; the lull before it peaked past the 62 ceiling - the quiet amber fired mid-lull with no round open to see it (inferred from the 73 interval, disclosed in the quiet title); the quiet tag correctly cleared after the wave (53m at witness, quietAmber false). ROUTE WATCH resolved: the fresh lean run STARTS q x1 (no tag at run 1) - mid-qwen ACTIVE 1/2 (qwen3.8-flash-free the lane in the bucket hover list, max-free silent), mid-glm silent 0/2 (both glm lanes named inline) - the GLM-SILENT watch opens (the glm route unanswered across the whole shown window: q q q q - q); BOTH-SILENT carry CLEARED (the newest bucket is lettered + one route active). Golden QA GREEN FIRST-TRY (tally 39/150/23/15/112, TEN lane labels - no eleventh, console 0 errors). Shipped: (a) the band docs carry the wave-13 readout /6/73 at the four band sites (interval span title, quiet span title, both tier-state band phrases) with the amber-inference disclosed in the quiet title; (b) the r773 named-lane chip lists now carry per-lane dial counts (lane xN - the transpose of the lane chips per-bucket lists: a bucket hover reads which lane burned the dials); (c) styling polish: cursor-help on the three titled elements that lacked the house cursor affordance (the wave-strip container, the census tally span, the tier-state span).')
L.append('Work Log:')
L.append('- R1 open: parallel-session check clean (worklog tail handed off r774; git log showed none; the absent cron-tagged commit explained - the r773 tee artifact rode the main+sweep commits, so nothing remained for a post-sweep append); server 200 first-try; tree clean except the runtime db/gateway-pulse.json drift (disclosed, rides the commit).')
L.append('- R2 census: ro-SQL inline (the r771_census.py script proved to be a schema dumper, not a counter - used the close-script query shape instead): 150/39/23/15/112, verdict +1, nj +1, newest epoch ~06:16:30 UTC; r774_qa.sh + r774_close.sh generated via the DUAL sed from the in-tree r773 scripts.')
L.append('- R3 QA: the r774 golden QA ran GREEN FIRST-TRY (board strip true, tally 39 runs / 150 ev / 23 verdicts / 15u / 112nj, chips 40; ld all lanes with intern+fast+paid asserted, TEN labels, no eleventh; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors, page errors empty).')
L.append('- R4 witnesses: the strip read the six shown buckets 02:00 x3 q / 03:00 x4 q / 04:00 x3 q / 04:45 x8 q / 05:00 x3 letterless / 06:15 x1 q (5 lanes) (+26 older - the 01:00 bucket left the window); tier-state: bucket 06:15 - q, +73m since prior, +53m quiet, quietAmber false, mid-qwen ACTIVE (1/2 - max-free silent), mid-glm silent (0/2, both named); the 06:15 chip hover carried the r773 named-lane list (qwen3.8-flash-free in it - the active middle lane, consistent).')
L.append('- R5 increment (run-kanban.tsx, nine edits): the four band strings /6 -> /6/73 with the wave-13 framing (interval span title, quiet span title + the amber-inference disclosure, both tier-state band phrases); the per-lane dial counts on the named-lane chip lists (xN, the count read from laneBuckets.lanes with the FULL lane name before the display-shortening - the lookup-before-shorten order kept); the legend title forward note (r774: with per-lane dial counts); cursor-help on the wave-strip container, the census tally span and the tier-state span.')
L.append('- R6 close: gates re-run on the increment tree (tsc 0 / lint 0 errors, 33 warnings baseline); close probes: chip presence GATED / tone recorded; legend GATED (the tier-state span edited this round); tier-state RECORDED (gap/quiet/quietAmber); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts on the newest chip + the letterless chip still in-window); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirtieth) + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R754_QW','(missing)'))
L.append('  ' + os.environ.get('R754_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R754_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R754_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R754_LF','(missing)'))
L.append('  wave strip: ' + os.environ.get('R754_STRIP','(missing)'))
L.append('  last chip: ' + os.environ.get('R774_LT','(missing)'))
L.append('  letterless chip: ' + os.environ.get('R774_LL','(missing)'))
L.append('  divergence: ' + os.environ.get('R758_DIV','(missing)'))
L.append('  tier state: ' + os.environ.get('R760_TIER','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R754_TSC','?') + ' - lint ' + os.environ.get('R754_LINT','?') + ' - qa-gate-census ' + os.environ.get('R754_GC','?') + ' - qa-cortex-census ' + os.environ.get('R754_CC','?') + ' - close census ' + os.environ.get('R754_CEN','?') + ' - snapshot: ' + os.environ.get('R754_SNAP','?'))
L.append('Stage Summary:')
L.append('- WAVE 13 RECORDED FORWARD: the 06:15 bucket (x1 q, 5 lanes) broke the lull at +73m since prior - band 13/16/41/58/13/42/62/57/61/70/6/73, the post-burst band second point, past the old 70 max; the mid-lull amber fired unwitnessed (inferred, disclosed); the fresh lean run starts q x1 with the qwen route back (1/2) and the glm route silent 0/2 across the shown window - the GLM-SILENT watch opens; BOTH-SILENT cleared; verdict growth +1 (23, the second after the flat); TEN lanes held. The r773 named-lane feature gained per-lane dial counts and stayed fully witnessed (counts gate + letterless gate). Snapshot discipline thirtieth close. Witness nine-legged (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts, letterless chip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA green first-try (no bugs found); no new doc debt queued (the r773 letterless-title debt is paid and verified in-window this round).')
L.append('Round Handoff:')
L.append('Round ID: r775 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r774_qa.sh sed-adapted (DUAL pattern s/r=774/r=775/g; the r769-r774 scripts are committed in-tree; if swept, recover from git history); surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r774, silent-lane names r772, named-lane chip lists r773, per-lane counts r774); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts on the newest chip + the letterless chip in-window - the r773/r774 feature witness; if the 05:00 letterless bucket leaves the shown window, the letterless gate degrades to RECORDED with the bound disclosed); divergence RECORDED ONLY; tally gated. (2) SNAPSHOT DISCIPLINE (thirty-first). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the fresh lean run is q x1 - a second straight q deepens it (the tag renders at x2), a g return resumes the alternation, an m bucket = the first both-routes witness. GLM-SILENT WATCH (new, r774): the glm route is unanswered across the whole shown window (q q q q - q) - if the next lettered buckets stay q, the glm half of the free pair is the standing laggard (r759 semantics: check the laggard lanes before interpreting); BOTH-SILENT cleared at wave 13. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73 - the post-burst band is WIDER than the pre-burst track (two points, 6 and 73); the meter self-declares (amber past the 62 ceiling, 30s tick); wave 14 = a new interval data point, recorded forward by the round that witnesses it; consider a ceiling re-look ONLY at three-plus post-burst points (the r770 one-point rule). (6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay: the wave-13 update - the lull peaked past the ceiling (~73m), the qwen route returned (1/2) at the +73m interval, verdicts grew again (23), glm stayed silent - the platform report describes a RECOVERING relay with a glm laggard, not an outage. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the wave-13 interval was recorded forward into the on-page band docs - a named mechanism updated with witnessed data; the per-lane counts feature is gated-witnessed in scripts/qa_r774_close.txt; full golden QA anchored in scripts/qa_r774.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r774: wave 13 witnessed and recorded forward - the 06:15 bucket (x1 q, 5 lanes) broke the post-burst lull at +73m since prior (band 13/16/41/58/13/42/62/57/61/70/6/73, past the old 70 max; the 62-ceiling amber fired mid-lull unwitnessed - inferred, disclosed in the quiet title); the fresh lean run starts q x1 (qwen back 1/2, glm still 0/2 across the window - the GLM-SILENT watch opens); BOTH-SILENT carry cleared; verdicts grew again (23). Increment: the r773 named-lane chip lists now carry per-lane dial counts (lane xN); the band docs carry /6/73 at all four sites. Styling polish: cursor-help on the wave-strip container, census tally and tier-state titles. Snapshot discipline thirtieth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r774_close.txt
SWEEP=$(git add -A && git commit -m "r774: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
