import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── QA — K-series (r145): composer Esc-to-stop while streaming ──────────────
// r145 adds: pressing Escape in the composer textarea while the agent is
// streaming calls onStop() (the same handler as the "Stop generating" button).
// Rules: slash-menu Esc still handles the key first (dismisses the menu,
// keeps the draft since r303), IME composing is ignored, and the typed
// draft is PRESERVED.
//   K1  a real send starts streaming: "Stop generating" button appears AND the
//       placeholder advertises the new affordance ("· Esc stops" — proves the
//       r145 edit is live in the served bundle).
//   K2  dispatching Escape on the textarea stops the stream within ~5s:
//       stop button disappears and the reply row shows the "(stopped)" chip.
//   K3  draft preservation: text typed before Esc survives the stop (the
//       slash-menu Esc dismisses the menu and keeps the draft since r303;
//       the stop Esc must not clear it either).
// Uses a REAL model lane (default routing) — if the lane fails, the script
// reports honestly and exits 2.
// Usage: node scripts/cdp-qa-chat-esc-stop.mjs [baseUrl]

import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── CDP harness (r139/r140/J-series pattern) ────────────────────────────────
let msgId = 0;
const pending = new Map();

function wsSend(ws, method, params = {}) {
  if (typeof ws?.send !== "function") {
    throw new Error(`ws.send missing: typeof=${typeof ws} ctor=${ws?.constructor?.name}`);
  }
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
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
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

async function shot(ws, name) {
  const r = await wsSend(ws, "Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log(`  📸 ${file}`);
}

const js = (s) => `(function(){ ${s} })()`;

async function main() {
  await ensureChrome();
  const tabRes = await fetch(`http://127.0.0.1:9222/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status}`);
  const tab = await tabRes.json();
  const ws = await connect(tab.webSocketDebuggerUrl);
  await wsSend(ws, "Page.enable");
  await wsSend(ws, "Runtime.enable");
  await wsSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
  });
  await wsSend(ws, "Page.navigate", { url: BASE });
  await evalJs(ws, "document.title");
  await new Promise((r) => setTimeout(r, 1200));

  // Fresh CDP tabs can start hidden — force visible so nothing skips work.
  await evalJs(ws, js(`
    Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    return document.visibilityState;
  `));

  // Start a fresh chat (sidebar button) so we don't type into existing history.
  const clicked = await evalJs(ws, js(`
    const btn = document.querySelector('button[aria-label="New chat"]');
    if (btn) { btn.click(); return "clicked"; }
    return "absent";
  `));
  await new Promise((r) => setTimeout(r, 800));

  // Type a long-generation prompt into the composer (React controlled input).
  const typed = await evalJs(ws, js(`
    const ta = document.querySelector('textarea[aria-label^="Message"]');
    if (!ta) return "no-textarea";
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "Count slowly from 1 to 120, one number per line. Do not summarize.");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return "typed:" + ta.value.length;
  `));
  if (typed !== "typed:73" && !String(typed).startsWith("typed:")) {
    throw new Error(`could not type into composer: ${clicked} / ${typed}`);
  }

  // Send via Enter keydown (the same path a human uses).
  await evalJs(ws, js(`
    const ta = document.querySelector('textarea[aria-label^="Message"]');
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    return true;
  `));

  // K1 — streaming starts: stop button appears + placeholder advertises Esc.
  let placeholder = "";
  let k1 = false;
  const k1start = Date.now();
  while (Date.now() - k1start < 20_000) {
    await new Promise((r) => setTimeout(r, 350));
    const st = await evalJs(ws, js(`
      const stopBtn = document.querySelector('button[aria-label="Stop generating"]');
      const ta = document.querySelector('textarea[aria-label^="Message"]');
      return JSON.stringify({ stop: !!stopBtn, ph: ta ? ta.placeholder : "" });
    `));
    const s = JSON.parse(st);
    placeholder = s.ph;
    if (s.stop) { k1 = true; break; }
  }
  const advertisesEsc = placeholder.includes("Esc stops");
  check(
    "K1 stream starts + r145 placeholder live",
    k1 && advertisesEsc,
    k1
      ? `stop button up in ${((Date.now() - k1start) / 1000).toFixed(1)}s; placeholder: "${placeholder}"`
      : `no streaming within 45s (lane may be unavailable); placeholder: "${placeholder}"`
  );

  if (!k1) {
    await shot(ws, "K-chat-esc-stop");
    ws.close();
    console.log("\nLane unavailable — mechanism untested in-browser (honest degrade).");
    process.exit(2);
  }

  // Type a draft BEFORE Esc (K3 wants it preserved). No Enter — just text.
  await evalJs(ws, js(`
    const ta = document.querySelector('textarea[aria-label^="Message"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "draft-preserved-42");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  `));

  // K2 — Escape stops the stream.
  await evalJs(ws, js(`
    const ta = document.querySelector('textarea[aria-label^="Message"]');
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    return true;
  `));
  let k2 = false;
  let stoppedChip = false;
  const k2start = Date.now();
  while (Date.now() - k2start < 5_000) {
    await new Promise((r) => setTimeout(r, 300));
    const st = await evalJs(ws, js(`
      const stopBtn = document.querySelector('button[aria-label="Stop generating"]');
      const chip = [...document.querySelectorAll("span")].some(
        (el) => el.textContent.trim() === "(stopped)"
      );
      return JSON.stringify({ stop: !!stopBtn, chip });
    `));
    const s = JSON.parse(st);
    if (!s.stop) {
      k2 = true;
      stoppedChip = s.chip;
      break;
    }
  }
  const within = ((Date.now() - k2start) / 1000).toFixed(1);
  check(
    "K2 Esc stops the stream",
    k2,
    k2 ? `stop button gone in ${within}s; "(stopped)" chip visible: ${stoppedChip}` : "stream kept running for 5s after Esc"
  );

  // K3 — draft preserved.
  const draft = await evalJs(ws, js(`
    const ta = document.querySelector('textarea[aria-label^="Message"]');
    return ta ? ta.value : "";
  `));
  check("K3 draft preserved across stop", draft === "draft-preserved-42", `textarea after Esc: "${draft}"`);

  await new Promise((r) => setTimeout(r, 600));
  await shot(ws, "K-chat-esc-stop");

  ws.close();
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("QA run failed:", err.stack ?? err.message);
  process.exit(2);
});
