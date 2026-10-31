#!/usr/bin/env bash
# r814 witness: THE FLEET SPEAKS - seed a three-state health memory
# (1 ok + 1 sick + 1 throttled under one provider) into localStorage
# nexus-relay-health, reload Settings, assert the fleet row self-describes
# the state split ("N ok, 1 sick, 1 throttled · M answers served") and the
# sick/throttled teaching tooltips render, then RESTORE the prior value
# (the seed never destroys real dial history - the r812 flat-replace lesson).
set -u
cd /home/z/my-project
{
echo "== r814 fleet row summary witness =="
agent-browser open "http://localhost:3000/?r=814t#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { const now=Date.now(); const h={}; h['groq::llama-3.3-70b-versatile']={ok:2,fail:0,lastOkAt:now-20000}; h['groq::qwen-2.5-72b-instruct']={ok:0,fail:3,lastFailAt:now-20000,lastError:'HTTP 500 upstream exploded'}; h['groq::qwen-2.5-coder-32b']={ok:1,fail:2,lastFailAt:now-20000,lastError:'HTTP 429 rate limited',soft:true}; try { const prior=localStorage.getItem('nexus-relay-health'); sessionStorage.setItem('r814-prior', prior===null?'null':prior); localStorage.setItem('nexus-relay-health', JSON.stringify(h)); return 'seeded:3'; } catch(e) { return 'seed-fail'; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=814t2#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
WIT=$(agent-browser eval "(() => { const li=document.querySelector('[data-testid=\"fleet-health-row\"]'); const sick=[...document.querySelectorAll('span[title], abbr[title]')].length; const sickTip=!!document.querySelector('[title*=\"demoted in the rotation\"]'); const thrTip=!!document.querySelector('[title*=\"never demoted\"]'); const okTip=!!document.querySelector('[title*=\"ride first\"]'); return JSON.stringify({label:li?li.getAttribute('aria-label'):'ROW-MISS', sickTip:sickTip, thrTip:thrTip, okTip:okTip}); })()" || true)
echo "witness: $WIT"
WITN=${WIT//\\/}
case "$WITN" in
  *'2 ok, 1 sick, 1 throttled'*'3 answers served'*) echo "row: HONEST - the fleet row self-describes the state split (ok/sick/throttled + answers served)";;
  *'ROW-MISS'*) echo 'GUARD fleet row (no dial history rendered)'; exit 1;;
  *) echo "GUARD row label"; exit 1;;
esac
echo "$WITN" | grep -q '"sickTip":true' || { echo 'GUARD sick tooltip'; exit 1; }
echo "$WITN" | grep -q '"thrTip":true' || { echo 'GUARD throttled tooltip'; exit 1; }
echo "$WITN" | grep -q '"okTip":true' || { echo 'GUARD ok tooltip'; exit 1; }
echo "tooltips: all three teachings witnessed"
REST=$(agent-browser eval "(() => { try { const p=sessionStorage.getItem('r814-prior'); if(p===null||p==='null'){ localStorage.removeItem('nexus-relay-health'); return 'restored:empty'; } localStorage.setItem('nexus-relay-health', p); return 'restored:prior'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
echo "== r814 WITNESS GREEN =="
} > /tmp/r814_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 14 /tmp/r814_witness.out
