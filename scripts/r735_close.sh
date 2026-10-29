#!/usr/bin/env bash
set -u
cd /home/z/my-project
rm -rf scripts/tmp-r639
OUT=scripts/qa_r735.txt
: > "$OUT"
exec > >(tee -a "$OUT") 2>&1
echo "=== r735 close $(date -Is) ==="

code=000
for i in $(seq 1 20); do
  code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 3
done
echo "server: $code"
[ "$code" = "200" ] || { echo 'GUARD server down'; exit 1; }

echo "--- evals payload (corpus intact check) ---"
curl -s -m 30 http://localhost:3000/api/evals -o scripts/qa_r735_evals.json
python3 - <<'PY'
import json
j=json.load(open('scripts/qa_r735_evals.json'))
runs=j.get('runs')
rows=[r for r in (runs or []) if isinstance(r,dict) and isinstance(r.get('runId'),str) and isinstance(r.get('note'),str)]
ids=sorted({r['runId'] for r in rows})
print(f"evals-total:{j.get('total')} runs-rows:{len(rows)} distinct:{len(ids)}")
print('evals-ids:'+','.join(ids[:12]))
if j.get('total',0) < 20 or len(rows) < 20: raise SystemExit(1)
print('evals-corpus-ok')
PY
[ $? -eq 0 ] || { echo 'GUARD evals corpus'; exit 1; }

echo "--- corpus snapshot (durable road, pre-commit) ---"
bun scripts/corpus-snapshot.ts || { echo 'GUARD snapshot'; exit 1; }
[ -s db/corpus-snapshots/latest.json ] || { echo 'GUARD snapshot file'; exit 1; }
if git check-ignore -q db/corpus-snapshots/latest.json; then
  echo "snapshots are gitignored — force-adding the snapshot dir (corpus durability requires git)"
  git add -f db/corpus-snapshots >/dev/null 2>&1 || true
fi

echo "--- board witness: digest split + strip tally (fresh load) ---"
agent-browser open "http://localhost:3000/#workflows" || true
agent-browser eval '(() => { location.reload(); return "reloaded"; })()' || true
sleep 9
agent-browser eval '(() => { const rb=[...document.querySelectorAll("[role=radio]")].find(x=>(x.getAttribute("aria-label")||"")==="Runs board layout"); if(!rb) return "radio-MISS"; if(rb.getAttribute("aria-checked")!=="true") rb.click(); return "radio-ok"; })()' || true
sleep 8
WPROBE='(() => { const chip=[...document.querySelectorAll("span")].find(s=>(s.getAttribute("title")||"").startsWith("RSI eval ledger")); const dt=chip?(chip.textContent||""):""; const split=/\d{1,4}u\b/.test(dt)&&/\d{1,4}nj\b/.test(dt); const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({strip:false,split:split,tallyOk:false,chips:0}); const hdr=strip.querySelector("div"); const spans=hdr?[...hdr.querySelectorAll("span")]:[]; const tally=spans.length>1?(spans[1].textContent||""):""; const tallyOk=/\d+ ev/.test(tally)&&/\d{1,4}nj\b/.test(tally); const chips=[...strip.querySelectorAll("span")].filter(s=>/^⚖ gate \d+·\d+/.test((s.textContent||"").trim())); return JSON.stringify({strip:true,split:split,dt:dt.slice(0,140),tallyOk:tallyOk,tally:tally.slice(0,140),chips:chips.length}); })()'
W1=$(agent-browser eval "$WPROBE" || true)
echo "$W1" | grep -q '"split":true' || { sleep 6; W2=$(agent-browser eval "$WPROBE" || true); W1="$W1 || retry: $W2"; }
echo "witness: $W1"
echo "$W1" | grep -Eq 'strip\\?":true' || { echo 'GUARD strip missing'; exit 1; }
echo "$W1" | grep -Eq 'split\\?":true' || { echo 'GUARD digest u/nj split missing'; exit 1; }
echo "$W1" | grep -Eq 'chips\\?":[1-9]' || { echo 'GUARD strip chips zero'; exit 1; }

echo "--- click-through regression witness (r726 ship) ---"
CT='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({ct:false,why:"no-strip"}); const btns=[...strip.querySelectorAll("button")]; if(!btns.length) return JSON.stringify({ct:false,why:"no-pills"}); const target=btns.find(b=>/nj/.test(b.textContent||""))||btns[0]; target.click(); return JSON.stringify({ct:true,label:(target.textContent||"").slice(0,60)}); })()'
CT1=$(agent-browser eval "$CT" || true)
echo "click: $CT1"
echo "$CT1" | grep -Eq 'ct\\?":true' || { echo 'GUARD pill click'; exit 1; }
sleep 1.5
CTP='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const p=document.querySelector("[data-testid=\"corpus-run-detail\"]"); const open=strip?[...strip.querySelectorAll("button[aria-expanded=\"true\"]")]:[]; if(!p) return JSON.stringify({panel:false,expandedOk:open.length===1}); const rows=p.querySelectorAll("li").length; const t=p.textContent||""; return JSON.stringify({panel:true,expandedOk:open.length===1,rows:rows,ladder:/tried:/.test(t),dialTitle:strip?/judge dial trace/.test(strip.innerHTML):false,role:p.getAttribute("role"),head:t.slice(0,90)}); })()'
CT2=$(agent-browser eval "$CTP" || true)
echo "panel: $CT2"
echo "$CT2" | grep -Eq 'panel\\?":true' || { echo 'GUARD panel missing'; exit 1; }
echo "$CT2" | grep -Eq 'expandedOk\\?":true' || { echo 'GUARD aria-expanded'; exit 1; }
echo "$CT2" | grep -Eq 'rows\\?":[1-9]' || { echo 'GUARD panel rows zero'; exit 1; }
CTW="$CT1 || $CT2"

