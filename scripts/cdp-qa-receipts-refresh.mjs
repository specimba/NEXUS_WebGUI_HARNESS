#!/usr/bin/env node
// ─── r275 QA rider: whats-fixed receipts (r274 SHIPPED 1) + refresh-all ──────
// honest no-op (r274 SHIPPED 2), in-vivo on the fresh bundle (carries
// r273+r274+r275 client rounds).
//   R0  app boots
//   R1  Settings → "What's fixed recently": newest receipt chip = r273,
//       oldest = r186, total = 17 (13 pre-r274 + r270/r271/r272/r273)
//   R2  vault re-seed truth (r275 correction of the r274 premise): deleting
//       providerKeys at the storage layer does NOT empty the vault — the app
//       re-seeds bundled keys in memory each boot and refresh-all still fires
//       roster fetches (no dead button; the r274 empty-targets guard was
//       unreachable dead code and was reverted).
// House shape (r265-r272 doctrine): self-created tab via PUT /json/new, tab
// closed on success AND error, waitFor tolerates transient evals.
// Usage: node scripts/cdp-qa-receipts-refresh.mjs [baseUrl]

import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("ws connect failed"));
  });
}

function cmd(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id !== id) return;
      ws.removeEventListener("message", onMsg);
      if (d.error) reject(new Error(d.error.message));
      else resolve(d.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function evalJs(ws, expression) {
  return cmd(ws, "Runtime.evaluate", { expression, returnByValue: true }).then(
    (r) => r?.result?.value
  );
}

async function waitFor(ws, expr, timeoutMs = 15_000, everyMs = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await evalJs(ws, `Boolean(${expr})`)) return true;
    } catch {
      /* transient — keep polling within budget */
    }
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}

let tabId = null;
async function closeTab() {
  if (!tabId) return;
  const id = tabId;
  tabId = null;
  try {
    await fetch(`${CDP}/json/close/${id}`, { signal: AbortSignal.timeout(1500) });
  } catch {
    /* best effort */
  }
}

async function main() {
  const mode = await ensureChrome();
  console.log(`ensureChrome: ${mode}`);

  const tabRes = await fetch(`${CDP}/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status}`);
  const page = await tabRes.json();
  tabId = page.id;
  const ws = await connect(page.webSocketDebuggerUrl);

  // R0 — app boots
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  check("R0 app renders", await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`));

  // R1 — receipts panel current (r274 SHIPPED 1): chips render reversed
  // (newest first), so the FIRST violet round-chip must be r273 and the LAST
  // r186; 17 receipts total after the r274 append. Hydration note (r275): the
  // h2 paints from SSR HTML before the client sections mount — wait on the
  // section content itself, never on the heading alone (the first run of this
  // suite scanned a sections-less SSR shell and reported count=0).
  await evalJs(ws, `location.hash = "#/settings"`).catch(() => {});
  const chipsReady = await waitFor(ws, `document.querySelectorAll("#whats-fixed span").length > 3`, 15_000);
  check("R1-pre settings sections hydrated", chipsReady);
  const receipts = await evalJs(ws, `(() => {
    const chips = [...document.querySelectorAll("#whats-fixed span")]
      .filter((e) => /^r\\d+(-r\\d+)?$/.test((e.textContent || "").trim()) && (e.className || "").includes("violet-500/10"))
      .map((e) => (e.textContent || "").trim());
    return { chips, first: chips[0] ?? null, last: chips[chips.length - 1] ?? null, count: chips.length };
  })()`);
  check("R1a newest receipt is r273", receipts?.first === "r273", `first=${receipts?.first} count=${receipts?.count}`);
  check("R1b oldest receipt is r186 (reverse render intact)", receipts?.last === "r186", `last=${receipts?.last}`);
  check("R1c receipt count = 17", receipts?.count === 17, `count=${receipts?.count}`);

  // R2 — r275 CORRECTION of the r274 premise: the app re-seeds bundled keys
  // (vyce/pollinations/aihubmix) into memory on every boot — deleting keys at
  // the storage layer does NOT empty the vault (observed: gallery still reads
  // "3/15 ready" and fires free-models fetches with providerKeys={} on disk).
  // The empty-targets state is unreachable on this build, so the r274
  // guidance-toast guard was REVERTED as dead code; this leg pins the
  // re-seed behavior itself as a regression guard.
  await evalJs(ws, `(() => {
    const raw = JSON.parse(localStorage.getItem("praison-settings") || "{}");
    const st = raw.state ?? (raw.state = {});
    const s = st.settings ?? (st.settings = {});
    s.providerKeys = {};
    localStorage.setItem("praison-settings", JSON.stringify(raw));
    return true;
  })()`).catch(() => {});
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/#/settings")}`).catch(() => {});
  const hydrated = await waitFor(ws, `[...document.querySelectorAll("button")].some((e) => /refresh all models/i.test(e.textContent || ""))`, 20_000);
  check("R2a gallery hydrated on reloaded profile", hydrated);
  const noKeys = await evalJs(ws, `Object.keys(JSON.parse(localStorage.getItem("praison-settings") || "{}")?.state?.settings?.providerKeys || {}).length`);
  check("R2b storage-level keys are zero (write took)", noKeys === 0, `keys=${noKeys}`);
  const readyLine = await evalJs(ws, `(() => {
    const m = /(\\d+\\/\\d+) ready/.exec(document.body.innerText || "");
    return m ? m[1] + " ready" : null;
  })()`);
  check("R2c vault re-seeded in memory (ready > 0 despite empty storage)", !!readyLine && !readyLine.startsWith("0/"), `ready=${readyLine}`);
  await evalJs(ws, `(() => { const b = [...document.querySelectorAll("button")].find((e) => /refresh all models/i.test(e.textContent || "")); if (b) b.click(); return true; })()`);
  const reqOk = await waitFor(ws, `performance.getEntriesByType("resource").some((r) => /free-models/.test(r.name))`, 15_000);
  check("R2d refresh-all actually fires roster fetches (no dead button)", reqOk);

  await closeTab();
  ws.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main()
  .catch(async (e) => {
    console.error("FATAL:", e?.message ?? e);
    await closeTab();
    process.exit(1);
  });
