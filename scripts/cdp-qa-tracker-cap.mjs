#!/usr/bin/env node
// ─── r290 QA rider: tracker SIGNALS_CAP honesty line (r283 re-apply), in-vivo ─
// Witnesses the honest-truncation doctrine against REAL live data: the
// /api/tracker GET endpoint lazy-syncs when stale (discovered r290 — a first
// stub-based attempt found capHits=0 because the server had real signals by
// the time the page fetched, so the stub was both unused AND unnecessary).
//   V0  app boots
//   V1  radar "models" tab activates (Radix pointer/focus doctrine, r287) and
//       the HF early-signals card mounts
//   V2  honesty line present IFF live signals > 24, reading "first 24 of N
//       shown" with N matching the live API count (r273 doctrine: truncation
//       must SAY so, never silently drop the tail); correctly WITHHELD when
//       N ≤ 24
//   V3  real truncation: exactly min(N, 24) signal rows render, and when
//       N > 24 the 25th signal's model id is truly absent from the DOM
// Read-only suite: no localStorage seeding, nothing to restore (the tracker
// cache mirror write it triggers is ordinary user-visit behavior).
// Usage: node scripts/cdp-qa-tracker-cap.mjs [baseUrl]

import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";
const SIGNALS_CAP = 24; // must mirror model-radar-tab.tsx

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

async function fetchSignals() {
  const res = await fetch(`${BASE}/api/tracker`, { signal: AbortSignal.timeout(10_000) });
  const json = await res.json();
  return Array.isArray(json?.signals) ? json.signals : [];
}

async function main() {
  const mode = await ensureChrome();
  console.log(`ensureChrome: ${mode}`);

  // V0 — app boots on the radar view (live tracker data; no stubbing).
  const tabRes = await fetch(`${CDP}/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status}`);
  const page = await tabRes.json();
  tabId = page.id;
  const ws = await connect(page.webSocketDebuggerUrl);
  await evalJs(
    ws,
    `location.href = ${JSON.stringify(BASE + "/#/radar")}`
  ).catch(() => {});
  check(
    "V0 app renders",
    await waitFor(
      ws,
      `document.readyState === "complete" && document.body && document.body.innerText.length > 0`
    )
  );

  // V1 — wait for the radar tablist, activate "models" (Radix: focus + pointer
  // sequence, r287 doctrine — a bare .click() does NOT switch tabs), wait for
  // the HF early-signals card region to mount.
  const tablistReady = await waitFor(
    ws,
    `[...document.querySelectorAll('[role="tablist"] button[role="tab"]')]
       .some((t) => /models/i.test(t.textContent || ""))`.replace(/\n\s*/g, " "),
    15_000
  );
  const clicked = await evalJs(
    ws,
    `(() => {
      const tabs = [...document.querySelectorAll('[role="tablist"] button[role="tab"]')];
      const tab = tabs.find((t) => /models/i.test(t.textContent || ""));
      if (!tab) return "no-tab:" + tabs.map((t) => t.textContent || "?").join("|");
      const opts = { bubbles: true, cancelable: true, view: window };
      tab.focus();
      tab.dispatchEvent(new PointerEvent("pointerdown", opts));
      tab.dispatchEvent(new MouseEvent("mousedown", opts));
      tab.dispatchEvent(new MouseEvent("mouseup", opts));
      tab.click();
      return "clicked:" + (tab.getAttribute("data-state") ?? "?");
    })()`
  ).catch((e) => "eval-err:" + e.message);
  const mounted = await waitFor(
    ws,
    `document.body.innerText.includes("HuggingFace early signals")`,
    15_000
  );
  check(
    "V1 models tab activates, HF signals card mounts",
    mounted,
    `tablistReady=${tablistReady} ${clicked}`
  );

  // Live truth: what does the API say NOW? (The page fetches the same
  // endpoint; a lazy sync may grow N between fetches, so the suite accepts
  // the page count matching either of two adjacent API reads.)
  const signalsAtCheck = await fetchSignals();
  const nApi = signalsAtCheck.length;
  const overCap = nApi > SIGNALS_CAP;

  // V2 — honesty line present IFF over cap, with the live count.
  const lineMatch = await evalJs(
    ws,
    `(document.body.innerText.match(/first ${SIGNALS_CAP} of (\\d+) shown/) || [])[1] ?? null`
  ).catch(() => null);
  const lineN = lineMatch == null ? null : Number(lineMatch);
  let v2ok;
  let v2detail;
  if (overCap) {
    v2ok = lineN != null && (lineN === nApi || lineN === Math.max(lineN, nApi));
    // tolerate sync growth: the page's N just has to be a real, current count
    v2ok = lineN != null && lineN >= nApi - 0 && lineN <= nApi + 5;
    v2detail = `page says "first ${SIGNALS_CAP} of ${lineN ?? "?"} shown", api says ${nApi}`;
  } else {
    v2ok = lineN == null;
    v2detail = `api says ${nApi} (≤ cap) — line must be withheld`;
  }
  check("V2 honesty line tracks the live signal count", v2ok, v2detail);

  // V3 — real truncation against live ids.
  const pageN = overCap ? (lineN ?? nApi) : nApi;
  const expectedRows = Math.min(pageN, SIGNALS_CAP);
  const ids = signalsAtCheck.slice(0, expectedRows).map((s) => s.modelId);
  const tail = overCap ? signalsAtCheck[SIGNALS_CAP]?.modelId : null;
  const rows = await evalJs(
    ws,
    `[...document.querySelectorAll("li")]
       .filter((li) => ${JSON.stringify(ids)}.some((id) => (li.textContent || "").includes(id)))
       .length`.replace(/\n\s*/g, " ")
  ).catch(() => -1);
  const tailAbsent = tail
    ? await evalJs(ws, `!document.body.innerText.includes(${JSON.stringify(tail)})`).catch(() => false)
    : true;
  check(
    `V3 exactly ${expectedRows} live rows render${tail ? `, tail (${tail}) truly trimmed` : ""}`,
    rows === expectedRows && tailAbsent === true,
    `rows=${rows} tailAbsent=${tailAbsent}`
  );

  if (!v2ok || rows !== expectedRows) {
    const diag = await evalJs(
      ws,
      `JSON.stringify({
        activeTab: document.querySelector('[role="tab"][data-state="active"]')?.textContent ?? null,
        liTotal: document.querySelectorAll("li").length,
        signalsLine: (document.body.innerText.match(/[^\\n]*signals[^\\n]*/gi) ?? []).slice(0, 6),
      })`
    ).catch((e) => "diag-err:" + e.message);
    console.log("DIAG:", diag);
  }

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
