#!/usr/bin/env bash
# r776 close (the lean-run break witnessed on-page: the r776 break note gated; flat census as a cadence datum; transition-colors on the route-letter spans): gates
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r776c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r776c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r776c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r776 QA GREEN' scripts/qa_r776.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r776.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r776.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=776c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r776 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=776b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r776): RECORDED ONLY - the line carries the lean tag (r767), the interval readout (r768), the quiet readout (r769) and the amber burst-end tone (r776); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); const q=[...p.querySelectorAll('span')].find(x=>/m quiet/.test(x.textContent||'')); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120), quietSpan:q?q.className.slice(0,60):'missing', quietAmber:!!(q&&/amber/.test(q.className))}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# r776: bucket-title probes - the r773 named-lane feature GATED (counts on the newest chip) + the letterless chip witness GATED (found anywhere in the shown window).
LT=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); const c=s?[...s.querySelectorAll('span[title]')].filter(e=>/^Bucket /.test(e.getAttribute('title')||'')):[]; const t=c.length?c[c.length-1].getAttribute('title'):''; return JSON.stringify({chips:c.length,hasLanes:/lanes named here/.test(t),hasCounts:/×\d+/.test(t),hasGap:/since prior \(max-to-max\)/.test(t),gapVal:(t.match(/\+(\d+)m since prior/)||[])[1]||'',tail:t.slice(-130)}); })()" 2>&1 | tail -1)
echo "last chip: $LT"
echo "$LT" | grep -Eq 'hasLanes\\?":true' || { echo 'GUARD lanes named'; exit 1; }
echo "$LT" | grep -Eq 'hasCounts\\?":true' || { echo 'GUARD lane counts'; exit 1; }
echo "$LT" | grep -Eq 'hasGap\\?":true' || { echo 'GUARD chip gap'; exit 1; }
BR=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-tier-state\"]'); if(!p) return JSON.stringify({broken:false}); const s=[...p.querySelectorAll('span')].find(x=>/lean run broken/.test(x.textContent||'')); return JSON.stringify({broken:!!s,text:s?s.textContent.trim():'',hasTitle:s?/r776/.test(s.getAttribute('title')||''):false}); })()" 2>&1 | tail -1)
echo "broken note: $BR"
echo "$BR" | grep -Eq 'broken\\?":true' || { echo 'GUARD broken note'; exit 1; }
echo "$BR" | grep -Eq 'was q ×2' || { echo 'GUARD broken run'; exit 1; }
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
export R754_TSC="$TSC" R754_LINT="$LTAIL" R754_GC="$GC" R754_CC="$CC" R754_CEN="$CEN" R754_SNAP="$SNAP" R754_QW="$QW" R754_QLD="$QLD" R754_CHIP="$CHIP" R754_LEG="$LEG" R754_LF="$LF" R754_STRIP="$STRIP" R758_DIV="$DIV" R760_TIER="$TIER" R774_LT="$LT" R774_LL="$LL" R776_BR="$BR"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r776')
L.append('Agent: NEXUS patrol (main agent - job 473388, 16:37 slot; opened on the r775 handoff + correction addendum; HEAD 5956ba12e = the r775 correction commit riding after the harness tee 5a1dec9dd (my r775 close commit db3414c25 sits beneath both); tree CLEAN at open; no parallel round closed (the worklog tail handed off r776; git log showed no r776 commit))')
L.append('Task: Patrol round 776 - THE LEAN-RUN BREAK WITNESSED ON-PAGE (the r776 break note). The opening ro-SQL census: 155 ev / 41 runs / 23 verdicts / 15 uncertain / 117 nj - FULLY FLAT vs the r775 close (no growth, no wave 16; newest row still 08:10:35 UTC; the band stays 13/16/41/58/13/42/62/57/61/70/6/73/55/59). The r775 correction held: the band docs and the live readouts agree (/59 in both). Golden QA GREEN FIRST-TRY (tally 41/155/23/15/117, TEN lane labels - no eleventh, console 0 errors). Shipped: the r776 lean-run break note - when the newest bucket is letterless and the run beneath it was 2+, the tier-state line now renders lean run broken (was q ×2) in place of the silently-dropped r767 tag (muted tone, cursor-help + transition-colors, the title carries the r767 break semantics and the restart rule: the run restarts at the next lettered bucket, x1 renders no tag, x2 renders the tag again); the laneLean memo returns the pre-break run (broken, recorded only when 2+); styling polish: transition-colors on the strip route-letter spans. The letterless 08:00 bucket exercised the note live during QA (the QA ran on the final tree).')
L.append('Work Log:')
L.append('- R1 open: parallel-session check clean (worklog tail = the r775 section + the same-round correction addendum; HEAD 5956ba12e = the r775 correction commit riding after the harness tee 5a1dec9dd; tree CLEAN at open; server 200 first-try; no parallel round closed).')
L.append('- R2 census: ro-SQL inline: 155/41/23/15/117 - FULLY FLAT vs the r775 close (newest row still 08:10:35 UTC, ~+27m quiet at reading); no wave 16 - the band stays /55/59; r776_qa.sh + r776_close.sh generated via the DUAL sed + bare-label sed from the in-tree r775 scripts.')
L.append('- R3 QA: the r776 golden QA ran GREEN FIRST-TRY (board strip true, tally 41 runs / 155 ev / 23 verdicts / 15u / 117nj, chips 42; ld all lanes with intern+fast+paid asserted, TEN labels, no eleventh; settings census+relay; radar frontier aria-click; 799-char long-paste witnessed; cron chip 1/1; console 0 errors - HMR-connect logs only, page errors empty).')
L.append('- R4 witnesses: the QA legs carried the witnesses this round (the census was flat - no separate witness pass needed): the tier-state reads lean run broken (was q ×2) - the new r776 note LIVE at probe time; +59m since prior; quiet ~+27m at census, amber correctly off; the 08:00 chip hover carries lanes + counts + gap 59 + the why-sentence (the r773-r775 affordances all holding).')
L.append('- R5 increment (run-kanban.tsx, four edits): the laneLean memo returns the pre-break run (broken = the trailing identical-letter run beneath the newest letterless bucket, recorded only when 2+, the tag condition preserved - the tag still renders only when the NEWEST bucket is lettered); the tier-state line renders the r776 break note in place of the silently-vanished tag; styling polish: transition-colors on the strip route-letter spans.')
L.append('- R6 close: gates re-run on the increment tree (tsc 0 / lint 0 errors, 33 warnings baseline); close probes: chip presence GATED / tone recorded; legend GATED (the tier-state span edited this round); tier-state RECORDED (gap/quiet/quietAmber) + the NEW r776 broken-note probe GATED (broken true + was q ×2); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip + the letterless chip in-window); divergence RECORDED ONLY; lane-filter tally gated; census + snapshot (thirty-second) + worklog + commit + dual push.')
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
L.append('- THE BREAK WITNESSED: the r767 break semantics (a letterless bucket breaks the run, the tag unrenders) now have an on-page witness - the tier-state reads lean run broken (was q ×2), the note gated in scripts/qa_r776_close.txt; the flat census (155/41/23/15/117, zero growth through the round) is itself a cadence datum: quiet ~+27m at census, +59m since prior, amber correctly off; GLM-SILENT deepens (no glm dial in any shown bucket, now spanning the lettered q buckets AND the letterless break); BOTH-SILENT lettered-bucket test still cleared. Snapshot discipline thirty-second close. Witness nine-legged + the r776 broken-note probe (board, ld, chip, legend, tier state, lane filter, wave strip, last-chip counts+gap, letterless chip) + the divergence census + the quietAmber read.')
L.append('- CANDIDATE NOTE (no deviation): the builtin box extraction stays parked for an explicitly requested refactor round; TASKS.md P1 rows stay Owner-blocked; QA green first-try (no bugs found); no new doc debt queued (the r775 correction validated this round - band docs and live readouts agree at /59).')
L.append('Round Handoff:')
L.append('Round ID: r777 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r776_qa.sh sed-adapted (DUAL pattern s/r=776/r=777/g; the r769-r776 scripts are committed in-tree; if swept, recover from git history); surgery lessons stand (apostrophe-free AND single-quote-free new texts; block replacement with a compile() pre-flight and a 5-line commit-line window scan is the kept pattern). Probes: chip presence gated / tone recorded; legend GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state RECORDED ONLY (lean r767, interval r768, quiet r769, amber tone r770, band docs r771-r775, silent-lane names r772, named-lane chip lists r773, per-lane counts r774, per-chip gap r775, break note r776); wave-strip presence GATED / text RECORDED; the bucket-title probes GATED (counts + hasGap on the newest chip + the letterless chip in-window); the r776 broken-note probe GATED but WAVE-BOUND (it asserts the current state: newest bucket letterless, run-below q×2) - when the next lettered bucket lands the note unrenders and the gate degrades to RECORDED with the bound disclosed; divergence RECORDED ONLY; tally gated. (2) SNAPSHOT DISCIPLINE (thirty-third). (3) TIMEOUT HYGIENE. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; TEN lane labels; an ELEVENTH = unrouted on sight. ROUTE WATCH: the lean run restarts at the next lettered bucket (x1 no tag, x2 tag; a g return resumes the alternation; an m bucket = the first both-routes witness). GLM-SILENT WATCH: no glm dial in any shown bucket - if the next lettered bucket is again q with no glm, the standing-laggard reading firms up (r759 semantics: check the laggard lanes before interpreting); BOTH-SILENT lettered-bucket test still cleared. (5) CADENCE: band 13/16/41/58/13/42/62/57/61/70/6/73/55/59 - the 62 ceiling HELD at the r775 re-look; wave 16 = the next interval point, recorded forward by the round that witnesses it (QUOTE THE RENDERED VALUE - the r775 correction convention); the witnessing round updates the band docs at the four sites + the wave framing. (6) Increment queue: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (7) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (8) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); AIHubMix relay update for the report: the flat stretch continues (zero growth through r776, verdicts flat 23, glm silent across the window, wave 15 letterless) - the relay reads IDLE-ADRIFT; the platform report should carry the arc (r774 recovering -> r775 adrift -> r776 flat-adrift) with the band and the ceiling-HOLD verdict. (9) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the r776 break-note feature is gated-witnessed in scripts/qa_r776_close.txt - a named mechanism shipped with its witness; the flat census is recorded as a cadence datum; full golden QA anchored in scripts/qa_r776.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r776: the lean-run break witnessed on-page - when the newest bucket is letterless and the run beneath it was 2+, the tier-state line now renders lean run broken (was q ×2) in place of the silently-dropped r767 tag (the laneLean memo returns the pre-break run; muted tone + cursor-help + transition-colors; the title carries the break semantics and the restart rule); the letterless 08:00 bucket exercised the note live during QA. Styling polish: transition-colors on the strip route-letter spans. Census fully flat (155/41/23/15/117, no wave 16, band stays /55/59, the r775 /59 correction held). Snapshot discipline thirty-second close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r776_close.txt
SWEEP=$(git add -A && git commit -m "r776: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
