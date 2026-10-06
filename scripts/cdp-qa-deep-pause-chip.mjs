import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── QA — D-series (r304): "deep paused" chip is honest about firing ─────────
// Before r304, a Deep workflow with failStreak ≥ 2 always showed the chip
// "deep paused · firing standard" — even while the failure breaker or a 429
// backoff had the schedule PAUSED (nothing fires at all then). Witnessed live
// on a user board: the chip sat stacked on "auto-paused · click to resume".
// The chip state now comes from lib/depth-chip (unit-tested 20/20); this suite
// verifies the INVARIANT on the live board, whatever state it is in:
//   D1  the Workflow Studio board renders with at least one pipeline card.
//   D2  chip labels are exactly one of the two legal strings.
//   D3  THE r304 WITNESS: a card that shows a paused indicator ("auto-paused"
//       / "backoff · auto-resume") must never show "· firing standard" on its
//       deep-pause chip.
//   D4  a "firing standard" chip only ever appears on a card WITHOUT a paused
//       indicator (mirror direction).
//   D5  console hygiene (no reload, no clicks on product-mutating controls —
//       read-only sweep; works whether or not a paused Deep pipeline exists).
// Usage: node scripts/cdp-qa-deep-pause-chip.mjs [baseUrl]

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

// ── CDP harness (r139/r140/J/K/E-series pattern) ─────────────────────────────
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
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

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

  // The app may land on ANY view — poll for the shell, then click the sidebar
  // "Workflows" nav item (text-only button, no aria-label).
  let booted = false;
  for (let i = 0; i < 30; i++) {
    await settle(1000);
    const shell = await evalJs(ws, js(`return document.body && document.body.innerText.length > 40;`));
    if (shell) { booted = true; break; }
  }
  if (!booted) throw new Error("app shell never appeared after 30s");

  await evalJs(ws, js(`
    Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    return document.visibilityState;
  `));

  // Console hygiene watch (no reload in this suite).
  await evalJs(ws, js(`
    window.__errs = window.__errs ?? [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason?.message ?? e.reason)));
    return true;
  `));

  const clicked = await evalJs(ws, js(`
    const btn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim().startsWith("Workflows")
    );
    if (btn) { btn.click(); return "clicked"; }
    return "absent";
  `));

  // Poll for the Workflow Studio board (dev compile + view switch latency).
  let onBoard = false;
  for (let i = 0; i < 30; i++) {
    await settle(1000);
    const here = await evalJs(ws, js(`return document.body.innerText.includes("Workflow Studio");`));
    if (here) { onBoard = true; break; }
  }
  if (!onBoard) {
    await shot(ws, "D-deep-pause-no-board");
    check("D1 board reached", false, `nav click: ${clicked}; Workflow Studio header never appeared`);
    ws.close();
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
    process.exit(1);
  }
  await settle(600);

  // Sweep every card: read chip label + paused indicators in one pass.
  const sweep = JSON.parse(await evalJs(ws, js(`
    const cards = [...document.querySelectorAll("[data-wf-card]")];
    return JSON.stringify(cards.map((el) => {
      const chip = el.querySelector('[data-testid="deep-pause-chip"]');
      const text = el.textContent || "";
      return {
        name: (el.querySelector("h3")?.textContent || "?").slice(0, 40),
        chipLabel: chip ? (chip.textContent || "").trim() : null,
        autoPaused: text.includes("auto-paused"),
        backoff: text.includes("backoff · auto-resume"),
      };
    }));
  `)));

  check("D1 board renders with pipeline cards", sweep.length > 0, `${sweep.length} card(s); nav: ${clicked}`);

  const legal = new Set(["deep paused", "deep paused · firing standard"]);
  let labelsLegal = true, witnessHolds = true, mirrorHolds = true;
  let chipCards = 0, pausedDeepCards = 0, firingCards = 0;
  const detail = [];
  for (const c of sweep) {
    if (c.chipLabel != null) {
      chipCards++;
      if (!legal.has(c.chipLabel)) {
        labelsLegal = false;
        detail.push(`${c.name}: illegal label "${c.chipLabel}"`);
      }
      const paused = c.autoPaused || c.backoff;
      if (paused) {
        pausedDeepCards++;
        if (c.chipLabel.includes("firing standard")) {
          witnessHolds = false;
          detail.push(`${c.name}: paused card claims "firing standard"`);
        }
      } else if (c.chipLabel.includes("firing standard")) {
        firingCards++;
      }
    } else if (c.autoPaused || c.backoff) {
      // paused non-deep card — no deep chip expected; nothing to check.
    }
  }
  check("D2 chip labels are exactly the two legal strings", labelsLegal, detail.join(" | ") || `${chipCards} deep-pause chip(s) found, all legal`);
  check(
    "D3 (r304 witness) paused card never claims 'firing standard'",
    witnessHolds,
    detail.filter((d) => d.includes("firing")).join(" | ") || `${pausedDeepCards} paused deep card(s) swept${pausedDeepCards ? " — labels honest" : " (none right now; invariant still enforced)"}`
  );
  check(
    "D4 'firing standard' only on unpaused cards",
    mirrorHolds && witnessHolds,
    firingCards ? `${firingCards} firing-standard card(s), none paused` : "no firing-standard card on the board right now"
  );

  await settle(400);
  const errs = (await evalJs(ws, `window.__errs`)) ?? [];
  check("D5 console clean", errs.length === 0, errs.length ? errs.slice(0, 3).join(" | ") : "no errors/unhandled rejections");
  if (errs.length || !witnessHolds) await shot(ws, "D-deep-pause-fail");

  await shot(ws, "D-deep-pause-chip");
  ws.close();
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error("QA run failed:", err.stack ?? err.message);
  process.exit(2);
});
