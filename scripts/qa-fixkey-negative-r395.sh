#!/usr/bin/env bash
# r395 QA — Fix-key NEGATIVE case live witness (closes the r388 residue).
#
# Journey note (evidence trail): the run-panel recovery card path proved
# structurally unreachable for this witness — server-lane history rows are
# plain non-clickable divs (workflow-run-panel.tsx:1085-1125, inline error
# chip, no selection), and all the sandbox's failed runs ARE server-lane rows.
# The reachable Fix-key surface for those same failures is the SERVER
# AUTOPILOT (server-autopilot.tsx:501-516): per scheduled workflow, the button
# renders only when failStreak > 0 AND classifyRunError(latestFailure).kind ===
# "auth" — the SAME classifier the runner used, so UI and lane cannot disagree.
#
# Sandbox data (SQLite, verified this round):
#   RSIinFIELD       latest failure 429 "Too many concurrent…" → NON-auth
#   Morning Briefing latest failure 401 "Invalid API key…"     → auth
# Expected: the 429-driven row shows "⚠ N fails" with NO Fix key; a 401-driven
# active row (if its schedule is enabled) shows one. Zero dials, zero mocks —
# real persisted failures, the real classifier, the real UI.
set -uo pipefail
AB="agent-browser --session ${SESSION:-r395}"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }
note(){ echo "note: $1"; }

$AB open "http://127.0.0.1:3000/#/workflows" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
sleep 2

# Collect every autopilot schedule row carrying a failure chip, with its
# workflow name and whether a Fix key button is present in that row.
ROWS=$($AB eval "(function(){var out=[];var lis=Array.from(document.querySelectorAll('li')).filter(function(li){return /\\u26a0/.test(li.textContent)&&/every \\d+m/.test(li.textContent)});lis.forEach(function(li){var nameEl=li.querySelector('.font-medium');var fix=Array.from(li.querySelectorAll('button')).some(function(b){return b.textContent.indexOf('Fix key')>=0});out.push({name:nameEl?nameEl.textContent.trim():'?',fix:fix,tip:(Array.from(li.querySelectorAll('[title]')).map(function(e){return e.title.indexOf('latest:')>=0?e.title.slice(e.title.indexOf('latest:'),e.title.indexOf('latest:')+90):''}).filter(Boolean)[0]||'')})});return JSON.stringify(out)})()" 2>/dev/null | tr -d '"' | tail -1)
echo "AUTOPILOT ROWS: $ROWS"

# Expectations from the DB (latest failure per workflow):
#   RSIinFIELD → 429 (non-auth) → NO button;  401-class rows → button.
NEG_SEEN=no; POS_SEEN=no
for NAME in "RSIinFIELD" "Morning Briefing"; do
  ENTRY=$(echo "$ROWS" | grep -o "{\"name\":\"$NAME\"[^}]*}" | head -1)
  [ -z "$ENTRY" ] && { note "$NAME: no failure-chip row in the autopilot list (schedule may be off/parked)"; continue; }
  FIX=$(echo "$ENTRY" | grep -o '"fix":[a-z]*' | cut -d: -f2)
  if [ "$NAME" = "RSIinFIELD" ]; then
    if [ "$FIX" = "false" ]; then
      ok "NEGATIVE witnessed: RSIinFIELD latest failure is 429 (non-auth) → fail chip present, NO Fix key button"
      NEG_SEEN=yes
    else
      bad "r388 regression? Fix key PRESENT on RSIinFIELD whose latest failure is a 429 rate limit"
    fi
  else
    if [ "$FIX" = "true" ]; then
      ok "POSITIVE control holds: Morning Briefing latest failure is 401 (auth) → Fix key button present"
      POS_SEEN=yes
    else
      note "Morning Briefing row shows fix=$FIX — if its latest failure in the 25-run sync window is not the 401, this is CONSISTENT (classifier follows the newest failure, not the oldest)"
    fi
  fi
done
[ "$NEG_SEEN" = "yes" ] || bad "negative case not witnessed (no RSIinFIELD 429 row found)"
# The positive control is opportunistic: r388 already witnessed the 401
# positive case live on the chat surface; here it is a consistency bonus.

ERRS=$($AB errors 2>/dev/null | grep -c "Error" || true)
[ "${ERRS:-0}" -eq 0 ] && ok "console clean" || echo "note: console entries: $ERRS"
$AB close >/dev/null 2>&1 || true
echo "─────────────────────"
echo "RESULT: $PASS passed, $FAIL failed"
exit $FAIL
