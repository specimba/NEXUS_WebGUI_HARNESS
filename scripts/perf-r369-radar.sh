#!/usr/bin/env bash
# r369: Radar view perf budget — rerunnable guard, measured baseline.
#
# WHY: the Radar view is the last unmeasured heavy surface (watched-lanes list
# renders up to 120 rows, the model ticker is shell-mounted on every view, and
# both poll on 15-min cadences). r369's handoff required MEASUREMENT before any
# perf work. This script measures two things on the live app:
#   1. IDLE window on #/radar — mutations / attribute changes / long tasks
#      (expect near-zero: the 15-min polls fire far outside the window).
#   2. FILTER-SWITCH interaction — clicking the "Free" then "All" filter pills
#      re-renders the 120-row list; long tasks here catch runaway render cost.
# It also records the DOM node count for cross-view comparison (r365 baseline:
# workflows idle = 971 nodes).
#
# Budgets are deliberately generous (order-of-magnitude waste catchers, not
# noise gates) — same doctrine as scripts/perf-r365-workflows-idle.sh.
#
# Usage: bash scripts/perf-r369-radar.sh  (requires the dev server on
# localhost:3000 and agent-browser on PATH).
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
WINDOW_S="${WINDOW_S:-20}"
MAX_IDLE_MUTATIONS="${MAX_IDLE_MUTATIONS:-30}"
MAX_IDLE_ATTRS="${MAX_IDLE_ATTRS:-20}"
MAX_IDLE_LONGTASKS="${MAX_IDLE_LONGTASKS:-3}"
MAX_IDLE_LT_MS="${MAX_IDLE_LT_MS:-200}"
MAX_CLICK_LONGTASKS="${MAX_CLICK_LONGTASKS:-6}"
MAX_CLICK_LT_MS="${MAX_CLICK_LT_MS:-400}"

FAIL=0
check() { # name value max
  if [ "$2" -le "$3" ]; then echo "[perf-r369] PASS $1=$2 (budget $3)"; else echo "[perf-r369] FAIL $1=$2 (budget $3)"; FAIL=1; fi
}

echo "[perf-r369] opening $BASE_URL/#/radar"
agent-browser open "$BASE_URL/#/radar"
agent-browser wait 5000

# ── Mount snapshot: DOM size + navigation timing (informational)
MOUNT=$(agent-browser eval 'JSON.stringify((() => ({nodes: document.querySelectorAll("*").length, dcl: Math.round(performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd ?? -1), load: Math.round(performance.getEntriesByType("navigation")[0]?.loadEventEnd ?? -1)}))())' | tr -d '\\')
echo "[perf-r369] mount: $MOUNT"

# ── Arm observers (same pattern as r365)
agent-browser eval '(() => { window.__m = { mut: 0, chars: 0, longtasks: 0, ltMs: 0, attrs: 0 }; window.__mo = new MutationObserver((list) => { for (const m of list) { if (m.type === "characterData") { window.__m.chars += (m.target.textContent || "").length; } else if (m.type === "attributes") { window.__m.attrs++; } else { window.__m.mut += m.addedNodes.length + m.removedNodes.length; } } }); window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); try { window.__po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__m.longtasks++; window.__m.ltMs += Math.round(e.duration); } }); window.__po.observe({ entryTypes: ["longtask"] }); } catch (e) {} window.__m.t0 = Date.now(); return "armed"; })()' > /dev/null

echo "[perf-r369] measuring ${WINDOW_S}s idle window on #/radar"
sleep "$WINDOW_S"

IDLE=$(agent-browser eval '(() => { const m = { ...window.__m, elapsedMs: Date.now() - window.__m.t0 }; try { window.__mo.disconnect(); } catch (e) {} try { window.__po.disconnect(); } catch (e) {} return JSON.stringify(m); })()' | tr -d '\\')
echo "[perf-r369] idle raw: $IDLE"
IMUT=$(printf '%s' "$IDLE" | sed -n 's/.*"mut":\([0-9]*\).*/\1/p')
IATTR=$(printf '%s' "$IDLE" | sed -n 's/.*"attrs":\([0-9]*\).*/\1/p')
ILT=$(printf '%s' "$IDLE" | sed -n 's/.*"longtasks":\([0-9]*\).*/\1/p')
ILTM=$(printf '%s' "$IDLE" | sed -n 's/.*"ltMs":\([0-9]*\).*/\1/p')
check idle-mutations "$IMUT" "$MAX_IDLE_MUTATIONS"
check idle-attr-changes "$IATTR" "$MAX_IDLE_ATTRS"
check idle-longtasks "$ILT" "$MAX_IDLE_LONGTASKS"
check idle-longtask-ms "$ILTM" "$MAX_IDLE_LT_MS"

# ── Filter-switch interaction: two clicks, each re-rendering the lanes list
echo "[perf-r369] measuring filter-switch re-renders (Free → All)"
agent-browser eval '(() => { window.__c = { longtasks: 0, ltMs: 0 }; try { window.__cpo = new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__c.longtasks++; window.__c.ltMs += Math.round(e.duration); } }); window.__cpo.observe({ entryTypes: ["longtask"] }); } catch (e) {} return "armed"; })()' > /dev/null
agent-browser eval '(() => { const b = [...document.querySelectorAll("button")].find(x => /^Free ·/.test(x.textContent.trim())); if (b) b.click(); return b ? "clicked Free" : "Free pill NOT FOUND"; })()' > /dev/null
agent-browser wait 1500
agent-browser eval '(() => { const b = [...document.querySelectorAll("button")].find(x => /^All ·/.test(x.textContent.trim())); if (b) b.click(); return b ? "clicked All" : "All pill NOT FOUND"; })()' > /dev/null
agent-browser wait 1500
CLICK=$(agent-browser eval '(() => { const c = { ...window.__c }; try { window.__cpo.disconnect(); } catch (e) {} return JSON.stringify(c); })()' | tr -d '\\')
echo "[perf-r369] click raw: $CLICK"
CLT=$(printf '%s' "$CLICK" | sed -n 's/.*"longtasks":\([0-9]*\).*/\1/p')
CLTM=$(printf '%s' "$CLICK" | sed -n 's/.*"ltMs":\([0-9]*\).*/\1/p')
check filter-switch-longtasks "$CLT" "$MAX_CLICK_LONGTASKS"
check filter-switch-longtask-ms "$CLTM" "$MAX_CLICK_LT_MS"

if [ "$FAIL" -eq 0 ]; then
  echo "[perf-r369] radar view perf: WITHIN BUDGET (r369 baseline recorded in worklog)"
  exit 0
else
  echo "[perf-r369] radar view perf: REGRESSION — inspect radar list rendering, ticker mounts, or poll setState shapes"
  exit 1
fi
