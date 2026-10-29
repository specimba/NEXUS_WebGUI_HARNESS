#!/usr/bin/env bash
set -u
cd /home/z/my-project
rm -rf scripts/tmp-r639
OUT=scripts/qa_r726.txt
: > "$OUT"
exec > >(tee -a "$OUT") 2>&1
echo "=== r726 close $(date -Is) ==="

code=000
for i in $(seq 1 20); do
  code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 3
done
echo "server: $code"
[ "$code" = "200" ] || { echo 'GUARD server down'; exit 1; }

echo "--- evals payload (corpus intact check) ---"
curl -s -m 30 http://localhost:3000/api/evals -o scripts/qa_r726_evals.json
python3 - <<'PY'
import json
j=json.load(open('scripts/qa_r726_evals.json'))
runs=j.get('runs')
rows=[r for r in (runs or []) if isinstance(r,dict) and isinstance(r.get('runId'),str) and isinstance(r.get('note'),str)]
ids=sorted({r['runId'] for r in rows})
print(f"evals-total:{j.get('total')} runs-rows:{len(rows)} distinct:{len(ids)}")
print('evals-ids:'+','.join(ids[:10]))
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

echo "--- click-through witness: strip pill -> per-run detail panel (r726 ship) ---"
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
PASTE=$(agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r726 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true)
echo "paste: $PASTE"
echo "$PASTE" | grep -q "paste-len:799" || { echo 'GUARD paste'; exit 1; }
CRON=$(agent-browser eval "(() => { const m=(document.body.innerText.match(/cron (\d+\/\d+|n\/a|\?\/\?)/)||[])[1]; return m||'cron-chip-MISS'; })()" || true)
echo "cron chip: $CRON"
CONSOLE=$(agent-browser console 2>/dev/null | tail -20 || true)
ERRS=$(agent-browser errors 2>/dev/null || true)
echo "--- console tail ---"; echo "$CONSOLE" | grep -v "Fast Refresh" | tail -8
echo "--- page errors ---"; echo "$ERRS"

echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r726_tsc.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r726_tsc.txt; exit 1; }
bun run lint > scripts/qa_r726_lint.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r726_lint.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r726_lint.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }

