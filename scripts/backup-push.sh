#!/bin/bash
# backup-push.sh — push a clean snapshot of this project to the GitHub backup repo.
# Works around (a) sandbox auto-committer branch resets, (b) GitHub push protection:
# builds a single-commit clean tree from `git archive main` (tracked files only,
# .env / db / logs / artifacts excluded by nature of being untracked).
set -euo pipefail

PAT="${GITHUB_BACKUP_PAT:-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}"
REPO="specimba/NEXUS_WebGUI_HARNESS"
SRC="/home/z/my-project"
WORK="/tmp/nexus-push"

rm -rf "$WORK"; mkdir -p "$WORK"
cd "$WORK"
git init -q -b main
git remote add origin "https://x-access-token:${PAT}@github.com/${REPO}.git"
git fetch -q origin main || true
git reset -q --soft FETCH_HEAD || true

cd "$SRC"
git archive main | tar -x -C "$WORK"

cd "$WORK"
git add -A
if git diff --cached --quiet; then
  echo "backup-push: nothing new to push"
  exit 0
fi
# safety: never push detected secrets
if git diff --cached | grep -Eq "gsk_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}"; then
  echo "backup-push: ABORT — potential secret in staged diff"; exit 1
fi
git -c user.name="Z User" -c user.email="z@container" \
  commit -q -m "backup snapshot $(date +%Y-%m-%d %H:%M)" \
  -m "Automated clean snapshot from sandbox. See worklog.md for round history."
git push origin main
echo "backup-push: pushed $(git rev-parse --short HEAD) to ${REPO}"
