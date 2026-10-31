#!/usr/bin/env bash
# r823 witness: THE SEARCH HITS KNOW THEIR CHAT - seed WitnessWorker ('a-wit')
# into localStorage nexus-agents and one witness conversation (title "r823
# witness conv", one assistant message whose content contains "witnessneedle",
# agentName set) into nexus-conversations (both priors saved; the vault is
# never touched), then drive the REAL UI chain: Ctrl+K opens the command
# palette, clicking the "Search all chats" item opens the global-search
# dialog, the needle is typed into its labeled input - and the message-hit
# option row now UTTERS its conversation ("r823 witness conv - WitnessWorker,
# ...") instead of leaving the chat context in the visual group header only
# (pre-r823 the row's content said who + snippet; the convTitle lived only in
# the header) - then RESTORE both priors (write-back-safe: restore ->
# navigate -> file-fix -> re-navigate -> verify store-clean).
set -u
cd /home/z/my-project
{
echo "== r823 search-hit utterance witness =="
agent-browser open "http://localhost:3000/?r=823t#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
SEED=$(agent-browser eval "(() => { try { const now=Date.now(); const rawA=localStorage.getItem('nexus-agents'); sessionStorage.setItem('r823-prior-agents', rawA===null?'null':rawA); const pa=JSON.parse(rawA||'{}'); const priorAgents=((pa.state&&pa.state.agents)||[]).filter(a=>a.id!=='a-wit'); pa.state=Object.assign({},pa.state,{agents:[{id:'a-wit',name:'WitnessWorker',emoji:'W',color:'violet',role:'worker',model:'',systemPrompt:'',tools:[],createdAt:now,updatedAt:now},...priorAgents]}); localStorage.setItem('nexus-agents', JSON.stringify(pa)); const rawC=localStorage.getItem('nexus-conversations'); sessionStorage.setItem('r823-prior-chats', rawC===null?'null':rawC); const pc=JSON.parse(rawC||'{}'); const priorConvs=((pc.state&&pc.state.conversations)||[]).filter(c=>c.id!=='conv-r823-witness'); const conv={id:'conv-r823-witness',title:'r823 witness conv',messages:[{id:'m1',role:'assistant',agentId:'a-wit',agentName:'WitnessWorker',content:'the witnessneedle hides in this sentence',createdAt:now,toolCalls:[]}],createdAt:now,updatedAt:now}; pc.state=Object.assign({},pc.state,{conversations:[conv,...priorConvs]}); localStorage.setItem('nexus-conversations', JSON.stringify(pc)); return 'seeded:1agent:1conv:needle'; } catch(e) { return 'seed-fail:'+e.message; } })()" || true)
echo "seed: $SEED"
agent-browser open "http://localhost:3000/?r=823t2#/workflows/board" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
# v5 dodges the v1-v4 killer: every failed run drove the dialog from #/chat,
# where chat-heartbeat mounts TWO periodic timers (setInterval tick 15s,
# force 5s) - the dialog died within 0.4-4s of typing in all four runs. The
# palette and the global search work from ANY view: the chain now runs from
# #/workflows/board, where no heartbeat is mounted.
CHAIN=$(agent-browser eval "(() => { try { window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true})); return 'k-dispatched'; } catch(e){ return 'err:'+e.message; } })()" || true)
sleep 1
CLICK=$(agent-browser eval "(() => { try { const item=[...document.querySelectorAll('[cmdk-item]')].find(e=>/Search all chats/i.test(e.textContent||'')); if(!item) return 'palette-item:missing'; item.click(); return 'palette-item:clicked'; } catch(e){ return 'err:'+e.message; } })()" || true)
sleep 1
# v6: the synthetic input event was the death trigger in v1-v5 (dialog gone
# within 0.4s of dispatch, from any view, even inside one eval) - so the type
# step now uses the browser's REAL input path (keyboard inserttext, CDP) into
# the Radix-autofocused input, and the read eval also reports the dialog /
# palette lifecycle state so a still-failing run names its state honestly.
INSERT=$(agent-browser keyboard inserttext "witnessneedle" 2>&1 | head -1) || true
echo "chain: $CHAIN click: $CLICK insert: $INSERT"
sleep 1
WIT=$(agent-browser eval "(() => { try { const inp=document.querySelector('[aria-label=\"Search chats, agents and workflows\"]'); const opts=[...document.querySelectorAll('[role=\"option\"]')]; const labels=opts.map(b=>b.getAttribute('aria-label')).filter(Boolean); return JSON.stringify({dialogOpen:!!inp,inputValue:inp?inp.value:null,paletteStuck:!!document.querySelector('[cmdk-root]'),dialogEl:!!document.querySelector('[role=\"dialog\"]'),options:opts.length,labeled:labels.length,hit:labels.some(l=>l.startsWith('r823 witness conv — WitnessWorker')),labels:labels}); } catch(e){ return 'err:'+e.message; } })()" || true)
echo "witness: $WIT"
WIT=${WIT//\\/}
echo "$WIT" | grep -q '"hit":true' || { echo 'GUARD search-hit utterance missing conv context'; exit 1; }
echo "rows: the search hit speaks which chat it belongs to"
REST=$(agent-browser eval "(() => { try { const a=sessionStorage.getItem('r823-prior-agents'); if(a===null||a==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', a); } const c=sessionStorage.getItem('r823-prior-chats'); if(c===null||c==='null'){ localStorage.removeItem('nexus-conversations'); } else { localStorage.setItem('nexus-conversations', c); } sessionStorage.removeItem('r823-prior-agents'); sessionStorage.removeItem('r823-prior-chats'); return 'restored:prior-both'; } catch(e) { return 'restore-fail'; } })()" || true)
echo "cleanup: $REST"
agent-browser open "http://localhost:3000/?r=823t3#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
FIX=$(agent-browser eval "(() => { try { const a=sessionStorage.getItem('r823-prior-agents'); if(a===null||a==='null'){ localStorage.removeItem('nexus-agents'); } else { localStorage.setItem('nexus-agents', a); } const c=sessionStorage.getItem('r823-prior-chats'); if(c===null||c==='null'){ localStorage.removeItem('nexus-conversations'); } else { localStorage.setItem('nexus-conversations', c); } return 'fixed:prior-rewritten-both'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "file-fix: $FIX"
agent-browser open "http://localhost:3000/?r=823t4#/settings" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
CHECK=$(agent-browser eval "(() => { try { const a=localStorage.getItem('nexus-agents')||''; const c=localStorage.getItem('nexus-conversations')||''; const clean=!a.includes('a-wit')&&!c.includes('conv-r823-witness'); return clean?'store-clean:yes':'store-clean:NO'; } catch(e){ return 'err:'+e.message; } })()" || true)
echo "reload-check: $CHECK"
echo "$CHECK" | grep -q 'store-clean:yes' || { echo 'GUARD stores still polluted after fix+reload'; exit 1; }
echo "== r823 WITNESS GREEN =="
} > /tmp/r823_witness.out 2>&1 < /dev/null
echo "EXIT=$?"
tail -n 16 /tmp/r823_witness.out
