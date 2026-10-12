#!/usr/bin/env bash
# r393 QA — close the r389 mid-beat noop-cleanup witness, cheaply.
#
# r392 lesson applied: a FRESH conversation needs turn-1 + 5-min interval wait
# (~10 dials, >600s). But the beat trigger (chat-heartbeat.tsx:180-189) only
# needs conv.updatedAt to be ≥ interval old AND no streaming messages — an OLD
# conversation satisfies both instantly, so enabling heartbeat on an existing
# thread fires the beat on the FIRST 15s tick. Cost drops to ~2 runs × 3 dials.
#
# Window sizing for a HANGING hour (r392's finding): each direct attempt rides
# the 60s first-token deadline ×3 + backoff ⇒ beat noop lands ≈ 184s after the
# beat's first dial. The /api/chat poll below runs 200s. In a fast-reject hour
# (r391) it exits early by itself.
#
# ⚠ COST: ~6-7 small real aihubmix dials (direct lane is unmockable — --abort
# is a proven no-op, r391). The beat's noop cleanup touches only its own
# placeholder; the thread gains one "survive me" user message + one "<noop>"
# reply — accepted sandbox QA noise.
#
# Assertion discipline (r392 false-positive lesson): survival is asserted ONLY
# after the relay leg (/api/chat) is observed — no observed cleanup ⇒ exit
# INCONCLUSIVE, never PASS.
set -uo pipefail
AB="agent-browser --session ${SESSION:-r393}"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }

$AB open http://127.0.0.1:3000/ >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1 || true

RELAY_BODY=$'data: {"type":"token","text":"…"}\n\ndata: {"type":"done","content":"<noop>","toolCalls":[],"iterations":1}\n\n'
$AB network route "**/api/chat" --body "$RELAY_BODY" >/dev/null 2>&1 \
  || { bad "relay mock failed to arm — aborting (zero-cost guarantee held)"; $AB close >/dev/null 2>&1; exit 1; }
ok "relay mock armed (done content = <noop>)"

# ── Pick an OLD conversation (stale updatedAt ⇒ beat due on first tick) ─────
# Prefer a QA-looking thread; else the last item in the sidebar.
$AB eval "(function(){const items=Array.from(document.querySelectorAll('[role=\"button\"],[data-conversation-id],a,li')).filter(function(e){var r=e.getBoundingClientRect();return r.width>150&&r.width<420&&r.height>30&&r.height<90&&e.textContent.trim().length>3&&e.textContent.trim().length<120});if(!items.length)return 'none';var qa=items.find(function(e){return /diag|qa|test/i.test(e.textContent)});var t=(qa||items[items.length-1]);t.click();return 'picked:'+t.textContent.trim().slice(0,40)})()" 2>/dev/null | tr -d '"' | tail -1
sleep 2

# ── Enable heartbeat (5 min preset) on this thread ──────────────────────────
$AB eval "(function(){const b=document.querySelector('[aria-label=\"Conversation heartbeat\"]');if(b){b.click();return 'ok'}return 'none'})()" >/dev/null 2>&1
sleep 1
EN=$($AB eval "(function(){const s=document.querySelector('[aria-label=\"Enable heartbeat\"]');if(!s)return 'none';s.click();return 'clicked'})()" 2>/dev/null | tr -d '"' | tail -1)
[ "$EN" = "clicked" ] && ok "heartbeat enabled on existing thread" || bad "enable switch not found ($EN)"
$AB eval "(function(){const t=document.querySelector('[aria-label=\"Heartbeat interval\"]');if(t){t.click();return 'ok'}return 'none'})()" >/dev/null 2>&1
sleep 1
$AB eval "(function(){const o=Array.from(document.querySelectorAll('[role=\"option\"]')).find(function(e){return e.textContent.indexOf('Every 5 min')>=0});if(o){o.click();return 'ok'}return 'none'})()" >/dev/null 2>&1
$AB press Escape >/dev/null 2>&1 || true

# ── Wait for the beat (first fresh direct-lane dial after clearing the log) ─
$AB network requests --clear >/dev/null 2>&1 || true
BEAT=no
for i in $(seq 1 68); do   # 340s hard cap; normally fires ≤15s (stale updatedAt)
  sleep 5
  C=$($AB network requests --filter "chat/completions" 2>/dev/null | grep -c "chat/completions" || true)
  if [ "${C:-0}" -gt 0 ]; then BEAT=yes; break; fi
done
[ "$BEAT" = "yes" ] && ok "beat in-flight detected (mid-beat window open)" \
                   || { bad "beat never started — sending nothing (cost guard)"; $AB network unroute >/dev/null 2>&1; $AB close >/dev/null 2>&1; exit 1; }

# ── THE WITNESS: user message lands AFTER the beat placeholder ──────────────
$AB eval "(function(){const ta=document.querySelector('textarea');if(!ta)return 'no-ta';ta.focus();const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(ta,'survive me');ta.dispatchEvent(new Event('input',{bubbles:true}));return 'typed'})()" >/dev/null 2>&1
$AB press Enter >/dev/null 2>&1
ok "user message 'survive me' sent mid-beat"

# ── Observe the noop cleanup execute (guard against r392's false positive) ──
CLEANUP=no
for i in $(seq 1 40); do   # 200s cap — covers the 184s hanging-hour deadline math
  sleep 5
  R=$($AB network requests --filter "api/chat" 2>/dev/null | grep -c "api/chat" || true)
  if [ "${R:-0}" -gt 0 ]; then CLEANUP=yes; break; fi
done
if [ "$CLEANUP" = "yes" ]; then
  ok "beat's fallback leg observed (/api/chat served) — noop cleanup executes now"
  sleep 8
else
  bad "INCONCLUSIVE: no relay leg within 200s — cleanup never observed; survival claim void"
  $AB network unroute >/dev/null 2>&1; $AB close >/dev/null 2>&1; exit 1
fi

# ── Assertions (only after the cleanup is observed) ─────────────────────────
SURV=$($AB eval "document.body.innerText.indexOf('survive me')>=0 ? 'yes' : 'no'" 2>/dev/null | tr -d '"' | tail -1)
[ "$SURV" = "yes" ] && ok "r389 FIX WITNESSED: mid-beat user message survived the noop-beat cleanup (delete-one branch)" \
                    || bad "r389 REGRESSION? mid-beat user message deleted by the beat cleanup"

RELAY_REQ=$($AB network requests --filter "api/chat" 2>/dev/null | grep -c "api/chat" || true)
DIRECT_REQ=$($AB network requests --filter "chat/completions" 2>/dev/null | grep -c "chat/completions" || true)
echo "ATTRIBUTION: /api/chat legs: ${RELAY_REQ:-0} · direct-lane dial lines: ${DIRECT_REQ:-0} (≈3 real dials per run — logged cost)"
ERRS=$($AB errors 2>/dev/null | grep -c "Error" || true)
[ "${ERRS:-0}" -eq 0 ] && ok "console clean" || echo "note: console entries: $ERRS"

$AB network unroute >/dev/null 2>&1 || true
$AB close >/dev/null 2>&1 || true
echo "─────────────────────"
echo "RESULT: $PASS passed, $FAIL failed"
exit $FAIL
