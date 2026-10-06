import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — R-series (r300): fleet-chip ratio honesty ─────────────────────
// The sidebar chip printed "cron n/total" where n counted enabled agentTurn
// jobs but total counted EVERY registry job (any kind, paused included) while
// its own tooltip claimed "(agentTurn)" — the same one-ratio-two-populations
// class r298 fixed in the run panel. The fix counts agentTurn jobs on BOTH
// sides and names paused / foreign jobs in the tooltip instead.
//  F1  node-side forensics → expected ratio computed with the SAME predicates
//      (kind === "agentTurn", enabled ?? true); the chip's text must start
//      with that exact ratio.
//  F2  tooltip honesty: says "agentTurns armed", never the old "(agentTurn)"
//      parenthetical; when the live fleet is fully armed with no foreign
//      jobs, it must NOT claim paused/foreign problems either.
//  F3  aria-label carries the same population ("N of M agentTurns armed").
//  F4  console hygiene — __errs read with no reload in between (this suite
//      never reloads and never seeds: the registry is server-side and
//      recreating cron jobs is banned ritual).
// Usage: node scripts/cdp-qa-fleet-chip.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });

let msgId = 0;
const pending = new Map();
function wsSend(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, 20_000);
  });
}
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
  };
  return ws;
}
async function evalJs(ws, expression) {
  const r = await wsSend(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval error");
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
function pass(id, note) { results.push([id, true, note]); console.log(`  ✅ ${id} — ${note}`); }
function fail(id, note) { results.push([id, false, note]); console.log(`  ❌ ${id} — ${note}`); }

// The chip button's text starts with "cron N/M" (a trailing "next Xm" span may
// follow). Pull text + title + aria-label in one evaluation.
const chipExpr = `(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /^cron \\d+\\/\\d+/.test(b.textContent.replace(/\\s+/g, " ").trim()));
  if (!btn) return null;
  return {
    text: btn.textContent.replace(/\\s+/g, " ").trim(),
    title: btn.getAttribute("title") ?? "",
    aria: btn.getAttribute("aria-label") ?? "",
  };
})()`;

// ─── drive ────────────────────────────────────────────────────────────────────
await ensureChrome();

// F1 expected values come from the SAME predicates the component now uses.
const forensics = await fetch(`${BASE}/api/cron/forensics`)
  .then((r) => r.json())
  .catch(() => null);
const jobs = Array.isArray(forensics?.registry?.jobs) ? forensics.registry.jobs : null;
const expTurns = jobs ? jobs.filter((j) => j.kind === "agentTurn") : null;
const expTotal = expTurns ? expTurns.length : -1;
const expN = expTurns ? expTurns.filter((j) => j.enabled ?? true).length : -1;
const expPaused = expTurns ? expTotal - expN : -1;
const expForeign = jobs && expTurns ? jobs.length - expTotal : -1;
const expLabel = `cron ${expN}/${expTotal}`;

const list = await fetch("http://127.0.0.1:9222/json/version").then((r) => r.json()).catch(() => null);
if (!list) { console.error("SUMMARY: 0 passed, 1 failed — chrome CDP not reachable"); process.exit(1); }
const tabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
if (!tabRes.ok) { console.error(`SUMMARY: 0 passed, 1 failed — /json/new failed: ${tabRes.status}`); process.exit(1); }
let page = await tabRes.json();
const ws = await connect(page.webSocketDebuggerUrl);
try {
  await wsSend(ws, "Page.enable");
  await wsSend(ws, "Runtime.enable");
  await wsSend(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  await wsSend(ws, "Page.navigate", { url: `${BASE}/` });
  await waitFor(ws, `document.readyState === "complete"`, 60_000);
  await evalJs(ws, `
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason?.message ?? e.reason)));
  `);

  // Fleet resolved = the chip shows a real ratio AND the new tooltip wording.
  const ready = await waitFor(ws, `${chipExpr} !== null && ${chipExpr}.title.includes("agentTurns armed")`, 20_000);
  const chip = ready ? await evalJs(ws, chipExpr) : null;

  if (jobs === null) {
    fail("F1", "forensics unreachable node-side — cannot compute the expected ratio");
    await shot(ws, "fleet-chip-F1-FAIL");
  } else if (chip && chip.text.startsWith(expLabel)) {
    pass("F1", `chip ratio matches the agentTurn-only count from forensics: "${chip.text}" (registry: ${jobs.length} jobs, ${expForeign} foreign, ${expPaused} paused)`);
  } else {
    fail("F1", `chip text ${JSON.stringify(chip?.text ?? null)} does not start with expected agentTurn-only ratio ${JSON.stringify(expLabel)}`);
    await shot(ws, "fleet-chip-F1-FAIL");
  }

  if (chip && !chip.title.includes("(agentTurn)") && chip.title.includes("agentTurns armed")) {
    const cleanExtras = expPaused === 0 && expForeign === 0;
    const extraClaimsOk = cleanExtras
      ? !chip.title.includes("paused") && !chip.title.includes("non-agentTurn")
      : true;
    if (extraClaimsOk) {
      pass("F2", `tooltip is population-honest: ${JSON.stringify(chip.title)}`);
    } else {
      fail("F2", `fully-armed fleet with no foreign jobs, yet tooltip claims a problem: ${JSON.stringify(chip.title)}`);
      await shot(ws, "fleet-chip-F2-FAIL");
    }
  } else {
    fail("F2", `tooltip ${JSON.stringify(chip?.title ?? null)} still carries the old "(agentTurn)" label or is missing`);
    await shot(ws, "fleet-chip-F2-FAIL");
  }

  const expAria = `Cron fleet ${expN} of ${expTotal} agentTurns armed`;
  if (chip && chip.aria === expAria) {
    pass("F3", `aria-label matches the same population: "${chip.aria}"`);
  } else {
    fail("F3", `aria-label ${JSON.stringify(chip?.aria ?? null)} !== ${JSON.stringify(expAria)}`);
    await shot(ws, "fleet-chip-F3-FAIL");
  }

  // F4 — console hygiene, read while __errs is still alive (no reload ever
  // happens in this suite).
  const errs = await evalJs(ws, `window.__errs`);
  if (!errs || errs.length === 0) pass("F4", "no console errors during the suite");
  else fail("F4", `console errors: ${JSON.stringify(errs)}`);
} catch (e) {
  fail("DRIVE", `harness error: ${e.message}`);
  try { await shot(ws, "fleet-chip-DRIVE-FAIL"); } catch {}
} finally {
  try { await fetch(`http://127.0.0.1:9222/json/close/${page.id}`, { method: "GET" }); } catch {}
}

const passed = results.filter(([, ok]) => ok).length;
const failed = results.length - passed;
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("DIAG: failures above; screenshots in ops/qa/fleet-chip-*.png");
  process.exit(1);
}
