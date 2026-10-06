#!/usr/bin/env node
// ─── r291 QA rider: app boot gate (rebuilds the lost vault-dial 5/5 gate) ────
// The disaster (r288) proved the value of a cheap boot gate: after any sandbox
// rollback or big refactor, ONE suite answers "does the app boot, render, and
// hash-route to every view without crashing?" — read-only, no seeding, nothing
// to restore, safe to run at any time. Rebuilt from scratch per the r290
// handoff (the original scripts/cdp-qa-vault-dial.mjs is unrecoverable).
//   V0  / renders the shell (body non-empty, no error boundary)
//   V1  #/chat mounts (TopBar view title — profile-independent witness)
//   V2  #/agents mounts ("Agent Roster")
//   V3  #/workflows mounts (New Workflow toolbar button)
//   V4  #/radar mounts (view tablist)
//   V5  #/settings mounts (Profile / Accent theme / Your Data / About)
//   V6  round-trip back to #/chat — hash routing is repeatable, still no crash
// Crash sentinel after every hop: the Next error boundary text must never
// appear. House shape: self-created tab via PUT /json/new, tab closed on
// success AND error, waitFor tolerates transient evals.
// Usage: node scripts/cdp-qa-boot-gate.mjs [baseUrl]

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

async function waitFor(ws, expr, timeoutMs = 20_000, everyMs = 400) {
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

/** Navigate to a hash route, wait for its mount anchor, and assert the crash
 *  sentinel stayed silent. Returns [anchorSeen, noCrash]. */
async function hop(ws, hash, anchorExpr, label) {
  await evalJs(ws, `location.hash = ${JSON.stringify(hash)}; true`).catch(() => {});
  const seen = await waitFor(ws, anchorExpr, 15_000);
  const crashed = await evalJs(
    ws,
    `document.body.innerText.includes("Application error") || document.body.innerText.includes("This page could not be rendered")`
  ).catch(() => true);
  if (!seen) {
    // Diagnostics on failure (r287/r290 doctrine): dump the hash the app kept,
    // and a sample of what actually rendered, so the failure is explainable.
    const diag = await evalJs(
      ws,
      `JSON.stringify({
        hash: location.hash,
        text: document.body.innerText.replace(/\\s+/g, " ").slice(0, 400),
      })`
    ).catch((e) => "diag-err:" + e.message);
    console.log(`DIAG [${label}]:`, diag);
  }
  check(`${label} (#${hash.replace(/^#/, "")})`, seen && crashed === false, seen ? "" : "anchor not seen");
  return seen && crashed === false;
}

async function main() {
  const mode = await ensureChrome();
  console.log(`ensureChrome: ${mode}`);

  const tabRes = await fetch(`${CDP}/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status}`);
  const page = await tabRes.json();
  tabId = page.id;
  const ws = await connect(page.webSocketDebuggerUrl);

  // V0 — boot: the shell renders and the error boundary stays silent.
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  const booted = await waitFor(
    ws,
    `document.readyState === "complete" && document.body && document.body.innerText.length > 0`
  );
  const bootCrash = await evalJs(
    ws,
    `document.body.innerText.includes("Application error") || document.body.innerText.includes("This page could not be rendered")`
  ).catch(() => true);
  check("V0 app boots, error boundary silent", booted && bootCrash === false);

  // V1..V5 — one hop per view. Chat's witness is its TopBar view title
  // (VIEW_TITLES.chat — unique per view): r291 found the chat CONTENT-AREA
  // anchors ("No chat selected" h2 / messages log) never render on a fresh
  // profile even though the view mounts cleanly per the TopBar — content-area
  // anchors proved profile-dependent, so the gate uses the title instead
  // (open question carried to r291).
  await hop(
    ws,
    "#/chat",
    `document.body.innerText.includes("Converse with your agents")`,
    "V1 chat view mounts"
  );
  await hop(
    ws,
    "#/agents",
    `document.body.innerText.includes("Agent Roster")`,
    "V2 agents view mounts"
  );
  await hop(
    ws,
    "#/workflows",
    `document.querySelector('[aria-label="New Workflow"]') !== null`,
    "V3 workflows view mounts"
  );
  await hop(
    ws,
    "#/radar",
    `[...document.querySelectorAll('[role="tablist"] button[role="tab"]')].length >= 3`,
    "V4 radar view mounts"
  );
  await hop(
    ws,
    "#/settings",
    `["Profile", "Accent theme", "Your Data", "About"].some((t) => document.body.innerText.includes(t))`,
    "V5 settings view mounts"
  );

  // V6 — round-trip: hash routing must be repeatable without a crash.
  await hop(
    ws,
    "#/chat",
    `document.body.innerText.includes("Converse with your agents")`,
    "V6 round-trip back to chat"
  );

  await closeTab();
  try { ws.close(); } catch { /* best effort */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL:", e?.message ?? e);
  await closeTab();
  process.exit(1);
});
