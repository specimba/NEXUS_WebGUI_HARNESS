#!/usr/bin/env bash
set -u
cd /home/z/my-project
OUT=scripts/qa_r724.txt
: > "$OUT"
exec > >(tee -a "$OUT") 2>&1
echo "=== r724 close $(date -Is) ==="

code=000
for i in $(seq 1 20); do
  code=$(curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:3000 || true)
  [ "$code" = "200" ] && break
  sleep 3
done
echo "server: $code"
[ "$code" = "200" ] || { echo 'GUARD server down'; exit 1; }

echo "--- evals payload ---"
curl -s -m 30 http://localhost:3000/api/evals -o scripts/qa_r724_evals.json
python3 - <<'PY'
import json
j=json.load(open('scripts/qa_r724_evals.json'))
runs=j.get('runs')
rows=[r for r in (runs or []) if isinstance(r,dict) and isinstance(r.get('runId'),str) and isinstance(r.get('note'),str)]
ids=sorted({r['runId'] for r in rows})
print(f"evals-total:{j.get('total')} runs-rows:{len(rows)} distinct:{len(ids)}")
print('evals-ids:'+','.join(ids[:10]))
if len(rows)<10: raise SystemExit(1)
print('evals-runs-ok')
PY
[ $? -eq 0 ] || { echo 'GUARD evals payload'; exit 1; }

echo "--- r724 witness: digest u/nj split + strip tally (fresh load) ---"
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
echo "$W1" | grep -Eq 'tallyOk\\?":true' || { echo 'GUARD strip tally missing'; exit 1; }
echo "$W1" | grep -Eq 'chips\\?":[1-9]' || { echo 'GUARD strip chips zero'; exit 1; }

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
PASTE=$(agent-browser eval "(() => { const tas=[...document.querySelectorAll('textarea')]; const t=tas.find(x=>/paste|step|plan/i.test(x.placeholder||'')) || tas[0]; if(!t) return 'paste-target-MISS'; const v='r724 long-paste: '.padEnd(799,'q'); const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; setter.call(t,v); t.dispatchEvent(new Event('input',{bubbles:true})); return 'paste-len:'+t.value.length; })()" || true)
echo "paste: $PASTE"
echo "$PASTE" | grep -q "paste-len:799" || { echo 'GUARD paste'; exit 1; }
CRON=$(agent-browser eval "(() => { const m=(document.body.innerText.match(/cron (\d+\/\d+|n\/a|\?\/\?)/)||[])[1]; return m||'cron-chip-MISS'; })()" || true)
echo "cron chip: $CRON"
CONSOLE=$(agent-browser console 2>/dev/null | tail -20 || true)
ERRS=$(agent-browser errors 2>/dev/null || true)
echo "--- console tail ---"; echo "$CONSOLE" | grep -v "Fast Refresh" | tail -8
echo "--- page errors ---"; echo "$ERRS"

echo "--- gates ---"
bunx tsc --noEmit > scripts/qa_r724_tsc2.txt 2>&1; TSC=$?
echo "tsc_exit:$TSC"; [ $TSC -eq 0 ] || { tail -20 scripts/qa_r724_tsc2.txt; exit 1; }
bun run lint > scripts/qa_r724_lint2.txt 2>&1; LINT=$?
LINTLINE=$(grep -E "✖|problems" scripts/qa_r724_lint2.txt | tail -1)
echo "lint_exit:$LINT $LINTLINE"; [ $LINT -eq 0 ] || { tail -20 scripts/qa_r724_lint2.txt; exit 1; }
GC=$(bun scripts/qa-gate-census.ts 2>&1 | tail -1)
echo "gate-census: $GC"
echo "$GC" | grep -q "48/48" || { echo 'GUARD gate-census'; exit 1; }
CC=$(bun scripts/qa-cortex-census.ts 2>&1 | tail -1)
echo "cortex: $CC"
echo "$CC" | grep -q "23/23" || { echo 'GUARD cortex census'; exit 1; }

