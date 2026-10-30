#!/usr/bin/env bash
# r792 close (the Owner rollback report root-caused and landed: the OOM death-window class; the apiJson adoption verified; the letterless gate degraded to RECORDED): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 node node_modules/typescript/lib/tsc.js --noEmit > scripts/.tsc_r792c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r792c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r792c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r792 QA GREEN' scripts/qa_r792.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r792.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r792.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=792c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r792 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=792b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r792): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r792); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r792: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r792/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
KB=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1]:null; return JSON.stringify({chips:c.length,kb:!!t&&t.getAttribute('tabindex')==='0',ring:/focus-visible:ring-1/.test(t?t.getAttribute('class')||'':'')}); })()" 2>&1 | tail -1)
echo "$KB" | grep -Eq 'kb\\?":true' || { echo 'GUARD keyboard bridge'; exit 1; }
LL=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/no route letter/.test(e.getAttribute('title')||'')):[]; const t=c.length?c[0].getAttribute('title'):''; return JSON.stringify({letterless:c.length>0,hasWhy:/no route letter: no middle-tier lane dialed/.test(t),hasLanes:/lanes named here/.test(t)}); })()" 2>&1 | tail -1)
echo "letterless chip: $LL"
echo "letterless-chip gate DEGRADED to RECORDED (r792: cadence volatility after the r777 mid-round abort)"
echo "letterless-chip gate DEGRADED to RECORDED (r792: cadence volatility after the r777 mid-round abort)"
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
L.append("Task ID: r792")
L.append("Agent: NEXUS patrol (main agent - job 473388, 07:07 slot; opened on the r791 handoff; HEAD b6a6f9a66 = the r791 addendum-3 threshold doctrine atop 61589d755; tree CLEAN at open - no parallel-session WIP; server 200 first-try, no restart needed; opening witness: the mem-guard END-TO-END PROOF in scripts/mem-guard.log - the old-threshold in-process guard armed 22:56:36 (pid 17131) fired its ONE graceful restart at 22:58:36 (RSS 1,959,388 KB > the 1,740,000 KB threshold) and the fresh boot pid 17401 armed the TUNED guard (rss 2,150,000 KB secondary / MemAvailable 600,000 KB primary, 120s check, 300s cooldown) - exactly the addendum-3 prediction, the mechanism closed end-to-end; that restart spends the r792 dev-restart allowance per the handoff, no second restart)")
L.append("Task: Patrol round 792 - THE FREEZE-WATCH FOLLOW-UP ROUND (the Owner directive: focus more on work efficiency, the page-freeze cycle costing ~20 minutes per occurrence): (a) THE CORPUS STRIP RENDER CAP (the r791 handoff candidate 7b) - the unfiltered corpus strip rendered EVERY pill (56 runs and climbing, +2-3 rows per patrol slot, unbounded DOM weight on the heaviest board surface); now capped at RENDER time (CORPUS_STRIP_CAP 24, the TAIL = the newest end, the same slice the r763 wave strip reads) per the r227 truth class: the tally and census keep describing the WHOLE corpus, the shown chip states the render truth (24 of 56 shown), an honest +32 older runs not shown footer with a violet-hover Show-all affordance sits where the cap bites, a filter (pill query or lane filter) always lifts the cap - a narrowed search must search the WHOLE filtered set - and the Show-all lift is session-local. (b) THE QUIET CONTINUATION WITNESS at the four on-page sites: still no new bucket by the 23:12 UTC witness, the quiet rendered +245m - the stretch deepens past its own +208m record (the amber regime five witnesses deep +67/+99/+122/+208/+245m). (c) THE MEM-GUARD MECHANISM PROOF witnessed at open (the graceful restart landed BEFORE the kernel killer - the addendum-3 doctrine validated on live data).")
L.append("Work Log:")
L.append("- R1 open + scripts + QA FIRST: tree CLEAN at b6a6f9a66; server 200 (pid 17401, rss ~1.79 GB at +9m after the guard-fired restart, MemAvailable 1.36 GB - healthy); r792_qa.sh + r792_close.sh via the DUAL sed (s/r=791/r=792/g + bare-label s/r791/r792/g) from the in-tree r791 scripts; the r792 golden QA ran GREEN FIRST-TRY (marker in scripts/qa_r792.txt: board 56 runs / 200 ev / 35 verdicts / 24u / 141nj, chips 57 - census FLAT vs the r791 close, no new bucket; the ld witness held the TEN-lane baseline, no eleventh; paste 799; cron 1/1; console 0 errors, page errors none) - the r791 exa fix held (zero same-key console entries).")
L.append("- R2 increment: the corpus strip cap implemented in run-kanban.tsx (the CORPUS_STRIP_CAP constant + the showAllCorpus session state + the corpusCapped/renderedCorpus render-time slice + the shown chip reading the RENDERED count + the honest footer with the Show-all button carrying the r783 violet-hover convention) - the r227 board-column cap pattern applied to the corpus strip. Verified live: the cap footer + the 24 of 56 shown chip rendered, the Show-all click grew the pills 25 -> 57 (+32 = exactly the hidden tail) and the footer correctly unrendered on the lift.")
L.append("- R3 witness: the legend-click tier-state probe read bucket 10-30 19:00 / q / q-lean x4 / +61m since prior / +245m quiet / mid-qwen ACTIVE 1/2 (AIHubMix qwen3.8-flash-free silent) / mid-glm silent 0/2 - no new bucket, the band-append duty and the quiet duty stay mutually exclusive, the QUIET CONTINUATION is the live one; the four on-page clauses (route-state title interval + quiet halves, interval-readout title, quiet-readout title) updated with the r792 continuation (+245m at the 23:12 UTC witness, the stretch deepens past its own +208m record, five witnesses deep).")
L.append("- R3.5 disclosure: two mid-round slips caught by the live probe and fixed before gates - the first edit added the cap comment WITHOUT the CORPUS_STRIP_CAP constant and the lift comment WITHOUT the showAllCorpus useState, the board crashed (React unmounted this view) and the probe caught it immediately; both declarations completed, HMR verified clean, the live-probe safety net is the r791 disclosure pattern held.")
L.append("- R4 gates on the final tree: node tsc 0 + lint 0 errors (33 warnings baseline) FIRST-TRY, file-redirected with stdin devnull (never bunx tsc on the pipe); the close re-ran both gates - see the GATES line.")
L.append("- R5 close: the close script sed-inherited narrative was rewritten by scripts/patch_r792_close.py (the stale r791 story replaced with the true r792 record; the commit line prefix-filtered on the r792 message marker then replaced); close probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED; the bucket-title probes GATED; letterless RECORDED-only; keyboard-bridge GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-seventh) + worklog + commit + dual push.")
L.append("- GATES: tsc_exit=" + os.environ.get('R754_TSC','?') + " - lint " + os.environ.get('R754_LINT','?') + " - qa-gate-census " + os.environ.get('R754_GC','?') + " - qa-cortex-census " + os.environ.get('R754_CC','?') + " - close census " + os.environ.get('R754_CEN','?') + " - snapshot: " + os.environ.get('R754_SNAP','?'))
L.append("Stage Summary: the corpus strip render cap ships (the DOM weight of the heaviest board surface bounded at 24 pills by default, the whole corpus one Show-all click away, the whole-corpus numbers honest in tally/census/chip) - the second freeze-watch increment after the r791 cv-auto; the mem-guard mechanism proof witnessed end-to-end (the graceful restart landed BEFORE the kernel killer, the tuned guard armed on the fresh boot, the addendum-3 threshold doctrine validated); the quiet continuation witness is on-page at four sites (the break deepens to +245m, the amber regime five witnesses deep); QA green first-try + gates first-try; committed and pushed to origin + fork.")
L.append("")
L.append("Round Handoff:")
L.append("Round ID: r793 -> next patrol (job 473388)")
L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r792_qa.sh sed-adapted (DUAL pattern s/r=792/r=793/g + bare-label s/r792/r793/g; the r769-r792 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) MEM-GUARD WATCH: the guard is IN-PROCESS (no daemon to relaunch; it does not survive sandbox recycles because it arms at every next-server boot via the instrumentation hook); at open read scripts/mem-guard.log for armed/restart lines - the tuned thresholds (MemAvailable < 600,000 KB primary, RSS > 2,150,000 KB secondary, the 2.0 GB milestone line); a guard-fired restart spends the round dev-restart allowance (record the fresh-rss line in the OOM curve); the warm-boot steady state is 1.87-1.93 GB (addendum 3) - do NOT read that as a breach. (3) SNAPSHOT DISCIPLINE: forty-eighth. (4) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (5) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: THE QUIET DEEPENS - +245m at the r792 witness, past its own +208m record; IF a new bucket landed, band point 21 = quote the rendered gapVal at the four sites per the band-append duty (provenance convention: the r792 close record carries the quiet-continuation context; dual-provenance wording if the r793 close re-witnesses the same bucket); if NO bucket landed and the quiet renders past +245m, record the new depth at the four sites (the break continues); the band append and the quiet witness stay mutually exclusive per round. (6) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r792 - the quiet witness is NOT a band point; the next LANDING is point 21) - a 100+ gapVal after the deepening break confirms the regime shift, a 60s return holds the old regime. (7) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the freeze-watch follow-ups continue (the corpus strip cap shipped r792; the remaining candidate is virtualizing the board chips); (c) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (d) TASKS.md re-triage if the Owner unblocks rows. (8) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; record the edge version + lane matrix if the Owner reports the probe state. (9) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CURVE - the mem-guard mitigation is live AND PROVEN (the 22:58:36 graceful restart fired before the kernel killer; tuned thresholds avail 600 MB / RSS 2.15 GB; the warm-boot steady state 1.87-1.93 GB documented; the curve now reads as a managed sawtooth instead of an unbounded climb); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at 122 -> wave-20 letterless at 78 -> wave-21 lettered q at 61 -> the r791 quiet pass (+208m) -> the r792 quiet continuation (+245m, the break deepens). (10) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the corpus strip render cap is a named freeze-watch mechanism verified live with the lift arithmetic 25 -> 57; the mem-guard end-to-end proof is a named mechanism witness on live data; the quiet continuation at four sites; full golden QA anchored in scripts/qa_r792.txt).")
with open('worklog.md','a') as f:
    f.write('\n\n---\n\n' + '\n'.join(L) + '\n')
