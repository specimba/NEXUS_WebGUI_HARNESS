#!/usr/bin/env bash
# r817 witness: THE LEDGER SPEAKS - seed two evolution seeds (one adopt-verdict
# with a reproduced AWorld stamp carrying 2 evidence checks, one watch-verdict
# with no reproduction yet) into localStorage nexus-frontier-seeds, reload
# Radar -> Frontier, assert each ledger row self-describes its verdict, score
# and AWorld reproduction state to screen readers (the pre-r817 rows were
# anonymous divs whose verdict lived only in an aria-hidden color dot), then
# RESTORE the prior seed ledger (the r813 prior-save/restore doctrine).
set -u
cd /home/z/my-project
{
echo "== r817 seed-ledger utterance witness =="
agent-browser open "http://localhost:3000/?r=817t#/radar/frontier" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { try { const raw=localStorage.getItem('nexus-frontier-seeds'); sessionStorage.setItem('r817-prior-seeds', raw===null?'null':raw); const now=Date.now(); const seeds=[{id:'gh:witness-alpha',kind:'repo',title:'WitnessAlpha Agent Harness',url:'https://example.org/alpha',total:82,seed:'reproduce WitnessAlpha',judgedAt:now-60000,reproduction:{verdict:'reproduced',evidence:['provenance ok','claim ok']}},{id:'paper:witness-beta',kind:'paper',title:'WitnessBeta Scaling Study',url:'https://example.org/beta',total:55,seed:'reproduce WitnessBeta',judgedAt:now-120000}]; localStorage.setItem('nexus-frontier-seeds', JSON.stringify(seeds)); return 'seeded:2'; } catch(e) { return 'seed-fail:'+e.message; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=817t2#/radar/frontier" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
WIT=$(agent-browser eval "(() => { const lis=[...document.querySelectorAll('[aria-label=\"Pinned evolution seeds\"] [role=\"listitem\"][aria-label]')]; const labels=lis.map(e=>e.getAttribute('aria-label')); return JSON.stringify({rows:lis.length, labels:labels}); })()" || true)
echo "witness: $WIT"
WITN=${WIT//\\/}
echo "$WITN" | grep -q '"rows":2' || { echo 'GUARD ledger rows (seeded rows did not render as listitems)'; exit 1; }
echo "$WITN" | grep -q 'WitnessAlpha Agent Harness — adopt 82/100 · AWorld reproduced · 2 evidence checks' || { echo 'GUARD alpha utterance (verdict + score + reproduced + evidence count)'; exit 1; }
echo "$WITN" | grep -q 'WitnessBeta Scaling Study — watch 55/100 · AWorld check available, not yet verified' || { echo 'GUARD beta utterance (watch verdict + unverified fallback)'; exit 1; }
echo "rows: both ledger rows self-describe (verdict + score + AWorld reproduction state)"
REST=$(agent-browser eval "(() => { try { const s=sessionStorage.getItem('r817-prior-seeds'); if(s===null||s==='null'){ localStorage.removeItem('nexus-frontier-seeds'); } else { localStorage.setItem('nexus-frontier-seeds', s); } sessionStorage.removeItem('r817-prior-seeds'); return 'restored:prior'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
echo "== r817 WITNESS GREEN =="
} > /tmp/r817_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 14 /tmp/r817_witness.out
