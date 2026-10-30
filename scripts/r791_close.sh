#!/usr/bin/env bash
# r791 close (the Owner rollback report root-caused and landed: the OOM death-window class; the apiJson adoption verified; the letterless gate degraded to RECORDED): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 node node_modules/typescript/lib/tsc.js --noEmit > scripts/.tsc_r791c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r791c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r791c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r791 QA GREEN' scripts/qa_r791.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r791.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r791.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=791c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r791 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=791b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r791): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r791); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r791: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r791/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
KB=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1]:null; return JSON.stringify({chips:c.length,kb:!!t&&t.getAttribute('tabindex')==='0',ring:/focus-visible:ring-1/.test(t?t.getAttribute('class')||'':'')}); })()" 2>&1 | tail -1)
echo "$KB" | grep -Eq 'kb\\?":true' || { echo 'GUARD keyboard bridge'; exit 1; }
LL=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/no route letter/.test(e.getAttribute('title')||'')):[]; const t=c.length?c[0].getAttribute('title'):''; return JSON.stringify({letterless:c.length>0,hasWhy:/no route letter: no middle-tier lane dialed/.test(t),hasLanes:/lanes named here/.test(t)}); })()" 2>&1 | tail -1)
echo "letterless chip: $LL"
echo "letterless-chip gate DEGRADED to RECORDED (r791: cadence volatility after the r777 mid-round abort)"
echo "letterless-chip gate DEGRADED to RECORDED (r791: cadence volatility after the r777 mid-round abort)"
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
L.append("Task ID: r791")
L.append("Agent: NEXUS patrol (main agent - job 473388, 06:37 slot; opened on the r790 handoff; HEAD df43b934b = the r790 sweep artifact atop 715b6565f; tree NOT clean at open - the r791 round arrived as mid-flight WIP from a prior session that died before gates/close: the six-file increment diff, the golden-QA marker already GREEN in scripts/qa_r791.txt, and the untracked r791 scripts + mem-guard.sh were audited line-by-line, adopted and completed; server 200 first-try, no restart needed; opening witness: next-server rss ~1.93 GB hovering at the stall mark)")
L.append("Task: Patrol round 791 - THE OWNER BUG ROUND: the Owner reported (a) the React duplicate-key console error (two children with the same key `exa`) and (b) the Chrome page-unresponsive freeze cycle (~20 minutes per occurrence, the recovery refresh risking a sandbox wipe) and asked for a RAM/efficiency deep dive. (a) EXA FIX: exa lived in BOTH provider registries - the FREE_PROVIDERS spread (browser-key providers) and the acquisition-registry candidates - so with a browser exa key saved and no exa slot yet, the vault mirror strip rendered two children keyed exa; fixed with the !providerById(p.id) guard on the acquisition candidates (the two sources are now provably disjoint; registry-only ids brightdata/webshare kept). (b) THE FREEZE WATCH, two halves: CLIENT - the .cv-auto class (content-visibility: auto + contain-intrinsic-size: auto 260px) on the Frontier / GitHub Stars / Papers card grids so offscreen cards skip layout+paint (the DOM stays complete, census/probe queries unaffected); SERVER - scripts/mem-guard.sh, the pre-OOM graceful-restart watchdog (RSS threshold 1.70 GB fires the canonical dev-restart.sh BEFORE the kernel killer, dead-server revive after two failed health probes, 300s cooldown, 120s probe cadence, flock single-instance, log bounded at 400 lines). (c) THE QUIET-PASS WITNESS per the r790 handoff duty: no new bucket by the 22:34 UTC witness and the quiet rendered +208m - PAST the 122 band max, the longest zero-growth stretch on record (the genuine cadence break) - recorded at all four on-page sites (route-state title interval + quiet halves, interval-readout title, quiet-readout title); the amber past-ceiling regime four witnesses deep (+67/+99/+122/+208m).")
L.append("Work Log:")
L.append("- R1 open + adoption audit: the r790 handoff items (1)-(5) were found PART-EXECUTED by the prior session - the DUAL-sed r791 scripts in place, the golden QA already run GREEN (marker scripts/qa_r791.txt: board 56 runs / 200 ev / 35 verdicts / 24u / 141nj, chips 57 - the census GREW 3 runs / 14 rows into older slots; the ld witness held the TEN-lane baseline, no eleventh; paste 799; cron 1/1; console 0 errors, page errors none); the increment diff (the exa guard + cv-auto x3 + the four-site quiet-pass witness) was reviewed line-by-line and adopted; no source changes needed this session.")
L.append("- R2 witness: the r791 pass judged per the r790 handoff item (4) - NO new bucket landed (the newest chip still bucket 10-30 19:00 UTC / gapVal 61) and the quiet readout rendered +208m at the 22:34 UTC witness: the band-append duty and the quiet-pass duty are mutually exclusive, the QUIET PASS is the live one (past 122 = the longest stretch on record, the genuine cadence break); the same-round census growth (3 runs / 14 rows) went into older slots without moving the newest bucket - the quiet counts only the newest bucket newest row, disclosed on-page.")
L.append("- R3 exa-fix verification live: the settings probe found the vault card + mirror strip mounted, ZERO exa duplicate entries (exaButtons 0), the registry-only acquisition candidate kept (acqButtons 1), and 0 same-key occurrences in console and page errors - the Owner-reported console error is gone at the registry-disjointness level (providerById imported at automation-vault-card.tsx:51, tsc clean).")
L.append("- R4 gates on the adopted tree: node tsc 0 + lint 0 errors (33 warnings baseline) FIRST-TRY, file-redirected with stdin devnull (never bunx tsc on the pipe); the close re-ran both gates on the final tree - see the GATES line.")
L.append("- R5 close: the close script sed-inherited narrative was rewritten by scripts/patch_r791_close.py (the stale r790 story replaced with the true r791 record; the commit line prefix-filtered on the r791 message marker then replaced); close probes: chip presence GATED / tone recorded; tier-state RECORDED; wave-strip presence GATED; the bucket-title probes GATED; letterless RECORDED-only; keyboard-bridge GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-sixth) + worklog + commit + dual push. AFTER the close: mem-guard.sh launched session-detached (setsid nohup, flock single-instance) - deliberately AFTER the probes because the opening rss ~1.93 GB sits above its 1.70 GB threshold, so its first 120s probe gracefully restarts the server and resets the curve; the guard does NOT survive sandbox recycles - every patrol open must relaunch it until the Owner side adopts it (handoff item 2).")
L.append("- GATES: tsc_exit=" + os.environ.get('R754_TSC','?') + " - lint " + os.environ.get('R754_LINT','?') + " - qa-gate-census " + os.environ.get('R754_GC','?') + " - qa-cortex-census " + os.environ.get('R754_CC','?') + " - close census " + os.environ.get('R754_CEN','?') + " - snapshot: " + os.environ.get('R754_SNAP','?'))
L.append("Stage Summary: the Owner duplicate-key error is fixed at the registry-disjointness level and verified live (0 exa duplicates, 0 same-key console entries); the freeze watch ships both halves (cv-auto client + mem-guard server, the guard launched post-close and its graceful restart expected within minutes); the quiet-pass witness (+208m, past the 122 max, the genuine cadence break) is on-page at four sites with the amber series; QA green (adopted mid-flight marker) + gates first-try; committed and pushed to origin + fork.")
L.append("")
L.append("Round Handoff:")
L.append("Round ID: r792 -> next patrol (job 473388)")
L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r791_qa.sh sed-adapted (DUAL pattern s/r=791/r=792/g + bare-label s/r791/r792/g; the r769-r791 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot; the r786 slip is the standing lesson). (2) MEM-GUARD WATCH (NEW - the r791 mitigation is LIVE): at open read scripts/mem-guard.log - if the guard restarted the server, record the fresh-rss line in the OOM curve and treat that restart as the round dev-restart allowance SPENT (no second restart); RELAUNCH if not running: setsid nohup bash scripts/mem-guard.sh </dev/null >/dev/null 2>&1 & (it does not survive sandbox recycles); never rely on it mid-round before server probes - its 120s probe can restart the server under them; launch at open BEFORE probes only if the log shows a healthy cool-down, otherwise AFTER the close. Threshold 1.70 GB, 300s cooldown, flock single-instance. (3) SNAPSHOT DISCIPLINE: forty-seventh. (4) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (5) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the r791 QUIET PASS fired (+208m past the 122 max, the genuine cadence break) - the NEXT bucket to land is band point 21: quote the rendered gapVal at the four sites per the band-append duty (provenance convention: the r791 close record carries the quiet-pass context; dual-provenance wording if the r792 close re-witnesses the same bucket); the quiet resets when the bucket lands; the band append and the quiet pass stay mutually exclusive per round. (6) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122/78/61 (20 points as of r791 - the quiet pass is NOT a band point; the next LANDING is point 21) - a 100+ gapVal after the break confirms the regime shift, a 60s return holds the old regime. (7) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the freeze-watch follow-ups if the Owner still sees stalls (candidates: virtualize the board chips, cap the corpus strip shown window); (c) small verifiable polish/honesty increments; the P1 backlog rows stay Owner-blocked; (d) TASKS.md re-triage if the Owner unblocks rows. (8) CORTEX P1: the app-side two-paste carrier shipped r787 - the deploy now waits on the Owner source paste; record the edge version + lane matrix if the Owner reports the probe state. (9) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CURVE - the mem-guard mitigation is live (threshold 1.70 GB, graceful restart before the kernel killer); the historical witnesses stand (kills 1.82/1.71/1.56 GB, the ~1.92 GB stall, the regrowth to ~2.05 GB at +423m, ~1.93 GB at the r791 open); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at 122 -> wave-20 letterless at 78 -> wave-21 lettered q at 61 -> the r791 quiet pass (+208m, the genuine cadence break). (10) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the exa registry-disjointness fix is a named bug fix closed against the Owner console report; the mem-guard watchdog is a named mechanism; the quiet-pass witness at four sites; full golden QA anchored in scripts/qa_r791.txt).")
with open('worklog.md','a') as f:
    f.write('\n\n---\n\n' + '\n'.join(L) + '\n')
