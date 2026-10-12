#!/usr/bin/env bash
# r383 QA: heartbeat failed-beat error-bubble replacement (no shell JSON juggling —
# all state surgery happens inside page-context evals; original persisted-state
# snapshotted to a temp localStorage key and restored at the end).
set -uo pipefail
PASS=0; FAIL=0
ck() { if [ "$2" = "1" ]; then echo "PASS - $1"; PASS=$((PASS+1)); else echo "FAIL - $1"; FAIL=$((FAIL+1)); fi }

agent-browser open http://localhost:3000 >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2

# 0. force the persist key into existence on a fresh profile: create a chat
# via the UI (a store set() flushes zustand persist to localStorage — the
# key does NOT exist before the first write; r383 lesson, first run failed
# 0/6 on JSON.parse(null)).
agent-browser eval 'document.querySelector(String.raw`button[aria-label="New chat"]`) ? document.querySelector(String.raw`button[aria-label="New chat"]`).click() : "no-btn"' >/dev/null 2>&1
sleep 1.5

# 1. snapshot + inject: due heartbeat, idle conv, stale heartbeat-error bubble as LAST message
INJ=$(agent-browser eval '(() => {
  const K = "praison-conversations";
  const orig = localStorage.getItem(K);
  localStorage.setItem("praison-qa-hb-orig", orig);
  const d = JSON.parse(orig);
  const c = d.state.conversations[0];
  const now = Date.now();
  window.__qaConvId = c.id;
  c.updatedAt = now - 10 * 60_000;
  c.heartbeat = { enabled: true, intervalMs: 60_000, lastBeatAt: now - 10 * 60_000 };
  c.messages = [
    { id: "qa-usr", role: "user", content: "QA heartbeat context message.", createdAt: now - 11 * 60_000, status: "done", toolCalls: [] },
    { id: "qa-hb-err-old", role: "assistant", content: "stale heartbeat failure", agentName: "QA", agentId: "a-assistant", createdAt: now - 10 * 60_000, toolCalls: [], status: "error", heartbeat: true, error: "old failure" }
  ];
  localStorage.setItem(K, JSON.stringify(d));
  return "injected:" + c.id;
})()' 2>/dev/null)
echo "inject: $INJ"
ck "injected due-beat state" "$([[ "$INJ" == *injected:* ]] && echo 1 || echo 0)"

# 2. reload — engine mounts, tick runs every 15s
agent-browser reload >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1

# 3. poll up to 40s for the tick to fire and settle the beat
RESULT=""
for i in $(seq 1 20); do
  sleep 2
  RESULT=$(agent-browser eval '(() => {
    const K = "praison-conversations";
    const d = JSON.parse(localStorage.getItem(K));
    const c = d.state.conversations.find(x => x.id === window.__qaConvId) || d.state.conversations[0];
    if (!c) return JSON.stringify({ ready: false });
    const oldGone = !c.messages.some(m => m.id === "qa-hb-err-old");
    const hbMsgs = c.messages.filter(m => m.heartbeat);
    const userIntact = c.messages.some(m => m.id === "qa-usr");
    const settled = !c.messages.some(m => m.status === "streaming");
    const hbEnabled = Boolean(c.heartbeat && c.heartbeat.enabled);
    return JSON.stringify({ ready: true, settled, oldGone, userIntact, hbMsgCount: hbMsgs.length,
      hbStatuses: hbMsgs.map(m => m.status), hbEnabled, total: c.messages.length });
  })()' 2>/dev/null)
  echo "poll $i: $RESULT"
  if echo "$RESULT" | rg -q '"settled":true' && echo "$RESULT" | rg -q '"oldGone":true'; then break; fi
done
# agent-browser may double-encode the returned string (outer quotes + \" —
# seen live in r383); normalize before pattern-matching.
CLEAN=$(printf '%s' "$RESULT" | sed 's/\\"/"/g; s/^"//; s/"$//')
ck "old stale heartbeat-error bubble removed" "$(printf '%s' "$CLEAN" | rg -q '"oldGone":true' && echo 1 || echo 0)"
ck "user message untouched" "$(printf '%s' "$CLEAN" | rg -q '"userIntact":true' && echo 1 || echo 0)"
ck "beat fired and settled" "$(printf '%s' "$CLEAN" | rg -q '"settled":true' && echo 1 || echo 0)"
ck "at most ONE heartbeat bubble remains (no accumulation)" \
  "$(printf '%s' "$CLEAN" | rg -q '"hbMsgCount":(0|1)' && echo 1 || echo 0)"

# 4. restore original persisted state (belt-and-braces; sessions are ephemeral)
REST=$(agent-browser eval '(() => {
  const orig = localStorage.getItem("praison-qa-hb-orig");
  if (orig === null) return "no-snapshot";
  localStorage.setItem("praison-conversations", orig);
  localStorage.removeItem("praison-qa-hb-orig");
  return "restored";
})()' 2>/dev/null)
echo "restore: $REST"
ck "original state restored" "$([[ "$REST" == *restored* ]] && echo 1 || echo 0)"

agent-browser close >/dev/null 2>&1
echo "-----------------------------"
echo "$PASS passed, $FAIL failed"
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