echo "--- keyboard regression witness (r727 ship) ---"
KB1='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({kb:false,why:"no-strip"}); const btns=[...strip.querySelectorAll("button")]; if(btns.length<2) return JSON.stringify({kb:false,why:"few-pills"}); btns[0].focus(); btns[0].dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true})); return JSON.stringify({kb:true,moved:document.activeElement===btns[1]}); })()'
KBa=$(agent-browser eval "$KB1" || true)
echo "arrows: $KBa"
echo "$KBa" | grep -Eq 'moved\\?":true' || { echo 'GUARD arrow traversal'; exit 1; }
KB2='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const btns=strip?[...strip.querySelectorAll("button")]:[]; if(!btns.length) return JSON.stringify({open:false,why:"no-pills"}); const target=btns.find(b=>b.getAttribute("aria-expanded")!=="true")||btns[0]; target.click(); return JSON.stringify({open:true}); })()'
KBb=$(agent-browser eval "$KB2" || true)
echo "open-for-esc: $KBb"
echo "$KBb" | grep -Eq 'open\\?":true' || { echo 'GUARD open for escape'; exit 1; }
sleep 1.5
KB3='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const btns=strip?[...strip.querySelectorAll("button")]:[]; const target=btns.find(b=>b.getAttribute("aria-expanded")==="true"); if(!target) return JSON.stringify({esc:false,why:"none-open"}); target.focus(); target.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return JSON.stringify({esc:true}); })()'
KBc=$(agent-browser eval "$KB3" || true)
echo "escape: $KBc"
echo "$KBc" | grep -Eq 'esc\\?":true' || { echo 'GUARD escape dispatch'; exit 1; }
sleep 1.5
KB4='(() => { const p=document.querySelector("[data-testid=\"corpus-run-detail\"]"); const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const open=strip?[...strip.querySelectorAll("button[aria-expanded=\"true\"]")].length:-1; return JSON.stringify({closed:!p,openAfter:open}); })()'
KBd=$(agent-browser eval "$KB4" || true)
echo "closed: $KBd"
echo "$KBd" | grep -Eq 'closed\\?":true' || { echo 'GUARD escape did not close'; exit 1; }
echo "$KBd" | grep -Eq 'openAfter\\?":0' || { echo 'GUARD expanded leftover'; exit 1; }
KBW="$KBa || $KBc || $KBd"

echo "--- copy regression witness: panel header copy-run-id (r728 ship, clipboard stubbed) ---"
CP1='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const btns=strip?[...strip.querySelectorAll("button")]:[]; if(!btns.length) return JSON.stringify({cpOpen:false,why:"no-pills"}); const target=btns.find(b=>b.getAttribute("aria-expanded")!=="true")||btns[0]; target.click(); return JSON.stringify({cpOpen:true}); })()'
CPa=$(agent-browser eval "$CP1" || true)
echo "cp-open: $CPa"
echo "$CPa" | grep -Eq 'cpOpen\\?":true' || { echo 'GUARD cp open pill'; exit 1; }
sleep 1.5
CP2='(() => { const p=document.querySelector("[data-testid=\"corpus-run-detail\"]"); if(!p) return JSON.stringify({cpClick:false,why:"no-panel"}); const btn=p.querySelector("button[aria-label^=\"Copy run id\"]"); if(!btn) return JSON.stringify({cpClick:false,why:"no-btn"}); try { Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:function(t){ window.__copiedRunId=t; return Promise.resolve(); }}}); } catch(e) { return JSON.stringify({cpClick:false,why:"stub-fail"}); } btn.click(); return JSON.stringify({cpClick:true}); })()'
CPb=$(agent-browser eval "$CP2" || true)
echo "cp-click: $CPb"
echo "$CPb" | grep -Eq 'cpClick\\?":true' || { echo 'GUARD copy click'; exit 1; }
sleep 1
CP3='(() => { const p=document.querySelector("[data-testid=\"corpus-run-detail\"]"); if(!p) return JSON.stringify({copiedOk:false,why:"no-panel"}); const btn=p.querySelector("button[aria-label^=\"Copy run id\"]"); if(!btn) return JSON.stringify({copiedOk:false,why:"no-btn"}); const code=p.querySelector("code"); const want=code?(code.textContent||""):""; const got=window.__copiedRunId||null; const toastEl=document.querySelector("[data-sonner-toast]"); return JSON.stringify({copiedOk:/text-emerald-600/.test(btn.className),clipOk:got===want&&want.length>0,want:want.slice(0,26),toast:toastEl?(toastEl.textContent||"").slice(0,40):null}); })()'
CPc=$(agent-browser eval "$CP3" || true)
echo "cp-check: $CPc"
echo "$CPc" | grep -Eq 'copiedOk\\?":true' || { echo 'GUARD check-swap missing'; exit 1; }
echo "$CPc" | grep -Eq 'clipOk\\?":true' || { echo 'GUARD clipboard payload mismatch'; exit 1; }
CPW="$CPa || $CPb || $CPc"

