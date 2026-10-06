import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — W-series (r295): setup-wizard pick-path "Save & test" flow ─────
// Bug fixed in r295: the wizard's reset effect subscribed to
// settings.providerKeys; every in-wizard save produced a new providerKeys
// identity and re-fired the reset, yanking a non-deep-linked wizard back to
// step 0 mid-flow. Deep links masked it (pid non-null keeps step 2), so
// hash-route QA never witnessed the bounce.
//  W1  #/setup opens the wizard at the PICK step (pid = null — the broken path)
//  W2  clicking a provider row advances to the connect step
//  W3  "Save & test" (dummy key) HOLDS the connect step — the r295 fix witness;
//      the old bug bounced to the picker within one commit
//  W4  #/guide/<id> deep-link still lands ON the deep-linked provider —
//      register step (fresh) or connect step (profile already has a key;
//      both are the documented semantics). Never the pick list.
//      (r295 first run: the live profile has an aihubmix key, so the
//      fresh→register expectation was wrong; made profile-aware.)
//  W5  no console errors during the suite
//  W6  r296 guard witness: click Save & test, switch providers ~300ms into
//      the dial — the stale failure must NEVER render in the switched dialog
//      (witnessed live in r295 before the guard existed)
// Live-profile suite: settings are snapshotted before W3's saveEntry and
// restored before W4 (no dummy-key pollution left behind).
// Usage: node scripts/cdp-qa-wizard-flow.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });

