import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — F-series (r138): vault consume localhost-only guard ───────────
// The consume endpoint now ENFORCES the trust model documented in
// docs/LOCAL_AUTOMATION.md. Asserts, against the live dev server:
//   F1  legit local callers still pass — raw Host: localhost / 127.0.0.1
//       → 200 with the stored key intact.
//   F2–F7  hostile requests → 403 "localhost-only" BEFORE any key lookup
//       (403, not 404 — remote callers get no existence oracle):
//       public Host, LAN Host, x-forwarded-for, x-forwarded-host,
//       RFC 7239 forwarded, x-real-ip.
//   F8  browser "Test key" (legit caller #2) still shows the verified toast
//       with the masked key — the guard did not break the UI path.
//   F9  vault left EMPTY (no residue — r133 discipline).
// Raw-header requests use node:http (fetch forbids overriding Host); the
// browser path reuses the r132/r134/r135 CDP harness lessons (hydration
// retry-click, new-tab boot, persistent headless profile).
// Launch first (same shell as scripts/cdp-qa.mjs):
//   setsid ~/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell \
//     --headless --no-sandbox --disable-gpu --remote-allow-origins='*' \
//     --remote-debugging-port=9222 --window-size=1440,1000 about:blank &
// Usage: node scripts/cdp-qa-vault-guard.mjs [baseUrl]

import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const { port } = new URL(BASE);
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });
const QA_KEY = "qa-r138-guard-key-77xyz";
const QA_MASK = "qa-r••••7xyz"; // mask(): first4 + •••• + last4 (len 23 > 12)

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// Raw request with FULL header control (fetch would forbid Host overrides).
// Socket always dials 127.0.0.1 — only the Host/forwarding HEADERS vary.
function rawRequest({ hostHeader, extraHeaders = {}, body }) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      host: hostHeader,
      ...(data
        ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) }
        : {}),
      ...extraHeaders,
    };
    const req = http.request(
      { hostname: "127.0.0.1", port, method: "POST", path: "/api/vault/consume", headers },
      (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { buf += c; });
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(buf); } catch {}
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.setTimeout(20_000, () => req.destroy(new Error("rawRequest timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── CDP harness (same pattern as D-series) ──────────────────────────────────
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
    }, 20_000);
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
  await waitFor(ws, `Boolean(document.querySelector('#vault'))`, 15_000);
  await new Promise((r) => setTimeout(r, 800)); // let the card fetch its slot
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  // r326 incident guard: a populated user vault means REAL keys — abort
  // instead of upserting/deleting over them (the 2026-10-07 Vyce wipe).
  // r329: builtin-only mode — aborts only if a REAL builtin slot exists;
  // registry-provider slots (e.g. the user's Vyce key) coexist untouched.
  await (await import("./lib/qa-vault-guard.mjs")).assertBuiltinFreeOrAbort(BASE, "vault-guard");

  // F0 — idempotent pre-clean
  await fetch(`${BASE}/api/vault?provider=builtin`, { method: "DELETE" });

  const storeRes = await fetch(`${BASE}/api/vault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "builtin", key: QA_KEY }),
  });
  check("F1a store throwaway vault key", storeRes.ok);

  const rLoc = await rawRequest({ hostHeader: "localhost:3000", body: { provider: "builtin" } });
  check(
    "F1b Host localhost passes, key intact",
    rLoc.status === 200 && rLoc.json?.ok === true && rLoc.json?.key === QA_KEY,
    `status=${rLoc.status}`
  );

  const rIp = await rawRequest({ hostHeader: "127.0.0.1:3000", body: { provider: "builtin" } });
  check(
    "F1c Host 127.0.0.1 passes, key intact",
    rIp.status === 200 && rIp.json?.key === QA_KEY,
    `status=${rIp.status}`
  );

  // F2–F7 — negatives: 403 with the localhost-only error, BEFORE key lookup
  const negatives = [
    ["F2 public Host rejected", { hostHeader: "evil.example.com" }],
    ["F3 LAN Host rejected", { hostHeader: "192.168.1.50:3000" }],
    ["F4 x-forwarded-for (public) rejected", { hostHeader: "localhost:3000", extraHeaders: { "x-forwarded-for": "203.0.113.9" } }],
    ["F5 x-forwarded-host (tunnel) rejected", { hostHeader: "localhost:3000", extraHeaders: { "x-forwarded-host": "tunnel.example.com" } }],
    ["F6 forwarded RFC7239 rejected", { hostHeader: "localhost:3000", extraHeaders: { forwarded: "for=203.0.113.9" } }],
    ["F7 x-real-ip (public) rejected", { hostHeader: "localhost:3000", extraHeaders: { "x-real-ip": "203.0.113.9" } }],
  ];
  for (const [name, args] of negatives) {
    const r = await rawRequest({ ...args, body: { provider: "builtin" } });
    check(
      name,
      r.status === 403 && (r.json?.error ?? "").includes("localhost-only"),
      `status=${r.status} err=${(r.json?.error ?? "").slice(0, 70)}`
    );
  }

  // F8 — browser "Test key" (legit caller #2) still passes the guard
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

  await gotoSettings(ws);
  await waitFor(ws, `Boolean(${testBtnExpr})`, 15_000);
  await evalJs(ws, `${testBtnExpr}?.click() ?? false`);

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
    "F8 browser Test key passes guard (verified toast, masked)",
    toastOk && toastText.includes(QA_MASK),
    toastText.replace(/\n/g, " ").slice(0, 120)
  );
  await shot(ws, "F-guard-toast");

  // F9 — cleanup: vault left EMPTY (no residue)
  const delRes = await fetch(`${BASE}/api/vault?provider=builtin`, { method: "DELETE" });
  const finalVault = await (await fetch(`${BASE}/api/vault`)).json();
  const hasBuiltin =
    Array.isArray(finalVault?.vault) &&
    finalVault.vault.some((s) => s.provider === "builtin");
  check("F9 cleanup: vault left empty (no residue)", delRes.ok && !hasBuiltin);

  await wsSend(ws, "Page.close").catch(() => {});
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks PASS`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("QA crashed:", e.message);
  process.exit(1);
});