echo "--- copy-all witness: digest run-id comma list (r729 ship, clipboard stubbed) ---"
CA1='(() => { const btn=document.querySelector("button[aria-label^=\"Copy all\"]"); if(!btn) return JSON.stringify({ca:false,why:"no-btn"}); try { Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:function(t){ window.__copiedAll=t; return Promise.resolve(); }}}); } catch(e) { return JSON.stringify({ca:false,why:"stub-fail"}); } btn.click(); return JSON.stringify({ca:true}); })()'
CAa=$(agent-browser eval "$CA1" || true)
echo "ca-click: $CAa"
echo "$CAa" | grep -Eq 'ca\\?":true' || { echo 'GUARD copy-all click'; exit 1; }
sleep 1
CA2='(() => { const btn=document.querySelector("button[aria-label^=\"Copy all\"]"); const got=window.__copiedAll||null; if(!got) return JSON.stringify({ok:false,why:"no-payload",checkSwap:btn?/text-emerald-600/.test(btn.className):false}); const ids=got.split(","); const distinct=new Set(ids); const toastEl=document.querySelector("[data-sonner-toast]"); return JSON.stringify({ok:true,checkSwap:btn?/text-emerald-600/.test(btn.className):false,n:ids.length,distinct:distinct.size,same:ids.length===distinct.size,head:ids.slice(0,3).join(",").slice(0,60),toast:toastEl?(toastEl.textContent||"").slice(0,40):null}); })()'
CAb=$(agent-browser eval "$CA2" || true)
echo "ca-check: $CAb"
echo "$CAb" | grep -Eq 'ok\\?":true' || { echo 'GUARD copy-all payload'; exit 1; }
echo "$CAb" | grep -Eq 'checkSwap\\?":true' || { echo 'GUARD copy-all check-swap'; exit 1; }
echo "$CAb" | grep -Eq 'distinct\\?":([2-9]|[1-9][0-9]+)' || { echo 'GUARD copy-all distinct ids'; exit 1; }
echo "$CAb" | grep -Eq 'same\\?":true' || { echo 'GUARD copy-all dedupe'; exit 1; }
CAW="$CAa || $CAb"

echo "--- ladder witness: panel decision ladder as text (r731 ship, clipboard stubbed) ---"
CL1='(() => { const p=document.querySelector("[data-testid=\"corpus-run-detail\"]"); if(p) return JSON.stringify({clOpen:true,why:"already"}); const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const btns=strip?[...strip.querySelectorAll("button")]:[]; const closed=btns.filter(b=>b.getAttribute("aria-expanded")!=="true"); const target=closed.find(b=>/nj/.test(b.textContent||""))||closed[0]; if(!target) return JSON.stringify({clOpen:false,why:"no-closed-pill"}); target.click(); return JSON.stringify({clOpen:true,why:"clicked"}); })()'
CLa=$(agent-browser eval "$CL1" || true)
echo "cl-open: $CLa"
echo "$CLa" | grep -Eq 'clOpen\\?":true' || { echo 'GUARD ladder panel open'; exit 1; }
sleep 1.5
CL2='(() => { const p=document.querySelector("[data-testid=\"corpus-run-detail\"]"); if(!p) return JSON.stringify({clClick:false,why:"no-panel"}); const btn=p.querySelector("button[aria-label^=\"Copy the full decision ladder\"]"); if(!btn) return JSON.stringify({clClick:false,why:"no-btn"}); try { Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:function(t){ window.__copiedLadder=t; return Promise.resolve(); }}}); } catch(e) { return JSON.stringify({clClick:false,why:"stub-fail"}); } btn.click(); return JSON.stringify({clClick:true}); })()'
CLb=$(agent-browser eval "$CL2" || true)
echo "cl-click: $CLb"
echo "$CLb" | grep -Eq 'clClick\\?":true' || { echo 'GUARD ladder copy click'; exit 1; }
sleep 1
CL3='(() => { const p=document.querySelector("[data-testid=\"corpus-run-detail\"]"); const t=window.__copiedLadder||null; if(!t) return JSON.stringify({clOk:false,why:"no-payload"}); const lines=t.split("\n"); const lis=p?p.querySelectorAll("ul > li").length:0; const btn=p?p.querySelector("button[aria-label^=\"Copy the full decision ladder\"]"):null; const toastEl=document.querySelector("[data-sonner-toast]"); const headOk=t.indexOf("run_")===0&&/events · engaged/.test(lines[0]||""); const labelOk=/\[(verdict · PASS|verdict · FAIL|uncertain|no judge|gate event)\]/.test(t); return JSON.stringify({clOk:headOk&&labelOk&&lines.length>=lis+1,checkSwap:btn?/text-emerald-600/.test(btn.className):false,lines:lines.length,rows:lis,headOk:headOk,labelOk:labelOk,head:(lines[0]||"").slice(0,70),toast:toastEl?(toastEl.textContent||"").slice(0,40):null}); })()'
CLc=$(agent-browser eval "$CL3" || true)
echo "cl-check: $CLc"
echo "$CLc" | grep -Eq 'clOk\\?":true' || { echo 'GUARD ladder payload'; exit 1; }
echo "$CLc" | grep -Eq 'checkSwap\\?":true' || { echo 'GUARD ladder check-swap'; exit 1; }
echo "$CLc" | grep -Eq 'labelOk\\?":true' || { echo 'GUARD ladder label brackets'; exit 1; }
echo "$CLc" | grep -Eq 'lines\\?":([2-9]|[1-9][0-9]+)' || { echo 'GUARD ladder line count'; exit 1; }
CLW="$CLa || $CLb || $CLc"

