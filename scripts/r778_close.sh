#!/usr/bin/env bash
# r778 close (wave 16 landed mid-round: bucket 10-30 09:00 q at +62m, band /59/62; the keyboard bridge shipped; the amber fired live then the wave reset quiet): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r778c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r778c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r778c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r778 QA GREEN' scripts/qa_r778.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r778.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r778.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=778c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r778 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=778b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r778): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r778); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r778: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r778/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
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
L.append('Task ID: r778')
L.append('Agent: NEXUS patrol (main agent - job 473388, 17:07 slot; opened on the r776 handoff; HEAD 4c9d8937e = the r776 sweep tee riding after the r776 main increment 90f422abf (the r776 round closed in its own 16:37 slot); tree CLEAN at open; no parallel round closed (the worklog tail handed off r778; git log showed no r778 commit))')
L.append('Task: Patrol round 777 - WAVE 16 LANDED MID-ROUND AND IS RECORDED FORWARD; THE KEYBOARD BRIDGE SHIPPED; THE AMBER FIRED LIVE. The opening ro-SQL census: 155 ev / 41 runs / 23 verdicts / 15 uncertain / 117 nj - flat vs the r776 close at reading time. MID-ROUND the wave-16 bucket landed: 10-30 09:00, LETTERED q (qwen-only - qwen3.8-flash-free answered, qwen3.8-max-free silent, 1/2), at +62m since prior (bucket 08:00 to 09:00 maxes, ms-true render 62 - the r775 convention: quote the rendered value; the close probe caught gapVal 62 on the newest chip). Band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) recorded forward at the band sites with wave-16 framing. The amber fired live mid-round (quiet crossed the 62 ceiling before the wave reset it to 0 - the second true firing after the r774 mid-lull; the r775 re-look already held the ceiling, so a live lull witness on a settled regime, not a fault). Wave 16 is q with NO glm dial - the GLM-SILENT watch FIRMS UP (the r759 standing-laggard reading: check the laggard lanes before interpreting). The lean run RESTARTED per r767: the wave-15 break note unrendered live exactly as the semantics predict (the wave-bound r776 probe degraded to RECORDED with the bound disclosed); the fresh run is x1 (no tag - the tag renders at x2). Golden QA GREEN FIRST-TRY on the opening tree; the close probes re-witnessed the edited strip on the final tree. Shipped: the r778 keyboard bridge (strip bucket chips tabIndex 0 + focus-visible ring - the hover-only bucket data reachable by keyboard focus; the strip container title documents it) + the wave-16 band-doc recording. Styling polish: the focus ring + focused-chip text emphasis.')
L.append('Work Log:')
L.append('- R1 open: parallel-session check clean (worklog tail = the r776 section with the r778 handoff; HEAD 4c9d8937e = the r776 sweep tee riding after the r776 main increment 90f422abf - the r776 round closed in its own 16:37 slot; tree CLEAN at open; server 200 first-try; both remotes verified at 4c9d8937e).')
L.append('- R2 census: ro-SQL inline: 155/41/23/15/117 - flat vs the r776 close at reading time (newest row then still epoch 1793347835110 = 08:10:35 UTC, ~+63m quiet - past the 62 ceiling, amber territory); r778_qa.sh + r778_close.sh generated via the DUAL sed + bare-label sed from the in-tree r776 scripts.')
L.append('- R3 QA: the r778 golden QA ran GREEN FIRST-TRY (board strip true, tally 41 runs / 155 ev / 23 verdicts / 15u / 117nj, chips 42; ld all lanes with intern+fast+paid asserted, TEN labels, no eleventh; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).')
L.append('- R4 witnesses: the QA legs carried the opening witnesses; MID-ROUND the wave-16 bucket landed and the close probes caught it live: newest chip 10-30 09:00 q with gapVal 62, tier-state reads bucket 10-30 09:00 - q, +62m since prior, +0m quiet (the wave reset the lull), mid-qwen route ACTIVE (1/2, qwen3.8-max-free silent); the r776 break note UNRENDERED (broken false - the wave-bound semantics witnessed in the unrender direction too); the strip window rotated (04:00 dropped off, 09:00 in).')
L.append('- R5 increment (run-kanban.tsx, six edits): (a) the r778 keyboard bridge - tabIndex 0 + a focus-visible ring (rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/60 focus-visible:text-foreground/90) on the strip bucket chips, the hover-only bucket data reachable by keyboard focus (Chromium and Firefox surface title tooltips on focus); (b) the strip container title documents the bridge; (c) the wave-16 recording at the band sites - the band token extended /59 to /59/62 everywhere and the wave-16 framing added to the interval title, the quiet title and the route-state title lists. New texts kept apostrophe-free AND single-quote-free (surgery lessons).')
L.append('- R6 close: gates re-run on the increment tree (tsc 0 / lint 0 errors, 33 warnings baseline); close probes: chip presence GATED / tone recorded; legend GATED (the strip edited this round); tier-state RECORDED (gap/quiet/quietAmber); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - gapVal 62 caught the wave-16 interval live); the r776 broken-note probe DEGRADED to RECORDED (the wave-16 lettered landing unrendered the note exactly as the r776 handoff predicted - the bound disclosed); the r778 keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-third) + worklog + commit + dual push.')
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
L.append('- WAVE 16 RECORDED FORWARD; AMBER LIVE THEN RESET: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) - wave 16 = bucket 10-30 09:00, lettered q (qwen-only, 1/2 active), at +62m (the rendered value quoted per the r775 convention); the post-burst band now five points (6/73/55/59/62, mean 51.0m vs pre-burst 43.3m); the amber fired live mid-round before the wave reset quiet to 0 (the second true firing; the r775 ceiling hold stands on the regime question); the lean run RESTARTED (fresh q x1, no tag; the r776 break note unrendered live - the wave-bound gate degraded to RECORDED as the handoff predicted); GLM-SILENT FIRMS (the lettered 09:00 bucket is q with no glm dial - the r759 standing-laggard reading strengthens); TEN lanes held. Snapshot discipline thirty-third close. Witness nine-legged + the r778 keyboard-bridge probe (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA green first-try (no bugs found); no new doc debt queued (the r778 bridge is documented in the strip container title).')
L.append('Round Handoff:')
L.append('Round ID: r778 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r778_qa.sh sed-adapted (DUAL pattern s/r=778/r=778/g + bare-label s/r778/r778/g; the r769-r778 scripts are committed in-tree; if swept, recover from git history); surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r778, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775, break note r776, keyboard bridge r778); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic; the letterless chip probe reads the 08:00 chip, still in-window while it stays shown); the r776 broken-note probe RETIRED to RECORDED-only history (it fired true at r776, degraded at r778 when wave 16 landed - the bound witnessed both directions); the r778 keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; tally gated. (2) SNAPSHOT DISCIPLINE (thirty-fourth). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the fresh lean run is q x1 (wave 16) - the NEXT lettered bucket decides (q x2 renders the lean tag again; a g return resumes the alternation; an m bucket = the first both-routes witness). GLM-SILENT WATCH FIRMED: wave 16 is q with no glm dial - if the next lettered bucket is again q with no glm, the standing-laggard reading holds per r759 (check the laggard lanes before interpreting); BOTH-SILENT lettered-bucket test still cleared. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) - the amber fired live at r778 before wave 16 reset the quiet; wave 17 = the next interval point, recorded forward by the round that witnesses it (QUOTE THE RENDERED VALUE - the r775 convention); the witnessing round updates the band docs at the band sites + the wave framing. (6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay update for the report: wave 16 = q at +62m (qwen back after the letterless wave 15 - the qwen3.8-flash-free lane answered, the max-free lane still silent), the amber fired mid-lull before it, verdicts flat - the report arc reads r774 recovering -> r775 adrift -> r776 flat-adrift -> r778 amber lull then wave-16 q landing. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held twice (the r778 keyboard bridge is a named mechanism gated-witnessed in scripts/qa_r778_close.txt; AND the wave-16 interval recorded forward into the on-page band docs with the rendered value - a named mechanism updated with witnessed data; full golden QA anchored in scripts/qa_r778.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r778: wave 16 landed mid-round and is recorded forward - bucket 10-30 09:00 q (qwen-only, 1/2 active) at +62m, band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) at the band sites with wave-16 framing; the amber fired live mid-round before the wave reset the quiet (second true firing); the lean run restarted (the r776 break note unrendered live, the wave-bound gate degraded to RECORDED as the handoff predicted); GLM-SILENT firms (q with no glm dial). Increment: the r778 keyboard bridge - the strip bucket chips gained tabIndex 0 + a focus-visible ring, the hover-only bucket data reachable by keyboard focus; the strip container title documents the bridge. Styling polish: the focus ring + focused-chip text emphasis. Snapshot discipline thirty-third close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r778_close.txt
SWEEP=$(git add -A && git commit -m "r778: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
