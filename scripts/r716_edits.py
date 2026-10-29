#!/usr/bin/env python3
# r716 guarded edits (r713 doctrine: exact anchors, count==1, drift -> exit 1).
# (1) censusChipSuffix() extraction — the r649 single-mapping doctrine completed
#     for the RENDER layer (the u/nj suffix template was copy-pasted in 3 chips);
# (2) fixture render-pin 38 -> 43; (3) FixNote r716 via the CORRECTED anchor —
# the r712+ entries are ONE-LINE objects (r715's two refusals explained).
import re, sys, pathlib
ROOT = pathlib.Path("/home/z/my-project")
fails = []
def read(p): return (ROOT / p).read_text(encoding="utf-8")

# (1a) adapter export (EOF append, idempotency-guarded)
GC = "src/lib/gate-census.ts"
s = read(GC)
if "censusChipSuffix" in s:
    print("SKIP adapter: censusChipSuffix already present")
else:
    s = s.rstrip("\n") + '''

// r716: the chip-suffix vocabulary rendered by every per-run/board chip — ONE
// template (the r649 doctrine completed for the render layer; the literal lived
// copy-pasted in three chips). Zero census -> byte-identical empty string (the
// r713 nonzero-only doctrine); shapes pinned in scripts/qa-gate-census.ts.
export function censusChipSuffix(census: Pick<GateCensus, "uncertain" | "noJudge">): string {
  return (
    (census.uncertain > 0 ? ` · ${census.uncertain}u` : "") +
    (census.noJudge > 0 ? ` · ${census.noJudge}nj` : "")
  );
}
'''
    (ROOT / GC).write_text(s, encoding="utf-8")
    print("OK adapter: censusChipSuffix exported")

PER_RUN_OLD = '{census.uncertain > 0 ? ` · ${census.uncertain}u` : ""}{census.noJudge > 0 ? ` · ${census.noJudge}nj` : ""}'
BOARD_OLD = '''{boardGates.uncertain > 0 ? ` · ${boardGates.uncertain}u` : ""}
              {boardGates.noJudge > 0 ? ` · ${boardGates.noJudge}nj` : ""}'''

def patch_chip_file(path, label):
    p = ROOT / path
    s = p.read_text(encoding="utf-8")
    if "censusChipSuffix(" in s:
        print(f"SKIP {label}: already patched"); return
    m = list(re.finditer(r'import \{([^}]+)\} from "([^"]*gate-census)"', s, re.S))
    if len(m) != 1:
        fails.append(f"{label}: gate-census import matches {len(m)} != 1"); return
    names, spec = m[0].group(1), m[0].group(2)
    if "censusChipSuffix" not in names:
        s = s[: m[0].start(1)] + names.rstrip() + ", censusChipSuffix " + s[m[0].end(1):]
    n_per = s.count(PER_RUN_OLD)
    n_board = s.count(BOARD_OLD)
    if path.endswith("run-kanban.tsx"):
        if n_board != 1:
            fails.append(f"{label}: board suffix template count {n_board} != 1"); return
        s = s.replace(BOARD_OLD, "{censusChipSuffix(boardGates)}", 1)
    if n_per != 1:
        fails.append(f"{label}: per-run suffix template count {n_per} != 1"); return
    s = s.replace(PER_RUN_OLD, "{censusChipSuffix(census)}", 1)
    p.write_text(s, encoding="utf-8")
    print(f"OK {label}: suffix template -> censusChipSuffix()")

patch_chip_file("src/components/nexus/workflows/run-kanban.tsx", "kanban (card + board chips)")
patch_chip_file("src/components/nexus/workflows/workflow-run-panel.tsx", "panel chip")

# (2) fixture render-pin 38 -> 43
FX = "scripts/qa-gate-census.ts"
s = read(FX)
if "censusChipSuffix" in s:
    print("SKIP fixture: suffix checks already present")
else:
    imp_old = 'import { gateCensusOf } from "../src/lib/gate-census";'
    if s.count(imp_old) != 1:
        fails.append(f"fixture: import anchor count {s.count(imp_old)} != 1")
    else:
        s = s.replace(imp_old, 'import { censusChipSuffix, gateCensusOf } from "../src/lib/gate-census";', 1)
    log_anchor = '\nconsole.log(`qa-gate-census: '
    if s.count(log_anchor) != 1:
        fails.append(f"fixture: log anchor count {s.count(log_anchor)} != 1")
    else:
        block = '''
// 16. r716: the suffix vocabulary is ONE function now (the r649 render-layer
// completion) — pinned here so a chip can never drift from the adapter.
check("suffix: zero census -> empty string", censusChipSuffix({ uncertain: 0, noJudge: 0 }) === "");
check("suffix: uncertain only", censusChipSuffix({ uncertain: 2, noJudge: 0 }) === " · 2u");
check("suffix: no-judge only", censusChipSuffix({ uncertain: 0, noJudge: 3 }) === " · 3nj");
check("suffix: both tones", censusChipSuffix({ uncertain: 2, noJudge: 3 }) === " · 2u · 3nj");
check("suffix: wired to the toned adapter shape", censusChipSuffix(toned) === " · 1u · 1nj");
'''
        s = s.replace(log_anchor, block + log_anchor, 1)
    (ROOT / FX).write_text(s, encoding="utf-8")
    print("OK fixture: suffix render-pin added (38 -> 43)")

# (3) FixNote r716 — CORRECTED anchor: r712+ entries are one-line objects
WF = "src/components/nexus/settings/whats-fixed.tsx"
s = read(WF)
if 'round: "r716"' in s:
    print("SKIP FixNote: r716 already present")
else:
    anchor = 'prints the extended count green." },\n];'
    n = s.count(anchor)
    if n != 1:
        fails.append(f"FixNote: r714-tail anchor count {n} != 1")
    else:
        entry = ('prints the extended count green." },\n'
                 '  { round: "r716", title: "The suffix vocabulary became one function — the r649 single-mapping doctrine reaches the render layer", '
                 'detail: "The u/nj chip suffix template lived copy-pasted in three chips (card, panel, board) — three chances to drift from the adapter. '
                 'censusChipSuffix() in gate-census.ts is now the single template every chip renders, and the fixture pins its shapes: zero census -> byte-identical '
                 'empty string, uncertain-only, no-judge-only, both, and the wired toned-adapter shape — the render-layer completion of r649 and the honest substitute '
                 'for the u/nj DOM witness while the board holds no visible runs. Same round, bookkeeping: r715\'s FixNote was guard-refused twice because the r712+ '
                 'entries are one-line objects and the old multi-line closer never existed — this entry lands via the corrected anchor.", '
                 'lookFor: "Workflows: a run with ungated steps renders · Nu · Nnj on all three ⚖ chips from one function; scripts/qa-gate-census.ts prints 43/43." },\n];')
        s = s.replace(anchor, entry, 1)
        (ROOT / WF).write_text(s, encoding="utf-8")
        print("OK FixNote r716 (single-line entry, corrected anchor)")

if fails:
    print("GUARD FAILURES:"); [print(" -", f) for f in fails]; sys.exit(1)
print("r716 edits: all guards green")
