#!/usr/bin/env python3
"""r714 guarded edits: fixture pins the u/nj tones; per-run chip tooltips
decode them (one vocabulary, three surfaces). Exact-match count==1 guards."""
import pathlib, sys

ROOT = pathlib.Path("/home/z/my-project")
ok = True

def guarded(path: pathlib.Path, old: str, new: str, label: str):
    global ok
    t = path.read_text()
    n = t.count(old)
    if n != 1:
        print(f"GUARD FAIL [{label}]: {n} matches (expected 1)")
        ok = False
        return
    path.write_text(t.replace(old, new, 1))
    print(f"ok [{label}]")

fx = ROOT / "scripts/qa-gate-census.ts"
kb = ROOT / "src/components/nexus/workflows/run-kanban.tsx"
pn = ROOT / "src/components/nexus/workflows/workflow-run-panel.tsx"
wf = ROOT / "src/components/nexus/settings/whats-fixed.tsx"

# A. fixture: pin the r713 tone surface before the final verdict line
guarded(fx,
        'console.log(`qa-gate-census: ${pass}/${pass + fail}`);',
        '''// 15. r713/r714: the u/nj tone surface — uncertain counts as engaged-but-
// not-verdict, no-judge as ungated; both stay 0 on clean censuses; the
// verdict math (confident-only) is untouched by either.
const mixed = gateCensusOf([
  { note: "System-One gate PASS 90% — verified" },
  { note: "Decision gate uncertain 40% (fast-model)" },
  { note: "Decision gate — no judge answered (ladder quota-dead)" },
]);
check("mixed: verdicts confident-only", mixed.verdicts === 1);
check("mixed: engaged counts all three", mixed.engaged === 3);
check("mixed: uncertain 1", mixed.uncertain === 1);
check("mixed: noJudge 1", mixed.noJudge === 1);
check("mixed: tone pass (last verdict wins)", mixed.verdictTone === "pass");
check("empty: uncertain 0", empty.uncertain === 0 && empty.noJudge === 0);
check("uncertain alone: not a verdict", gateCensusOf([{ note: "Decision gate uncertain 55%" }]).verdicts === 0);
check("no-judge alone: not a verdict", gateCensusOf([{ note: "Decision gate skipped — no judge answered" }]).verdicts === 0);
check("junk rows: tolerant with new tones", gateCensusOf([{ note: 123 as unknown as string }, { note: "Decision gate uncertain 30%" }]).uncertain === 1);

console.log(`qa-gate-census: ${pass}/${pass + fail}`);''',
        "fixture-tones")

# B. kanban per-run chip title decodes u/nj
guarded(kb,
        'so a failed gate never reads green).${',
        'so a failed gate never reads green). The u suffix counts judges that answered below '
        'confidence (uncertain); nj counts steps no judge answered — the step ran ungated.${',
        "kanban-title")

# C. panel chip title decodes u/nj
guarded(pn,
        'so a failed gate never reads green.`}',
        'so a failed gate never reads green. The u suffix counts judges that answered below '
        'confidence (uncertain); nj counts steps no judge answered — the step ran ungated.`}',
        "panel-title")

# D. FixNote r714
anchor = 'all-zero when every judge answered, so clean runs look unchanged." },\n];'
entry = ('  { round: "r714", title: "The census\'s new tones are pinned in the fixture — and the per-run tooltips decode what the board already explains", '
         'detail: "The r713 u/nj suffixes shipped with the adapter untested (the guard-verified edit was the only pin — honest but thin). '
         'The gate-census fixture (the r670 dial-free doctrine) now pins the full tone surface: uncertain rows count as engaged-but-not-verdict, '
         'no-judge rows as ungated, both stay 0 on clean and empty censuses, junk rows stay tolerant, and the fast-model verdict family is '
         'unaffected. Same round, tooltip completion: the per-run ⚖ chips (card + panel) gained the same u/nj decode the board tooltip already '
         'carries — one vocabulary, three surfaces. Watch note: uncertain grew 25→30 in the hour after the tones became visible — the corpus '
         'is talking; no-judge held at 8.", '
         'lookFor: "Workflows: hover a run\'s ⚖ gate chip — the tooltip decodes u (judge answered below confidence) and nj (no judge answered, '
         'step ungated); scripts/qa-gate-census.ts prints the extended count green." },')
guarded(wf, anchor, anchor[:-3] + "\n" + entry + "\n];", "fixnote-r714")

sys.exit(0 if ok else 1)
