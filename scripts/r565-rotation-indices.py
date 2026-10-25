#!/usr/bin/env python3
# r565: rotation echo gains step indices. Round 2 of the splice: the
# definition block ALREADY landed (the earlier MultiEdit claimed atomic
# failure but its edit 1 persisted — verify before touching, failed
# MultiEdit is NOT atomic here). This pass completes the render line only.
p = "src/components/nexus/workflows/workflows-view.tsx"
lines = open(p).read().split("\n")

# ── definition state check ──
i_def = next(i for i, l in enumerate(lines) if "const rotationEcho" in l)
assert "React.ReactNode" in lines[i_def], f"unexpected: {lines[i_def]}"
assert "{i + 1}" in "\n".join(lines[i_def : i_def + 20]), "new def already in"
print(f"definition already applied at {i_def} (annotated) — skipping")

# ── render line: template embed → JSX fragment ──
matches = [
    i
    for i, l in enumerate(lines)
    if "mapped to agents in order" in l and "rotationEcho}" in l and "? " in l
]
assert len(matches) == 1, f"render line matches: {matches}"
i_render = matches[0]
assert "planSteps.length === 1" in lines[i_render], "render line shape"
lines[i_render] = (
    '                    ? <>✓ {planSteps.length} step'
    '{planSteps.length === 1 ? "" : "s"}'
    " detected — mapped to agents in order{rotationEcho}</>"
)

out = "\n".join(lines)
assert "{i + 1}" in out, "index expression present"
assert "detected — mapped to agents in order" in out, "echo sentence present"
assert "in order${rotationEcho}" not in out, "old template embed gone"
assert out.count("mapped to agents in order") == 2, "comment + render only"
open(p, "w").write(out)
print(f"OK render={i_render} lines={len(lines)}")