print('worklog appended')
PY
git add -A
git commit -m 'r791: THE OWNER BUG ROUND - the exa duplicate-key fix (exa lived in BOTH the FREE_PROVIDERS spread and the acquisition-registry candidates; with a browser exa key saved and no exa slot yet the vault mirror strip rendered two children with the same key exa - the !providerById guard makes the two candidate sources provably disjoint, registry-only ids brightdata/webshare kept) + the freeze watch in two halves (client: the cv-auto class, content-visibility auto + contain-intrinsic-size, on the Frontier / GitHub Stars / Papers card grids so offscreen cards skip layout+paint while the DOM stays complete for probes; server: scripts/mem-guard.sh the pre-OOM graceful-restart watchdog - RSS threshold 1.70 GB fires the canonical dev-restart.sh BEFORE the kernel killer, dead-server revive after two failed probes, 300s cooldown, flock single-instance, launched session-detached after the close) + the r791 quiet-pass witness at the four on-page sites (no new bucket by the 22:34 UTC witness, the quiet rendered +208m - PAST the 122 band max, the longest zero-growth stretch on record, the genuine cadence break, the amber past-ceiling regime four witnesses deep +67/+99/+122/+208m). QA green (adopted mid-flight marker) + gates first-try (tsc 0, lint 0 errors / 33 warnings); snapshot discipline forty-sixth close.'
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r791_close.txt
SWEEP=$(git add -A && git commit -m "r791: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
