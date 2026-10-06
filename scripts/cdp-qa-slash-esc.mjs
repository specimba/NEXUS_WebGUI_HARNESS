import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── QA — E-series (r303): slash-menu Esc DISMISSES, never wipes the draft ───
// Before r303, pressing Escape while the slash menu was open ran setValue(""),
// deleting the whole draft — even though the menu header promises "Esc to
// dismiss" and r144's philosophy is that dismissing things preserves typed
// text. The branch also lacked the isComposing guard the other keys have
// (r245 class): Esc cancels a CJK composition and must not be treated as
// "dismiss the menu" while composing.
//   E1  typing "/the" opens the menu filtered to /theme; draft intact.
//   E2  (fix witness) Escape closes the menu and the draft "/the" SURVIVES
//       (pre-r303 this assert fails: the textarea was emptied).
//   E3  editing the draft re-summons the menu ("/the" → "/theme").
//   E4  a second Escape dismisses again WITHOUT running the command (no theme
//       toggle side effect) and keeps the draft.
//   E5  IME parity: Escape with isComposing:true while the menu is open is
//       ignored — menu stays open, draft untouched.
// No reload, no message sent, no localStorage seeding — the only app-side
// state touched is one fresh chat (same precedent as cdp-qa-chat-esc-stop).
// Usage: node scripts/cdp-qa-slash-esc.mjs [baseUrl]

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

// ── CDP harness (r139/r140/J/K-series pattern) ───────────────────────────────
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

async function shot(ws, name) {
  const r = await wsSend(ws, "Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log(`  📸 ${file}`);
}

const js = (s) => `(function(){ ${s} })()`;

// React-controlled textarea typing (prototype setter + input event).
const TYPE_JS = (text) => js(`
  const ta = document.querySelector('textarea[aria-label^="Message"]');
  if (!ta) return "no-textarea";
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(ta, ${JSON.stringify(text)});
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  return "typed:" + ta.value;
`);

// Menu visibility + textarea value in one probe (textContent per doctrine).
const PROBE_JS = js(`
  const menu = document.querySelector('[role="listbox"][aria-label="Slash commands"]');
  const ta = document.querySelector('textarea[aria-label^="Message"]');
  return JSON.stringify({ open: !!menu, items: menu ? menu.textContent : "", value: ta ? ta.value : "" });
`);

const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

async function pressEscape(ws, composing = false) {
  await evalJs(ws, js(`
    const ta = document.querySelector('textarea[aria-label^="Message"]');
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", code: "Escape", bubbles: true, cancelable: true,
      isComposing: ${composing ? "true" : "false"}
    }));
    return true;
  `));
}

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
  // Dev-server first compile can take seconds — poll for the app shell.
  // NOTE: the landing view may be ANY view (radar has no composer textarea),
  // so poll for the sidebar's New Chat button, not the composer.
  let booted = false;
  for (let i = 0; i < 30; i++) {
    await settle(1000);
    const shell = await evalJs(ws, js(`return [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "New Chat");`));
    if (shell) { booted = true; break; }
  }
  if (!booted) throw new Error("app shell (New Chat button) never appeared after 30s");

  // Fresh CDP tabs can start hidden — force visible so nothing skips work.
  await evalJs(ws, js(`
    Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    return document.visibilityState;
  `));

  // Console hygiene watch (no reload in this suite — seed early, read at end).
  await evalJs(ws, js(`
    window.__errs = window.__errs ?? [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason?.message ?? e.reason)));
    return true;
  `));

  // Fresh chat so we don't type into existing history (K-series precedent).
  // The New Chat sidebar button is TEXT-only (no aria-label — shell.tsx), and
  // the app can land on any view (radar etc.), so find it by visible text.
  await evalJs(ws, js(`
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "New Chat"
    );
    if (btn) { btn.click(); return "clicked"; }
    return "absent";
  `));
  await settle(800);
  // Re-poll for the composer in case the fresh-chat switch remounts the view.
  let composer = false;
  for (let i = 0; i < 20; i++) {
    const here = await evalJs(ws, js(`return !!document.querySelector('textarea[aria-label^="Message"]');`));
    if (here) { composer = true; break; }
    await settle(500);
  }
  if (!composer) throw new Error("composer textarea gone after New chat");

  // E1 — "/the" opens the menu, filtered to /theme.
  const t1 = await evalJs(ws, TYPE_JS("/the"));
  if (!String(t1).startsWith("typed:")) throw new Error(`could not type into composer: ${t1}`);
  await settle();
  const p1 = JSON.parse(await evalJs(ws, PROBE_JS));
  check(
    "E1 '/the' opens menu filtered to /theme",
    p1.open && p1.value === "/the" && p1.items.includes("/theme"),
    `open=${p1.open} value="${p1.value}" itemsContainTheme=${p1.items.includes("/theme")}`
  );

  // E2 — (fix witness) Escape dismisses the menu, draft "/the" SURVIVES.
  await pressEscape(ws);
  await settle();
  const p2 = JSON.parse(await evalJs(ws, PROBE_JS));
  check(
    "E2 Esc dismisses menu, draft survives",
    !p2.open && p2.value === "/the",
    `menuOpen=${p2.open} value="${p2.value}" (pre-r303 value would be "")`
  );
  if (!(!p2.open && p2.value === "/the")) await shot(ws, "E-slash-esc-fail");

  // E3 — editing the draft re-summons the menu.
  await evalJs(ws, TYPE_JS("/theme"));
  await settle();
  const p3 = JSON.parse(await evalJs(ws, PROBE_JS));
  check(
    "E3 editing the draft re-summons the menu",
    p3.open && p3.value === "/theme",
    `open=${p3.open} value="${p3.value}"`
  );

  // E4 — second Escape dismisses again WITHOUT running /theme (no theme
  // toggle side effect) and keeps the draft.
  await pressEscape(ws);
  await settle();
  const p4 = JSON.parse(await evalJs(ws, PROBE_JS));
  check(
    "E4 Esc dismisses without running the command",
    !p4.open && p4.value === "/theme",
    `menuOpen=${p4.open} value="${p4.value}"`
  );

  // E5 — IME parity: Escape with isComposing:true is ignored by the menu.
  await evalJs(ws, TYPE_JS("/th"));
  await settle();
  const preP5 = JSON.parse(await evalJs(ws, PROBE_JS));
  if (!preP5.open) {
    check("E5 IME-composing Esc ignored (menu open precondition)", false, `menu never opened for "/th"`);
  } else {
    await pressEscape(ws, true);
    await settle();
    const p5 = JSON.parse(await evalJs(ws, PROBE_JS));
    check(
      "E5 IME-composing Esc ignored",
      p5.open && p5.value === "/th",
      `menuOpen=${p5.open} value="${p5.value}" (composing Esc must not dismiss or wipe)`
    );
    if (!(p5.open && p5.value === "/th")) await shot(ws, "E-slash-esc-ime-fail");
  }

  // Console hygiene — read at the end (no reload happened in this suite).
  await settle(400);
  const errs = (await evalJs(ws, `window.__errs`)) ?? [];
  check("E6 console clean", errs.length === 0, errs.length ? errs.slice(0, 3).join(" | ") : "no errors/unhandled rejections");
  if (errs.length) await shot(ws, "E-slash-esc-console-fail");

  await shot(ws, "E-slash-esc");
  ws.close();
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("QA run failed:", err.stack ?? err.message);
  process.exit(2);
});
