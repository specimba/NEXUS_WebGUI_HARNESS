#!/usr/bin/env bash
# r823 diagnostic: the witness chain reached the input (typed:witnessneedle)
# but found zero [role=option] rows. Stores still hold the seed (the GUARD
# fired pre-restore). Replay the chain and return the dialog's live state:
# does the controlled input KEEP the needle (state took) and what does the
# listbox actually contain (idle empty state vs hits vs closed dialog).
set -u
cd /home/z/my-project
{
echo "== r823 search dialog diagnostic =="
agent-browser open "http://localhost:3000/?r=823d#/chat" >/dev/null 2>&1 || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
agent-browser eval "(() => { window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true})); return 'k'; })()" >/dev/null 2>&1 || true
sleep 1
agent-browser eval "(() => { const item=[...document.querySelectorAll('[cmdk-item]')].find(e=>/Search all chats/i.test(e.textContent||'')); if(!item) return 'item-missing'; item.click(); return 'clicked'; })()" >/dev/null 2>&1 || true
sleep 1
agent-browser eval "(() => { const inp=document.querySelector('[aria-label=\"Search chats, agents and workflows\"]'); if(!inp) return 'input-missing'; const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; setter.call(inp,'witnessneedle'); inp.dispatchEvent(new Event('input',{bubbles:true})); return 'typed'; })()" >/dev/null 2>&1 || true
sleep 2
DIAG=$(agent-browser eval "(() => { try { const inp=document.querySelector('[aria-label=\"Search chats, agents and workflows\"]'); const lb=document.querySelector('[role=\"listbox\"]'); return JSON.stringify({dialogOpen:!!inp,inputValue:inp?inp.value:null,listbox:!!lb,lbText:lb?lb.textContent.slice(0,220):null,lbHTML:lb?lb.innerHTML.length:0,options:document.querySelectorAll('[role=\"option\"]').length,groups:lb?lb.querySelectorAll('p').length:0,convInStore:(localStorage.getItem('nexus-conversations')||'').includes('conv-r823-witness')}); } catch(e){ return 'err:'+e.message; } })()" || true)
echo "diag: $DIAG"
} > /tmp/r823_diag.out 2>&1 < /dev/null
echo "EXIT=$?"
cat /tmp/r823_diag.out
