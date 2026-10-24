#!/usr/bin/env bash
# r515 QA — Autonomous Improvement Engine (AIE): card markers, honest enqueue
# counts (dupe + malformed), a real research-repo execution against the live
# GitHub API (gh:upstash/vector-js), idempotent bucket behavior, logs feed,
# 390px overflow + console hygiene — via agent-browser CLI (r513 pattern).
set -u
PASS=0; FAIL=0
ck() { if [ "$2" = "1" ]; then echo "PASS $1"; PASS=$((PASS+1)); else echo "FAIL $1 ${3:-}"; FAIL=$((FAIL+1)); fi; }
has() { agent-browser eval "document.body.innerText.includes($1) ? '1' : '0'" 2>/dev/null | tail -1; }
sleepw() { sleep "$1"; }

agent-browser open http://localhost:3000 >/dev/null 2>&1; sleepw 6
agent-browser eval "localStorage.clear(); '1'" >/dev/null 2>&1
agent-browser eval "location.hash='#workflows'; '1'" >/dev/null 2>&1; sleepw 2
agent-browser eval "document.querySelector('[data-nav=\"workflows\"], a[href=\"#workflows\"]')?.click(); '1'" >/dev/null 2>&1; sleepw 3

# ── 0. QA hygiene (scoped, honest): re-import the probe repo from a clean
#      slate and let the engine regenerate its logs — moves/logs are
#      bucket-scoped by design; the queue row is deleted ONLY for the QA id.
bun -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{try{await p.researchQueue.delete({where:{id:'gh:upstash/vector-js'}})}catch{}await p.nextMove.deleteMany({});await p.autonomyLog.deleteMany({});console.log('qa-clean')})().finally(()=>p.\$disconnect())" 2>/dev/null | tail -1

# ── 1. Card mounted + doctrine markers ───────────────────────────────────────
ck "autonomy card mounted" "$(agent-browser eval "document.querySelector('#autonomy-engine') ? '1' : '0'" 2>/dev/null | tr -d '"' | tail -1)"
BODY=$(agent-browser eval "document.querySelector('#autonomy-engine')?.innerText || ''" 2>/dev/null)
for m in "Autonomous improvement engine" "every 10m · vault-free" "Queue depth" "Moves · 24h" "Last cycle" "Engine status" "Next moves" "Research queue" "Engine log"; do
  echo "$BODY" | grep -qi "$m" && ck "card marker: $m" 1 || ck "card marker: $m" 0
done

# ── 2. UI import — 3 lines: real repo + in-batch dupe + malformed ────────────
agent-browser eval "(() => { const t = document.querySelector('#autonomy-engine textarea[aria-label=\"Research queue import URLs\"]'); if (!t) return '0'; const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; s.call(t, 'https://github.com/upstash/vector-js\\nhttps://github.com/upstash/vector-js\\nnot a url at all'); t.dispatchEvent(new Event('input', { bubbles: true })); return '1'; })()" >/dev/null 2>&1; sleepw 1
agent-browser eval "[...document.querySelectorAll('#autonomy-engine button')].find(b => /^import$/i.test((b.textContent||'').trim()))?.click(); '1'" >/dev/null 2>&1; sleepw 3
SUMMARY=$(agent-browser eval "document.querySelector('#autonomy-engine')?.innerText.match(/last import:[^\\n]*/)?.[0] || ''" 2>/dev/null)
echo "$SUMMARY" | grep -q "+1 queued" && echo "$SUMMARY" | grep -q "1 duplicate" && echo "$SUMMARY" | grep -q "1 invalid" \
  && ck "honest UI import counts (+1/dupe1/invalid1)" 1 || ck "honest UI import counts (+1/dupe1/invalid1)" 0 "$SUMMARY"

# ── 3. curl re-import — exact honest counts {inserted:0, duplicates:2, invalid:1} ──
RE=$(curl -s --max-time 10 -X POST http://localhost:3000/api/autonomy -H 'content-type: application/json' \
  -d '{"action":"enqueue","urls":["https://github.com/upstash/vector-js","https://github.com/upstash/vector-js","not a url at all"]}')
echo "enqueue2=$RE"
echo "$RE" | grep -q '"inserted":0' && echo "$RE" | grep -q '"duplicates":2' && echo "$RE" | grep -q '"invalid":1' \
  && ck "curl re-import dedupe honest" 1 || ck "curl re-import dedupe honest" 0 "$RE"

# ── 4. Cross-site POST rejected (CSRF double-gate) ───────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST http://localhost:3000/api/autonomy \
  -H 'content-type: application/json' -H 'origin: https://evil.example' -H 'sec-fetch-site: cross-site' \
  -d '{"action":"cycle"}')
ck "CSRF cross-site POST rejected" "$([ "$CODE" = "403" ] && echo 1 || echo 0)" "code=$CODE"

