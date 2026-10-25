import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── QA — r522 golden paths (patrol job 473388) ─────────────────────────────
// Settings → Model Relay (intel ladder), Radar → Frontier tab scroll,
// Workflows → run-panel long-paste into a step. Console must stay 0 errors.
// Usage: node scripts/cdp-qa-golden-r522.mjs [baseUrl]

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

let msgId = 0;
const pending = new Map();
const consoleErrors = [];

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
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params?.exceptionDetails;
      consoleErrors.push(d?.exception?.description ?? d?.text ?? "exception");
    } else if (msg.method === "Log.entryAdded" && msg.params?.entry?.level === "error") {
      consoleErrors.push(msg.params.entry.text ?? "log error");
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

const js = (s) => `(function(){ ${s} })()`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(ws, name) {
  const r = await wsSend(ws, "Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT_DIR, `r522-${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log(`  📸 ${file}`);
}

async function waitBodyText(ws, marker, ms = 20000) {
  return evalJs(ws, js(`
    return new Promise((resolve) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        if (document.body.textContent.includes(${JSON.stringify(marker)})) {
          clearInterval(iv); return resolve(true);
        }
        if (performance.now() - t0 > ${ms}) { clearInterval(iv); return resolve(false); }
      }, 120);
    });
  `));
}

async function main() {
  await ensureChrome();
  const tabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status}`);
  const tab = await tabRes.json();
  try {
    const ws = await connect(tab.webSocketDebuggerUrl);
    await wsSend(ws, "Page.enable");
    await wsSend(ws, "Runtime.enable");
    await wsSend(ws, "Log.enable");
    await wsSend(ws, "Page.navigate", { url: BASE });
    await evalJs(ws, "document.title");
    await sleep(2000);

    // wait for app chrome (nav buttons) past the boot gate
    const booted = await evalJs(ws, js(`
      return new Promise((resolve) => {
        const t0 = performance.now();
        const iv = setInterval(() => {
          const b = [...document.querySelectorAll("button, a")].some((x) => (x.textContent ?? "").includes("Workflows"));
          if (b) { clearInterval(iv); return resolve(true); }
          if (performance.now() - t0 > 25000) { clearInterval(iv); return resolve(false); }
        }, 150);
      });
    `));
    check("app boots to nav chrome", booted === true);

    // ── 1) Settings → Model Relay ──
    await evalJs(ws, js(`location.hash = "#/settings"; return location.hash;`));
    await sleep(1200);
    const relayClicked = await evalJs(ws, js(`
      const b = [...document.querySelectorAll("button, a")].find((x) => (x.textContent ?? "").includes("Model Relay"));
      if (b) { b.click(); return true; }
      return false;
    `));
    const relayVisible = relayClicked && (await waitBodyText(ws, "Model Relay", 10000));
    const intelVisible = await waitBodyText(ws, "Intel", 8000);
    check("Settings → Model Relay renders", relayVisible === true);
    check("Model Relay intel ladder present", intelVisible === true);
    await shot(ws, "settings-relay");

    // ── 2) Radar → Frontier tab + scroll ──
    await evalJs(ws, js(`location.hash = "#/radar"; return location.hash;`));
    const radarUp = await waitBodyText(ws, "Frontier", 15000);
    await evalJs(ws, js(`
      const b = [...document.querySelectorAll("button, [role='tab']")].find((x) => (x.textContent ?? "").trim() === "Frontier");
      if (b) b.click();
      return true;
    `));
    await sleep(1500);
    const scrolled = await evalJs(ws, js(`
      const els = [...document.querySelectorAll("*")];
      const sc = els.find((e) => e.scrollHeight > e.clientHeight + 100 && e.clientHeight > 120);
      if (!sc) return "no-scrollable";
      sc.scrollTop = 240;
      return sc.scrollTop > 0 ? "scrolled:" + sc.scrollTop : "scroll-refused";
    `));
    check("Radar → Frontier tab renders", radarUp === true);
    check("Radar Frontier content scrolls", typeof scrolled === "string" && scrolled.startsWith("scrolled"), String(scrolled));
    await shot(ws, "radar-frontier");

    // ── 3) Workflows → run panel long-paste into a step ──
    await evalJs(ws, js(`location.hash = "#/workflows"; return location.hash;`));
    const wfUp = await waitBodyText(ws, "Workflow Studio", 20000);
    await sleep(1200);
    const paste = await evalJs(ws, js(`
      const tas = [...document.querySelectorAll("textarea")];
      if (tas.length === 0) return "no-textarea";
      const ta = tas[0];
      ta.focus();
      ta.select?.();
      document.execCommand("insertText", false, "r522-longpaste ".repeat(400));
      return "pasted:" + ta.value.length;
    `));
    const pasteOk = typeof paste === "string" && paste.startsWith("pasted:") && parseInt(paste.split(":")[1], 10) >= 4000;
    check("Workflows view mounts", wfUp === true);
    check("run-panel step long-paste holds ≥4000 chars", pasteOk, String(paste));
    const runBtn = await evalJs(ws, js(`
      const b = [...document.querySelectorAll("button")].find((x) => /^(Run|Run now|Fire run)/.test((x.textContent ?? "").trim()));
      return b ? "run-btn:" + b.textContent.trim() : "no-run-btn";
    `));
    check("Run control reachable", typeof runBtn === "string" && runBtn.startsWith("run-btn"), String(runBtn));
    await shot(ws, "workflows-paste");

    // ── 4) drawer: server-run card → Copy-report button (r523) ──
    const cardClicked = await evalJs(ws, js(`
      const b = [...document.querySelectorAll("button")].find((x) => (x.title ?? "").includes("click to inspect"));
      if (b) { b.click(); return true; }
      return false;
    `));
    if (cardClicked) {
      await sleep(700);
      const copyBtn = await evalJs(ws, js(`
        const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Copy run report to clipboard");
        if (b) { b.click(); return "clicked"; }
        return "missing";
      `));
      check("drawer Copy-report present & clickable", copyBtn === "clicked", String(copyBtn));
      await evalJs(ws, js(`
        const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Close server run detail");
        if (b) b.click();
        return true;
      `));
      await sleep(400);
    } else {
      console.log("  (no server-run card present — drawer check skipped this round)");
    }

    // ── console hygiene ──
    await sleep(800);
    check("console 0 errors across all golden paths", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

    await fetch(`http://127.0.0.1:9222/json/close/${tab.id}`).catch(() => {});
    ws.close();
    const pass = results.filter((r) => r.ok).length;
    console.log(`\n${pass}/${results.length} checks passed`);
    process.exit(pass === results.length ? 0 : 1);
  } catch (e) {
    await fetch(`http://127.0.0.1:9222/json/close/${tab.id}`).catch(() => {});
    throw e;
  }
}

main().catch((err) => {
  console.error("QA run failed:", err.stack ?? err.message);
  process.exit(2);
});
