#!/usr/bin/env bash
# r791: MEM-GUARD — the pre-OOM graceful-restart watchdog.
#
# WHY: the dev-server RSS ceiling curve (three hard OOM kills at
# 1.82/1.71/1.56 GB, the ~1.92 GB gate stall, the ~2.0 GB hover at
# r789/r790) costs ~20 minutes per kill cycle: the box goes unresponsive,
# the browser tab freezes, and the recovery refresh risks a sandbox wipe.
# A HARD kernel OOM kill is the worst-case restart; this guard makes the
# restart GRACEFUL and CHEAP instead — at the RSS threshold it runs the
# canonical scripts/dev-restart.sh (warm boot ~10-25s) BEFORE the kernel
# killer fires, and it revives a DEAD server after two consecutive failed
# health probes (cooldown-bound so a compile error can never loop it).
#
# Usage (session-detached — the r519 setsid recipe that survives
# tool-call boundaries):
#   setsid nohup bash scripts/mem-guard.sh </dev/null >/dev/null 2>&1 &
#
# Tunables (env): MEM_GUARD_KB   restart threshold in KB (default 1740000
#                                 ≈ 1.70 GB — under every witnessed kill mark)
#                 MEM_GUARD_LOG  log path (default scripts/mem-guard.log)
set -uo pipefail
cd /home/z/my-project

KB="${MEM_GUARD_KB:-1740000}"
LOG="${MEM_GUARD_LOG:-scripts/mem-guard.log}"
COOLDOWN=300     # min seconds between restart attempts
CHECK_EVERY=120  # seconds between health + RSS probes

# single instance: flock the lockfile; a second guard exits silently
exec 9>"scripts/.mem-guard.lock"
flock -n 9 || exit 0
echo "$$" >&9

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG"; }

server_pid() { pgrep -f "next-server" | head -1; }
rss_kb() {
  local p; p="$(server_pid)"
  if [ -n "$p" ]; then ps -o rss= -p "$p" 2>/dev/null | tr -d ' '; else echo 0; fi
}
health() { curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:3000 || echo 000; }

log "mem-guard up (pid $$, threshold ${KB} KB, check ${CHECK_EVERY}s, cooldown ${COOLDOWN}s)"
last_restart=0
fails=0

while true; do
  sleep "$CHECK_EVERY"
  now=$(date +%s)
  h="$(health)"
  r="$(rss_kb)"
  if [ "$h" = "200" ]; then
    fails=0
    if [ "$r" -gt "$KB" ] && [ $((now - last_restart)) -ge "$COOLDOWN" ]; then
      log "RSS ${r} KB > ${KB} KB — GRACEFUL RESTART (pre-OOM)"
      if bash scripts/dev-restart.sh >> "$LOG" 2>&1; then
        last_restart=$(date +%s)
        log "restart OK — fresh rss $(rss_kb) KB"
      else
        log "restart FAILED (exit $?) — retry next cycle"
      fi
    fi
  else
    fails=$((fails + 1))
    log "health=$h (fail ${fails}/2) rss=${r} KB"
    if [ "$fails" -ge 2 ] && [ $((now - last_restart)) -ge "$COOLDOWN" ]; then
      log "server DOWN (health=$h) — REVIVE via dev-restart.sh"
      if bash scripts/dev-restart.sh >> "$LOG" 2>&1; then
        last_restart=$(date +%s); fails=0
        log "revive OK"
      else
        log "revive FAILED (exit $?) — cooldown applies"
      fi
    fi
  fi
  # keep the log bounded (last 400 lines)
  tail -n 400 "$LOG" > "${LOG}.tmp" 2>/dev/null && mv "${LOG}.tmp" "$LOG" || true
done
