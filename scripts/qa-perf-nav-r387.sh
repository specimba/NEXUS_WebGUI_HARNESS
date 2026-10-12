#!/usr/bin/env bash
# r387 QA — three witnesses in one pass:
# (1) REAL sidebar nav (nav-scoped includes() matcher — r386's exact-match
#     failed on the sr-only hint span inside every nav button, now understood);
# (2) the OWED r386 witness: ⚠ fail chips' tooltips read live;
# (3) the FIRST live read of the run-panel MOUNT measurement (r387 perf ring).
# The Run button only OPENS the panel (openRun) — no provider dial, no cost.
set -uo pipefail
AB="agent-browser --session ${SESSION:-r387}"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }

$AB open http://127.0.0.1:3000/ >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1 || true

# ── 1) nav via the real sidebar (nav-scoped, includes() — sr-only hint safe) ──
NAV=$($AB eval "(function(){const btns=Array.from(document.querySelectorAll('nav[aria-label=\"Primary\"] button'));const el=btns.find(function(e){return e.textContent.indexOf('Workflows')>=0});if(el){el.click();return 'clicked of '+btns.length}return 'not-found of '+btns.length})()" 2>/dev/null | tr -d '"' | tail -1)
echo "nav=$NAV"
case "$NAV" in
  clicked*) ok "workflows view opened via real sidebar nav (r386 nav debt resolved)";;
  *) bad "workflows nav ($NAV)";;
esac
sleep 1.5

# ── 2) r386 owed witness: ⚠ chip tooltips on the automation registry ──
TITLES=$($AB eval "Array.from(document.querySelectorAll('span[title*=\"consecutive failure\"]')).map(function(e){return e.getAttribute('title')}).join(' || ') || 'NONE'" 2>/dev/null | tr -d '"' | tail -1)
echo "chip titles: $TITLES"
if [ "$TITLES" = "NONE" ]; then
  bad "no ⚠ chips rendered (sandbox failStreak rows may have self-cleared)"
else
  echo "$TITLES" | grep -q "latest:" && ok "r386 tooltip carries the latest failure reason (LIVE)" || bad "tooltip missing 'latest:'"
fi

# ── 3) run-panel MOUNT measurement: open the panel, read the ring ──
RUNCLICK=$($AB eval "(function(){const btns=Array.from(document.querySelectorAll('button'));const el=btns.find(function(e){return e.textContent.trim()==='Run'});if(el){el.click();return 'clicked'}return 'no-run-btn'})()" 2>/dev/null | tr -d '"' | tail -1)
echo "run-btn=$RUNCLICK"
sleep 2
PANEL=$($AB eval "document.body.innerText.indexOf('Pipeline run')>=0 ? 'open' : 'closed'" 2>/dev/null | tr -d '"' | tail -1)
echo "panel=$PANEL"
[ "$PANEL" = "open" ] && ok "run panel opened via the real Run button" || bad "run panel did not open"

# Peak, not newest: while the panel is open, store ticks re-commit the subtree
# at ~0ms and bury the open-mount commit in the ring — the mount is the PEAK.
PERF=$($AB eval "(function(){try{const f=window.__praisonPerfNotes;const notes=f?f():[];const ns=notes.filter(function(x){return x.id==='WorkflowRunPanel'});if(!ns.length)return 'EMPTY('+notes.length+')';const m=ns.reduce(function(a,b){return b.ms>a.ms?b:a},ns[0]);return 'n='+ns.length+' peak='+m.ms.toFixed(1)+'ms phase='+m.phase}catch(e){return 'ERR:'+e.message}})()" 2>/dev/null | tr -d '"' | tail -1)
echo "perf=$PERF"
case "$PERF" in
  *peak=*) ok "run-panel MOUNT measured live: $PERF";;
  *) bad "no perf note read ($PERF)";;
esac

ERRS=$($AB errors 2>/dev/null | grep -c "Error" || true)
[ "${ERRS:-0}" -eq 0 ] && ok "console errors: 0" || bad "console errors: $ERRS"

$AB close >/dev/null 2>&1 || true
echo "─────────────────────"
echo "RESULT: $PASS passed, $FAIL failed"
exit $FAIL
