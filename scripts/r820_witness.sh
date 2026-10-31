#!/usr/bin/env bash
# r820 witness: THE FLEET HEADER SPEAKS - seed two hard-failed lanes on ONE
# provider (pollinations::openai-fast + pollinations::mistral, both recently
# failed, soft:false) plus a healthy auto::builtin into localStorage
# nexus-relay-health (the r816 proven health-memory doctrine - the vault is
# never touched), reload Settings, then assert the fleet-health board SAYS its
# degraded aggregate: the badge reads "degraded fleet · ...", the board carries
# the "Fleet degraded — N provider(s) ... sick" paragraph (pre-r820 the
# degraded state lived ONLY in the border/icon COLOR when no breaker tripped),
# and a row shows its own "N sick" copy - then RESTORE the prior health memory
# (write-back-safe: restore -> navigate -> verify store-clean).
set -u
cd /home/z/my-project
{
echo "== r820 fleet-header aggregate witness =="
agent-browser open "http://localhost:3000/?r=820t#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { try { const raw=localStorage.getItem('nexus-relay-health'); sessionStorage.setItem('r820-prior-health', raw===null?'null':raw); const now=Date.now(); const h={}; try { const p=JSON.parse(raw||'{}'); Object.assign(h,p);} catch(e){} h['pollinations::openai-fast']={ok:0,fail:2,lastFailAt:now-20000,lastError:'429 witness',soft:false}; h['pollinations::mistral']={ok:0,fail:1,lastFailAt:now-25000,lastError:'capacity witness',soft:false}; h['auto::builtin']={ok:3,fail:0,lastOkAt:now}; localStorage.setItem('nexus-relay-health', JSON.stringify(h)); return 'seeded:3'; } catch(e) { return 'seed-fail:'+e.message; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=820t2#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
WIT=$(agent-browser eval "(() => { try { const sec=document.querySelector('[data-testid=\"fleet-health\"]'); if(!sec) return 'no-section'; const badge=[...sec.querySelectorAll('span')].map(s=>s.textContent).join(' | '); const paras=[...sec.querySelectorAll('p')].map(p=>p.textContent); const rowTexts=[...sec.querySelectorAll('li')].map(l=>l.textContent); return JSON.stringify({badge: badge.includes('degraded fleet'), para: paras.some(t=>t.includes('Fleet degraded') && t.includes('sick') && t.includes('No breaker tripped yet')), sickRow: rowTexts.some(t=>/sick/.test(t)), enough: rowTexts.length >= 2}); } catch(e){ return 'err:'+e.message; } })()" || true)
echo "witness: $WIT"
WITN=${WIT//\\/}
echo "$WITN" | grep -q '"badge":true' || { echo 'GUARD degraded badge utterance'; exit 1; }
echo "$WITN" | grep -q '"para":true' || { echo 'GUARD degraded aggregate paragraph'; exit 1; }
echo "$WITN" | grep -q '"sickRow":true' || { echo 'GUARD per-row sick copy'; exit 1; }
echo "$WITN" | grep -q '"enough":true' || { echo 'GUARD fleet rows rendered'; exit 1; }
echo "rows: the fleet header says its degraded state (badge + aggregate paragraph + per-row sick copy)"
REST=$(agent-browser eval "(() => { try { const h=sessionStorage.getItem('r820-prior-health'); if(h===null||h==='null'){ localStorage.removeItem('nexus-relay-health'); } else { localStorage.setItem('nexus-relay-health', h); } sessionStorage.removeItem('r820-prior-health'); return 'restored:prior'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
agent-browser open "http://localhost:3000/?r=820t3#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
FIX=$(agent-browser eval "(() => { try { const s=sessionStorage.getItem('r820-prior-health'); if(s===null||s==='null'){ localStorage.removeItem('nexus-relay-health'); } else { localStorage.setItem('nexus-relay-health', s); } return 'fixed:prior-rewritten'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "file-fix: $FIX"
agent-browser open "http://localhost:3000/?r=820t4#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
CHECK=$(agent-browser eval "(() => { try { const raw=localStorage.getItem('nexus-relay-health')||''; const clean=!raw.includes('witness'); return clean?'store-clean:yes':'store-clean:NO'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "reload-check: $CHECK"
echo "$CHECK" | grep -q 'store-clean:yes' || { echo 'GUARD health store still polluted after restore+reload'; exit 1; }
echo "== r820 WITNESS GREEN =="
} > /tmp/r820_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 14 /tmp/r820_witness.out
