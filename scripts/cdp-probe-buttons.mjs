#!/usr/bin/env node
// ─── r272 diagnostic probe: what copy-ish controls exist on a view? ──────────
// Dumps current hash, h2, and every button's accessible name + visibility so
// a failing suite finder can be debugged against the live page instead of
// guessed at. Usage: node scripts/cdp-probe-buttons.mjs [baseUrl] [hash]

import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const HASH = process.argv[3] ?? "#/settings";
const CDP = "http://127.0.0.1:9222";

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("ws connect failed"));
  });
}
function evalJs(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id !== id) return;
      ws.removeEventListener("message", onMsg);
      if (d.error) reject(new Error(d.error.message));
      else resolve(d.result?.result?.value);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
}
async function waitFor(ws, expr, timeoutMs = 15_000, everyMs = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJs(ws, `Boolean(${expr})`)) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}

let tabId = null;
async function closeTab() {
  if (!tabId) return;
  const id = tabId;
  tabId = null;
  try {
    await fetch(`${CDP}/json/close/${id}`, { signal: AbortSignal.timeout(1500) });
  } catch {}
}

async function main() {
  console.log(`ensureChrome: ${await ensureChrome()}`);
  const tabRes = await fetch(`${CDP}/json/new`, { method: "PUT" });
  const page = await tabRes.json();
  tabId = page.id;
  const ws = await connect(page.webSocketDebuggerUrl);

  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`);
  await evalJs(ws, `location.hash = ${JSON.stringify(HASH)}`).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  const dump = await evalJs(ws, `(() => {
    const hay = (e) => [e.getAttribute("aria-label"), e.getAttribute("title"), e.textContent]
      .map((x) => (x || "").toLowerCase()).join(" ").trim().slice(0, 60);
    const btns = [...document.querySelectorAll("button")];
    return {
      hash: location.hash,
      h2: document.querySelector("h2")?.textContent?.trim() ?? null,
      bodyLen: document.body.innerText.length,
      buttonCount: btns.length,
      visibleCount: btns.filter((e) => e.offsetParent !== null).length,
      copyMatches: btns.filter((e) => /copy/.test(hay(e))).map((e) => ({
        name: hay(e),
        visible: e.offsetParent !== null,
        disabled: e.disabled ?? false,
      })),
      sample: btns.filter((e) => e.offsetParent !== null).slice(0, 25).map(hay),
    };
  })()`);
  console.log(JSON.stringify(dump, null, 2));

  await closeTab();
  ws.close();
}

main().catch(async (e) => {
  console.error("FATAL:", e?.message ?? e);
  await closeTab();
  process.exit(1);
});
