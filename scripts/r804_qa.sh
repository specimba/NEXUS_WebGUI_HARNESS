#!/usr/bin/env bash
# r804 golden QA + judge-lane board witness (receipt round; r741 template +
# r804 nav: the compact receipt leg witnesses the durable compaction record
# that compactNexusStorage now writes for BOTH arms — manual button here,
# boot auto-responder shares the same code path).
set -u
cd /home/z/my-project
{
echo "== r804 golden QA + compact-receipt witness =="
agent-browser open "http://localhost:3000/?r=804#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
for i in 1 2 3 4 5 6; do
  sleep 5
  W1=$(agent-browser eval "(() => { const strip=document.querySelector('[data-testid=\"corpus-only-runs\"]'); const chip=(document.body.innerText.match(/(\d+) in corpus/)||[])[1]; const empty=!!document.querySelector('[data-testid=\"board-empty-state\"]'); const shown=strip?strip.textContent.match(/(\d+) of (\d+) shown/):null; return JSON.stringify({strip:!!strip,corpusChip:chip==null?null:Number(chip),emptyNotice:empty,chips:strip?strip.querySelectorAll('button,[role=button]').length:0,corpusPills:shown?Number(shown[2]):null,cap:shown?Number(shown[1]):null}); })()" || true)
  case "$W1" in *'"strip":true'*|*'"corpusChip":0'*|*'emptyNotice":true'*) break;; esac
done
echo "board: $W1"
W1N=${W1//\\/}
case "$W1N" in *'"corpusChip":0'*|*'emptyNotice":true'*) echo "board: $W1 (honest-empty: this browser profile holds no run corpus, strip correctly absent)";; *'"strip":true'*) echo "board: $W1";; *) echo "GUARD board strip (corpus non-empty, strip absent): $W1"; exit 1;; esac
echo "$W1" | grep -vq 'TALLY-MISS' || { echo 'GUARD board tally'; exit 1; }
LDW=$(agent-browser eval "(() => { const strip=document.querySelector('[data-testid=\"corpus-only-runs\"]'); if(!strip) return JSON.stringify({ld:false,skipped:'no-strip-honest-empty'}); const el=[...strip.querySelectorAll('[title]')].find(e=>/no-judge failures/.test(e.getAttribute('title')||'')); if(!el) return JSON.stringify({ld:false,note:'no-nj-title'}); const t=el.getAttribute('title'); return JSON.stringify({ld:true,count:(t.match(/these (\d+) no-judge/)||[])[1]||'',hasIntern:/intern-systemone/.test(t),hasFast:/fast-judge/.test(t),hasPaid:/paid rung/.test(t),lanes:(t.match(/deduped\):\s*([\s\S]*)$/)||[])[1]||''}); })()" || true)
echo "ld: $LDW"
case "$LDW" in *'no-strip-honest-empty'*) echo "ld: skipped (honest-empty profile, no strip)";; *'"ld":true'*) echo "$LDW" | grep -q 'hasIntern\":true' || { echo 'GUARD ld intern'; exit 1; }; echo "$LDW" | grep -q 'hasFast\":true' || { echo 'GUARD ld fast'; exit 1; };; *) echo 'GUARD ld'; exit 1;; esac
agent-browser open "http://localhost:3000/?r=804s#settings" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
SET=$(agent-browser eval "JSON.stringify({census: /free-reach|free reach/i.test(document.body.innerText), relay: /Model Relay|intel ladder/i.test(document.body.innerText)})" || true)
echo "settings: $SET"
echo "$SET" | grep -Eq 'census\\?":true' || { echo 'GUARD settings census'; exit 1; }
echo "$SET" | grep -Eq 'relay\\?":true' || { echo 'GUARD settings relay'; exit 1; }
# r804: THE COMPACT RECEIPT LEG — the r803 lesson (the sonner toast auto-
# dismisses in ~4-5s; the boot-arm witness caught it only inside a 1.5s
# window) hardened into a durable record: compactNexusStorage itself now
# writes nexus-last-compact and the storage meter card renders it. The
# manual arm is witnessed here via the NATIVE click (CDP trusted input);
# the boot arm shares the same code path, so a green here covers the
# receipt write for both arms.
agent-browser click "[aria-label=\"Compact refillable caches\"]" || true
sleep 1.5
RCPT=$(agent-browser eval "(() => { const el=document.querySelector('[data-testid=\"last-compact-receipt\"]'); const t=el?el.textContent:''; return JSON.stringify({receipt:!!el, freed:/freed [\d,]+ chars/.test(t), stamp:/Last compacted /.test(t)}); })()" || true)
echo "compact-receipt: $RCPT"
echo "$RCPT" | tr -d '\\' | grep -q '"receipt":true' || { echo 'GUARD compact receipt row'; exit 1; }
echo "$RCPT" | tr -d '\\' | grep -q '"freed":true' || { echo 'GUARD compact receipt freed'; exit 1; }
echo "$RCPT" | tr -d '\\' | grep -q '"stamp":true' || { echo 'GUARD compact receipt stamp'; exit 1; }
# r799: the frontier leg rides the deterministic deep-link entry — the r802
# addendum disclosed the synthetic .click() does NOT switch this Radix tab;
# #/radar/frontier writes the persisted tab in the view's own JSON envelope
# before the remount and lands with NO interaction at all.
agent-browser open "http://localhost:3000/?r=804d#/radar/frontier" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
DEEPLINK=$(agent-browser eval "(() => { const mt=document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); const sel=mt?mt.closest('[role=\"tablist\"]').querySelector('[aria-selected=\"true\"]'):null; return JSON.stringify({selected:sel?(sel.getAttribute('aria-label')||sel.textContent.trim()):'none',frontierTrigger:!!mt}); })()" || true)
echo "radar-deeplink: $DEEPLINK"
echo "$DEEPLINK" | tr -d '\\' | grep -q '"selected":"Radar tab: Frontier"' || { echo 'GUARD radar deeplink'; exit 1; }
agent-browser open "http://localhost:3000/?r=804r#radar" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
# r802: the witness is the agent-browser NATIVE click (CDP trusted input -
# Radix honors it; the synthetic eval .click() provably does not).
agent-browser click "[aria-label=\"Radar tab: Frontier\"]" || true
sleep 1
RAD=$(agent-browser eval "(() => { const mt=document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); const sel=mt?mt.closest('[role=\"tablist\"]').querySelector('[aria-selected=\"true\"]'):null; const el=document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); return JSON.stringify({selected:sel?(sel.getAttribute('aria-label')||sel.textContent.trim()):'none',frontierTrigger:!!el,frontierCopy:/frontier scout|seed ledger|free-reach/i.test(document.body.innerText)}); })()" || true)
echo "radar: $RAD"
echo "$RAD" | tr -d '\\' | grep -q '"selected":"Radar tab: Frontier"' || { echo 'GUARD radar'; exit 1; }
agent-browser open "http://localhost:3000/?r=804w#/workflows/board" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
PASTE=$(agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r804 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true)
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
echo "== r804 QA GREEN =="
} 2>&1 | tee scripts/qa_r804.txt
exit ${PIPESTATUS[0]}
echo "QA-COMPLETE $(date -u +%H:%M:%S)"
echo "qa_r804 $(date -u +%FT%TZ) board=$W1 set=$SET rcpt=$RCPT rad=$RAD paste=$PASTE cron=$CRON errs=$ERRS" > scripts/qa_r804.txt
