import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — E-series (r218): per-slot Test/Reveal on registry-provider rows ─
// The r218 change gives the executor-facing lane slots the same affordances
// the legacy builtin box always had. Asserts end-to-end against the live dev
// server:
//   E1  store a throwaway lane key (first free provider) via POST /api/vault
//   E2  Settings → vault card → the lane ROW renders a per-slot Reveal eye
//       (aria "Reveal stored <name> key …") and a per-slot Test button
//   E3  click the eye → the RAW key renders INSIDE that row + "visible —
//       auto-hides" chip; aria flips to "Hide stored <name> key"
//   E4  click the eye again → immediate re-mask (raw gone from the whole DOM)
//   E5  click the row's Test → toast "<name> key verified" carrying the MASKED
//       key only (raw never shown by the test path)
//   E6  cleanup, API-verified only — vault left EMPTY (no DB residue).
//       (r220: the old E6 UI re-verify — reload + "row gone" — moved to the
//       F-series, scripts/cdp-qa-vault-slot-residue.mjs: a compile-stalled
//       card made rowGone vacuously true, and the leg was the suite's one
//       recurring infra flake. The F-suite proves row VISIBLE → row GONE
//       with compile-tolerant budgets instead.)
// Same harness lessons as the D-series: new-tab CDP boot, retry-click loop,
// self-adapting provider name (read from the rendered row, not hardcoded).
// Launch chrome-headless-shell on :9222 first (see cdp-qa-vault-test.mjs).
// Usage: node scripts/cdp-qa-vault-slot-affordances.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });
const QA_KEY = "qa-r218-slot-key-9xyz";
const QA_MASK = "qa-r••••9xyz"; // mask(): first4 + •••• + last4 (len 21 > 12)

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

const rowExpr = `
  [...document.querySelectorAll("li")].find(
    (li) => (li.innerText || "").includes(${JSON.stringify(QA_MASK)})
        || (li.innerText || "").includes(${JSON.stringify(QA_KEY)})
  )`;
// ↑ matches by mask OR raw: after a successful reveal the row shows the RAW
// key instead of the mask, so a mask-only locator would stop matching the
// very row it just revealed (self-defeating assertion — probe #6 lesson).

