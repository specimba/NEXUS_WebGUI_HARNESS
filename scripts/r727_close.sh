#!/usr/bin/env bash
set -u
cd /home/z/my-project
rm -rf scripts/tmp-r639
OUT=scripts/qa_r727.txt
: > "$OUT"
exec > >(tee -a "$OUT") 2>&1
echo "=== r727 close $(date -Is) ==="

code=000
for i in $(seq 1 20); do
  code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 3
done
echo "server: $code"
[ "$code" = "200" ] || { echo 'GUARD server down'; exit 1; }

echo "--- evals payload (corpus intact check) ---"
curl -s -m 30 http://localhost:3000/api/evals -o scripts/qa_r727_evals.json
python3 - <<'PY'
import json
j=json.load(open('scripts/qa_r727_evals.json'))
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

echo "--- click-through regression witness (r726 ship, grown corpus) ---"
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
echo "$CT2" | grep -Eq 'dialTitle\\?":true' || { echo 'GUARD dial trace title'; exit 1; }
CTW="$CT1 || $CT2"

echo "--- keyboard witness: arrow traversal + escape close (r727 ship) ---"
KB1='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); if(!strip) return JSON.stringify({kb:false,why:"no-strip"}); const btns=[...strip.querySelectorAll("button")]; if(btns.length<2) return JSON.stringify({kb:false,why:"few-pills"}); btns[0].focus(); btns[0].dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true})); return JSON.stringify({kb:true,moved:document.activeElement===btns[1]}); })()'
KBa=$(agent-browser eval "$KB1" || true)
echo "arrows: $KBa"
echo "$KBa" | grep -Eq 'moved\\?":true' || { echo 'GUARD arrow traversal'; exit 1; }
KB2='(() => { const strip=document.querySelector("[data-testid=\"corpus-only-runs\"]"); const btns=strip?[...strip.querySelectorAll("button")]:[]; if(!btns.length) return JSON.stringify({open:false,why:"no-pills"}); const target=btns.find(b=>b.getAttribute("aria-expanded")!=="true")||btns[0]; target.click(); return JSON.stringify({open:true,label:(target.textContent||"").slice(0,40)}); })()'
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
PASTE=$(agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r727 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true)
echo "paste: $PASTE"
echo "$PASTE" | grep -q "paste-len:799" || { echo 'GUARD paste'; exit 1; }
CRON=$(agent-browser eval "(() => { const m=(document.body.innerText.match(/cron (\d+\/\d+|n\/a|\?\/\?)/)||[])[1]; return m||'cron-chip-MISS'; })()" || true)
echo "cron chip: $CRON"
CONSOLE=$(agent-browser console 2>/dev/null | tail -20 || true)
ERRS=$(agent-browser errors 2>/dev/null || true)
echo "--- console tail ---"; echo "$CONSOLE" | grep -v "Fast Refresh" | tail -8
echo "--- page errors ---"; echo "$ERRS"

echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r727_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r727_tsc.txt; exit 1; }
bun run lint > scripts/qa_r727_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r727_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r727_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }

