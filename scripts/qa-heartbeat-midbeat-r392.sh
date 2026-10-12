#!/usr/bin/env bash
# r392 QA — live witness for the r389 mid-beat noop-cleanup fix (beatNoopCleanup).
#
# Scenario (the exact production shape r389 closed):
#   A heartbeat beat is in-flight (placeholder appended, direct lane dialing a
#   slow provider). A user message lands AFTER the placeholder. The beat then
#   returns <noop>. OLD code: truncateFrom(placeholder, inclusive) deleted the
#   mid-beat user message — silent data loss. r389 fix: beatNoopCleanup sees
#   the placeholder is no longer last → delete-one → the user message survives.
#
# How the window is made wide and deterministic: the beat + user runs traverse
# the browser-direct lane (global registry provider), whose cross-origin dials
# take ~9s each ×3 retries ≈ 31s before the fallback reaches the mocked
# /api/chat. That 31s IS the production "slow provider" window — plenty of
# time to send a user message mid-beat.
#
# ⚠ COST: three mocked-but-direct-traversing runs (turn 1, beat, user run) ×
# ~3 small real aihubmix dials each ≈ 9 small dials (preseed key). --abort is
# a proven no-op in this agent-browser build (r391), so this is unavoidable
# while the global provider resolves custom. One-off witness, not a routine.
#
# Discriminator: after everything settles, "survive me" MUST still be in the
# thread. Old code deletes it; r389 code keeps it (and removes only the beat
# placeholder).
set -uo pipefail
AB="agent-browser --session ${SESSION:-r392}"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }
note(){ echo "note: $1"; }

$AB open http://127.0.0.1:3000/ >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1 || true

# Mock: the app relay's OWN SSE contract; done content "<noop>" drives the
# beat's silent-cleanup path (chat-heartbeat.tsx HEARTBEAT_NOOP).
RELAY_BODY=$'data: {"type":"token","text":"…"}\n\ndata: {"type":"done","content":"<noop>","toolCalls":[],"iterations":1}\n\n'
$AB network route "**/api/chat" --body "$RELAY_BODY" >/dev/null 2>&1 \
  || { bad "relay mock failed to arm — aborting (zero-cost guarantee held)"; $AB close >/dev/null 2>&1; exit 1; }
ok "relay mock armed (done content = <noop>)"

# ── Turn 1: give the conversation history (fireBeat requires it) ────────────
$AB eval "(function(){const b=Array.from(document.querySelectorAll('button')).find(function(e){return e.textContent.indexOf('New Chat')>=0});if(b){b.click();return 'ok'}return 'none'})()" >/dev/null 2>&1
sleep 1
$AB eval "(function(){const ta=document.querySelector('textarea');if(!ta)return 'no-ta';ta.focus();const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(ta,'hello');ta.dispatchEvent(new Event('input',{bubbles:true}));return 'typed'})()" >/dev/null 2>&1
$AB press Enter >/dev/null 2>&1
SETTLED=no
for i in $(seq 1 18); do  # 90s — direct-lane dials ran ~9s each in r391, slower in a bad hour
  sleep 5
  B=$($AB eval "document.body.innerText.indexOf('<noop>')>=0 ? 'yes' : 'no'" 2>/dev/null | tr -d '"' | tail -1)
  [ "$B" = "yes" ] && SETTLED=yes && break
done
[ "$SETTLED" = "yes" ] && ok "turn 1 settled (mocked <noop> reply rendered)" || bad "turn 1 never settled"

# ── Enable heartbeat: smallest preset (5 min) ───────────────────────────────
$AB eval "(function(){const b=document.querySelector('[aria-label=\"Conversation heartbeat\"]');if(b){b.click();return 'ok'}return 'none'})()" >/dev/null 2>&1
sleep 1
EN=$($AB eval "(function(){const s=document.querySelector('[aria-label=\"Enable heartbeat\"]');if(!s)return 'none';s.click();return 'clicked'})()" 2>/dev/null | tr -d '"' | tail -1)
$AB eval "(function(){const t=document.querySelector('[aria-label=\"Heartbeat interval\"]');if(t){t.click();return 'ok'}return 'none'})()" >/dev/null 2>&1
sleep 1
IV=$($AB eval "(function(){const o=Array.from(document.querySelectorAll('[role=\"option\"]')).find(function(e){return e.textContent.indexOf('Every 5 min')>=0});if(o){o.click();return 'ok'}return 'none'})()" 2>/dev/null | tr -d '"' | tail -1)
$AB press Escape >/dev/null 2>&1 || true
[ "$EN" = "clicked" ] && ok "heartbeat enabled" || bad "enable switch not found ($EN)"
[ "$IV" = "ok" ] && ok "interval set to 5 min" || bad "interval option not found ($IV)"

