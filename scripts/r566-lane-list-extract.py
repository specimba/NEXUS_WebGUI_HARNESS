#!/usr/bin/env python3
# r566: extract the lane-slots <ul> into lane-slots-list.tsx (dumb render;
# card keeps all states/handlers — the builtin box shares them). Line-precise
# splice with asserted anchors; idempotent (skips if mount already present).
p = "src/components/nexus/settings/automation-vault-card.tsx"
lines = open(p).read().split("\n")
out_joined = "\n".join(lines)

if "<LaneSlotsList" in out_joined:
    print("mount already present — nothing to do")
    raise SystemExit(0)

# ── 1. locate the ternary + <ul> block ──
i_ternary = next(
    i for i, l in enumerate(lines) if l.strip() == "{laneSlots.length > 0 ? ("
)
assert lines[i_ternary + 1].strip() == '<ul className="space-y-1.5">', lines[i_ternary + 1]
i_ul_end = next(
    i for i in range(i_ternary + 2, i_ternary + 200) if lines[i].strip() == "</ul>"
)
# the line after </ul> must continue the ternary
assert lines[i_ul_end + 1].strip().startswith(") : !loadFailed ? ("), lines[i_ul_end + 1]

mount = [
    "            <LaneSlotsList",
    "              slots={laneSlots}",
    "              dialProvider={dialSlot?.provider ?? null}",
    "              revealed={revealed}",
    "              revealingProvider={revealingProvider}",
    "              testingProvider={testingProvider}",
    "              mirroringProvider={mirroringProvider}",
    "              dialingProvider={dialingProvider}",
    "              confirmRemoveProvider={confirmRemoveProvider}",
    "              drifted={slotDrifted}",
    "              onReveal={revealSlot}",
    "              onTest={testSlot}",
    "              onLiveDial={liveDial}",
    "              onMirror={mirrorProvider}",
    "              onRemove={removeSlot}",
    "            />",
]
lines[i_ternary + 1 : i_ul_end + 1] = mount
print(f"ul block [{i_ternary + 1},{i_ul_end}] → mount ({len(mount)} lines)")

# ── 2. import after the mirror strip import ──
i_imp = next(
    i for i, l in enumerate(lines) if "mirror-candidates-strip" in l
)
lines.insert(i_imp + 1, 'import { LaneSlotsList } from "@/components/nexus/settings/lane-slots-list";')

# ── 3. drop card imports that only served the moved block ──
out = "\n".join(lines)
for name in ["EyeOff", "FlaskConical", "PlugZap", "Eye", "Trash2", "Loader2", "KeyRound", "fmtSlotAge", "providerById"]:
    uses = out.count(name)
    if uses <= 1:  # import only → unused after the move
        if name == "fmtSlotAge":
            out = out.replace('import { fmtSlotAge, pickExecutorSlot } from "@/lib/automation-lane";',
                              'import { pickExecutorSlot } from "@/lib/automation-lane";')
            print("dropped fmtSlotAge from automation-lane import")
        else:
            out = out.replace(f"  {name},\n", "", 1)
            print(f"dropped {name} from lucide import")
open(p, "w").write(out)

# ── 4. sanity ──
assert out.count("<LaneSlotsList") == 2, "import + mount"  # import line + mount
assert 'key drifted \\u2014 re-mirror' not in out, "drift literal moved out"
assert out.count("dials first") == 0, "chip literal moved out"
print("OK card lines:", len(out.split("\n")))
