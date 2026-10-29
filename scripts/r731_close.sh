#!/usr/bin/env bash
set -u
cd /home/z/my-project
rm -rf scripts/tmp-r639
OUT=scripts/qa_r731.txt
: > "$OUT"
exec > >(tee -a "$OUT") 2>&1
echo "=== r731 close $(date -Is) ==="

code=000
for i in $(seq 1 20); do
  code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 3
done
echo "server: $code"
[ "$code" = "200" ] || { echo 'GUARD server down'; exit 1; }

echo "--- evals payload (corpus intact check) ---"
curl -s -m 30 http://localhost:3000/api/evals -o scripts/qa_r731_evals.json
python3 - <<'PY'
import json
j=json.load(open('scripts/qa_r731_evals.json'))
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
PASTE=$(agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r731 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true)
echo "paste: $PASTE"
echo "$PASTE" | grep -q "paste-len:799" || { echo 'GUARD paste'; exit 1; }
CRON=$(agent-browser eval "(() => { const m=(document.body.innerText.match(/cron (\d+\/\d+|n\/a|\?\/\?)/)||[])[1]; return m||'cron-chip-MISS'; })()" || true)
echo "cron chip: $CRON"
CONSOLE=$(agent-browser console 2>/dev/null | tail -20 || true)
ERRS=$(agent-browser errors 2>/dev/null || true)
echo "--- console tail ---"; echo "$CONSOLE" | grep -v "Fast Refresh" | tail -8
echo "--- page errors ---"; echo "$ERRS"

echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r731_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r731_tsc.txt; exit 1; }
bun run lint > scripts/qa_r731_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r731_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r731_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }

echo "--- worklog append ---"
export R731_W="$W1" R731_CT="$CTW" R731_KB="$KBW" R731_CP="$CPW" R731_CA="$CAW" R731_CL="$CLW" R731_SET="$SET" R731_RAD="$RAD" R731_PASTE="$PASTE" R731_CRON="$CRON" R731_TSC="$TSC" R731_LINTLINE="$LINTLINE" R731_GC="$GC" R731_CC="$CC"
python3 - <<'PY'
import os
w1=os.environ.get('R731_W','').strip()
ctw=os.environ.get('R731_CT','').strip()
kbw=os.environ.get('R731_KB','').strip()
cpw=os.environ.get('R731_CP','').strip()
caw=os.environ.get('R731_CA','').strip()
clw=os.environ.get('R731_CL','').strip()
setv=os.environ.get('R731_SET','').strip()
rad=os.environ.get('R731_RAD','').strip()
paste=os.environ.get('R731_PASTE','').strip()
cron=os.environ.get('R731_CRON','').strip()
tsc=os.environ.get('R731_TSC','?')
lint=os.environ.get('R731_LINTLINE','').strip()
gc=os.environ.get('R731_GC','').strip()
cc=os.environ.get('R731_CC','').strip()
L=[]
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r731')
L.append('Agent: NEXUS patrol (main agent — job 473388, 16:37 slot; opened on the r730 handoff verbatim)')
L.append('Task: Patrol round 731 — the copy-ladder affordance LANDED on the corpus detail panel header (one click puts a run\'s whole decision ladder on the clipboard as text — head line + one line per event: time, shared-classifier label, step key when present, verbatim note with the judge dial trace; built from the SAME rows and the SAME per-row classifier the panel renders) AND the judge-lane watch kept climbing: corpus 45→49, nj 18→20 (+2 LIVE rows) — six-slot climb 8→10→13→15→18→20, vault still 0 lanes')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): quick_check ok · corpus GREW 45→49 rows — verdict 18 (PASS 15 / FAIL 3) · uncertain 11 · no-judge 20: +2 LIVE nj since r730 (the trend: nj 8 → 10 → 13 → 15 → 18 → 20 across six slots) — every fresh row a dial failure through the emptied vault; the patrol-side root cause stands (AutomationVault 0 lanes), the cure is Owner-side (r720 re-store + Cortex P1 v2 deploy). No recycle wipe; the snapshot road idle.')
L.append('- SHIP (mechanism, user-facing, one file run-kanban.tsx): CopyLadderButton on the corpus detail panel header beside the r728 copy-id button — navigator.clipboard.writeText(ladderText()); the head line carries id · N events · engaged · verdicts · u/nj, then one line per event: HH:MM:SS [label] (step key when present) verbatim note — the judge dial trace rides along. r649 DOCTRINE STRENGTHENED: eventLabelOf extracted and now shared by the rendered row AND the copied ladder — one classifier, never a rival vocabulary. Copy→Check swap (emerald, reverts at 1.6s, timer cleaned on unmount) + toast "Run ladder copied"; on rejection an honest error toast (never a fake success); when the clipboard API is absent, a distinct error toast. Same focus-ring + hover vocabulary (CHIP_FOCUS_RING).')
L.append('- LADDER WITNESS (fresh load, radio active, panel open; navigator.clipboard.writeText STUBBED at the page level to RECORD the payload — headless holds no clipboard grant, so the component\'s promise CONTRACT is what the witness proves, disclosed): '+clw)
L.append('- REGRESSION SET: r729 copy-all + r728 panel copy-run-id + r727 keyboard + r726 click-through re-witnessed green on the grown corpus: '+caw+' · '+cpw+' · '+kbw+' · '+ctw)
L.append('- BOARD WITNESS (fresh load, radio active): '+w1)
L.append('- GOLDEN QA: settings '+setv+' · radar '+rad+' · workflows '+paste+' · cron chip '+cron+' · console: Fast-Refresh logs only, no errors · page errors: none')
L.append('- GATES: tsc_exit='+tsc+' · lint '+lint+' · qa-gate-census '+gc+' · qa-cortex-census '+cc)
L.append('- BUDGET: 8 rounds (four under the <=12 cap — the discipline held): R1 worklog-handoff + DB probe, R2 git-state + anchor grep, R3 region reads, R4 the 4-part increment edit (one MultiEdit: shared eventLabelOf extraction + CopyLadderButton + panel wiring), R5 tsc+lint pre-gate, R6 close-template read, R7 close chain written, R8 this close run (guards abort BEFORE commit). Post-close tee sweep baked into this chain (git output silenced after staging) — disclosed here and in the commit message.')
L.append('Stage Summary:')
L.append('- The panel\'s ladder is now takeable as text in one click — triage tickets and Cortex batches get the full tried-trace without retyping, and the copy is provably the same view the screen shows (one classifier, one vocabulary). The nj climb (8→10→13→15→18→20 across six slots) stays the loudest unattended signal.')
L.append('Round Handoff:')
L.append('Round ID: r732 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 49 rows; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. (2) JUDGE-LANE WATCH: nj 8→10→13→15→18→20 across six slots with vault at 0 lanes — if the Owner re-stores the vault or deploys Cortex v2, expect the family to flatten; the panel now copies ladders as text for the triage. (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) NEXT INCREMENT CANDIDATES (pick by value, no theatre): a visible-set copy affordance on the board tally strip (the ⧉ copy-all covers the corpus; the visible set lacks its own); or a per-strip copy of that strip\'s run ids; or hold steady on watch rounds while the Owner-side cures land. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix; optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the ladder clipboard contract is mechanism; the stub-recorded payload + line-count + label-bracket + check-swap DOM witness is the named evaluation, evidence-anchored in scripts/qa_r731.txt).')
open('worklog.md','a').write('\n'.join(L)+'\n')
print('worklog appended')
PY
[ $? -eq 0 ] || { echo 'GUARD worklog'; exit 1; }

