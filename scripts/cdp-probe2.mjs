import { ensureChrome } from "./cdp-ensure-chrome.mjs";
let msgId = 0; const pending = new Map();
function wsSend(ws, method, params = {}) { const id = ++msgId; ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); setTimeout(() => reject(new Error("timeout")), 20000); }); }
async function connect(wsUrl) { const ws = new WebSocket(wsUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); } }; return ws; }
async function evalJs(ws, expression) { const r = await wsSend(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval"); return r.result?.value; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await ensureChrome();
const tabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
const ws = await connect((await tabRes.json()).webSocketDebuggerUrl);
await wsSend(ws, "Page.enable"); await wsSend(ws, "Runtime.enable");
await wsSend(ws, "Page.navigate", { url: "http://localhost:3000" });
await sleep(3000);
for (let i = 0; i < 6; i++) { if (await evalJs(ws, `document.querySelectorAll('[data-wf-card]').length > 0`)) break; await sleep(1200); }
console.log(JSON.stringify(await evalJs(ws, `
  (() => {
    const c = [...document.querySelectorAll('[data-wf-card]')].find((e) => (e.textContent || "").includes("QA Seeded Pipeline"));
    if (!c) return { found: false };
    const interactives = [...c.querySelectorAll("button,a,[role=button]")].map((e) => ({ tag: e.tagName, label: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 60) }));
    return { found: true, interactives, dataOpen: c.getAttribute("data-open"), html: c.outerHTML.slice(0, 400) };
  })()
`)));
ws.close();
