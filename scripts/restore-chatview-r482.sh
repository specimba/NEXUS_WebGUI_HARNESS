#!/bin/bash
# r482: chat-view.tsx storage-split restore (r481 incident follow-up).
# Mechanism: bash-side reads of chat-view.tsx NONDETERMINISTICALLY return a
# stale corrupted variant (}, essages]); instead of }, [messages]); at the
# dep-array sites). Strategy: sample many reads via 3 different readers, keep
# the first CLEAN copy (3 correct dep arrays + zero `, essages` debris +
# 1230 lines), then atomically swap it in via rename (fresh inode -> fresh
# page cache), then verify convergence with 5 md5 samples + spot checks,
# then run the full gate (tsc with cleared tsbuildinfo + lint).
cd /home/z/my-project || exit 1
F=src/components/praison/chat/chat-view.tsx
D=scripts/restore-tmp
mkdir -p "$D"
CLEAN=""

for i in $(seq 1 40); do
  cat "$F" > "$D/a_$i" 2>/dev/null
  python3 -c "import shutil; shutil.copyfile('$F','$D/b_$i')" 2>/dev/null
  node -e "require('fs').copyFileSync('$F','$D/c_$i')" 2>/dev/null
  for s in a b c; do
    P="$D/${s}_$i"
    [ -s "$P" ] || continue
    if ! rg -q ', essages' "$P" \
       && rg -q '\}, \[messages\]\);' "$P" \
       && rg -q '\}, \[messages, streaming\]\);' "$P" \
       && rg -q '\}, \[messages, statusLine\]\);' "$P" \
       && [ "$(wc -l < "$P")" = "1230" ]; then
      CLEAN="$P"
      echo "CLEAN_COPY_FOUND sampler=$s iter=$i"
      break 2
    fi
  done
done

if [ -z "$CLEAN" ]; then
  echo "RESULT: NO_CLEAN_COPY_AFTER_120_SAMPLES"
  exit 3
fi

echo "chosen=$CLEAN  md5=$(md5sum "$CLEAN" | cut -d' ' -f1)"
# Atomic swap: rename(2) replaces the dirent with a fresh inode
cp "$CLEAN" "$D/final.tsx" && mv "$D/final.tsx" "$F" && sync
echo "SWAP_DONE"

echo "=== POST-MV CONVERGENCE (5 md5 samples) ==="
for i in 1 2 3 4 5; do
  md5sum "$F" | cut -d' ' -f1
  sleep 0.2
done

echo "=== SPOT CHECKS ==="
if rg -q ', essages' "$F"; then echo "DEBRIS_STILL_PRESENT"; else echo "DEBRIS_GONE"; fi
rg -n '\}, \[messages\]\);' "$F" | head -2
rg -n '\}, \[messages, streaming\]\);' "$F" | head -2
rg -n '\}, \[messages, statusLine\]\);' "$F" | head -2
wc -l "$F"

echo "=== GATE: tsc (tsbuildinfo cleared) ==="
rm -f tsconfig.tsbuildinfo 2>/dev/null
( bun x tsc --noEmit > "$D/tsc.log" 2>&1; echo "TSC_EXIT=$?" )
rg -c "error TS" "$D/tsc.log" || echo "TSC_ERRORS=0"

echo "=== GATE: lint ==="
( bun run lint > "$D/lint.log" 2>&1; echo "LINT_EXIT=$?" )
rg "problems" "$D/lint.log" || echo "lint: no problems line"

echo "=== APP HEALTH ==="
curl -s -o /dev/null -w "HEALTH=%{http_code}\n" --max-time 8 http://localhost:3000
