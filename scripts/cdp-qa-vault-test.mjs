import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — D-series (r135): "Test key" verify button (vault epic finale) ──
// Asserts the r135 affordance end-to-end against the live dev server:
//   D1  store a throwaway builtin key → Settings → vault card → click
//       "Test key" → success toast "Vault key verified" carrying the MASKED
//       key (qa-r••••2xyz) — and the RAW key must appear NOWHERE in the DOM.
//   D2  delete the key → reload → the "Test key" button must be ABSENT
//       (guard: no key ⇒ no test affordance) + honest empty state.
//   D3  vault left EMPTY (no residue — r133 discipline).
// The button dials POST /api/vault/consume exactly as the external headless
// scheduler would; this suite verifies the same contract from the browser.
// Reuses the r132/r134 harness lessons: hydration retry-click loop, new-tab
// CDP boot, persistent headless profile (throwaway only).
// Launch first (same shell as scripts/cdp-qa.mjs):
//   setsid ~/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell \
//     --headless --no-sandbox --disable-gpu --remote-allow-origins='*' \
//     --remote-debugging-port=9222 --window-size=1440,1000 about:blank &
// Usage: node scripts/cdp-qa-vault-test.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });
const QA_KEY = "qa-r135-test-key-42xyz";
const QA_MASK = "qa-r••••2xyz"; // mask(): first4 + •••• + last4 (len 22 > 12)

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

async function waitFor(ws, expr, timeoutMs = 15_000, everyMs = 400) {
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

const clickByText = (label) => `
  (() => {
    const el = [...document.querySelectorAll('a,button,[role="button"],[role="menuitem"]')]
      .find((e) => (e.textContent || "").trim().toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())}) && e.offsetParent !== null);
    if (!el) return false;
    el.click();
    return true;
  })()`;

async function retryClick(ws, label, tries = 6, gapMs = 800) {
  for (let i = 0; i < tries; i++) {
    if (await evalJs(ws, clickByText(label))) return true;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return false;
}

const testBtnExpr = `
  [...document.querySelectorAll('#vault button')].find(
    (b) => (b.textContent || "").trim().startsWith("Test key")
  )`;

async function gotoSettings(ws) {
  if (!(await retryClick(ws, "Settings"))) throw new Error("nav to Settings failed");
  // r218 fix: settings grew a TAB BAR after r135 — the vault card renders
  // only under the "Vault" tab, so switch to it (the old suite silently sat
  // on "What's fixed" and D1b's vacuous check(..., true) masked that).
  // ALSO: the dev server cold-compiles this view for >20s after a code edit,
  // so keep clicking until the surface really mounts (45s budget).
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    await evalJs(ws, `(() => {
      const t = [...document.querySelectorAll('button,[role="tab"],a')]
        .find((e) => (e.textContent || "").trim().toLowerCase() === "vault" && e.offsetParent !== null);
      if (t) t.click();
      return Boolean(t);
    })()`);
    if (await evalJs(ws, `Boolean(document.querySelector('#vault'))`)) {
      await new Promise((r) => setTimeout(r, 800)); // let the card fetch its slot
      return true;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

async function main() {
  // r326 incident guard: a populated user vault means REAL keys — abort
  // instead of upserting/deleting over them (the 2026-10-07 Vyce wipe).
  // r329: builtin-only mode — aborts only if a REAL builtin slot exists;
  // registry-provider slots (e.g. the user's Vyce key) coexist untouched.
  await (await import("./lib/qa-vault-guard.mjs")).assertBuiltinFreeOrAbort(BASE, "vault-test");

  // D0 — idempotent pre-clean
  await fetch(`${BASE}/api/vault?provider=builtin`, { method: "DELETE" });

  // Browser boot (r132 pattern)
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
  await waitFor(ws, `document.readyState === 'complete'`);
  await new Promise((r) => setTimeout(r, 2500));

  // D1 — happy path: store → card → Test key → verified toast (masked only)
  const storeRes = await fetch(`${BASE}/api/vault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "builtin", key: QA_KEY }),
  });
  check("D1a store throwaway vault key", storeRes.ok);

  await gotoSettings(ws);
  const testBtnReady = await waitFor(ws, `Boolean(${testBtnExpr})`, 15_000);
  check("D1b Test key button renders with a key stored", testBtnReady);

  for (let i = 0; i < 6; i++) {
    const clicked = await evalJs(ws, `${testBtnExpr}?.click() ?? false`);
    if (clicked) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  const toastOk = await waitFor(
    ws,
    `(document.querySelector('[data-sonner-toast]')?.innerText ?? "").includes("Vault key verified")`,
    12_000
  );
  const toastText = await evalJs(
    ws,
    `document.querySelector('[data-sonner-toast]')?.innerText ?? ""`
  );
  check(
    "D1c Test key → verified toast with masked key",
    toastOk && toastText.includes(QA_MASK),
    toastText.replace(/\n/g, " ").slice(0, 120)
  );

  const leak = await evalJs(ws, `document.body.innerText.includes(${JSON.stringify(QA_KEY)})`);
  check("D1d raw key never rendered in DOM", !leak);
  await shot(ws, "D1-test-key-toast");

  // D2 — no key ⇒ no affordance
  const delRes = await fetch(`${BASE}/api/vault?provider=builtin`, { method: "DELETE" });
  check("D2a delete throwaway key", delRes.ok);
  await evalJs(ws, `location.reload()`);
  await waitFor(ws, `document.readyState === 'complete'`);
  await new Promise((r) => setTimeout(r, 2500));
  await gotoSettings(ws);
  const guard = await evalJs(ws, `
    ({
      testBtnAbsent: !${testBtnExpr},
      emptyState: document.body.innerText.includes("No built-in slot stored"),
    })
  `);
  check(
    "D2b guard: Test key absent + empty state with no key",
    guard?.testBtnAbsent === true && guard?.emptyState === true,
    `btnAbsent=${guard?.testBtnAbsent} emptyState=${guard?.emptyState}`
  );

  // D3 — vault left EMPTY (no residue)
  const finalVault = await (await fetch(`${BASE}/api/vault`)).json();
  const hasBuiltin =
    Array.isArray(finalVault?.vault) &&
    finalVault.vault.some((s) => s.provider === "builtin");
  check("D3 vault left empty (no residue)", !hasBuiltin);

  await wsSend(ws, "Page.close").catch(() => {});
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks PASS`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("QA crashed:", e.message);
  process.exit(1);
});
