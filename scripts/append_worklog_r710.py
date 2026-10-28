#!/usr/bin/env python3
"""r710: append the round section to worklog.md — self-witnessing (embeds the
ACTUAL browser-QA outputs captured by the commit chain into
scripts/qa_r710_browser.txt). Append-only, idempotence-guarded (r703+ lessons:
file-based scripts, no heredocs, never pre-claim unrun QA)."""
import json
import re
from pathlib import Path

ROOT = Path("/home/z/my-project")
WL = ROOT / "worklog.md"
BROWSER_TXT = ROOT / "scripts" / "qa_r710_browser.txt"

text = WL.read_text(encoding="utf-8")
if "Task ID: r710" in text:
    print("r710 section already present — no append (idempotence guard)")
    raise SystemExit(0)


def browser_witness() -> str:
    if not BROWSER_TXT.exists():
        return "(browser witness file missing — disclosed)"
    raw = BROWSER_TXT.read_text(encoding="utf-8", errors="replace")
    out = []
    m = re.search(r"WITNESS:(\{.*\})", raw)
    if m:
        try:
            d = json.loads(m.group(1))
            cl = d.get("cortexLines") or []
            chips = d.get("fixChips") or []
            # the census chip/HUD line = a CORTEX // line containing UPSTASH
            hud = [x for x in cl if "UPSTASH" in x]
            out.append(f"census HUD line(s): {hud[:2] or '(none matched)'}")
            out.append(f"whats-fixed head chips: {chips[:4]} (r710 first: {bool(chips) and chips[0] == 'r710'})")
        except Exception:
            out.append(f"(witness JSON unparsable: {m.group(1)[:160]!r})")
    relay = re.search(r'"relay:(.*?)"', raw)
    if relay:
        out.append(f"model-relay leg: {relay.group(1)[:180]}")
    fr = re.search(r'"(frontier-[a-z-]+)"', raw)
    out.append(f"radar frontier leg: {fr.group(1) if fr else '(not witnessed — disclosed)'}")
    wf = re.search(r'"workflows[^"]*"', raw)
    out.append(f"workflows leg: {wf.group(0) if wf else '(not witnessed — disclosed)'}")
    ce = re.search(r"CONSOLE_ERRS:(\w+)", raw)
    if ce:
        out.append(f"console errors: {ce.group(1)}")
    return " · ".join(out) if out else "(no witness lines parsed — raw tail disclosed in scripts/qa_r710_browser.txt)"


section = f"""---
Task ID: r710
Agent: NEXUS patrol (main agent)
Task: Patrol round 710 (job 473388) — CORTEX LOCAL-FALLBACK SLICE 2: the Hyperbrowser key gets its direct auth verdict (live-verified status-code matrix first), every armed lane wears its transport pill, the census line gains the HB tag; QA legs re-witnessed with fixed locators

Work Log:
- DB-HEALTH PROBE (standing): malformed 0 · integrity ok (db/custom.db, prisma/dev.db) · root 200 · tree clean at r709 (c4acafbf0).
- DESIGN READ (before code): the card's probe matrix (LANE_CHIPS render) and the lib's HB direct lane — POST-only (/web/search, /web/crawl with x-api-key), no free authenticated GET in use. LIVE STATUS-CODE MATRIX BEFORE CODE: api.hyperbrowser.ai/api/user/credits 401s with a junk key AND with no key (root too) — the route exists and pre-auth rejects, so res.ok with a key is an honest credential-accepted verdict, and a credits read consumes no scrape/search quota. The r709 doctrine carries over unchanged: the lane answers or it did not.
- SHIP (slice 2, r708 P1 acceptance continues): (1) probeUpstashDirect dials a fourth lane — GET ${{HB_BASE}}/user/credits with x-api-key, 4s budget, never-throw; (2) the no-URL probe branch includes hbKey in the dial set (anyTrio) and in the transient BYOK body; the route forwards it; (3) the census line gains the HB tag — `CORTEX // DIRECT · UPSTASH 2/3 · HB ✓ · 512MS` (trio count stays trio-only; lanes booleans now pass through the census for the ✓/✗); HB ✗ when the key was rejected; (4) per-lane TRANSPORT PILLS in the probe matrix — every armed lane wears violet "direct" (server dialed with the BYOK key) or zinc "edge" (the edge secret answered), r690 fade clock — the matrix can no longer imply an edge answer where a direct one came; (5) the probe ok-badge is transport-honest: "Direct online (server lanes)" when no edge function was involved. Transport union extended ("direct" for HB) with the census fixtures pinning the new line shapes.
- FIXTURES: qa-cortex-census 23/23 (was 20) — HB-online line exact (UPSTASH 1/3 · HB ✓ · 512MS · 1m), HB-offline (UPSTASH 0/3 · HB ✗ · PROBED JUST NOW), the r709 trio-only shapes still green (no tag leakage).
- TASKS.md: the P1 entry now carries its STATUS — slice 1 r709, slice 2 r710, remaining named (agent-tool wiring to direct lanes when the edge URL is empty; the real-key UPSTASH 3/3 DOM witness awaits the Owner's live trio keys).
- GOLDEN QA: {browser_witness()}
- GATES: tsc 0 (direct binary) · lint 0 errors / 33 warnings EXACT · fixture 23/23 · BUDGET: on pace (the r709 12-round cap taught the final compression: witnesses captured by the commit chain, appended self-witnessed).

Stage Summary:
- Every armed Cortex lane now names HOW it answered — edge or direct, HB included — and the census math stays honest (UPSTASH trio-only, HB tagged separately). The local-fallback P1's remaining work is tool wiring plus the Owner's real-key witness, both named in TASKS.md.

Round Handoff:
Round ID: r711 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open. (2) CORTEX SLICE 3 (the P1's remaining code, per TASKS.md): wire the agent TOOLS — cortexMemory / cortexSandbox / cortexDeepScrape should use the direct lanes when the edge URL is empty instead of stopping at the edge attempt (the direct implementations already exist in the lib; the executor's lane ladder just needs the no-URL ordering), with the provenance header naming the transport. (3) FixNote r710 DOM witness rides in this round's browser file (r710 first chip). (4) MIRROR-STRIP WITNESS (arms on the Owner's next acquisition key store) — unchanged. (5) VERDICT-FLOW WATCH: verdicts 7 / fails 2 baseline. (6) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST; KICK widget URL fix; optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (slice 2 is P1 code with a live-verified probe target, not polish).
"""

with WL.open("a", encoding="utf-8") as f:
    f.write(section)
print("r710 section appended:", len(section), "chars")
