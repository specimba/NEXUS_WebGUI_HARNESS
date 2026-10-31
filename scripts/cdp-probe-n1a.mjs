import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// N1a probe: after opening the run panel on a workflow whose runs[0] is
// status "running", is the panel in the EMPTY state, or the run DETAIL?
import path from "node:path";
let msgId = 0;
const pending = new Map();
function wsSend(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(`timeout ${method}`))), 90_000);
  });
}
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws")); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
    }
  };
  return ws;
}
async function evalJs(ws, expression) {
  const r = await wsSend(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval");
  return r.result?.value;
}
const BASE = "http://localhost:3000";
const WF_NAME = "qa-n1a probe pipeline";
await ensureChrome();
const tabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
const tab = await tabRes.json();
const ws = await connect(tab.webSocketDebuggerUrl);
await wsSend(ws, "Page.enable");
await wsSend(ws, "Runtime.enable");
console.error("step:navigate");
await wsSend(ws, "Page.navigate", { url: BASE });
console.error("step:navigated");
const waitFor = async (expr, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evalJs(ws, `Boolean(${expr})`)) return true; await new Promise(r => setTimeout(r, 300)); }
  return false;
};
await waitFor(`document.readyState === "complete"`);
console.error("step:ready");
await new Promise(r => setTimeout(r, 1500));
const snap = await evalJs(ws, `localStorage.getItem("praison-workflows")`);
console.error("step:snap");
const now = Date.now();
await evalJs(ws, `(() => {
  let seed = null;
  try { seed = JSON.parse(localStorage.getItem("praison-workflows") || "null"); } catch {}
  const workflows = (seed?.state?.workflows ?? []).filter((w) => !(w.name || "").includes("qa-n1a"));
  workflows.push({
    id: "qa-n1a-wf", name: ${JSON.stringify(WF_NAME)}, description: "probe",
    steps: [{ id: "s1", agentId: "a1", label: "Research" }],
    runs: [
      { id: "qa-n1a-running", task: "qa-n1a STREAM", status: "running", startedAt: now0 - 60000,
        steps: [
          { stepId: "st1", agentId: "a1", agentName: "Scout", agentEmoji: "🔎", label: "R", status: "done", output: "partial", toolCalls: [], ms: 100 },
          { stepId: "st2", agentId: "a1", agentName: "Scout", agentEmoji: "🔎", label: "S", status: "pending", output: "", toolCalls: [] },
        ] },
      { id: "qa-n1a-done", task: "qa-n1a DONE ROW", status: "done", startedAt: now0 - 3600000, finishedAt: now0 - 3500000,
        steps: [{ stepId: "st1", agentId: "a1", agentName: "Scout", agentEmoji: "🔎", label: "R", status: "done", output: "done-out", toolCalls: [], ms: 100 }] },
    ],
    createdAt: now0 - 90000, updatedAt: now0,
  });
  const next = { state: { ...(seed?.state ?? {}), workflows }, version: seed?.version ?? 0 };
  localStorage.setItem("praison-workflows", JSON.stringify(next));
  return true;
})()`.replaceAll("now0", String(now)));
await wsSend(ws, "Page.navigate", { url: BASE });
await waitFor(`document.readyState === "complete"`);
await new Promise(r => setTimeout(r, 2500));
// land on Workflows
await evalJs(ws, `(() => { const el = [...document.querySelectorAll("button,a")].find(e => /^Workflows/.test((e.textContent||"").trim()) && e.offsetParent !== null); if (el) el.click(); return Boolean(el); })()`);
await waitFor(`[...document.querySelectorAll("button")].some(b => (b.textContent||"").trim() === "Run" && b.offsetParent !== null)`, 30000);
await new Promise(r => setTimeout(r, 800));
console.error("step:pre-click");
const clicked = await evalJs(ws, `(() => {
  const btns = [...document.querySelectorAll("button")].filter(b => (b.textContent||"").trim() === "Run" && b.offsetParent !== null);
  const b = btns.find(x => { const c = x.closest('[data-slot="card"]'); return c && (c.textContent||"").includes(${JSON.stringify(WF_NAME)}); });
  if (!b) return false; b.click(); return true;
})()`);
await new Promise(r => setTimeout(r, 2500));
console.error("step:pre-diag");
const diag = await evalJs(ws, `(() => {
  const t = document.body.innerText;
  return {
    clicked: ${clicked},
    emptyState: t.includes("Describe a task above and hit Run"),
    taskLine: t.includes("Task: qa-n1a STREAM"),
    pendingCopy: t.includes("Waiting for the previous step to finish"),
    runningDot: t.includes("Running…"),
    doneRowVisible: t.includes("qa-n1a DONE ROW"),
    streamTaskVisible: t.includes("qa-n1a STREAM"),
    historyBtn: Boolean(document.querySelector('button[aria-label="Toggle run history"]')),
  };
})()`);
console.log(JSON.stringify(diag, null, 2));
const effectLog = await evalJs(ws, `JSON.stringify(window.__n1aLog ?? [])`);
console.log("effect-log:", effectLog);
await evalJs(ws, snap == null ? `localStorage.removeItem("praison-workflows"); true` : `localStorage.setItem("praison-workflows", ${JSON.stringify(snap)}); true`);
process.exit(0);