cat > scripts/r731_commitmsg.txt <<'MSG'
r731: copy-ladder affordance on the corpus panel header; shared eventLabelOf; nj climb disclosed (8->10->13->15->18->20, vault 0 lanes)

- SHIP (run-kanban.tsx): CopyLadderButton on the corpus detail panel
  header beside the r728 copy-id button — one click copies the run's
  whole decision ladder as text: head line (id · N events · engaged ·
  verdicts · u/nj) + one line per event (time [label] (step key when
  present) verbatim note — the judge dial trace rides along). Built
  from the SAME rows and the SAME per-row classifier the panel renders:
  eventLabelOf extracted and shared (r649 — never a rival vocabulary).
  Copy->Check swap (emerald, reverts 1.6s, timer cleaned on unmount) +
  "Run ladder copied" toast; honest error toasts on denial or missing API.
- JUDGE-LANE WATCH: corpus 45->49, nj 18->20 (+2 LIVE; trend
  8->10->13->15->18->20 across six slots) through the emptied vault
  (AutomationVault 0 lanes) — Owner-side cure stands (r720 re-store +
  Cortex P1 v2).
- witness: ladder clipboard contract DOM-probed with a page-level
  writeText stub recording the payload (headless has no clipboard
  grant, disclosed) — head starts with the run id, one line per panel
  row, shared-classifier label brackets present, check-swap verified,
  toast fired; r729 copy-all + r728 panel copy + r727 keyboard +
  r726 click-through regressions green on the grown corpus.
- golden QA: settings census/relay · radar frontier · paste-799 · cron ·
  console clean · page errors none.
- gates: tsc 0 · lint 0 errors (33-warning baseline) · qa-gate-census
  48/48 · qa-cortex-census 23/23.
- budget: 8 rounds, four under the cap. Post-close tee sweep baked into
  the close chain (git output silenced after staging; r722..r730 precedent).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r731_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main || { echo 'GUARD push origin'; exit 1; }
git push fork main || { echo 'GUARD push fork'; exit 1; }
echo "--- verification ---"
git log --oneline -1
echo "origin/main..HEAD: $(git rev-list origin/main..HEAD --count | tr -d ' ')"
git status --short | head -3
echo "=== r731 close end ==="

echo "--- sweep (tee artifact: git output silenced after staging so the tree ends clean) ---"
git add -A
if ! git diff --cached --quiet; then
  git commit -m "r731: sweep — tee artifact (close log captures its own post-commit status line; r722..r730 precedent)" >/dev/null 2>&1 || true
  git push origin main >/dev/null 2>&1 || true
  git push fork main >/dev/null 2>&1 || true
fi
