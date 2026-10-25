# r562: replace the r561 inline panel (lines between the r561 comment and
# mirrorCandidates) with the <AcquisitionLanesPanel /> mount, and add the
# import. Line-precise splice with content-asserted boundaries (r561 doctrine:
# relocate/replace-by-line-number with asserted markers, verify with one
# structural grep + tsc).
import io

path = "src/components/nexus/settings/automation-vault-card.tsx"
lines = io.open(path, encoding="utf-8").readlines()

def find(marker: str, start: int = 0) -> int:
    for i in range(start, len(lines)):
        if marker in lines[i]:
            return i
    raise SystemExit(f"MARKER NOT FOUND: {marker!r}")

start = find("{/* r561: the acquisition cluster")
mirror = find("{mirrorCandidates.length > 0 && (")
assert mirror > start
assert lines[mirror - 1].strip() == "</div>", lines[mirror - 1]
end = mirror  # exclusive: panel block = [start, end)

mount = [
    "          {/* r562: the acquisition cluster is now its own component —\n",
    "              the visual seam r561 drew, made modular (acquisition-lanes-panel.tsx). */}\n",
    "          <AcquisitionLanesPanel\n",
    "            acqLanes={acqLanes}\n",
    "            laneProvider={laneProvider}\n",
    "            setLaneProvider={setLaneProvider}\n",
    "            laneKeyRef={laneKeyRef}\n",
    "          />\n",
]

imp_at = find('from "@/lib/acquisition-registry"')
imp = 'import { AcquisitionLanesPanel } from "@/components/nexus/settings/acquisition-lanes-panel";\n'
assert not any("AcquisitionLanesPanel" in l for l in lines), "import already present?"

out = lines[:imp_at + 1] + [imp] + lines[imp_at + 1 : start] + mount + lines[end:]
io.open(path, "w", encoding="utf-8").write("".join(out))
print(f"OK: panel [{start},{end}) -> 8-line mount; import added after line {imp_at + 1}")
print(f"sanity: acq-cluster refs in card = {''.join(out).count('acq-cluster')} (expect 0 — it lives in the panel now)")
