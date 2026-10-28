#!/usr/bin/env python3
"""r712 self-witnessed worklog appender (r709 pattern): embeds the REAL QA
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

gates = clip("scripts/qa_r712_gates.txt")
probe = clip("scripts/qa_r712_probe.txt")
browser = clip("scripts/qa_r712_browser.txt")

text = WL.read_text()
if "Task ID: r712" in text:
    print("r712 already appended — skip (idempotency guard)")
    sys.exit(0)

entry = f"""
---
Task ID: r712
Agent: NEXUS patrol (main agent)
Task: Patrol round 712 (job 473388) — the radar section tabs learn stable accessible names (the r705/r711 locator-friction root), the Cortex P1 backlog line stops claiming a wall r711 tore down, the verdict watch gets its real mapping; console-error verdict settled (accumulated session log, not shipped breakage)

Work Log:
- DB-HEALTH PROBE (standing): quick_check ok on db/custom.db (the live DB; prisma/dev.db is the r711-documented empty shell) · root 200 at open · tree clean at r711 (5b1e68386).
- CONSOLE-ERROR VERDICT (r711's open tail, closed): the 13× whats-fixed.tsx:742:1 module errors persist across opens but the current line 742 is a COMMENT — the count survives an about:blank → app re-open (session-scoped console buffer, not page-scoped), and tsc 0 + fixtures 23/23 + the page rendering with r711 as first chip all stand. VERDICT: accumulated stale-log entries from earlier rounds' mid-write compiles (the r710 class), not shipped breakage. The `agent-browser console` buffer is session-scoped — future rounds must read the error CLASS, not the count.
- VERDICT-FLOW WATCH (mapped properly this round): the r704 baseline "verdicts 7 / fails 2" is EvalEvent kind=gate-verdict — now 26 confident verdicts (21 PASS / 5 FAIL) + 25 gate-uncertain + 8 gate-no-judge. Corpus GROWN (7→26, 2→5), no regression signal; the visible-vs-corpus story (r698 #4) carries.
- DESIGN READ (before code): the radar tab bar's five TabsTriggers carried only visible text — accessible names were implicit and drift-prone (the r560 doctrine's exact hazard); the ONLY aria-label on the radar page was the TabsList wrapper ("Trend radar sections"). That is the root of BOTH r705's and r711's aria-miss friction. The "KICK widget URL fix" Owner-queue item was searched for a definition (src, worklog, docs): none exists in this repo — it stays in the Owner queue rather than being guessed at.
- SHIP: (1) five stable tab aria-labels (Radar tab: Models / GitHub Stars / HF Trending / Paper Radar / Frontier) — the toolbar-button convention from r560, applied to the section tabs; (2) TASKS.md cortex P1 STATUS corrected — "the executor still prefers edge" was DISPROVED by r711's audit + live witness; the line now says verified-wired with the witness named; (3) FixNote r712 (the panel's newest receipt carries both fixes + the watch mapping).
- GATES: {gates}
- QA: probe file (aria survey + fresh-tab console + verdict breakdown): {probe} · browser: {browser}
- BUDGET: ~12 at the cap — the compressed pipeline (persisted edit script → gates → browser → worklog) held it after r711's overrun.

Stage Summary:
- The locator-friction class is fixed at its root instead of worked around, the backlog tells the truth about the cortex ladder, and the verdict watch finally has a real mapping. No theatre: two mechanisms + one honest watch line.

Round Handoff:
Round ID: r713 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open (db/custom.db — prisma/dev.db is an empty shell). (2) CORTEX P1 REMAINING (witnesses, not code): the real-key UPSTASH 3/3 + HB ✓ DOM witness when the Owner next probes with live keys; MIRROR-STRIP witness on the next acquisition key store (armed since r707, still unobserved). (3) VERDICT-FLOW WATCH: gate-verdict 26 (21 PASS / 5 FAIL) + 25 uncertain + 8 no-judge is the new baseline — the 8 no-judge steps mean runs whose judge lane never answered; if that number grows, look at the free-ladder quotas before anything else. (4) Owner queue (r693 carry, unchanged): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST; KICK widget URL fix (NO definition found in this repo as of r712 — needs the Owner's original r693 context to act on); optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (stable-name mechanism at the friction root + backlog truth fix + the watch's real mapping).
"""

WL.write_text(text + entry)
print("worklog appended:", len(entry), "bytes")
