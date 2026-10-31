import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — K-series (r225): agent form name validation is inline & honest ──
// The r225 change: the Create/Edit Agent dialog's name validation used to be
// SPLIT — an empty name got the browser's native `required` bubble (unstyled,
// not focus-managed) while a whitespace-only name sailed past `required` and
// got only a transient toast with zero field-level feedback. Now the form is
// noValidate, both paths land on ONE inline state: error text under the field
// (id=agent-name-error), aria-invalid + aria-describedby, destructive ring,
// focus pulled to the input, and the error clears as soon as a real name is
// typed.
// Asserts end-to-end against the live dev server:
//   K1  Agents view reachable from ANY persisted view (never assume), dialog
//       opens; form carries noValidate (native bubble path is off)
//   K2  submit with EMPTY name → inline error <p>, aria-invalid, focus pulled
//       to #agent-name, dialog still open
//   K3  submit with WHITESPACE-only name → same inline state (pre-fix: a
//       toast-only dead end with a clean-looking field)
//   K4  typing a real name clears the error immediately (aria-invalid gone,
//       error <p> gone) — no submit needed
//   K5  valid submit → "Agent created" toast, dialog closes; praison-agents
//       localStorage restored — zero qa-r225 agents remain
// Hygiene doctrine: snapshot praison-agents on first load, restore in K5.
// r223/r224 lessons: boot chrome + run in ONE shell command; never assume the
// chat view is showing (ui store persists the last view). Launch
// chrome-headless-shell on :9222 first.
// Usage: node scripts/cdp-qa-agent-form-validation.mjs [baseUrl]
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
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 60_000);
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
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
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

