#!/usr/bin/env bash
# r475: CANONICAL dev-server restart. Root cause of the r473/r474/r475
# "curl-200-then-die within ~90s" pattern is NOT app instability: the Bash
# tool reaps its spawned process tree when the tool call ends. Plain
# `nohup bun run dev &` stays inside that tree (setsid/nohup NOTwithstanding
# — proven live in the r221-era worklog: every such restart died within
# minutes with a clean log and no OOM record). The surviving recipe is
# scripts/dev-daemon.mjs: Node spawn(detached:true) + unref() makes the
# child a process-group leader reparented to PID 1 — the same structure as
# the long-lived agent-browser daemon. r472's multi-round-stable server was
# booted this way; the nohup one-liner drifted back in for r473-475.
#
# Usage: bash scripts/dev-restart.sh   (counts as the round's ONE restart)
set -euo pipefail
cd /home/z/my-project

# 1) Kill stale dev-server processes only (leave the agent-browser daemon
#    and chrome alone — they are already detached and in use).
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true
sleep 1

# 2) Boot fully session-detached. r518 witnessed the spawn(detached:true)
#    daemon tree getting silently reaped between tool calls (clean log, no
#    OOM); the r519 ensure-dev.sh `setsid nohup` relaunch survived every
#    boundary across a whole round — new SESSION (not just new group) is the
#    difference. Delegating the launch to the same proven recipe keeps ONE
#    canonical boot path.
# r521: bare `next` needs the repo bin dir on PATH — a patrol tool shell
# without it failed this whole script with "exec: next: not found" (dev.log).
export PATH="/home/z/my-project/node_modules/.bin:$HOME/.bun/bin:$PATH"
setsid nohup bash -c 'exec next dev -p 3000 2>&1 | tee dev.log' </dev/null >/dev/null 2>&1 &
disown || true

# 3) Poll to 200. Warm boot ~10-25s (.next intact); cold compile up to ~40s.
for i in $(seq 1 16); do
  sleep 3
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:3000 || echo 000)
  echo "poll$i=$code"
  if [ "$code" = "200" ]; then
    echo "[dev-restart] OK (detached daemon, survives tool-call boundaries)"
    exit 0
  fi
done
echo "[dev-restart] FAILED to reach 200 in ~48s — inspect dev.log" >&2
exit 1
