#!/usr/bin/env bash
# r391 QA — chat SSE route-mock v2: SETTLED. W1 witnessed 2026-10-10 (3/0).
#
# ══ r390 MYSTERY — RESOLVED (r391, evidence below) ══
# The fallback leg ALWAYS worked. r390's silence was a sampling-window
# artifact: --abort **/chat/completions is a NO-OP in this agent-browser
# build (network log shows direct-lane traffic), so each run performs ~3 REAL
# cross-origin aihubmix dials (~9s each before the CORS body block rejects);
# the engine's 3 pre-stream retries (1.2s+2.4s backoff) then throw ≈ t+31s,
# classifyDirectLaneFailure → fallback → mocked /api/chat answers. r390
# sampled at t+8s — before any of it surfaced. Not a product bug.
#
# ⚠ COST: every run of this harness spends ~3 small real aihubmix dials
# (preseed key) — the --abort route cannot prevent them. Witness tool, not a
# nightly routine. Attribution line in the output records it each run.
#
# Witnessed (r391): reply rendered t+31s; /api/chat fired exactly once;
# console clean. The transient onStatus copy ("routing through the app
# relay…") is replaced by the reply before polling sees it — absence at poll
# time is expected, not a failure.
#
# ══ What this harness proves (reusable for the mid-beat family) ══
# W1 = a real composer send renders a canned SSE reply through the REAL
#      chain (send → lane(s) → runServerAgent SSE parse → store → bubble).
# The mock body carries the app relay's OWN SSE contract (route.ts:98 frames
# `data: {json}\n\n`; chat-client.ts handleEvent parses the shapes):
#   {type:"token",text} … {type:"done",content,toolCalls,iterations}.
set -uo pipefail
AB="agent-browser --session ${SESSION:-r391}"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }

$AB open http://127.0.0.1:3000/ >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1 || true
$AB network requests --clear >/dev/null 2>&1 || true

# Relay SSE body — the app's own event contract (route.ts:98 frames
# `data: {json}\n\n`; chat-client.ts handleEvent parses the event shapes).
RELAY_BODY=$'data: {"type":"token","text":"QA mock reply — relayed end-to-end."}\n\ndata: {"type":"token","text":" Second chunk."}\n\ndata: {"type":"done","content":"QA mock reply — relayed end-to-end. Second chunk.","toolCalls":[],"iterations":1}\n\n'

ARM1=0; ARM2=0
$AB network route "**/chat/completions" --abort >/dev/null 2>&1 && ARM1=1
$AB network route "**/api/chat" --body "$RELAY_BODY" >/dev/null 2>&1 && ARM2=1
if [ "$ARM2" = 1 ]; then
  ok "relay mock armed (same-origin /api/chat, zero CORS exposure)$([ $ARM1 = 1 ] && echo ' + direct lane abort armed')"
else
  bad "relay mock failed to arm — aborting round (no send attempted, zero-cost guarantee held)"; $AB close >/dev/null 2>&1; exit 1
fi

$AB eval "(function(){const b=Array.from(document.querySelectorAll('button')).find(function(e){return e.textContent.indexOf('New Chat')>=0});if(b){b.click();return 'ok'}return 'none'})()" >/dev/null 2>&1
sleep 1
$AB eval "(function(){const ta=document.querySelector('textarea');if(!ta)return 'no-ta';ta.focus();const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(ta,'Say the mock words');ta.dispatchEvent(new Event('input',{bubbles:true}));return 'typed'})()" >/dev/null 2>&1
$AB press Enter >/dev/null 2>&1
T0=$(date +%s)

# Poll for the mocked reply out to t+80s — wide enough for every hypothesis:
# H5 ≈ t+10-12s, abort-applied ≈ t+2-4s, H3/H2 surface ≥ t+60s as error text.
SEEN=""; ELAPSED=""
for WAIT in 5 7 8 10 10 10 10 10 10; do
  sleep "$WAIT"
  SEEN=$($AB eval "document.body.innerText.indexOf('QA mock reply')>=0 ? 'yes' : 'no'" 2>/dev/null | tr -d '"' | tail -1)
  ELAPSED=$(( $(date +%s) - T0 ))
  [ "$SEEN" = "yes" ] && break
  # early error signature? grab it and keep polling (H3 may still deliver late)
  $AB eval "document.body.innerText.search(/failed to fetch|server did not respond|Request failed/i)>=0 ? 'err' : 'ok'" >/dev/null 2>&1 || true
done

if [ "$SEEN" = "yes" ]; then
  ok "W1: mocked relay reply rendered through the real chain at t+${ELAPSED}s (send → lane(s) → /api/chat SSE → store → bubble)"
else
  bad "W1 reply never rendered within t+${ELAPSED}s"
fi

# Status-line witness: the fallback path's onStatus copy (chat-client.ts:168)
STAT=$($AB eval "(function(){const t=document.body.innerText;const i=t.indexOf('routing through the app relay');return i>=0?'seen':'absent'})()" 2>/dev/null | tr -d '"' | tail -1)
[ "$STAT" = "seen" ] && ok "fallback status copy witnessed ('routing through the app relay…')" || echo "note: fallback status copy $STAT at sample time (may have been replaced by the reply)"

# Attribution: did the direct lane really dial, and did the fallback fire?
DIRECT_REQ=$($AB network requests --filter "chat/completions" 2>/dev/null | grep -c "chat/completions" || true)
RELAY_REQ=$($AB network requests --filter "api/chat" 2>/dev/null | grep -c "api/chat" || true)
echo "ATTRIBUTION: direct-lane requests seen: ${DIRECT_REQ:-0} · /api/chat requests seen: ${RELAY_REQ:-0}"
if [ "${DIRECT_REQ:-0}" -eq 0 ]; then
  echo "ATTRIBUTION: --abort WAS applied (0 dials) — H2's abort-non-application premise refuted for this env"
else
  echo "ATTRIBUTION: --abort NOT applied — ≤${DIRECT_REQ} real direct dials spent (logged cost); H2's premise confirmed"
fi

$AB network unroute >/dev/null 2>&1 || true
ERRS=$($AB errors 2>/dev/null | grep -c "Error" || true)
[ "${ERRS:-0}" -eq 0 ] && ok "console clean" || echo "note: console entries: $ERRS"
$AB close >/dev/null 2>&1 || true
echo "─────────────────────"
echo "RESULT: $PASS passed, $FAIL failed"
exit $FAIL
