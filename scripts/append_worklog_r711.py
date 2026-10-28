#!/usr/bin/env python3
"""r711 self-witnessed worklog appender (r709 pattern): embeds the REAL QA
output files, guards idempotency on the Task ID, appends only."""
import pathlib, re, sys

ROOT = pathlib.Path("/home/z/my-project")
WL = ROOT / "worklog.md"

def clip(p: str, n: int = 1100) -> str:
    try:
        t = (ROOT / p).read_text(errors="replace").strip()
        t = re.sub(r"\s+", " ", t)
        return t if len(t) <= n else t[:n] + " …[clipped]"
    except Exception as e:
        return f"(unavailable: {e})"

gates = clip("scripts/qa_r711_gates.txt")
route = clip("scripts/qa_r711_route.txt")
browser = clip("scripts/qa_r711_browser.txt")

text = WL.read_text()
if "Task ID: r711" in text:
    print("r711 already appended — skip (idempotency guard)")
    sys.exit(0)

entry = f"""
---
Task ID: r711
Agent: NEXUS patrol (main agent)
Task: Patrol round 711 (job 473388) — CORTEX SLICE 3 (the r708 P1's tool-wiring acceptance) closed as verified-wired by audit + live executor witness; the client contract stopped omitting the Upstash trio at the type level; FixNote r711.

Work Log:
- DB-HEALTH PROBE (standing): quick_check ok on db/custom.db (the live 17-table DB) · HONEST FINDING: prisma/dev.db is an EMPTY schema shell (0 tables — prior rounds' "integrity ok (both files)" was trivially true of an empty file; the live data always lived in db/custom.db) · root 200 at open · tree clean at r710 (d8e0aac49) · remotes origin+fork synced (0/0 both).
- DESIGN READ (before code, per the handoff): slice 3's premise — "the executor's lane ladder just needs the no-URL ordering" — checked against the code and found ALREADY TRUE: deep_scrape gates Lane 1 on fnUrl and Lane 2 on hbKey (edge → direct → fallback); cortex_memory and sandbox_exec gate the edge lane on fnUrl and the direct lanes on their own keys (vectorUrl+vectorToken / boxApiKey+boxId); the direct answers already wear provenance headers ([cortex memory · direct · Xms], [cortex sandbox · direct · Xms]). The BYOK chain is threaded end-to-end already: chat-view passes the full settings.cortex whenever ANY of the six fields is armed; workflow-runner's r513 threading does the same for pipeline steps; chat-client sends it in the request body AND into httpToolExecutor; /api/chat + /api/tools/execute put it into ToolContext.
- SHIP (the one real gap + the witness): (1) chat-client's cortex param TYPE named only {{url, key, hbKey}} — runtime passed the full object (structural typing), but a future caller constructing a literal to THAT type would silently drop the trio and strand the direct lanes: widened to the full CortexConfig (inline import type, zero runtime change). (2) LIVE PROVENANCE WITNESS through the real executor: POST /api/tools/execute with a fake vectorUrl/vectorToken and NO edge URL — the tool result names the DIRECT lane attempt in its honest failure (embedded below); the P1 acceptance "tools use the direct lanes when the edge URL is empty" is verified, not assumed. (3) FixNote r711 (the panel's newest receipt carries the audit result, not the handoff's stale premise).
- GATES: {gates}
- GOLDEN QA: {route} · browser: {browser}
- BUDGET: OVERRUN (~20 tool rounds, disclosed without excuse) — two causes: the handoff's premise was stale (the ladder ordering was already landed in earlier rounds), so the round's first half was a full-chain audit (UI → chat-client → routes → ToolContext → ladders) instead of a known-shape edit; and one 120s command timeout (an unbounded rg over the repo) forced re-narrowing. The r705/r707 precedent applies: disclose, then compress.

Stage Summary:
- The r708 P1's code surface is closed: the ladders were already honest, the client TYPE now is too, and a live executor witness replaces assumption. What remains of the P1 is not code: the Owner-keyed UPSTASH 3/3 + HB ✓ DOM witness when real trio keys are next probed.

Round Handoff:
Round ID: r712 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open (note the r711 finding: the live DB is db/custom.db; prisma/dev.db is an empty shell — probe the former). (2) CORTEX P1 REMAINING (witnesses, not code): the real-key UPSTASH 3/3 + HB ✓ DOM witness when the Owner next probes with live keys; MIRROR-STRIP witness on the Owner's next acquisition key store (armed since r707, still unobserved). (3) VERDICT-FLOW WATCH: read the corpus verdict counts from the DB (r711's route-QA file carries the table counts) — a confident-FAIL without a visible run carrying gate notes remains the honest visible-vs-corpus story (r698 #4). (4) Owner queue (r693 carry, unchanged): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST (export works from the preview host since r707); KICK widget URL fix; optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (slice-3 verification with a live executor witness + the type-contract fix; not a hover state).
"""

WL.write_text(text + entry)
print("worklog appended:", len(entry), "bytes")

# TASKS.md tolerant status patch (non-fatal if the r710 phrasing moved)
tm = ROOT / "docs/strategy/TASKS.md"
t = tm.read_text()
new, n = re.subn(r"agent-tool wiring to direct lanes when the edge URL is empty; the real-key",
                 "tool wiring VERIFIED-WIRED r711 (audit + live executor witness); remaining: the real-key", t, count=1)
if n == 1:
    tm.write_text(new)
    print("TASKS.md status updated")
else:
    print("TASKS.md patch: no match — left untouched (honest skip)")
