#!/usr/bin/env bash
# r718 golden QA + U/NJ board witness attempt #12 (agent-browser).
# Output: scripts/qa_r718_browser.txt (parsed by scripts/r718_gw.py).
set -u
cd /home/z/my-project
OUT=scripts/qa_r718_browser.txt
: > "$OUT"
exec > >(tee -a "$OUT") 2>&1

echo "=== r718 golden QA $(date -Is) ==="

echo "--- settings leg ---"
agent-browser open "http://localhost:3000/#settings" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
agent-browser eval "JSON.stringify({census: /free-reach|free reach/i.test(document.body.innerText), relay: /Model Relay|intel ladder/i.test(document.body.innerText)})" || true

echo "--- radar leg (r712 stable aria name) ---"
agent-browser open "http://localhost:3000/#radar" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
agent-browser eval "(() => { const el = document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); if (!el) return 'frontier-aria-MISS'; el.click(); return 'frontier-aria-clicked'; })()" || true

echo "--- workflows leg: board witness attempt #12 ---"
agent-browser open "http://localhost:3000/#workflows" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/Runs board layout/i.test(x.textContent||'')); if(!b) return 'board-toggle-MISS'; b.click(); return 'board-toggle-clicked'; })()" || true
sleep 1
agent-browser eval "(() => { const body=document.body.innerText; const all=[...document.querySelectorAll('span')].filter(e=>/⚖ gate/.test(e.textContent||'')&&(e.textContent||'').length<220); const chips=all.filter(e=>!all.some(o=>o!==e&&e.contains(o))); let u=0,nj=0; for(const c of chips){ const mU=(c.textContent||'').match(/· (\d+)u/); const mN=(c.textContent||'').match(/· (\d+)nj/); if(mU) u+=+mU[1]; if(mN) nj+=+mN[1]; } return JSON.stringify({gate: chips.length, u: u, nj: nj, legend: /⚖ legend/.test(body)?1:0}); })()" || true

echo "--- run-panel long-paste leg ---"
agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r718 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true

echo "--- console ---"
agent-browser console | tail -80 || true
echo "--- page errors ---"
agent-browser errors || true
echo "=== r718 QA end ==="
