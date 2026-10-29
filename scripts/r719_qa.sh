#!/usr/bin/env bash
# r719 QA — golden legs + the in-app backup round trip witnesses.
# Waits for the dev server (post-restart), then agent-browser.
# Output: scripts/qa_r719_browser.txt (parsed by scripts/r719_gw.py).
set -u
cd /home/z/my-project
OUT=scripts/qa_r719_browser.txt
: > "$OUT"
exec > >(tee -a "$OUT") 2>&1

echo "=== r719 QA $(date -Is) ==="
for i in $(seq 1 60); do
  code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 3
done
echo "server: $code after wait"

echo "--- settings leg + vault backup witnesses ---"
agent-browser open "http://localhost:3000/#settings" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
agent-browser eval "JSON.stringify({census: /free-reach|free reach/i.test(document.body.innerText), relay: /Model Relay|intel ladder/i.test(document.body.innerText)})" || true
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/Back up now/i.test(x.textContent||'')); if(!b) return 'backup-btn-MISS'; b.click(); return 'backup-btn-clicked'; })()" || true
sleep 0.6
agent-browser eval "(() => JSON.stringify({confirmDialog: /Export the vault backup\\?/.test(document.body.innerText), pasteBox: !!document.querySelector('textarea[aria-label=\"Paste a backup JSON to restore\"]')}))()" || true
agent-browser eval "(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Export backup$/.test((x.textContent||'').trim())); if(!b) return 'export-btn-MISS'; b.click(); return 'export-btn-clicked'; })()" || true
sleep 1.2
agent-browser eval "(() => JSON.stringify({emptyToast: /vault is empty — nothing to back up yet/i.test(document.body.innerText), dialogClosed: !/Export the vault backup\\?/.test(document.body.innerText)}))()" || true

echo "--- radar leg (r712 stable aria name) ---"
agent-browser open "http://localhost:3000/#radar" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
agent-browser eval "(() => { const el = document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); if (!el) return 'frontier-aria-MISS'; el.click(); return 'frontier-aria-clicked'; })()" || true

echo "--- workflows leg: long paste ---"
agent-browser open "http://localhost:3000/#workflows" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r719 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true

echo "--- cron chip (sidebar footer) ---"
agent-browser eval "(() => { const m=(document.body.innerText.match(/cron (\\d+\\/\\d+|n\\/a|\\?\\/\\?)/)||[])[1]; return m||'cron-chip-MISS'; })()" || true

echo "--- console ---"
agent-browser console | tail -60 || true
echo "--- page errors ---"
agent-browser errors || true
echo "=== r719 QA end ==="