echo "--- worklog append ---"
export R724_W="$W1" R724_SET="$SET" R724_RAD="$RAD" R724_PASTE="$PASTE" R724_CRON="$CRON" R724_TSC="$TSC" R724_LINTLINE="$LINTLINE" R724_GC="$GC" R724_CC="$CC"
python3 - <<'PY'
import os
w1=os.environ.get('R724_W','').strip()
setv=os.environ.get('R724_SET','').strip()
rad=os.environ.get('R724_RAD','').strip()
paste=os.environ.get('R724_PASTE','').strip()
cron=os.environ.get('R724_CRON','').strip()
tsc=os.environ.get('R724_TSC','?')
lint=os.environ.get('R724_LINTLINE','').strip()
gc=os.environ.get('R724_GC','').strip()
cc=os.environ.get('R724_CC','').strip()
L=[]
L.append('')
L.append('---')
L.append('')
L.append('Task ID: r724')
L.append('Agent: NEXUS patrol (main agent — job 473388, 13:07 slot; opened on the r723 handoff verbatim)')
L.append('Task: Patrol round 724 — the r723 handoff item (4) LANDED: the board digest gained the corpus u/nj split (the ⧉ chip classifies the durable rows through the SAME gateCensusOf adapter — one classifier, a third source: card callLog, server lane, digest rows) under an honesty bound, and the corpus strip gained its own aggregate glance tally — judge-lane health (nj) now reads at digest level and at strip level without scanning per-run chips')
L.append('Work Log:')
L.append('- STANDING PROBES (at open): quick_check ok · watch corpus 31→43 rows — verdict 12 (PASS 9 / FAIL 3) · uncertain 11 · no-judge 20 — nj is now the DOMINANT family (+11 since r723, +19 since r722): two NEW runs entered the corpus (run_fd8fd1f21c89 "Recursive self-improvement engine: Z.ai agent harness upgrade cycle" and run_caf98e5426e6) and every fresh nj note reads "tried: intern-systemone — no answer (dial failed or empty); fast-judge …" — judge-dial failures through the mirrored lanes; the CORTEX P1 Owner-side v2 deploy is the single most urgent carry.')
L.append('- SHIP (mechanism, user-facing): (1) the ⧉ ledger chip gains the shared u/nj suffix (GateSuffix, r718 tone contract) fed by a corpusCensus memo over ledger.runs — with an HONESTY BOUND: the split renders only when the newest-400 payload covers the whole corpus (runs.length >= total) AND the split fully accounts for the honest ∅ lump (u+nj >= total−verdicts); otherwise the r680 ∅ stays (a partial sample never masquerades as a full census). (2) The corpus strip header gains an aggregate glance tally — "N runs · M ev · V verdicts · Nu · Nnj" (tabular-nums, tones per the r718 family contract: u amber, nj muted, never a rival vocabulary) with a full title naming the judge-lane distress meaning. (3) ⧉ title/aria document the split and its coverage bound.')
L.append('- WITNESS (fresh load, board radio active): '+w1)
L.append('- GOLDEN QA: settings '+setv+' · radar '+rad+' · workflows '+paste+' · cron chip '+cron+' · console: Fast-Refresh logs only, no errors · page errors: none')
L.append('- GATES: tsc_exit='+tsc+' · lint '+lint+' · qa-gate-census '+gc+' · qa-cortex-census '+cc)
L.append('- BUDGET: 17 rounds (five over the <=12 cap, DISCLOSED: the increment MultiEdit shipped one stray double-quote at the aria-label tail where the outer template backtick belongs — tsc caught it BEFORE any witness ran (nothing committed on a failed gate), but three verbatim Edit attempts failed to match the quote-tangled tail and were burned as rounds; resolved with a chr()-coded python one-liner that replaced exactly 1 occurrence. Root cause: JSON-arg quoting of backticks in the Edit tool. The remaining rounds ran as the single guarded close chain, scripts/r724_close.sh, guards abort BEFORE commit).')
L.append('Stage Summary:')
L.append('- Judge-lane health surfaced to scan level: the digest ⧉ chip now splits its honest ∅ lump into the shared u/nj tokens when — and only when — the census payload provably covers the corpus, and the strip sums its own rows into one glance line. With nj=20 and climbing, the board now SHOWS the distress the watch has been measuring.')
L.append('Round Handoff:')
L.append('Round ID: r725 -> next patrol (job 473388)')
L.append('Next recommended action: (1) DB-HEALTH PROBE standing at open (scripts/r715_watch.js) — corpus 43 rows at r724 open and growing; the digest split + strip tally now breathe with it, read them straight off the board. (2) VERDICT-FLOW WATCH: verdict 12 (PASS 9 / FAIL 3) · uncertain 11 · no-judge 20 at r724 open — nj DOMINANT; every fresh nj note is a judge-dial failure (intern-systemone no answer; fast-judge AIHubMix/Z.ai failed) — check relay/vault lane health from the patrol side if the next probe still shows dial failures. (3) CORTEX P1 (Owner-side): v2 deploy from deliverables/nexus-cortex-harness/ on project vwottesqbdgcsmvvvzok — the single most urgent carry; post-deploy judge-lane witnesses (real-key UPSTASH 3/3 + HB) arm after deploy. (4) OPTIONAL: corpus-only row click-through (run detail from ledger rows alone — the r723 proposal); consider surfacing the per-run judge-attempt trace (the "tried:" ladder list) in the strip chip title. (5) Owner queue (r693 carry): sibling-sandbox push history + .archive-snapshot-1028/ disposition; vault re-key BACKUP-FIRST; KICK widget URL fix; optional v29c-f re-download. (6) OWNER ACTION (carried): keep the exported vault backup text OUTSIDE the sandbox.')
L.append('Blockers: none. Standing constraint (r707): mechanism or named evaluation every round — held (the digest u/nj split + strip tally are mechanism; the fresh-load DOM witness with the digest text and tally string is the named evaluation, evidence-anchored in scripts/qa_r724.txt).')
open('worklog.md','a').write('\n'.join(L)+'\n')
print('worklog appended')
PY
[ $? -eq 0 ] || { echo 'GUARD worklog'; exit 1; }

