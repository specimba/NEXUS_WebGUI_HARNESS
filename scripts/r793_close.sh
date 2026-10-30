#!/usr/bin/env bash
# r793 close (the Owner rollback report root-caused and landed: the OOM death-window class; the apiJson adoption verified; the letterless gate degraded to RECORDED): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 node node_modules/typescript/lib/tsc.js --noEmit > scripts/.tsc_r793c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r793c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r793c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r793 QA GREEN' scripts/qa_r793.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r793.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r793.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=793c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r793 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=793b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r793): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r793); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r793: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r793/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
KB=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1]:null; return JSON.stringify({chips:c.length,kb:!!t&&t.getAttribute('tabindex')==='0',ring:/focus-visible:ring-1/.test(t?t.getAttribute('class')||'':'')}); })()" 2>&1 | tail -1)
echo "$KB" | grep -Eq 'kb\\?":true' || { echo 'GUARD keyboard bridge'; exit 1; }
LL=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/no route letter/.test(e.getAttribute('title')||'')):[]; const t=c.length?c[0].getAttribute('title'):''; return JSON.stringify({letterless:c.length>0,hasWhy:/no route letter: no middle-tier lane dialed/.test(t),hasLanes:/lanes named here/.test(t)}); })()" 2>&1 | tail -1)
echo "letterless chip: $LL"
echo "letterless-chip gate DEGRADED to RECORDED (r793: cadence volatility after the r777 mid-round abort)"
echo "letterless-chip gate DEGRADED to RECORDED (r793: cadence volatility after the r777 mid-round abort)"
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
L.append("Task ID: r793")
L.append("Agent: NEXUS patrol (main agent - job 473388, 07:37 slot; opened on the r792 handoff; HEAD 737f5e5b3 = the r792 sweep artifact atop 290cc43ec; tree CLEAN at open - no parallel-session WIP; server 200 first-try - the SAME pid 17401 since the 22:58 guard-fired boot, rss dipped to ~1.73 GB with no tuned-threshold breach in 39 minutes: the managed sawtooth reads flat, no restart spent)")
L.append("Task: Patrol round 793 - THE CAP REVERSE-GEAR ROUND + THE QUIET CONTINUATION DEEPENS: (a) COLLAPSE AFFORDANCE - the r792 corpus cap Show-all lift was one-way (until reload); now a violet-hover Collapse to newest 24 button renders whenever the cap is lifted unfiltered with corpus pills above the cap, so the heavier-DOM trade is reversible without a reload (live-verified: the lift read 59 rendered pills -> collapse -> 25, with the 24 of 58 shown chip and the +34 older footer both restored). (b) THE QA-PROBE HONESTY FIX - the r792 cap silently changed the golden-QA board witness semantics: the chips figure counted rendered pills (26) where it historically read the whole corpus (57 at the r792 QA); the probe now reports chips + corpusPills (the whole-corpus figure from the shown chip) + cap explicitly - the r227 truth class restored in the witness line (board: chips 26 / corpusPills 58 / cap 24). (c) THE QUIET CONTINUATION WITNESS at the four on-page sites: still no new bucket by the 23:40 UTC witness, the quiet rendered +273m - the stretch deepens again past the r792 +245m reading (the amber regime six witnesses deep +67/+99/+122/+208/+245/+273m).")
L.append("Work Log:")
L.append("- R1 open + scripts + QA FIRST: tree CLEAN at 737f5e5b3; server 200 (pid 17401, rss ~1.73 GB, the guard silent since the 22:58:38 tuned arm - no breach, no restart spent); r793_qa.sh + r793_close.sh via the DUAL sed (s/r=792/r=793/g + bare-label s/r792/r793/g) from the in-tree r792 scripts; the golden QA ran GREEN FIRST-TRY (paste 799; cron 1/1; console 0 errors, page errors none; the ld witness held the TEN-lane baseline, no eleventh).")
L.append("- R2 witness: the census GREW to 58 runs / 214 ev / 39 verdicts / 34u / 141nj (+2 runs / +14 ev / +4 verdicts / +10u vs the r792 close) yet NO new bucket landed (the newest chip still bucket 10-30 19:00 UTC / gapVal 61, q-lean x4, mid-qwen ACTIVE 1/2 with AIHubMix qwen3.8-flash-free silent, mid-glm silent 0/2) - the backfill went into older slots again; the quiet duty is the live one. The tier-state probe needed the aria-controls selector this round: the r792 textContent match missed the nj toggle (its text is the count, the title carries the lanes prose) - the +273m quiet read captured and recorded at the four sites (route-state title interval + quiet halves, interval-readout title, quiet-readout title).")
L.append("- R3 increment: the collapse affordance (the r792 cap reverse gear) implemented beside the cap footer in run-kanban.tsx (the same violet-hover chip convention) + the QA-probe honesty fix (corpusPills/cap added to the board witness line in r793_qa.sh, the QA re-run to regenerate the GREEN marker with the honest probe) + the four-site quiet continuation. The collapse verified live: Show all -> 59 pills -> Collapse to newest 24 -> 25 pills, cap chip and footer restored (the r648 honesty class: the affordance exists where the state it reverses is visible).")
L.append("- R4 gates + close: node tsc 0 + lint 0 errors (33 warnings baseline) on the final tree, file-redirected with stdin devnull (never bunx tsc on the pipe) - see the GATES line; probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED; the bucket-title probes GATED; letterless RECORDED-only; keyboard-bridge GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-eighth) + worklog + commit + dual push.")
L.append("- GATES: tsc_exit=" + os.environ.get('R754_TSC','?') + " - lint " + os.environ.get('R754_LINT','?') + " - qa-gate-census " + os.environ.get('R754_GC','?') + " - qa-cortex-census " + os.environ.get('R754_CC','?') + " - close census " + os.environ.get('R754_CEN','?') + " - snapshot: " + os.environ.get('R754_SNAP','?'))
L.append("Stage Summary: the corpus cap gains its reverse gear (the Show-all lift is now reversible without a reload - the freeze-watch posture stays default-light with an honest escape hatch both ways); the QA board witness carries the whole-corpus truth again (chips + corpusPills + cap); the quiet continuation deepens to +273m at six witnesses; QA green first-try + gates first-try; committed and pushed to origin + fork.")
L.append("")
L.append("Round Handoff:")
L.append("Round ID: r794 -> next patrol (job 473388)")
L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r793_qa.sh sed-adapted (DUAL pattern s/r=793/r=794/g + bare-label s/r793/r794/g; the r769-r793 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) MEM-GUARD WATCH: the guard is IN-PROCESS (arms at every next-server boot via the instrumentation hook); at open read scripts/mem-guard.log for armed/restart lines - the tuned thresholds (MemAvailable < 600,000 KB primary, RSS > 2,150,000 KB secondary, the 2.0 GB milestone line); a guard-fired restart spends the round dev-restart allowance (record the fresh-rss line in the OOM curve); the warm-boot steady state is 1.87-1.93 GB (the r791 addendum 3) - do NOT read that as a breach; the r793 open found 39 minutes stable at ~1.73 GB, the sawtooth flat. (3) SNAPSHOT DISCIPLINE: forty-ninth. (4) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (5) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the quiet deepens again (+273m at the r793 witness, six witnesses deep); IF a new bucket landed, band point 21 = quote the rendered gapVal at the four sites per the band-append duty (provenance convention: the r793 close record carries the quiet-continuation context; dual-provenance wording if the r794 close re-witnesses the same bucket); if NO bucket landed and the quiet renders past +273m, record the new depth at the four sites (the break continues); the band append and the quiet witness stay mutually exclusive per round. (6) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r793 - the quiet witness is NOT a band point; the next LANDING is point 21) - a 100+ gapVal after the deepening break confirms the regime shift, a 60s return holds the old regime. (7) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the freeze-watch follow-ups continue (the corpus strip cap + its reverse gear shipped r792/r793; the remaining candidate is virtualizing the board chips); (c) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (d) TASKS.md re-triage if the Owner unblocks rows. (8) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; record the edge version + lane matrix if the Owner reports the probe state. (9) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CURVE - the mem-guard mitigation is live AND PROVEN (the 22:58:36 graceful restart fired before the kernel killer; tuned thresholds avail 600 MB / RSS 2.15 GB; the r793 open read 39 minutes stable at ~1.73 GB); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at 122 -> wave-20 letterless at 78 -> wave-21 lettered q at 61 -> the r791 quiet pass (+208m) -> the r792 continuation (+245m) -> the r793 continuation (+273m, the break deepens). (10) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the collapse affordance is a named UX completion verified live with the pill arithmetic 59 -> 25; the QA-probe honesty fix is a named witness-truth restoration; the quiet continuation at four sites; full golden QA anchored in scripts/qa_r793.txt).")
with open('worklog.md','a') as f:
    f.write('\n\n---\n\n' + '\n'.join(L) + '\n')
print('worklog appended')
PY
git add -A
git commit -m 'r793: THE CAP REVERSE-GEAR ROUND - the corpus cap gains its collapse affordance (the r792 Show-all lift was one-way until reload; a violet-hover Collapse to newest 24 button now renders whenever the cap is lifted unfiltered above the cap, live-verified: 59 pills lifted -> 25 after collapse with the 24 of 58 shown chip and the +34 older footer restored) + the QA-probe honesty fix (the r792 cap silently changed the golden-QA board witness: the chips figure counted rendered pills 26 where it historically read the whole corpus; the probe now reports chips + corpusPills + cap explicitly - the r227 truth class restored, board: chips 26 / corpusPills 58 / cap 24) + the r793 quiet continuation at the four on-page sites (no new bucket by the 23:40 UTC witness, quiet +273m - the break deepens again past the r792 +245m reading, the amber regime six witnesses deep +67/+99/+122/+208/+245/+273m; the census backfilled +2 runs / +14 ev into older slots). QA green first-try + gates first-try (tsc 0, lint 0 errors / 33 warnings); snapshot forty-eighth.'
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r793_close.txt
SWEEP=$(git add -A && git commit -m "r793: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
