#!/usr/bin/env bash
# r390 QA — the chat SSE route-mock spike: witness the chat reply path
# end-to-end at ZERO provider cost.
#
# ═══ STATUS AFTER r390 (honest, do not trust green runs blindly) ═══
# Routes arm correctly; sends fire; the DIRECT lane fails instantly (TypeError
# in 2ms, proven). OPEN MYSTERY: after the direct lane's 3 fast pre-stream
# retries, the FALLBACK leg never becomes visible — no /api/chat request in
# the capture log, no error bubble (chat-view.tsx:400 patches status:"error"),
# no console entry, at t+8s. Two evidence sessions (r390diag, r390d2) plus a
# 2ms latency probe (r390d3) did not pin it. Next round: sample DOM status
# text ("routing through the app relay…" is an onStatus render) + toasts at
# t+2..6s, and check whether MAX_UPSTREAM_ATTEMPTS/backoff math exceeds the
# sample window before calling it a product bug (r364's "transport classes
# probe-verified only" is still OPEN).
#
# ARCHITECTURE LESSON (the first attempt leaked ~2 real dials — see worklog):
# the browser-direct lane dials the provider CROSS-ORIGIN, and a canned route
# mock carries no CORS headers — the browser blocks the response body, the
# lane retries as "transient", then falls back to the app relay which dials
# the REAL provider server-side (browser-level routes cannot reach a
# server-side fetch). The zero-cost shape:
#   1) --abort **/chat/completions — the direct lane fails instantly as a
#      network error and falls through to the relay (no real dial, no CORS).
#   2) --body **/api/chat — SAME-ORIGIN (no CORS) — carrying the app relay's
#      OWN SSE event contract (chat-client.ts handleEvent):
#      {type:"token",text} ... {type:"done",content,toolCalls,iterations}.
#   W1 = a real composer send renders the mocked reply through the real
#        chain (send -> runServerAgent SSE parse -> chat store -> bubble).
#   W2 = --abort BOTH lanes -> a network-class failure surfaces through the
#        real error path. The harness has no --status flag, so the r385
#        502-status contract is NOT re-witnessed here (stays decision-level
#        from r385's 6/6 witnesses).
set -uo pipefail
AB="agent-browser --session ${SESSION:-r390}"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }
sk(){ echo "SKIP: $1"; }

$AB open http://127.0.0.1:3000/ >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1 || true

# Relay SSE body — the app's own event contract, real newlines (ANSI-C $'').
RELAY_BODY=$'data: {"type":"token","text":"QA mock reply — relayed end-to-end."}\n\ndata: {"type":"token","text":" Second chunk."}\n\ndata: {"type":"done","content":"QA mock reply — relayed end-to-end. Second chunk.","toolCalls":[],"iterations":1}\n\n'

# ── W1: content through the same-origin relay mock ─────────────────────
if $AB network route "**/chat/completions" --abort >/dev/null 2>&1 \
   && $AB network route "**/api/chat" --body "$RELAY_BODY" >/dev/null 2>&1; then
  ok "lanes armed: direct aborted, relay mocked (same-origin, zero real dials)"
else
  bad "route mock failed to arm"; $AB close >/dev/null 2>&1; exit 1
fi

$AB eval "(function(){const b=Array.from(document.querySelectorAll('button')).find(function(e){return e.textContent.indexOf('New Chat')>=0});if(b){b.click();return 'ok'}return 'none'})()" >/dev/null 2>&1
sleep 1
$AB eval "(function(){const ta=document.querySelector('textarea');if(!ta)return 'no-ta';ta.focus();const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(ta,'Say the mock words');ta.dispatchEvent(new Event('input',{bubbles:true}));return 'typed'})()" >/dev/null 2>&1
$AB press Enter >/dev/null 2>&1
# direct lane aborts instantly (x3 pre-stream retries ~2.4s) then the relay answers
sleep 6
REPLY=$($AB eval "document.body.innerText.indexOf('QA mock reply')>=0 ? 'rendered' : 'missing'" 2>/dev/null | tr -d '"' | tail -1)
echo "W1 reply=$REPLY"
[ "$REPLY" = "rendered" ] && ok "mocked relay reply rendered through the real chat chain (send->relay SSE->store->bubble)" || bad "W1 reply not rendered"

$AB network unroute >/dev/null 2>&1 || true
ERRS1=$($AB errors 2>/dev/null | grep -c "Error" || true)
[ "${ERRS1:-0}" -eq 0 ] && ok "console clean after W1" || echo "note: W1 console entries: $ERRS1"

# ── W2: network-class failure on BOTH lanes (abort = zero cost) ────────
ARM1=0; ARM2=0
$AB network route "**/chat/completions" --abort >/dev/null 2>&1 && ARM1=1
$AB network route "**/api/chat" --abort >/dev/null 2>&1 && ARM2=1
if [ "$ARM1" = 1 ] && [ "$ARM2" = 1 ]; then
  $AB eval "(function(){const ta=document.querySelector('textarea');if(!ta)return 'no-ta';ta.focus();const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(ta,'Second turn should fail classified');ta.dispatchEvent(new Event('input',{bubbles:true}));return 'typed'})()" >/dev/null 2>&1
  $AB press Enter >/dev/null 2>&1
  sleep 9
  ERRTXT=$($AB eval "(function(){const t=document.body.innerText;const i=t.search(/failed to fetch|network error|failed/i);return i>=0?('surfaced:'+t.slice(Math.max(0,i-50),i+60).replace(/\n/g,' ')):'nothing'})()" 2>/dev/null | tr -d '"' | tail -1)
  echo "W2 err=$ERRTXT"
  case "$ERRTXT" in
    surfaced:*) ok "network-class failure surfaced through the real error path (both lanes mocked)";;
    *) bad "no failure surfaced ($ERRTXT)";;
  esac
else
  sk "W2 (abort routes failed to arm: direct=$ARM1 relay=$ARM2) — no send attempted, zero-cost guarantee held"
fi

$AB network unroute >/dev/null 2>&1 || true
$AB close >/dev/null 2>&1 || true
echo "─────────────────────"
echo "RESULT: $PASS passed, $FAIL failed"
exit $FAIL
