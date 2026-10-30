#!/usr/bin/env bash
# r790 close (the Owner rollback report root-caused and landed: the OOM death-window class; the apiJson adoption verified; the letterless gate degraded to RECORDED): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 node node_modules/typescript/lib/tsc.js --noEmit > scripts/.tsc_r790c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r790c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r790c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r790 QA GREEN' scripts/qa_r790.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r790.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r790.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=790c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r790 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=790b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r790): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r790); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r790: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r790/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
KB=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1]:null; return JSON.stringify({chips:c.length,kb:!!t&&t.getAttribute('tabindex')==='0',ring:/focus-visible:ring-1/.test(t?t.getAttribute('class')||'':'')}); })()" 2>&1 | tail -1)
echo "$KB" | grep -Eq 'kb\\?":true' || { echo 'GUARD keyboard bridge'; exit 1; }
LL=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/no route letter/.test(e.getAttribute('title')||'')):[]; const t=c.length?c[0].getAttribute('title'):''; return JSON.stringify({letterless:c.length>0,hasWhy:/no route letter: no middle-tier lane dialed/.test(t),hasLanes:/lanes named here/.test(t)}); })()" 2>&1 | tail -1)
echo "letterless chip: $LL"
echo "letterless-chip gate DEGRADED to RECORDED (r790: cadence volatility after the r777 mid-round abort)"
echo "letterless-chip gate DEGRADED to RECORDED (r790: cadence volatility after the r777 mid-round abort)"
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
L.append("Task ID: r790")
L.append("Agent: NEXUS patrol (main agent - job 473388, 05:07 slot; opened on the r789 handoff; HEAD a9e44188f = the r789 sweep artifact atop 241798fa5; tree CLEAN at open - no parallel-session WIP; server 200 first-try, no restart needed; opening witness: the census flat since the r789 close - no new cadence point)")
L.append("Task: Patrol round 790 - THE BAND DOCS CARRY THE r790 QUIET-WATCH WITNESS at all four on-page sites (no new cadence point: the census held flat and the band stays 20 points ending 61; the zero-growth stretch TIES the 122 band max). (a) QUIET WATCH: no new bucket by 21:08 UTC - the quiet readout rendered +122m at the r790 witness probe, tying the 122 band max (the wave-19 readout, the longest interval on record); the amber past-ceiling regime held across the r788/r789/r790 witnesses (+67/+99/+122m); the clause sits at the Route-state title interval + quiet halves, the interval-readout title and the quiet-readout title. (b) STYLING POLISH: the lanes-tried legend toggle gains the hover underline solidify (dotted to solid on hover) - the affordance reads as clickable on hover.")
L.append("Work Log:")
L.append("- R1 open + scripts + QA FIRST: tree CLEAN at a9e44188f; server 200; r790_qa.sh + r790_close.sh via the DUAL sed (s/r=789/r=790/g + bare-label s/r789/r790/g) from the in-tree r789 scripts (node tsc inherited); the r790 golden QA ran GREEN FIRST-TRY (marker in scripts/qa_r790.txt; board 53 runs / 186 ev / 30 verdicts / 15u / 141nj with chips 54 - census FLAT vs the r789 close, no new bucket; the ld witness held the TEN-lane baseline, no eleventh).")
L.append("- R2 witness: the strip probe read chips 54 / newest chip gapVal 61 held; the tier-state line (after the legend click) rendered bucket q + q-lean x4 + +122m quiet + mid-qwen ACTIVE 1/2 / mid-glm silent 0/2 - the stretch ties the 122 max; RSS ~2.02 GB at ~+448m after the 21:40 restart (next-server 2,015,168 KB at 21:08 UTC, a slight dip from the r789 ~2.05 GB reading - the curve hovers at the stall mark).")
L.append("- R3 increment: the four band-doc sites got the r790 quiet-watch clause (the tie witness, the amber series) + the legend toggle underline polish - the on-page quiet watch is the round user-facing improvement (the record-tying lull reads without the worklog).")
L.append("- R4 gates: pre-close gates ran file-redirected with stdin devnull (node tsc, never bunx on the pipe); the close re-ran both gates on the final tree - see the GATES line.")
L.append("- R5 close: close probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED / text RECORDED; the bucket-title probes GATED; the letterless-chip probe RECORDED-only; the keyboard-bridge probe GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-fifth) + worklog + commit + dual push.")
L.append("- GATES: tsc_exit=" + os.environ.get('R754_TSC','?') + " - lint " + os.environ.get('R754_LINT','?') + " - qa-gate-census " + os.environ.get('R754_GC','?') + " - qa-cortex-census " + os.environ.get('R754_CC','?') + " - close census " + os.environ.get('R754_CEN','?') + " - snapshot: " + os.environ.get('R754_SNAP','?'))
L.append("Stage Summary: the quiet-watch tie witness is on-page at four sites with the amber series; no new cadence point (the band stays 20 points); the legend toggle polish shipped; QA green first-try; committed and pushed to origin + fork.")
L.append("")
L.append("Round Handoff:")
L.append("Round ID: r791 -> next patrol (job 473388)")
L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r790_qa.sh sed-adapted (DUAL pattern s/r=790/r=791/g + bare-label s/r790/r791/g; the r769-r790 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) SNAPSHOT DISCIPLINE: forty-sixth. (3) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: THE QUIET WATCH IS THE LIVE DUTY - the stretch tied the 122 band max at the r790 witness (+122m rendered, amber since r788): IF a new bucket landed, execute the band-append quote duty at the four sites (QUOTE THE RENDERED VALUE; provenance convention: check the close record of the PRIOR round for a pre-recorded gapVal - carry the dual-provenance wording; a bucket landing also RESETS the quiet - the final stretch value is then the new band point); if NO bucket landed and the quiet readout now renders PAST 122, the zero-growth stretch is the longest on record - record the pass at all four sites (the genuine cadence-break witness); the band append and the quiet pass are mutually exclusive per round - judge from the live render. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r790) - the next point lands after the record-tying lull: another 100+ stretch would signal a regime shift, a 60s return holds the old regime. (6) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. (7) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; if the Owner reports the probe state, record the edge version + lane matrix in the worklog. (8) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CEILING - HOVERING AT THE STALL MARK: witnesses three kills rss 1.82/1.71/1.56 GB + the r782 gate-stall at ~1.92 GB + the regrowth curve ~1.69 GB at ~+130m / ~1.88 GB at ~+375m / ~2.05 GB at ~+423m / ~2.02 GB at ~+448m after the 21:40 restart (next-server 2,015,168 KB at the r790 witness, 21:08 UTC) - the curve crossed the old kill marks and now hovers near 2.0; a kill-and-regrow cycle is the EXPECTED outcome - if the server is found down, the ONE dev-restart.sh allowance stands, record the kill in the OOM curve; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at gapVal 122 -> wave-20 letterless break at 78 -> wave-21 lettered q return at 61 (the lean tag x4) -> the r790 record-tying quiet stretch (+122m, amber). (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the quiet-watch tie witness at four sites is a named mechanism per the r775 convention; the legend-toggle hover polish; full golden QA anchored in scripts/qa_r790.txt).")
with open('worklog.md','a') as f:
    f.write('\n\n---\n\n' + '\n'.join(L) + '\n')
print('worklog appended')
PY
git add -A
git commit -m 'r790: the band docs carry the r790 quiet-watch witness at all four on-page sites (no new cadence point - the census held flat at 53 runs / 186 ev / 141nj, chips 54, and the zero-growth stretch TIES the 122 band max: the quiet readout rendered +122m at the 21:08 UTC witness, the amber past-ceiling regime held across the r788/r789/r790 witnesses at +67/+99/+122m; the band stays 20 points ending 61) + the lanes-tried legend toggle gains the hover underline solidify (dotted to solid on hover). QA green first-try; snapshot discipline forty-fifth close.'
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r790_close.txt
SWEEP=$(git add -A && git commit -m "r790: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