# ── Wait for the beat: first NEW direct-lane dial after clearing the log ────
$AB network requests --clear >/dev/null 2>&1 || true
BEAT=no
for i in $(seq 1 68); do   # 340s cap (5min interval + tick; fits the 600s round budget)
  sleep 5
  C=$($AB network requests --filter "chat/completions" 2>/dev/null | grep -c "chat/completions" || true)
  if [ "${C:-0}" -gt 0 ]; then BEAT=yes; break; fi
done
if [ "$BEAT" = "yes" ]; then
  ok "beat in-flight detected (direct-lane dials started — mid-beat window open)"
else
  bad "beat never started within 380s — sending nothing further (cost guard)"; $AB network unroute >/dev/null 2>&1; $AB close >/dev/null 2>&1; exit 1
fi

# ── THE WITNESS: user message lands AFTER the beat placeholder ──────────────
$AB eval "(function(){const ta=document.querySelector('textarea');if(!ta)return 'no-ta';ta.focus();const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(ta,'survive me');ta.dispatchEvent(new Event('input',{bubbles:true}));return 'typed'})()" >/dev/null 2>&1
$AB press Enter >/dev/null 2>&1
T_SEND=$(date +%s)
ok "user message 'survive me' sent mid-beat"

# ── Observe the beat's noop cleanup ACTUALLY execute (r392 lesson) ──────────
# The cleanup runs synchronously after the beat's runAgentChat returns, which
# happens right after the fallback leg (/api/chat) is served by the mock.
# No /api/chat request ⇒ no cleanup executed ⇒ asserting survival would be a
# FALSE POSITIVE (r392 first run: 0 relay legs, message survived trivially).
CLEANUP=no
for i in $(seq 1 26); do  # 130s cap — slow-hour dials
  sleep 5
  R=$($AB network requests --filter "api/chat" 2>/dev/null | grep -c "api/chat" || true)
  if [ "${R:-0}" -gt 0 ]; then CLEANUP=yes; break; fi
done
if [ "$CLEANUP" = "yes" ]; then
  ok "beat's fallback leg observed (/api/chat served by mock) — cleanup executes now"
  sleep 8  # mock answers in ms; runAgentChat returns; synchronous noop cleanup runs
else
  bad "INCONCLUSIVE: no relay leg within 150s — noop cleanup never observed; survival claim void (r392 first-run lesson)"
  $AB network unroute >/dev/null 2>&1; $AB close >/dev/null 2>&1; exit 1
fi

# ── Assertions (only meaningful AFTER the cleanup is observed) ───────────────
SURV=$($AB eval "document.body.innerText.indexOf('survive me')>=0 ? 'yes' : 'no'" 2>/dev/null | tr -d '"' | tail -1)
HELL=$($AB eval "document.body.innerText.indexOf('hello')>=0 ? 'yes' : 'no'" 2>/dev/null | tr -d '"' | tail -1)
[ "$SURV" = "yes" ] && ok "r389 FIX WITNESSED: mid-beat user message survived the noop-beat cleanup" \
                    || bad "r389 REGRESSION? mid-beat user message was deleted by the beat cleanup"
[ "$HELL" = "yes" ] && ok "earlier history intact ('hello' still present)" || bad "history lost ('hello' missing)"

RELAY_REQ=$($AB network requests --filter "api/chat" 2>/dev/null | grep -c "api/chat" || true)
DIRECT_REQ=$($AB network requests --filter "chat/completions" 2>/dev/null | grep -c "chat/completions" || true)
echo "ATTRIBUTION: /api/chat (relay legs incl. beat noop): ${RELAY_REQ:-0} · direct-lane dial lines: ${DIRECT_REQ:-0} (≈3 real dials per run — logged cost)"

$AB network unroute >/dev/null 2>&1 || true
$AB close >/dev/null 2>&1 || true
echo "─────────────────────"
echo "RESULT: $PASS passed, $FAIL failed"
exit $FAIL
