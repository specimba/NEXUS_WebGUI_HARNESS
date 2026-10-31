#!/usr/bin/env bash
# r815 witness: THE CENSUS SPEAKS - seed a two-entry live freellm census
# (one clean free-forever source + one gated signup-credits newcomer) into
# localStorage nexus-freellm-index, reload Settings, assert each census row
# self-describes its reach to screen readers (name, provider, access tiers,
# gated + newcomer disclosures), then RESTORE the prior cache value (the
# r813 prior-save/restore doctrine - real caches are never destroyed).
set -u
cd /home/z/my-project
{
echo "== r815 census row summary witness =="
agent-browser open "http://localhost:3000/?r=815t#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { const idx={asOf:Date.now(),origin:'live',total:2,entries:[{id:'src-alpha',name:'AlphaFree',provider:'alpha',access:['free-forever'],gated:false,url:'https://example.org/alpha',freeLimit:'5 req/min',types:['chat'],addedAt:'2026-09-01T00:00:00.000Z'},{id:'src-beta',name:'BetaGate',provider:'beta',access:['signup-credits'],gated:true,url:'https://example.org/beta',freeLimit:null,types:['chat','embed'],addedAt:'2026-10-25T00:00:00.000Z'}],counts:{operational:2,degraded:0,new14d:1}}; try { const prior=localStorage.getItem('nexus-freellm-index'); sessionStorage.setItem('r815-prior', prior===null?'null':prior); localStorage.setItem('nexus-freellm-index', JSON.stringify(idx)); return 'seeded:2'; } catch(e) { return 'seed-fail'; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=815t2#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
WIT=$(agent-browser eval "(() => { const lis=[...document.querySelectorAll('[data-testid=\"freellm-reach\"] [role=\"listitem\"][aria-label]')]; const labels=lis.map(e=>e.getAttribute('aria-label')); return JSON.stringify({rows:lis.length, labels:labels}); })()" || true)
echo "witness: $WIT"
WITN=${WIT//\\/}
echo "$WITN" | grep -q '"rows":2' || { echo 'GUARD census rows (census panel did not render the seeded entries)'; exit 1; }
echo "$WITN" | grep -q 'AlphaFree (alpha) — free-forever' || { echo 'GUARD alpha aria-label'; exit 1; }
echo "$WITN" | grep -q 'BetaGate (beta) — signup-credits · gated · new to the index' || { echo 'GUARD beta aria-label (gated + newcomer disclosures)'; exit 1; }
echo "rows: both census rows self-describe (access tiers + gated + newcomer)"
REST=$(agent-browser eval "(() => { try { const p=sessionStorage.getItem('r815-prior'); if(p===null||p==='null'){ localStorage.removeItem('nexus-freellm-index'); return 'restored:empty'; } localStorage.setItem('nexus-freellm-index', p); return 'restored:prior'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
echo "== r815 WITNESS GREEN =="
} > /tmp/r815_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 14 /tmp/r815_witness.out
