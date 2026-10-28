#!/usr/bin/env python3
"""r706: close the LAST known order relic + append the r706 FixNote.

Phase 1 — swap the adjacent r696/r695 single-line entries into ascending
order (r705's queued finding: display #7/#8 read r695 above r696 because
the array held r696 before r695 — the same pre-r703 scramble relic class
one position earlier than r704's r698→r697 pair). Same guards as r705's
proven swap: exactly-one round-label lookup, adjacency assertion,
line-multiset identity. NO PARSER (the r704 lesson stands).
Phase 2 — append the r706 FixNote after the r705 entry (array bottom =
panel top).

Run from repo root: python3 scripts/fixnote_swap_r705b.py
"""
from pathlib import Path

P = Path("src/components/nexus/settings/whats-fixed.tsx")

R706 = (
    '  { round: "r706", '
    'title: "The last order relic fell the same way — and the durability ledger\'s rows answer the pointer in full", '
    'detail: "r705\'s DOM audit caught one more descending pair the earlier witnesses had missed: receipts #7/#8 displayed r695 above r696 because the array held r696 before r695 — the same pre-r703 scramble relic class, one position earlier than r704\'s r698→r697 pair. Fixed with the proven mechanism: an exact adjacent-line swap guarded by an exactly-one round-label lookup, an adjacency assertion, and a line-multiset identity — no parser touched the array (the r704 lesson stands). Companion polish: the durability ledger\'s three rows brightened only their icons on hover (r698); the row text now deepens with them on the same r690 fade clock, so the cursor-help promise reads across the whole row.", '
    'lookFor: "Settings → What\'s fixed: the first eight chips read r706 down to r696 in strict newest-first order (r695 at #9, fully ordered); Settings → automation vault at 0 stored: hovering a durability row deepens its text alongside its icon (witness rides with the r705 button\'s owed empty-vault render)." },\n'
)

original = P.read_text()
lines = original.splitlines(keepends=True)

# ── Phase 1: swap r696 <-> r695 ──────────────────────────────────────────
i696 = [i for i, l in enumerate(lines) if 'round: "r696"' in l]
i695 = [i for i, l in enumerate(lines) if 'round: "r695"' in l]
assert len(i696) == 1, f"ABORT: expected exactly one r696 entry line, got {i696}"
assert len(i695) == 1, f"ABORT: expected exactly one r695 entry line, got {i695}"
i696, i695 = i696[0], i695[0]
assert i695 == i696 + 1, f"ABORT: not adjacent (r696 before r695) — r696@{i696 + 1}, r695@{i695 + 1}"

lines[i696], lines[i695] = lines[i695], lines[i696]
assert (
    'round: "r695"' in lines[i696] and 'round: "r696"' in lines[i695]
), "ABORT: post-swap identity failed"
assert sorted(original.splitlines()) == sorted(
    "".join(lines).splitlines()
), "ABORT: swap changed more than the two lines (multiset mismatch)"
print(f"phase 1 OK: swapped r696@{i696 + 1} <-> r695@{i695 + 1} (multiset identical)")

# ── Phase 2: append the r706 note after the r705 entry ──────────────────
snap = "".join(lines)
i705 = [i for i, l in enumerate(snap.splitlines(keepends=True)) if 'round: "r705"' in l]
assert len(i705) == 1, f"ABORT: expected exactly one r705 entry line, got {i705}"
i705 = i705[0]
nxt = lines[i705 + 1].strip() if i705 + 1 < len(lines) else ""
assert nxt.startswith("]"), (
    f"ABORT: r705 is not the array tail — next line is {nxt[:60]!r}"
)

lines.insert(i705 + 1, R706)
after = "".join(lines)
assert sorted(snap.splitlines() + [R706.rstrip("\n")]) == sorted(
    after.splitlines()
), "ABORT: append changed more than the inserted line (multiset mismatch)"

P.write_text(after)
print(f"phase 2 OK: r706 note inserted after r705@{i705 + 1}; file written")
