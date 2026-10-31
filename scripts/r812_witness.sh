#!/usr/bin/env bash
# r812 witness: THE TALLY'S HONEST RIDE - seed a three-state registry
# (1 active + 1 muted + 1 retired) into localStorage nexus-relay-adopted,
# reload Settings, assert the tally splits the ride from the parked rows
# ("1 of 3 ... · 1 muted · 1 retired") and each row self-describes its state,
# then CLEAN UP (the seed is removed - the profile keeps its honest state).
set -u
cd /home/z/my-project
{
echo "== r812 lane-ride tally witness =="
agent-browser open "http://localhost:3000/?r=812t#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { const lanes=[{key:'groq::llama-3.3-70b-versatile',providerId:'groq',modelId:'llama-3.3-70b-versatile',contextWindow:131072,priceIn:0,priceOut:0,free:true,firstSeenAt:'2026-10-30T00:00:00.000Z',adoptedAt:'2026-10-30T00:00:00.000Z',origin:'manual',enabled:true},{key:'cerebras::llama-3.3-70b',providerId:'cerebras',modelId:'llama-3.3-70b',contextWindow:131072,priceIn:0,priceOut:0,free:true,firstSeenAt:'2026-10-29T00:00:00.000Z',adoptedAt:'2026-10-29T00:00:00.000Z',origin:'manual',enabled:false,disabledReason:'user muted'},{key:'openrouter::meta-llama/llama-3.3-70b-instruct',providerId:'openrouter',modelId:'meta-llama/llama-3.3-70b-instruct',contextWindow:131072,priceIn:0,priceOut:0,free:true,firstSeenAt:'2026-10-28T00:00:00.000Z',adoptedAt:'2026-10-28T00:00:00.000Z',origin:'manual',enabled:false,retired:true,retiredReason:'removed from openrouter catalog · 2026-10-28',retiredAt:'2026-10-28T00:00:00.000Z'}]; try { localStorage.setItem('nexus-relay-adopted', JSON.stringify(lanes)); return 'seeded:'+lanes.length; } catch(e) { return 'seed-fail'; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=812t2#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
WIT=$(agent-browser eval "(() => { const t=document.querySelector('[data-testid=\"lane-ride-tally\"]'); const lis=[...document.querySelectorAll('li[aria-label]')].filter(e=>/lane, (active|muted|retired)/.test(e.getAttribute('aria-label')||'')); return JSON.stringify({tally:t?t.textContent.trim():'TALLY-MISS', rows:lis.length, labels:lis.map(e=>e.getAttribute('aria-label'))}); })()" || true)
echo "witness: $WIT"
WITN=${WIT//\\/}
case "$WITN" in
  *'1 of 3 adopted lanes ride the chain'*'1 muted'*'1 retired'*) echo "tally: HONEST - the ride count splits from the parked rows (muted + retired disclose themselves, active counted alone)";;
  *'TALLY-MISS'*) echo 'GUARD tally element (registry section did not render)'; exit 1;;
  *) echo "GUARD tally text"; exit 1;;
esac
echo "$WITN" | grep -q 'free lane, active' || { echo 'GUARD active aria-label'; exit 1; }
echo "$WITN" | grep -q 'free lane, muted' || { echo 'GUARD muted aria-label'; exit 1; }
echo "$WITN" | grep -q 'free lane, retired' || { echo 'GUARD retired aria-label'; exit 1; }
echo "rows: all three aria-label states witnessed"
CLEAN=$(agent-browser eval "(() => { localStorage.removeItem('nexus-relay-adopted'); return 'cleaned'; })()" || true)
echo "cleanup: $CLEAN"
echo "== r812 WITNESS GREEN =="
} > /tmp/r812_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 14 /tmp/r812_witness.out
