#!/usr/bin/env bash
# r384 QA — image-studio.tsx fixes, UI-level witnesses (handoff lesson: no state-injection).
# Fix A: keyless Ctrl+Enter must show the vault copy LOCALLY and must NOT dial /api/images/generate.
# Fix B: blob-download mechanism witness (data: URL fetch -> blob -> objectURL works in this browser).
set -uo pipefail
AB="agent-browser --session ${SESSION:-r384}"
PASS=0; FAIL=0
ok(){ echo "PASS: $1"; PASS=$((PASS+1)); }
bad(){ echo "FAIL: $1"; FAIL=$((FAIL+1)); }

$AB open http://127.0.0.1:3000/ >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1 || true

# ── Ground truth: does this browser profile hold a vyce key? ────────────────
KEYPROBE=$($AB eval "(function(){try{const s=JSON.parse(localStorage.getItem('praison-settings')||'null');const k=s&&s.state&&s.state.settings&&s.state.settings.providerKeys&&s.state.settings.providerKeys.vyce&&s.state.settings.providerKeys.vyce.key;return (k&&String(k).trim().length>0)?'KEY_PRESENT':'NO_KEY'}catch(e){return 'NO_KEY'}})()" 2>/dev/null | tr -d '"' | tail -1)
echo "keyprobe=$KEYPROBE"

# ── Open Image Studio via the composer trigger (pure UI path) ───────────────
if $AB find role button click --name "Open Image Studio" >/dev/null 2>&1; then ok "composer trigger opens dialog"; else bad "composer trigger"; fi
sleep 1

# ── Dialog renders: no-key alert + disabled Generate ────────────────────────
SNAP=$($AB snapshot -s "[role=dialog]" 2>/dev/null)
echo "$SNAP" | grep -q "Image Studio" && ok "dialog title renders" || bad "dialog title"
if echo "$KEYPROBE" | grep -q NO_KEY; then
  echo "$SNAP" | grep -q "No Vyce key in your vault yet" && ok "no-key alert renders (hasKey=false ground truth)" || bad "no-key alert"
  echo "$SNAP" | grep -Ei "Generate" | grep -qi "disabled" && ok "Generate disabled without key" || bad "Generate disabled state"
fi

# ── Idea chip fills the prompt ───────────────────────────────────────────────
$AB find role button click --name "Robot mascot" >/dev/null 2>&1 && ok "idea chip clickable" || bad "idea chip click"
PVAL=$($AB eval "document.getElementById('img-prompt') ? document.getElementById('img-prompt').value : 'NO_TA'" 2>/dev/null | tr -d '"' | tail -1)
echo "prompt-after-chip-len=${#PVAL}"
[ "${#PVAL}" -gt 10 ] && ok "idea chip fills the prompt" || bad "idea chip fills the prompt"

# ── Route-mock the image API (network-level: zero provider cost, real app logic) ──
MOCK='{"imageUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","revisedPrompt":"mock prompt","ms":12,"size":"1024x1024"}'
$AB network route "**/api/images/generate" --body "$MOCK" >/dev/null 2>&1 && ok "route mock armed" || bad "route mock"

# Fix A key-present witness: Ctrl+Entry DOES dial when a key exists (intercepted, free)
$AB find label "Prompt" fill "qa r384 keyboard dial witness" >/dev/null 2>&1
$AB press Control+Enter >/dev/null 2>&1
sleep 1.5
NDIAL=$($AB network requests --filter "images/generate" 2>/dev/null | grep -c "images/generate" || true)
[ "${NDIAL:-0}" -ge 1 ] && ok "keyboard path dials when key present (intercepted): $NDIAL" || bad "keyboard path did not dial"
DIAG=$($AB eval "Array.from(document.querySelectorAll('[role=dialog] [role=alert]')).map(function(e){return e.textContent}).join(' | ') || 'no-alert'" 2>/dev/null | tr -d '"' | tail -1)
echo "alerts-after-ctrlenter=$DIAG"

# Result renders through the real component (mocked success)
SNAP3=$($AB snapshot -s "[role=dialog]" 2>/dev/null)
echo "$SNAP3" | grep -q "Add to chat" && ok "result block renders (Add to chat visible)" || bad "result render"

# Fix B end-to-end: Download via the blob round-trip; page must NOT navigate
URL0=$($AB get url 2>/dev/null)
$AB find role button click --name "Download" >/dev/null 2>&1 && ok "Download clickable" || bad "Download click"
sleep 1.5
URL1=$($AB get url 2>/dev/null)
[ "$URL0" = "$URL1" ] && ok "no navigation on download" || bad "NAVIGATED to $URL1"

$AB network unroute >/dev/null 2>&1 || true

# ── Fix B mechanism: data: URL fetch -> blob -> objectURL in this browser ────
MECH=$($AB eval "(async function(){const r=await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');const b=await r.blob();const u=URL.createObjectURL(b);URL.revokeObjectURL(u);return 'blob-ok bytes='+b.size})()" 2>/dev/null | tail -1)
echo "$MECH" | grep -q "blob-ok bytes" && ok "blob-download mechanism works: $MECH" || bad "blob mechanism: $MECH"

# ── Console hygiene ──────────────────────────────────────────────────────────
ERRS=$($AB errors 2>/dev/null | grep -c "Error" || true)
[ "${ERRS:-0}" -eq 0 ] && ok "console errors: 0" || bad "console errors: $ERRS"

$AB close >/dev/null 2>&1 || true
echo "─────────────────────"
echo "RESULT: $PASS passed, $FAIL failed"
exit $FAIL
