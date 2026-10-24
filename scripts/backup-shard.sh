#!/usr/bin/env bash
# ─── r517: sharded durable backup builder ────────────────────────────────────
# Proven live in round 517-b research: the full platform payload (~249M)
# compresses to ~172MiB and splits into 4 × ≤49MiB shards — under BOTH
# chat.z.ai's 50MB per-upload cap (the Owner's pain: "even with this
# workspace, I cannot upload in one single zip or tar due to that limit")
# and Supabase Storage's 50MB per-object cap (the recommended durable home:
# a `nexus-backups` bucket on the existing mirror project
# vwottesqbdgcsmvvvzok — 1GB free tier fits ~5 archive generations).
#
# What ships:  {out}/nexus-<ts>.tar.gz.00.part … + nexus-<ts>.manifest.sha256
#              (the manifest covers the reassembled archive AND every shard).
#
# Deliberate excludes (security, 517-b doctrine):
#   node_modules .next .git  — rebuildable / huge
#   .chrome-qa-profile       — QA browser session cookies; NEVER leaves the box
#   .env                     — DATABASE_URL secret; never in third-party storage
# (db/custom.db IS included on purpose — it is the crown jewel — so treat the
#  destination bucket as sensitive: anon-insert-only policies, encrypt first
#  with age/gpg if the shards ever leave trusted infrastructure.)
#
# Restore recipe (anywhere):
#   cat nexus-<ts>.tar.gz.*.part > nexus-<ts>.tar.gz
#   sha256sum -c nexus-<ts>.manifest.sha256
#   tar -xzf nexus-<ts>.tar.gz
#
# Usage: scripts/backup-shard.sh [output-dir]      (default /tmp/nexus-backup)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-/tmp/nexus-backup}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE="$OUT/nexus-$STAMP.tar.gz"

mkdir -p "$OUT"
echo "[backup-shard] building $ARCHIVE from $ROOT (payload only)…"
tar --exclude='./node_modules' \
    --exclude='./.next' \
    --exclude='./.git' \
    --exclude='./.chrome-qa-profile' \
    --exclude='./.env' \
    -czf "$ARCHIVE" -C "$ROOT" .

echo "[backup-shard] splitting into ≤49MiB shards…"
split -b 49M -d --additional-suffix=.part "$ARCHIVE" "$ARCHIVE."

sha256sum "$ARCHIVE" "$ARCHIVE".*.part > "$OUT/nexus-$STAMP.manifest.sha256"
rm "$ARCHIVE" # shards + manifest reassemble it byte-for-byte; keep the dir lean

echo "[backup-shard] done — artifacts in $OUT:"
ls -lh "$OUT/nexus-$STAMP".* | awk '{printf "  %s\t%s\n", $5, $9}'
echo "[backup-shard] restore: cat $OUT/nexus-$STAMP.tar.gz.*.part > nexus-$STAMP.tar.gz && sha256sum -c nexus-$STAMP.manifest.sha256 && tar -xzf nexus-$STAMP.tar.gz"
