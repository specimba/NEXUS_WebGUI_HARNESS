#!/usr/bin/env bash
# r721 QA — golden legs + r720 regression (backup road mounted with lanes)
# + U/NJ chip DOM witness attempt #14 (the Owner's live run now holds an nj row).
# Output: scripts/qa_r721_browser.txt
set -u
cd /home/z/my-project
OUT=scripts/qa_r721_browser.txt
: > "$OUT"
exec > >(tee -a "$OUT") 2>&1

echo "=== r721 QA $(date -Is) ==="
for i in $(seq 1 40); do
  code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 3
done
echo "server: $code after wait"

echo "--- settings leg + r720 regression ---"
agent-browser open "http://localhost:3000/#settings" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
agent-browser eval "JSON.stringify({census: /free-reach|free reach/i.test(document.body.innerText), relay: /Model Relay|intel ladder/i.test(document.body.innerText)})" || true
agent-browser eval "(() => JSON.stringify({backupBtn: [...document.querySelectorAll('button')].some(b=>/Back up now/i.test(b.textContent||'')), pasteBox: !!document.querySelector('textarea[aria-label=\"Paste a backup JSON to restore\"]'), readiness: (document.querySelector('[data-testid=\"vault-readiness-strip\"]')||{getAttribute:()=> 'MISS'}).getAttribute('aria-label'), mirrorStripGone: !document.querySelector('[data-testid=\"mirror-count\"]')}))()" || true

echo "--- radar leg ---"
agent-browser open "http://localhost:3000/#radar" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
agent-browser eval "(() => { const el = document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); if (!el) return 'frontier-aria-MISS'; el.click(); return 'frontier-aria-clicked'; })()" || true

echo "--- workflows leg: attempt #14 + long paste ---"
agent-browser open "http://localhost:3000/#workflows" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
agent-browser eval "(() => { const amber=[...document.querySelectorAll('span')].filter(s=>/text-amber-600|text-amber-400/.test(s.className) && /\\d+u/.test(s.textContent||'')); const nj=[...document.querySelectorAll('span')].filter(s=>/text-muted-foreground/.test(s.className) && /\\d+nj/.test(s.textContent||'')); const chips=[...document.querySelectorAll('span')].filter(s=>/⚖/.test(s.textContent||'')).length; return JSON.stringify({amberU:amber.map(s=>s.textContent.trim()).slice(0,4), njTon:nj.map(s=>s.textContent.trim()).slice(0,4), scaleGlyphs:chips}); })()" || true
agent-browser eval "(() => { const runs=(document.body.innerText.match(/\\d+ runs? on the board/)||['runs-label-MISS'])[0]; return runs; })()" || true
agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r721 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true

echo "--- cron chip ---"
agent-browser eval "(() => { const m=(document.body.innerText.match(/cron (\\d+\\/\\d+|n\\/a|\\?\\/\\?)/)||[])[1]; return m||'cron-chip-MISS'; })()" || true

echo "--- console ---"
agent-browser console | tail -25 || true
echo "--- page errors ---"
agent-browser errors || true
echo "=== r721 QA end ==="
