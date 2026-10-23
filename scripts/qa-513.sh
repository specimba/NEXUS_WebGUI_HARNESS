#!/usr/bin/env bash
# r513 QA — Cortex v2 settings card + tool labels, via agent-browser CLI.
set -u
PASS=0; FAIL=0
ck() { if [ "$2" = "1" ]; then echo "PASS $1"; PASS=$((PASS+1)); else echo "FAIL $1 ${3:-}"; FAIL=$((FAIL+1)); fi; }
has() { agent-browser eval "document.body.innerText.includes($1) ? '1' : '0'" 2>/dev/null | tail -1; }
sleepw() { sleep "$1"; }

agent-browser open http://localhost:3000 >/dev/null 2>&1; sleepw 6
agent-browser eval "localStorage.clear(); '1'" >/dev/null 2>&1
agent-browser eval "location.hash='#settings'; '1'" >/dev/null 2>&1; sleepw 2
agent-browser eval "document.querySelector('[data-nav=\"settings\"], a[href=\"#settings\"]')?.click(); '1'" >/dev/null 2>&1; sleepw 2

ck "cortex card mounted" "$(agent-browser eval "document.querySelector('#cortex') ? '1' : '0'" 2>/dev/null | tail -1)"
BODY=$(agent-browser eval "document.querySelector('#cortex')?.innerText || ''" 2>/dev/null)
for m in "Semantic memory" "QStash" "Sandbox" "Setup guide" "edge-secret-only" "Free budget"; do
  echo "$BODY" | grep -q "$m" && ck "card marker: $m" 1 || ck "card marker: $m" 0
done

agent-browser eval "[...document.querySelectorAll('#cortex button')].find(b => /setup guide/i.test(b.textContent||''))?.click(); '1'" >/dev/null 2>&1; sleepw 1
GUIDE=$(agent-browser eval "(document.querySelector('#cortex')?.innerText||'').includes('Deploy the function') && (document.querySelector('#cortex')?.innerText||'').includes('Probe & witness') ? '1' : '0'" 2>/dev/null | tail -1)
ck "guided setup 5 steps" "$GUIDE"

agent-browser eval "(() => { const i = document.querySelector('#cortex input[placeholder*=\"functions/v1\"]'); if (!i) return '0'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, 'https://bogus-cortex-qa.example.com/functions/v1/nexus-cortex-harness'); i.dispatchEvent(new Event('input', { bubbles: true })); return '1'; })()" >/dev/null 2>&1; sleepw 1
PERSIST=$(agent-browser eval "JSON.parse(localStorage.getItem('nexus-settings')||'{}')?.state?.settings?.cortex?.url || 'absent'" 2>/dev/null | tail -1)
echo "$PERSIST" | grep -q "bogus-cortex-qa" && ck "cortex url persisted" 1 || ck "cortex url persisted" 0 "$PERSIST"

agent-browser eval "[...document.querySelectorAll('#cortex button')].find(b => /^probe/i.test((b.textContent||'').trim()))?.click(); '1'" >/dev/null 2>&1; sleepw 10
PROBE=$(agent-browser eval "document.querySelector('#cortex [aria-live=\"polite\"]')?.innerText || ''" 2>/dev/null)
echo "$PROBE" | grep -qiE "✗|error|failed|http" && ck "probe honest failure" 1 || ck "probe honest failure" 0 "$PROBE"
mkdir -p /home/z/my-project/upload/qa-513
agent-browser screenshot /home/z/my-project/upload/qa-513/settings-1280.png >/dev/null 2>&1

agent-browser eval "location.hash='#agents'; '1'" >/dev/null 2>&1; sleepw 2
agent-browser eval "document.querySelector('[data-nav=\"agents\"], a[href=\"#agents\"]')?.click(); '1'" >/dev/null 2>&1; sleepw 2
ck "tool labels (Cortex memory)" "$(has "'Cortex memory'")"
ck "tool labels (Sandbox run)" "$(has "'Sandbox run'")"
ck "tool labels (Code Runner intact)" "$(has "'Code Runner'")"

agent-browser eval "location.hash='#settings'; '1'" >/dev/null 2>&1; sleepw 2
agent-browser resize 390 844 >/dev/null 2>&1; sleepw 1
OVF=$(agent-browser eval "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? 'OVERFLOW' : 'clean'" 2>/dev/null | tr -d "\r" 2>/dev/null | tail -1)
ck "mobile 390 no overflow" "$([ "$OVF" = "clean" ] && echo 1 || echo 0)" "$OVF"
agent-browser screenshot /home/z/my-project/upload/qa-513/settings-390.png >/dev/null 2>&1
agent-browser resize 1280 900 >/dev/null 2>&1

CONS=$(agent-browser console 2>/dev/null | grep -ci "\[error\]" || true)
ck "no console errors" "$([ "${CONS:-1}" = "0" ] && echo 1 || echo 0)" "count=$CONS"

echo "SUMMARY: $PASS PASS / $FAIL FAIL"
[ "$FAIL" = "0" ]
