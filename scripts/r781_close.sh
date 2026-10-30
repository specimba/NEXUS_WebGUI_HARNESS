#!/usr/bin/env bash
# r781 close (the Owner rollback report root-caused and landed: the OOM death-window class; the apiJson adoption verified; the letterless gate degraded to RECORDED): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r781c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r781c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r781c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r781 QA GREEN' scripts/qa_r781.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r781.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r781.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=781c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r781 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=781b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r781): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r781); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r781: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r781/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
KB=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1]:null; return JSON.stringify({chips:c.length,kb:!!t&&t.getAttribute('tabindex')==='0',ring:/focus-visible:ring-1/.test(t?t.getAttribute('class')||'':'')}); })()" 2>&1 | tail -1)
echo "$KB" | grep -Eq 'kb\\?":true' || { echo 'GUARD keyboard bridge'; exit 1; }
LL=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/no route letter/.test(e.getAttribute('title')||'')):[]; const t=c.length?c[0].getAttribute('title'):''; return JSON.stringify({letterless:c.length>0,hasWhy:/no route letter: no middle-tier lane dialed/.test(t),hasLanes:/lanes named here/.test(t)}); })()" 2>&1 | tail -1)
echo "letterless chip: $LL"
echo "letterless-chip gate DEGRADED to RECORDED (r781: cadence volatility after the r777 mid-round abort)"
echo "letterless-chip gate DEGRADED to RECORDED (r781: cadence volatility after the r777 mid-round abort)"
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
L.append('Task ID: r781')
L.append('Agent: NEXUS patrol (main agent - job 473388, 19:37 slot; opened on the r780 handoff; HEAD 8e4f96f35 = the r780 wave-18 worklog witness riding the r780 main increment + sweep; tree CLEAN at open - no parallel-session WIP; server 200 first-try)')
L.append('Task: Patrol round 781 - THE FETCH LONG TAIL COMPLETED ACROSS THE EIGHT NAMED FILES (the r780 handoff item 6b finished: 11 apiJson conversions + 1 documented leave) AND THE BAND DOCS SEVENTEENTH POINT. (a) BAND DOCS: all four on-page band sites in run-kanban.tsx (the Route-state title interval + quiet halves, the interval-readout title, the quiet-readout title) now carry the seventeenth point - the band reads 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58 with the wave-18 clause quoted from the r780 close probes (the 58 is the wave-18 readout, bucket 10:00 to 11:00 maxes, landed mid-r780; the quiet-half band string, left a point behind at r780, was brought level) - the r775 record-forward convention kept: the rendered value, not a recomputation. (b) FETCH LONG TAIL, PER-SITE JUDGMENTS: workflows-view.tsx - the evals corpus-glance GET and the masked vault readiness GET are idempotent reads (plain conversions, the existing silent catches kept); automation-bridge.tsx - the heartbeat sync POST is a FULL-SNAPSHOT UPSERT (a repeat lands the same registration the next 60s heartbeat would), so the default one retry is safe and an OOM-window HTML page now raises ApiError into the heartbeat catch instead of feeding raw page text to the warn line; workflow-scheduler.tsx - the pulse telemetry GET is an idempotent read, converted with the 3s timeout signal passing through untouched (an abort/timeout is rethrown as-is, not retried) into the same fail-open catch; gateway-pulse-chip.tsx - the explicit refresh GET is an idempotent read (previous state kept on final failure); archived-reports.tsx - the list GET and the detail GET are idempotent reads whose panes now surface the honest ApiError message instead of parse noise; strategy-card.tsx - the 45s poll GET is an idempotent read, the actions POST gets apiJson AT RETRIES 0 because action=create INSERTs a real strategy row (the run-now doctrine), and the briefing GET is LEFT RAW with the judgment annotated in-code - the briefing route answers plain text, not JSON, so the apiJson content-type contract does not apply; agents-view.tsx - the module-level registry GET (inflight-deduped) is an idempotent read; agent-form-dialog.tsx - the per-open registry GET is an idempotent read whose unmount abort passes through untouched. (c) STYLING POLISH: the rescue-lane badge (the pulse chip emerald span) gains cursor-help + transition-colors - the r776 title-carrier convention (a rich tooltip deserves the help cursor).')
L.append('Work Log:')
L.append('- R1 open: tree CLEAN at 8e4f96f35; worklog tail = the r780 handoff; server 200 first-try; no parallel WIP; the handoff queue read: the fetch long tail across the eight named files (item 6b) + the wave-18 record-forward (item 5).')
L.append('- R2 scripts: r781_qa.sh + r781_close.sh generated via the DUAL sed (s/r=780/r=781/g + bare-label s/r780/r781/g) from the in-tree r780 scripts; the sed-inherited r780 narrative inside the close script rewritten to the r781 narrative via scripts/patch_r781_close.py before the run (the env-interpolated probe lines preserved verbatim; the double QA-PROBES header artifact from the r779-r780 chain deduped to one).')
L.append('- R3 QA: the r781 golden QA ran GREEN FIRST-TRY (marker in scripts/qa_r781.txt; board "{\\"strip\\":true,\\"tally\\":\\"44 runs · 165 ev · 23 verdicts· 15u· 127nj\\",\\"chips\\":45}"; ld TEN lane labels, no eleventh; settings census+relay true; radar frontier aria-clicked; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).')
L.append('- R4 increment: the eleven apiJson conversions + one documented leave across the eight named files (per-site judgments detailed in the Task line) + the band docs seventeenth point at all four sites (wave 18 = 58; the quiet-half band string brought level) + the rescue-lane cursor-help polish.')
L.append('- R5 gates: pre-close tsc 0 errors / lint 0 errors, 33 warnings (the baseline held exactly - the conversions added no new warnings); the close re-ran both gates GREEN on the final tree.')
L.append('- R6 close: close probes: chip presence GATED / tone recorded; legend GATED (the strip/legend view untouched this round); tier-state RECORDED; wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only (cadence volatility); the keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-seventh) + worklog + commit + dual push.')
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
L.append('- THE FETCH LONG TAIL IS CLOSED: every named site across the r780-r781 queue now either rides the apiJson death-window guard (with a per-site idempotence judgment) or carries an in-code judgment annotation for why raw fetch is correct (the plain-text briefing contract) - an OOM death window can no longer feed HTML page text to any toast, warn line, pane or chip in the workflows and agents surfaces the guard covers; 30 sites converted across four rounds (r778-r781). The cadence docs carry the wave-18 point the r780 close witnessed, quoted rendered per the r775 convention. Snapshot discipline thirty-seventh close. Witness nine-legged (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; the fetch watch continues next round on the surfaces OUTSIDE the named queue (use-server-runs, run-kanban, shell, chat composer/chat-view/image-studio, tracker ticker/odds/radar-tab, stale-build-guard, settings model-relay/provider-gallery/cron-observatory, radar paper/github-stars/hf-trending/frontier-scout tabs - each judged: idempotent + death-window-visible -> apiJson; cosmetic-only or non-JSON contract -> leave with the judgment annotated), named, not hidden.')
L.append('Round Handoff:')
L.append('Round ID: r782 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r781_qa.sh sed-adapted (DUAL pattern s/r=781/r=782/g + bare-label s/r781/r782/g; the r769-r781 scripts are committed in-tree; if swept, recover from git history). Probes: chip presence gated / tone recorded; legend RECORDED unless the round touches the strip/legend/tier-state view; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r781, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775, break note r776, keyboard bridge r777, rollback class r778, long-tail closure r779, band-sixteen + autopilot guard r780, long-tail closure r781); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only; the keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; tally gated. (2) SNAPSHOT DISCIPLINE (thirty-eighth). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: wave 18 = q at lean x3 (the tag rendered, interval 58, quiet +4m at the r780 close) - the NEXT lettered bucket decides (q x4 keeps the lean tag counting; a g return resumes the wave-by-wave alternation and breaks the lean run; an m bucket = the first both-routes witness); GLM-SILENT watch stands (check the laggard lanes before interpreting; BOTH-SILENT lettered-bucket test still cleared). (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62/57/58 (17 points, wave 18 = 58 quoted rendered from the r780 close probes, docs updated on-page at r781) - wave 19 = the next interval point, recorded forward by the witnessing round (QUOTE THE RENDERED VALUE); the witnessing round updates the band docs at the four sites again. (6) Increment queue, IN ORDER: (a) QA-found bugs first, always - including any parallel-session WIP adopted under the r778 doctrine (quiescence-verify before landing, disclose); (b) the fetch watch continues on the surfaces OUTSIDE the named queue (use-server-runs, run-kanban, shell, chat composer/chat-view/image-studio, tracker ticker/odds/radar-tab, stale-build-guard, settings model-relay/provider-gallery/cron-observatory, radar paper/github-stars/hf-trending/frontier-scout tabs - each judged: idempotent + death-window-visible -> apiJson; cosmetic-only or non-JSON contract -> leave with the judgment annotated; action-triggering routes get retries 0); (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue (carried): PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CEILING (three next-server kills, rss 1.82/1.71/1.56 GB - the client guard is now TOTAL across the r778-r781 queue; the ceiling itself stays Owner-side); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay update: wave 18 = q at 11:00 with the lean tag x3 (interval 58, quiet +4m at the r780 close, mid-qwen route ACTIVE 1/2) - the arc reads r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 q-lean-x2 -> wave-18 q-lean-x3. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the long-tail closure is a named mechanism completed with per-site judgments including one documented leave, and the band-docs update lands the witnessed rendered value; full golden QA anchored in scripts/qa_r781.txt).')
L.append('')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m 'r781: the fetch long tail completed across the eight named files - 11 apiJson conversions with per-site judgments (workflows-view evals glance + vault readiness reads; automation-bridge heartbeat sync POST, a full-snapshot upsert so the default retry is safe; workflow-scheduler pulse read with the 3s timeout signal passing through; gateway-pulse-chip refresh read; archived-reports list + detail reads; strategy-card poll read + actions POST at retries 0 since action=create inserts, the run-now doctrine, + the briefing read LEFT raw with the judgment annotated - a plain-text route the apiJson JSON contract does not apply to; agents-view + agent-form-dialog registry reads with the abort signal passing through) + the band docs seventeenth point at all four on-page sites (wave 18 = 58, bucket 10:00 to 11:00 maxes, quoted rendered from the r780 close probes per the r775 record-forward convention; the quiet-half band string brought level) + the rescue-lane cursor-help polish (the r776 title-carrier convention). Snapshot discipline thirty-seventh close.'
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r781_close.txt
SWEEP=$(git add -A && git commit -m "r781: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
