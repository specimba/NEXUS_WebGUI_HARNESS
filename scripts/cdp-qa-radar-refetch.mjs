import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — R-series (r219): radar tab parked-staleness fix ────────────────
// Asserts ModelRadarTab (the full-screen model tracker) refetches /api/tracker:
//   R1 boot:   navigating to #/radar fires a mount GET (counter ≥ 1)
//   R2 UX:     radar Models tab actually renders ("Free & new model tracker")
//   R3 fix:    dispatching visibilitychange while visible → new GET (the r219
//              refetch wiring — previously mount-once, froze when parked)
//   R4 guard:  static source check — BOTH the onVis handler and the 15-min
//              interval guard on visibilityState === "visible" (r141 doctrine:
//              hidden tabs dial nothing)
//   R5 remount: sidebar away (Chat) and back (Radar) → another GET (the
//              top-level view remount refetch is preserved, not regressed)
// Counter counts GET-only (method filter) so the stale-triggered POST sync
// never pollutes the counts; the always-on ticker shares the endpoint and may
// add its own GETs — assertions are strictly-increasing, not exact numbers.
// Launch first (same shell):
//   setsid ~/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell \
//     --headless --no-sandbox --disable-gpu --remote-allow-origins='*' \
//     --remote-debugging-port=9222 --window-size=1440,1000 about:blank &
// Usage: node scripts/cdp-qa-radar-refetch.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });
const COMP = path.resolve("src/components/nexus/tracker/model-radar-tab.tsx");

let msgId = 0;
const pending = new Map();

function wsSend(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 30_000);
  });
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("ws error"));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  return ws;
}

async function evalJs(ws, expression) {
  const r = await wsSend(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? "eval error");
  }
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
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// Injected BEFORE any page script on every navigation (addScriptToEvaluateOnNewDocument):
// wraps fetch and counts GET /api/tracker calls.
const COUNTER_BOOT = `
  window.__trackerGets = 0;
  const __of = window.fetch.bind(window);
  window.fetch = function (...args) {
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = ((args[1] && args[1].method) || (input && input.method) || "GET").toUpperCase();
      if (url.includes("/api/tracker") && method === "GET") window.__trackerGets += 1;
    } catch {}
    return __of(...args);
  };
`;

async function clickNav(ws, re, label) {
  const click = `
    (() => {
      const el = [...document.querySelectorAll("button,a")].find(
        (e) => ${re}.test((e.textContent || "").trim()) && e.offsetParent !== null);
      if (!el) return false;
      el.click();
      return true;
    })()`;
  for (let i = 0; i < 6; i++) {
    if (await evalJs(ws, click)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  // r214 lesson: sidebar items bundle label+hint — dump visible nav texts once
  const dump = await evalJs(
    ws,
    `[...document.querySelectorAll("button,a")].filter(e=>e.offsetParent!==null).map(e=>(e.textContent||"").trim().slice(0,40)).filter(t=>t).slice(0,30).join(" | ")`,
  );
  throw new Error(`nav to ${label} failed — visible: ${dump}`);
}

async function main() {
  // Browser boot
  await ensureChrome();
  const tabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status} — is chrome-headless-shell up?`);
  const tab = await tabRes.json();
  try {
    const ws = await connect(tab.webSocketDebuggerUrl);
    await wsSend(ws, "Page.enable");
    await wsSend(ws, "Runtime.enable");
    await wsSend(ws, "Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await wsSend(ws, "Page.addScriptToEvaluateOnNewDocument", { source: COUNTER_BOOT });
    await wsSend(ws, "Page.navigate", { url: `${BASE}/#/radar` });
    await evalJs(ws, "document.title");
    await waitFor(ws, `document.readyState === 'complete'`);
    await new Promise((r) => setTimeout(r, 2500));

    // R1 — mount GET fired
    if (!(await waitFor(ws, `(window.__trackerGets ?? 0) >= 1`, 45_000))) {
      await shot(ws, "r219-R1-no-mount-get");
      throw new Error("no /api/tracker GET within 45s (dev-compile stall or regression)");
    }
    const mountGets = await evalJs(ws, "window.__trackerGets");
    check("R1 mount GET fired on #/radar boot", mountGets >= 1, `count=${mountGets}`);

    // R2 — the radar Models tab actually renders
    const rendered = await waitFor(
      ws,
      `(document.body.innerText || "").includes("Free & new model tracker")`,
      20_000,
    );
    check("R2 radar Models tab renders", rendered);
    await shot(ws, "r219-radar-tab");

    // R3 — the r219 fix: visibilitychange while visible → refetch
    const before = await evalJs(ws, "window.__trackerGets");
    await evalJs(ws, `document.dispatchEvent(new Event("visibilitychange"))`);
    await new Promise((r) => setTimeout(r, 2000));
    const after = await evalJs(ws, "window.__trackerGets");
    check("R3 visibilitychange refetch", after > before, `before=${before} after=${after}`);

    // R4 — static guard check: both listeners hidden-guarded (r141 doctrine)
    const src = fs.readFileSync(COMP, "utf8");
    const guards = (src.match(/document\.visibilityState === "visible"/g) ?? []).length;
    const hasRemove = src.includes("removeEventListener") && src.includes("clearInterval(iv)");
    check("R4 hidden-tab guards in source", guards === 2 && hasRemove, `guards=${guards} cleanup=${hasRemove}`);

    // R5 — away (Chat) and back (Radar) → remount refetch preserved
    await clickNav(ws, `/^(Chat|New Chat)/`, "Chat");
    await new Promise((r) => setTimeout(r, 1200));
    await clickNav(ws, `/^(Trend )?Radar/`, "Radar");
    if (!(await waitFor(ws, `(document.body.innerText || "").includes("Free & new model tracker")`, 45_000))) {
      await shot(ws, "r219-R5-back-nav");
      throw new Error("radar did not render after returning");
    }
    const remountAfter = await evalJs(ws, "window.__trackerGets");
    check("R5 remount refetch preserved", remountAfter > after, `after=${after} now=${remountAfter}`);
    await shot(ws, "r219-radar-returned");
  } finally {
    // Tab hygiene (r218 lesson: leaked tabs thrash the renderer)
    await fetch(`http://127.0.0.1:9222/json/close/${tab.id}`).catch(() => {});
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
  process.exit(failed);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(99);
});
