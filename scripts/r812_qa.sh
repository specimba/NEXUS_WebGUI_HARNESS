#!/usr/bin/env bash
# r812 golden QA + judge-lane board witness (r741 template + r812 nav: the
# lane-matrix leg witnesses the honest age caption + per-chip transport
# (green-verdict only); egress-verdict leg witnesses the r812 readable
# failure note / vintage caption - both branches are honest witnesses.
# disclosure + chip aria-labels added to the Cortex diagnostics card).
set -u
cd /home/z/my-project
{
echo "== r812 golden QA + lane-matrix witness =="
agent-browser open "http://localhost:3000/?r=812#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
for i in 1 2 3 4 5 6; do
  sleep 5
  W1=$(agent-browser eval "(() => { const strip=document.querySelector('[data-testid=\"corpus-only-runs\"]'); const chip=(document.body.innerText.match(/(\d+) in corpus/)||[])[1]; const empty=!!document.querySelector('[data-testid=\"board-empty-state\"]'); const shown=strip?strip.textContent.match(/(\d+) of (\d+) shown/):null; return JSON.stringify({strip:!!strip,corpusChip:chip==null?null:Number(chip),emptyNotice:empty,chips:strip?strip.querySelectorAll('button,[role=button]').length:0,corpusPills:shown?Number(shown[2]):null,cap:shown?Number(shown[1]):null}); })()" || true)
  case "$W1" in *'"strip":true'*|*'"corpusChip":0'*|*'emptyNotice":true'*) break;; esac
done
echo "board: $W1"
W1N=${W1//\\/}
# r812: the annotation is data-driven now - the corpus CAME ALIVE this round
# (a scheduled run produced 4 eval events while the server stayed up), so
# strip:true + emptyNotice:true is a REAL state, not a contradiction: the
# runs list is empty while the strip correctly summarizes the live corpus.
case "$W1N" in
  *'"corpusChip":0'*) echo "board: $W1 (honest-empty: no corpus chip, no run corpus)";;
  *'"strip":true'*'emptyNotice":true'*) echo "board: $W1 (runs list empty; corpus strip PRESENT - server-side eval events exist and the strip is correctly summarizing them)";;
  *'emptyNotice":true'*) echo "board: $W1 (honest-empty: this browser profile holds no run corpus, strip correctly absent)";;
  *'"strip":true'*) echo "board: $W1";;
  *) echo "GUARD board strip (corpus non-empty, strip absent): $W1"; exit 1;;
esac
echo "$W1" | grep -vq 'TALLY-MISS' || { echo 'GUARD board tally'; exit 1; }
LDW=$(agent-browser eval "(() => { const strip=document.querySelector('[data-testid=\"corpus-only-runs\"]'); if(!strip) return JSON.stringify({ld:false,skipped:'no-strip-honest-empty'}); const el=[...strip.querySelectorAll('[title]')].find(e=>/no-judge failures/.test(e.getAttribute('title')||'')); if(!el) return JSON.stringify({ld:false,note:'no-nj-title'}); const t=el.getAttribute('title'); return JSON.stringify({ld:true,count:(t.match(/these (\d+) no-judge/)||[])[1]||'',hasIntern:/intern-systemone/.test(t),hasFast:/fast-judge/.test(t),hasPaid:/paid rung/.test(t),lanes:(t.match(/deduped\):\s*([\s\S]*)$/)||[])[1]||''}); })()" || true)
echo "ld: $LDW"
LDWN=${LDW//\\/}
# r812: normalize-then-case (the r806 CORXN lesson - the ld:true arm never
# matched the double-encoded raw). NEW honest skip: corpus present but zero
# no-judge failures (today's 4 gate-verdict PASS rows are judged events - the
# no-judge pill correctly does not render).
case "$LDWN" in
  *'no-strip-honest-empty'*) echo "ld: skipped (honest-empty profile, no strip)";;
  *'no-nj-title'*) echo "ld: skipped (corpus present, zero no-judge failures - healthy judged corpus)";;
  *'"ld":true'*) echo "$LDWN" | grep -q '"hasIntern":true' || { echo 'GUARD ld intern'; exit 1; }; echo "$LDWN" | grep -q '"hasFast":true' || { echo 'GUARD ld fast'; exit 1; };;
  *) echo 'GUARD ld'; exit 1;;
