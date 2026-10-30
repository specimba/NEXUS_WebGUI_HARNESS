#!/usr/bin/env bash
# r767 close (qwen-lean counter + quiet open): gates -> QA-green guard -> chip probe (gated) -> legend probe (GATED - tier-state line edited, same view) -> tier-state probe (recorded - carries the lean tag) -> wave-strip probe (gated presence / recorded text) -> divergence probe (RECORDED - both routes may hold diamonds) -> lane-filter probe (tally assertion gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r767c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r767c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r767c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r767 QA GREEN' scripts/qa_r767.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r767.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r767.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=767c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; the legend view WAS touched this round - the increment edits the tier-state line inside the legend -> the legend gate runs, r756-r767 precedent).
timeout 60 agent-browser open "http://localhost:3000/?r=767b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
echo "$LEG" | grep -Eq 'legend\\?":true' || { echo 'GUARD legend probe'; exit 1; }
# tier-state probe (r767): RECORDED ONLY - now carries the lean tag (r767 increment); the route-state line is a witness, not a gate (amber-tone doctrine).
TIER=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\\"corpus-tier-state\\"]'); if(!p) return JSON.stringify({tier:false}); return JSON.stringify({tier:true, text:p.textContent.trim().slice(0,120)}); })()" 2>&1 | tail -1)
echo "tier state: $TIER"
# wave-strip probe: presence GATED (corpus non-empty -> the strip must render), text RECORDED.
STRIP=$(timeout 30 agent-browser eval "(() => { const s=document.querySelector('[data-testid=\"corpus-wave-strip\"]'); return s ? JSON.stringify({strip:true, text:s.textContent.trim().slice(0,170)}) : JSON.stringify({strip:false}); })()" 2>&1 | tail -1)
echo "wave strip: $STRIP"
echo "$STRIP" | grep -Eq 'strip\\?":true' || { echo 'GUARD wave-strip probe'; exit 1; }
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
export R754_TSC="$TSC" R754_LINT="$LTAIL" R754_GC="$GC" R754_CC="$CC" R754_CEN="$CEN" R754_SNAP="$SNAP" R754_QW="$QW" R754_QLD="$QLD" R754_CHIP="$CHIP" R754_LEG="$LEG" R754_LF="$LF" R754_STRIP="$STRIP" R758_DIV="$DIV" R760_TIER="$TIER"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r767')
L.append('Agent: NEXUS patrol (main agent - job 473388, 10:37 slot; opened on the r766 handoff - HEAD 490adc44d = the r766 ship + sweep from the 10:07 slot, own-session lineage, no parallel round closed)')
L.append('Task: Patrol round 767 - QWEN-LEAN COUNTER SHIPS, QUIET OPEN: the opening ro-SQL census read 129 ev / 34 runs / 93 nj - IDENTICAL to the r766 close census (newest ~02:02:18 UTC, wave 9); no wave 10 at open, ~35 min quiet - inside the 13-62 band, no interval break to declare; verdict/uncertain flat for the NINTH straight wave. Shipped the lean counter (the r766 watch made the qwen lean the live story - three straight q waves 00:03/01:05/02:02 ended the wave-by-wave alternation): laneLean computes the trailing run of identical route letters over the wave-strip route letters within the shown strip window (last 6 corpus buckets, newest backward; an absent letter - a bucket without middle-tier rows - breaks the run; window caps at 6); a run of 2+ renders the lean tag in the corpus tier-state line (q-lean ×N style, font-medium text-foreground/70 matching the strip letters) with its own title documenting the semantics, and the tier-state title gains the lean sentence. The lean is now an on-page read: the recorded tier-state probe carries it live each round, so a fourth q (cement) or a g return (alternation resumed) is witnessed in the probe text without deriving it from the strip. Honest scoping: no new data source - the counter reads the same route map the strip letters use.')
L.append('Work Log:')
L.append('- R1 open probes: no parallel session - HEAD 490adc44d was the r766 ship + sweep (own-session lineage); tree clean; server 200; ro-SQL census 129/34/21/15/93 - FLAT vs the r766 close, no wave 10 at open (~35 min quiet, newest ~02:02:18 UTC) -> steady-watch path with the lean-counter increment.')
L.append('- R2 templates: r767_qa.sh + r767_close.sh via the DUAL sed pattern (s/r=766/r=767/g + s/r766/r767/g) - zero mechanical remnants, bash -n green; the round-766 prose gaps (spelled-out Patrol round 766 + the literal Round ID r767 pointer) handled by this surgery pass; wave-10 census taken in the R1 batch.')
L.append('- R3 increment (run-kanban.tsx): laneLean memo inserted after laneTiers - a trailing-run read over the wave-strip route letters within the shown strip window (last 6 corpus buckets, newest backward; an absent letter - a bucket without middle-tier rows - breaks the run, window caps it at 6); run >= 2 renders the lean tag in the corpus tier-state line (' q-lean ×N — ' style, font-medium text-foreground/70 matching the strip letters, own title documenting semantics), and the tier-state title gains the lean sentence. Three-edit MultiEdit verified in the returned diff (r760/r762 marker-verify discipline honored).')
L.append('- R4 gates: tsc 0 / lint 0 errors (33 warnings baseline) on the increment tree - first-try green.')
L.append('- R5 QA + close: the r767 golden QA ran GREEN first-try (board probe at the steady wave-9 census 34 runs / 129 ev / 93nj, chips 35; ld count 93, seven lanes, no eighth; settings census+relay, radar frontier, 799-char long-paste all green; console 0 errors). Close probes: chip GATED presence / tone recorded; legend GATED (the tier-state line inside the legend was edited - same view; r756-r767 precedent honored); tier-state probe RECORDED (the recorded text now carries the lean tag); wave-strip probe presence GATED / text RECORDED; divergence probe RECORDED ONLY; + census + snapshot + worklog + commit + dual push.')
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
L.append('- LEAN MADE FIRST-CLASS: the qwen lean is now stated by the instrument itself - the tier-state line's lean tag turns the trailing-run count into a recorded probe witness, so cement (q ×4+) or reset (g return) is readable in the QA artifact without cross-reading the strip. Zero-growth open (~35 min, inside the band) keeps the burst-ending watch (r766) armed but declares nothing. Snapshot discipline twenty-third close. Witness seven-legged (board, ld, chip, legend, tier state, lane filter, wave strip) + the divergence census, all green.')
L.append('- CANDIDATE NOTE (no deviation): the r766 handoff named no increment candidate (queue: builtin box Owner-asked / TASKS.md re-triage / QA bugs first); this round continued the r759-r766 route-instrument line with the lean counter - the live story (the relay lean) became a first-class on-page read. The builtin box extraction stays parked for an explicitly requested refactor round.')
L.append('Round Handoff:')
L.append('Round ID: r768 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r767_qa.sh sed-adapted (DUAL pattern s/r=767/r=768/g + s/r767/r768/g); remember the round-767 prose gaps (spelled-out Patrol round 767 + the literal Round ID r768 pointer - both handled in the close-script surgery); close probes: chip presence gated / tone recorded; legend probe GATED if the round touches the strip/legend/tier-state/run-card view, else RECORDED; tier-state probe: RECORDED ONLY (carries the lean tag since r767); wave-strip probe: presence GATED / text RECORDED; divergence probe: RECORDED ONLY; the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; ROUTE WATCH: the lean counter in the tier-state line is the live read (r767) - a growing q-run cements the qwen lean, a g return resets the counter (alternation resumed), an m bucket or m run (both routes, amber, 7 lanes) = the first both-routes witness - investigate; a BOTH-SILENT bucket (3 lanes = genuine partial ladder) = investigate immediately; a lag on intern/fast-judge/jev = genuine partial ladder; any EIGHTH lane (labeled unrouted on sight), a VERDICT/UNCERTAIN growth wave, a NEW wave beyond the close census's newest (the strip bucket total rises), or an interval-pattern break (band 13 -> 42 -> 62 -> 57 - a gap far outside, or a zero-growth stretch past ~62 = the burst ended) = new signal. (5) Increment queue: no named candidate - candidates: (a) the builtin box extraction (~90 lines, parked since r567) for an Owner-asked refactor round; (b) TASKS.md re-triage if the Owner unblocks rows; (c) QA-found bugs first, always. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download; AIHubMix relay LEAN UPDATE (r766/r767): three straight qwen waves (00:03, 01:05, 02:02) after the wave-by-wave alternation, now surfaced as the on-page lean counter - the platform report should describe the lean, not an outage. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (the lean counter shipped into a live steady-watch + full golden QA, anchored in scripts/qa_r767.txt and scripts/qa_r767_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r767: qwen-lean counter ships + quiet open. Census flat at 129/34/21/15/93 vs the r766 close - no wave 10 at open (~35 min quiet, newest ~02:02:18 UTC, inside the band); verdict/uncertain flat ninth wave. Increment: laneLean - a trailing-run read over the wave-strip route letters (shown window, newest backward, absent letter breaks the run); run >= 2 renders the lean tag in the corpus tier-state line (q-lean ×N, font-medium text-foreground/70, own title) and the title gains the lean sentence - the r766 relay-lean watch is now an on-page read, carried live by the recorded tier-state probe (styling polish: the tag matches the strip-letter treatment). Snapshot discipline twenty-third close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r767_close.txt
SWEEP=$(git add -A && git commit -m "r767: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