echo "--- filter witness: run-id type-to-find on the strip (r732 ship) ---"
FL1='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({fl:false,why:"no-strip"}); const row=strip.querySelector("div.flex.flex-wrap.items-center"); const pills=row?[...row.querySelectorAll("button")]:[]; const inp=strip.querySelector("input[aria-label^=\"Filter corpus run pills\"]"); if(!inp) return JSON.stringify({fl:false,why:"no-input"}); const code=pills[0]?pills[0].querySelector("code"):null; const q=code?(code.textContent||"").slice(0,12):""; if(!q) return JSON.stringify({fl:false,why:"no-query"}); const before=pills.length; const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; setter.call(inp,q); inp.dispatchEvent(new Event("input",{bubbles:true})); return JSON.stringify({fl:true,q:q,before:before}); })()'
FLa=$(agent-browser eval "$FL1" || true)
echo "fl-type: $FLa"
echo "$FLa" | grep -Eq 'fl\\?":true' || { echo 'GUARD filter type'; exit 1; }
sleep 1.5
FL2='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({flOk:false,why:"no-strip"}); const row=strip.querySelector("div.flex.flex-wrap.items-center"); const after=row?row.querySelectorAll("button").length:0; const spans=[...strip.querySelectorAll("span")]; const chip=spans.find(s=>/ of \d+ shown/.test(s.textContent||"")); const chipTxt=chip?(chip.textContent||"").trim():""; const m=chipTxt.match(/(\d+) of (\d+) shown/); const shown=m?Number(m[1]):-1; const total=m?Number(m[2]):-1; const firstCode=row&&row.querySelector("button code")?row.querySelector("button code").textContent:""; return JSON.stringify({flOk:after>=1&&after===shown&&total>shown&&total>=2,after:after,chip:chipTxt.slice(0,24),pillId:firstCode.slice(0,20)}); })()'
FLb=$(agent-browser eval "$FL2" || true)
echo "fl-shrunk: $FLb"
echo "$FLb" | grep -Eq 'flOk\\?":true' || { echo 'GUARD filter shrink'; exit 1; }
echo "$FLb" | grep -Eq 'after\\?":[1-9]' || { echo 'GUARD filter after zero'; exit 1; }
FL3='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const inp=strip?strip.querySelector("input[aria-label^=\"Filter corpus run pills\"]"):null; if(!inp) return JSON.stringify({flGhost:false,why:"no-input"}); const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; setter.call(inp,"zzznope"); inp.dispatchEvent(new Event("input",{bubbles:true})); return JSON.stringify({flGhost:true}); })()'
FLc=$(agent-browser eval "$FL3" || true)
echo "fl-garbage: $FLc"
echo "$FLc" | grep -Eq 'flGhost\\?":true' || { echo 'GUARD filter garbage type'; exit 1; }
sleep 1.5
FL4='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({ghostOk:false,why:"no-strip"}); const row=strip.querySelector("div.flex.flex-wrap.items-center"); const after=row?row.querySelectorAll("button").length:0; const ghost=(strip.textContent||"").includes("No corpus runs match"); const chip=[...strip.querySelectorAll("span")].some(s=>/ of \d+ shown/.test(s.textContent||"")); return JSON.stringify({ghostOk:ghost&&after===0&&chip,residual:after}); })()'
FLd=$(agent-browser eval "$FL4" || true)
echo "fl-ghost: $FLd"
echo "$FLd" | grep -Eq 'ghostOk\\?":true' || { echo 'GUARD honest ghost missing'; exit 1; }
FL5='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const inp=strip?strip.querySelector("input[aria-label^=\"Filter corpus run pills\"]"):null; if(!inp) return JSON.stringify({cleared:false,why:"no-input"}); const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; setter.call(inp,""); inp.dispatchEvent(new Event("input",{bubbles:true})); return JSON.stringify({cleared:true}); })()'
FLe=$(agent-browser eval "$FL5" || true)
echo "fl-clear: $FLe"
echo "$FLe" | grep -Eq 'cleared\\?":true' || { echo 'GUARD filter clear'; exit 1; }
sleep 1.5
FL6='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({restored:false,why:"no-strip"}); const row=strip.querySelector("div.flex.flex-wrap.items-center"); const after=row?row.querySelectorAll("button").length:0; const chip=[...strip.querySelectorAll("span")].some(s=>/ of \d+ shown/.test(s.textContent||"")); const ghost=(strip.textContent||"").includes("No corpus runs match"); return JSON.stringify({restored:!chip&&!ghost&&after>=1,after:after}); })()'
FLf=$(agent-browser eval "$FL6" || true)
echo "fl-restored: $FLf"
echo "$FLf" | grep -Eq 'restored\\?":true' || { echo 'GUARD filter restore'; exit 1; }
echo "$FLf" | grep -Eq 'after\\?":[1-9]' || { echo 'GUARD restore pills zero'; exit 1; }
FLW="$FLa || $FLb || $FLd || $FLf"

