import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — C-series (r134): vault-lane chip in ServerAutopilot ────────────
// Asserts the r134 UI surface end-to-end against the live dev server:
//   C1 API: store a throwaway builtin key → sync GET reports vaultLane (masked)
//   C2 UI:  Workflows view → ServerAutopilot chip renders the builtin-skipped state (r205 semantics)
//   C3 UX:  clicking the chip deep-links to Settings → #vault card (r125 anchor)
//   C4 UX:  delete key → panel refetch (Refresh click) → chip flips to "no key — closed-tab runs wait"
//   C5 API: vault left EMPTY afterwards (no fake-key residue — r133 discipline)
// Reuses the r132 harness lessons: hydration retry-click loop (dev-mode swallows
// the first click), new-tab boot via PUT /json/new, and the headless profile
// PERSISTS localStorage across launches — throwaway profile only, never a real
// user browser.
// Launch first (same shell as scripts/cdp-qa.mjs):
//   setsid ~/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell \
//     --headless --no-sandbox --disable-gpu --remote-allow-origins='*' \
//     --remote-debugging-port=9222 --window-size=1440,1000 about:blank &
// Usage: node scripts/cdp-qa-vault-chip.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });
const QA_KEY = "qa-r134-chip-key-9abc";
const QA_MASK = "qa-r••••9abc"; // mask(): first4 + •••• + last4

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

const chipExpr = `document.querySelector('button[aria-label="Headless lane key status"]')`;

async function main() {
  // r326 incident guard: a populated user vault means REAL keys — abort
  // instead of upserting/deleting over them (the 2026-10-07 Vyce wipe).
  await (await import("./lib/qa-vault-guard.mjs")).assertVaultEmptyOrAbort(BASE, "vault-chip");

  // C0 — idempotent pre-clean (a prior run may have left residue)
  await fetch(`${BASE}/api/vault?provider=builtin`, { method: "DELETE" });

  // C1 — API lane state
  const storeRes = await fetch(`${BASE}/api/vault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "builtin", key: QA_KEY }),
  });
  const storeJson = await storeRes.json().catch(() => ({}));
  check("C1a store throwaway vault key", storeRes.ok && storeJson.ok === true);
  const syncJson = await (
    await fetch(`${BASE}/api/automation/sync`, { cache: "no-store" })
  ).json();
  check(
    "C1b sync GET reports vaultLane masked",
    syncJson?.vaultLane?.hasKey === true && syncJson.vaultLane.maskedKey === QA_MASK,
    JSON.stringify(syncJson?.vaultLane ?? null)
  );

  // Browser boot (r132 pattern: new tab + navigate over CDP, hydration settle)
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
  await evalJs(ws, "document.title"); // warm the session
  await waitFor(ws, `document.readyState === 'complete'`);
  await new Promise((r) => setTimeout(r, 2500));

  // C2 — Workflows view → chip shows the your-key state
  if (!(await retryClick(ws, "Workflows"))) throw new Error("nav to Workflows failed");
  await waitFor(ws, `document.querySelector('[aria-label="Server autopilot"]')`, 20_000);
  await waitFor(ws, chipExpr, 20_000);
  const chipText = await evalJs(ws, `${chipExpr}?.innerText ?? ""`);
  check(
    "C2 chip renders the builtin-skipped state (executor skips legacy builtin since r205)",
    chipText.includes("needs a registry provider key"),
    chipText.trim()
  );
  await shot(ws, "C2-vault-chip");

  // C3 — deep-link: chip click → Settings → #vault card scrolled into view
  await evalJs(ws, `${chipExpr}.click()`);
  await waitFor(ws, `Boolean(document.querySelector('#vault'))`, 10_000);
  await new Promise((r) => setTimeout(r, 2000)); // 250ms defer + smooth scroll
  const linkState = await evalJs(ws, `
    (() => {
      const el = document.querySelector('#vault');
      if (!el) return { ok: false, why: "no #vault" };
      const r = el.getBoundingClientRect();
      return {
        ok: r.top >= -20 && r.top < window.innerHeight * 0.6 && el.innerText.includes("Automation vault"),
        top: Math.round(r.top),
        hasCard: el.innerText.includes("Automation vault"),
      };
    })()
  `);
  check(
    "C3 chip deep-links to Settings vault card",
    linkState?.ok === true,
    `top=${linkState?.top} card=${linkState?.hasCard}`
  );
  await shot(ws, "C3-vault-deeplink");

  // C4 — delete key → panel refetch → chip flips to the no-key state
  const delRes = await fetch(`${BASE}/api/vault?provider=builtin`, { method: "DELETE" });
  const delJson = await delRes.json().catch(() => ({}));
  check("C4a delete throwaway key", delRes.ok && delJson.ok === true);
  if (!(await retryClick(ws, "Workflows"))) throw new Error("nav back to Workflows failed");
  await waitFor(ws, chipExpr, 20_000);
  // Force a refetch via the panel's own Refresh button (independent of the 15s poll)
  for (let i = 0; i < 4; i++) {
    const clicked = await evalJs(ws, `
      (() => {
        const sec = document.querySelector('[aria-label="Server autopilot"]');
        const btn = [...(sec?.querySelectorAll("button") ?? [])].find(
          (b) => (b.textContent || "").trim().startsWith("Refresh")
        );
        if (!btn) return false;
        btn.click();
        return true;
      })()
    `);
    if (clicked) break;
    await new Promise((r) => setTimeout(r, 600));
  }
  const flipped = await waitFor(
    ws,
    `/(no key)/.test((${chipExpr}?.innerText) ?? "")`,
    12_000
  );
  const chipText2 = await evalJs(ws, `${chipExpr}?.innerText ?? ""`);
  check(
    "C4 chip flips to the no-key state after refetch",
    flipped && chipText2.includes("no key"),
    chipText2.trim()
  );

  // C5 — vault left EMPTY (no residue)
  const finalVault = await (await fetch(`${BASE}/api/vault`)).json();
  const hasBuiltin =
    Array.isArray(finalVault?.vault) &&
    finalVault.vault.some((s) => s.provider === "builtin");
  check("C5 vault left empty (no residue)", !hasBuiltin);

  await wsSend(ws, "Page.close").catch(() => {});
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks PASS`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("QA crashed:", e.message);
  process.exit(1);
});
