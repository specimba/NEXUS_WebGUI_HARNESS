import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// r132 diagnostic B: what opens after clicking the seeded workflow card?
let msgId = 0;
const pending = new Map();
function wsSend(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 20_000);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickByText = (label) => `
  (() => {
    const el = [...document.querySelectorAll('a,button,[role="button"],[role="menuitem"]')]
      .find((e) => (e.textContent || "").trim().toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())}) && e.offsetParent !== null);
    if (!el) return false;
    el.click();
    return true;
  })()`;

const BASE = "http://localhost:3000";
await ensureChrome();
const tabRes = await fetch(`http://127.0.0.1:9222/json/new`, { method: "PUT" });
const tab = await tabRes.json();
const ws = await connect(tab.webSocketDebuggerUrl);
await wsSend(ws, "Page.enable");
await wsSend(ws, "Runtime.enable");
await wsSend(ws, "Page.navigate", { url: BASE });
await sleep(3000);

for (let i = 0; i < 6; i++) {
  if (await evalJs(ws, `document.querySelectorAll('[data-wf-card]').length > 0`)) break;
  await sleep(1200);
  await evalJs(ws, clickByText("Workflows"));
}
console.log("cards:", await evalJs(ws, `document.querySelectorAll('[data-wf-card]').length`));

const clicked = await evalJs(ws, `
  (() => {
    const c = [...document.querySelectorAll('[data-wf-card]')]
      .find((e) => (e.textContent || "").includes("QA Seeded Pipeline"));
    if (!c) return false;
    c.click();
    return true;
  })()
`);
console.log("seed card clicked:", clicked);
await sleep(1800);
console.log("after card click:", JSON.stringify(await evalJs(ws, `document.body.innerText.slice(0, 500)`)));

const hist = await evalJs(ws, clickByText("Run history"));
console.log("run-history clicked:", hist);
await sleep(1200);
console.log("history state:", JSON.stringify(await evalJs(ws, `
  (() => {
    const rows = document.querySelectorAll('button[aria-label^="View run from"]').length;
    const toggles = document.querySelectorAll('button[aria-label*="recorded LLM calls"]').length;
    const t = document.body.innerText;
    return { rows, toggles, hasHistory: /Run history/.test(t), hasTask: /call-log expander/.test(t), sample: t.slice(0, 350) };
  })()
`)));

await wsSend(ws, "Page.close");
ws.close();
