#!/usr/bin/env python3
# r720 fixer — guarded edits to automation-vault-card.tsx (exact-match counts,
# idempotent SKIP, nonzero exit on any anchor miss). Repairs the partial-round
# corruption at the mirroringProvider state line, then lands the bulk-mirror
# wiring + the export-plaintext testid. r719_edits2.py pattern: slice anchors,
# nothing forced.
import re
import sys

PATH = "src/components/nexus/settings/automation-vault-card.tsx"
s = open(PATH, encoding="utf-8").read()
fails = []


def sub_once(name, pattern, repl, expect=1, is_regex=True):
    global s
    n = len(re.findall(pattern, s)) if is_regex else s.count(pattern)
    if n == expect:
        s = re.sub(pattern, repl, s, count=expect) if is_regex else s.replace(pattern, repl, expect)
        print(f"PASS {name} (matched {n})")
    elif n == 0 and repl in s if is_regex else False:
        print(f"SKIP {name} (already applied)")
    else:
        fails.append(name)
        print(f"ABORT {name} (matched {n}, expected {expect})")


# 1. repair the corrupted state line — line-scan, immune to invisible bytes
_state_ok = "const [mirroringProvider, setMirroringProvider] = React.useState<string | null>(null);"
_state_added = "const [mirroringAll, setMirroringAll] = React.useState(false);"
if _state_ok in s and _state_added in s:
    print("SKIP repair-mirroring-state (already applied)")
else:
    lines = s.split("\n")
    # positional anchor: healthy neighbors read via sed (397=settings store,
    # 399=mirrorCandidates) — the corrupted state line sits between them
    hit = [
        i
        for i in range(390, min(410, len(lines)))
        if "useSettingsStore" in lines[i] and "mirrorCandidates = [" in lines[i + 2]
    ]
    hit = [i + 1 for i in hit]
    if len(hit) == 1:
        i = hit[0]
        print(f"PASS repair-mirroring-state (line {i + 1}, was: {lines[i]!r})")
        lines[i] = (
            "  const [mirroringProvider, setMirroringProvider] = React.useState<string | null>(null);\n"
            "  const [mirroringAll, setMirroringAll] = React.useState(false);"
        )
        s = "\n".join(lines)
    else:
        fails.append("repair-mirroring-state")
        print(f"ABORT repair-mirroring-state (candidate lines: {hit})")

# 2. bulk handler before removeSlot (LITERAL match — parens are not metachars)
sub_once(
    "bulk-handler",
    re.escape("  async function removeSlot(provider: string) {"),
    """  // r720: the third wipe's recovery road. The r719 handoff's instruction was
  // "click the 17 waiting Mirror buttons" — with more than a handful of
  // candidates that is N clicks of a mechanical loop. Mirror all (n) runs the
  // SAME mirrorProvider seam sequentially — same toasts, same drift heal,
  // same single write path — so the bulk action introduces no second mapping.
  async function mirrorAllCandidates() {
    if (mirroringAll || mirroringProvider) return;
    setMirroringAll(true);
    try {
      for (const c of mirrorCandidates) {
        await mirrorProvider(c.id);
      }
    } finally {
      setMirroringAll(false);
    }
  }

  async function removeSlot(provider: string) {""",
)

# 3. strip props at the render site
sub_once(
    "strip-props",
    "          <MirrorCandidatesStrip\n            candidates={mirrorCandidates}\n",
    "          <MirrorCandidatesStrip\n"
    "            candidates={mirrorCandidates}\n"
    "            bulkBusy={mirroringAll}\n"
    '            onMirrorAll={() => void mirrorAllCandidates()}\n',
)

# 4. export-plaintext testid on the backup dialog textarea (LITERAL)
sub_once(
    "export-testid",
    re.escape(
        '                  <Textarea\n                    readOnly\n                    aria-label="Vault backup JSON"'
    ),
    '                  <Textarea\n                    readOnly\n                    data-testid="export-plaintext"\n'
    '                    aria-label="Vault backup JSON"',
)

if fails:
    print(f"FIXER FAILED: {fails} — tree untouched for the failed edits only")
    sys.exit(1)
open(PATH, "w", encoding="utf-8").write(s)
print("fixer: all edits landed")