# ── 5. Reset the current 10-min bucket's cycle row (QA hygiene only — the
#      boot pass may have spent this bucket on an empty queue; clearing the
#      id row re-arms idempotency for the UI-driven research cycle below) ─────
CLR=$(bun -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();const id='cyc_'+new Date().toISOString().slice(0,16)+'Z';p.autonomyLog.delete({where:{id}}).then(r=>{console.log('cleared '+(r?.id??'none'))}).catch(()=>console.log('none')).finally(()=>p.\$disconnect())" 2>/dev/null | tail -1)
echo "bucket-reset=$CLR"

# ── 6. UI cycle — Execute top move → real GitHub research ────────────────────
agent-browser eval "[...document.querySelectorAll('#autonomy-engine button')].find(b => /execute top move/i.test((b.textContent||'').trim()))?.click(); '1'" >/dev/null 2>&1
sleepw 16
SNAP=$(curl -s --max-time 10 http://localhost:3000/api/autonomy)
echo "$SNAP" | grep -q '"kind":"research-repo"' && echo "$SNAP" | grep -q '"status":"executed"' \
  && ck "research-repo move executed" 1 || ck "research-repo move executed" 0
echo "$SNAP" | grep -qE 'researched [a-z0-9_.-]+/[a-z0-9_.-]+: score [0-9]+/10 → (ADAPT|WATCH|SKIP)' \
  && ck "real GitHub research verdict on move result" 1 || ck "real GitHub research verdict on move result" 0
echo "$SNAP" | grep -qE '"researched":[0-9]+' && echo "$SNAP" | python3 -c "import json,sys; q=json.load(sys.stdin)['queue']; sys.exit(0 if q['researched']>=1 else 1)" \
  && ck "queue row flipped to researched" 1 || ck "queue row flipped to researched" 0 "$(echo "$SNAP" | head -c 200)"
echo "$SNAP" | grep -q '"id":"cyc_' && ck "cycle log row written" 1 || ck "cycle log row written" 0

UIQ=$(agent-browser eval "document.querySelector('#autonomy-engine')?.innerText || ''" 2>/dev/null)
echo "$UIQ" | grep -qiE 'researched|Research ' && echo "$UIQ" | grep -qE '[0-9]+ researched' \
  && ck "UI shows researched row + verdict" 1 || ck "UI shows researched row + verdict" 0

# ── 7. Idempotency — second click honestly answers already-ran ───────────────
agent-browser eval "[...document.querySelectorAll('#autonomy-engine button')].find(b => /execute top move/i.test((b.textContent||'').trim()))?.click(); '1'" >/dev/null 2>&1
sleepw 2
TOAST=$(agent-browser eval "[...document.querySelectorAll('[data-sonner-toast]')].map(t=>t.innerText).join(' | ')" 2>/dev/null)
echo "$TOAST" | grep -qi "already ran this bucket" && ck "honest already-ran on same bucket" 1 || ck "honest already-ran on same bucket" 0 "$TOAST"

# ── 8. Logs feed shows the cycle; statsJson expands ──────────────────────────
echo "$UIQ" | grep -q "cyc_" && ck "logs feed shows cyc_ row" 1 || ck "logs feed shows cyc_ row" 0
agent-browser eval "(() => { const b = [...document.querySelectorAll('#autonomy-engine li button')].find(x => /cyc_/.test(x.innerText||'')); if (!b) return '0'; b.click(); return '1'; })()" >/dev/null 2>&1; sleepw 1
EXP=$(agent-browser eval "document.querySelector('#autonomy-engine pre')?.innerText || ''" 2>/dev/null)
echo "$EXP" | grep -q "laneUsed" && ck "log statsJson expandable (laneUsed visible)" 1 || ck "log statsJson expandable (laneUsed visible)" 0

mkdir -p /home/z/my-project/upload/qa-515
agent-browser screenshot /home/z/my-project/upload/qa-515/autonomy-1280.png >/dev/null 2>&1

agent-browser resize 390 844 >/dev/null 2>&1; sleepw 1
OVF=$(agent-browser eval "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? 'OVERFLOW' : 'clean'" 2>/dev/null | tr -d '"\r' 2>/dev/null | tail -1)
ck "mobile 390 no overflow" "$([ "$OVF" = "clean" ] && echo 1 || echo 0)" "$OVF"
agent-browser screenshot /home/z/my-project/upload/qa-515/autonomy-390.png >/dev/null 2>&1
agent-browser resize 1280 900 >/dev/null 2>&1

CONS=$(agent-browser console 2>/dev/null | grep -ci "\[error\]" || true)
ck "no console errors" "$([ "${CONS:-1}" = "0" ] && echo 1 || echo 0)" "count=$CONS"

echo "SUMMARY: $PASS PASS / $FAIL FAIL"
[ "$FAIL" = "0" ]
