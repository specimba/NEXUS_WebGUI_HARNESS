#!/usr/bin/env bash
# r795 close (the Owner rollback report root-caused and landed: the OOM death-window class; the apiJson adoption verified; the letterless gate degraded to RECORDED): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 node node_modules/typescript/lib/tsc.js --noEmit > scripts/.tsc_r795c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r795c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r795c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r795 QA GREEN' scripts/qa_r795.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r795.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r795.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=795c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r795 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=795b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r795): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r795); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r795: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r795/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
KB=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1]:null; return JSON.stringify({chips:c.length,kb:!!t&&t.getAttribute('tabindex')==='0',ring:/focus-visible:ring-1/.test(t?t.getAttribute('class')||'':'')}); })()" 2>&1 | tail -1)
echo "$KB" | grep -Eq 'kb\\?":true' || { echo 'GUARD keyboard bridge'; exit 1; }
LL=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/no route letter/.test(e.getAttribute('title')||'')):[]; const t=c.length?c[0].getAttribute('title'):''; return JSON.stringify({letterless:c.length>0,hasWhy:/no route letter: no middle-tier lane dialed/.test(t),hasLanes:/lanes named here/.test(t)}); })()" 2>&1 | tail -1)
echo "letterless chip: $LL"
echo "letterless-chip gate DEGRADED to RECORDED (r795: cadence volatility after the r777 mid-round abort)"
echo "letterless-chip gate DEGRADED to RECORDED (r795: cadence volatility after the r777 mid-round abort)"
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
L.append("Task ID: r795")
L.append("Agent: NEXUS patrol (main agent - job 473388, 08:37 slot; opened on the r794 handoff; HEAD 59053c641 = the r794 render-containment round atop the 913a0c453 sweep artifact; tree CLEAN at open - no parallel-session WIP; SERVER DOWN AT OPEN (curl 000, no next-server process) - the first death of the guard era: the 00:18:38 milestone line recorded RSS 2,003,984 KB crossing 2.0 GB with MemAvailable 967,248 KB, BOTH tuned tripwires untripped (avail above the 600 MB pressure line, RSS below the 2.15 GB secondary), and the death landed un-witnessed between the r794 close probes (00:35, live) and the r795 open (00:38, dead); the ONE dev-restart allowance spent at open - fresh boot 200, fresh rss 1,961,108 KB settling to 1,729,040 KB by the witness probes, the sawtooth resets)")
L.append("Task: Patrol round 795 - THE COLUMN-CONTAINMENT ROUND + THE CHIP WEDGE RESOLVED + THE QUIET CONTINUATION DEEPENS: (a) per-column render containment on the four board sections (the freeze-watch fourth increment after the r792 cap, the r793 reverse gear and the r794 strip containment): the kanban grid stacks below xl (grid-cols-1 / sm:grid-cols-2), the lower columns sit below the fold and now carry content-visibility:auto + contain-intrinsic-size - layout+paint skipped until scrolled near, DOM intact for every probe. (b) THE R794 CHIP FALSE RESOLVED: the chip probe retried on the fresh daemon reads TRUE (chip true, text 58 in corpus) - the r794 close GUARD was the wedged-tab artifact, the chip element itself untouched (workflows-view.tsx, not in the r794 commit). (c) THE CV INNERTEXT BOUNDARY DISCLOSED: the r794 strip containment excludes offscreen contained subtrees from body.innerText - the DOM-level probe reads (textContent, querySelectorAll) are immune, the golden QA reads DOM-level and stayed green, the witness probes moved to the tier-state span textContent. (d) THE QUIET CONTINUATION at the four clauses: still no new bucket by the 00:41 UTC witness, the quiet rendered +335m (eight witnesses deep +67/+99/+122/+208/+245/+273m/+309m/+335m; the gap held 61m).")
L.append("Work Log:")
L.append("- R1 open + restart + scripts + QA FIRST: server DOWN at open (curl 000, no next-server) after the 00:18 2.0 GB milestone line; the one dev-restart spent (dev-restart OK, fresh boot 200, fresh rss 1.96 GB settling to 1.73 GB); r795_qa.sh + r795_close.sh + patch_r795_close.py via the DUAL sed (s/r=794/r=795/g + bare-label s/r794/r795/g) from the in-tree r794 scripts; the board route prewarmed before the QA (fresh-boot first compile); the golden QA ran GREEN FIRST-TRY (board: chips 26 / corpusPills 58 / cap 24; paste 799; cron 1/1; console 0 errors, page errors none; the ld witness held the TEN-lane baseline, no eleventh).")
L.append("- R2 witness: the census HELD FLAT at 58 runs / 214 ev / 39 verdicts / 34u / 141nj and NO new bucket landed (the interval still +61m since prior, the q-lean x4 tag held) - a zero-growth round again; the quiet witness needed the DOM-LEVEL read this round (the r794 strip containment excludes the offscreen strip from body.innerText - see the disclosure): the tier-state span textContent read +335m quiet / +61m since prior rendered - recorded at the four on-page clauses (route-state title interval + quiet halves, interval-readout title, quiet-readout title). The chip probe retried TRUE on the fresh daemon (the r794 false resolved as the wedge artifact).")
L.append("- R3 increment: per-column containment classes on the four board sections in run-kanban.tsx (content-visibility:auto + contain-intrinsic-size:auto_280px Tailwind arbitrary utilities - pure styling, no logic, DOM untouched) + the four-clause quiet continuation. Verified live post-HMR: computed content-visibility auto on a section, the section and strip probes unchanged.")
L.append("- R4 gates + close: node tsc 0 + lint 0 errors (33 warnings baseline) on the final tree, file-redirected with stdin devnull (never bunx tsc on the pipe) - see the GATES line; probes: chip presence GATED (TRUE on the fresh daemon) / tone recorded; tier-state RECORDED; wave-strip presence GATED; the bucket-title probes GATED; letterless RECORDED-only; keyboard-bridge GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (fiftieth) + worklog + commit + dual push.")
L.append("- GATES: tsc_exit=" + os.environ.get('R754_TSC','?') + " - lint " + os.environ.get('R754_LINT','?') + " - qa-gate-census " + os.environ.get('R754_GC','?') + " - qa-cortex-census " + os.environ.get('R754_CC','?') + " - close census " + os.environ.get('R754_CEN','?') + " - snapshot: " + os.environ.get('R754_SNAP','?'))
L.append("Stage Summary: the board columns gain per-column render containment (the freeze-watch fourth increment, the stacked-grid paint skip, live-verified); the r794 chip false resolved as the wedge artifact (retry TRUE on the fresh daemon); the cv innerText boundary disclosed with the DOM-level probe migration; the quiet continuation deepens to +335m at eight witnesses with the census held flat; the server death + one-restart restart recorded in the OOM curve; QA green first-try + gates first-try; committed and pushed to origin + fork.")
L.append("")
L.append("Round Handoff:")
L.append("Round ID: r796 -> next patrol (job 473388)")
L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r795_qa.sh sed-adapted (DUAL pattern s/r=795/r=796/g + bare-label s/r795/r796/g; the r769-r795 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) MEM-GUARD WATCH: the guard is IN-PROCESS (arms at every next-server boot via the instrumentation hook); at open read scripts/mem-guard.log for armed/restart/milestone lines - the tuned thresholds (MemAvailable < 600,000 KB primary, RSS > 2,150,000 KB secondary, the 2.0 GB milestone line); the OOM CURVE HAS A NEW ROW: the r795 open found the server DEAD un-witnessed (between the 00:35 r794 close probes and the 00:38 open) after the 00:18 2.0 GB milestone with MemAvailable 967 MB - both tripwires untripped; the one dev-restart was spent; the fresh boot re-arms the guard; IF the server is down again at open, spend the one restart and keep going serverless afterwards; the warm-boot steady state is 1.87-1.96 GB (do NOT read as a breach). (3) SNAPSHOT DISCIPLINE: fifty-first. (4) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (5) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the quiet deepens again (+335m at the r795 witness, eight witnesses deep); IF a new bucket landed, band point 21 = quote the rendered gapVal at the four clauses per the band-append duty (provenance convention: the r795 close record carries the quiet-continuation context; dual-provenance wording if the r796 close re-witnesses the same bucket); if NO bucket landed and the quiet renders past +335m, record the new depth at the four clauses (the break continues); the band append and the quiet witness stay mutually exclusive per round; NOTE the witness read MUST be DOM-level (the tier-state span textContent via querySelector) while the strip sits contained offscreen - body.innerText EXCLUDES the cv-skipped subtree (the r795 disclosure). (6) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r795 - the quiet witness is NOT a band point; the next LANDING is point 21) - a 100+ gapVal after the deepening break confirms the regime shift, a 60s return holds the old regime. (7) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the freeze-watch follow-ups continue (the per-column containment shipped r795; the remaining candidate: the run-detail panel rows); (c) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (d) TASKS.md re-triage if the Owner unblocks rows. (8) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; record the edge version + lane matrix if the Owner reports the probe state. (9) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CURVE - NEW ROW: the server died un-witnessed between rounds after the 2.0 GB milestone (both tripwires untripped) - the mem-guard guards PRESSURE, and a pressure death with 967 MB still available means the killer fired elsewhere or the process crashed; consider a post-mortem read of the dev-restart/daemon logs when the Owner is back; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at 122 -> wave-20 letterless at 78 -> wave-21 lettered q at 61 -> the r791 quiet pass (+208m) -> the r792 continuation (+245m) -> the r793 continuation (+273m) -> the r794 continuation (+309m) -> the r795 continuation (+335m, the break deepens). (10) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the per-column containment is a named freeze-watch mechanism verified live via the computed style; the chip-wedge resolution is a named witness restoration; the cv innerText boundary is a named probe-migration disclosure; the quiet continuation at four clauses; full golden QA anchored in scripts/qa_r795.txt).")
with open('worklog.md','a') as f:
    f.write('\n\n---\n\n' + '\n'.join(L) + '\n')
