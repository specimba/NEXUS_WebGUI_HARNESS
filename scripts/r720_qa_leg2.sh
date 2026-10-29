#!/usr/bin/env bash
# r720 QA leg 2 — the mirror witness with corrected selectors.
# Generic mirror-button discovery (text OR aria containing 'mirror', inside
# or beside the mirror-count strip), then the full data round trip:
# mirror -> readiness growth -> Back up -> Export -> capture plaintext ->
# paste-restore the SAME text -> restore toast. Key material NEVER logged.
set -u
cd /home/z/my-project
OUT=scripts/qa_r720_leg2.txt
: > "$OUT"
exec > >(tee -a "$OUT") 2>&1

echo "=== r720 leg2 $(date -Is) ==="
agent-browser open "http://localhost:3000/#settings" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
agent-browser eval "(() => { const el=document.querySelector('[data-testid=\"vault-readiness-strip\"]'); return el ? el.getAttribute('aria-label') : 'readiness-MISS'; })()" || true
agent-browser eval "(() => { const el=document.querySelector('[data-testid=\"mirror-count\"]'); return 'mirror-count:'+(el?el.textContent.trim():'MISS'); })()" || true
# dump mirror-adjacent button labels (labels only)
agent-browser eval "(() => { const bs=[...document.querySelectorAll('button')].filter(b=>/mirror/i.test(b.textContent||'')||/mirror/i.test(b.getAttribute('aria-label')||'')); return JSON.stringify(bs.map(b=>({t:(b.textContent||'').trim().slice(0,40), a:b.getAttribute('aria-label'), d:!!b.disabled}))); })()" || true
# click first enabled mirror-ish button
agent-browser eval "(() => { const bs=[...document.querySelectorAll('button')].filter(b=>/mirror/i.test(b.textContent||'')||/mirror/i.test(b.getAttribute('aria-label')||'')).filter(b=>!b.disabled); if(!bs.length) return 'mirror-click: none-enabled'; bs[0].click(); return 'mirror-click: clicked [0/'+bs.length+']'; })()" || true
sleep 3
agent-browser eval "(() => { const toasts=[...document.querySelectorAll('[data-sonner-toast],li')].map(t=>t.textContent||'').join(' | '); const m=toasts.match(/mirrored to the server lane|Mirror failed/i); return m ? 'mirror-toast:'+m[0] : 'mirror-toast:not-seen'; })()" || true
agent-browser eval "(() => { const el=document.querySelector('[data-testid=\"vault-readiness-strip\"]'); return el ? el.getAttribute('aria-label') : 'readiness-MISS'; })()" || true

echo "--- backup round trip (vault now has lanes if mirror landed) ---"
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/Back up now/i.test(x.textContent||'')); if(!b) return 'backup-btn-MISS'; b.click(); return 'backup-btn-clicked'; })()" || true
sleep 0.6
agent-browser eval "(() => JSON.stringify({confirmDialog: /Export the vault backup\\?/.test(document.body.innerText), emptyWarn: /vault is empty/i.test(document.body.innerText)}))()" || true
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Export backup$/.test((x.textContent||'').trim())); if(!b) return 'export-btn-MISS'; b.click(); return 'export-btn-clicked'; })()" || true
sleep 1.2
agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>{const v=(x.value||'').trim(); return v.startsWith('{') && v.includes('slots');}); if(!t) return 'export-plaintext-MISS'; let n=-1; try { n=(JSON.parse(t.value).slots||[]).length; } catch(e) { return 'export-parse-FAIL'; } const copy=[...document.querySelectorAll('button')].some(b=>/^Copy$/i.test((b.textContent||'').trim())); window.__r720b=t.value; return JSON.stringify({plaintextLen:t.value.length, slots:n, hasCopyBtn:copy}); })()" || true
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/^(Close|Done|OK)$/i.test((x.textContent||'').trim())); if(b) b.click(); return 'close-clicked'; })()" || true
sleep 0.5
agent-browser eval "(() => { const t=document.querySelector('textarea[aria-label=\"Paste a backup JSON to restore\"]'); if(!t) return 'pasteBox-MISS'; const v=window.__r720b||''; if(!v) return 'no-captured-backup'; const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+v.length; })()" || true
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/restore/i.test(x.textContent||'') && !x.disabled); if(!b) return 'restore-btn-MISS'; b.click(); return 'restore-btn-clicked'; })()" || true
sleep 2.5
agent-browser eval "(() => { const toasts=[...document.querySelectorAll('[data-sonner-toast],li')].map(t=>t.textContent||'').join(' | '); const m=toasts.match(/restored|Restore failed/i); return m ? 'restore-toast:'+m[0] : 'restore-toast:not-seen'; })()" || true
agent-browser eval "(() => { const el=document.querySelector('[data-testid=\"vault-readiness-strip\"]'); return el ? el.getAttribute('aria-label') : 'readiness-MISS'; })()" || true

echo "--- console tail ---"
agent-browser console | tail -12 || true
echo "=== r720 leg2 end ==="
