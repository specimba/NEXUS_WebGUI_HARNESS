#!/usr/bin/env python3
"""r709: append the round section to worklog.md — self-witnessing (embeds the
ACTUAL route/browser QA outputs captured by the commit chain into
scripts/qa_r709_route.txt + scripts/qa_r709_browser.txt). Append-only,
idempotence-guarded (r703/r705 lessons: file-based scripts, no heredocs)."""
import json
import re
from pathlib import Path

ROOT = Path("/home/z/my-project")
WL = ROOT / "worklog.md"
ROUTE_TXT = ROOT / "scripts" / "qa_r709_route.txt"
BROWSER_TXT = ROOT / "scripts" / "qa_r709_browser.txt"

text = WL.read_text(encoding="utf-8")
if "Task ID: r709" in text:
    print("r709 section already present — no append (idempotence guard)")
    raise SystemExit(0)


def route_witness() -> str:
    if not ROUTE_TXT.exists():
        return "(route witness file missing — disclosed)"
    raw = ROUTE_TXT.read_text(encoding="utf-8", errors="replace")
    bad = empty = "?"
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    for i, l in enumerate(lines):
        if l.startswith("ROUTE_BADCREDS:") and i + 1 < len(lines):
            bad = lines[i + 1][:220]
        if l.startswith("ROUTE_EMPTY:") and i + 1 < len(lines):
            empty = lines[i + 1][:160]
    return f"bad-creds dials → {bad} · empty config → {empty}"


def browser_witness() -> str:
    if not BROWSER_TXT.exists():
        return "(browser witness file missing — disclosed)"
    raw = BROWSER_TXT.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"WITNESS:(\{.*\})", raw)
    if not m:
        return f"(no WITNESS line captured — raw tail: {raw[-200:]!r})"
    try:
        d = json.loads(m.group(1))
    except Exception:
        return f"(witness JSON unparsable — raw: {m.group(1)[:200]})"
    cl = d.get("cortexLines") or []
    chips = d.get("fixChips") or []
    chip_ok = bool(cl) and any("DIRECT" in x for x in cl)
    fix_ok = bool(chips) and chips[0] == "r709"
    return (
        f"census lines {cl[:3]} (DIRECT named: {chip_ok}) · "
        f"whats-fixed head chips {chips[:4]} (r709 first: {fix_ok})"
    )


section = f"""---
Task ID: r709
Agent: NEXUS patrol (main agent)
Task: Patrol round 709 (job 473388) — CORTEX LOCAL-FALLBACK FIRST SLICE (the r708 tracked P1): the census names its transport; the edge-less Upstash trio is probed by the app's own server instead of being reported dead

Work Log:
- DB-HEALTH PROBE (standing): malformed 0 · integrity ok (db/custom.db, prisma/dev.db) · root 200 at open · tree clean at r708 (432d63057).
- DESIGN READ (before any code, per the handoff): cortex-census.ts (persisted verdict, HUD label, r672 doctrine), the card's probe flow, and probeCortexEdge — the wall found: `if (!url) return {{ ok:false, "No function URL configured" }}` short-circuits BEFORE the Upstash trio is ever dialed, so armed Vector/QStash/Box configs read 0/6 lanes forever. The lib's own lane ladders already document direct Upstash REST lanes (cortexMemory / cortexSandbox) — only the PROBE ignored them.
- SHIP (the slice, r708 P1 acceptance step 1): (1) NEW src/app/api/cortex/probe-direct/route.ts — the app's OWN server dials the trio (Vector POST ["INFO"], QStash GET /v2/topics, Box GET /2.0/users/me), each 4s-budgeted, never-throw, booleans-only response (no secrets ride back; the BYOK body is transient, never persisted or logged); (2) probeUpstashDirect exported from cortex-edge.ts and the no-URL probe branch now asks the same-origin route instead of dying (no trio config at all → the old honest verdict stands); (3) a transports map (edge | upstash-direct | off) flows CortexProbeResult → persisted census → tolerant readCortexProbe parse → cortexCensusOf; (4) the census LINES name the transport: chip `CORTEX // DIRECT · n/3` (or `OFFLINE · EDGE OFF · UPSTASH n/3` when nothing answered) and HUD `CORTEX // DIRECT · UPSTASH 2/3 · 214MS · 1m` — no silent fallbacks, every lane says how it answered; edge verdicts attach transports "edge" and keep the classic ONLINE line (fixture-guarded against DIRECT leakage); (5) the Function URL helper text now tells the truth about what empty means. The browser NEVER CORS-fights Upstash/Box — the dials ride the same-origin server route (the doctrine's server-side lanes). Redis stays edge-secret-only; Hyperbrowser direct is slice 2.
- FIXTURES: scripts/qa-cortex-census.ts 20/20 (was 15) — direct-online line exact, direct-offline EDGE OFF + UPSTASH 0/3 + PROBED JUST NOW, edge-classic guard, transports census counting; the localStorage round-trip skips honestly in node (browser QA covers it).
- QA + INCIDENT (disclosed): the dev server was DOWN at golden-QA time (curl empty + browser ERR_CONNECTION_REFUSED after the round-1 root:200) — ONE scripts/dev-restart.sh restart per the harness rule, then witnesses re-run. ROUTE WITNESS (real dials, bad creds → honest false expected): {route_witness()}. BROWSER CENSUS WITNESS (injected direct verdict, reload): {browser_witness()}.
- GATES: tsc 0 (direct binary) · lint 0 errors / 33 warnings EXACT · fixture 20/20 · BUDGET: 12 rounds — at the cap, disclosed (the server-down incident consumed the slack).

Stage Summary:
- The Cortex card no longer reports the Owner's armed Upstash trio as dead: the census names the transport that answered — or honestly says EDGE OFF · UPSTASH 0/3 when none did. The r708 P1's first code is in, doctrine intact (no silent fallbacks, Redis edge-only, BYOK transient).

Round Handoff:
Round ID: r710 -> next patrol (job 473388)
Next recommended action: (1) DB-HEALTH PROBE standing at open. (2) CORTEX SLICE 2: the Hyperbrowser direct probe lane (edge-or-direct per the TASKS.md P1), per-lane transport glyphs in the probe matrix, and — when the Owner next probes with real trio keys — the UPSTASH 3/3 DOM witness (this round's witnesses: fixture 20/20 + bad-creds route dials + injected-verdict chip). (3) FixNote r709 DOM witness: the What's-fixed panel's first chip should read r709 (witnessed this round if the browser witness above says r709 first: True). (4) MIRROR-STRIP WITNESS (arms on the Owner's next acquisition key store) — unchanged from r708. (5) VERDICT-FLOW WATCH: verdicts 7 / fails 2 baseline. (6) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; per-run ledger read proposal (r683); vault re-key BACKUP-FIRST (export works from the preview host since r707); KICK widget URL fix; optional v29c-f re-download.
Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (this round is the r708 P1's first code, not a hover state).
"""

with WL.open("a", encoding="utf-8") as f:
    f.write(section)
print("r709 section appended:", len(section), "chars")
