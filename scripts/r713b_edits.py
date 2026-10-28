#!/usr/bin/env python3
"""r713b: the board chip suffix edit with a disambiguated anchor (the r713
guard correctly refused the 2-match short anchor — title + aria share it)."""
import pathlib, sys

ROOT = pathlib.Path("/home/z/my-project")
kb = ROOT / "src/components/nexus/workflows/run-kanban.tsx"
t = kb.read_text()

old = ('              {boardGates.failRuns > 0 ? ` · ${boardGates.failRuns} latest-FAIL` : ""}\n'
       '              {boardGates.witness.cross > 0 ? (')
new = ('              {boardGates.failRuns > 0 ? ` · ${boardGates.failRuns} latest-FAIL` : ""}\n'
       '              {boardGates.uncertain > 0 ? ` · ${boardGates.uncertain}u` : ""}\n'
       '              {boardGates.noJudge > 0 ? ` · ${boardGates.noJudge}nj` : ""}\n'
       '              {boardGates.witness.cross > 0 ? (')

n = t.count(old)
if n != 1:
    print(f"GUARD FAIL [board-chip-visible]: {n} matches (expected 1)")
    sys.exit(1)
kb.write_text(t.replace(old, new, 1))
print("ok [board-chip-visible]")