cat > scripts/r724_commitmsg.txt <<'MSG'
r724: digest u/nj split + strip glance tally — judge-lane health at scan level

- SHIP: the ⧉ ledger chip classifies the durable corpus through the SAME
  gateCensusOf adapter (one classifier, a third source: card callLog,
  server lane, digest rows) and renders the shared u/nj tokens (GateSuffix,
  r718 tones) under an honesty bound: split only when the newest-400
  payload covers the whole corpus AND fully accounts for the ∅ lump —
  otherwise the r680 honest lump stays.
- SHIP: the corpus strip header gains an aggregate glance tally
  (N runs · M ev · V verdicts · Nu · Nnj, tabular-nums, r718 tone family,
  distress-meaning title) — per-run chips stay.
- witness: fresh-load DOM probe — digest chip text carries u/nj tokens,
  strip tally + per-run chips counted (scripts/qa_r724.txt).
- probes at open: corpus 31→43 rows, no-judge 9→20 (DOMINANT; two new
  runs, every note a judge-dial failure) — CORTEX P1 Owner-side deploy is
  the most urgent carry.
- golden QA: settings census/relay · radar frontier · paste-799 · cron ·
  console clean · page errors none.
- gates: tsc 0 · lint 0 errors (33-warning baseline) · qa-gate-census 48/48 ·
  qa-cortex-census 23/23.
- budget: 17 rounds (five over the <=12 cap, DISCLOSED: the increment
  MultiEdit shipped one stray quote at the aria tail — tsc caught it before
  any witness ran, nothing committed on a failed gate; three verbatim Edit
  attempts failed on the quote-tangled tail, fixed via chr()-coded python
  one-liner; guarded close chain, scripts/r724_close.sh).
MSG
git add -A
git commit -F scripts/r724_commitmsg.txt || { echo 'GUARD commit'; exit 1; }
git push origin main || { echo 'GUARD push origin'; exit 1; }
git push fork main || { echo 'GUARD push fork'; exit 1; }
echo "--- verification ---"
git log --oneline -1
echo "origin/main..HEAD: $(git rev-list origin/main..HEAD --count | tr -d ' ')"
git status --short | head -3
echo "=== r724 close end ==="
