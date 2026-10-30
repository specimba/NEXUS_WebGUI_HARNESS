#!/usr/bin/env bash
# r775 close (waves 14+15 recorded: band /55/60 at four sites; per-chip max-to-max gap on the strip chips; ceiling re-look held at 62; transition-colors on the strip chips): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r775c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r775c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r775c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r775 QA GREEN' scripts/qa_r775.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r775.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r775.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=775c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r775 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=775b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r775): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r775); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r775: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
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
L.append('Task ID: r775')
L.append('Agent: NEXUS patrol (main agent - job 473388, 16:07 slot; opened on the r774 handoff; HEAD ffb9e4015 = the r774 sweep tee (r774 main 6e5693e94 landed in its own 15:07 slot); no cron-tagged commit after the r774 sweep (the r773-onward pattern - the tee artifact rides the next round); tree CLEAN at open (the r774 gateway-pulse drift was committed in its own round); no parallel round closed (the worklog tail handed off r775; git log showed no r775 commit))')
L.append('Task: Patrol round 775 - WAVES 14 AND 15 RECORDED FORWARD; THE CEILING RE-LOOK RUNS (the r770 three-point gate satisfied). The opening ro-SQL census: 155 ev / 41 runs / 23 verdicts (flat, third round after the two growths) / 15 uncertain (flat) / 117 nj (+3); the newest corpus row 08:10:35 UTC. The board witnesses: wave 14 = bucket 07:00 (x2 q, +55m since prior - the r774 close caught it mid-landing, r775 records it forward); wave 15 = bucket 08:00 (x3, LETTERLESS - the full tried list reads intern-systemone no-answer + mercury-3 no-answer + OrcaRouter gemini-3.8-flash no-answer + fast-judge relay-chain-exhausted + jev not-armed, NO middle-tier dial) at +60m since prior (bucket 07:00 to 08:00 maxes, 07:11:05 to 08:10:35 = 59.5m, rendered +60m) - band 13/16/41/58/13/42/62/57/61/70/6/73/55/60 (14 points); the letterless wave-15 BREAKS the q-lean x2 run (r767 semantics: a bucket without middle-tier rows breaks the run - the lean tag unrenders); the GLM-SILENT watch continues (no glm dial in any shown bucket); the letterless case is not the BOTH-SILENT lettered-bucket test (that carry stays cleared). THE RE-LOOK: post-burst points now four (6/73/55/60, mean 48.5m vs pre-burst mean 43.3m) - the cadence regime is compatible with the pre-burst track, the 62 ceiling is HELD, its one firing (the r774 mid-lull) true - verdict documented in the quiet title. Golden QA GREEN FIRST-TRY (tally 41/155/23/15/117, TEN lane labels - no eleventh, console 0 errors). Shipped: (a) per-chip interval on the strip - each corpus bucket chip hover now carries +Xm since prior (max-to-max), the exact r768 laneGap definition, so the whole cadence band is readable per-bucket on the strip instead of only the newest interval in the tier-state line; (b) the band docs carry /55/60 with wave-14 and wave-15 framing at the four band sites (interval span title, quiet span title, both tier-state band phrases); (c) the r775 re-look verdict (62 held) in the quiet title; (d) styling polish: transition-colors on the strip bucket chips (legend lane-chip parity, the r773 pattern).')
L.append('Work Log:')
L.append('- R1 open: parallel-session check clean (worklog tail handed off r775 - the r774 round closed in its own 15:07 slot with commits 6e5693e94 main + ffb9e4015 sweep tee; no cron-tagged commit after the sweep, the r773-onward pattern); tree CLEAN at open this time (the r774 gateway-pulse drift was committed in its own round); server 200 first-try.')
L.append('- R2 census: ro-SQL inline: 155/41/23/15/117 (+3 ev, +1 run, +3 nj vs the r774 close census 152/40/23/15/114 - verdicts flat), newest epoch 1793347835110 = 08:10:35 UTC (past wave 14 - a NEW wave landed before the round opened); the bucket-map query fixed the shape (08:00 x3 all at 08:10:35, 07:00 x2, 06:15 x2); r775_qa.sh + r775_close.sh generated via the DUAL sed from the in-tree r774 scripts + a bare-label sed for the echo headers.')
L.append('- R3 QA: the r775 golden QA ran GREEN FIRST-TRY (board strip true, tally 41 runs / 155 ev / 23 verdicts / 15u / 117nj, chips 42; ld all lanes with intern+fast+paid asserted, TEN labels, no eleventh; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).')
L.append('- R4 witnesses: the full-note read of the newest rows: wave 15 (08:00) tried list = intern-systemone (no answer) + mercury-3 (no answer) + OrcaRouter gemini-3.8-flash (no answer) + fast-judge (relay chain exhausted) + jev (not armed) - NO middle-tier lane: LETTERLESS, the lean run breaks; wave 14 (07:00) tried list confirmed q (qwen3.8-flash-free present, no glm). Gap math: 07:11:05 to 08:10:35 = 59.5m -> chip and tier-state render +60m (Math.round).')
L.append('- R5 increment (run-kanban.tsx, nine edits): the gap map in the waveStrip memo (prevKey walk over the same single dependency; Math.round of the bounds max-to-max delta); the chip-title gap fragment (+Xm since prior (max-to-max), corpus mode, hidden for a first-ever bucket); the four band strings /6/73 -> /6/73/55/60 with wave-14 and wave-15 framing (interval span title, quiet span title + the re-look verdict, both tier-state band phrases); transition-colors on the strip bucket chips.')
L.append('- R6 close: gates re-run on the increment tree (tsc 0 / lint 0 errors, 33 warnings baseline); close probes: chip presence GATED / tone recorded; legend GATED (the tier-state span edited this round); tier-state RECORDED (gap/quiet/quietAmber); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (the newest-chip probe EXTENDED this round: hasGap asserts the r775 max-to-max fragment on the newest chip; the letterless probe now reads the first of TWO in-window letterless chips, 05:00 and 08:00); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-first) + worklog + commit + dual push.')
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
L.append('- WAVES 14 AND 15 RECORDED FORWARD: band 13/16/41/58/13/42/62/57/61/70/6/73/55/60 (14 points); the post-burst band holds four points (6/73/55/60, mean 48.5m vs pre-burst 43.3m) - the r775 re-look runs at the three-plus gate and HOLDS the 62 ceiling (its one firing true); the letterless wave-15 broke the q-lean x2 run (the tag unrenders - r767 semantics witnessed working on-page); the GLM-SILENT watch deepens (no glm dial in any shown bucket); verdicts flat at 23; TEN lanes held. The per-chip gap feature makes the whole band readable on the strip (hover any bucket). Snapshot discipline thirty-first close. Witness nine-legged + the hasGap extension (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA green first-try (no bugs found); no new doc debt queued (the r773 letterless-title debt stays paid - the wave-15 letterless chip exercised the why-sentence live this round).')
L.append('Round Handoff:')
L.append('Round ID: r776 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r775_qa.sh sed-adapted (DUAL pattern s/r=775/r=776/g; the r769-r775 scripts are committed in-tree; if swept, recover from git history); surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r775, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts on the newest chip + hasGap on the newest chip (r775, wave-agnostic - the assertion survives newer waves) + the letterless chip in-window (the wave-15 08:00 bucket is newest, so it stays in-window for rounds to come)); divergence RECORDED ONLY; tally gated. (2) SNAPSHOT DISCIPLINE (thirty-second). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the lean run RESTARTED after the wave-15 break - the next lettered bucket starts a fresh run (q x1 = no tag, x2 renders the tag; a g return resumes the alternation; an m bucket = the first both-routes witness). GLM-SILENT WATCH: no glm dial in any shown bucket - if the next lettered bucket is again q with no glm, the standing-laggard reading firms up (r759 semantics: check the laggard lanes before interpreting); BOTH-SILENT lettered-bucket test still cleared (the letterless wave is not a lettered bucket). (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/60 - the 62 ceiling RE-LOOKED and HELD at r775 (four post-burst points, mean 48.5m vs pre-burst 43.3m - the regime is compatible); wave 16 = the next interval point, recorded forward by the round that witnesses it; the per-chip gap makes the band self-documenting (hover any bucket). (6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay update for the report: wave 14 = q at +55m (qwen back), wave 15 = LETTERLESS at +60m (no qwen AND no glm dial - the free pair unpicked), verdicts flat 23, glm silent across the window - the relay reads IDLE-ADRIFT again after the r774 recovering read: the platform report should carry BOTH states. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held twice (the wave-14/15 intervals recorded forward into the on-page band docs - a named mechanism updated with witnessed data; AND the r770-gated ceiling re-look - a named evaluation run at its stated gate; the per-chip gap feature is gated-witnessed in scripts/qa_r775_close.txt; full golden QA anchored in scripts/qa_r775.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r775: waves 14 and 15 recorded forward - band 13/16/41/58/13/42/62/57/61/70/6/73/55/60 (wave 14 = 07:00 q at +55m; wave 15 = 08:00 LETTERLESS at +60m, no middle-tier dial - the q-lean x2 run breaks per r767); the r770-gated ceiling re-look runs at four post-burst points (6/73/55/60, mean 48.5m vs pre-burst 43.3m) and HOLDS the 62 ceiling (its one firing true) - verdict in the quiet title. Increment: per-chip +Xm since prior (max-to-max) on the strip bucket hovers - the whole cadence band readable per-bucket on-page; the four band sites carry /55/60 with wave framing. Styling polish: transition-colors on the strip bucket chips (legend parity). Snapshot discipline thirty-first close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r775_close.txt
SWEEP=$(git add -A && git commit -m "r775: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