async function waitFor(ws, expr, timeoutMs = 30_000, everyMs = 400) {
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

// Visible-element selectors (regex-text finds; no escaping traps).
const NEW_AGENT_BTN = `[...document.querySelectorAll("button")].find(
  (b) => /^New Agent/.test((b.textContent || "").trim()) && b.offsetParent !== null)`;
const CREATE_AGENT_BTN = `[...document.querySelectorAll("button")].find(
  (b) => /^Create agent$/.test((b.textContent || "").trim()) && b.offsetParent !== null)`;
const DIALOG_TITLE = `[...document.querySelectorAll("h2")].find(
  (h) => /^Create Agent$/.test((h.textContent || "").trim()) && h.offsetParent !== null)`;
const NAME_ERROR_P = `[...document.querySelectorAll("p#agent-name-error")].find(
  (p) => p.offsetParent !== null)`;
const NAME_INPUT = `document.querySelector("input#agent-name")`;
const NAME_INVALID = `${NAME_INPUT} && ${NAME_INPUT}.getAttribute("aria-invalid") === "true"`;
const FOCUS_IS_NAME = `document.activeElement === ${NAME_INPUT}`;
const AGENTS_NAV = `(() => {
  const el = [...document.querySelectorAll("button,a")].find(
    (e) => /^Agents/.test((e.textContent || "").trim()) && e.offsetParent !== null);
  if (!el) return false;
  el.click();
  return true;
})()`;

async function gotoApp(ws) {
  await wsSend(ws, "Page.navigate", { url: BASE });
  await evalJs(ws, "document.title");
  await waitFor(ws, `document.readyState === 'complete'`);
  await new Promise((r) => setTimeout(r, 2000));
  // The ui store persists the last view — land on Agents explicitly.
  if (!(await evalJs(ws, `Boolean(${NEW_AGENT_BTN})`))) {
    await evalJs(ws, AGENTS_NAV);
    await waitFor(ws, `Boolean(${NEW_AGENT_BTN})`, 45_000);
  }
}

async function openDialog(ws) {
  await evalJs(ws, `${NEW_AGENT_BTN}.click()`);
  const open = await waitFor(ws, `Boolean(${DIALOG_TITLE})`, 15_000);
  if (!open) throw new Error("Create Agent dialog did not open");
  await new Promise((r) => setTimeout(r, 400));
}

async function submit(ws) {
  const btn = await evalJs(ws, `(${CREATE_AGENT_BTN}) ? true : false`);
  if (!btn) throw new Error("submit button 'Create agent' not found");
  await evalJs(ws, `${CREATE_AGENT_BTN}.click()`);
}

/** Set the name input through the native setter so React onChange fires. */
async function typeName(ws, value) {
  await evalJs(ws, `(() => {
    const input = document.querySelector("input#agent-name");
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 300));
}

async function main() {
  // Browser boot
  await ensureChrome();
  const tabRes = await fetch(`http://127.0.0.1:9222/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status} — is chrome-headless-shell up?`);
  const tab = await tabRes.json();
  const ws = await connect(tab.webSocketDebuggerUrl);
  try {
    await wsSend(ws, "Page.enable");
    await wsSend(ws, "Runtime.enable");
    await wsSend(ws, "Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });

    // First load: snapshot the agents store before we touch anything.
    await gotoApp(ws);
    const snapshot = await evalJs(ws, `localStorage.getItem("praison-agents")`);

    // K1 — dialog opens from any persisted view; native bubble path is off
    await openDialog(ws);
    const noValidate = await evalJs(ws, `(() => {
      const f = document.querySelector("form");
      return Boolean(f && f.noValidate);
    })()`);
    check("K1a dialog opens on Agents view, form is noValidate", noValidate,
      `noValidate=${noValidate}`);

    // K2 — EMPTY name: inline error, aria-invalid, focus pulled, dialog stays
    await evalJs(ws, `document.querySelector("input#agent-emoji")?.focus()`);
    await submit(ws);
    await waitFor(ws, `Boolean(${NAME_ERROR_P})`, 5_000);
    const k2err = await evalJs(ws, `Boolean(${NAME_ERROR_P})`);
    const k2inv = await evalJs(ws, `Boolean(${NAME_INVALID})`);
    const k2focus = await evalJs(ws, `Boolean(${FOCUS_IS_NAME})`);
    const k2open = await evalJs(ws, `Boolean(${DIALOG_TITLE})`);
    const k2desc = await evalJs(ws,
      `${NAME_INPUT} && ${NAME_INPUT}.getAttribute("aria-describedby") === "agent-name-error"`);
    check("K2 empty submit → inline error text at the field", k2err);
    check("K2 aria-invalid=true + aria-describedby wired", k2inv && k2desc,
      `invalid=${k2inv} describedby=${k2desc}`);
    check("K2 focus pulled to the name input", k2focus);
    check("K2 dialog stays open", k2open);
    await shot(ws, "K2-inline-error");

    // K3 — WHITESPACE-only name: same honest inline state (pre-fix: a
    // transient toast with a clean-looking field and no pointer to it)
    await typeName(ws, "   ");
    await submit(ws);
    await new Promise((r) => setTimeout(r, 500));
    const k3err = await evalJs(ws, `Boolean(${NAME_ERROR_P})`);
    const k3inv = await evalJs(ws, `Boolean(${NAME_INVALID})`);
    const k3focus = await evalJs(ws, `Boolean(${FOCUS_IS_NAME})`);
    check("K3 whitespace-only submit → inline error still at the field", k3err && k3inv && k3focus,
      `err=${k3err} invalid=${k3inv} focus=${k3focus}`);

    // K4 — typing a real name clears the error WITHOUT submitting
    await typeName(ws, "qa-r225 pilot");
    await new Promise((r) => setTimeout(r, 300));
    const k4err = await evalJs(ws, `Boolean(${NAME_ERROR_P})`);
    const k4inv = await evalJs(ws, `Boolean(${NAME_INVALID})`);
    check("K4 typing a real name clears the error immediately", !k4err && !k4inv,
      `err=${k4err} invalid=${k4inv}`);

    // K5 — valid submit: toast, dialog closes, zero residue
    await submit(ws);
    const toastOk = await waitFor(ws,
      `[...document.querySelectorAll('[data-sonner-toast]')].some(
        (t) => /Agent created/.test(t.textContent || ""))`, 10_000);
    const dialogGone = await waitFor(ws, `!Boolean(${DIALOG_TITLE})`, 10_000);
    check("K5a valid submit → 'Agent created' toast, dialog closes", toastOk && dialogGone,
      `toast=${toastOk} closed=${dialogGone}`);

    // Hygiene — restore the agents store, reload, prove zero residue
    // r260: the restore write now happens from a bare same-origin JSON page
    // (gotoBare) — writing it on the live app page let the app's in-memory
    // persist race the foreign write and resurrect qa-r* rows before gotoApp
    // re-hydrated (the J5 race root-caused r259 on search-match-truth).
    const gotoBare = async (ws) => {
      await evalJs(ws, `window.__r260bare = 1`);
      await evalJs(ws, `location.href = "/api/providers/free-models"`);
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          if (String(await evalJs(ws, `window.__r260bare`)) !== "1") {
            if ((await evalJs(ws, `document.readyState`)) === "complete") return true;
          }
        } catch { /* execution context detached mid-navigation */ }
      }
      return false;
    };
    await gotoBare(ws);
    await evalJs(ws, snapshot === null
      ? `localStorage.removeItem("praison-agents"); true`
      : `localStorage.setItem("praison-agents", ${JSON.stringify(snapshot)}); true`);
    await gotoApp(ws);
    const residue = await evalJs(ws, `(() => {
      try {
        const s = JSON.parse(localStorage.getItem("praison-agents") || "null");
        return ((s?.state?.agents ?? [])).filter((a) => String(a.name || "").includes("qa-r225")).length;
      } catch { return -1; }
    })()`);
    check("K5b agents store restored — zero qa-r225 agents remain", residue === 0,
      `residue=${residue}`);
    await shot(ws, "K5-restored");
  } finally {
    try { ws.close(); } catch {}
    try { await fetch(`http://127.0.0.1:9222/json/close/${tab.id}`); } catch {}
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
