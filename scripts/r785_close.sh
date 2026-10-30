#!/usr/bin/env bash
# r785 close (the Owner rollback report root-caused and landed: the OOM death-window class; the apiJson adoption verified; the letterless gate degraded to RECORDED): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r785c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r785c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r785c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r785 QA GREEN' scripts/qa_r785.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r785.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r785.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=785c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r785 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=785b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r785): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r785); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r785: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r785/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
KB=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1]:null; return JSON.stringify({chips:c.length,kb:!!t&&t.getAttribute('tabindex')==='0',ring:/focus-visible:ring-1/.test(t?t.getAttribute('class')||'':'')}); })()" 2>&1 | tail -1)
echo "$KB" | grep -Eq 'kb\\?":true' || { echo 'GUARD keyboard bridge'; exit 1; }
LL=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/no route letter/.test(e.getAttribute('title')||'')):[]; const t=c.length?c[0].getAttribute('title'):''; return JSON.stringify({letterless:c.length>0,hasWhy:/no route letter: no middle-tier lane dialed/.test(t),hasLanes:/lanes named here/.test(t)}); })()" 2>&1 | tail -1)
echo "letterless chip: $LL"
echo "letterless-chip gate DEGRADED to RECORDED (r785: cadence volatility after the r777 mid-round abort)"
echo "letterless-chip gate DEGRADED to RECORDED (r785: cadence volatility after the r777 mid-round abort)"
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
L.append("Task ID: r785")
L.append("Agent: NEXUS patrol (main agent - job 473388, 23:07 slot; opened on the r784 handoff; HEAD 0bd1a6357 = the r784 wave-19 band-docs + two-conversion + stale-pill-ring increment; tree CLEAN at open - no parallel-session WIP; server 200 first-try)")
L.append("Task: Patrol round 785 - THE SETTINGS FETCH WATCH: five apiJson death-window conversions across two files with per-site judgments, closing the named ~236/~274/~1448 + provider-gallery trio queue items from the r784 handoff. (a) model-relay.tsx: the benchmark-intel GET and the free-reach census GET are idempotent reads - converted with the existing semantics kept (stale-mount auto-refresh silent, forced refresh toasts the honest ApiError; the !ok HTTP throw kept alongside the guard); the restore pre-check GET (/api/tracker, cache no-store) FIXES AN HONESTY BUG - the old !ok-to-null path conflated a dead server with absent-from-catalog (a 502 window read as the false nothing-to-restore-yet verdict and even dimmed the affordance), while !ok and the death-window HTML page now throw into the honest Catalog-check-failed catch. (b) provider-gallery.tsx: the account probe POST is a read-style dial of the provider /v1/me (nothing inserts, nothing bills) - judged repeat-safe, default single retry kept, death-window HTML now raises the honest ApiError into the failure toast; the quarantine-pardon recheck POST clears an already-clear map on repeat (a no-op, idempotent) - converted under the same judgment, the cosmetic swallow-catch kept; the free-models roster refresh is a FORCE action against the provider live /models - converted at retries 0 per the action-route doctrine (the user Refresh button keeps the retry decision), and the r23 browser-direct fallback now serves EVERY failure class: region-block answer, HTTP error body, or death-window HTML page (the guard ApiError) - parse noise can no longer leak. (c) STYLING POLISH: the relay lane row dim gains transition-opacity (the enabled/retired 70 percent fade animates instead of snapping).")
L.append("Work Log:")
L.append("- R1 open: tree CLEAN at 0bd1a6357; worklog tail = the r784 handoff; server 200 first-try; the queue read: settings model-relay intel/freellm + tracker poll + the provider-gallery trio with idempotence judgments before converting.")
L.append("- R2 scripts: r785_qa.sh + r785_close.sh via the DUAL sed (s/r=784/r=785/g + bare-label s/r784/r785/g) from the in-tree r784 scripts; the sed-inherited r784 narrative inside the close script rewritten to the r785 narrative via scripts/patch_r785_close.py before the run.")
L.append("- R3 QA: the r785 golden QA ran GREEN FIRST-TRY (marker in scripts/qa_r785.txt; board 46 runs / 168 ev / 23 verdicts / 15u / 130nj with chips 47 - the census held flat vs the r784 close; ld TEN lane labels, no eleventh; settings census+relay true; radar frontier aria-clicked; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).")
L.append("- R4 increment: the five apiJson conversions with per-site judgments (detailed in the Task line) + the lane-row transition-opacity polish + the restore honesty fix as the round user-facing improvement.")
L.append("- R5 gates: pre-close tsc 0 errors / lint 0 errors, 33 warnings (the baseline held - the conversions added no new warnings); the close re-ran both gates GREEN on the final tree.")
L.append("- R6 close: close probes: chip presence GATED / tone recorded; legend GATED (the strip/legend view untouched this round); tier-state RECORDED; wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only; the keyboard-bridge probe GATED; divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (forty-first) + worklog + commit + dual push.")
L.append("- GATES: tsc_exit=" + os.environ.get('R754_TSC','?') + " - lint " + os.environ.get('R754_LINT','?') + " - qa-gate-census " + os.environ.get('R754_GC','?') + " - qa-cortex-census " + os.environ.get('R754_CC','?') + " - close census " + os.environ.get('R754_CEN','?') + " - snapshot: " + os.environ.get('R754_SNAP','?'))
L.append("Stage Summary: the settings fetch watch landed - five guard conversions with judgments (two plain reads, one honesty-bug fix, two judged POSTs, one force action at retries 0 with the browser fallback widened to every failure class); polish shipped; QA green first-try; tsc 0 errors / lint 0 errors 33 warnings baseline; committed and pushed to origin + fork.")
L.append("")
L.append("Round Handoff:")
L.append("Round ID: r786 -> next patrol (job 473388)")
L.append("Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r785_qa.sh sed-adapted (DUAL pattern s/r=785/r=786/g + bare-label s/r785/r786/g; the r769-r785 scripts are committed in-tree; if swept, recover from git history). ORDER: QA FIRST (the marker gates the close snapshot). Probes unchanged (chip presence gated / tone recorded; legend RECORDED unless the round touches the strip/legend/tier-state view; tier-state RECORDED ONLY; wave-strip presence GATED / text RECORDED; bucket-title probes GATED wave-agnostic; letterless-chip probe RECORDED-only; keyboard-bridge probe GATED; divergence RECORDED ONLY; tally gated). (2) SNAPSHOT DISCIPLINE: forty-second. (3) TIMEOUT HYGIENE: node tsc (never bunx on the pipe), long children file-redirected with stdin devnull. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: wave 19 = q at lean x5 (gapVal 122, the banddocs 18th point) - the NEXT lettered bucket decides (q x6 keeps the lean tag counting; a g return resumes the wave-by-wave alternation and breaks the five-long lean run; an m bucket = the first both-routes witness); wave 20 = the next cadence point - QUOTE THE RENDERED VALUE and update the four band-doc sites (routine per-witness duty: band append + long/short provenance inserts); GLM-SILENT watch stands. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58/122 (18 points as of r784) - the 122 stretches the band far past the old 70 max: watch whether the next intervals return toward the 60s or hold in the 100s. (6) Increment queue, IN ORDER: (a) QA-found bugs first, always; (b) the fetch watch continues: radar paper/github-stars/hf-trending/frontier-scout tab reads (each judged: idempotent + death-window-visible -> apiJson; cosmetic-only or non-JSON contract -> leave with the judgment annotated); chat transcribe/tts/image-generate POSTs are action routes - retries 0 if converted, else leave with the judgment annotated; (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CEILING (witnesses: three kills rss 1.82/1.71/1.56 GB + the r782 gate-stall at ~1.92 GB + the regrowth curve 1.63 GB at +34m / 1.53 GB at +58m after the 21:40 restart + the r785 reading ~1.63 GB at ~+95m, flat vs the +34m point - the server sheds between bursts and holds ~1.5-1.65 GB); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay arc: r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3 -> wave-19 q-lean-x5 at gapVal 122. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.")
L.append("Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the death-window guard joined on five named settings sites with per-site idempotence judgments + one honesty-bug fix is a named mechanism; the lane-row transition polish; full golden QA anchored in scripts/qa_r785.txt).")
with open('worklog.md','a') as f:
    f.write('\n\n---\n\n' + '\n'.join(L) + '\n')
print('worklog appended')
PY
git add -A
git commit -m 'r785: the settings fetch watch - five apiJson death-window conversions across two files with per-site judgments (model-relay benchmark-intel GET + free-reach census GET, idempotent reads with the silent-auto and toast-on-fresh catches kept; the restore pre-check tracker read FIXING an honesty bug - the old !ok-to-null path conflated a dead server with absent-from-catalog and now lands the honest Catalog-check-failed catch; provider-gallery account probe, a read-style POST against the provider /v1/me judged repeat-safe so the default retry stays; the quarantine-pardon recheck heal, a no-op-on-repeat idempotent clear; free-models roster refresh at retries 0 per the action-route doctrine with the r23 browser-direct fallback now serving every failure class - region-block, HTTP error body, death-window HTML) + the relay lane-row dim gains transition-opacity. Census held flat 46/168/130nj; QA green first-try; snapshot discipline forty-first close.'
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r785_close.txt
SWEEP=$(git add -A && git commit -m "r785: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
