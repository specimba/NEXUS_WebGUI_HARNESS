import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — F-series (r220): vault slot residue, compile-tolerant ──────────
// Split out of the E-series (r218): E6's post-cleanup UI re-verify reloaded
// and asserted "row gone" — but a dev-compile stall either crashed the leg
// (r218's documented infra flake) or, worse, made rowGone VACUOUSLY true
// (no card rendered → no row matched). The honest residue check needs a
// positive control: prove the row RENDERS while the key exists, then prove
// it is GONE after deletion. This suite owns that, with patient budgets:
//   F1  plant a throwaway LANE key via POST /api/vault (API lane)
//   F2  reload → Settings → Vault tab → the row RENDERS (positive control —
//       without it, any later "row gone" is vacuous)
//   F3  DELETE the slot → reload → row GONE from the card + vault GET == []
//       (no residue, both sides verified)
//   F4  final API clean (builtin too) → vault left byte-clean
// Compile-tolerance: 90s CDP eval budget, 60s gotoSettings loop, 30s render
// waits — the settings view cold-compiles in >20s after any code edit, which
// is exactly what killed the old E6.
// Launch chrome-headless-shell on :9222 first (see cdp-qa-vault-test.mjs).
// Usage: node scripts/cdp-qa-vault-slot-residue.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });
const QA_KEY = "qa-r220-residue-4wyz";
const QA_MASK = "qa-r••••4wyz"; // mask(): first4 + •••• + last4 (len > 12)

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
    }, 90_000); // r220: compile-tolerant (was 20s in the crashed leg)
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

const rowExpr = `
  [...document.querySelectorAll("li")].find(
    (li) => (li.innerText || "").includes(${JSON.stringify(QA_MASK)})
        || (li.innerText || "").includes(${JSON.stringify(QA_KEY)})
  )`;
// mask OR raw — probe #6 lesson: a mask-only locator stops matching the row
// it just revealed; here the row is never revealed, but keep the pattern.

async function reloadAndOpenVault(ws) {
  // Full reload + patient vault-tab mount. Retries the whole climb until the
  // card REALLY renders — the settings view cold-compiles after code edits.
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    await wsSend(ws, "Page.navigate", { url: `${BASE}/` }).catch(() => {});
    await waitFor(ws, `document.readyState === 'complete'`, 30_000).catch(() => {});
    await evalJs(ws, `(() => {
      const el = [...document.querySelectorAll('a,button,[role="button"],[role="menuitem"]')]
        .find((e) => (e.textContent || "").trim().toLowerCase().startsWith("settings") && e.offsetParent !== null);
      if (el) el.click();
      return Boolean(el);
    })()`);
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
  await (await import("./lib/qa-vault-guard.mjs")).assertVaultEmptyOrAbort(BASE, "vault-slot-residue");

  // F0 — idempotent pre-clean (both providers the suite touches)
  await fetch(`${BASE}/api/vault?provider=builtin`, { method: "DELETE" });

  // Browser boot (r132 pattern)
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

    // F1 — read the lane select's own default (honest provider choice), plant
    const mounted = await reloadAndOpenVault(ws);
    if (!mounted) throw new Error("vault card never mounted in 60s (compile stall deeper than budget)");
    const providerId =
      (await evalJs(
        ws,
        `(() => { const s = document.querySelector('#lane-provider');
           return s ? s.value : ""; })()`
      )) || "vyce";
    const storeRes = await fetch(`${BASE}/api/vault`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: providerId, key: QA_KEY }),
    });
    check("F1 plant throwaway lane key (API)", storeRes.ok, `provider=${providerId}`);

    // F2 — POSITIVE CONTROL: after reload the row RENDERS while the key exists
    const mountedAgain = await reloadAndOpenVault(ws);
    const rowVisible = mountedAgain && (await waitFor(ws, `Boolean(${rowExpr})`, 30_000));
    const rowName = rowVisible
      ? await evalJs(ws, `${rowExpr}?.querySelector('.font-medium')?.textContent ?? ""`)
      : "";
    check("F2 row renders while key exists (positive control)", rowVisible, `name=${rowName}`);
    if (rowVisible) await shot(ws, "F2-residue-row-visible");

    // F3 — DELETE → reload → row GONE + vault API empty (both sides)
    const delRes = await fetch(`${BASE}/api/vault?provider=${encodeURIComponent(providerId)}`, {
      method: "DELETE",
    });
    const goneMounted = await reloadAndOpenVault(ws);
    const rowGone = goneMounted && (await waitFor(ws, `!Boolean(${rowExpr})`, 30_000));
    const finalVault = await (await fetch(`${BASE}/api/vault`)).json();
    const vaultEmpty = Array.isArray(finalVault?.vault) && finalVault.vault.length === 0;
    check(
      "F3 delete → row gone from card + vault API empty",
      delRes.ok && goneMounted && rowGone && vaultEmpty,
      `del=${delRes.ok} mounted=${goneMounted} rowGone=${rowGone} vaultEmpty=${vaultEmpty}`
    );
    if (goneMounted) await shot(ws, "F3-residue-row-gone");

    // F4 — leave the slate byte-clean (builtin too, round-start state)
    await fetch(`${BASE}/api/vault?provider=builtin`, { method: "DELETE" });
    const final2 = await (await fetch(`${BASE}/api/vault`)).json();
    const clean = Array.isArray(final2?.vault) && final2.vault.length === 0;
    check("F4 slate byte-clean at exit", clean, `vaultEmpty=${clean}`);
  } finally {
    await wsSend(ws, "Page.close").catch(() => {});
  }

  const fails = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY: ${results.length - fails.length} passed, ${fails.length} failed`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("QA crashed:", e.message);
  process.exit(1);
});
