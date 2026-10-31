#!/usr/bin/env bash
# r818 witness: THE STEPS SPEAK - seed a witness workflow carrying one finished
# run with four step states (done / review-gate done / error / pending) into
# localStorage nexus-workflows, drive the REAL UI chain (board Run button ->
# run panel -> Toggle run history -> View run), then assert each step card
# self-describes its position and state ("Step 1 of 4 - ..., done" etc.) and
# the done indicator names its completion ("Done in 3.2s" - pre-r818 it was a
# color + aria-hidden icon + a bare duration) - then RESTORE the prior store.
set -u
cd /home/z/my-project
{
echo "== r818 step-card utterance witness =="
agent-browser open "http://localhost:3000/?r=818t#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { try { const raw=localStorage.getItem('nexus-workflows'); sessionStorage.setItem('r818-prior-wf', raw===null?'null':raw); const p=JSON.parse(raw||'{}'); const wfs=((p.state&&p.state.workflows)||[]).filter(w=>w.id!=='wf-r818-witness'); const now=Date.now(); const run={id:'run-r818-witness',workflowId:'wf-r818-witness',workflowName:'r818 Witness Pipeline',task:'r818 witness run',status:'done',startedAt:now-3600000,finishedAt:now-3500000,source:'manual',steps:[{stepId:'s1',agentId:'a1',agentName:'WitnessWorker',agentEmoji:'W',label:'witness step one',output:'witness output one',toolCalls:[],status:'done',ms:3200},{stepId:'s2',agentId:'a2',agentName:'WitnessChecker',agentEmoji:'C',label:'witness review gate',output:'review ok',toolCalls:[],status:'done',kind:'review',verdict:'pass'},{stepId:'s3',agentId:'a1',agentName:'WitnessWorker',agentEmoji:'W',label:'witness step three',output:'',toolCalls:[],status:'error'},{stepId:'s4',agentId:'a1',agentName:'WitnessWorker',agentEmoji:'W',label:'witness step four',output:'',toolCalls:[],status:'pending'}]}; const wf={id:'wf-r818-witness',name:'r818 Witness Pipeline',description:'witness only',steps:[{id:'d1',agentId:'a1',label:'witness step one'},{id:'d2',agentId:'a2',label:'witness review gate',kind:'review'},{id:'d3',agentId:'a1',label:'witness step three'},{id:'d4',agentId:'a1',label:'witness step four'}],runs:[run],createdAt:now,updatedAt:now}; p.state=Object.assign({},p.state,{workflows:[wf,...wfs]}); localStorage.setItem('nexus-workflows', JSON.stringify(p)); return 'seeded:1run:4steps'; } catch(e) { return 'seed-fail:'+e.message; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=818t2#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
CLICK1=$(agent-browser eval "(() => { try { const card=document.querySelector('[data-wf-card=\"wf-r818-witness\"]'); if(!card) return 'no-card'; card.click(); return 'clicked:card'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "click1: $CLICK1"
sleep 1
agent-browser click "[aria-label=\"Toggle run history\"]" >/dev/null 2>&1 || true
sleep 1
CLICK2=$(agent-browser eval "(() => { try { const btn=[...document.querySelectorAll('button[aria-label^=\"View run from \"]')].find(b=>b.getAttribute('aria-label').includes('r818 witness run')); if(!btn) return 'no-view-button'; btn.click(); return 'clicked:view'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "click2: $CLICK2"
sleep 1
WIT=$(agent-browser eval "(() => { try { const groups=[...document.querySelectorAll('[role=\"group\"][aria-label^=\"Step \"]')]; const labels=groups.map(g=>g.getAttribute('aria-label')); const doneIdx=[...document.querySelectorAll('[aria-label=\"Done in 3.2s\"]')].length; return JSON.stringify({groups:labels.length, labels:labels, doneNamed:doneIdx}); } catch(e){ return 'err:'+e.message; } })()" || true)
echo "witness: $WIT"
WITN=${WIT//\\/}
echo "$WITN" | grep -q '"groups":4' || { echo 'GUARD step groups (four step cards did not render with utterances)'; exit 1; }
echo "$WITN" | grep -q 'Step 1 of 4 — WitnessWorker, done' || { echo 'GUARD step1 utterance'; exit 1; }
echo "$WITN" | grep -q 'Step 2 of 4 — WitnessChecker, review gate, done' || { echo 'GUARD step2 utterance (review gate named)'; exit 1; }
echo "$WITN" | grep -q 'Step 3 of 4 — WitnessWorker, failed' || { echo 'GUARD step3 utterance (failed state)'; exit 1; }
echo "$WITN" | grep -q 'Step 4 of 4 — WitnessWorker, queued' || { echo 'GUARD step4 utterance (queued state)'; exit 1; }
echo "$WITN" | grep -q '"doneNamed":1' || { echo 'GUARD done indicator names its completion'; exit 1; }
echo "rows: four step cards speak position + worker + kind + state; done indicator names completion"
REST=$(agent-browser eval "(() => { try { const s=sessionStorage.getItem('r818-prior-wf'); if(s===null||s==='null'){ localStorage.removeItem('nexus-workflows'); } else { localStorage.setItem('nexus-workflows', s); } sessionStorage.removeItem('r818-prior-wf'); return 'restored:prior'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
agent-browser open "http://localhost:3000/?r=818t3#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
FIX=$(agent-browser eval "(() => { try { const p=JSON.parse(localStorage.getItem('nexus-workflows')||'{}'); if(!p.state) return 'no-state'; const before=((p.state.workflows)||[]).length; p.state.workflows=((p.state.workflows)||[]).filter(w=>w.id!=='wf-r818-witness'); localStorage.setItem('nexus-workflows', JSON.stringify(p)); return 'fixed:'+before+'->'+p.state.workflows.length; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "file-fix: $FIX"
agent-browser open "http://localhost:3000/?r=818t4#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
CHECK=$(agent-browser eval "(() => { try { const p=JSON.parse(localStorage.getItem('nexus-workflows')||'{}'); const gone=!((p.state&&p.state.workflows)||[]).some(w=>w.id==='wf-r818-witness'); return gone?'store-clean:yes':'store-clean:NO'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "reload-check: $CHECK"
echo "$CHECK" | grep -q 'store-clean:yes' || { echo 'GUARD store still polluted after fix+reload'; exit 1; }
echo "== r818 WITNESS GREEN =="
} > /tmp/r818_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 16 /tmp/r818_witness.out
