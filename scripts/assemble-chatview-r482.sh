#!/bin/bash
# r482 part 2: assemble correct chat-view.tsx from the persisted Read output
# (lines 200-1230, ground-truth tool-layer bytes) + part1.txt (lines 1-199,
# transcribed from tool-layer Reads), validate, atomic-swap via rename, verify.
cd /home/z/my-project || exit 1
F=src/components/praison/chat/chat-view.tsx
D=scripts/restore-tmp
SRC=tool-results/read_1791905149388_ab2f29ae733f.txt

# 1) Strip the line-number prefixes BYTE-EXACTLY via python (the separator is
# either a tab or the 3-byte UTF-8 arrow; sed/awk ate 1 of 3 arrow bytes).
python3 - "$SRC" > "$D/part2_raw.txt" <<'PYEOF'
import re, sys
raw = open(sys.argv[1], "rb").read()
out = []
for line in raw.split(b"\n"):
    m = re.match(rb"^ *(\d+)([\t\xe2])", line)
    if m and m.group(2) == b"\t":
        out.append(line[m.end():])
    elif m and m.group(2) == b"\xe2":
        out.append(line[m.end() + 2:])  # skip remaining 2 bytes of the 3-byte arrow
    else:
        out.append(line)
sys.stdout.buffer.write(b"\n".join(out))
PYEOF
# Normalize: ensure trailing newline
[ -n "$(tail -c 1 "$D/part2_raw.txt")" ] && printf '\n' >> "$D/part2_raw.txt"
L2=$(awk 'END{print NR}' "$D/part2_raw.txt")
echo "part2_lines(awk)=$L2 (expect 1031 = lines 200..1230)"
if [ "$L2" != "1031" ]; then echo "ABORT: count"; exit 4; fi
# Binary-guard: no control bytes except \n and \t anywhere
if LC_ALL=C rg -q '[\x00-\x08\x0b-\x0c\x0e-\x1f]' "$D/part2_raw.txt"; then echo "ABORT: control bytes present"; exit 6; fi
echo "part2_first=[$(sed -n '1p' "$D/part2_raw.txt")]"
echo "part2_last=[$(tail -1 "$D/part2_raw.txt")]"

# 2) Assemble
cat "$D/part1.txt" "$D/part2_raw.txt" > "$D/assembled.tsx"
LA=$(wc -l < "$D/assembled.tsx")
echo "assembled_lines=$LA (expect 1230)"
[ "$LA" = "1230" ] || { echo "ABORT: assembled count mismatch"; exit 4; }

# 3) Validate byte-level truth markers
FAIL=0
rg -q ', essages' "$D/assembled.tsx" && { echo "ABORT: debris present"; FAIL=1; }
rg -q '\}, \[messages\]\);' "$D/assembled.tsx" || { echo "ABORT: laneCounts dep missing"; FAIL=1; }
rg -q '\}, \[messages, streaming\]\);' "$D/assembled.tsx" || { echo "ABORT: canRegenerate dep missing"; FAIL=1; }
rg -q '\}, \[messages, statusLine\]\);' "$D/assembled.tsx" || { echo "ABORT: auto-scroll dep missing"; FAIL=1; }
rg -q 'r102 \(v14\): lane health' "$D/assembled.tsx" || { echo "ABORT: r102 comment missing"; FAIL=1; }
rg -q 'finalizeReceipt' "$D/assembled.tsx" || { echo "ABORT: finalizeReceipt missing"; FAIL=1; }
sed -n '171p' "$D/assembled.tsx" | od -c | head -2
[ "$FAIL" = "0" ] || exit 5
echo "VALIDATION_OK md5=$(md5sum "$D/assembled.tsx" | cut -d' ' -f1)"

# 4) Atomic swap
cp "$D/assembled.tsx" "$D/final.tsx" && mv "$D/final.tsx" "$F" && sync
echo "SWAP_DONE"
# Keep .tsx files out of the tsc/lint scan path (restore-tmp must hold no compiled sources)
rm -f "$D/assembled.tsx" "$D/final.tsx"

# 5) Convergence: 5 md5 samples of the live file
echo "=== POST-MV CONVERGENCE ==="
for i in 1 2 3 4 5; do md5sum "$F" | cut -d' ' -f1; sleep 0.2; done

# 6) Spot checks
echo "=== SPOT CHECKS ==="
rg -q ', essages' "$F" && echo "DEBRIS_STILL_PRESENT" || echo "DEBRIS_GONE"
rg -n '\}, \[messages' "$F" | head -4
wc -l "$F"

# 7) Gate: tsc with cleared tsbuildinfo (full-log rg analysis)
echo "=== GATE: tsc ==="
rm -f tsconfig.tsbuildinfo 2>/dev/null
( bun x tsc --noEmit > "$D/tsc.log" 2>&1; echo "TSC_EXIT=$?" )
rg -c "error TS" "$D/tsc.log" || echo "TSC_ERRORS=0"

# 8) Gate: lint
echo "=== GATE: lint ==="
( bun run lint > "$D/lint.log" 2>&1; echo "LINT_EXIT=$?" )
rg "problems" "$D/lint.log" || echo "lint: no problems line"

# 9) App health
curl -s -o /dev/null -w "HEALTH=%{http_code}\n" --max-time 8 http://localhost:3000