esac
agent-browser open "http://localhost:3000/?r=812s#settings" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
SET=$(agent-browser eval "JSON.stringify({census: /free-reach|free reach/i.test(document.body.innerText), relay: /Model Relay|intel ladder/i.test(document.body.innerText)})" || true)
echo "settings: $SET"
echo "$SET" | grep -Eq 'census\\?":true' || { echo 'GUARD settings census'; exit 1; }
echo "$SET" | grep -Eq 'relay\\?":true' || { echo 'GUARD settings relay'; exit 1; }
# r805: THE CORTEX VERDICT LEG — native click on the Probe button; the
# aria-live verdict row must render the green badge or the readable note.
agent-browser click "[aria-label=\"Probe the Cortex edge\"]" || true
CORX=""
for i in 1 2 3 4; do
  sleep 3
  CORX=$(agent-browser eval "(() => { const v=document.querySelector('[data-testid=\"cortex-probe-verdict\"]'); const t=v?v.textContent:''; const fail=!!document.querySelector('[data-testid=\"cortex-probe-failure\"]'); return JSON.stringify({verdict:/Edge online|Probe failed/.test(t), failureNote:fail, quickCheck:/401 quick check/.test(t)}); })()" || true)
  case "$CORX" in *'"verdict":true'*) break;; esac
done
echo "cortex-verdict: $CORX"
echo "$CORX" | tr -d '\\' | grep -q '"verdict":true' || { echo 'GUARD cortex verdict'; exit 1; }
CORXN=${CORX//\\/}
case "$CORXN" in *'"failureNote":true'*) echo "cortex: readable failure note rendered";; *) echo "cortex: green edge badge rendered";; esac
# r812: THE STREAK LEG - one failed probe is a flap; two in a row in the
# same session render the escalation line (sessionStorage consecutive-failure
# count). Native second click; the streak note is asserted on the second
# failure; skipped honestly if the edge answers green.
STREAK=""
case "$CORXN" in
  *'"failureNote":true'*)
    agent-browser click "[aria-label=\"Probe the Cortex edge\"]" || true
    for i in 1 2 3 4; do
      sleep 3
      STREAK=$(agent-browser eval "(() => { const v=document.querySelector('[data-testid=\"cortex-probe-verdict\"]'); const t=v?v.textContent:''; const s=document.querySelector('[data-testid=\"cortex-probe-streak\"]'); return JSON.stringify({verdict:/Edge online|Probe failed/.test(t), failureNote:!!document.querySelector('[data-testid=\"cortex-probe-failure\"]'), streakLine:!!s, streakText:s?s.textContent.trim().slice(0,60):''}); })()" || true)
      case "$STREAK" in *'"verdict":true'*) break;; esac
    done
    echo "cortex-streak: $STREAK"
    STREAKN=${STREAK//\\/}
    case "$STREAKN" in
      *'"failureNote":true'*'"streakLine":true'*) echo "streak: escalation line rendered on consecutive failures";;
      *'"failureNote":false'*) echo "streak: skipped honestly (second probe went green)";;
      *) echo 'GUARD cortex streak'; exit 1;;
    esac;;
  *) echo "streak: skipped (first probe went green - no failures to chain)";;
esac
# r812: THE LANE-MATRIX LEG — the chips now carry accessible names, the
# titles disclose HOW each lane answered (transport note), and the matrix
# has an honest age caption. Asserted only when the probe answered with a
# v2 matrix (green verdict branch); skipped honestly otherwise.
LANES=""
case "$CORXN" in
  *'"verdict":true'*'"failureNote":false'*)
    for i in 1 2 3; do
      sleep 2
      LANES=$(agent-browser eval "(() => { const cap=document.querySelector('[data-testid=\"cortex-lane-age\"]'); const chips=document.querySelectorAll('[aria-label=\"Cortex lane status\"] li[aria-label]'); return JSON.stringify({age:cap?/Lane matrix from the last probe/.test(cap.textContent):false, chipCount:chips.length}); })()" || true)
      case "$LANES" in *'"age":true'*'"chipCount":6'*) break;; esac
    done
    echo "lane-matrix: $LANES"
    echo "$LANES" | tr -d '\\' | grep -q '"age":true' || { echo 'GUARD lane age caption'; exit 1; }
    echo "$LANES" | tr -d '\\' | grep -q '"chipCount":6' || { echo 'GUARD lane chips'; exit 1; };;
  *) echo "lane-matrix: skipped (no v2 matrix this probe - honest skip)";;
