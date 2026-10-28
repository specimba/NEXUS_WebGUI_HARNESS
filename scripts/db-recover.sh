#!/usr/bin/env bash
# r699: SQLITE_CORRUPT recovery — the r639 recipe, verified live twice, as one command.
#
# The platform snapshot layer keeps rolling db/custom.db back to an ancient
# state while sparing the WAL; the next open then replays a foreign WAL onto
# an alien main image and SQLite dies with extended code 11:
#   "database disk image is malformed"
# Witnessed 2026-10-27 (r639: 469-page db, ~74% of committed pages destroyed)
# and again 2026-10-28 (r699: identical signature — 24KB Sep-14-vintage main
# vs 1.5MB Oct-26 WAL). The r640 handoff pre-authorized rerunning the recipe
# verbatim; this script IS that recipe.
#
# SUPERSEDES scripts/db-recover-r640.py — its swap path was flagged obsolete
# by the r639 recovery itself; do not run that script's swap.
#
# Usage:   bash scripts/db-recover.sh [label]
# Effect:  1) health-checks db/custom.db (a healthy db is left alone unless
#             FORCE=1 is set)
#          2) quarantines the corrupt trio under db/.corrupt-backup-<label>/
#          3) pushes a fresh schema (bunx prisma db push --accept-data-loss)
#          4) prints an integrity check of the new file
#          5) reminds you a dev-server restart is REQUIRED (a file swap
#             needs reopen): bash scripts/dev-restart.sh
#
# Data loss is inherent: rows newer than the resurrected trio are gone (the
# r699 rerun lost the 22-event eval census — regrowable; the r694
# empty-corpus doctrine covers the reset state in UI and harness). Keys: the
# vault lives in this database — restore a backup file afterwards
# (bun scripts/seedwrite.ts --import), or re-key the lanes.
set -euo pipefail
cd /home/z/my-project

LABEL="${1:-$(date +%Y%m%d-%H%M%S)}"
QUAR="db/.corrupt-backup-$LABEL"
DB="db/custom.db"

if [ ! -f "$DB" ]; then
  echo "[db-recover] $DB not found — nothing to recover. Run 'bunx prisma db push' instead."
  exit 1
fi

HEALTH="$(python3 - "$DB" <<'PY'
import sqlite3, sys
try:
    c = sqlite3.connect(sys.argv[1])
    print(c.execute("PRAGMA integrity_check").fetchone()[0])
except Exception as e:
    print("unreadable:", e)
PY
)"

if [ "$HEALTH" = "ok" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "[db-recover] integrity_check = ok — db reads healthy, nothing to do."
  echo "[db-recover] (if you really meant to wipe it: FORCE=1 bash scripts/db-recover.sh $LABEL)"
  exit 0
fi
echo "[db-recover] health: $HEALTH — proceeding with recovery."

mkdir -p "$QUAR"
for f in custom.db custom.db-wal custom.db-shm; do
  [ -f "db/$f" ] && mv "db/$f" "$QUAR/$f.corrupt" && echo "[db-recover] quarantined db/$f -> $QUAR/$f.corrupt"
done

echo "[db-recover] pushing fresh schema..."
bunx prisma db push --accept-data-loss --skip-generate 2>&1 | tail -2

echo "[db-recover] new db integrity: $(python3 -c "import sqlite3; print(sqlite3.connect('$DB').execute('PRAGMA integrity_check').fetchone()[0])")"

echo "[db-recover] NEXT STEPS (required, in order):"
echo "[db-recover]   1) bash scripts/dev-restart.sh   # file swap requires reopen"
echo "[db-recover]   2) curl -s localhost:3000/api/evals | head -c 120   # expect total:0, 200"
echo "[db-recover]   3) grep -c malformed dev.log   # expect 0"
echo "[db-recover]   4) keys: restore a backup file or re-key lanes — the vault restarted empty"
echo "[db-recover] corrupt trio preserved under $QUAR/ (gitignored lineage, r639 convention)"
