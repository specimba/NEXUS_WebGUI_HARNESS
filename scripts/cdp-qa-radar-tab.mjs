import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — R-series (r301): radar tab persistence ────────────────────────
// r240 taught the radar's INNER controls to survive remounts (HF kind, GH
// username, arXiv query) — but the tab strip itself kept uncontrolled
// defaultValue="models", so every view switch snapped the user back to
// Models while everything below the strip remembered its state. The fix
// makes the tab controlled + persisted ("praison-radar-tab").
//  T1  with no saved key, the radar opens on Models (default preserved)
//  T2  driving the "GitHub Stars" Radix trigger (full r287 pointer
//      sequence) selects it AND writes the persistence key synchronously
//  T3  after a REAL location.reload() (same-URL Page.navigate is a no-op),
//      the radar reopens on GitHub Stars — the fix witness
//  T4  console hygiene — __errs snapshotted before the reload and read
//      after it, both segments must be empty
// No product seeding: the suite only touches its own persistence key,
// which it snapshots first and restores at the end.
// Usage: node scripts/cdp-qa-radar-tab.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });

const TAB_KEY = "praison-radar-tab";

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
async function bootWatch(ws) {
  await waitFor(ws, `document.readyState === "complete"`, 60_000);
  await evalJs(ws, `
    window.__errs = window.__errs ?? [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason?.message ?? e.reason)));
  `);
}
const results = [];
function pass(id, note) { results.push([id, true, note]); console.log(`  ✅ ${id} — ${note}`); }
function fail(id, note) { results.push([id, false, note]); console.log(`  ❌ ${id} — ${note}`); }

const selectedTabExpr = `(() => {
  const t = document.querySelector('[role="tab"][aria-selected="true"]');
  return t ? t.textContent.replace(/\\s+/g, " ").trim() : null;
})()`;

// r287: Radix triggers ignore a bare .click() — dispatch the full pointer
// sequence (pointerdown/mousedown/pointerup/mouseup + click), all bubbled.
const clickTabExpr = (label) => `(() => {
  const t = [...document.querySelectorAll('[role="tab"]')]
    .find((x) => x.textContent.replace(/\\s+/g, " ").trim() === ${JSON.stringify(label)});
  if (!t) return false;
  const opts = { bubbles: true, cancelable: true, view: window, pointerId: 1 };
  t.dispatchEvent(new PointerEvent("pointerdown", opts));
  t.dispatchEvent(new MouseEvent("mousedown", opts));
  t.dispatchEvent(new PointerEvent("pointerup", opts));
  t.dispatchEvent(new MouseEvent("mouseup", opts));
  t.click();
  return true;
})()`;

// ─── drive ────────────────────────────────────────────────────────────────────
await ensureChrome();
const list = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json()).catch(() => null);
if (!list) { console.error("SUMMARY: 0 passed, 1 failed — chrome CDP not reachable"); process.exit(1); }
const tabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
if (!tabRes.ok) { console.error(`SUMMARY: 0 passed, 1 failed — /json/new failed: ${tabRes.status}`); process.exit(1); }
let page = await tabRes.json();
const ws = await connect(page.webSocketDebuggerUrl);
let keySnapshot = null;
try {
  await wsSend(ws, "Page.enable");
  await wsSend(ws, "Runtime.enable");
  await wsSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  await wsSend(ws, "Page.navigate", { url: `${BASE}/#/radar` });
  await bootWatch(ws);
  // Deterministic start: the suite owns its key for the run — snapshot the
  // pre-existing value (normally absent) and drop it so T1 sees the default.
  keySnapshot = await evalJs(ws, `localStorage.getItem(${JSON.stringify(TAB_KEY)})`);
  if (keySnapshot !== null) {
    await evalJs(ws, `(() => { localStorage.removeItem(${JSON.stringify(TAB_KEY)}); location.reload(); return true; })()`);
    await bootWatch(ws);
  }
  await new Promise((r) => setTimeout(r, 1500));

  // T1 — default tab with no saved key.
  const t1Ready = await waitFor(ws, `${selectedTabExpr} !== null`, 20_000);
  const initial = t1Ready ? await evalJs(ws, selectedTabExpr) : null;
  if (initial === "Models") {
    pass("T1", "no saved key → radar opens on Models (default preserved)");
  } else {
    fail("T1", `selected tab ${JSON.stringify(initial)} !== "Models"`);
    await shot(ws, "radar-tab-T1-FAIL");
  }

  // T2 — drive the trigger; selection + synchronous key write.
  const clicked = await evalJs(ws, clickTabExpr("GitHub Stars"));
  await new Promise((r) => setTimeout(r, 400));
  const afterClick = clicked ? await evalJs(ws, selectedTabExpr) : null;
  // writeCache stores JSON.stringify(value) — parse it back like the
  // component's readCache does before comparing.
  const savedKey = clicked
    ? await evalJs(ws, `(() => {
        try { return JSON.parse(localStorage.getItem(${JSON.stringify(TAB_KEY)}) ?? ""); }
        catch { return null; }
      })()`)
    : null;
  if (afterClick === "GitHub Stars" && savedKey === "github") {
    pass("T2", `trigger click selects GitHub Stars and persists the key ("${savedKey}")`);
  } else {
    fail("T2", `after click: tab=${JSON.stringify(afterClick)}, key=${JSON.stringify(savedKey)} (clicked=${clicked})`);
    await shot(ws, "radar-tab-T2-FAIL");
  }

  // Errs segment 1 must be captured BEFORE the reload wipes the array.
  const errs1 = (await evalJs(ws, `window.__errs`)) ?? [];

  // T3 — real reload; the persisted tab must come back selected.
  await evalJs(ws, `location.reload(); true`);
  await bootWatch(ws);
  await new Promise((r) => setTimeout(r, 1500));
  const t3Ready = await waitFor(ws, `${selectedTabExpr} !== null`, 20_000);
  const afterReload = t3Ready ? await evalJs(ws, selectedTabExpr) : null;
  if (afterReload === "GitHub Stars") {
    pass("T3", "after a real reload the radar reopens on GitHub Stars (persistence witness)");
  } else {
    fail("T3", `after reload the selected tab is ${JSON.stringify(afterReload)} !== "GitHub Stars" — persistence broken`);
    await shot(ws, "radar-tab-T3-FAIL");
  }

  // T4 — console hygiene across both segments.
  const errs2 = (await evalJs(ws, `window.__errs`)) ?? [];
  const errs = [...errs1, ...errs2];
  if (errs.length === 0) pass("T4", "no console errors during the suite");
  else fail("T4", `console errors: ${JSON.stringify(errs)}`);

  // Restore the pre-test key (remove if it was absent) so the profile is
  // exactly as found; same-eval reload so a debounced write can't follow us.
  await evalJs(ws, `(() => {
    const snap = ${JSON.stringify(keySnapshot)};
    if (snap === null) localStorage.removeItem(${JSON.stringify(TAB_KEY)});
    else localStorage.setItem(${JSON.stringify(TAB_KEY)}, snap);
    location.reload();
    return true;
  })()`);
  await waitFor(ws, `document.readyState === "complete"`, 60_000);
} catch (e) {
  fail("DRIVE", `harness error: ${e.message}`);
  try { await shot(ws, "radar-tab-DRIVE-FAIL"); } catch {}
} finally {
  try { await fetch(`http://127.0.0.1:9222/json/close/${page.id}`, { method: "GET" }); } catch {}
}

const passed = results.filter(([, ok]) => ok).length;
const failed = results.length - passed;
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("DIAG: failures above; screenshots in ops/qa/radar-tab-*.png");
  process.exit(1);
}
