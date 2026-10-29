#!/usr/bin/env python3
"""r714 self-witnessed worklog appender (r709 pattern): embeds the REAL QA
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

gates = clip("scripts/qa_r714_gates.txt")
browser = clip("scripts/qa_r714_browser.txt")

text = WL.read_text()
if "Task ID: r714" in text:
    print("r714 already appended — skip (idempotency guard)")
    sys.exit(0)

entry = f"""
---
Task ID: r714
Agent: NEXUS patrol (main agent)
Task: Patrol round 714 (job 473388) — the r713 tone surface PINNED in the gate-census fixture (dial-free, the r670 doctrine) and the per-run chip tooltips learn the same u/nj decode the board already carries; the watch shows uncertain growing (25→30), no-judge stable

Work Log:
- DB-HEALTH PROBE (standing): quick_check ok on db/custom.db · root 200 at open · tree clean at r713 (d3d463816).
- VERDICT-FLOW WATCH (re-read at open): gate-verdict 30 → 31, gate-uncertain 25 → 30 (+5 in ~30 min — the corpus is talking), gate-no-judge 8 stable. The r713 handoff's alarm condition was no-judge GROWTH (free-ladder quotas); uncertain growth is a different signal — judges ANSWERING but below confidence — noted, not alarmed.
- DESIGN READ (before code): scripts/qa-gate-census.ts (the r670/r692 fixture) pinned engaged/verdicts/verdictLine/verdictTone/latestAt but predated the r713 tones — the new fields shipped guard-verified only. The per-run chips (kanban + panel) carried rich tooltips that predate u/nj: the kanban one already said "no judge answered or judge errored" in prose but never decoded the suffix letters.
- SHIP: (1) fixture extension — 9 new checks: mixed-run sums (verdicts confident-only=1, engaged=3, uncertain=1, noJudge=1, last-verdict-wins tone), empty-shape zeros, uncertain-alone / no-judge-alone are NOT verdicts, junk-row tolerance with the new patterns; (2) per-run tooltip decode (both surfaces): "The u suffix counts judges that answered below confidence (uncertain); nj counts steps no judge answered — the step ran ungated" — one vocabulary, three surfaces (card chip, panel chip, board chip); (3) FixNote r714.
- GATES: {gates}
- GOLDEN QA: {browser}
- BUDGET: ~7 rounds — a fixture variable collision (my inserted const mixed vs the r670 pre-existing one at line 111) was caught by tsc and renamed scoped to the inserted block; PIPESTATUS capture added so a piped tsc can never mask a failure again — the persisted-scripts pipeline held.

Stage Summary:
- The r713 mechanism is now regression-pinned and its vocabulary decoded everywhere it renders. The watch has a new sub-signal to track: UNCERTAIN growth (judges answering below confidence) vs NO-JUDGE growth (quota-dead ladders) — different failure classes, different first suspects.

Round Handoff:
Round ID: r715 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open (db/custom.db — prisma/dev.db is an empty shell). (2) CORTEX P1 REMAINING (witnesses, not code): the real-key UPSTASH 3/3 + HB ✓ DOM witness when the Owner next probes with live keys; MIRROR-STRIP witness on the next acquisition key store (armed since r707, still unobserved). (3) VERDICT-FLOW WATCH: baseline gate-verdict 31 · uncertain 30 (GROWING — if it keeps climbing, inspect WHAT the judges answer below confidence on: the fast-ladder's threshold or the step difficulty mix; different fix class than quota) · no-judge 8. (4) Owner queue (r693 carry, unchanged): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST; KICK widget URL fix (no definition in-repo — needs the Owner's r693 context); optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (fixture pin + tooltip completion are the r713 mechanism's own hardening, not hover polish).
"""

WL.write_text(text + entry)
print("worklog appended:", len(entry), "bytes")
