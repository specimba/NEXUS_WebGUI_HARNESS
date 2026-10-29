#!/usr/bin/env bash
# r720 QA — the MIRROR-STRIP witness + the r719 backup round trip WITH DATA.
# Road: mirror a browser-saved key -> Back up now -> capture exported
# plaintext (masked; never logged raw) -> paste-restore the SAME text ->
# idempotent upsert witness. Plus U/NJ chip DOM witness attempt #13 (amber
# span on a live run chip) and the golden legs.
# Output: scripts/qa_r720_browser.txt
set -u
cd /home/z/my-project
OUT=scripts/qa_r720_browser.txt
: > "$OUT"
exec > >(tee -a "$OUT") 2>&1

echo "=== r720 QA $(date -Is) ==="
for i in $(seq 1 60); do
  code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 3
done
echo "server: $code after wait"

echo "--- settings leg: mirror census + mirror click ---"
agent-browser open "http://localhost:3000/#settings" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
agent-browser eval "JSON.stringify({census: /free-reach|free reach/i.test(document.body.innerText), relay: /Model Relay|intel ladder/i.test(document.body.innerText)})" || true
# readiness strip BEFORE
agent-browser eval "(() => { const el=document.querySelector('[data-testid=\"vault-readiness-strip\"]'); return el ? el.getAttribute('aria-label') : 'readiness-MISS'; })()" || true
# mirror strip census (count only — never key material)
agent-browser eval "(() => { const el=document.querySelector('[data-testid=\"mirror-count\"]'); return 'mirror-count:'+(el?el.textContent.trim():'MISS'); })()" || true
agent-browser eval "(() => { const btns=[...document.querySelectorAll('button')].filter(b=>/^Mirror$/i.test((b.textContent||'').trim())); if(!btns.length) return 'mirror-btns:0'; btns[0].click(); return 'mirror-btns:'+btns.length+' first-clicked'; })()" || true
sleep 2.5
agent-browser eval "(() => { const toasts=[...document.querySelectorAll('[data-sonner-toast],li')].map(t=>t.textContent||'').join(' | '); const hit=/mirrored to the server lane|Mirror failed/.test(toasts); return hit ? ('mirror-toast:'+(toasts.match(/mirrored to the server lane|Mirror failed/)||[''])[0]) : 'mirror-toast:not-seen'; })()" || true
# readiness strip AFTER (growth = the recovery signal)
agent-browser eval "(() => { const el=document.querySelector('[data-testid=\"vault-readiness-strip\"]'); return el ? el.getAttribute('aria-label') : 'readiness-MISS'; })()" || true

echo "--- backup round trip WITH DATA (r719 road, armed) ---"
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/Back up now/i.test(x.textContent||'')); if(!b) return 'backup-btn-MISS'; b.click(); return 'backup-btn-clicked'; })()" || true
sleep 0.6
agent-browser eval "(() => JSON.stringify({confirmDialog: /Export the vault backup\\?/.test(document.body.innerText)}))()" || true
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Export backup$/.test((x.textContent||'').trim())); if(!b) return 'export-btn-MISS'; b.click(); return 'export-btn-clicked'; })()" || true
sleep 1.2
# capture the exported plaintext (masked: only length + slot count + hasCopy leave the page)
agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>(x.value||'').trim().startsWith('{') && (x.value||'').includes('slots')); if(!t) return 'export-plaintext-MISS'; let n=-1; try { n=(JSON.parse(t.value).slots||[]).length; } catch(e) { return 'export-parse-FAIL'; } const copy=[...document.querySelectorAll('button')].some(b=>/^Copy( to clipboard)?$|^Copy$/.test((b.textContent||'').trim())); window.__r720backup=t.value; return JSON.stringify({plaintextLen:t.value.length, slots:n, hasCopyBtn:copy}); })()" || true
# close the export dialog
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/^(Close|Done|OK)$/i.test((x.textContent||'').trim())); if(b) b.click(); return 'close-clicked'; })()" || true
sleep 0.5
# paste-restore the SAME captured text (idempotent upsert)
agent-browser eval "(() => { const t=document.querySelector('textarea[aria-label=\"Paste a backup JSON to restore\"]'); if(!t) return 'pasteBox-MISS'; const v=window.__r720backup||''; if(!v) return 'no-captured-backup'; const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+v.length; })()" || true
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/restore/i.test(x.textContent||'') && !x.disabled); if(!b) return 'restore-btn-MISS'; b.click(); return 'restore-btn-clicked'; })()" || true
sleep 2.5
agent-browser eval "(() => { const toasts=[...document.querySelectorAll('[data-sonner-toast],li')].map(t=>t.textContent||'').join(' | '); const m=toasts.match(/restored|Restore failed|vault restored/i); return m ? 'restore-toast:'+m[0] : 'restore-toast:not-seen'; })()" || true
agent-browser eval "(() => { const el=document.querySelector('[data-testid=\"vault-readiness-strip\"]'); return el ? el.getAttribute('aria-label') : 'readiness-MISS'; })()" || true

echo "--- radar leg (r712 stable aria name) ---"
agent-browser open "http://localhost:3000/#radar" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
agent-browser eval "(() => { const el = document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); if (!el) return 'frontier-aria-MISS'; el.click(); return 'frontier-aria-clicked'; })()" || true

echo "--- workflows leg: long paste + U/NJ amber witness (attempt #13) ---"
agent-browser open "http://localhost:3000/#workflows" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
agent-browser eval "(() => { const amber=[...document.querySelectorAll('span')].filter(s=>/text-amber-600|text-amber-400/.test(s.className) && /\\d+u/.test(s.textContent||'')); const nj=[...document.querySelectorAll('span')].filter(s=>/text-muted-foreground/.test(s.className) && /\\d+nj/.test(s.textContent||'')); return JSON.stringify({amberU:amber.map(s=>s.textContent.trim()).slice(0,4), njTon:nj.map(s=>s.textContent.trim()).slice(0,4)}); })()" || true
agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r720 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true

echo "--- cron chip (sidebar footer) ---"
agent-browser eval "(() => { const m=(document.body.innerText.match(/cron (\\d+\\/\\d+|n\\/a|\\?\\/\\?)/)||[])[1]; return m||'cron-chip-MISS'; })()" || true

echo "--- console ---"
agent-browser console | tail -40 || true
echo "--- page errors ---"
agent-browser errors || true
echo "=== r720 QA end ==="
