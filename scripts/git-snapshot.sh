#!/usr/bin/env bash
# backup discipline (r115): one command = commit-if-dirty + push to fork.
# Usage: bash scripts/git-snapshot.sh ["optional message"]
set -euo pipefail
cd "$(dirname "$0")/.."
# r449 stale-HEAD sentinel: the sandbox has now twice replaced .git with an
# older copy (2026-10-10, quarantined same day; re-hit 2026-10-12 — snapshot
# chain 218265958…fdc478596 lost, objects unrecoverable), leaving days of work
# uncommitted on an ancient HEAD. Advisory only: a loud warning so the next
# occurrence is a one-round recovery instead of a silent catastrophe. Never
# blocks the commit — committing the current tree IS the recovery path.
head_ts=$(git log -1 --format=%ct 2>/dev/null || echo 0)
now_ts=$(date +%s)
age_h=$(( (now_ts - head_ts) / 3600 ))
if [ "$age_h" -ge 6 ]; then
  echo "[snapshot] WARNING: STALE HEAD — last commit is ${age_h}h old. If the tree is dirty with many files, the sandbox likely rolled .git back: verify key fixes are on disk, then commit anyway (this run IS the recovery) and record the incident in worklog.md." >&2
fi
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -m "snapshot: ${1:-$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-backup}"
  echo "[snapshot] committed"
else
  echo "[snapshot] tree clean — nothing to commit"
fi
git push fork main
echo "[snapshot] pushed to fork/main"
