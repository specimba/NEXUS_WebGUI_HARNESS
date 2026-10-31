#!/usr/bin/env bash
# r819 witness: THE HISTORY SPEAKS - seed a witness workflow carrying THREE
# runs (done / error / stopped) into localStorage nexus-workflows, drive the
# REAL UI chain (board card click -> run panel -> Toggle run history), then
# assert each history row's accessible name carries the run status ("task A —
# done", "task B — failed" with the r818 visible-copy word, "task C — stopped";
# v2 taught: a seeded "running" run is REAPED to "stopped" on hydration (SPA
# then RESTORE the prior store (write-back-safe: restore -> navigate ->
# file-fix -> re-navigate -> verify store-clean).
set -u
cd /home/z/my-project
{
echo "== r819 history-row utterance witness =="
agent-browser open "http://localhost:3000/?r=819t#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { try { const raw=localStorage.getItem('nexus-workflows'); sessionStorage.setItem('r819-prior-wf', raw===null?'null':raw); const p=JSON.parse(raw||'{}'); const wfs=((p.state&&p.state.workflows)||[]).filter(w=>w.id!=='wf-r819-witness'); const now=Date.now(); const mk=(id,task,status,stepStatus,finishedAt)=>({id,workflowId:'wf-r819-witness',workflowName:'r819 Witness Pipeline',task,status,startedAt:now-3600000,finishedAt,source:'manual',steps:[{stepId:id+'-s1',agentId:'a1',agentName:'WitnessWorker',agentEmoji:'W',label:'witness step',output:'ok',toolCalls:[],status:stepStatus}]}); const runs=[mk('run-r819-a','r819 witness task A','done','done',now-3500000),mk('run-r819-b','r819 witness task B','error','error',now-3500000),mk('run-r819-c','r819 witness task C','stopped','stopped',null)]; const wf={id:'wf-r819-witness',name:'r819 Witness Pipeline',description:'witness only',steps:[{id:'d1',agentId:'a1',label:'witness step'}],runs,createdAt:now,updatedAt:now}; p.state=Object.assign({},p.state,{workflows:[wf,...wfs]}); localStorage.setItem('nexus-workflows', JSON.stringify(p)); return 'seeded:3runs'; } catch(e) { return 'seed-fail:'+e.message; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=819t2#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
CLICK1=$(agent-browser eval "(() => { try { const card=document.querySelector('[data-wf-card=\"wf-r819-witness\"]'); if(!card) return 'no-card'; card.click(); return 'clicked:card'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "click1: $CLICK1"
sleep 1
agent-browser click "[aria-label=\"Toggle run history\"]" >/dev/null 2>&1 || true
sleep 1
WIT=$(agent-browser eval "(() => { try { const rows=[...document.querySelectorAll('button[aria-label^=\"View run from \"]')].map(b=>b.getAttribute('aria-label')).filter(l=>l.includes('r819 witness task')); return JSON.stringify({rows:rows.length, labels:rows}); } catch(e){ return 'err:'+e.message; } })()" || true)
echo "witness: $WIT"
WITN=${WIT//\\/}
echo "$WITN" | grep -q '"rows":3' || { echo 'GUARD history rows (three witness rows did not render with labels)'; exit 1; }
echo "$WITN" | grep -q 'r819 witness task A — done' || { echo 'GUARD done-run utterance'; exit 1; }
echo "$WITN" | grep -q 'r819 witness task B — failed' || { echo 'GUARD error-run utterance (failed)'; exit 1; }
echo "$WITN" | grep -q 'r819 witness task C — stopped' || { echo 'GUARD stopped-run utterance'; exit 1; }
echo "rows: three history rows speak task + status (done / failed / stopped)"
REST=$(agent-browser eval "(() => { try { const s=sessionStorage.getItem('r819-prior-wf'); if(s===null||s==='null'){ localStorage.removeItem('nexus-workflows'); } else { localStorage.setItem('nexus-workflows', s); } sessionStorage.removeItem('r819-prior-wf'); return 'restored:prior'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
agent-browser open "http://localhost:3000/?r=819t3#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
FIX=$(agent-browser eval "(() => { try { const p=JSON.parse(localStorage.getItem('nexus-workflows')||'{}'); if(!p.state) return 'no-state'; const before=((p.state.workflows)||[]).length; p.state.workflows=((p.state.workflows)||[]).filter(w=>w.id!=='wf-r819-witness'); localStorage.setItem('nexus-workflows', JSON.stringify(p)); return 'fixed:'+before+'->'+p.state.workflows.length; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "file-fix: $FIX"
agent-browser open "http://localhost:3000/?r=819t4#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
CHECK=$(agent-browser eval "(() => { try { const p=JSON.parse(localStorage.getItem('nexus-workflows')||'{}'); const gone=!((p.state&&p.state.workflows)||[]).some(w=>w.id==='wf-r819-witness'); return gone?'store-clean:yes':'store-clean:NO'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "reload-check: $CHECK"
echo "$CHECK" | grep -q 'store-clean:yes' || { echo 'GUARD store still polluted after fix+reload'; exit 1; }
echo "== r819 WITNESS GREEN =="
} > /tmp/r819_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 16 /tmp/r819_witness.out
