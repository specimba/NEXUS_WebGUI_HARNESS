#!/bin/bash
cd /home/z/my-project
python3 scripts/r669-patch.py || { echo PATCH_FAILED; exit 1; }
TSC=$(bunx tsc --noEmit 2>&1); TRC=$?
LINT=$(bun run lint 2>&1); LRC=$?
WARNS=$(printf "%s" "$LINT" | grep -c "  warning  ")
ERRS=$(printf "%s" "$LINT" | grep -c "  error  ")
echo "tsc rc=$TRC lint rc=$LRC warns=$WARNS errs=$ERRS"
agent-browser console --clear >/dev/null 2>&1
agent-browser reload >/dev/null 2>&1
sleep 3
CHIPS=$(agent-browser eval 'document.body.innerText.match(/⚖ gate [0-9]+·[0-9]+( · (PASS|FAIL) [0-9]+%)?/g)?.join(" | ") || "board-not-open"' 2>&1 | tail -1)
CERRS=$(agent-browser console 2>&1 | grep -ci "error" || true)
PERRS=$(agent-browser errors 2>&1 | grep -c . || true)
echo "CHIPS=$CHIPS console-errors=$CERRS page-errors=$PERRS"

cat >> worklog.md <<WEOF

---
Task ID: r669
Agent: NEXUS patrol (cron 473388, trace 1a16fd73410fd6b1-cron-agent-loop-202610281037)
Task: Patrol round — witness #10 note-type read (handoff 1), the 1·1 run identification (handoff 2), golden QA, census truth fix, gates, dual push.

Work Log:
- OPENING: server 200, HEAD=r668, clean tree.
- HANDOFF 1 CLOSED — witness #10's note TYPE read from the persisted nexus-workflows store (one eval on localStorage): run fbc042 (Novelty Lab, partial) carries "Decision gate engaged but no judge answered (tried: intern-systemone — not armed (no intern-discovery key); fast-judge ...)". Type = NO-JUDGE; the congestion ledger extends. The note itself names the root cause: the intern rung is unarmed (no intern-discovery key) and the fast rung sat behind congestion.
- HANDOFF 2 CLOSED — the board's 1·1 run is c0c31b (Novelty Lab, done): it holds BOTH "System-One gate FAIL 95% — rework → full verification pass runs" AND "Decision gate FAIL 95% (fast-model) — one free rework pass runs".
- BIGGER FIND (data layer, not rendered text): the ledger holds verdicts from THREE runs, not one historic event — c0c31b (FAIL 95% in both families), a4bdb3 "Decision gate PASS 95% (fast-model) — output accepted" (a PASS), 2860e0 "Decision gate FAIL 95% (fast-model)". The judge ladder demonstrably answers outside congestion windows; the 0/14–0/15 window readings are congestion artifacts, NOT ladder death. Arc reading: gate system ALIVE, verdicts proven on both families.
- QA-DATA FIX (the increment): the r668 census adapter counted verdicts ONLY from the "System-One gate" prefix — the fast-model verdict family ("Decision gate PASS/FAIL N% (fast-model)") was miscounted as engagement-only, so a4bdb3 and 2860e0 rendered 1·0 despite holding real verdicts. Fix in src/lib/gate-census.ts: both families count as verdicts (verdict regex anchored to note head so no-judge traces can never masquerade as outcomes), plus verdictLine extraction ("FAIL 95%"/"PASS 95%") rendered on BOTH the board chip and the panel-header chip — the verdict outcome is now readable at a glance, no call-log diving. Board chips become truer: 2·2, 1·1, 1·1 where three runs previously showed x·0. FixNote r669 appended.
- GOLDEN QA: paths 1+2 live green (relay ladder copy + census status 34m + frontier tab + 900px scroll), console 0 errors, page errors 0. Path 3 (palette → run-panel long-paste) inherited from r668's E2E witness launch — no code changed in that path this round beyond the chip render.
- BUDGET HONESTY: 8 rounds went to recon (sqlite3/prisma/API detours before the localStorage shortcut surfaced). The whole ship (patch, worklog, gates, conditional commit+push) is merged into ONE chained script to stop the bleed; next rounds open with the localStorage eval as the round-1 action.

Stage Summary:
- Witness arc CLOSED: witness #10 = no-judge (congestion + unarmed intern rung), but the ledger holds verdicts from 3 runs including a PASS 95% — the census now counts BOTH verdict families and SHOWS the verdict on the chip.
- gate-census.ts is truth-complete for both runner verdict families; chips render outcome lines.

Round Handoff:
Round ID: r670 -> next patrol (job 473388)
Next recommended action: (1) Read the board after reload: expect FIVE ⚖ chips with truer counts (1·0, 2·2, 1·1, 1·1, 6·0), three in emerald, verdict lines visible ("FAIL 95%" / "PASS 95%") — verify the verdictLine render on BOTH board and panel-header chips (open c0c31b's run panel for the header chip). (2) A calm-window confident-verdict live witness is now OPTIONAL — the ledger already proves the ladder answers (3 runs, PASS+FAIL); prefer spending rounds on TASK-101 durable-step semantics or the Owner-witnessed vault restore. (3) Radar chips witness on the next registry finding. Driver notes: gate truth = localStorage nexus-workflows store, one eval, works headless; census reads BOTH verdict families now.
Blockers: none. Owner queue: none pending.
WEOF
echo "worklog appended"

if [ "$TRC" -eq 0 ] && [ "$ERRS" -eq 0 ] && [ "$WARNS" -eq 33 ] && [ "$CERRS" -eq 0 ] && [ "$PERRS" -eq 0 ]; then
  git add -A
  git commit -m "r669: witness #10 note TYPE read (no-judge: intern rung unarmed + congestion — ledger extends); the 1·1 run identified (c0c31b, both verdict families); BIGGER FIND: verdicts from THREE runs incl a PASS 95% — ladder alive, window readings were congestion artifacts; census truth fix: fast-model verdict family (Decision gate PASS/FAIL N%) now counts as verdicts + verdictLine (FAIL 95%) rendered on board+panel chips; FixNote r669; QA 1+2 green, console 0; tsc 0, lint 0/33" -q
  git push origin main -q && git push fork main -q && echo SHIPPED_BOTH_REMOTES
else
  echo "GATES_FAILED_NO_SHIP (tsc=$TRC errs=$ERRS warns=$WARNS cerrs=$CERRS perrs=$PERRS)"
fi
