import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — R-series (r298): run-panel step-count honesty (user report) ────
// User report: the run panel's meta line said "9 steps" (authored count) one
// screen above a run banner reading "Failed at step 3/11" (materialized count,
// r26 depth injection adds deep-research passes). The fix makes the line
// depth-aware and states the delta out loud. Suite witnesses BOTH branches:
//  D1  a deep pipeline (4 authored incl. a review gate) shows
//      "6 steps per run · 4 authored + 2 deep-research passes · …"
//  D2  a standard pipeline WITH a review gate (no injection) keeps the plain
//      authored line "2 steps · agents hand outputs down the chain"
//  D3  no console errors — read BEFORE the restore-reload. (r297 DIAG: its own
//      M4 read window.__errs AFTER a location.reload() that wipes it — vacuous
//      pass. This suite reads it while it is still alive.)
// Seeding: snapshot praison-workflows node-side → inject two QA pipelines →
// location.reload() (same-URL Page.navigate is a no-op — r297 doctrine) →
// assert → restore. No run is ever executed: the card "Run" button only opens
// the panel (openRun sets state; the in-panel Run button is never touched).
// Usage: node scripts/cdp-qa-run-shape.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });

const DEEP_NAME = "QA Depth Shape (deep)";
const STD_NAME = "QA Depth Shape (review)";
const DEEP_EXPECTED =
  "6 steps per run · 4 authored + 2 deep-research passes · agents hand outputs down the chain";
const STD_EXPECTED = "2 steps · agents hand outputs down the chain";

function seedWorkflows() {
  const now = Date.now();
  const step = (id, label, kind) => ({
    id,
    agentId: "a-assistant",
    label,
    ...(kind ? { kind } : {}),
  });
  const mk = (id, name, depth, steps) => ({
    id,
    name,
    description: "QA seed — run-shape witness, deleted after the suite",
    steps,
    runs: [],
    createdAt: now,
    updatedAt: now,
    depth,
  });
  return [
    mk("qa-depth-deep", DEEP_NAME, "deep", [
      step("qa-d-s1", "Gather sources on the topic"),
      step("qa-d-s2", "Draft the summary"),
      step("qa-d-s3", "Expand with missing numbers"),
      step("qa-d-s4", "Review & refine", "review"),
    ]),
    mk("qa-depth-std", STD_NAME, "standard", [
      step("qa-s-s1", "Do the small task"),
      step("qa-s-s2", "Review & refine", "review"),
    ]),
  ];
}

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

// Locate a workflow card's "Run" button by its exact title text: find the
// leaf node holding the name, walk up until a container also holds a button
// whose trimmed text is exactly "Run" (schedule rows say "Run on server" —
// exact match keeps them out), then native-click it (plain Button onClick).
const clickRunExpr = (name) => `(() => {
  const leaves = [...document.querySelectorAll("*")]
    .filter((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(name)});
  for (const leaf of leaves) {
    let n = leaf;
    for (let i = 0; i < 14 && n; i++, n = n.parentElement) {
      const btn = [...(n.querySelectorAll ? n.querySelectorAll("button") : [])]
        .find((b) => b.textContent.trim() === "Run");
      if (btn) { btn.click(); return true; }
    }
  }
  return false;
})()`;

const metaLineExpr = `(() => {
  const p = [...document.querySelectorAll("p")]
    .find((x) => x.textContent.includes("agents hand outputs"));
  return p ? p.textContent.replace(/\\s+/g, " ").trim() : null;
})()`;

async function bootAfterReload(ws) {
  await waitFor(ws, `document.readyState === "complete"`, 60_000);
  await evalJs(ws, `
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason?.message ?? e.reason)));
  `);
}

