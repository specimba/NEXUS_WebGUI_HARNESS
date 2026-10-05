#!/usr/bin/env node
// r275 probe: settings view paints h2 but sections appear missing in the
// fresh bundle (M4 copyish:0, R1 chips:0). Dump the live landscape — no more
// guessing (r272 probe-first doctrine).
import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("ws connect failed"));
  });
}
function cmd(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id !== id) return;
      ws.removeEventListener("message", onMsg);
      if (d.error) reject(new Error(d.error.message));
      else resolve(d.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function evalJs(ws, expression) {
  return cmd(ws, "Runtime.evaluate", { expression, returnByValue: true }).then((r) => r?.result?.value);
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
  try { await fetch(`${CDP}/json/close/${id}`, { signal: AbortSignal.timeout(1500) }); } catch {}
}

async function main() {
  const mode = await ensureChrome();
  console.log(`ensureChrome: ${mode}`);
  const tabRes = await fetch(`${CDP}/json/new`, { method: "PUT" });
  const page = await tabRes.json();
  tabId = page.id;
  const ws = await connect(page.webSocketDebuggerUrl);

  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/#/settings")}`).catch(() => {});
  await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`, 15_000);
  await waitFor(ws, `document.querySelector("h2")?.textContent?.trim() === "Settings"`, 10_000);

  const dump = await evalJs(ws, `(() => {
    const ids = ["whats-fixed","usage","providers","local-models","relay","vault","appearance","data"].filter((id) => document.getElementById(id));
    const btns = [...document.querySelectorAll("button")];
    const names = btns.slice(0, 30).map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40));
    return {
      url: location.href,
      h2s: [...document.querySelectorAll("h2")].map((e) => e.textContent.trim()).slice(0, 8),
      h3s: [...document.querySelectorAll("h3")].map((e) => e.textContent.trim()).slice(0, 12),
      sectionIds: ids,
      buttonCount: btns.length,
      buttonNames: names,
      violetChips: [...document.querySelectorAll("span")].filter((e) => (e.className || "").includes("violet-500/10")).length,
      bodyText: (document.body.innerText || "").slice(0, 700),
      toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((e) => (e.textContent || "").slice(0, 80)),
      keys: Object.keys(JSON.parse(localStorage.getItem("praison-settings") || "{}")?.state?.settings?.providerKeys || {}),
    };
  })()`);
  console.log(JSON.stringify(dump, null, 2));

  await closeTab();
  ws.close();
}
main().catch(async (e) => { console.error("FATAL:", e?.message ?? e); await closeTab(); process.exit(1); });
