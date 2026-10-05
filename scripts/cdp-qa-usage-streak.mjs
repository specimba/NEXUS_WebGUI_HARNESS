#!/usr/bin/env node
// ─── r268 QA: Settings → Usage card (streak lane) ───────────────────────────
// Covers the r267 surface: the activity streak now keys LOCAL calendar days
// via localDayKey (helpers.ts). This suite verifies the card renders truth
// in-vivo on both branches:
//   U1  Settings view opens (h2 == "Settings")
//   U2  Usage card paints — streak tile on a populated profile, OR the
//       honest empty-state line on a fresh one (tiles don't render empty;
//       r268 first run asserted the tile unconditionally — test bug, fixed)
//   U3  Populated branch → 7-day chart has exactly 7 day columns; streak
//       tile value is sane (integer + 🔥 or "—")
//   U4  Empty branch → honest empty-state line instead of a hollow chart
//   S1-4  BEHAVIORAL proof of localDayKey (r267): on an empty profile, seed
//       two assistant messages on consecutive LOCAL days at UTC-straddling
//       times (02:30 local yesterday, 04:30 local today) → streak tile must
//       read 2🔥 (raw-UTC keying would read 1 in most run windows); chart
//       paints 7 columns; profile restored afterwards (no pollution).
// House shape (r265-r266 doctrine): self-created tab via PUT /json/new —
// never scans /json/list for a leftover to ride; ensureChrome self-heals
// 9222 (wedge-aware r263, janitor r265). Tab is closed on success AND error.
// Usage: node scripts/cdp-qa-usage-streak.mjs [baseUrl]

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

function evalJs(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id !== id) return;
      ws.removeEventListener("message", onMsg);
      if (d.error) reject(new Error(d.error.message));
      else resolve(d.result?.result?.value);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
}

/** Poll an expression until truthy; transient eval failures don't kill the
 * wait (r264 waitFor tolerance — mid-navigation context detaches happen). */
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

  // U0 — app boots
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  check("U0 app renders", await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`));

  // U1 — open Settings: the control is icon-only in the shell chrome, so
  // match the ACCESSIBLE NAME (aria-label/title) fuzzily, not exact text
  // (r268 first run: exact-text match found nothing — a11y doctrine puts the
  // name in aria-label for icon-only buttons).
  const clicked = await evalJs(ws, `(() => {
    const hay = (e) => [e.getAttribute("aria-label"), e.getAttribute("title"), e.textContent]
      .map((x) => (x || "").toLowerCase()).join(" ");
    const els = [...document.querySelectorAll("button, a, [role='tab'], [role='menuitem']")]
      .filter((e) => /settings/.test(hay(e)) && e.offsetParent !== null);
    if (!els.length) return false;
    els[0].click();
    return true;
  })()`);
  check("U1 settings control found + clicked", clicked);
  check("U1b Settings view open (h2)", await waitFor(ws, `document.querySelector("h2")?.textContent?.trim() === "Settings"`));

  // U2 — Usage card markers
  await waitFor(ws, `document.body.innerText.includes("Day streak")`);
  const markers = await evalJs(ws, `(() => {
    const t = document.body.innerText;
    return {
      streakTile: t.includes("Day streak"),
      localBadge: t.includes("Usage"),
      emptyState: t.includes("No activity yet"),
      chart: t.includes("Last 7 days"),
    };
  })()`);
  check("U2 usage card painted (tile or honest empty state)", markers.localBadge && (markers.streakTile || markers.emptyState), JSON.stringify(markers));

  // U3/U4 — branch truth
  if (markers.emptyState) {
    check("U4 empty branch honest (no hollow chart)", !markers.chart);
  } else {
    const bars = await evalJs(ws, `document.querySelector("[aria-label='Messages per day, last 7 days']")?.children?.length ?? 0`);
    check("U3 7-day chart has 7 columns", bars === 7, `bars=${bars}`);
    const streakVal = await evalJs(ws, `(() => {
      const t = document.body.innerText;
      const m = t.match(/(\\d+)\\s*🔥/);
      return m ? m[1] : (t.includes("Day streak") ? "—" : null);
    })()`);
    check("U3b streak value sane (int+🔥 or —)", streakVal === "—" || /^\d+$/.test(String(streakVal)), `value=${streakVal}`);
  }

  // ── S-phase: behavioral proof of localDayKey (r267) in-vivo ──────────────
  // Runs ONLY on an empty profile (no pollution of real data); restores the
  // previous praison-conversations value afterwards.
  if (markers.emptyState) {
    const orig = await evalJs(ws, `localStorage.getItem("praison-conversations")`);
    const seeded = await evalJs(ws, `(() => {
      try {
        const DAY = 86_400_000;
        const nowD = new Date();
        const startToday = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
        const msgA = startToday - DAY + 2.5 * 3_600_000;          // yesterday 02:30 local
        let msgB = startToday + 4.5 * 3_600_000;                  // today 04:30 local
        if (msgB > Date.now()) msgB = startToday + 60_000;        // early-morning run: 00:01 local (still straddles)
        const mk = (ts) => ({ id: "qa-seed-" + ts, role: "assistant", content: "QA streak seed reply", createdAt: ts, toolCalls: [], status: "done", durationMs: 1200 });
        const conv = { id: "qa-usage-streak-seed", title: "QA streak seed (disposable)", messages: [mk(msgA), mk(msgB)], createdAt: msgA, updatedAt: msgB };
        let parsed = null;
        try { parsed = JSON.parse(localStorage.getItem("praison-conversations") ?? "null"); } catch {}
        const state = Object.assign({}, (parsed && parsed.state) || {}, { conversations: [conv], activeId: conv.id });
        localStorage.setItem("praison-conversations", JSON.stringify({ state, version: (parsed && parsed.version) || 0 }));
        return true;
      } catch (e) { return "ERR:" + ((e && e.message) || e); }
    })()`);
    check("S1 seed written to praison-conversations", seeded === true, String(seeded));
    await evalJs(ws, `location.reload()`).catch(() => {});
    check("S2 app re-hydrated", await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`));
    // Reload lands on the persisted view (was Settings); re-click defensively.
    await evalJs(ws, `(() => {
      const hay = (e) => [e.getAttribute("aria-label"), e.getAttribute("title"), e.textContent].map((x) => (x || "").toLowerCase()).join(" ");
      const els = [...document.querySelectorAll("button, a, [role='tab'], [role='menuitem']")].filter((e) => /settings/.test(hay(e)) && e.offsetParent !== null);
      if (!els.length) return false;
      els[0].click();
      return true;
    })()`).catch(() => false);
    await waitFor(ws, `document.querySelector("h2")?.textContent?.trim() === "Settings"`);
    const streakN = await evalJs(ws, `(() => { const m = document.body.innerText.match(/(\\d+)\\s*🔥/); return m ? Number(m[1]) : null; })()`);
    check("S3 streak counts straddling messages as consecutive local days (=2)", streakN === 2, `streak=${streakN}`);
    const bars2 = await evalJs(ws, `document.querySelector("[aria-label='Messages per day, last 7 days']")?.children?.length ?? 0`);
    check("S4 chart painted post-seed (7 columns)", bars2 === 7, `bars=${bars2}`);
    const origJson = JSON.stringify(orig ?? null);
    await evalJs(ws, `(() => { const v = ${origJson}; if (v === null) localStorage.removeItem("praison-conversations"); else localStorage.setItem("praison-conversations", v); return true; })()`);
    await evalJs(ws, `location.reload()`).catch(() => {});
    await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`);
  }

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