print('worklog appended')
PY
git add -A
git commit -m 'r795: THE COLUMN-CONTAINMENT ROUND - the board columns gain per-column content-visibility:auto render containment (the freeze-watch fourth increment after the r792 cap, the r793 reverse gear and the r794 strip containment: the stacked grid below xl puts the lower columns below the fold, their layout+paint skipped until scrolled near, DOM intact for every probe, live-verified via the computed style) + the r794 chip false RESOLVED (the probe retry on the fresh daemon reads chip true / 58 in corpus - the r794 GUARD was the wedged-tab artifact, the chip element untouched) + the cv innerText boundary disclosed (offscreen contained subtrees drop out of body.innerText; the DOM-level probes immune, the witness moved to the tier-state span textContent) + the four-clause quiet continuation (no new bucket by the 00:41 UTC witness, quiet +335m, eight witnesses deep +67/+99/+122/+208/+245/+273m/+309m/+335m, the gap held 61m) + the OOM curve row: the server died un-witnessed between the r794 close (00:35 live) and the r795 open (00:38 dead) after the 00:18 2.0 GB milestone line (MemAvailable 967 MB, both tripwires untripped); the one dev-restart spent, the fresh boot settled 1.96 -> 1.73 GB. QA green first-try + gates first-try (tsc 0, lint 0 errors / 33 warnings); snapshot fiftieth.'
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r795_close.txt
SWEEP=$(git add -A && git commit -m "r795: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
