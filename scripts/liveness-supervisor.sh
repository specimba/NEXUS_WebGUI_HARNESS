#!/usr/bin/env bash
# r522 — DEV-SERVER LIVENESS SUPERVISOR (r521 handoff: "the reaper is now
# the #1 operational risk" — setsid relaunches died 2x between tool calls).
#
# Contract:
#   * Every 30s, health-check http://localhost:3000/ (2xx/3xx = alive).
#   * 2 consecutive strikes (~60s downtime) => ONE restart via the canonical
#     scripts/dev-restart.sh (single boot path; it polls to 200 itself).
#   * Cooldown: at most one supervisor-initiated restart per 5 minutes —
#     never thrash against a systematically broken server; after 3 failed
#     restart attempts in a row it stands down (RETIRED) and only observes,
#     so a human sees the truth instead of a flapping loop.
#   * Single instance via pidfile; a stale/dead pid is replaced on start.
#   * Log capped (~400 lines) at dev-supervisor.log; every action stamped.
#
# Launch (fully session-detached — the only recipe that survives the reaper):
#   setsid nohup bash scripts/liveness-supervisor.sh </dev/null >/dev/null 2>&1 &
set -uo pipefail
cd /home/z/my-project

PIDFILE="scripts/.liveness-supervisor.pid"
LOGFILE="dev-supervisor.log"
LOCKTAG="liveness-supervisor"

# --- single instance -------------------------------------------------------
if [ -f "$PIDFILE" ]; then
  OLD=$(cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "${OLD:-}" ] && kill -0 "$OLD" 2>/dev/null; then
    echo "$(date '+%F %T') [supervisor] already running as pid $OLD — exit" >> "$LOGFILE"
    exit 0
  fi
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

log() { echo "$(date '+%F %T') [supervisor] $*" >> "$LOGFILE"; }
caplog() {
  LINES=$(wc -l < "$LOGFILE" 2>/dev/null || echo 0)
  if [ "$LINES" -gt 500 ]; then
    tail -400 "$LOGFILE" > "$LOGFILE.tmp" && mv "$LOGFILE.tmp" "$LOGFILE"
  fi
}

log "armed (pid $$) — 30s checks, 2-strike restart, 300s cooldown, 3-strike retire"
STRIKES=0
COOLDOWN_UNTIL=0
FAIL_STREAK=0

while true; do
  sleep 30
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 http://localhost:3000/ 2>/dev/null || echo 000)
  NOW=$(date +%s)

  case "$CODE" in
    2*|3*)
      STRIKES=0
      FAIL_STREAK=0
      # quiet success — no per-tick log spam (log stays readable)
      ;;
    *)
      STRIKES=$((STRIKES + 1))
      log "health strike $STRIKES (code=$CODE)"
      if [ "$STRIKES" -lt 2 ]; then
        continue
      fi
      if [ "$NOW" -lt "$COOLDOWN_UNTIL" ]; then
        log "still down but inside restart cooldown — observing only"
        continue
      fi
      if [ "$FAIL_STREAK" -ge 3 ]; then
        log "RETIRED: 3 consecutive restart cycles failed to heal — standing down; inspect dev.log"
        # keep checking but never restart again; a fresh supervisor (new arm)
        # is required to resume healing. Keep the loop so pidfile stays true.
        while true; do
          sleep 300
          CODE2=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 http://localhost:3000/ 2>/dev/null || echo 000)
          case "$CODE2" in 2*|3*) log "server recovered on its own while RETIRED — remaining retired"; ;; esac
        done
      fi
      if pgrep -f "bash scripts/dev-restart.sh" >/dev/null 2>&1; then
        log "manual dev-restart.sh already in flight — deferring"
        continue
      fi
      log "down for ~60s (code=$CODE) — restart via canonical dev-restart.sh"
      FAIL_STREAK=$((FAIL_STREAK + 1))
      if bash scripts/dev-restart.sh >> "$LOGFILE" 2>&1; then
        log "restart cycle $FAIL_STREAK healed the server"
      else
        log "restart cycle $FAIL_STREAK FAILED (see dev.log above)"
      fi
      STRIKES=0
      COOLDOWN_UNTIL=$(( $(date +%s) + 300 ))
      caplog
      ;;
  esac
done