let msgId = 0;
const pending = new Map();
function wsSend(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, 20_000);
  });
}
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
  };
  return ws;
}
async function evalJs(ws, expression) {
  const r = await wsSend(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval error");
  return r.result?.value;
}
async function waitFor(ws, expr, timeoutMs = 15_000, everyMs = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(ws, `Boolean(${expr})`)) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}
async function shot(ws, name) {
  const r = await wsSend(ws, "Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log(`  📸 ${file}`);
}
const results = [];
function pass(id, note) { results.push([id, true, note]); console.log(`  ✅ ${id} — ${note}`); }
function fail(id, note) { results.push([id, false, note]); console.log(`  ❌ ${id} — ${note}`); }

// ─── drive ────────────────────────────────────────────────────────────────────
await ensureChrome();
const list = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json()).catch(() => null);
if (!list) { console.error("SUMMARY: 0 passed, 1 failed — chrome CDP not reachable"); process.exit(1); }
// r266: self-created tab (scan-reuse was a race — r265 finding).
const tabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
if (!tabRes.ok) { console.error(`SUMMARY: 0 passed, 1 failed — /json/new failed: ${tabRes.status}`); process.exit(1); }
let page = await tabRes.json();
const ws = await connect(page.webSocketDebuggerUrl);
try {
  await wsSend(ws, "Page.enable");
  await wsSend(ws, "Runtime.enable");
  await wsSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  await wsSend(ws, "Page.navigate", { url: `${BASE}/#/setup` });
  await waitFor(ws, `document.readyState === "complete"`, 60_000);
  await evalJs(ws, `
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason?.message ?? e.reason)));
  `);

  // W1 — wizard opens at the pick step via #/setup (providerId = null).
  const w1 = await waitFor(ws, `
    document.querySelector('[role="dialog"]') &&
    document.body.innerText.includes("guided setup") &&
    document.body.innerText.includes("Every provider below")
  `, 30_000);
  if (w1) pass("W1", "#/setup opens the wizard at the pick step");
  else fail("W1", "wizard did not open at the pick step");
  if (!w1) { await shot(ws, "wizard-flow-W1-FAIL"); }

  // W2 — click the first provider row → register (step 1) or connect (step 2
  // if the live profile already has a key). Advance to the connect step.
  const w2 = await waitFor(ws, `Boolean(document.querySelector('.max-h-80 button'))`, 10_000) &&
    await evalJs(ws, `(() => { document.querySelector('.max-h-80 button').click(); return true; })()`);
  let advanced = false;
  for (let i = 0; i < 10 && !advanced; i++) {
    advanced = await evalJs(ws, `Boolean(document.querySelector("#wizard-key"))`);
    if (!advanced) {
      // On the register reading: "I have my key" advances to connect.
      await evalJs(ws, `(() => {
        const b = [...document.querySelectorAll('[role="dialog"] button')]
          .find((x) => x.textContent.includes("I have my key"));
        if (b) b.click();
        return Boolean(b);
      })()`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  if (w2 && advanced) pass("W2", "provider row → connect step (#wizard-key visible)");
  else fail("W2", "did not reach the connect step");
  if (!(w2 && advanced)) { await shot(ws, "wizard-flow-W2-FAIL"); }

  // W3 — THE FIX WITNESS: snapshot settings, type a dummy key, "Save & test".
  // saveEntry fires BEFORE validation, so the old bug bounced to the picker
  // within one commit — regardless of the dial's outcome.
  const settingsKey = await evalJs(ws, `(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      try {
        const v = JSON.parse(localStorage.getItem(k) ?? "");
        if (v && v.state && v.state.settings) return k;
      } catch {}
    }
    return null;
  })()`);
  if (!settingsKey) { fail("W3", "settings persist key not found — cannot snapshot/restore"); await shot(ws, "wizard-flow-W3-FAIL"); }
  const settingsBefore = settingsKey
    ? await evalJs(ws, `localStorage.getItem(${JSON.stringify(settingsKey)})`)
    : null;
  await evalJs(ws, `(() => {
    const el = document.querySelector("#wizard-key");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "qa-dummy-key-r295");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await evalJs(ws, `(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')]
      .find((x) => x.textContent.includes("Save & test"));
    if (b) b.click();
    return Boolean(b);
  })()`);
  // The bounce (old bug) removed #wizard-key on the commit right after save.
  // Give it 3.5s to misbehave, then require the connect step to still stand.
  await new Promise((r) => setTimeout(r, 3500));
  const held = await evalJs(ws, `Boolean(document.querySelector("#wizard-key")) && document.querySelector('[role="dialog"]') !== null`);
  const bounced = await evalJs(ws, `document.body.innerText.includes("Every provider below")`);
  if (w1 && settingsKey && held && !bounced) {
    pass("W3", "Save & test HOLDS the connect step (r295 fix witness; old bug bounced to picker)");
  } else {
    fail("W3", `connect step did not hold (held=${held}, bounced=${bounced})`);
  }
  if (!(held && !bounced)) { await shot(ws, "wizard-flow-W3-FAIL"); }

  // W6 — r296 GUARD WITNESS: W3's failed dial left its error box visible on
  // the vyce dialog (legitimate). Fire a fresh dial, deep-link-switch to
  // aihubmix ~300ms in, then require the stale error to stay absent in the
  // aihubmix context for the rest of the dial's life. Before the guard, a
  // dial resolving after the switch rendered its 401 in the wrong dialog.
  await evalJs(ws, `(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')]
      .find((x) => x.textContent.includes("Save & test"));
    if (b && !b.disabled) b.click();
    return Boolean(b);
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  await evalJs(ws, `location.hash = "#/guide/aihubmix"; true`);
  let w6 = true;
  const w6t0 = Date.now();
  while (Date.now() - w6t0 < 8000) {
    const staleErr = await evalJs(ws, `
      document.body.innerText.includes("Invalid API key") &&
      document.body.innerText.includes("AIHubMix") &&
      document.querySelector('[role="dialog"]') !== null
    `);
    if (staleErr) { w6 = false; break; }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (w6) pass("W6", "mid-dial provider switch: stale validation error never rendered (r296 guard)");
  else { fail("W6", "stale validation error rendered in the switched dialog"); await shot(ws, "wizard-flow-W6-FAIL"); }

  // Cleanup — restore the pre-test settings so no dummy key pollutes the
  // live profile, then reload for a clean W4.
  if (settingsKey && settingsBefore != null) {
    await evalJs(ws, `localStorage.setItem(${JSON.stringify(settingsKey)}, ${JSON.stringify(settingsBefore)}); true`);
    await wsSend(ws, "Page.navigate", { url: `${BASE}/#/guide/aihubmix` });
    await waitFor(ws, `document.readyState === "complete"`, 60_000);
  } else if (settingsKey && settingsBefore == null) {
    await evalJs(ws, `localStorage.removeItem(${JSON.stringify(settingsKey)}); true`);
    await wsSend(ws, "Page.navigate", { url: `${BASE}/#/guide/aihubmix` });
    await waitFor(ws, `document.readyState === "complete"`, 60_000);
  }

  // W4 — deep-link semantics unchanged: #/guide/aihubmix lands on the
  // aihubmix flow (register reading on a fresh profile, connect reading when
  // the vault already holds a key) — in both cases the pick list must be gone.
  const w4 = await waitFor(ws, `
    document.querySelector('[role="dialog"]') !== null &&
    (document.body.innerText.includes("How to get your key") ||
     document.body.innerText.includes("API key")) &&
    !document.body.innerText.includes("Every provider below")
  `, 30_000);
  if (w4) pass("W4", "#/guide/aihubmix deep-link lands on the provider flow (register or connect), not the pick list");
  else fail("W4", "deep-link did not land on the provider flow");
  if (!w4) { await shot(ws, "wizard-flow-W4-FAIL"); }

  // W5 — console hygiene.
  const errs = await evalJs(ws, `window.__errs`);
  if (!errs || errs.length === 0) pass("W5", "no console errors during the suite");
  else fail("W5", `console errors: ${JSON.stringify(errs)}`);
} catch (e) {
  fail("DRIVE", `harness error: ${e.message}`);
  try { await shot(ws, "wizard-flow-DRIVE-FAIL"); } catch {}
} finally {
  try { await fetch(`http://127.0.0.1:9222/json/close/${page.id}`, { method: "GET" }); } catch {}
}

const passed = results.filter(([, ok]) => ok).length;
const failed = results.length - passed;
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("DIAG: failures above; screenshots in ops/qa/wizard-flow-*.png");
  process.exit(1);
}