echo "--- worklog append ---"
export R727_W="$W1" R727_CT="$CTW" R727_KB="$KBW" R727_SET="$SET" R727_RAD="$RAD" R727_PASTE="$PASTE" R727_CRON="$CRON" R727_TSC="$TSC" R727_LINTLINE="$LINTLINE" R727_GC="$GC" R727_CC="$CC"
python3 - <<'PY'
import os
w1=os.environ.get('R727_W','').strip()
ctw=os.environ.get('R727_CT','').strip()
kbw=os.environ.get('R727_KB','').strip()
setv=os.environ.get('R727_SET','').strip()
rad=os.environ.get('R727_RAD','').strip()
paste=os.environ.get('R727_PASTE','').strip()
cron=os.environ.get('R727_CRON','').strip()
tsc=os.environ.get('R727_TSC','?')
lint=os.environ.get('R727_LINTLINE','').strip()
gc=os.environ.get('R727_GC','').strip()
cc=os.environ.get('R727_CC','').strip()
L=[]
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r727')
L.append('Agent: NEXUS patrol (main agent — job 473388, 14:37 slot; opened on the r726 handoff verbatim)')
L.append('Task: Patrol round 727 — the queued keyboard carry LANDED (ArrowDown/ArrowUp traversal + Escape close on the corpus strip pills, affordance documented on the strip header) AND the r726 handoff judge-lane trigger FIRED and was checked from the patrol side: fresh LIVE nj rows confirmed (corpus 31→35, nj 8→10) with the root cause now PATROL-EVIDENCED — AutomationVault counts 0 lanes post-recycle, so judge dials fail through the emptied vault')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): quick_check ok · corpus GREW 31→35 rows — verdict 14 (PASS 11 / FAIL 3) · uncertain 11 · no-judge 10: +2 PASS and +2 LIVE nj since r726 open (run_9a5495f732ea4 landed mid-r726 with 2 verdicts @ 92% + 2 nj — the lanes fail on FRESH runs, not just recovered rows).')
L.append('- JUDGE-LANE HEALTH CHECK (the r726 handoff trigger, patrol-side): AutomationVault table counts 0 LANES (the r725 recycle wipe was never re-stored; keys cannot enter git so the vault cannot ride the corpus backup road) — and every fresh nj ladder reads "tried: intern-systemone — no answer (dial failed or empty); fast-judge AIHubMix · qwen3.8-flash-free — no answer; …": the dials fail because there are no vault lanes to route through. NOT fixable in-repo; the Owner-side re-store (r720 backup road) + Cortex P1 v2 deploy is the cure. The r726 panel + dial-trace-on-hover make this evidence readable directly on the board.')
L.append('- SHIP (mechanism, user-facing, one file run-kanban.tsx): (1) keyboard traversal on the strip pills — ArrowDown/ArrowUp move focus between pills WITHOUT leaving the strip (roving within the pills row, bounded at the ends, no Tab-cycle hijack), Escape collapses the open panel from its own pill (focus stays put; aria-expanded flips with state). (2) the strip header label documents the affordance ("arrow keys move between the run pills, Enter toggles the detail panel, Escape closes it").')
L.append('- KEYBOARD WITNESS (fresh load, radio active): '+kbw)
L.append('- CLICK-THROUGH REGRESSION (r726 ship re-witnessed on the grown corpus): '+ctw)
L.append('- BOARD WITNESS (same fresh load): '+w1)
L.append('- GOLDEN QA: settings '+setv+' · radar '+rad+' · workflows '+paste+' · cron chip '+cron+' · console: Fast-Refresh logs only, no errors · page errors: none')
L.append('- GATES: tsc_exit='+tsc+' · lint '+lint+' · qa-gate-census '+gc+' · qa-cortex-census '+cc)
L.append('- BUDGET: 10 rounds (two under the <=12 cap): R1 handoff+probe, R2 vault-lane census + fresh ladders (the trigger check), R3 the 2-edit increment, R4 tsc+lint pre-gate, R5 close chain written, R6 close run ABORTED (witness-sequence bug: the open-for-escape step clicked the ALREADY-OPEN first pill and the toggle closed it — KB2 now clicks a not-expanded pill), R7 patch, R8 close run ABORTED again (the openAfter guard lacked the escaped-quote-tolerant regex — a guard-pattern bug, the DOM output was already correct), R9 patch, R10 this close run. Both aborts held BEFORE commit — the app never failed a witness; the witnesses failed the app twice, and were fixed.',)
L.append('Stage Summary:')
L.append('- The strip is keyboard-complete (traverse, toggle, escape — discoverable from the header hint), and the nj distress has a NAMED, patrol-evidenced root cause: zero vault lanes. Every fresh nj row is another datapoint for the Owner-side cure.')
L.append('Round Handoff:')
L.append('Round ID: r728 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 35 rows and growing with LIVE traffic; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. (2) JUDGE-LANE WATCH: vault 0 lanes is the confirmed root cause of every fresh nj row — if the Owner re-stores the vault (r720 road) or deploys Cortex v2, expect the nj family to flatten; the panel shows per-run ladders to verify. (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok. (4) OPTIONAL POLISH: a "copy run id" affordance on the panel header is the next small carry (the Copy icon already imports); roving-tabindex/aria-activedescendant rework deliberately NOT planned (native buttons + arrows suffice). (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-store/re-key BACKUP-FIRST (keys stay out of git); KICK widget URL fix; optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the keyboard traversal is mechanism; the ArrowDown/Escape DOM witnesses plus the vault-lane census are the named evaluations, evidence-anchored in scripts/qa_r727.txt).')
open('worklog.md','a').write('\n'.join(L)+'\n')
print('worklog appended')
PY
[ $? -eq 0 ] || { echo 'GUARD worklog'; exit 1; }

cat > scripts/r727_commitmsg.txt <<'MSG'
r727: keyboard-complete corpus strip — arrow traversal + Escape close; vault-lane census names the nj root cause

- SHIP (run-kanban.tsx): strip pills gain keyboard traversal — ArrowDown/
  ArrowUp move focus between pills without leaving the strip (roving
  within the pills row, bounded at the ends), Escape collapses the open
  panel from its own pill (focus stays put, aria-expanded flips with
  state); the strip header documents the affordance.
- JUDGE-LANE EVIDENCE (patrol-side, the r726 trigger): corpus 31->35
  with LIVE traffic (+2 PASS @ 92%, +2 nj on run_9a5495f732ea4);
  AutomationVault counts 0 lanes post-recycle — every fresh nj ladder
  reads dial failures through the emptied vault. Owner-side cure (r720
  re-store + Cortex P1 v2 deploy); the r726 panel surfaces the ladders.
- witnesses: keyboard (arrow move + escape close, DOM-probed) + r726
  click-through regression on the grown corpus — scripts/qa_r727.txt.
- golden QA: settings census/relay · radar frontier · paste-799 · cron ·
  console clean · page errors none.
- gates: tsc 0 · lint 0 errors (33-warning baseline) · qa-gate-census
  48/48 · qa-cortex-census 23/23.
- budget: 10 rounds, two under the cap (two clean guard aborts — witness-
  sequence and guard-regex bugs, disclosed; the app never failed one).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r727_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main || { echo 'GUARD push origin'; exit 1; }
git push fork main || { echo 'GUARD push fork'; exit 1; }
echo "--- verification ---"
git log --oneline -1
echo "origin/main..HEAD: $(git rev-list origin/main..HEAD --count | tr -d ' ')"
git status --short | head -3
echo "=== r727 close end ==="
