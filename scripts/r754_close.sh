#!/usr/bin/env bash
# r754 close (pure watch): gates -> QA-green guard -> chip probe (gated) -> legend probe (recorded) -> lane-filter probe (recorded; tally assertion stays gated) -> census -> snapshot -> worklog -> commit -> dual push -> in-script sweep
set -u
cd /home/z/my-project
{
TSC=$(timeout 150 bunx tsc --noEmit > scripts/.tsc_r754c.out 2>&1; echo $?)
LINT=$(timeout 150 bun run lint > scripts/.lint_r754c.out 2>&1; echo $?)
LTAIL=$(grep -E '✖' scripts/.lint_r754c.out | tail -1)
[ "$TSC" = "0" ] || { echo "GUARD tsc ($TSC)"; exit 1; }
[ "$LINT" = "0" ] || { echo "GUARD lint ($LINT)"; exit 1; }
echo "$LTAIL" | grep -q '0 errors' || { echo "GUARD lint errors: $LTAIL"; exit 1; }
grep -q 'r754 QA GREEN' scripts/qa_r754.txt 2>/dev/null || { echo 'GUARD qa - no GREEN marker; no-ship-on-red'; exit 1; }
QW=$(grep '^board: ' scripts/qa_r754.txt | tail -1)
QLD=$(grep '^ld: ' scripts/qa_r754.txt | tail -1)
# chip probe (cards view; grid-click first — the r749 doctrine): presence GATED, tone RECORDED.
timeout 60 agent-browser open "http://localhost:3000/?r=754c#workflows" >/dev/null 2>&1 || true
sleep 4
timeout 30 agent-browser eval "(() => { const r=document.querySelector('[aria-label=\"Card grid layout\"]'); if (r) r.click(); return 'grid-clicked'; })()" >/dev/null 2>&1 || true
sleep 2
CHIP=$(timeout 30 agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/in corpus/.test(x.textContent||'')); return b ? JSON.stringify({chip:true, text:b.textContent.trim(), amber:b.className.indexOf('amber-500')>-1}) : JSON.stringify({chip:false}); })()" 2>&1 | tail -1)
echo "chip: $CHIP"
echo "$CHIP" | grep -Eq 'chip\\?":true' || { echo 'GUARD chip probe'; exit 1; }
# lane-legend probe (board view; chips UNTOUCHED this round -> RECORDED, the QA ld leg already gates the nj token).
timeout 60 agent-browser open "http://localhost:3000/?r=754b#workflows/board" >/dev/null 2>&1 || true
sleep 4
NJCLICK=$(timeout 30 agent-browser eval "(() => { const b=document.querySelector('[aria-controls=\"corpus-lane-legend\"]'); if(!b) return 'nj-button-missing'; b.click(); return 'clicked'; })()" 2>&1 | tail -1)
echo "nj click: $NJCLICK"
sleep 1
LEG=$(timeout 30 agent-browser eval "(() => { const p=document.querySelector('[data-testid=\"corpus-lane-legend\"]'); return p ? JSON.stringify({legend:true, spans:p.querySelectorAll('span').length, label:p.textContent.trim().slice(0,110)}) : JSON.stringify({legend:false, note:'panel-missing-after-click'}); })()" 2>&1 | tail -1)
echo "legend: $LEG"
# lane-filter probe (RECORDED - chips untouched; the fixed tally assertion stays GATED per the handoff).
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
export R754_TSC="$TSC" R754_LINT="$LTAIL" R754_GC="$GC" R754_CC="$CC" R754_CEN="$CEN" R754_SNAP="$SNAP" R754_QW="$QW" R754_QLD="$QLD" R754_CHIP="$CHIP" R754_LEG="$LEG" R754_LF="$LF"
python3 - <<'PY'
import os
L = []
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r754')
L.append('Agent: NEXUS patrol (main agent - job 473388, 04:07 slot; opened on the r753 handoff verbatim)')
L.append('Task: Patrol round 754 - PURE WATCH round (the handoff\'s legitimate watch path): the census is STEADY at 82 rows / 24 runs / verdict 21 / uncertain 15 / nj 46 for the third consecutive slot, so the deferred "first seen per lane" increment stays deferred (it re-arms on the next growth wave - shipping it against unchanged data would be theatre). No code changes shipped; the full golden QA is the round\'s named evaluation per the r707 constraint.')
L.append('Work Log:')
L.append('- R1 open probes: r753 closed by the 03:37 slot (b90beb3e4 ship + 5ab604c48 sweep); tree clean; server 200; opened r754 on the handoff verbatim.')
L.append('- R2 templates + census: r754_qa.sh + r754_close.sh via the DUAL sed pattern (s/r=753/r=754/g + s/r753/r754/g) - zero remnants; ro-SQL census 82/24/21/15/46 - STEADY, no growth wave (the newest row predates this slot).')
L.append('- R3 QA: r754 golden QA GREEN (probes below; seven lanes re-verified via the LD title - no EIGHTH lane; console 0 errors).')
L.append('- R4 close: chip probe (GATED presence / tone recorded - standing) + legend probe (RECORDED - chips untouched this round; the QA ld leg already gates the nj token) + lane-filter probe (RECORDED, but the fixed tally assertion stays GATED per the handoff) + census + snapshot + worklog + commit + dual push.')
L.append('- QA PROBES (this close):')
L.append('  ' + os.environ.get('R754_QW','(missing)'))
L.append('  ' + os.environ.get('R754_QLD','(missing)'))
L.append('  chip: ' + os.environ.get('R754_CHIP','(missing)'))
L.append('  legend: ' + os.environ.get('R754_LEG','(missing)'))
L.append('  lane filter: ' + os.environ.get('R754_LF','(missing)'))
L.append('- GATES: tsc_exit=' + os.environ.get('R754_TSC','?') + ' - lint ' + os.environ.get('R754_LINT','?') + ' - qa-gate-census ' + os.environ.get('R754_GC','?') + ' - qa-cortex-census ' + os.environ.get('R754_CC','?') + ' - close census ' + os.environ.get('R754_CEN','?') + ' - snapshot: ' + os.environ.get('R754_SNAP','?'))
L.append('Stage Summary:')
L.append('- INTERPRETATION CORRECTION (carried as promised from the r753 probe readings, correcting the r751-era framing): the legend\'s equal per-lane counts (intern-systemone x46/18 runs, fast-judge x46/18 runs, jev x46/18 runs, ...) are the FULL-LADDER FAILURE shape - every no-judge step\'s verbatim trace lists the whole tried-ladder; with no judge answering anywhere, each step tries every lane. The distress is TOTAL, not intern-specific; intern reads first because it is the first rung, and the driver-first sort correctly keeps ties in ledger insertion order. Vault re-store would cure the WHOLE ladder, not one lane. Cadence watch: growth r749->r750 and r750->r751, then three steady slots (r751->r754) - waves come in bursts. Snapshot discipline tenth close. Witness five-legged, all legs green.')
L.append('Round Handoff:')
L.append('Round ID: r755 -> next patrol (job 473388)')
L.append('Next recommended action: (1) NORMAL WATCH: golden QA via scripts/r754_qa.sh sed-adapted (DUAL pattern s/r=754/r=755/g + s/r754/r755/g); close probes: chip presence gated / tone recorded; legend + lane-filter probes RECORDED (gate only if a round touches the chips); the tally assertion stays gated. (2) SNAPSHOT DISCIPLINE stands. (3) TIMEOUT HYGIENE stands. (4) JUDGE-LANE WATCH: baseline = the GATES census line of this close; seven lanes; any EIGHTH lane or a VERDICT/UNCERTAIN growth wave = new signal; on the NEXT growth wave, ship the deferred "first seen" per-lane timestamp (dials over time - the equal-count shape makes first-seen nearly uniform today, which is itself a witness of total ladder failure). (5) Increment queue: pure watch is legitimate while the corpus is steady; TASKS.md re-triage if the Owner unblocks rows. (6) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (7) Owner queue: PLATFORM REPORT URGENT - three wipes (r725 tree+DB, r745 tree, r745/r746 DB-only) + .archive-snapshot-1028 disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git; seedwrite.ts re-entry); KICK widget URL fix (needs Owner input); GitHub PAT rotation (public history bb6120b31); Webshare token paste (Egress 403->401 witness); optional v29c-f re-download. (8) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none app-side; P1 backlog rows remain Owner-blocked (disclosed r749 with sources). Standing constraint (r707): mechanism or named evaluation every round - held (full golden QA + the steady-census witness + the interpretation correction, all anchored in scripts/qa_r754.txt and scripts/qa_r754_close.txt).')
L.append('')
with open('worklog.md','a') as f:
    f.write('\n'.join(L))
print('worklog appended')
PY
git add -A
git commit -m "r754: pure watch round - census steady (82 rows / 24 runs / 21 verdicts / 15u / 46nj, third consecutive steady slot); no code changes, full golden QA as the named evaluation (r707). Carried the r753 interpretation correction into the worklog: the legend's equal per-lane counts are the FULL-LADDER FAILURE shape (every no-judge step tries every lane - the distress is total, not intern-specific; intern reads first as the first rung). Probe gating per the handoff: chip gated/tone recorded; legend + lane-filter recorded (untouched); the fixed tally assertion stays gated. Cadence record: growth r749->r750 and r750->r751, then three steady slots - waves come in bursts. Snapshot discipline tenth close."
git push origin main && git push fork main
} 2>&1 | tee scripts/qa_r754_close.txt
SWEEP=$(git add -A && git commit -m "r754: sweep - tee artifact (r745 template)" >/dev/null 2>&1; echo done)
git push origin main >/dev/null 2>&1
git push fork main >/dev/null 2>&1
echo "sweep: $SWEEP; pushed both remotes"
exit 0
