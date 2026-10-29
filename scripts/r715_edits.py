#!/usr/bin/env python3
# r715 guarded edits (r713 doctrine): exact-match anchors, count==1 assertions,
# any drift -> exit 1 so the && chain aborts BEFORE gates/commit.
# Ships: (1) board-header static legend legend for the ⚖ census vocabulary
# (touch users never see a title tooltip), (2) FixNote r715.
import re, sys, pathlib
ROOT = pathlib.Path("/home/z/my-project")
fails = []

def patch_exact(path, anchor, insert_after, label, marker):
    p = ROOT / path
    s = p.read_text(encoding="utf-8")
    n = s.count(anchor)
    if n != 1:
        fails.append(f"{label}: anchor count {n} != 1 in {path}"); return
    if marker in s:
        print(f"SKIP {label}: already present"); return
    p.write_text(s.replace(anchor, anchor + insert_after, 1), encoding="utf-8")
    print(f"OK {label}")

# (1) kanban board-header legend — after the 'N runs on the board' span (run-kanban.tsx ~L1113)
LEGEND = '''
          <span className="text-muted-foreground/60">
            · ⚖ legend: verdict = confident judge call · u = judge answered below confidence · nj = no judge answered — that step ran ungated
          </span>'''
ANCHOR_KB = '''          <span>
            {boardHarness.runs} run{boardHarness.runs === 1 ? "" : "s"} on the board
          </span>'''
patch_exact("src/components/nexus/workflows/run-kanban.tsx", ANCHOR_KB, LEGEND,
            "kanban board-header legend", "⚖ legend")

# (2) FixNote r715 — self-locating: the r714 entry's true file is discovered by rglob
# (whats-fixed.tsx was the r712 location but the r714 anchor matched 0 there — find it, don't guess)
p = None; s = None
for f in list((ROOT / "src").rglob("*.tsx")) + list((ROOT / "src").rglob("*.ts")):
    t = f.read_text(encoding="utf-8")
    if 'round: "r714"' in t or "The census's new tones are pinned in the fixture" in t:
        p = f; s = t; print(f"FixNote r714 entry located in {f.relative_to(ROOT)}")
        break
if p is None:
    fails.append("FixNote r714 entry not found anywhere under src/")
elif 'round: "r715"' in s:
    print("SKIP FixNote r715: already present")
else:
    m = list(re.finditer(r'(?:round: "r714"|The census.s new tones are pinned in the fixture).*?\n[ ]*\},', s, re.S))
    if len(m) != 1:
        fails.append(f"FixNote r714 anchor matches {len(m)} != 1 in {p}")
    else:
        entry = '''
  {
    round: "r715",
    title: "The watch learned to map itself — and the board header now teaches the ⚖ vocabulary without a hover",
    detail:
      "The r715 watch opened on a false zero: its first probe guessed the EvalEvent vocabulary with note-LIKE patterns and scored 0/0/0 against a real baseline — the r712 lesson (a watch must have a real mapping) applied to the watch itself. The rebuilt probe discovers the gate-bearing column, prints the prefix histogram, and classifies rows in JS instead of guessing. Same round: the Workflows board header gains a static ⚖ legend decoding the census vocabulary (verdict / u / nj) — a title tooltip is invisible to touch, so the one surface that aggregates all runs now explains itself in plain text.",
    lookFor:
      "Workflows board with at least one visible run: a muted '⚖ legend' line after the runs count; scripts/r715_watch.js prints the class-mapped corpus census (verdict PASS/FAIL split, uncertain, no-judge) straight from db/custom.db",
  },'''
        s = s[: m[0].end()] + entry + s[m[0].end():]
        p.write_text(s, encoding="utf-8")
        print("OK FixNote r715")

if fails:
    print("GUARD FAILURES:"); [print(" -", f) for f in fails]; sys.exit(1)
print("r715 edits: all guards green")
