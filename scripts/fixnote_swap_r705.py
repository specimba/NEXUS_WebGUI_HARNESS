#!/usr/bin/env python3
"""r705: close the whats-fixed order remnant + append the r705 FixNote.

Two edits, one writer, abort-guarded at every step:
  Phase 1 — swap the ADJACENT single-line r698/r697 entries back into
            ascending array order (r704's known remnant). Exact line swap:
            round-label lookup, adjacency assertion, line-multiset identity
            before/after. Deliberately NOT the r703 block-parser, whose
            template-literal parity bug caused the r704 incident — the
            safest codemod is the one that parses nothing.
  Phase 2 — append the r705 FixNote directly after the r704 entry
            (array bottom = panel top per the r242 contract).

Run from repo root: python3 scripts/fixnote_swap_r705.py
"""
from pathlib import Path

P = Path("src/components/nexus/settings/whats-fixed.tsx")

R705 = (
    '  { round: "r705", '
    'title: "The durability ledger\'s backup row acts — and the last order remnant falls to a swap that parses nothing", '
    'detail: "The vault durability ledger (r698) told the backup story in prose only — its emerald row said the backup file is the bridge and pointed at a button elsewhere in the card. The row now carries a Back up now button wired to the same r655 export flow: the same confirm dialog, the same plaintext JSON download, an honest toast when the vault is empty. The round also closed r704\'s known remnant — the historical r698→r697 descending pair mid-array — by swapping two adjacent single-line entries with an adjacency assertion and a line-multiset guard, deliberately NOT the r703 block-parser whose template-literal parity bug caused the r704 incident. Lesson applied: the safest codemod is the one that parses nothing.", '
    'lookFor: "Settings → automation vault at 0 stored: the ledger\'s emerald row carries a Back up now chip that deepens its emerald wash on hover; Settings → What\'s fixed: receipts #4/#5 now read r698 above r697 — and every other position unchanged." },\n'
)

def multiset(ls):
    return sorted(ls)

original = P.read_text()
lines = original.splitlines(keepends=True)

# ── Phase 1: swap r698 <-> r697 ──────────────────────────────────────────
i698 = [i for i, l in enumerate(lines) if 'round: "r698"' in l]
i697 = [i for i, l in enumerate(lines) if 'round: "r697"' in l]
assert len(i698) == 1, f"ABORT: expected exactly one r698 entry line, got {i698}"
assert len(i697) == 1, f"ABORT: expected exactly one r697 entry line, got {i697}"
i698, i697 = i698[0], i697[0]
assert i697 == i698 + 1, f"ABORT: not adjacent — r698@{i698 + 1}, r697@{i697 + 1}"

lines[i698], lines[i697] = lines[i697], lines[i698]
assert (
    'round: "r697"' in lines[i698] and 'round: "r698"' in lines[i697]
), "ABORT: post-swap identity failed"
assert multiset(original.splitlines()) == multiset(
    "".join(lines).splitlines()
), "ABORT: swap changed more than the two lines (multiset mismatch)"
print(f"phase 1 OK: swapped r698@{i698 + 1} <-> r697@{i697 + 1} (multiset identical)")

# ── Phase 2: append the r705 note after the r704 entry ──────────────────
snap = "".join(lines)
i704 = [i for i, l in enumerate(snap.splitlines(keepends=True)) if 'round: "r704"' in l]
assert len(i704) == 1, f"ABORT: expected exactly one r704 entry line, got {i704}"
i704 = i704[0]
nxt = lines[i704 + 1].strip() if i704 + 1 < len(lines) else ""
assert nxt.startswith("]"), (
    f"ABORT: r704 is not the array tail — next line is {nxt[:60]!r}"
)

lines.insert(i704 + 1, R705)
after = "".join(lines)
assert multiset(snap.splitlines() + [R705.rstrip("\n")]) == multiset(
    after.splitlines()
), "ABORT: append changed more than the inserted line (multiset mismatch)"

P.write_text(after)
print(f"phase 2 OK: r705 note inserted after r704@{i704 + 1}; file written")
