#!/bin/bash
# r482 FINAL: number-keyed rebuild of chat-view.tsx part2 + assemble + swap + gates.
cd /home/z/my-project || exit 1
F=src/components/praison/chat/chat-view.tsx
D=scripts/restore-tmp
SRC=tool-results/read_1791905149388_ab2f29ae733f.txt

python3 - "$SRC" "$D/part2_numkeyed.txt" <<'PYEOF'
import re, sys
raw = open(sys.argv[1], "rb").read()
lines = raw.split(b"\n")
if lines and lines[-1] == b"": lines.pop()
d = {}
for ln in lines:
    m = re.match(rb"^ *(\d+)([\t\xe2])", ln)
    if not m: raise SystemExit("UNPREFIXED LINE: %r" % ln[:40])
    n = int(m.group(1))
    d[n] = ln[m.end():] if m.group(2) == b"\t" else ln[m.end()+2:]
missing = [n for n in range(200, 1231) if n not in d]
if missing: raise SystemExit("MISSING: %r" % missing)
out = b"\n".join(d[n] for n in range(200, 1231)) + b"\n"
open(sys.argv[2], "wb").write(out)
print("part2_numkeyed_lines=1031 OK")
PYEOF
[ $? -eq 0 ] || exit 4

# Diff vs the old sed/awk strip (which produced 1030) — locate the dropped line
diff "$D/part2_raw.txt" "$D/part2_numkeyed.txt" > "$D/part2.diff" 2>&1
echo "diff_hunks=$(rg -c '^[<>]' "$D/part2.diff" 2>/dev/null || echo 0)"

# Assemble + validate
cat "$D/part1.txt" "$D/part2_numkeyed.txt" > "$D/assembled.tsx"
LA=$(wc -l < "$D/assembled.tsx")
echo "assembled_lines=$LA (expect 1230)"
[ "$LA" = "1230" ] || exit 5
if LC_ALL=C rg -q '[\x00-\x08\x0b-\x0c\x0e-\x1f]' "$D/assembled.tsx"; then echo "ABORT: control bytes"; exit 6; fi
rg -q ', essages' "$D/assembled.tsx" && { echo "ABORT: debris"; exit 6; }
for pat in '\}, \[messages\]\);' '\}, \[messages, streaming\]\);' '\}, \[messages, statusLine\]\);' 'finalizeReceipt' 'r102 \(v14\)'; do
  rg -q "$pat" "$D/assembled.tsx" || { echo "ABORT: missing $pat"; exit 6; }
done
MD5=$(md5sum "$D/assembled.tsx" | cut -d' ' -f1)
echo "VALIDATION_OK md5=$MD5"

# Swap
cp "$D/assembled.tsx" "$D/final.tsx" && mv "$D/final.tsx" "$F" && sync
rm -f "$D/assembled.tsx" "$D/final.tsx"
echo "SWAP_DONE"

echo "=== POST-MV CONVERGENCE (5 samples) ==="
for i in 1 2 3 4 5; do md5sum "$F" | cut -d' ' -f1; sleep 0.2; done

echo "=== GATE: tsc ==="
rm -f tsconfig.tsbuildinfo 2>/dev/null
( bun x tsc --noEmit > "$D/tsc.log" 2>&1; echo "TSC_EXIT=$?" )
rg -c "error TS" "$D/tsc.log" || echo "TSC_ERRORS=0"

echo "=== GATE: lint ==="
( bun run lint > "$D/lint.log" 2>&1; echo "LINT_EXIT=$?" )
rg "problems" "$D/lint.log" || echo "lint: no problems line"

curl -s -o /dev/null -w "HEALTH=%{http_code}\n" --max-time 10 http://localhost:3000
