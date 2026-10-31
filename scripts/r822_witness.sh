#!/usr/bin/env bash
# r822 witness: THE TOOL STRIP SPEAKS - seed two agents (WitnessWorker,
# SecondAgent) into localStorage nexus-agents and one witness conversation
# (one assistant message carrying TWO tool calls: web_search ok:true ms:1200,
# web_search ok:false ms:340) into nexus-conversations (both priors saved; the
# vault is never touched), reload on the #/chat/conv-r822-witness deep link,
# then assert the message's tool-calls strip SPEAKS: the labeled list renders
# "Tool activity — 2 calls" and every card self-describes ("Web Search —
# Succeeded, 1.2s" / "Web Search — Failed, ...") — pre-r822 the strip was a
# bare stack of disclosure buttons (no list semantics) and each card's outcome
# lived ONLY in the status icon's own aria-label - then RESTORE both priors
# (write-back-safe: restore -> navigate -> file-fix -> re-navigate -> verify
# store-clean).
set -u
cd /home/z/my-project
{
echo "== r822 tool-strip utterance witness =="
agent-browser open "http://localhost:3000/?r=822t#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { try { const now=Date.now(); const rawA=localStorage.getItem('nexus-agents'); sessionStorage.setItem('r822-prior-agents', rawA===null?'null':rawA); const pa=JSON.parse(rawA||'{}'); const priorAgents=((pa.state&&pa.state.agents)||[]).filter(a=>a.id!=='a-wit'&&a.id!=='a-two'); const mkA=(id,name,emoji,color)=>({id,name,emoji,color,role:'worker',model:'',systemPrompt:'',tools:[],createdAt:now,updatedAt:now}); pa.state=Object.assign({},pa.state,{agents:[mkA('a-wit','WitnessWorker','W','violet'),mkA('a-two','SecondAgent','S','emerald'),...priorAgents]}); localStorage.setItem('nexus-agents', JSON.stringify(pa)); const rawC=localStorage.getItem('nexus-conversations'); sessionStorage.setItem('r822-prior-chats', rawC===null?'null':rawC); const pc=JSON.parse(rawC||'{}'); const priorConvs=((pc.state&&pc.state.conversations)||[]).filter(c=>c.id!=='conv-r822-witness'); const msg={id:'m1',role:'assistant',agentId:'a-wit',content:'witness',createdAt:now,toolCalls:[{id:'t1',name:'web_search',args:'{}',ok:true,ms:1200,result:'witness hit'},{id:'t2',name:'web_search',args:'{}',ok:false,ms:340,result:'boom'}]}; const conv={id:'conv-r822-witness',title:'r822 witness',messages:[msg],createdAt:now,updatedAt:now}; pc.state=Object.assign({},pc.state,{conversations:[conv,...priorConvs]}); localStorage.setItem('nexus-conversations', JSON.stringify(pc)); return 'seeded:2agents:1conv:2calls'; } catch(e) { return 'seed-fail:'+e.message; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=822t2#/chat/conv-r822-witness" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 2
WIT=$(agent-browser eval "(() => { try { const tl=document.querySelector('[aria-label=\"Tool activity — 2 calls\"]'); if(!tl) return JSON.stringify({list:false}); const btns=[...tl.querySelectorAll('[role=\"listitem\"] button')].map(e=>e.getAttribute('aria-label')); return JSON.stringify({list:true,n:btns.length,ok:btns.some(l=>(l||'').startsWith('Web Search — Succeeded,')),fail:btns.some(l=>(l||'').includes('— Failed')),labels:btns}); } catch(e){ return 'err:'+e.message; } })()" || true)
echo "witness: $WIT"
WITN=${WIT//\\/}
echo "$WITN" | grep -q '"list":true' || { echo 'GUARD tool activity list did not render'; exit 1; }
echo "$WITN" | grep -q '"ok":true' || { echo 'GUARD Web Search — Succeeded utterance'; exit 1; }
echo "$WITN" | grep -q '"fail":true' || { echo 'GUARD — Failed utterance'; exit 1; }
echo "rows: the tool strip speaks its count and each card speaks its outcome"
REST=$(agent-browser eval "(() => { try { const a=sessionStorage.getItem('r822-prior-agents'); if(a===null||a==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', a); } const c=sessionStorage.getItem('r822-prior-chats'); if(c===null||c==='null'){ localStorage.removeItem('nexus-conversations'); } else { localStorage.setItem('nexus-conversations', c); } sessionStorage.removeItem('r822-prior-agents'); sessionStorage.removeItem('r822-prior-chats'); return 'restored:prior-both'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
agent-browser open "http://localhost:3000/?r=822t3#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
FIX=$(agent-browser eval "(() => { try { const a=sessionStorage.getItem('r822-prior-agents'); if(a===null||a==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', a); } const c=sessionStorage.getItem('r822-prior-chats'); if(c===null||c==='null'){ localStorage.removeItem('nexus-conversations'); } else { localStorage.setItem('nexus-conversations', c); } return 'fixed:prior-rewritten-both'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "file-fix: $FIX"
agent-browser open "http://localhost:3000/?r=822t4#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
CHECK=$(agent-browser eval "(() => { try { const a=localStorage.getItem('nexus-agents')||''; const c=localStorage.getItem('nexus-conversations')||''; const clean=!a.includes('a-wit')&&!c.includes('conv-r822-witness'); return clean?'store-clean:yes':'store-clean:NO'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "reload-check: $CHECK"
echo "$CHECK" | grep -q 'store-clean:yes' || { echo 'GUARD stores still polluted after fix+reload'; exit 1; }
echo "== r822 WITNESS GREEN =="
} > /tmp/r822_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 14 /tmp/r822_witness.out