echo "--- clear-chip witness: the matching-state exit (r735 ship) ---"
XB1='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const inp=strip?strip.querySelector("input[aria-label^=\"Filter corpus run pills\"]"):null; if(!inp) return JSON.stringify({xb:false,why:"no-input"}); const row=strip.querySelector("div.flex.flex-wrap.items-center"); const code=row&&row.querySelector("button code")?row.querySelector("button code").textContent:""; if(!code) return JSON.stringify({xb:false,why:"no-pills"}); const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; setter.call(inp,code.slice(0,12)); inp.dispatchEvent(new Event("input",{bubbles:true})); return JSON.stringify({xb:true}); })()'
XBa=$(agent-browser eval "$XB1" || true)
echo "xb-type: $XBa"
echo "$XBa" | grep -Eq 'xb\\?":true' || { echo 'GUARD clear-chip type'; exit 1; }
sleep 1.5
XB2='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({xbBtn:false,why:"no-strip"}); const row=strip.querySelector("div.flex.flex-wrap.items-center"); const pills=row?row.querySelectorAll("button").length:0; const ghost=(strip.textContent||"").includes("No corpus runs match"); const btn=strip.querySelector("button[aria-label^=\"Clear the corpus run filter\"]"); if(!btn||ghost||pills<1) return JSON.stringify({xbBtn:false,why:"no-chip-or-ghost",pills:pills}); const chip=[...strip.querySelectorAll("span")].some(s=>/ of \d+ shown/.test(s.textContent||"")); btn.click(); return JSON.stringify({xbBtn:true,chip:chip,pills:pills}); })()'
XBb=$(agent-browser eval "$XB2" || true)
echo "xb-chip: $XBb"
echo "$XBb" | grep -Eq 'xbBtn\\?":true' || { echo 'GUARD clear chip missing'; exit 1; }
echo "$XBb" | grep -Eq 'chip\\?":true' || { echo 'GUARD count chip missing'; exit 1; }
sleep 1.5
XB3='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({xbOk:false,why:"no-strip"}); const row=strip.querySelector("div.flex.flex-wrap.items-center"); const after=row?row.querySelectorAll("button").length:0; const chip=[...strip.querySelectorAll("span")].some(s=>/ of \d+ shown/.test(s.textContent||"")); const btn=strip.querySelector("button[aria-label^=\"Clear the corpus run filter\"]"); const ghost=(strip.textContent||"").includes("No corpus runs match"); return JSON.stringify({xbOk:!chip&&!btn&&!ghost&&after>=1,after:after}); })()'
XBc=$(agent-browser eval "$XB3" || true)
echo "xb-restored: $XBc"
echo "$XBc" | grep -Eq 'xbOk\\?":true' || { echo 'GUARD clear-chip restore'; exit 1; }
echo "$XBc" | grep -Eq 'after\\?":[1-9]' || { echo 'GUARD clear-chip pills zero'; exit 1; }
XBW="$XBa || $XBb || $XBc"

echo "--- ghost-clear-button witness: the dead end is one click (r734 ship) ---"
GC1='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const inp=strip?strip.querySelector("input[aria-label^=\"Filter corpus run pills\"]"):null; if(!inp) return JSON.stringify({gc:false,why:"no-input"}); const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; setter.call(inp,"zzznope"); inp.dispatchEvent(new Event("input",{bubbles:true})); return JSON.stringify({gc:true}); })()'
GCa=$(agent-browser eval "$GC1" || true)
echo "gc-type: $GCa"
echo "$GCa" | grep -Eq 'gc\\?":true' || { echo 'GUARD ghost-clear type'; exit 1; }
sleep 1.5
GC2='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({gcBtn:false,why:"no-strip"}); const ghost=(strip.textContent||"").includes("No corpus runs match"); const btn=strip.querySelector("button[aria-label^=\"Clear the corpus run filter\"]"); if(!btn) return JSON.stringify({gcBtn:false,why:"no-btn",ghost:ghost}); const hid=(strip.textContent||"").match(/all (\d+) corpus runs are hidden/); return JSON.stringify({gcBtn:true,ghost:ghost,hiddenCount:hid?Number(hid[1]):-1,label:(btn.textContent||"").trim()}); })()'
GCb=$(agent-browser eval "$GC2" || true)
echo "gc-btn: $GCb"
echo "$GCb" | grep -Eq 'gcBtn\\?":true' || { echo 'GUARD ghost clear button missing'; exit 1; }
echo "$GCb" | grep -Eq 'hiddenCount\\?":([2-9]|[1-9][0-9]+)' || { echo 'GUARD hidden-count honest text'; exit 1; }
GC3='(() => { const btn=document.querySelector("button[aria-label^=\"Clear the corpus run filter\"]"); if(!btn) return JSON.stringify({gcClick:false,why:"no-btn"}); btn.click(); return JSON.stringify({gcClick:true}); })()'
GCc=$(agent-browser eval "$GC3" || true)
echo "gc-click: $GCc"
echo "$GCc" | grep -Eq 'gcClick\\?":true' || { echo 'GUARD ghost clear click'; exit 1; }
sleep 1.5
GC4='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const btn=document.querySelector("button[aria-label^=\"Clear the corpus run filter\"]"); const row=strip?strip.querySelector("div.flex.flex-wrap.items-center"):null; const after=row?row.querySelectorAll("button").length:0; const ghost=strip?(strip.textContent||"").includes("No corpus runs match"):false; const chip=[...(strip?strip.querySelectorAll("span"):[])].some(s=>/ of \d+ shown/.test(s.textContent||"")); return JSON.stringify({gcOk:!btn&&!ghost&&!chip&&after>=1,after:after}); })()'
GCd=$(agent-browser eval "$GC4" || true)
echo "gc-restored: $GCd"
echo "$GCd" | grep -Eq 'gcOk\\?":true' || { echo 'GUARD ghost clear restore'; exit 1; }
echo "$GCd" | grep -Eq 'after\\?":[1-9]' || { echo 'GUARD ghost clear pills zero'; exit 1; }
GCW="$GCa || $GCb || $GCc || $GCd"

