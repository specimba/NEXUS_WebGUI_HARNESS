import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — R-series (r302): HF refresh status parity ─────────────────────
// Refreshing a CACHED HF board used to show only the spinner inside the
// Refresh button — up to 25 silent seconds (three Hub calls race the 25s
// timeout) with no textual signal. The GitHub tab already prints an inline
// aria-live "Refreshing from GitHub…" line; the HF tab now has its own.
//  H1  land on the HF Trending tab and let any auto-fetch settle (spinner
//      idle) — cached board or error box, either is a settled start
//  H2  click Refresh → the inline "Refreshing from the Hugging Face Hub…"
//      line appears (polled from the first ~50ms so a fast fetch can't dodge)
//  H3  the line disappears once the fetch settles (success or error both
//      count — the suite never depends on external egress succeeding)
//  H4  console hygiene — no reload in this suite, __errs read live at the end
// No seeding, no localStorage restore: the only write is the app's own
// routine trending-cache update, exactly what a user refresh produces.
// Usage: node scripts/cdp-qa-hf-refresh.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });

const LINE_TEXT = "Refreshing from the Hugging Face Hub";
const lineExpr = `(() => {
  const p = [...document.querySelectorAll("p")].find((x) => x.textContent.includes(${JSON.stringify(LINE_TEXT)}));
  return p ? p.textContent.trim() : null;
})()`;
const spinnerIdleExpr = `(() => {
  const btn = document.querySelector('[aria-label="Refresh results"]');
  if (!btn) return false;
  return btn.querySelector(".animate-spin") === null;
})()`;

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

// r287: Radix tabs need the full pointer sequence, not a bare click.
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
try {
  await wsSend(ws, "Page.enable");
  await wsSend(ws, "Runtime.enable");
  await wsSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  await wsSend(ws, "Page.navigate", { url: `${BASE}/#/radar` });
  await waitFor(ws, `document.readyState === "complete"`, 60_000);
  await evalJs(ws, `
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason?.message ?? e.reason)));
  `);

  // H1 — onto the HF tab and let the first-open auto-fetch settle.
  const switched = await evalJs(ws, clickTabExpr("HF Trending"));
  const settled = switched && (await waitFor(ws, `${spinnerIdleExpr}`, 40_000, 500));
  if (settled) {
    pass("H1", "HF Trending tab active and first-open fetch settled (spinner idle)");
  } else {
    fail("H1", `could not reach a settled HF tab (switched=${switched})`);
    await shot(ws, "hf-refresh-H1-FAIL");
  }

  // H2 — click Refresh; the inline status line must appear while loading.
  const btn = await evalJs(ws, `(() => {
    const b = document.querySelector('[aria-label="Refresh results"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  let lineSeen = null;
  if (btn) {
    const t0 = Date.now();
    while (Date.now() - t0 < 5000) {
      lineSeen = await evalJs(ws, lineExpr);
      if (lineSeen) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (lineSeen) {
    pass("H2", `inline status line appeared while loading: "${lineSeen}"`);
  } else {
    fail("H2", `no inline status line within 5s of clicking Refresh (clicked=${btn})`);
    await shot(ws, "hf-refresh-H2-FAIL");
  }

  // H3 — the line must clear once the fetch settles (either outcome).
  const cleared = await waitFor(ws, `${lineExpr} === null`, 40_000, 250);
  if (cleared) {
    pass("H3", "status line cleared after the refresh settled");
  } else {
    fail("H3", "status line still visible after 40s — refresh never settled");
    await shot(ws, "hf-refresh-H3-FAIL");
  }

  // H4 — console hygiene (no reload anywhere in this suite).
  const errs = await evalJs(ws, `window.__errs`);
  if (!errs || errs.length === 0) pass("H4", "no console errors during the suite");
  else fail("H4", `console errors: ${JSON.stringify(errs)}`);
} catch (e) {
  fail("DRIVE", `harness error: ${e.message}`);
  try { await shot(ws, "hf-refresh-DRIVE-FAIL"); } catch {}
} finally {
  try { await fetch(`http://127.0.0.1:9222/json/close/${page.id}`, { method: "GET" }); } catch {}
}

const passed = results.filter(([, ok]) => ok).length;
const failed = results.length - passed;
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("DIAG: failures above; screenshots in ops/qa/hf-refresh-*.png");
  process.exit(1);
}