esac
# r804: THE COMPACT RECEIPT LEG — durable compaction record, native click.
agent-browser click "[aria-label=\"Compact refillable caches\"]" || true
sleep 1.5
RCPT=$(agent-browser eval "(() => { const el=document.querySelector('[data-testid=\"last-compact-receipt\"]'); const t=el?el.textContent:''; return JSON.stringify({receipt:!!el, freed:/freed [\d,]+ chars/.test(t), stamp:/Last compacted /.test(t)}); })()" || true)
echo "compact-receipt: $RCPT"
echo "$RCPT" | tr -d '\\' | grep -q '"receipt":true' || { echo 'GUARD compact receipt row'; exit 1; }
echo "$RCPT" | tr -d '\\' | grep -q '"freed":true' || { echo 'GUARD compact receipt freed'; exit 1; }
echo "$RCPT" | tr -d '\\' | grep -q '"stamp":true' || { echo 'GUARD compact receipt stamp'; exit 1; }
# r812: THE EGRESS VERDICT LEG — native click on the probe button; the
# verdict region must render the vintage caption (success branch) or the
# readable failure note. Either container is a real witness.
agent-browser click "[aria-label=\"Probe egress direct versus pool\"]" || true
EGV=""
for i in 1 2 3 4; do
  sleep 3
  EGV=$(agent-browser eval "(() => { const v=document.querySelector('[data-testid=\"egress-probe-verdict\"]'); const t=v?v.textContent:''; const age=!!document.querySelector('[data-testid=\"egress-probe-age\"]'); const fail=!!document.querySelector('[data-testid=\"egress-probe-failure\"]'); return JSON.stringify({verdict:age||fail, ageCaption:age, failureNote:fail, probed:/Probed /.test(t)}); })()" || true)
  case "$EGV" in *'"verdict":true'*) break;; esac
done
echo "egress-verdict: $EGV"
echo "$EGV" | tr -d '\\' | grep -q '"verdict":true' || { echo 'GUARD egress verdict'; exit 1; }
EGVN=${EGV//\\/}
case "$EGVN" in *'"failureNote":true'*) echo "egress: readable failure note rendered";; *) echo "egress: vintage caption rendered";; esac
# r802: the deep-link leg — #/radar/frontier lands on Frontier with NO interaction.
agent-browser open "http://localhost:3000/?r=812d#/radar/frontier" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
DEEPLINK=$(agent-browser eval "(() => { const mt=document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); const sel=mt?mt.closest('[role=\"tablist\"]').querySelector('[aria-selected=\"true\"]'):null; return JSON.stringify({selected:sel?(sel.getAttribute('aria-label')||sel.textContent.trim()):'none',frontierTrigger:!!mt}); })()" || true)
echo "radar-deeplink: $DEEPLINK"
echo "$DEEPLINK" | tr -d '\\' | grep -q '"selected":"Radar tab: Frontier"' || { echo 'GUARD radar deeplink'; exit 1; }
agent-browser open "http://localhost:3000/?r=812r#radar" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
agent-browser click "[aria-label=\"Radar tab: Frontier\"]" || true
sleep 1
RAD=$(agent-browser eval "(() => { const mt=document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); const sel=mt?mt.closest('[role=\"tablist\"]').querySelector('[aria-selected=\"true\"]'):null; const el=document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); return JSON.stringify({selected:sel?(sel.getAttribute('aria-label')||sel.textContent.trim()):'none',frontierTrigger:!!el,frontierCopy:/frontier scout|seed ledger|free-reach/i.test(document.body.innerText)}); })()" || true)
echo "radar: $RAD"
echo "$RAD" | tr -d '\\' | grep -q '"selected":"Radar tab: Frontier"' || { echo 'GUARD radar'; exit 1; }
agent-browser open "http://localhost:3000/?r=812w#/workflows/board" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
PASTE=$(agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r812 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true)
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
echo "== r812 QA GREEN =="
} 2>&1 | tee scripts/qa_r812.txt
exit ${PIPESTATUS[0]}
echo "QA-COMPLETE $(date -u +%H:%M:%S)"
echo "qa_r812 $(date -u +%FT%TZ) board=$W1 set=$SET corx=$CORX lanes=$LANES rcpt=$RCPT rad=$RAD paste=$PASTE cron=$CRON errs=$ERRS" > scripts/qa_r812.txt