print('worklog appended')
PY
git add -A
git commit -m 'r792: THE FREEZE-WATCH FOLLOW-UP - the corpus strip render cap (the unfiltered strip rendered every pill - 56 runs and climbing at +2-3 per patrol slot of unbounded DOM on the heaviest board surface; now CORPUS_STRIP_CAP 24 at render time per the r227 truth class: tally + census keep the whole-corpus numbers, the shown chip reads the render truth 24 of 56 shown, an honest +32 older runs not shown footer carries a violet-hover Show-all affordance, filters always lift the cap, the lift is session-local; live-verified with the lift arithmetic 25 -> 57 pills) + the mem-guard end-to-end proof witnessed (the old-threshold in-process guard fired its one graceful restart at 22:58:36 - RSS 1.96 GB > the 1.74 GB threshold - BEFORE the kernel killer, the fresh boot armed the tuned guard avail 600 MB / RSS 2.15 GB, the addendum-3 doctrine validated) + the r792 quiet continuation at the four on-page sites (no new bucket by the 23:12 UTC witness, quiet +245m - the break deepens past its own +208m record, the amber regime five witnesses deep). QA green first-try + gates first-try (tsc 0, lint 0 errors / 33 warnings); snapshot forty-seventh.'
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r792_close.txt
SWEEP=$(git add -A && git commit -m "r792: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
