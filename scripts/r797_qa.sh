#!/usr/bin/env bash
# r797 golden QA + judge-lane board witness (deep-link round; r741 template +
# r797 nav: board legs use the new #/workflows/board deep-link so the strip
# witness no longer depends on a stale persisted layout bit).
set -u
cd /home/z/my-project
{
echo "== r797 golden QA + judge-lane board witness =="
agent-browser open "http://localhost:3000/?r=797#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
for i in 1 2 3 4 5 6; do
  sleep 5
  W1=$(agent-browser eval "(() => { const strip=document.querySelector('[data-testid=\"corpus-only-runs\"]'); const chip=(document.body.innerText.match(/(\d+) in corpus/)||[])[1]; const empty=!!document.querySelector('[data-testid=\"board-empty-state\"]'); const shown=strip?strip.textContent.match(/(\d+) of (\d+) shown/):null; return JSON.stringify({strip:!!strip,corpusChip:chip==null?null:Number(chip),emptyNotice:empty,chips:strip?strip.querySelectorAll('button,[role=button]').length:0,corpusPills:shown?Number(shown[2]):null,cap:shown?Number(shown[1]):null}); })()" || true)
  case "$W1" in *'"strip":true'*|*'"corpusChip":0'*) break;; esac
done
echo "board: $W1"
case "$W1" in *'"corpusChip":0'*) echo "board: $W1 (honest-empty: this browser profile holds no run corpus, strip correctly absent)";; *'"strip":true'*) echo "board: $W1";; *) echo "GUARD board strip (corpus non-empty, strip absent): $W1"; exit 1;; esac
echo "$W1" | grep -vq 'TALLY-MISS' || { echo 'GUARD board tally'; exit 1; }
LDW=$(agent-browser eval "(() => { const strip=document.querySelector('[data-testid=\"corpus-only-runs\"]'); if(!strip) return JSON.stringify({ld:false,skipped:'no-strip-honest-empty'}); const el=[...strip.querySelectorAll('[title]')].find(e=>/no-judge failures/.test(e.getAttribute('title')||'')); if(!el) return JSON.stringify({ld:false,note:'no-nj-title'}); const t=el.getAttribute('title'); return JSON.stringify({ld:true,count:(t.match(/these (\d+) no-judge/)||[])[1]||'',hasIntern:/intern-systemone/.test(t),hasFast:/fast-judge/.test(t),hasPaid:/paid rung/.test(t),lanes:(t.match(/deduped\):\s*([\s\S]*)$/)||[])[1]||''}); })()" || true)
echo "ld: $LDW"
case "$LDW" in *'no-strip-honest-empty'*) echo "ld: skipped (honest-empty profile, no strip)";; *'"ld":true'*) echo "$LDW" | grep -q 'hasIntern\":true' || { echo 'GUARD ld intern'; exit 1; }; echo "$LDW" | grep -q 'hasFast\":true' || { echo 'GUARD ld fast'; exit 1; };; *) echo 'GUARD ld'; exit 1;; esac
agent-browser open "http://localhost:3000/?r=797s#settings" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
SET=$(agent-browser eval "JSON.stringify({census: /free-reach|free reach/i.test(document.body.innerText), relay: /Model Relay|intel ladder/i.test(document.body.innerText)})" || true)
echo "settings: $SET"
echo "$SET" | grep -Eq 'census\\?":true' || { echo 'GUARD settings census'; exit 1; }
echo "$SET" | grep -Eq 'relay\\?":true' || { echo 'GUARD settings relay'; exit 1; }
agent-browser open "http://localhost:3000/?r=797r#radar" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
RAD=$(agent-browser eval "(() => { const el = document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); if (!el) return 'frontier-aria-MISS'; el.click(); return 'frontier-aria-clicked'; })()" || true)
echo "radar: $RAD"
echo "$RAD" | grep -q "frontier-aria-clicked" || { echo 'GUARD radar'; exit 1; }
agent-browser open "http://localhost:3000/?r=797w#/workflows/board" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
PASTE=$(agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r797 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true)
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
echo "== r797 QA GREEN =="
} 2>&1 | tee scripts/qa_r797.txt
exit ${PIPESTATUS[0]}
echo "QA-COMPLETE $(date -u +%H:%M:%S)"
echo "qa_r797 $(date -u +%FT%TZ) board=$W1 set=$SET rad=$RAD paste=$PASTE cron=$CRON errs=$ERRS" > scripts/qa_r797.txt
