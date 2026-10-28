#!/usr/bin/env python3
"""r708: append the r708 FixNote after r707 (array bottom = panel top)."""
from pathlib import Path

P = Path("src/components/nexus/settings/whats-fixed.tsx")

R708 = (
    '  { round: "r708", '
    'title: "The egress card stops re-dialing Webshare on every refresh — and the Cortex local-fallback gets a designed P1", '
    'detail: "The Owner\'s r707 finding stood: every card open past the server\'s 60s pool cache was a real Webshare dial for data that moves slowly (30 proxies, stable countries). The mount path now carries a 5-minute sessionStorage freshness stamp (the r672 cortex pattern): within the window the pool summary renders from the cached truth and /api/egress/status is not fetched at all; the explicit token save/clear paths force a fresh dial (a new token must load a new pool), and the token preview + routing map stay cheap local GETs. Verified by a two-mount network-delta witness: zero new status calls across a reload, pool text rendering from cache. Second ship — the Cortex local-fallback transport is DESIGNED and tracked as a P1 in docs/strategy/TASKS.md (the Owner\'s kickbot-corpus ask): the Upstash trio (Vector / QStash / Box) is plain REST, dialable server-side with zero Supabase deployment, with the census chip naming WHICH transport answered per lane and Redis staying edge-secret-only by design; the kickbot drive-folder corpus gets read before any code.", '
    'lookFor: "Settings → Egress: open the card and refresh — the pool summary renders instantly from the session stamp and no /api/egress/status dial follows within 5 minutes; docs/strategy/TASKS.md carries the Cortex local-fallback P1 with its acceptance criteria." },\n'
)

t = P.read_text()
lines = t.splitlines(keepends=True)
idx = [i for i, l in enumerate(lines) if 'round: "r707"' in l]
assert len(idx) == 1, f"r707 anchors: {idx}"
i = idx[0]
assert lines[i + 1].strip().startswith("]"), "r707 is not the array tail"
lines.insert(i + 1, R708)
out = "".join(lines)
assert sorted(t.splitlines() + [R708.rstrip("\n")]) == sorted(out.splitlines()), "multiset mismatch"
P.write_text(out)
print("r708 note appended after r707; file written")