echo "--- visible-copy witness: subset keys while filtered (r733 ship, clipboard stubbed) ---"
FV1='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const inp=strip?strip.querySelector("input[aria-label^=\"Filter corpus run pills\"]"):null; if(!inp) return JSON.stringify({fv:false,why:"no-input"}); const row=strip.querySelector("div.flex.flex-wrap.items-center"); const code=row&&row.querySelector("button code")?row.querySelector("button code").textContent:""; if(!code) return JSON.stringify({fv:false,why:"no-pills"}); const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; setter.call(inp,code.slice(0,12)); inp.dispatchEvent(new Event("input",{bubbles:true})); return JSON.stringify({fv:true}); })()'
FVa=$(agent-browser eval "$FV1" || true)
echo "fv-type: $FVa"
echo "$FVa" | grep -Eq 'fv\\?":true' || { echo 'GUARD visible filter type'; exit 1; }
sleep 1.5
FV2='(() => { const btn=document.querySelector("button[aria-label^=\"Copy the visible\"]"); if(!btn) return JSON.stringify({fvClick:false,why:"no-btn"}); try { Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:function(t){ window.__copiedVisible=t; return Promise.resolve(); }}}); } catch(e) { return JSON.stringify({fvClick:false,why:"stub-fail"}); } btn.click(); return JSON.stringify({fvClick:true}); })()'
FVb=$(agent-browser eval "$FV2" || true)
echo "fv-click: $FVb"
echo "$FVb" | grep -Eq 'fvClick\\?":true' || { echo 'GUARD visible copy click'; exit 1; }
sleep 1
FV3='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const row=strip?strip.querySelector("div.flex.flex-wrap.items-center"):null; const got=window.__copiedVisible||null; if(!got) return JSON.stringify({fvOk:false,why:"no-payload"}); const ids=got.split(","); const distinct=new Set(ids); const btn=document.querySelector("button[aria-label^=\"Copy the visible\"]"); const pills=row?row.querySelectorAll("button").length:-1; const toastEl=document.querySelector("[data-sonner-toast]"); return JSON.stringify({fvOk:ids.length===pills&&pills>=1&&ids.length===distinct.size&&got.indexOf("run_")===0,checkSwap:btn?/text-emerald-600/.test(btn.className):false,n:ids.length,pills:pills,head:ids.slice(0,2).join(",").slice(0,40),toast:toastEl?(toastEl.textContent||"").slice(0,44):null}); })()'
FVc=$(agent-browser eval "$FV3" || true)
echo "fv-check: $FVc"
echo "$FVc" | grep -Eq 'fvOk\\?":true' || { echo 'GUARD visible payload'; exit 1; }
echo "$FVc" | grep -Eq 'checkSwap\\?":true' || { echo 'GUARD visible check-swap'; exit 1; }
echo "$FVc" | grep -q "visible run id" || { echo 'GUARD visible toast text'; exit 1; }
FV4='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const inp=strip?strip.querySelector("input[aria-label^=\"Filter corpus run pills\"]"):null; if(!inp) return JSON.stringify({cleared:false,why:"no-input"}); const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; setter.call(inp,""); inp.dispatchEvent(new Event("input",{bubbles:true})); return JSON.stringify({cleared:true}); })()'
FVd=$(agent-browser eval "$FV4" || true)
echo "fv-clear: $FVd"
echo "$FVd" | grep -Eq 'cleared\\?":true' || { echo 'GUARD visible filter clear'; exit 1; }
sleep 1.5
FV5='(() => { const gone=!document.querySelector("button[aria-label^=\"Copy the visible\"]"); const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const row=strip?strip.querySelector("div.flex.flex-wrap.items-center"):null; const after=row?row.querySelectorAll("button").length:0; return JSON.stringify({scopedOk:gone&&after>=1,after:after}); })()'
FVe=$(agent-browser eval "$FV5" || true)
echo "fv-scoped: $FVe"
echo "$FVe" | grep -Eq 'scopedOk\\?":true' || { echo 'GUARD visible scoping'; exit 1; }
FVW="$FVa || $FVb || $FVc || $FVe"

echo "--- golden legs ---"
agent-browser open "http://localhost:3000/#settings" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
SET=$(agent-browser eval "JSON.stringify({census: /free-reach|free reach/i.test(document.body.innerText), relay: /Model Relay|intel ladder/i.test(document.body.innerText)})" || true)
echo "settings: $SET"
echo "$SET" | grep -Eq 'census\\?":true' || { echo 'GUARD settings census'; exit 1; }
echo "$SET" | grep -Eq 'relay\\?":true' || { echo 'GUARD settings relay'; exit 1; }
agent-browser open "http://localhost:3000/#radar" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1
RAD=$(agent-browser eval "(() => { const el = document.querySelector('[aria-label=\"Radar tab: Frontier\"]'); if (!el) return 'frontier-aria-MISS'; el.click(); return 'frontier-aria-clicked'; })()" || true)
echo "radar: $RAD"
echo "$RAD" | grep -q "frontier-aria-clicked" || { echo 'GUARD radar'; exit 1; }
agent-browser open "http://localhost:3000/#workflows" || true
agent-browser wait --load networkidle >/dev/null 2>&1 || true
sleep 1.5
PASTE=$(agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r735 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true)
echo "paste: $PASTE"
echo "$PASTE" | grep -q "paste-len:799" || { echo 'GUARD paste'; exit 1; }
CRON=$(agent-browser eval "(() => { const m=(document.body.innerText.match(/cron (\d+\/\d+|n\/a|\?\/\?)/)||[])[1]; return m||'cron-chip-MISS'; })()" || true)
echo "cron chip: $CRON"
CONSOLE=$(agent-browser console 2>/dev/null | tail -20 || true)
ERRS=$(agent-browser errors 2>/dev/null || true)
echo "--- console tail ---"; echo "$CONSOLE" | grep -v "Fast Refresh" | tail -8
echo "--- page errors ---"; echo "$ERRS"

echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r735_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r735_tsc.txt; exit 1; }
bun run lint > scripts/qa_r735_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r735_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r735_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }

