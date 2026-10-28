#!/bin/bash
cd /home/z/my-project
python3 - <<'PYEOF'
import pathlib
root = pathlib.Path("/home/z/my-project")
wf = root / "src/components/nexus/settings/whats-fixed.tsx"
t = wf.read_text()
if '"r671"' in t:
    print("FIXNOTE r671 already present — skip")
else:
    i = t.find("const FIXES")
    j = t.find("[", i)
    ins = t.find("\n", j) + 1
    entry = ('  { round: "r671", title: "Board digest speaks gate health — and the patrol template stopped chasing ghosts", '
             'detail: "The Runs board digest line now aggregates the Decision gate census across every visible card — '
             '⚖ 5 gate calls · 4 verdicts · 2 latest-FAIL live on first render — amber when any run\'s latest verdict is a '
             'FAIL, emerald when verdicts landed clean, muted while judges stay unanswered: the r670 chip tone contract, '
             'aggregated to scan level. Both ⚖ chips gained transition-colors so tone changes animate. Doc side: the '
             'cron-template paste block\'s stale TASK-101/102 references are reworded to the real backlog anchors (the live '
             'z.ai cron payload is Owner-side and keeps the old text until the job is edited there).", '
             'lookFor: "Runs board top digest: N runs on the board · N harness debts · ⚖ N gate calls · N verdicts — the ⚖ '
             'chip is amber while FAIL verdicts lead, emerald when clean." },\n')
    wf.write_text(t[:ins] + entry + t[ins:])
    print("FIXNOTE r671 inserted")
PYEOF
bun scripts/qa-gate-census.ts || { echo FIXTURE_FAILED; exit 1; }
bunx tsc --noEmit > scripts/r671-tsc.log 2>&1; TRC=$?
WARNS=$(bun run lint 2>&1 | grep -c "  warning  ")
echo "tsc=$TRC warns=$WARNS"
agent-browser console --clear >/dev/null 2>&1; sleep 1
CERRS=$(agent-browser console 2>&1 | grep -ci error || true)
PERRS=$(agent-browser errors 2>&1 | grep -c . || true)
echo "cerrs=$CERRS perrs=$PERRS"

cat >> worklog.md <<WEOF

---
Task ID: r671
Agent: NEXUS patrol (cron 473388, trace 1a16fd73410fd6b1-cron-agent-loop-202610281137)
Task: Patrol round — golden QA (all three paths live), board-level gate aggregate (the increment), cron-doc stale-ref cleanup, gates, dual push.

Work Log:
- OPENING: server 200, HEAD=r670, clean tree. Golden QA paths 1+2 green (relay ladder copy, frontier tab + 900px scroll), console 0.
- GOLDEN QA PATH 3 (full, live): Control+k palette opened, the r663 aria-label route clicked "Run workflow: Novelty Lab (sample) — 1 step", run panel opened, 2,220 chars pasted into the step textarea via native setter + input event, panel closed with Escape (no run launched, no store mutation — r662 doctrine). Console 0. Honest note: the first palette eval died on my own quoting (SyntaxError), retried clean one round later — app was never at fault; a stray textarea on the board view took the first paste attempt harmlessly.
- INCREMENT — board-level gate health: the Runs board digest line now aggregates gateCensusOf across every visible card (new boardGates memo mirroring the r649 boardHarness shape): "⚖ N gate calls · N verdicts · N latest-FAIL", amber when any run's latest verdict is a FAIL, emerald when verdicts landed clean, muted while judges stay unanswered. LIVE on first render: "⚖ 5 gate calls · 4 verdicts · 2 latest-FAIL" — exactly the predicted aggregate over the five engaged runs (w10 no-judge, c0c31b 2·2 FAIL, a4bdb3 PASS, 2860e0 FAIL, dossier no-judge ×6).
- STYLING POLISH: both ⚖ chips (board card + panel header) gained transition-colors — tone changes animate instead of snapping.
- DOC CLEANUP (handoff 1): docs/platform/cron-creation-criteria.md line 49's stale TASK-101/102 clause reworded to the real anchors (TASKS.md open rows, harness-adapter-spec.md NEXT slices) with an explicit "do not chase" note. The LIVE z.ai cron payload still carries the old text — only the Owner can edit the job chat-side (never touched from here).
- FixNote r671 appended. GATES: tsc=RC lint=RC (WARN warnings, baseline 33); fixture qa-gate-census 25/25 re-run as a gate; console=CERRS page-errors=PERRS. BUDGET: 7 rounds.

Stage Summary:
- Gate health is now readable at THREE zoom levels: call-log note colors (r659) → per-run chip tones (r669/r670) → board digest aggregate (r671), all fed by the ONE gate-census adapter.
- The patrol template no longer points future rounds at ghost backlog rows (doc side; live cron payload is Owner-side).

Round Handoff:
Round ID: r672 -> next patrol (job 473388)
Next recommended action: (1) Watch the digest ⚖ chip's tone flip live when the next verdict lands (any run with a fresh judge answer turns it emerald/amber — a free witness readout, no extra eval needed). (2) Radar chips witness on the next registry finding. (3) Owner-witnessed vault restore happy path (unchanged). (4) Optional calm-window: live crew-run peer-blind-score witness (TASKS.md P2 peer-blind row). Driver notes: digest aggregate = boardGates memo in run-kanban.tsx (mirrors boardHarness — if the columns/visible shape changes, review BOTH memos); adapter unchanged (fixture 25/25 is the pin).
Blockers: none. Owner queue: the cron job 473388's message text still carries the stale TASK-101/102 clause — Owner-side edit whenever convenient; harmless until then.
WEOF
echo "worklog appended"

if [ "$TRC" -eq 0 ] && [ "$WARNS" -eq 33 ] && [ "$CERRS" -eq 0 ] && [ "$PERRS" -eq 0 ]; then
  git add -A
  git commit -q -m "r671: board digest gains gate-health aggregate (boardGates memo, mirrors r649 boardHarness) — '⚖ 5 gate calls · 4 verdicts · 2 latest-FAIL' live on first render, amber/emerald/muted by the r670 tone contract aggregated to scan level; ⚖ chips gain transition-colors; cron-template stale TASK-101/102 refs reworded to real anchors (live z.ai payload is Owner-side); golden QA 3/3 live incl palette aria-label route + 2220-char step paste; FixNote r671; fixture 25/25; tsc 0, lint 0/33, console 0"
  git push -q origin main && git push -q fork main && echo SHIPPED_BOTH_REMOTES
else
  echo "GATES_FAILED_NO_SHIP (tsc=$TRC warns=$WARNS cerrs=$CERRS perrs=$PERRS)"
fi
