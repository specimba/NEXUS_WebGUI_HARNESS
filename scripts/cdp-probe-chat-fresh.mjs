#!/usr/bin/env node
// ─── r292 probe: what does ChatView render in its content area on a FRESH profile? ───
// r291's boot gate found that at #/chat neither "No chat selected" (chat-view
// L919) nor the guessed messages-log anchor ever rendered, while the TopBar
// title proved the view mounted and no error boundary fired. This probe
// re-creates that exact fresh-profile state and dumps EVIDENCE (not guesses):
// main.innerText sample, every aria-label inside main, all headings, the
// Next dev-overlay presence, and localStorage key names. READ-ONLY: no
// writes, no seeding; tab closed on success AND error (house shape, r291).
// Usage: node scripts/cdp-probe-chat-fresh.mjs [baseUrl]

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
  return cmd(ws, "Runtime.evaluate", { expression, returnByValue: true }).then(
    (r) => r?.result?.value
  );
}

async function waitFor(ws, expr, timeoutMs = 20_000, everyMs = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJs(ws, `Boolean(${expr})`)) return true;
    } catch {
      /* transient — keep polling within budget */
    }
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
  } catch {
    /* best effort */
  }
}

async function main() {
  const mode = await ensureChrome();
  console.log(`ensureChrome: ${mode}`);

  const tabRes = await fetch(`${CDP}/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status}`);
  const page = await tabRes.json();
  tabId = page.id;
  const ws = await connect(page.webSocketDebuggerUrl);

  // Fresh profile: load /, hop to #/chat exactly like the boot gate does.
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  const booted = await waitFor(
    ws,
    `document.readyState === "complete" && document.body && document.body.innerText.length > 0`
  );
  console.log(`booted: ${booted}`);
  await evalJs(ws, `location.hash = "#/chat"; true`).catch(() => {});
  const mounted = await waitFor(
    ws,
    `document.body.innerText.includes("Converse with your agents")`,
    15_000
  );
  console.log(`chat TopBar title seen (view mounted): ${mounted}`);

  // EVIDENCE DUMP — the whole point: what is actually in the content area?
  const evidence = await evalJs(
    ws,
    `JSON.stringify({
      hash: location.hash,
      noChatSelected: document.body.innerText.includes("No chat selected"),
      devOverlay: Boolean(document.querySelector("nextjs-portal")),
      appErrorText: document.body.innerText.includes("Application error") ||
                    document.body.innerText.includes("This page could not be rendered"),
      mainHeadings: [...document.querySelectorAll("main h1, main h2, main h3")]
        .map((h) => h.textContent?.trim()).filter(Boolean).slice(0, 12),
      mainAriaLabels: [...document.querySelectorAll("main [aria-label]")]
        .map((e) => e.getAttribute("aria-label")).slice(0, 25),
      mainText: (document.querySelector("main")?.innerText ?? "(no <main>)")
        .replace(/\\s+/g, " ").slice(0, 1600),
      lsKeys: Object.keys(localStorage).slice(0, 30),
    })`,
  ).catch((e) => "probe-err:" + e.message);
  console.log("EVIDENCE:", evidence);

  await closeTab();
  try { ws.close(); } catch { /* best effort */ }
}

main().catch(async (e) => {
  console.error("FATAL:", e?.message ?? e);
  await closeTab();
  process.exit(1);
});
