#!/usr/bin/env bash
# r821 witness: THE USAGE BOARD SPEAKS - seed two agents (WitnessWorker,
# SecondAgent) into localStorage nexus-agents and one witness conversation
# (three assistant messages: 2x a-wit, one carrying a web_search tool call,
# 1x a-two) into nexus-conversations (both priors saved; the vault is never
# touched), reload Settings, then assert the usage dashboard's two lists SPEAK:
# the Tool mix list renders "Web Search — 1 run" and the Busiest agents list
# renders "WitnessWorker — 2 replies" / "SecondAgent — 1 reply" (pre-r821 the
# tool rows' names were HAND-ARIA-HIDDEN - a screen reader heard bare digits)
# - then RESTORE both priors (write-back-safe: restore -> navigate ->
# file-fix -> re-navigate -> verify store-clean).
set -u
cd /home/z/my-project
{
echo "== r821 usage-dashboard utterance witness =="
agent-browser open "http://localhost:3000/?r=821t#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { try { const now=Date.now(); const rawA=localStorage.getItem('nexus-agents'); sessionStorage.setItem('r821-prior-agents', rawA===null?'null':rawA); const pa=JSON.parse(rawA||'{}'); const priorAgents=((pa.state&&pa.state.agents)||[]).filter(a=>a.id!=='a-wit'&&a.id!=='a-two'); const mkA=(id,name,emoji,color)=>({id,name,emoji,color,role:'worker',model:'',systemPrompt:'',tools:[],createdAt:now,updatedAt:now}); pa.state=Object.assign({},pa.state,{agents:[mkA('a-wit','WitnessWorker','W','violet'),mkA('a-two','SecondAgent','S','emerald'),...priorAgents]}); localStorage.setItem('nexus-agents', JSON.stringify(pa)); const rawC=localStorage.getItem('nexus-conversations'); sessionStorage.setItem('r821-prior-chats', rawC===null?'null':rawC); const pc=JSON.parse(rawC||'{}'); const priorConvs=((pc.state&&pc.state.conversations)||[]).filter(c=>c.id!=='conv-r821-witness'); const msg=(id,agentId,toolCalls)=>({id,role:'assistant',agentId,content:'witness',createdAt:now,toolCalls:toolCalls||[]}); const conv={id:'conv-r821-witness',title:'r821 witness',messages:[msg('m1','a-wit',[{id:'t1',name:'web_search',args:'{}',ok:true,ms:120}]),msg('m2','a-wit'),msg('m3','a-two')],createdAt:now,updatedAt:now}; pc.state=Object.assign({},pc.state,{conversations:[conv,...priorConvs]}); localStorage.setItem('nexus-conversations', JSON.stringify(pc)); return 'seeded:2agents:1conv:3msgs'; } catch(e) { return 'seed-fail:'+e.message; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=821t2#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
WIT=$(agent-browser eval "(() => { try { const tl=document.querySelector('[aria-label=\"Tool mix — runs per tool\"]'); const al=document.querySelector('[aria-label=\"Busiest agents — replies per agent\"]'); if(!tl||!al) return JSON.stringify({toolList:!!tl,agentList:!!al}); const tLabels=[...tl.querySelectorAll('[role=\"listitem\"]')].map(e=>e.getAttribute('aria-label')); const aLabels=[...al.querySelectorAll('[role=\"listitem\"]')].map(e=>e.getAttribute('aria-label')); return JSON.stringify({toolList:true,agentList:true,webSearch:tLabels.includes('Web Search — 1 run'),worker:aLabels.includes('WitnessWorker — 2 replies'),second:aLabels.includes('SecondAgent — 1 reply'),tCount:tLabels.length,aCount:aLabels.length}); } catch(e){ return 'err:'+e.message; } })()" || true)
echo "witness: $WIT"
WITN=${WIT//\\/}
echo "$WITN" | grep -q '"toolList":true' || { echo 'GUARD tool mix list did not render'; exit 1; }
echo "$WITN" | grep -q '"agentList":true' || { echo 'GUARD busiest agents list did not render'; exit 1; }
echo "$WITN" | grep -q '"webSearch":true' || { echo 'GUARD Web Search — 1 run utterance'; exit 1; }
echo "$WITN" | grep -q '"worker":true' || { echo 'GUARD WitnessWorker — 2 replies utterance'; exit 1; }
echo "$WITN" | grep -q '"second":true' || { echo 'GUARD SecondAgent — 1 reply utterance'; exit 1; }
echo "rows: tool mix and busiest agents lists speak name + count + unit per row"
REST=$(agent-browser eval "(() => { try { const a=sessionStorage.getItem('r821-prior-agents'); if(a===null||a==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', a); } const c=sessionStorage.getItem('r821-prior-chats'); if(c===null||c==='null'){ localStorage.removeItem('nexus-conversations'); } else { localStorage.setItem('nexus-conversations', c); } sessionStorage.removeItem('r821-prior-agents'); sessionStorage.removeItem('r821-prior-chats'); return 'restored:prior-both'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
agent-browser open "http://localhost:3000/?r=821t3#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
FIX=$(agent-browser eval "(() => { try { const a=sessionStorage.getItem('r821-prior-agents'); if(a===null||a==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', a); } const c=sessionStorage.getItem('r821-prior-chats'); if(c===null||c==='null'){ localStorage.removeItem('nexus-conversations'); } else { localStorage.setItem('nexus-conversations', c); } return 'fixed:prior-rewritten-both'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "file-fix: $FIX"
agent-browser open "http://localhost:3000/?r=821t4#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
CHECK=$(agent-browser eval "(() => { try { const a=localStorage.getItem('nexus-agents')||''; const c=localStorage.getItem('nexus-conversations')||''; const clean=!a.includes('a-wit')&&!c.includes('conv-r821-witness'); return clean?'store-clean:yes':'store-clean:NO'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "reload-check: $CHECK"
echo "$CHECK" | grep -q 'store-clean:yes' || { echo 'GUARD stores still polluted after fix+reload'; exit 1; }
echo "== r821 WITNESS GREEN =="
} > /tmp/r821_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 14 /tmp/r821_witness.out