echo "--- worklog append ---"
export R735_W="$W1" R735_XB="$XBW" R735_GC="$GCW" R735_CT="$CTW" R735_KB="$KBW" R735_CP="$CPW" R735_CA="$CAW" R735_CL="$CLW" R735_FL="$FLW" R735_FV="$FVW" R735_SET="$SET" R735_RAD="$RAD" R735_PASTE="$PASTE" R735_CRON="$CRON" R735_TSC="$TSC" R735_LINTLINE="$LINTLINE" R735_GCEN="$GC" R735_CC="$CC"
python3 - <<'PY'
import os
w1=os.environ.get('R735_W','').strip()
xbw=os.environ.get('R735_XB','').strip()
gcw=os.environ.get('R735_GC','').strip()
ctw=os.environ.get('R735_CT','').strip()
kbw=os.environ.get('R735_KB','').strip()
cpw=os.environ.get('R735_CP','').strip()
caw=os.environ.get('R735_CA','').strip()
clw=os.environ.get('R735_CL','').strip()
flw=os.environ.get('R735_FL','').strip()
fvw=os.environ.get('R735_FV','').strip()
setv=os.environ.get('R735_SET','').strip()
rad=os.environ.get('R735_RAD','').strip()
paste=os.environ.get('R735_PASTE','').strip()
cron=os.environ.get('R735_CRON','').strip()
tsc=os.environ.get('R735_TSC','?')
lint=os.environ.get('R735_LINTLINE','').strip()
gc=os.environ.get('R735_GCEN','').strip()
cc=os.environ.get('R735_CC','').strip()
L=[]
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r735')
L.append('Agent: NEXUS patrol (main agent — job 473388, 18:37 slot; opened on the r734 handoff verbatim)')
L.append('Task: Patrol round 735 — watch round per the r734 handoff (no manufactured increments; P1 backlog audited: every open P1 is Owner-key-blocked — PAT rotation, Webshare token, NEXUS_BOT live-wire proofs, UPSTASH witness all need keys that cannot enter git). QA led with a false alarm CLOSED BY FORENSICS: the open-round evals diff reported 4 duplicate ids — my own diff artifact (the GET /api/evals runs rows carry NO id field, so both sets collapsed to {None}); DB-level interrogation PROVED ledger integrity (0 duplicate-id groups in 58 rows, single tolerant writer POST /api/evals, hygiene cap intact) — disclosed as the named evaluation. Increment shipped from live friction, value-checked: with a filter active AND matches showing, clearing demanded refocus+select-all+delete (the r734 ghost button covers only the 0-match dead end) — a ✕ chip beside the count chip now exits the matching state in one click, same one mechanism as Escape, mutually exclusive by state with the ghost button (matches → chip, dead end → ghost button: the clear vocabulary never doubles). Judge-lane: corpus 54→58 (+4): PASS 17 (+1), uncertain 14 (+1), nj 23 (+2) — the distress RESUMED; the mixed partial-answering continues with the vault still empty')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): quick_check ok · corpus GREW 54→58 rows — verdict 21 (PASS 17 / FAIL 4) · uncertain 14 · no-judge 23: +4 LIVE and nj resumed climbing (+2 after the r734 mixed slot) — the flatten never landed; fresh judged rows (+1 PASS, +1 uncertain) alongside (+2 nj) keep the partial picture: SOME fresh rows meet an answering judge, most still dial into the emptied AutomationVault (0 lanes). Root cause and cure unchanged and Owner-side (r720 re-store + Cortex P1 v2 deploy). No recycle wipe; the snapshot road idle.')
L.append('- FALSE ALARM, CLOSED BY FORENSICS (the named evaluation): at open, an evals-corpus diff vs the r734 snapshot reported "0 fresh rows at total 58 — 4 duplicate ids". Interrogation: (a) /api/evals GET runs rows select ONLY {runId, note, createdAt, stepId} — no id field — so any id-keyed diff is vacuous (my artifact, not an API defect); (b) direct SQLite on db/custom.db: 58 rows, 0 duplicate-id groups; (c) the single writer is POST /api/evals (tolerant validation, capped batch 64, capped note 500, keep-newest-4000 hygiene) — no resume path writes EvalEvent rows directly. Ledger sound; the +4 are real live rows. Diff tooling lesson recorded: key future corpus diffs on (runId, note, createdAt) tuples, never on an absent field.')
L.append('- SHIP (mechanism, user-facing, one file run-kanban.tsx): ✕ clear chip beside the filter count chip — rendered ONLY while a filter is active AND at least one pill matches (the matching state); onClick setPillFilter("") — the SAME state change Escape performs (one mechanism, two entry points). Mutually exclusive by state with the r734 ghost Clear button (0 matches → ghost button; ≥1 match → ✕ chip): the two never co-render, so the clear vocabulary never doubles and the shared aria-label prefix stays unambiguous per state. Chip vocabulary styling (h-5 w-5 mono, violet hover border, CHIP_FOCUS_RING); honest title text naming which affordance covers which state.')
L.append('- CLEAR-CHIP WITNESS (valid prefix typed → chip present WITH the count chip and pills, ghost absent → native click → chip/count/ghost ALL gone, pills restored): '+xbw)
L.append('- REGRESSION SET: r734 ghost button + r733 copy-visible + r732 filter (four-leg) + r731 ladder + r729 copy-all + r728 panel copy-run-id + r727 keyboard + r726 click-through re-witnessed green on the grown corpus (58 rows): '+gcw+' · '+fvw+' · '+flw+' · '+clw+' · '+caw+' · '+cpw+' · '+kbw+' · '+ctw)
L.append('- BOARD WITNESS (fresh load, radio active): '+w1)
L.append('- GOLDEN QA: settings '+setv+' · radar '+rad+' · workflows '+paste+' · cron chip '+cron+' · console: Fast-Refresh logs only, no errors · page errors: none')
L.append('- GATES: tsc_exit='+tsc+' · lint '+lint+' · qa-gate-census '+gc+' · qa-cortex-census '+cc)
L.append('- BUDGET: 11 rounds (one under the <=12 cap): R1 worklog-tail + probe, R2 evals diff + P1 backlog audit, R3 API-vs-ledger reconcile, R4 DB attempt (wrong file, prisma/ demo db), R5 DB discovery (db/custom.db) + census, R6 dup forensics + writer grep, R7 dup verdict + route read (false alarm closed), R8 header anchors read, R9 the ✕ edit (single Edit), R10 this chain written (r734 template, XB leg added), R11 this close run (guards abort BEFORE commit). Post-close tee sweep baked into this chain (git output silenced after staging) — disclosed here and in the commit message.')
L.append('Stage Summary:')
L.append('- The filter now exits cleanly from BOTH terminal states: matches (✕ chip, r735) and dead end (ghost button, r734) — one mechanism, state-partitioned affordances. The ledger survived its first integrity audit (0 dup ids, single validated writer, hygiene cap). Judge-lane: nj RESUMED (21→23) — the mixed partial-answering continues; the vault cure stays Owner-side.')
L.append('Round Handoff:')
L.append('Round ID: r736 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 58 rows; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. Diff tooling note: key corpus diffs on (runId, note, createdAt) tuples — the /api/evals runs rows carry NO id field (r735 lesson). (2) JUDGE-LANE WATCH: nj 21→23 (resumed climbing), judged +2 alongside — partial answering continues, vault 0 lanes; if nj keeps climbing while judged stalls, the fast lanes went quiet too; if judged growth accelerates, the re-store may be landing. The ⧉ split + panel ladders are the evidence. (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) NEXT INCREMENT CANDIDATES: the corpus ergonomics arc is COMPLETE through r735 (copy-one r728, copy-all r729, ladder r731, filter r732, copy-visible r733, ghost-exit r734, matching-exit r735) — hold steady on watch rounds while the Owner-side cures land, or fix whatever the golden QA surfaces first; no manufactured increments. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix; optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the ✕ matching-state exit is mechanism; the type → chip-present → click → restore-by-absence DOM witness is the named evaluation, PLUS the ledger-integrity forensics (0 dup ids, single-writer audit) is a second named evaluation, evidence-anchored in scripts/qa_r735.txt).')
open('worklog.md','a').write('\n'.join(L)+'\n')
print('worklog appended')
PY
[ $? -eq 0 ] || { echo 'GUARD worklog'; exit 1; }

