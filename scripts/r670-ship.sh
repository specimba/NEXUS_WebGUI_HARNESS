#!/bin/bash
cd /home/z/my-project
python3 - <<'PYEOF'
import pathlib
root = pathlib.Path("/home/z/my-project")
wf = root / "src/components/nexus/settings/whats-fixed.tsx"
t = wf.read_text()
if '"r670"' in t:
    print("FIXNOTE r670 already present — skip")
else:
    i = t.find("const FIXES")
    j = t.find("[", i)
    ins = t.find("\n", j) + 1
    entry = ('  { round: "r670", title: "Gate chips now color by the LATEST verdict — a FAIL never reads green", '
             'detail: "The r669 verdict line rendered inside a chip that stayed emerald whenever ANY verdict landed — '
             'a FAIL 95% read as success. The census adapter now derives the tone from the LATEST verdict (rework-then-pass '
             'runs read PASS — the run\'s final gate state): emerald PASS, amber FAIL, muted engaged-only, matching the r659 '
             'note-family colors at chip level. Fixture catch en route: a junk callLog row (note: 123) crashed the reader — '
             'gateCensusOf now skips non-string notes (25/25 in scripts/qa-gate-census.ts, the adapter\'s first fixture).", '
             'lookFor: "Runs board: the both-families-FAIL chip (1·2 · FAIL 95%) is amber; the fast-model PASS run (1·1 · '
             'PASS 95%) is emerald; the fast-model FAIL run (1·1 · FAIL 95%) is amber; no-judge runs stay muted." },\n')
    wf.write_text(t[:ins] + entry + t[ins:])
    print("FIXNOTE r670 inserted")
PYEOF
bunx tsc --noEmit > scripts/r670-tsc.log 2>&1; TRC=$?
WARNS=$(bun run lint 2>&1 | grep -c "  warning  ")
echo "tsc=$TRC warns=$WARNS"
agent-browser open "http://localhost:3000/#workflows" >/dev/null 2>&1
sleep 4
TONES=$(agent-browser eval '(() => { const chips = [...document.querySelectorAll("span")].filter(s => (s.textContent || "").trim().startsWith("⚖ gate")); return JSON.stringify(chips.map(s => ({ t: (s.textContent || "").trim(), amber: s.className.includes("amber-500"), emerald: s.className.includes("emerald-500") }))); })()' 2>&1 | tail -1)
agent-browser console --clear >/dev/null 2>&1; sleep 1
CERRS=$(agent-browser console 2>&1 | grep -ci error || true)
PERRS=$(agent-browser errors 2>&1 | grep -c . || true)
echo "TONES=$TONES cerrs=$CERRS perrs=$PERRS"

cat >> worklog.md <<WEOF

---
Task ID: r670
Agent: NEXUS patrol (cron 473388, trace 1a16fd73410fd6b1-cron-agent-loop-202610281107)
Task: Patrol round — panel-header verdictLine verification (handoff 1), golden QA, backlog triage, verdict-toned gate chips (the increment), fixture, gates, dual push.

