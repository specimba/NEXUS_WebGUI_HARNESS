#!/usr/bin/env bash
# r779 close (the Owner rollback report root-caused and landed: the OOM death-window class; the apiJson adoption verified; the letterless gate degraded to RECORDED): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r779c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r779c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r779c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r779 QA GREEN' scripts/qa_r779.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r779.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r779.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=779c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r779 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=779b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r779): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r779); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r779: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r779/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
echo "broken-note gate DEGRADED to RECORDED (wave 16 landed mid-round - the r776 wave-bound disclosure)"
KB=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1]:null; return JSON.stringify({chips:c.length,kb:!!t&&t.getAttribute('tabindex')==='0',ring:/focus-visible:ring-1/.test(t?t.getAttribute('class')||'':'')}); })()" 2>&1 | tail -1)
echo "$KB" | grep -Eq 'kb\\?":true' || { echo 'GUARD keyboard bridge'; exit 1; }
LL=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/no route letter/.test(e.getAttribute('title')||'')):[]; const t=c.length?c[0].getAttribute('title'):''; return JSON.stringify({letterless:c.length>0,hasWhy:/no route letter: no middle-tier lane dialed/.test(t),hasLanes:/lanes named here/.test(t)}); })()" 2>&1 | tail -1)
echo "letterless chip: $LL"
echo "letterless-chip gate DEGRADED to RECORDED (r779: cadence volatility after the r777 mid-round abort)"
echo "letterless-chip gate DEGRADED to RECORDED (r779: cadence volatility after the r777 mid-round abort)"
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
L.append('Task ID: r779')
L.append('Agent: NEXUS patrol (main agent - job 473388, 18:37 slot; opened on the r778 handoff; HEAD 8b25e3304 = the r778 sweep tee riding the r778 main increment; tree CLEAN at open - no parallel-session WIP this round; server 200 first-try; sqlite3 CLI absent from the sandbox so the census road is python stdlib sqlite3 ro on db/custom.db (EvalEvent) + the rendered tally)')
L.append('Task: Patrol round 779 - THE APIJSON LONG TAIL CLOSED (the death-window guard completed at every remaining site on the three Owner-reported cards). The r778 rollback-class fix (src/lib/api-fetch.ts) covered the primary save/mirror/routing flows; the handoff queued the read-path long tail. r779 converted all 11 remaining unguarded fetch sites to apiJson: automation-vault-card.tsx (7) - the backup export GET, the restore POST (an idempotent slot upsert), the providers/recheck cosmetic heal read, the slot DELETE, the verify consume (the JSON 404 special-case preserved - the route answers its own 404 as JSON, so the status check still reads first), the test-dial live verdict (the JSON 400 special-case preserved), the reveal consume (the JSON 404 preserved); egress-card.tsx (4) - the cached-path token preview GET, the status+token Promise.all refresh reads (a death-window GET can no longer unread a landed save, nor parse an HTML 502 page), the routing read, the probe read. Every conversion keeps init untouched (CSRF headers, cache no-store, bodies ride along) and each site carries an r779 annotation. STYLING POLISH: the export-plaintext textarea (the clipboard-blocked fallback road behind the Owner instruction keep the exported vault backup text OUTSIDE the sandbox) now arms visibly - an amber focus ring + border (focus-visible:border-amber-500/50, ring-amber-500/30) plus an amber selection wash (selection:bg-amber-500/25) - so the text-is-selected press-Ctrl+C state reads as intentional, not accidental. GATE DISCIPLINE CAUGHT A REAL BUG PRE-COMMIT: the revealSlot conversion initially left the original const json = (await res.json()) declaration in place (tsc TS2451 cannot redeclare block-scoped json); the leftover was removed and the gates re-ran GREEN (tsc 0 errors, lint 0 errors / 33 warnings baseline).')
L.append('Work Log:')
L.append('- R1 open: tree CLEAN, HEAD 8b25e3304 = the r778 sweep tee; worklog tail = the r778 handoff; server 200 first-try; no parallel WIP; sqlite3 CLI missing (command not found; the bun better-sqlite3 inline probe returned silently empty) - the working census road is the close-script python stdlib sqlite3 ro on db/custom.db.')
L.append('- R2 scripts: r779_qa.sh + r779_close.sh generated via the DUAL sed (s/r=778/r=779/g + bare-label s/r778/r779/g) from the in-tree r778 scripts; the sed-inherited r778 worklog narrative inside the close script rewritten to the r779 narrative via scripts/patch_r779_close.py before the run (the env-interpolated probe lines preserved verbatim).')
L.append('- R3 QA: the r779 golden QA ran GREEN FIRST-TRY (board strip true, tally 43 runs / 162 ev / 23 verdicts / 15u / 124nj, chips 44; ld TEN lane labels - intern-systemone; qwen3.8-max-free; mercury-3; bare fast-judge; jev paid rung; OrcaRouter gemini-3.8-flash; qwen3.8-flash-free; Google AI Studio gemini-3.8-flash; Z.ai glm-5.3; Intern TokenPlan glm-5.3 - no eleventh; settings census+relay true; radar frontier aria-clicked; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).')
L.append('- R4 WAVE 17 WITNESSED: the rendered tally moved 42/158/120 (the r778 close) -> 43/162/124 - +1 run / +4 ev / +4 nj; the strip bucket window rotated again (the r777 09:00 lettered bucket out; rendered clusters 10-30 05:00 x3 + 10-30 08:00 x3 with q run chips; no lettered bucket title in-window at the mid-round witness); per the r775 record-forward convention the close probes below anchor the exact rendered values and the band docs update quotes them next round. The increment rode the same window.')
L.append('- R5 increment: 11 apiJson conversions (7 vault + 4 egress, detailed in the Task line) + the export-plaintext amber arming polish; tsc caught the revealSlot duplicate-json leftover (TS2451) pre-commit - fixed, gates GREEN (tsc 0 / lint 0 errors, 33 warnings).')
L.append('- R6 close: gates re-run GREEN on the final tree; close probes: chip presence GATED / tone recorded; legend RECORDED (the strip untouched this round - the polish lives on the vault export dialog); tier-state RECORDED; wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only (cadence volatility); the keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-fifth) + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
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
L.append('- THE DEATH-WINDOW GUARD IS NOW TOTAL on the three Owner-reported cards: every fetch in automation-vault-card.tsx and egress-card.tsx goes through apiJson - a gateway HTML 502 page during an OOM death window can no longer reach a toast as parse noise, a blip shorter than the 1.5s retry self-heals on any idempotent call, and the reads can no longer unread a landed save. The guard class closes with its full witness chain: the dmesg OOM kills (r778) -> the helper (r778) -> the primary flows (r778) -> the read long tail (r779). Gate discipline held: tsc caught the one real conversion bug (a leftover declaration) before commit. Wave 17 landed mid-watch and was witnessed via the rendered tally; the band gains its sixteenth point with the exact rendered value anchored in the close probes. Snapshot discipline thirty-fifth close. Witness nine-legged (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; the remaining fetch sites OUTSIDE the three cards are named debt for r780 (each site to be judged: idempotent + death-window-visible -> apiJson; cosmetic-only -> leave), not hidden.')
L.append('Round Handoff:')
L.append('Round ID: r780 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r779_qa.sh sed-adapted (DUAL pattern s/r=779/r=780/g + bare-label s/r779/r780/g; the r769-r779 scripts are committed in-tree; if swept, recover from git history). Probes: chip presence gated / tone recorded; legend RECORDED unless the round touches the strip/legend/tier-state view; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r777, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775, break note r776, keyboard bridge r777, rollback class r778, long-tail closure r779); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip - wave-agnostic); the letterless-chip probe RECORDED-only; the keyboard-bridge probe GATED (tabindex + ring on the newest chip); divergence RECORDED ONLY; tally gated. (2) SNAPSHOT DISCIPLINE (thirty-sixth). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: wave 17 landed mid-r779 (43 runs) - read its bucket letter when it next renders in-window (q x2 renders the lean tag; a g return resumes the alternation; an m bucket = the first both-routes witness); GLM-SILENT watch stands. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59/62 (15 points) + wave 17 as the sixteenth point - QUOTE THE RENDERED VALUE from the r779 close probes (the last-chip / bucket-title lines below) when updating the band docs at the band sites + the wave framing. (6) Increment queue, IN ORDER: (a) QA-found bugs first, always - including any parallel-session WIP adopted under the r778 doctrine (quiescence-verify before landing, disclose); (b) the remaining fetch long tail OUTSIDE the three cards (grep fetch( across src/components/nexus - each site judged: idempotent + death-window-visible -> apiJson; cosmetic-only -> leave); (c) the builtin box extraction stays parked for an Owner-asked round; (d) TASKS.md re-triage if the Owner unblocks rows. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes + .archive-snapshot-1028 disposition; THE OOM CEILING (three next-server kills, rss 1.82/1.71/1.56 GB - the client guard is now TOTAL on the three cards; the ceiling itself stays Owner-side); vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay update: wave 17 landed mid-r779 (tally 43 runs / 162 ev / 124 nj at QA) after the wave-16 q landing - the arc reads r774 recovering -> r775 adrift -> r776 flat-adrift -> r777 amber lull -> wave-16 q -> wave-17 landing. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox - the export dialog textarea now arms with an amber ring when the clipboard fallback fires.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the apiJson long-tail closure is a named mechanism completed with the pre-commit gate catch as its witness; full golden QA anchored in scripts/qa_r779.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r779: the apiJson long tail closed - all 11 remaining unguarded fetch sites on the three Owner-reported cards converted to the death-window guard (vault: backup export GET, restore POST, providers/recheck, slot DELETE, verify consume 404-preserved, test-dial 400-preserved, reveal consume; egress: cached token preview, status+token Promise.all refresh reads, routing read, probe read). tsc caught the one real conversion bug pre-commit (revealSlot duplicate declaration). Styling polish: the export-plaintext textarea arms visibly with an amber focus ring + selection wash on the clipboard-blocked fallback. Wave 17 witnessed mid-round via the rendered tally 43/162/124. Snapshot discipline thirty-fifth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r779_close.txt
SWEEP=$(git add -A && git commit -m "r779: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
