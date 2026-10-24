#!/bin/bash
# r517 — resilient dev-server bootstrap for the sandbox reaper.
# If :3000 isn't answering, (re)start `bun run dev` detached and wait for Ready.
cd /home/z/my-project
if curl -s -o /dev/null -m 3 http://localhost:3000/; then
  echo "[ensure-dev] server already up"
  exit 0
fi
echo "[ensure-dev] server down — starting detached instance"
pkill -9 -f 'next dev' 2>/dev/null
pkill -9 -f 'next-server' 2>/dev/null
pkill -9 -f 'bun run dev' 2>/dev/null
sleep 1
setsid nohup bun run dev > /dev/null 2>&1 < /dev/null &
for i in $(seq 1 30); do
  if curl -s -o /dev/null -m 3 http://localhost:3000/; then
    echo "[ensure-dev] ready after ${i}s"
    exit 0
  fi
  sleep 1
done
echo "[ensure-dev] FAILED to become ready in 30s"
tail -20 dev.log | grep -v 'prisma:query'
exit 1
