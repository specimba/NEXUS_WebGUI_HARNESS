#!/usr/bin/env bash
# backup discipline (r115): one command = commit-if-dirty + push to fork.
# Usage: bash scripts/git-snapshot.sh ["optional message"]
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "snapshot: ${1:-$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-backup}"
  echo "[snapshot] committed"
else
  echo "[snapshot] tree clean — nothing to commit"
fi
git push origin main
echo "[snapshot] pushed to fork/main"
