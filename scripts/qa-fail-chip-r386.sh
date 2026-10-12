#!/usr/bin/env bash
# r386 QA — the ⚠ fail chip now carries the latest failure's "why" in its tooltip.
# UI-level witness: open Workflows, find the ⚠ chip(s) in the Server autopilot
# registry list, read their title attributes.
set -uo pipefail
AB="agent-browser --session ${SESSION:-r386}"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }

$AB open http://127.0.0.1:3000/ >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1 || true

# Navigate to the workflows view — ambiguous text matches fail; try roles,
# then a nav-scoped programmatic click (navigation only, no state surgery)
NAV=$($AB eval "(function(){const els=Array.from(document.querySelectorAll('button, a'));const el=els.find(function(e){return e.textContent.trim()==='Workflows'});if(el){el.click();return 'clicked'}return 'not-found'})()" 2>/dev/null | tr -d '"' | tail -1)
echo "nav=$NAV"
[ "$NAV" = "clicked" ] && ok "workflows view opened" || bad "workflows nav"
sleep 1.5

# The autopilot panel may sit further down — scroll it into view
$AB scrollintoview "#automation-stale-strip" >/dev/null 2>&1 || $AB scroll down 800 >/dev/null 2>&1 || true
sleep 0.5

TITLES=$($AB eval "Array.from(document.querySelectorAll('span[title*=\"consecutive failure\"]')).map(function(e){return e.getAttribute('title')}).join(' || ') || 'NONE'" 2>/dev/null | tr -d '"' | tail -1)
echo "chip titles: $TITLES"
if [ "$TITLES" = "NONE" ]; then
  bad "no ⚠ chips rendered (expected failStreak>0 rows from the sandbox)"
else
  echo "$TITLES" | grep -q "latest:" && ok "chip tooltip carries the latest failure reason" || bad "tooltip missing 'latest:'"
  echo "$TITLES" | grep -q "consecutive failure" && ok "tooltip uses the 'consecutive failure' convention" || bad "tooltip wording"
fi

CHIPCNT=$($AB eval "document.querySelectorAll('span[title*=\"consecutive failure\"]').length" 2>/dev/null | tail -1)
echo "chip count: $CHIPCNT"

ERRS=$($AB errors 2>/dev/null | grep -c "Error" || true)
[ "${ERRS:-0}" -eq 0 ] && ok "console errors: 0" || bad "console errors: $ERRS"

$AB close >/dev/null 2>&1 || true
echo "─────────────────────"
echo "RESULT: $PASS passed, $FAIL failed"
exit $FAIL
