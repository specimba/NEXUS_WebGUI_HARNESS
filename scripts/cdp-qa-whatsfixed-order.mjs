import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — U-series (r242): What's-fixed receipt panel order ──────────────
// Feature under test: whats-fixed.tsx newest-first render.
// r294: assertions are EVERGREEN — the r242-era literals went stale twice
// (r274 refreshed receipts without touching this suite; r294 added four more).
//  U1  chip extremes match the header's DERIVED range (first=newest, last=oldest), ≥15 entries
//  U2  full descending order — the leading round number never increases downward
//  U3  header still names a range and promises "Newest receipts first"
//  U4  no console errors during the suite
// Static content — no store seeding, no reload dance required.
// Usage: node scripts/cdp-qa-whatsfixed-order.mjs [baseUrl]
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

// ─── drive ────────────────────────────────────────────────────────────────────
await ensureChrome();
const list = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json()).catch(() => null);
if (!list) { console.error("SUMMARY: 0 passed, 1 failed — chrome CDP not reachable"); process.exit(1); }
// r266: self-created tab (scan-reuse was a race — clientless targets are
// reaped lazily by this shell; r265 finding).
const tabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
if (!tabRes.ok) { console.error(`SUMMARY: 0 passed, 1 failed — /json/new failed: ${tabRes.status}`); process.exit(1); }
let page = await tabRes.json();
const ws = await connect(page.webSocketDebuggerUrl);
await wsSend(ws, "Page.enable");
await wsSend(ws, "Runtime.enable");
// Desktop viewport — the sidebar nav only mounts in the desktop layout.
await wsSend(ws, "Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});

await wsSend(ws, "Page.navigate", { url: BASE });
await waitFor(ws, `document.readyState === "complete"`, 60_000);
const navReady = await waitFor(ws, `document.querySelector('nav[aria-label="Primary"]')`, 45_000);
if (!navReady) {
  console.error("SUMMARY: 0 passed, 1 failed — app shell did not render");
  process.exit(1);
}
await evalJs(ws, `
  window.__errs = [];
  window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason?.message ?? e.reason)));
`);

// open Settings — poll the click: hydration can briefly unmount
let opened = false;
for (let i = 0; i < 25 && !opened; i++) {
  opened = await evalJs(ws, `(() => {
    const btns = [...document.querySelectorAll('nav[aria-label="Primary"] button')];
    const b = btns.find((x) => x.textContent.includes("Settings"));
    if (!b) return false;
    b.click(); return true;
  })()`);
  if (!opened) await new Promise((r) => setTimeout(r, 400));
}
if (!opened) { console.error("SUMMARY: 0 passed, 1 failed — Settings nav button not found"); process.exit(1); }
await waitFor(ws, `document.querySelector('#whats-fixed')`, 15_000);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// U1 — extremes match the header's declared range (derived in the component)
const u1 = await evalJs(ws, `(() => {
  const chips = [...document.querySelectorAll('#whats-fixed span[class*="bg-violet-500"]')].map((s) => s.textContent.trim());
  const range = (document.querySelector('#whats-fixed')?.textContent ?? "").match(/r(\\d+)-r(\\d+)/);
  return { count: chips.length, first: chips[0] ?? null, last: chips[chips.length - 1] ?? null,
           rangeStart: range ? range[1] : null, rangeEnd: range ? range[2] : null };
})()`);
check(
  "U1 chip extremes == header range (first=newest, last=oldest)",
  u1.count >= 15 &&
    u1.rangeStart !== null && u1.rangeEnd !== null &&
    u1.first === `r${u1.rangeEnd}` && u1.last === `r${u1.rangeStart}`,
  JSON.stringify(u1)
);

// U2 — full descending order (leading round number never increases downward)
const u2 = await evalJs(ws, `(() => {
  const nums = [...document.querySelectorAll('#whats-fixed span[class*="bg-violet-500"]')]
    .map((s) => parseInt((s.textContent ?? "").match(/\\d+/)?.[0] ?? "0", 10));
  let sorted = true;
  for (let i = 1; i < nums.length; i++) if (nums[i] > nums[i - 1]) sorted = false;
  return { nums, sorted };
})()`);
check("U2 receipts render strictly newest-first", u2.sorted && u2.nums.length >= 15, JSON.stringify(u2.nums));

// U3 — header names a range + keeps the ordering promise (checked at section
// level: CardDescription may not render as a <p> in this shadcn version)
const u3 = await evalJs(ws, `(() => {
  const desc = document.querySelector('#whats-fixed')?.textContent ?? "";
  return { hasRange: /r\\d+-r\\d+/.test(desc), newest: /newest receipts first/i.test(desc) };
})()`);
check("U3 header names its range + newest-first promise", u3.hasRange && u3.newest, JSON.stringify(u3));

await shot(ws, "u-series-whatsfixed");

const errs = await evalJs(ws, `window.__errs ?? []`);
check("no console errors during suite", Array.isArray(errs) && errs.length === 0, JSON.stringify(errs ?? []).slice(0, 200));

const passed = results.filter((r) => r.ok).length;
console.log(`SUMMARY: ${passed} passed, ${results.length - passed} failed`);
process.exit(passed === results.length ? 0 : 1);
