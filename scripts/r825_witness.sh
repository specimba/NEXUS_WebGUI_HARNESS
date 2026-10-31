#!/usr/bin/env bash
# r825 witness: THE BOARD SPEAKS ITS LISTS - seed WitnessWorker ('a-wit') into
# localStorage nexus-agents and one workflow ('wf-r825-witness', one DONE run
# with novelty:72, finishedAt now-30m) into nexus-workflows (both priors
# saved; the vault is never touched), then deep-link #/workflows/board: the
# Evolution ledger is now a labeled list whose row utters the whole story
# ("r825 witness pipeline - 1 done run, last ..., novelty trail oldest to
# newest: 72%") and the card grid is a labeled list of listitems whose card
# carries the seeded name - then RESTORE both priors (write-back-safe:
# restore -> navigate -> file-fix -> re-navigate -> verify store-clean).
set -u
cd /home/z/my-project
{
echo "== r825 board-lists witness =="
agent-browser open "http://localhost:3000/?r=825t#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
# self-healing preamble (r824 doctrine): a mid-dance GUARD from any earlier
# run would leave the SEED in the stores while the TRUE priors sit in
# sessionStorage - restore them FIRST so this run's prior-save below
# snapshots the TRUE state, never the seeded one.
RECOVER=$(agent-browser eval "(() => { try { const pa=sessionStorage.getItem('r825-prior-agents'); const pw=sessionStorage.getItem('r825-prior-workflows'); if(pa===null&&pw===null) return 'no-leftover-priors-clean'; if(pa===null||pa==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', pa); } if(pw===null||pw==='null'){ localStorage.removeItem('nexus-workflows'); } else { localStorage.setItem('nexus-workflows', pw); } sessionStorage.removeItem('r825-prior-agents'); sessionStorage.removeItem('r825-prior-workflows'); return 'recovered:leftover-priors-restored'; } catch(e){ return 'recover-fail:'+e.message; } })()" || true)
echo "recover: $RECOVER"
SEED=$(agent-browser eval "(() => { try { const now=Date.now(); const rawA=localStorage.getItem('nexus-agents'); sessionStorage.setItem('r825-prior-agents', rawA===null?'null':rawA); const pa=JSON.parse(rawA||'{}'); const priorAgents=((pa.state&&pa.state.agents)||[]).filter(a=>a.id!=='a-wit'); pa.state=Object.assign({},pa.state,{agents:[{id:'a-wit',name:'WitnessWorker',emoji:'W',color:'violet',role:'worker',model:'',systemPrompt:'',tools:[],createdAt:now,updatedAt:now},...priorAgents]}); localStorage.setItem('nexus-agents', JSON.stringify(pa)); const rawW=localStorage.getItem('nexus-workflows'); sessionStorage.setItem('r825-prior-workflows', rawW===null?'null':rawW); const pw=JSON.parse(rawW||'{}'); const priorWfs=((pw.state&&pw.state.workflows)||[]).filter(w=>w.id!=='wf-r825-witness'); const wf={id:'wf-r825-witness',name:'r825 witness pipeline',description:'',steps:[{id:'s1',agentId:'a-wit',label:'Witness step'}],runs:[{id:'run-r825-w1',workflowId:'wf-r825-witness',workflowName:'r825 witness pipeline',task:'witness the ledger row',status:'done',startedAt:now-3600000,finishedAt:now-1800000,steps:[],novelty:72}],createdAt:now,updatedAt:now}; pw.state=Object.assign({},pw.state,{workflows:[wf,...priorWfs]}); localStorage.setItem('nexus-workflows', JSON.stringify(pw)); return 'seeded:1agent:1wf:1done-run:novelty-72'; } catch(e) { return 'seed-fail:'+e.message; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=825t2#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
WIT=""
for i in 1 2 3 4; do
  sleep 2
  WIT=$(agent-browser eval "(() => { try { const ledger=document.querySelector('[role=\"list\"][aria-label^=\"Evolution ledger\"]'); const rows=[...((ledger&&ledger.querySelectorAll('[role=\"listitem\"]'))||[])]; const labels=rows.map(r=>r.getAttribute('aria-label')).filter(Boolean); return JSON.stringify({ledger:!!ledger, ledgerLabel:ledger?ledger.getAttribute('aria-label'):null, row:labels.some(l=>l.startsWith('r825 witness pipeline — 1 done run')&&l.includes('novelty trail oldest to newest: 72%')), rowLabels:labels}); } catch(e){ return 'err:'+e.message; } })()" || true)
  case "$WIT" in *'"row":true'*) break;; esac
done
echo "witness-ledger: $WIT"
WIT=${WIT//\\/}
echo "$WIT" | grep -q '"ledger":true' || { echo 'GUARD ledger list missing'; exit 1; }
echo "$WIT" | grep -q '"row":true' || { echo 'GUARD ledger row utterance missing'; exit 1; }
# phase 2 (v2, after v1's honest GUARD): the card grid renders in the
# PIPELINES view - the board defaults to the runs board, so v1 found the
# ledger but no grid. Click the Pipelines view toggle (role=radio button
# whose textContent names it) and assert the labeled grid there.
TOG=$(agent-browser eval "(() => { try { const t=[...document.querySelectorAll('button[role=\"radio\"]')].find(b=>(b.textContent||'').includes('Pipelines')); if(!t) return 'toggle:missing'; t.click(); return 'toggle:clicked'; } catch(e){ return 'toggle-err:'+e.message; } })()" || true)
echo "toggle: $TOG"
CARDS=""
for i in 1 2 3 4; do
  sleep 2
  CARDS=$(agent-browser eval "(() => { try { const cards=document.querySelector('[role=\"list\"][aria-label^=\"Workflow pipelines\"]'); const items=cards?[...cards.querySelectorAll('[role=\"listitem\"]')]:[]; return JSON.stringify({cards:!!cards, cardsLabel:cards?cards.getAttribute('aria-label'):null, cardHit:items.some(c=>(c.textContent||'').includes('r825 witness pipeline'))}); } catch(e){ return 'err:'+e.message; } })()" || true)
  case "$CARDS" in *'"cardHit":true'*) break;; esac
done
echo "witness-cards: $CARDS"
CARDS=${CARDS//\\/}
echo "$CARDS" | grep -q '"cards":true' || { echo 'GUARD card-grid list missing'; exit 1; }
echo "$CARDS" | grep -q '"cardHit":true' || { echo 'GUARD card listitem missing'; exit 1; }
echo "rows: the ledger row speaks count+recency+trail; the grid names its pipelines"
REST=$(agent-browser eval "(() => { try { const a=sessionStorage.getItem('r825-prior-agents'); if(a===null||a==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', a); } const w=sessionStorage.getItem('r825-prior-workflows'); if(w===null||w==='null'){ localStorage.removeItem('nexus-workflows'); } else { localStorage.setItem('nexus-workflows', w); } sessionStorage.removeItem('r825-prior-agents'); sessionStorage.removeItem('r825-prior-workflows'); return 'restored:prior-both'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
agent-browser open "http://localhost:3000/?r=825t3#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
FIX=$(agent-browser eval "(() => { try { const a=sessionStorage.getItem('r825-prior-agents'); if(a===null||a==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', a); } const w=sessionStorage.getItem('r825-prior-workflows'); if(w===null||w==='null'){ localStorage.removeItem('nexus-workflows'); } else { localStorage.setItem('nexus-workflows', w); } return 'fixed:prior-rewritten-both'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "file-fix: $FIX"
agent-browser open "http://localhost:3000/?r=825t4#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
CHECK=$(agent-browser eval "(() => { try { const a=localStorage.getItem('nexus-agents')||''; const w=localStorage.getItem('nexus-workflows')||''; const clean=!a.includes('a-wit')&&!w.includes('wf-r825-witness'); return clean?'store-clean:yes':'store-clean:NO'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "reload-check: $CHECK"
echo "$CHECK" | grep -q 'store-clean:yes' || { echo 'GUARD stores still polluted after fix+reload'; exit 1; }
echo "== r825 WITNESS GREEN =="
} > /tmp/r825_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 18 /tmp/r825_witness.out
