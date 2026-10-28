#!/usr/bin/env python3
"""r713 guarded edits: gate census carries uncertain/no-judge tones; chips
surface them. Every replace is exact-match count==1; exit 1 on any drift."""
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

gc = ROOT / "src/lib/gate-census.ts"
kb = ROOT / "src/components/nexus/workflows/run-kanban.tsx"
pn = ROOT / "src/components/nexus/workflows/workflow-run-panel.tsx"
wf = ROOT / "src/components/nexus/settings/whats-fixed.tsx"

SUFFIX = ('{census.uncertain > 0 ? ` · ${census.uncertain}u` : ""}'
          '{census.noJudge > 0 ? ` · ${census.noJudge}nj` : ""}')

# A. gate-census.ts — the adapter carries the two extra tones
guarded(gc,
        "  /** Confident verdicts: judges that answered with ≥threshold confidence. */\n  verdicts: number;",
        "  /** Confident verdicts: judges that answered with ≥threshold confidence. */\n  verdicts: number;\n"
        "  /** r713: the judge answered below confidence — engaged but not confident. */\n  uncertain: number;\n"
        "  /** r713: no judge answered — the step ran ungated (the honest alarm). */\n  noJudge: number;",
        "census-iface")
guarded(gc,
        "const EMPTY: GateCensus = { engaged: 0, verdicts: 0 };",
        "const EMPTY: GateCensus = { engaged: 0, verdicts: 0, uncertain: 0, noJudge: 0 };",
        "census-empty")
guarded(gc,
        "  let engaged = 0;\n  let verdicts = 0;",
        "  let engaged = 0;\n  let verdicts = 0;\n  let uncertain = 0;\n  let noJudge = 0;",
        "census-lets")
guarded(gc,
        "      if (/^Decision gate (?:PASS|FAIL) \\d+%/.test(note)) {\n"
        "        verdicts += 1;\n"
        "        verdictLine = VERDICT_OUTCOME_RE.exec(note)?.[0] ?? verdictLine;\n"
        "      }",
        "      if (/^Decision gate (?:PASS|FAIL) \\d+%/.test(note)) {\n"
        "        verdicts += 1;\n"
        "        verdictLine = VERDICT_OUTCOME_RE.exec(note)?.[0] ?? verdictLine;\n"
        "      } else if (UNCERTAIN_RE.test(note)) {\n"
        "        uncertain += 1;\n"
        "      } else if (note.includes(\"no judge answered\")) {\n"
        "        noJudge += 1;\n"
        "      }",
        "census-loop")
guarded(gc,
        "  return verdictLine\n"
        "    ? { engaged, verdicts, verdictLine, ...(verdictTone ? { verdictTone } : {}), ...withStamp }\n"
        "    : { engaged, verdicts, ...withStamp };",
        "  return verdictLine\n"
        "    ? { engaged, verdicts, uncertain, noJudge, verdictLine, ...(verdictTone ? { verdictTone } : {}), ...withStamp }\n"
        "    : { engaged, verdicts, uncertain, noJudge, ...withStamp };",
        "census-return")

# B. run-kanban.tsx — board sums + board chip + per-run chip + title decode
guarded(kb, "    let failRuns = 0;",
        "    let failRuns = 0;\n    let uncertain = 0;\n    let noJudge = 0;",
        "board-lets")
guarded(kb, "        verdicts += census.verdicts;",
        "        verdicts += census.verdicts;\n        uncertain += census.uncertain;\n        noJudge += census.noJudge;",
        "board-sum")
guarded(kb,
        "return { engaged, verdictRuns, verdicts, failRuns, witness: familyTallyOf(notes), latestAt };",
        "return { engaged, verdictRuns, verdicts, failRuns, uncertain, noJudge, witness: familyTallyOf(notes), latestAt };",
        "board-return")
guarded(kb,
        "{boardGates.failRuns > 0 ? ` · ${boardGates.failRuns} latest-FAIL` : \"\"}",
        "{boardGates.failRuns > 0 ? ` · ${boardGates.failRuns} latest-FAIL` : \"\"}"
        "{boardGates.uncertain > 0 ? ` · ${boardGates.uncertain}u` : \"\"}"
        "{boardGates.noJudge > 0 ? ` · ${boardGates.noJudge}nj` : \"\"}",
        "board-chip")
guarded(kb,
        "stay unanswered. The ◈/◇ witness count",
        "stay unanswered. The u/nj suffixes decode the ungated side: u = the judge answered "
        "below confidence (uncertain), nj = no judge answered — that step ran ungated. The ◈/◇ witness count",
        "board-title")
guarded(kb,
        '⚖ gate {census.engaged}·{census.verdicts}{census.verdictLine ? ` · ${census.verdictLine}` : ""}',
        '⚖ gate {census.engaged}·{census.verdicts}{census.verdictLine ? ` · ${census.verdictLine}` : ""}' + SUFFIX,
        "kanban-chip")

# C. workflow-run-panel.tsx — the panel's per-run chip
guarded(pn,
        '⚖ gate {census.engaged}·{census.verdicts}{census.verdictLine ? ` · ${census.verdictLine}` : ""}',
        '⚖ gate {census.engaged}·{census.verdicts}{census.verdictLine ? ` · ${census.verdictLine}` : ""}' + SUFFIX,
        "panel-chip")

# D. FixNote r712 -> array tail gets r713
anchor = 'no longer claims the executor prefers edge." },\n];'
entry = ('  { round: "r713", title: "The gate chip stops hiding silently-ungated steps — uncertain and no-judge tones surface where the verdicts already do", '
         'detail: "The r712 watch mapping exposed a display gap: the gate corpus held 25 uncertain + 8 no-judge events, but every ⚖ chip '
         '(per-run and board) counted only engagements and confident verdicts — a run whose judge never answered looked identical to one '
         'that passed clean. The shared census adapter (the r649 doctrine: both chips read one mapping) now carries the two extra tones, '
         'rendered as compact suffixes only when nonzero: u = the judge answered below confidence (uncertain), nj = no judge answered — '
         'the step ran ungated, the honest alarm. The board chip aggregates both across visible runs and its tooltip decodes the letters. '
         'No census math changed: verdicts stay confident-only, the tones are additive, and a fully-judged run\'s chip reads exactly as before.", '
         'lookFor: "Workflows: a run with an ungated step shows ⚖ gate N·M · Nnj (and Nu for uncertain judges) on the card and panel chips; '
         'the board chip gains · Nnj across visible runs — all-zero when every judge answered, so clean runs look unchanged." },')
guarded(wf, anchor, anchor[:-3] + "\n" + entry + "\n];", "fixnote-r713")

sys.exit(0 if ok else 1)