// ─── drive ────────────────────────────────────────────────────────────────────
await ensureChrome();
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

  await wsSend(ws, "Page.navigate", { url: `${BASE}/#/workflows` });
  await bootAfterReload(ws);
  // Let boot-time debounced persist writers settle before snapshotting.
  await new Promise((r) => setTimeout(r, 2500));

  // Seed: snapshot node-side → inject two QA pipelines → REAL reload.
  const wfBefore = await evalJs(ws, `localStorage.getItem("praison-workflows")`);
  await evalJs(ws, `(() => {
    let payload = { state: {}, version: 0 };
    const raw = ${JSON.stringify(wfBefore)};
    if (raw) { try { payload = JSON.parse(raw); } catch {} }
    payload.state = payload.state ?? {};
    payload.state.workflows = [...(payload.state.workflows ?? []), ...${JSON.stringify(seedWorkflows())}];
    localStorage.setItem("praison-workflows", JSON.stringify(payload));
    location.reload();
    return true;
  })()`);
  await bootAfterReload(ws);

  // D1 — deep pipeline: the meta line counts the MATERIALIZED shape and says
  // the delta out loud. Assert the exact string: it must contain the run-time
  // count (6) AND the authored count (4) AND the passes note — and it must
  // NOT be the old authored-only line ("4 steps · …"), which is the reported
  // discontinuity.
  const deepCard = await waitFor(ws, `
    [...document.querySelectorAll("*")].some(
      (e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(DEEP_NAME)})
  `, 20_000);
  let clicked = deepCard && await evalJs(ws, clickRunExpr(DEEP_NAME));
  const metaDeep = clicked ? await waitFor(ws, `${metaLineExpr} !== null`, 15_000)
    : false;
  const deepText = metaDeep ? await evalJs(ws, metaLineExpr) : null;
  if (deepText === DEEP_EXPECTED) {
    pass("D1", `deep pipeline meta line is honest: "${deepText}"`);
  } else {
    fail("D1", `deep meta line ${JSON.stringify(deepText)} !== ${JSON.stringify(DEEP_EXPECTED)} (card=${deepCard}, clicked=${clicked})`);
    await shot(ws, "run-shape-D1-FAIL");
  }

  // Fresh page for D2 (reload closes the sheet deterministically; Escape via
  // CDP is focus-dependent — the reload is the reliable path).
  await evalJs(ws, `location.reload(); true`);
  await bootAfterReload(ws);

  // D2 — standard + review gate (no injection): the plain authored line is
  // preserved unchanged when there is nothing to explain.
  const stdCard = await waitFor(ws, `
    [...document.querySelectorAll("*")].some(
      (e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(STD_NAME)})
  `, 20_000);
  clicked = stdCard && await evalJs(ws, clickRunExpr(STD_NAME));
  const metaStd = clicked ? await waitFor(ws, `${metaLineExpr} !== null`, 15_000)
    : false;
  const stdText = metaStd ? await evalJs(ws, metaLineExpr) : null;
  if (stdText === STD_EXPECTED) {
    pass("D2", `standard + review-gate pipeline keeps the plain authored line: "${stdText}"`);
  } else {
    fail("D2", `standard meta line ${JSON.stringify(stdText)} !== ${JSON.stringify(STD_EXPECTED)} (card=${stdCard}, clicked=${clicked})`);
    await shot(ws, "run-shape-D2-FAIL");
  }

  // D3 — console hygiene, read while __errs is still alive (before restore).
  const errs = await evalJs(ws, `window.__errs`);
  if (!errs || errs.length === 0) pass("D3", "no console errors during the suite");
  else fail("D3", `console errors: ${JSON.stringify(errs)}`);

  // Restore the pre-test workflows (no seed pollution) — same-eval reload so
  // a debounced persist flush can't overwrite the restore after unload.
  await evalJs(ws, `(() => {
    const raw = ${JSON.stringify(wfBefore)};
    if (raw === null) localStorage.removeItem("praison-workflows");
    else localStorage.setItem("praison-workflows", raw);
    location.reload();
    return true;
  })()`);
  await waitFor(ws, `document.readyState === "complete"`, 60_000);
} catch (e) {
  fail("DRIVE", `harness error: ${e.message}`);
  try { await shot(ws, "run-shape-DRIVE-FAIL"); } catch {}
} finally {
  try { await fetch(`http://127.0.0.1:9222/json/close/${page.id}`, { method: "GET" }); } catch {}
}

const passed = results.filter(([, ok]) => ok).length;
const failed = results.length - passed;
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("DIAG: failures above; screenshots in ops/qa/run-shape-*.png");
  process.exit(1);
}
