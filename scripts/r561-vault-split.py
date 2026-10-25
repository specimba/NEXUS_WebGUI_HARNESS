# r561: relocate the acquisition cluster (registry note IIFE + fleet strip)
# out of the store flex-row into its own sky sub-panel below the store row.
# Line-precise cut with content-asserted boundaries (MultiEdit byte-matching
# failed on a 110-line old_str — transcription drift; this is the robust path).
import io, sys

path = "src/components/nexus/settings/automation-vault-card.tsx"
src = io.open(path, encoding="utf-8").read()
lines = src.splitlines(keepends=True)

def find(marker: str, start: int = 0) -> int:
    for i in range(start, len(lines)):
        if marker in lines[i]:
            return i
    raise SystemExit(f"MARKER NOT FOUND: {marker!r}")

# block start: the note IIFE opener one line above its comment
iife_open = find("// r554: registry-aware note")
assert lines[iife_open - 1].strip().startswith("{(() => {"), lines[iife_open - 1]
start = iife_open - 1

# block end: the fleet strip's closing </div> right before the key <Input
idx_input = find("            <Input", start)
assert lines[idx_input - 1].strip() == "</div>", lines[idx_input - 1]
end = idx_input  # exclusive

block = lines[start:end]
assert any('data-testid="acq-fleet"' in l for l in block), "fleet strip missing"
assert len(block) < 110, len(block)

# drop the inner "Acquisition lanes" label span (the panel header carries it)
label_idx = next(i for i, l in enumerate(block) if "Acquisition lanes" in l)
assert "span" in block[label_idx - 1] and "span" in block[label_idx + 1]
block = block[: label_idx - 1] + block[label_idx + 2 :]

# insertion point: the mirrorCandidates line — ALL indices are pre-cut
# (original-array) indices; the reconstruction splices ONCE against them.
mirror_pre = find("{mirrorCandidates.length > 0 && (")
assert mirror_pre > end, "expected mirror block AFTER the cluster"

panel = [
    "          {/* r561: the acquisition cluster reads as its own class — a sky\n",
    "              sub-panel (the chips' \"pending\" palette, r556) below the store\n",
    "              row, so the select → key → Store flow for LLM lanes stays\n",
    "              unbroken and the search/tool lanes stop breaking it up. */}\n",
    "          <div\n",
    '            className="space-y-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3"\n',
    '            data-testid="acq-cluster"\n',
    "          >\n",
    '            <p className="text-[10px] font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">\n',
    "              Acquisition lanes — search &amp; tool keys, never LLM dials\n",
    "            </p>\n",
    *block,
    "          </div>\n",
]

out = lines[:start] + lines[end:mirror_pre] + panel + lines[mirror_pre:]
io.open(path, "w", encoding="utf-8").write("".join(out))
print(f"OK: cut {end - start} lines, inserted {len(panel)}-line panel before mirror (orig idx {mirror_pre})")
print(f"sanity: acq-cluster present = {'acq-cluster' in ''.join(out)}")
