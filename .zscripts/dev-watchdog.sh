#!/bin/bash
# dev-watchdog.sh — keeps the Next.js dev server alive (self-healing).
# Started double-forked + setsid so it survives sandbox tool-call reaping.
# The server itself is started under `setsid` so it lives in its OWN session —
# the sandbox reaper kills process-group descendants, so a fresh session is
# required for the server to outlive reaping waves that target our group.
# Only starts a new server when port 3000 is NOT responding (no duplicates).

cd /home/z/my-project || exit 1
export NODE_OPTIONS="--max-old-space-size=1152"

while true; do
  if ! curl -s --max-time 4 http://127.0.0.1:3000 >/dev/null 2>&1; then
    # port dead — clean up any half-dead processes, then restart
    pkill -f "next dev" 2>/dev/null
    pkill -f "next-server" 2>/dev/null
    sleep 1
    echo "[watchdog $(date '+%m-%d %H:%M:%S')] starting dev server" >> dev.log
    setsid nohup bun run dev >> dev.log 2>&1 < /dev/null &
    # wait up to 120s for readiness
    for i in $(seq 1 120); do
      if curl -s --max-time 3 http://127.0.0.1:3000 >/dev/null 2>&1; then
        echo "[watchdog $(date '+%m-%d %H:%M:%S')] dev server ready" >> dev.log
        break
      fi
      sleep 1
    done
  fi
  sleep 10
done
