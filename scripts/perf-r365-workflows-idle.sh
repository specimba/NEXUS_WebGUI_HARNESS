#!/usr/bin/env bash
# r365: workflows-view idle perf budget — rerunnable guard, measured baseline.
#
# WHY: r365 was tasked with a measured perf pass on the workflows view. Result:
# the view is HEALTHY at idle — 43s window showed 1 DOM mutation (22 chars, one
# countdown label), 2 attribute changes, 0 long tasks, DOM stable at 971 nodes,
# DCL 465ms / load 1261ms (dev server). All timers are gated by design
# (automation-bridge 60s heartbeat, server-autopilot 15s poll only while
# visible, run-kanban 30s tick only while board open, run-panel 1s tick ONLY
# during step backoff) — so NO refactor was warranted and none was made.
#
# This script preserves the measurement so future rounds that touch the
# workflows view (or its timers) can rerun it and catch regressions against
# the measured baseline instead of vibes.
#
# Budgets are deliberately generous (10-50x the measured baseline): this
# catches ORDER-OF-MAGNITUDE waste (runaway re-render storms, accidental
# ungated 1s ticks), not noise.
#
# Usage: bash scripts/perf-r365-workflows-idle.sh  (requires the dev server
# on localhost:3000 and agent-browser on PATH).
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
WINDOW_S="${WINDOW_S:-35}"
MAX_MUTATIONS="${MAX_MUTATIONS:-50}"
MAX_ATTRS="${MAX_ATTRS:-30}"
MAX_LONGTASKS="${MAX_LONGTASKS:-3}"
MAX_LT_MS="${MAX_LT_MS:-200}"

echo "[perf-r365] opening $BASE_URL/#/workflows"
agent-browser open "$BASE_URL/#/workflows"
agent-browser wait 4000

echo "[perf-r365] arming observers"
agent-browser eval '(() => { window.__m = { mut: 0, chars: 0, longtasks: 0, ltMs: 0, attrs: 0 }; window.__mo = new MutationObserver((list) => { for (const m of list) { if (m.type === "characterData") { window.__m.chars += (m.target.textContent || "").length; } else if (m.type === "attributes") { window.__m.attrs++; } else { window.__m.mut += m.addedNodes.length + m.removedNodes.length; } } }); window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); try { window.__po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__m.longtasks++; window.__m.ltMs += Math.round(e.duration); } }); window.__po.observe({ entryTypes: ["longtask"] }); } catch (e) {} window.__m.nodes = document.querySelectorAll("*").length; window.__m.t0 = Date.now(); return JSON.stringify(window.__m); })()'

echo "[perf-r365] measuring ${WINDOW_S}s idle window"
sleep "$WINDOW_S"

RESULT=$(agent-browser eval '(() => { const m = { ...window.__m, elapsedMs: Date.now() - window.__m.t0 }; try { window.__mo.disconnect(); } catch (e) {} try { window.__po.disconnect(); } catch (e) {} return JSON.stringify(m); })()')
echo "[perf-r365] raw: $RESULT"

# agent-browser eval returns a JSON-quoted, backslash-escaped string
# (e.g. "{\"mut\":0,...}") — strip ALL backslashes, then it is plain JSON.
JSON=$(printf '%s' "$RESULT" | tr -d '\\')
MUT=$(printf '%s' "$JSON" | sed -n 's/.*"mut":\([0-9]*\).*/\1/p')
ATTRS=$(printf '%s' "$JSON" | sed -n 's/.*"attrs":\([0-9]*\).*/\1/p')
LT=$(printf '%s' "$JSON" | sed -n 's/.*"longtasks":\([0-9]*\).*/\1/p')
LTM=$(printf '%s' "$JSON" | sed -n 's/.*"ltMs":\([0-9]*\).*/\1/p')

FAIL=0
check() { # name value max
  if [ "$2" -le "$3" ]; then echo "[perf-r365] PASS $1=$2 (budget $3)"; else echo "[perf-r365] FAIL $1=$2 (budget $3)"; FAIL=1; fi
}
check mutations "$MUT" "$MAX_MUTATIONS"
check attr-changes "$ATTRS" "$MAX_ATTRS"
check longtasks "$LT" "$MAX_LONGTASKS"
check longtask-ms "$LTM" "$MAX_LT_MS"

if [ "$FAIL" -eq 0 ]; then
  echo "[perf-r365] workflows view idle perf: WITHIN BUDGET (baseline r365: 1 mut / 2 attrs / 0 LT per 43s)"
  exit 0
else
  echo "[perf-r365] workflows view idle perf: REGRESSION — inspect recent changes to workflows/* timers, poll setState shapes, or list virtualization"
  exit 1
fi
