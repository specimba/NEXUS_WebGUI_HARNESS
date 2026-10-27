#!/usr/bin/env bash
# r655 golden QA - relay intel ladder, radar frontier scroll, workflows surface; console discipline (clear -> reload -> count errors)
B=http://localhost:3000
say(){ echo "== $1"; }
errs(){ agent-browser console 2>/dev/null | grep -ciE "\berror\b" || true; }
say "LEG A: settings relay + vault card"
agent-browser open "$B/#/settings" >/dev/null 2>&1 || true; sleep 4
agent-browser console --clear >/dev/null 2>&1 || true
agent-browser reload >/dev/null 2>&1 || true; sleep 4
agent-browser snapshot -i 2>/dev/null | grep -oE "Benchmark intelligence|Intel [0-9.]+|[Ff]ree.reach[^\"|]{0,30}|Automation vault|[0-9]+ lanes stored|dials [A-Za-z ]+ first" | sort -u | head -12
say "console-errors(settings): $(errs)"
say "LEG B: radar frontier scroll"
agent-browser open "$B/#/radar" >/dev/null 2>&1 || true; sleep 4
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button,[role=tab]')].find(x=>/frontier/i.test(x.textContent||''));if(b){b.click();return 'frontier-clicked'}return 'frontier-tab-not-found'})()" 2>/dev/null || true
sleep 3
agent-browser eval "(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+80&&getComputedStyle(e).overflowY!=='visible');if(!els.length)return 'no-scrollers';const r=els.sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];const before=r.scrollTop;r.scrollTop=500;return JSON.stringify({scrollers:els.length,top:r.scrollHeight,moved:r.scrollTop>before})})()" 2>/dev/null || true
say "console-errors(radar): $(errs)"
say "LEG C: workflows surface (paste leg deferred: witnessed r653 green; run-panel frontend untouched since)"
agent-browser open "$B/#/workflows" >/dev/null 2>&1 || true; sleep 4
agent-browser snapshot -i 2>/dev/null | grep -coiE "run|workflow" || true
say "console-errors(workflows): $(errs)"
say "DONE"
