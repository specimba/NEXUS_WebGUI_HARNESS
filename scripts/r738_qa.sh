#!/usr/bin/env bash
# r738 golden QA + judge-lane board witness (watch round; adapted from r737_qa.sh)
set -u
cd /home/z/my-project
{
echo "== r738 golden QA + judge-lane board witness =="
agent-browser open "http://localhost:3000/#workflows" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
agent-browser eval "(() => { const r=[...document.querySelectorAll('[role=radio]')].find(x=>/Runs board layout/i.test(x.textContent||x.getAttribute('aria-label')||'')); if(r) r.click(); return r?'radio-ok':'radio-MISS'; })()" || true
sleep 1.5
W1=$(agent-browser eval "(() => { const strip=document.querySelector('[data-testid=\"corpus-only-runs\"]'); if(!strip) return JSON.stringify({strip:false}); const tally=[...strip.querySelectorAll('span')].find(e=>/runs . \d+ ev/.test(e.textContent||'')); const chips=strip.querySelectorAll('button,[role=button]').length; return JSON.stringify({strip:true,tally:tally?tally.textContent:'TALLY-MISS',chips:chips}); })()" || true)
echo "board: $W1"
echo "$W1" | grep -Eq 'strip\\?":true' || { echo 'GUARD board strip'; exit 1; }
echo "$W1" | grep -vq 'TALLY-MISS' || { echo 'GUARD board tally'; exit 1; }
LDW=$(agent-browser eval "(() => { const el=[...document.querySelectorAll('[data-testid=\"corpus-only-runs\"] [title]')].find(e=>/no-judge failures/.test(e.getAttribute('title')||'')); if(!el) return JSON.stringify({ld:false,note:'no-nj-title'}); const t=el.getAttribute('title'); return JSON.stringify({ld:true,hasIntern:/intern-systemone/.test(t),hasFast:/fast-judge/.test(t),hasTokenPlan:/TokenPlan/.test(t),hasAIHubMix:/AIHubMix/.test(t),hasPaid:/paid rung/.test(t),lanes:(t.match(/deduped\):\s*([\s\S]*)$/)||[])[1]||''}); })()" || true)
echo "ld: $LDW"
echo "$LDW" | grep -Eq 'ld\\?":true' || { echo 'GUARD ld'; exit 1; }
echo "$LDW" | grep -Eq 'hasIntern\\?":true' || { echo 'GUARD ld intern'; exit 1; }
echo "$LDW" | grep -Eq 'hasFast\\?":true' || { echo 'GUARD ld fast'; exit 1; }
agent-browser open "http://localhost:3000/#settings" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
SET=$(agent-browser eval "JSON.stringify({census: /free-reach|free reach/i.test(document.body.innerText), relay: /Model Relay|intel ladder/i.test(document.body.innerText)})" || true)
echo "settings: $SET"
echo "$SET" | grep -Eq 'census\\?":true' || { echo 'GUARD settings census'; exit 1; }
echo "$SET" | grep -Eq 'relay\\?":true' || { echo 'GUARD settings relay'; exit 1; }
agent-browser open "http://localhost:3000/#radar" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
RAD=$(agent-browser eval "(() => { const el = document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); if (!el) return 'frontier-aria-MISS'; el.click(); return 'frontier-aria-clicked'; })()" || true)
echo "radar: $RAD"
echo "$RAD" | grep -q "frontier-aria-clicked" || { echo 'GUARD radar'; exit 1; }
agent-browser open "http://localhost:3000/#workflows" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
PASTE=$(agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r738 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true)
echo "paste: $PASTE"
echo "$PASTE" | grep -q "paste-len:799" || { echo 'GUARD paste'; exit 1; }
CRON=$(agent-browser eval "(() => { const m=(document.body.innerText.match(/cron (\d+\/\d+|n\/a|\?\/\?)/)||[])[1]; return m||'cron-chip-MISS'; })()" || true)
echo "cron chip: $CRON"
CONSOLE=$(agent-browser console 2>/dev/null | tail -20 || true)
ERRS=$(agent-browser errors 2>/dev/null || true)
echo "--- console tail ---"; echo "$CONSOLE" | grep -v "Fast Refresh" | tail -8
echo "--- page errors ---"; echo "$ERRS"
if [ -n "$ERRS" ] && ! echo "$ERRS" | grep -qi 'no error'; then echo 'GUARD page-errors'; exit 1; fi
if echo "$CONSOLE" | grep -v 'Fast Refresh' | grep -qi 'error'; then echo 'GUARD console-error'; exit 1; fi
echo "== r738 QA GREEN =="
} 2>&1 | tee scripts/qa_r738.txt
exit ${PIPESTATUS[0]}
