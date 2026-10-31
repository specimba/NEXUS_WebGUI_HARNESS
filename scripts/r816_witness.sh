#!/usr/bin/env bash
# r816 witness v2: THE CHAIN SPEAKS - seed health verdicts on two DETERMINISTIC
# chain rows (pollinations::openai-fast - the noKey lane that renders with no
# key at all; auto::builtin - the pinned-last resort) into localStorage
# nexus-relay-health, reload Settings, assert the hop utterances carry the
# transport position ("dials first"), tier, and the witnessed states ("demoted,
# failed recently" on the failed lane, "answered 3 times" on the auto resort,
# "no saved verdicts yet" on untouched rows) - then RESTORE the prior health
# memory (the r813 prior-save/restore doctrine). v1 learned: seeding settings
# providerKeys cannot drive the live store (the vault merge owns real keys) -
# no settings are touched here, the vault stays untouched.
set -u
cd /home/z/my-project
{
echo "== r816 chain-hop utterance witness v2 =="
agent-browser open "http://localhost:3000/?r=816t#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { try { const raw=localStorage.getItem('nexus-relay-health'); sessionStorage.setItem('r816-prior-health', raw===null?'null':raw); const now=Date.now(); const h={}; try { const p=JSON.parse(raw||'{}'); Object.assign(h,p);} catch(e){} h['pollinations::openai-fast']={ok:1,fail:2,lastFailAt:now-20000,lastError:'429 witness',soft:false}; h['auto::builtin']={ok:3,fail:0,lastOkAt:now}; localStorage.setItem('nexus-relay-health', JSON.stringify(h)); return 'seeded:2'; } catch(e) { return 'seed-fail:'+e.message; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=816t2#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
WIT=$(agent-browser eval "(() => { const lis=[...document.querySelectorAll('[aria-label=\"Fallback chain\"] [role=\"listitem\"][aria-label]')]; const labels=lis.map(e=>e.getAttribute('aria-label')); const poll=labels.find(l=>l.indexOf('Pollinations · openai-fast — hop')===0)||null; const auto=labels.find(l=>l.indexOf('Built-in engine — pinned last')===0)||null; return JSON.stringify({rows:lis.length, first:labels[0]||null, poll:poll, auto:auto, cleanState:labels.some(l=>l.indexOf('no saved verdicts yet')>0)}); })()" || true)
echo "witness: $WIT"
WITN=${WIT//\\/}
echo "$WITN" | grep -q '"rows"' || { echo 'GUARD chain rows (fallback chain list did not render)'; exit 1; }
echo "$WITN" | grep -q '— hop 1, dials first, tier' || { echo 'GUARD transport ordinal utterance'; exit 1; }
echo "$WITN" | grep -q 'no saved verdicts yet' || { echo 'GUARD clean-state utterance'; exit 1; }
echo "$WITN" | grep -q 'Pollinations · openai-fast — hop' || { echo 'GUARD pollinations row rendered'; exit 1; }
echo "$WITN" | grep -q 'demoted, failed recently' || { echo 'GUARD demoted-state utterance (recent hard fail)'; exit 1; }
echo "$WITN" | grep -q 'Built-in engine — pinned last: fires only after every named hop fails' || { echo 'GUARD auto pinned-last doctrine phrase'; exit 1; }
echo "$WITN" | grep -q 'answered 3 times' || { echo 'GUARD answered-state utterance'; exit 1; }
echo "$WITN" | grep -q 'tier T2 Modern' || { echo 'GUARD tier phrase'; exit 1; }
echo "rows: transport ordinals + tier + all three states (demoted / answered / clean) + pinned-last doctrine witnessed live"
REST=$(agent-browser eval "(() => { try { const h=sessionStorage.getItem('r816-prior-health'); if(h===null||h==='null'){ localStorage.removeItem('nexus-relay-health'); } else { localStorage.setItem('nexus-relay-health', h); } sessionStorage.removeItem('r816-prior-health'); return 'restored:prior'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
echo "== r816 WITNESS GREEN =="
} > /tmp/r816_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 14 /tmp/r816_witness.out