async function gotoSettings(ws) {
  // r218 lesson: the dev server COLD-COMPILES the (huge) settings view on
  // first visit after a code edit — that can take >20s, longer than the old
  // 6×800ms retry loops, so every downstream check saw the HOME view and the
  // suite failed for timing, not product, reasons. Keep clicking until the
  // vault surface REALLY mounts (45s budget), then let the card fetch.
  const t0 = Date.now();
  while (Date.now() - t0 < 45_000) {
    await evalJs(ws, `(() => {
      const el = [...document.querySelectorAll('a,button,[role="button"],[role="menuitem"]')]
        .find((e) => (e.textContent || "").trim().toLowerCase().startsWith("settings") && e.offsetParent !== null);
      if (el) el.click();
      return Boolean(el);
    })()`);
    // Settings has a TAB BAR — the vault card renders only under the "Vault"
    // tab (exact label match; the sidebar "Settings" entry never equals it).
    await evalJs(ws, `(() => {
      const t = [...document.querySelectorAll('button,[role="tab"],a')]
        .find((e) => (e.textContent || "").trim().toLowerCase() === "vault" && e.offsetParent !== null);
      if (t) t.click();
      return Boolean(t);
    })()`);
    if (await evalJs(ws, `Boolean(document.querySelector('#vault'))`)) {
      await new Promise((r) => setTimeout(r, 800)); // let the card fetch its slots
      return true;
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

async function main() {
  // r326 incident guard: a populated user vault means REAL keys — abort
  // instead of upserting/deleting over them (the 2026-10-07 Vyce wipe).
  await (await import("./lib/qa-vault-guard.mjs")).assertVaultEmptyOrAbort(BASE, "vault-slot-affordances");

  // E0 — idempotent pre-clean (builtin too: keep the slate identical to the
  // round-start state, which was an empty vault)
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

  // E1 — store a throwaway LANE key for the first free provider
  const provs = await (await fetch(`${BASE}/api/providers/free-models`)).json().catch(() => null);
  const providerId =
    (await evalJs(
      ws,
      `(() => { const s = document.querySelector('#lane-provider');
         return s ? s.value : ""; })()`
    )) || "vyce";
  void provs; // lane select's own default is the honest choice — use it
  const storeRes = await fetch(`${BASE}/api/vault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: providerId, key: QA_KEY }),
  });
  check("E1 store throwaway lane key", storeRes.ok, `provider=${providerId}`);

  await gotoSettings(ws);
  await waitFor(ws, `Boolean(document.querySelector('#vault'))`, 45_000);
  const rowReady = await waitFor(ws, `Boolean(${rowExpr})`, 15_000);
  const rowName = await evalJs(
    ws,
    `${rowExpr}?.querySelector('.font-medium')?.textContent ?? ""`
  );
  const eyeExpr = `${rowExpr}?.querySelector('button[aria-label^="Reveal stored"]')`;
  const eyeOk = await waitFor(ws, `Boolean(${eyeExpr})`, 10_000);
  const testBtnInRow = await evalJs(
    ws,
    `Boolean([...(${rowExpr}?.querySelectorAll("button") ?? [])].find(
       (b) => (b.textContent || "").trim().startsWith("Test")))`
  );
  check(
    "E2 lane row renders per-slot Reveal eye + Test button",
    rowReady && eyeOk && testBtnInRow,
    `row=${rowReady} eye=${eyeOk} test=${testBtnInRow} name=${rowName}`
  );

  // E3 — reveal: raw key INSIDE the row + chip + flipped aria.
  // Click-until-EFFECT (dev hydration can swallow the first click — the same
  // C/V-series lesson; a single click + long wait lost the race here).
  let revealed = false;
  for (let i = 0; i < 6 && !revealed; i++) {
    await evalJs(ws, `${eyeExpr}?.click() ?? false`);
    revealed = await waitFor(
      ws,
      `(${rowExpr}?.innerText ?? "").includes(${JSON.stringify(QA_KEY)})
        && (${rowExpr}?.innerText ?? "").includes("visible — auto-hides")`,
      3_000,
      400,
    );
  }
  const ariaFlipped = await evalJs(
    ws,
    `Boolean(${rowExpr}?.querySelector('button[aria-label^="Hide stored"]'))`
  );
  check(
    "E3 reveal shows raw key in-row with chip + Hide aria",
    revealed && ariaFlipped,
    `revealed=${revealed} ariaFlipped=${ariaFlipped}`
  );
  await shot(ws, "E3-slot-revealed");

  // E4 — second click = immediate re-mask; raw key gone from the whole DOM
  let remasked = false;
  for (let i = 0; i < 6 && !remasked; i++) {
    await evalJs(
      ws,
      `${rowExpr}?.querySelector('button[aria-label^="Hide stored"]')?.click() ?? false`,
    );
    remasked = await waitFor(
      ws,
      `!document.body.innerText.includes(${JSON.stringify(QA_KEY)})`,
      3_000,
      400,
    );
  }
  const chipGone = await waitFor(
    ws,
    `!(${rowExpr}?.innerText ?? "").includes("visible — auto-hides")`,
    5_000
  );
  check("E4 second click re-masks immediately", remasked && chipGone, `remasked=${remasked} chipGone=${chipGone}`);

  // E5 — per-slot Test: "<name> key verified" toast, masked only
  await evalJs(
    ws,
    `[...(${rowExpr}?.querySelectorAll("button") ?? [])].find(
       (b) => (b.textContent || "").trim().startsWith("Test")
     )?.click() ?? false`
  );
  const toastOk = await waitFor(
    ws,
    `(document.querySelector('[data-sonner-toast]')?.innerText ?? "").includes("key verified")`,
    12_000
  );
  const toastText = await evalJs(
    ws,
    `document.querySelector('[data-sonner-toast]')?.innerText ?? ""`
  );
  const toastNamesSlot = toastText.toLowerCase().includes(String(rowName).toLowerCase());
  const toastMasked = toastText.includes(QA_MASK);
  check(
    "E5 per-slot Test → '<name> key verified' toast with masked key",
    toastOk && toastNamesSlot && toastMasked,
    toastText.replace(/\n/g, " ").slice(0, 120)
  );

  // E6 — cleanup, API-verified only (r220 split). The old leg reloaded and
  // asserted "row gone" in the UI: a dev-compile stall crashed it (r218's
  // documented flake), and a stalled card would have made rowGone VACUOUSLY
  // true anyway (no card → no row). The honest residue re-verify — plant →
  // row VISIBLE (positive control) → delete → row GONE, compile-tolerant —
  // lives in scripts/cdp-qa-vault-slot-residue.mjs (F-series, r220). This
  // suite only guarantees it leaves no DB residue behind.
  await fetch(`${BASE}/api/vault?provider=${encodeURIComponent(providerId)}`, {
    method: "DELETE",
  });
  const finalVault = await (await fetch(`${BASE}/api/vault`)).json();
  const vaultEmpty = Array.isArray(finalVault?.vault) && finalVault.vault.length === 0;
  check("E6 cleanup API-verified — vault left empty (no residue)", vaultEmpty, `vaultEmpty=${vaultEmpty}`);

  await wsSend(ws, "Page.close").catch(() => {});
  const fails = results.filter((r) => !r.ok);
  console.log(`\n${results.length - fails.length}/${results.length} checks PASS`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("QA crashed:", e.message);
  process.exit(1);
});