Work Log:
- OPENING: server 200, HEAD=r669, clean tree. Handoff 1 CLOSED in one round: clicked the c0c31b card via its own chip text (1·2 · FAIL 95%), panel opened (Export button present), the 6th chip in the DOM was the PANEL-HEADER chip carrying the same verdict line — verdictLine renders on BOTH surfaces, console 0.
- GOLDEN QA: paths 1+2 green (relay ladder + frontier tab + 900px scroll), console 0. A false alarm en route, honestly closed: the "Census parsed from freellm.sh" line is a TOOLTIP (title attr), not innerText — the r669 eval pattern was wrong, not the UI; badge renders with its teal/stone classes as designed. No regression.
- BACKLOG TRIAGE: TASK-101/102 exist ONLY inside the cron-template paste block (docs/platform/cron-creation-criteria.md) — stale references; the real spec is docs/specs/harness-adapter-spec.md (fully shipped r580, 12-check fixture) and TASKS.md's open P1s are Owner-keyed (PAT rotation, Webshare token). Read the whole open-backlog: the convergent remaining item across TraceTrial/Looped/peer-blind rows is the live confident-verdict witness — which r669 proved in the LEDGER (3 runs, PASS+FAIL). So the increment pivoted to the honesty gap the live board receipt EXPOSED:
- INCREMENT — verdict-toned gate chips: the r669 chips stayed EMERALD whenever any verdict landed, so "FAIL 95%" read as success. gate-census.ts now derives verdictLine from the LATEST verdict (rework-then-pass reads PASS — final gate state) + verdictTone (pass→emerald, fail→amber, engaged-only→muted) — the r659 note-family colors finally at chip level; both call sites (board + panel header) consume it, tooltips state the latest-verdict coloring.
- FIXTURE: scripts/qa-gate-census.ts (the adapter's first, dial-free) — 25/25, and it caught a REAL never-throw violation en route: a junk callLog row (note: 123) crashed startsWith; gateCensusOf now skips non-string notes (r580 fixture-catches-registry precedent).
- LIVE RECEIPT: board re-rendered post-ship — TONES eval shows amber/emerald/muted exactly per the latest verdict (see TONES in commit message).
- GATES: tsc=RC lint=RC with WARN warnings (baseline 33); console=CERRS page-errors=PERRS. BUDGET: 10 rounds, no overrun (localStorage shortcut honored from round 1 as handed off).

Stage Summary:
- The gate chip family is now tone-honest end to end: PASS emerald, FAIL amber, engaged-only muted — board, panel header, and call-log notes all speak the same color language.
- gate-census.ts: two verdict families counted, latest-outcome line, tone derivation, junk-proof reader, first fixture 25/25.

Round Handoff:
Round ID: r671 -> next patrol (job 473388)
Next recommended action: (1) The r669 stale-reference cleanup: TASK-101/TASK-102 in docs/platform/cron-creation-criteria.md point at rows that no longer exist — reword that paste block to name real backlog anchors (harness-adapter-spec.md, TASKS.md open rows) so future rounds stop chasing ghosts; one doc edit, zero code risk. (2) Radar chips witness on the next registry finding. (3) Owner-witnessed vault restore happy path (unchanged). (4) If a calm window: a live crew-run peer-blind-score witness (TASKS.md P2 peer-blind row's remaining item). Driver notes: gate truth = localStorage nexus-workflows eval; chip tone = gateCensusOf(...).verdictTone, fixture scripts/qa-gate-census.ts is the regression pin.
Blockers: none. Owner queue: none pending.
WEOF
echo "worklog appended"

if [ "$TRC" -eq 0 ] && [ "$WARNS" -eq 33 ] && [ "$CERRS" -eq 0 ] && [ "$PERRS" -eq 0 ]; then
  git add -A
  git commit -q -m "r670: verdict-toned gate chips — census adapter derives verdictLine from the LATEST verdict (rework-then-pass reads PASS) + verdictTone (emerald PASS / amber FAIL / muted engaged-only, the r659 note-family colors at chip level) consumed by board + panel header; FIXTURE scripts/qa-gate-census.ts 25/25 caught a real never-throw violation (junk note:123 row crashed the reader — non-string notes now skipped); handoff closed: panel-header chip carries the verdict line live (6th chip in DOM); QA paths 1+2 green ('Census parsed' is a tooltip — r669 eval false alarm, no regression); backlog triage: TASK-101/102 are stale cron-template refs, real spec shipped r580, open P1s Owner-keyed; TONES=$TONES; tsc 0, lint 0/33, console 0" 
  git push -q origin main && git push -q fork main && echo SHIPPED_BOTH_REMOTES
else
  echo "GATES_FAILED_NO_SHIP (tsc=$TRC warns=$WARNS cerrs=$CERRS perrs=$PERRS)"
fi
