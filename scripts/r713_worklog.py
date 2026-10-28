#!/usr/bin/env python3
"""r713 self-witnessed worklog appender (r709 pattern): embeds the REAL QA
output files, guards idempotency on the Task ID, appends only."""
import pathlib, re, sys

ROOT = pathlib.Path("/home/z/my-project")
WL = ROOT / "worklog.md"

def clip(p: str, n: int = 1000) -> str:
    try:
        t = (ROOT / p).read_text(errors="replace").strip()
        t = re.sub(r"\s+", " ", t)
        return t if len(t) <= n else t[:n] + " …[clipped]"
    except Exception as e:
        return f"(unavailable: {e})"

gates = clip("scripts/qa_r713_gates.txt")
browser = clip("scripts/qa_r713_browser.txt")

text = WL.read_text()
if "Task ID: r713" in text:
    print("r713 already appended — skip (idempotency guard)")
    sys.exit(0)

entry = f"""
---
Task ID: r713
Agent: NEXUS patrol (main agent)
Task: Patrol round 713 (job 473388) — the ⚖ gate chips stop hiding silently-ungated steps: the shared census adapter carries uncertain (u) and no-judge (nj) tones additively, per-run and board chips surface them only when nonzero; the watch re-read shows the corpus still growing

Work Log:
- DB-HEALTH PROBE (standing): quick_check ok on db/custom.db · root 200 at open · tree clean at r712 (7edcb3cb1).
- VERDICT-FLOW WATCH (re-read at open): gate-verdict 26 → 30 in ~30 min (the corpus grows live — a scheduled run landed verdicts between rounds), uncertain 25, no-judge 8 stable. The growth confirmed the watch's value AND exposed this round's gap: those 33 soft tones were invisible on every chip.
- DESIGN READ (before code): gate-census.ts's gateCensusOf counts only GATE_ENGAGE_PREFIX/GATE_VERDICT_PREFIX heads (engaged + confident verdicts + latest verdict line); the extractGateEvents ledger side already parses "Decision gate uncertain N%" and "no judge answered" (the r672 event vocabulary) — so the COUNTS existed in the adapter's own module but never in the census shape. The three render sites: per-run chips (run-kanban + workflow-run-panel, identical template literals) and the board chip (a useMemo reduce summing per-run censuses).
- SHIP (the adapter first, r649 doctrine — both chips read one mapping): (1) GateCensus gains uncertain + noJudge (counted in the same engage branch via the UNCERTAIN_RE / "no judge answered" patterns — uncertain rows are engagements too, so the engaged math is untouched); (2) the board reduce sums both across visible runs; (3) the per-run chips render `· Nu` / `· Nnj` suffixes ONLY when nonzero (a fully-judged run's chip is byte-identical to before); (4) the board chip gains the same suffixes and its tooltip decodes the letters (u = judge answered below confidence; nj = no judge answered — the step ran ungated, the honest alarm); (5) FixNote r713. No census math changed — verdicts stay confident-only.
- GATES: {gates}
- GOLDEN QA: {browser}
- BUDGET: ~8 rounds — the persisted-scripts pipeline (guarded edits → gates+browser chain → self-witnessed worklog) held it well under the cap this time.

Stage Summary:
- A run whose judge never answered no longer looks like a clean pass: the ungated tones are visible exactly where the confident verdicts already were, additively, with zero change to the verdict math. The watch's own numbers (30/25/8) are the new baseline.

Round Handoff:
Round ID: r714 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open (db/custom.db — prisma/dev.db is an empty shell). (2) CORTEX P1 REMAINING (witnesses, not code): the real-key UPSTASH 3/3 + HB ✓ DOM witness when the Owner next probes with live keys; MIRROR-STRIP witness on the next acquisition key store (armed since r707, still unobserved). (3) VERDICT-FLOW WATCH: baseline now gate-verdict 30 (PASS/FAIL split re-read at open) + 25 uncertain + 8 no-judge — if no-judge grows, the free-ladder quotas are the first suspect (r713 handoff note). (4) NJ/U CHIP WITNESS: the chips render only when nonzero — the DOM witness needs a run with an ungated step; if the corpus holds none, the fixture-level pin (adapter unit shapes) is the honest substitute. (5) Owner queue (r693 carry, unchanged): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST; KICK widget URL fix (no definition found in-repo as of r712 — needs the Owner's original context); optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the census adapter extension is mechanism, not polish).
"""

WL.write_text(text + entry)
print("worklog appended:", len(entry), "bytes")
