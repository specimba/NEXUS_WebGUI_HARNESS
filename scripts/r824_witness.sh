#!/usr/bin/env bash
# r824 witness: THE SIDEBAR ROWS SPEAK - seed WitnessWorker ('a-wit') into
# localStorage nexus-agents and one witness conversation (title "r824
# witness conv", one assistant message with transport:'server') into
# nexus-conversations (both priors saved; the vault is never touched), then
# deep-link #/chat/conv-r824-witness so the sidebar renders: the Today group
# now carries role=list with a labeled group heading, every row is
# role=listitem, and the row's open-button utters the WHOLE story ("r824
# witness conv, with WitnessWorker - just now, 1 message, last reply via
# server relay") instead of leaving the reader bare fragments (pre-r824 the
# button's name was title + time + count only, the lane chip was aria-hidden
# with a visual-only tooltip, the pin was an icon-level aria-label) - then
# RESTORE both priors (write-back-safe: restore -> navigate -> file-fix ->
# re-navigate -> verify store-clean).
set -u
cd /home/z/my-project
{
echo "== r824 sidebar-row utterance witness =="
agent-browser open "http://localhost:3000/?r=824t#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
# v2 preamble (mid-dance doctrine): a v1 GUARD fired mid-dance and left the
# SEED in the stores while the TRUE priors still sat in sessionStorage -
# restore them FIRST and clear the keys, so this run's own prior-save below
# snapshots the TRUE state, not the seeded one (the r822 pollution-chain trap).
RECOVER=$(agent-browser eval "(() => { try { const pa=sessionStorage.getItem('r824-prior-agents'); const pc=sessionStorage.getItem('r824-prior-chats'); if(pa===null&&pc===null) return 'no-leftover-priors-clean'; if(pa===null||pa==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', pa); } if(pc===null||pc==='null'){ localStorage.removeItem('nexus-conversations'); } else { localStorage.setItem('nexus-conversations', pc); } sessionStorage.removeItem('r824-prior-agents'); sessionStorage.removeItem('r824-prior-chats'); return 'recovered:leftover-priors-restored'; } catch(e){ return 'recover-fail:'+e.message; } })()" || true)
echo "recover: $RECOVER"
SEED=$(agent-browser eval "(() => { try { const now=Date.now(); const rawA=localStorage.getItem('nexus-agents'); sessionStorage.setItem('r824-prior-agents', rawA===null?'null':rawA); const pa=JSON.parse(rawA||'{}'); const priorAgents=((pa.state&&pa.state.agents)||[]).filter(a=>a.id!=='a-wit'); pa.state=Object.assign({},pa.state,{agents:[{id:'a-wit',name:'WitnessWorker',emoji:'W',color:'violet',role:'worker',model:'',systemPrompt:'',tools:[],createdAt:now,updatedAt:now},...priorAgents]}); localStorage.setItem('nexus-agents', JSON.stringify(pa)); const rawC=localStorage.getItem('nexus-conversations'); sessionStorage.setItem('r824-prior-chats', rawC===null?'null':rawC); const pc=JSON.parse(rawC||'{}'); const priorConvs=((pc.state&&pc.state.conversations)||[]).filter(c=>c.id!=='conv-r824-witness'); const conv={id:'conv-r824-witness',title:'r824 witness conv',agentId:'a-wit',messages:[{id:'m1',role:'assistant',agentId:'a-wit',agentName:'WitnessWorker',content:'the witnessneedle hides in this sentence',createdAt:now,toolCalls:[],transport:'server'}],createdAt:now,updatedAt:now}; pc.state=Object.assign({},pc.state,{conversations:[conv,...priorConvs]}); localStorage.setItem('nexus-conversations', JSON.stringify(pc)); return 'seeded:1agent:1conv:transport-server'; } catch(e) { return 'seed-fail:'+e.message; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=824t2#/chat/conv-r824-witness" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
WIT=""
for i in 1 2 3 4; do
  sleep 2
  WIT=$(agent-browser eval "(() => { try { const aside=document.querySelector('aside[aria-label=\"Conversations\"]'); if(!aside) return JSON.stringify({list:false,note:'no-aside'}); const lists=[...aside.querySelectorAll('[role=\"list\"]')]; const today=lists.find(l=>/Today/.test(l.getAttribute('aria-label')||'')); const rows=[...aside.querySelectorAll('[role=\"listitem\"] button')]; const labels=rows.map(b=>b.getAttribute('aria-label')).filter(Boolean); return JSON.stringify({list:lists.length>0, todayLabeled:!!today, todayLabel:today?today.getAttribute('aria-label'):null, listitems:rows.length/2, labeled:labels.length, hit:labels.some(l=>l.startsWith('r824 witness conv, with WitnessWorker')&&/1 message,/.test(l)&&/last reply via server relay/.test(l)), labels:labels}); } catch(e){ return 'err:'+e.message; } })()" || true)
  case "$WIT" in *'"hit":true'*) break;; esac
done
echo "witness: $WIT"
WIT=${WIT//\\/}
echo "$WIT" | grep -q '"list":true' || { echo 'GUARD sidebar list semantics missing'; exit 1; }
echo "$WIT" | grep -q '"todayLabeled":true' || { echo 'GUARD sidebar group label missing'; exit 1; }
echo "$WIT" | grep -q '"hit":true' || { echo 'GUARD sidebar row utterance missing'; exit 1; }
echo "rows: the sidebar row speaks title + agent + recency + size + lane"
REST=$(agent-browser eval "(() => { try { const a=sessionStorage.getItem('r824-prior-agents'); if(a===null||a==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', a); } const c=sessionStorage.getItem('r824-prior-chats'); if(c===null||c==='null'){ localStorage.removeItem('nexus-conversations'); } else { localStorage.setItem('nexus-conversations', c); } sessionStorage.removeItem('r824-prior-agents'); sessionStorage.removeItem('r824-prior-chats'); return 'restored:prior-both'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
agent-browser open "http://localhost:3000/?r=824t3#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
FIX=$(agent-browser eval "(() => { try { const a=sessionStorage.getItem('r824-prior-agents'); if(a===null||a==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', a); } const c=sessionStorage.getItem('r824-prior-chats'); if(c===null||c==='null'){ localStorage.removeItem('nexus-conversations'); } else { localStorage.setItem('nexus-conversations', c); } return 'fixed:prior-rewritten-both'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "file-fix: $FIX"
agent-browser open "http://localhost:3000/?r=824t4#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
CHECK=$(agent-browser eval "(() => { try { const a=localStorage.getItem('nexus-agents')||''; const c=localStorage.getItem('nexus-conversations')||''; const clean=!a.includes('a-wit')&&!c.includes('conv-r824-witness'); return clean?'store-clean:yes':'store-clean:NO'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "reload-check: $CHECK"
echo "$CHECK" | grep -q 'store-clean:yes' || { echo 'GUARD stores still polluted after fix+reload'; exit 1; }
echo "== r824 WITNESS GREEN =="
} > /tmp/r824_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 16 /tmp/r824_witness.out