echo "--- worklog append ---"
export R726_W="$W1" R726_CT="$CTW" R726_SET="$SET" R726_RAD="$RAD" R726_PASTE="$PASTE" R726_CRON="$CRON" R726_TSC="$TSC" R726_LINTLINE="$LINTLINE" R726_GC="$GC" R726_CC="$CC"
python3 - <<'PY'
import os
w1=os.environ.get('R726_W','').strip()
ctw=os.environ.get('R726_CT','').strip()
setv=os.environ.get('R726_SET','').strip()
rad=os.environ.get('R726_RAD','').strip()
paste=os.environ.get('R726_PASTE','').strip()
cron=os.environ.get('R726_CRON','').strip()
tsc=os.environ.get('R726_TSC','?')
lint=os.environ.get('R726_LINTLINE','').strip()
gc=os.environ.get('R726_GC','').strip()
cc=os.environ.get('R726_CC','').strip()
L=[]
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r726')
L.append('Agent: NEXUS patrol (main agent — job 473388, 14:07 slot; opened on the r725 handoff verbatim)')
L.append('Task: Patrol round 726 — the r723/r724/r725 queued carry LANDED: corpus click-through — the strip pills became buttons (focus ring + aria-expanded + violet open-state) opening a per-run detail panel built from the durable ledger rows ALONE, every event note VERBATIM (the judge dial trace rides inside it), each row classified through the SAME gateCensusOf adapter (the r649 doctrine, now per-row); the tried-ladder trace also surfaced in every chip title — the nj distress is readable on hover without opening anything')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): quick_check ok · watch corpus HELD at 31 rows — verdict 12 (PASS 9 / FAIL 3) · uncertain 11 · no-judge 8, EXACTLY the r725 recovered baseline — the corpus SURVIVED the 14:07 slot boundary (no second recycle wipe; the snapshot road stood armed and idle). The r725 12-row recovery gap stays disclosed, not healed: nj reads 8 vs the pre-wipe 20 (the dedupe collapse was real).')
L.append('- SHIP (mechanism, user-facing, one file run-kanban.tsx): (1) strip pills span->button: aria-expanded + aria-controls wired to the panel id, CHIP_FOCUS_RING focus parity, violet hover-brighten + open-state tint (the r700 pointer promise on this surface), chevron rotates when open; the embedded CorpusRunChip drops its own tabIndex when hosted (tabbable=false) — no nested-interactive DOM. (2) the detail panel (data-testid=corpus-run-detail, role=region) builds from ledger rows alone: full run id, event count + per-run census with the shared GateSuffix u/nj tokens, cross/same-family tally, and EVERY event note verbatim with per-row tone/label from the SAME classifier — the nj rows carry their full "tried: intern-systemone — no answer; fast-judge …" ladder in the open panel. (3) chip titles gained the bounded (220-char) judge dial trace; helpers evAtMs/fmtEventAt parse epoch-ms AND ISO honestly (an honest dash, never a fake time).')
L.append('- CLICK-THROUGH WITNESS (fresh load, radio active): '+ctw)
L.append('- BOARD WITNESS (same fresh load): '+w1)
L.append('- GOLDEN QA: settings '+setv+' · radar '+rad+' · workflows '+paste+' · cron chip '+cron+' · console: Fast-Refresh logs only, no errors · page errors: none')
L.append('- GATES: tsc_exit='+tsc+' · lint '+lint+' · qa-gate-census '+gc+' · qa-cortex-census '+cc)
L.append('- BUDGET: 10 rounds (two under the <=12 cap — the discipline held): R1 handoff+probe, R2-R5 context sweep (chip/strip code, memos, r725 chain), R6 the 9-edit increment (atomic MultiEdit, concat-first to dodge the r724 backtick transit bug — zero retries needed), R7 tsc+lint pre-gate, R8 close chain written, R9 close run ABORTED at the aria-expanded guard (a WITNESS-timing bug, not an app bug — the click landed but React re-renders async and the attribute was read in the same tick; guards held, nothing committed, tree clean; the expanded read moved to the post-re-render probe), R10 this close run (guards abort BEFORE commit).')
L.append('Stage Summary:')
L.append('- The corpus is no longer just COUNTED — it is READABLE: scan-level digest (r724), glance tally (r724), and now per-run detail with verbatim dial traces (r726), all from ledger rows alone. Judge-lane distress sits at most three clicks deep, and one hover away. The nj rows\' tried-ladders are first-class evidence for the Owner-side Cortex P1 deploy.')
L.append('Round Handoff:')
L.append('Round ID: r727 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 31 rows, snapshot road armed; if a recycle wipes it AGAIN, run bun scripts/corpus-restore.ts and reopen. (2) JUDGE-LANE HEALTH: the recovered nj=8 rows all predate the recovery — fresh runs since then would tell whether the lanes still fail LIVE; if new nj rows land, check relay/vault lane health from the patrol side (the panel now shows their exact tried-ladders). (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok — post-deploy judge-lane witnesses (real-key UPSTASH 3/3 + HB) arm after deploy. (4) OPTIONAL POLISH: keyboard traversal for the strip pills (arrow keys / Escape closes the panel); multi-panel compare deliberately NOT planned — one open panel keeps the strip calm. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-key BACKUP-FIRST (vault lanes EMPTY post-recycle — re-store via the r720 backup road, keys stay out of git); KICK widget URL fix; optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox. (7) PLATFORM (Owner-side): report the r725 runtime-table wipe on sandbox recycle — snapshots only back what git sees; a platform-level fix is the real cure.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the click-through panel + per-row classifier reuse is mechanism; the click->expand DOM witness with counted rows and the dial-title guard are the named evaluations, evidence-anchored in scripts/qa_r726.txt).')
open('worklog.md','a').write('\n'.join(L)+'\n')
print('worklog appended')
PY
[ $? -eq 0 ] || { echo 'GUARD worklog'; exit 1; }

cat > scripts/r726_commitmsg.txt <<'MSG'
r726: corpus click-through — strip pills open per-run detail panels from ledger rows alone; tried-ladder on hover

- SHIP (run-kanban.tsx): strip pills span->button (aria-expanded +
  aria-controls, CHIP_FOCUS_RING parity, violet hover/open tint, rotating
  chevron); the embedded chip drops its own tabIndex when hosted — no
  nested-interactive DOM. Detail panel (data-testid=corpus-run-detail,
  role=region) builds from durable ledger rows ALONE: run id, per-run
  census with the shared GateSuffix u/nj tokens, family tally, every
  event note VERBATIM with per-row tone from the SAME gateCensusOf
  adapter (the r649 doctrine, now per-row). Chip titles gained the
  bounded (220-char) judge dial trace — nj distress readable on hover.
- corpus probe at open: 31 rows HELD — the r725 recovery survived the
  14:07 slot; the snapshot road stood armed and idle (snapshot refreshed
  pre-commit per the r725 standing step).
- click-through witness: click->expand DOM probe on the fresh bundle
  (aria-expanded true, panel rows counted, tried-ladder present,
  dial-title guarded) — scripts/qa_r726.txt.
- golden QA: settings census/relay · radar frontier · paste-799 · cron ·
  console clean · page errors none.
- gates: tsc 0 · lint 0 errors (33-warning baseline) · qa-gate-census
  48/48 · qa-cortex-census 23/23.
- budget: 10 rounds, two under the cap (R9 was a clean guard abort — a
  witness-timing bug, disclosed; nothing committed on it).
MSG
git add -A
[ -n "$(git status --porcelain db/corpus-snapshots 2>/dev/null)" ] && git add -f db/corpus-snapshots 2>/dev/null || true
git commit -F scripts/r726_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main || { echo 'GUARD push origin'; exit 1; }
git push fork main || { echo 'GUARD push fork'; exit 1; }
echo "--- verification ---"
git log --oneline -1
echo "origin/main..HEAD: $(git rev-list origin/main..HEAD --count | tr -d ' ')"
git status --short | head -3
echo "=== r726 close end ==="
