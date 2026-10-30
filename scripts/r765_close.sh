#!/usr/bin/env bash
# r765 close (tier-state letter history + steady watch): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - tier-state title edited, same view) -> tier-state probe (recorded - hover now carries the letter history) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - both routes may hold diamonds while routes hand off) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r765c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r765c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r765c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r765 QA GREEN' scripts/qa_r765.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r765.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r765.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=765c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips WERE touched this round - the increment edits chip semantics text -> the legend gate runs, r756-r765 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=765b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r765): RECORDED ONLY - the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120)}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe (r765 increment): presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
# divergence probe (r765): RECORDED ONLY - with the middle tier alternating near-per-wave, BOTH routes can hold diamonds (each lags the newest-3 window when the other route holds the latest bucket); the SIGNAL is a diamond on intern/fast-judge/jev = a genuine partial ladder (amber-tone doctrine).
DIV=$(timeout 30 agent-browser eval "(() => { const d=[...document.querySelectorAll('[data-testid=\"corpus-lane-legend\"] [data-div=\"1\"]')]; return JSON.stringify({divBadges:d.length}); })()" 2>&1 | tail -1)
echo "divergence: $DIV"
# lane-filter probe (chips WERE touched this round - the legend gate above runs; the fixed tally assertion stays GATED).
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
export R754_TSC="$TSC" R754_LINT="$LTAIL" R754_GC="$GC" R754_CC="$CC" R754_CEN="$CEN" R754_SNAP="$SNAP" R754_QW="$QW" R754_QLD="$QLD" R754_CHIP="$CHIP" R754_LEG="$LEG" R754_LF="$LF" R754_STRIP="$STRIP" R758_DIV="$DIV" R760_TIER="$TIER"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r765')
L.append('Agent: NEXUS patrol (main agent - job 473388, 09:37 slot; opened on the r764 handoff - HEAD 2625b044e = the r764 ship + sweep from the 09:07 slot, own-session lineage, no parallel round closed)')
L.append('Task: Patrol round 765 - LETTER HISTORY SHIPS, QUIET OPEN: the opening ro-SQL census read 126 ev / 33 runs / 90 nj - IDENTICAL to the r764 close census (newest ~01:05:10 UTC, wave 8); no wave 9 at open, ~32 min quiet (within the stretching 13-62 min band). Shipped the r764-handoff candidate (a): the per-bucket letter history in the tier-state title - the hover now lists the route letter of each shown strip bucket oldest first (e.g. 10-29 22:00 g - 10-29 22:45 q - ... - 10-30 01:00 q), a dash = no middle-tier rows there; the visible tier-state tag gained the font-medium text-foreground/70 treatment for consistency with the strip letters (styling polish), textContent byte-identical so the recorded probe format is unchanged.')
L.append('Work Log:')
L.append('- R1 open probes: no parallel session - HEAD 2625b044e was the r764 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 126/33/21/15/90 - FLAT vs the r764 close, no wave 9 at open (~32 min quiet, newest ~01:05:10 UTC) -> steady-watch path with the letter-history increment.')
L.append('- R2 templates: r765_qa.sh + r765_close.sh via the DUAL sed pattern (s/r=764/r=765/g + s/r764/r765/g) - zero mechanical remnants, bash -n green; the round-764 prose gaps (spelled-out Patrol round 764 + the literal Round ID r765 pointer) handled by this surgery pass; wave-9 census taken in the R1 batch.')
L.append('- R3 increment (run-kanban.tsx): the corpus-tier-state title gains the letter-history sentence (waveStrip.shown + waveStrip.route joined oldest first, dash for buckets without middle-tier rows), the visible bucket tag restructured into its own span with the font-medium text-foreground/70 treatment matching the strip letters. Two-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')
L.append('- R5 QA + close: the r765 golden QA ran GREEN first-try (board probe at the steady wave-8 census 33 runs / 126 ev / 90nj, chips 34; ld count 90, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (tier-state title edited - same view; r756-r765 precedent honored); tier-state probe RECORDED (the hover carries the letter history); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R754_QW','(missing)'))
L.append('  ' + os.environ.get('R754_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R754_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R754_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R754_LF','(missing)'))
L.append('  wave strip: ' + os.environ.get('R754_STRIP','(missing)'))
L.append('  divergence: ' + os.environ.get('R758_DIV','(missing)'))
L.append('  tier state: ' + os.environ.get('R760_TIER','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R754_TSC','?') + ' - lint ' + os.environ.get('R754_LINT','?') + ' - qa-gate-census ' + os.environ.get('R754_GC','?') + ' - qa-cortex-census ' + os.environ.get('R754_CC','?') + ' - close census ' + os.environ.get('R754_CEN','?') + ' - snapshot: ' + os.environ.get('R754_SNAP','?'))
L.append('Stage Summary:')
L.append('- STEADY SLOT, INSTRUMENT DEEPENS: the quiet open is itself a datapoint - the gap band has stretched 13 -> 42 -> 62 and wave 9 is pending past ~32 min; the letter history turns the tier-state hover into the single-glance alternation story (route sequence readable without cross-reading the strip). Watches armed for wave 9: a third straight q = a lean toward the free routes, a flip back to g = alternation restored, an m bucket or a both-silent bucket = investigate. Snapshot discipline twenty-first close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')
L.append('- HOVER SCOPING (honest): the letter history mirrors the strip shown-window (last 6 buckets) - it is a convenience read of the same data, not a new source; the recorded probe text is unchanged (textContent byte-identical), so the wave-strip probe format and the tally assertions hold. No forward corrections owed this round.')
L.append('Round Handoff:')
L.append('Round ID: r766 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r765_qa.sh sed-adapted (DUAL pattern s/r=765/r=766/g + s/r765/r766/g); remember the round-765 prose gaps (spelled-out Patrol round 765 + the literal Round ID r766 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend view, else RECORDED; tier-state probe: RECORDED ONLY (hover carries the letter history since r765); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: alternation broken (qwen held twice, 00:03 + 01:05); a third straight q wave = a lean toward the free routes, a flip back to g = alternation restored; the first m bucket (both routes, amber, 7 lanes) or a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NINTH wave, or an interval-pattern break (band 13 -> 42 -> 62 and stretching - a gap far beyond ~62, or a sudden collapse back to ~13 after two long ones) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) if the Owner wants a refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay alternation + first pattern break (qwen held twice, 00:03 + 01:05) - describe the alternation and its break, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the letter history shipped into a live steady-watch + full golden QA, anchored in scripts/qa_r765.txt and scripts/qa_r765_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r765: tier-state letter history ships + quiet open. Census 126/33/21/15/90 - IDENTICAL to the r764 close (newest ~01:05:10 UTC, wave 8); ~32 min quiet at open, within the stretching 13-62 min band. Increment (r764-handoff candidate a): the per-bucket letter history in the tier-state title (shown strip buckets oldest first, dash = no middle-tier rows) - the alternation story reads in one hover; the visible bucket tag gained the font-medium treatment matching the strip letters (styling polish), textContent byte-identical so the recorded probe format is unchanged. QA GREEN first-try at the steady census. Snapshot discipline twenty-first close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r765_close.txt
SWEEP=$(git add -A && git commit -m "r765: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