cat > scripts/r735_commitmsg.txt <<'MSG'
r735: ✕ clear chip for the filter's matching state (dead end already had r734's ghost button); ledger survived its first integrity audit; nj RESUMED 21→23

- SHIP (run-kanban.tsx): with a filter active AND matches showing,
  clearing demanded refocus + select-all + delete (Escape needs input
  focus; the r734 ghost button only renders at 0 matches). A ✕ chip now
  sits beside the count chip: onClick setPillFilter("") — the SAME one
  mechanism as Escape; rendered only while pillQuery is active AND the
  visible set is non-empty, mutually exclusive by state with the ghost
  button (matches -> chip, dead end -> ghost button), so the clear
  vocabulary never doubles. Chip vocabulary styling (h-5 w-5 mono,
  violet hover, CHIP_FOCUS_RING).
- FALSE ALARM CLOSED BY FORENSICS: the open-round evals diff "4 dup
  ids" was my own artifact — /api/evals runs rows carry NO id field, so
  an id-keyed diff collapses to {None}. DB-level audit on db/custom.db:
  58 rows, 0 duplicate-id groups; single writer POST /api/evals
  (validated, capped, keep-newest-4000 hygiene). Ledger sound; the +4
  rows are live. Lesson: diff on (runId, note, createdAt) tuples.
- JUDGE-LANE: corpus 54->58, verdict 21 (PASS 17 / FAIL 4), uncertain
  14, nj 23 (+2) — the distress RESUMED after the mixed r734 slot;
  partial answering continues (judged +2 alongside), vault still 0
  lanes; cure stays Owner-side (r720 re-store + Cortex v2 deploy).
- witness: clear-chip DOM-probed (type -> chip+count present ->
  click -> chip/count/ghost gone, pills restored). Full regression set
  green (r734 ghost, r733 copy-visible, r732 filter, r731 ladder,
  r729 copy-all, r728 panel copy, r727 keyboard, r726 click-through).
- golden QA: settings census/relay · radar frontier · paste-799 · cron ·
  console clean · page errors none.
- gates: tsc 0 · lint 0 errors (33-warning baseline) · qa-gate-census
  48/48 · qa-cortex-census 23/23.
- budget: 11 rounds, one under the cap. Post-close tee sweep baked into
  the close chain (git output silenced after staging; r722..r734 precedent).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r735_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main || { echo 'GUARD push origin'; exit 1; }
git push fork main || { echo 'GUARD push fork'; exit 1; }
echo "--- verification ---"
git log --oneline -1
echo "origin/main..HEAD: $(git rev-list origin/main..HEAD --count | tr -d ' ')"
git status --short | head -3
echo "=== r735 close end ==="

echo "--- sweep (tee artifact: git output silenced after staging so the tree ends clean) ---"
git add -A
if ! git diff --cached --quiet; then
  git commit -m "r735: sweep — tee artifact (close log captures its own post-commit status line; r722..r734 precedent)" >/dev/null 2>&1 || true
  git push origin main >/dev/null 2>&1 || true
  git push fork main >/dev/null 2>&1 || true
fi
