import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — M-series (r297): usage dashboard accuracy + tool-mix honesty ──
// Surfaces under test (usage-dashboard.tsx):
//  M1  dashboard mounts on the Settings → Usage section and the "Messages · 7d"
//      tile equals the seeded last-7-day message count (perDay → tile pipeline)
//  M2  tool mix shows NO zero-count rows (r297 suppression)
//  M3  the suppression is stated OUT LOUD: "X of Y tool types unused." and
//      the numbers are self-consistent (rows shown == Y - X)
//  M4  no console errors during the suite
// r297 DIAG finding: the QA chrome profile has ZERO conversations, so the
// dashboard renders its honest empty state and the tool mix never mounts.
// The suite therefore SEEDS praison-conversations (snapshot → seed → reload →
// assert → restore) — no pollution left behind. Settings sections are STACKED
// scroll-nav pills (plain buttons, no role=tab), so the "Usage" button is
// clicked but all sections coexist in the DOM.
// Usage: node scripts/cdp-qa-usage-dashboard.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });

const DAY_MS = 86_400_000;
function seedConversations() {
  const now = Date.now();
  const msg = (id, role, content, createdAt, extra = {}) => ({
    id, role, content, createdAt, status: "done",
    toolCalls: [], ...extra,
  });
  const conv = {
    id: "qa-usage-seed-1",
    title: "QA usage seed (r297)",
    messages: [
      msg("m1", "user", "hello", now - 3600_000),
      msg("m2", "assistant", "hi there", now - 3500_000, { durationMs: 1234 }),
      msg("m3", "user", "search please", now - 3400_000),
      msg("m4", "assistant", "searching", now - 3300_000, {
        toolCalls: [{ id: "t1", name: "web_search", args: "{}", ok: true }],
      }),
      msg("m5", "user", "yesterday q", now - DAY_MS - 7200_000),
      msg("m6", "assistant", "yesterday a", now - DAY_MS - 7100_000, {
        toolCalls: [
          { id: "t2", name: "run_code", args: "{}", ok: true },
          { id: "t3", name: "current_time", args: "{}", ok: true },
        ],
      }),
      msg("m7", "assistant", "three days ago", now - 3 * DAY_MS - 3600_000, {
        toolCalls: [
          { id: "t4", name: "web_search", args: "{}", ok: true },
          { id: "t5", name: "web_search", args: "{}", ok: true },
        ],
      }),
    ],
    createdAt: now - 3 * DAY_MS,
    updatedAt: now,
  };
  return [conv];
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

  await wsSend(ws, "Page.navigate", { url: `${BASE}/#/settings` });
  await waitFor(ws, `document.readyState === "complete"`, 60_000);
  // Let boot-time debounced persist writers settle (the conversations store
  // uses debouncedStorage(450)) so a pending flush can't clobber the seed.
  await new Promise((r) => setTimeout(r, 2500));

  // Seed: snapshot (kept NODE-side — the reload wipes window state) → inject
  // 1 conversation (7 messages in the last 3 days, 6 tool runs across 3 tool
  // types) → REAL reload via location.reload(). r297 first-run finding: a
  // Page.navigate to the SAME URL is treated as same-document (no-op) — the
  // in-memory store never re-read localStorage and the dashboard stayed empty.
  const convBefore = await evalJs(ws, `localStorage.getItem("praison-conversations")`);
  await evalJs(ws, `(() => {
    let payload = { state: {}, version: 0 };
    const raw = ${JSON.stringify(convBefore)};
    if (raw) { try { payload = JSON.parse(raw); } catch {} }
    payload.state = payload.state ?? {};
    payload.state.conversations = ${JSON.stringify(seedConversations())};
    localStorage.setItem("praison-conversations", JSON.stringify(payload));
    location.reload();
    return true;
  })()`);
  await waitFor(ws, `document.readyState === "complete"`, 60_000);
  await evalJs(ws, `
    window.__errs = [];
    window.addEventListener("error", (e) => window.__errs.push(String(e.message)));
    window.addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason?.message ?? e.reason)));
  `);
  await waitFor(ws, `document.body.innerText.includes("Usage")`, 30_000);

  // Open the Usage section (plain button — settings pills have no role=tab).
  let clicked = false;
  for (let i = 0; i < 10 && !clicked; i++) {
    clicked = await evalJs(ws, `(() => {
      const t = [...document.querySelectorAll("button")]
        .find((x) => x.textContent.trim() === "Usage");
      if (!t) return false;
      t.click(); return true;
    })()`);
    if (!clicked) await new Promise((r) => setTimeout(r, 400));
  }

  // M1 — dashboard in its DATA state: the "Messages · 7d" tile renders and
  // equals the seeded 7. NOTE: the label has an uppercase text-transform and
  // Chrome's innerText returns TRANSFORMED text — match via textContent.
  const m1 = clicked && await waitFor(ws, `
    [...document.querySelectorAll("div")].some((d) => d.textContent.trim() === "Messages · 7d")
  `, 20_000);
  const tileValue = m1
    ? await evalJs(ws, `(() => {
        const label = [...document.querySelectorAll("div")]
          .find((d) => d.className?.includes?.("uppercase") && d.textContent.trim() === "Messages · 7d");
        const v = label?.previousElementSibling?.textContent?.trim() ?? null;
        return v;
      })()`)
    : null;
  if (m1 && tileValue === "7") {
    pass("M1", "dashboard mounts; Messages · 7d tile = 7 (matches the seeded last-7-day count)");
  } else {
    fail("M1", `tile value ${JSON.stringify(tileValue)} !== "7" (mounted=${m1})`);
    await shot(ws, "usage-dash-M1-FAIL");
  }

  // M2+M3 — tool mix suppression + out-loud honesty line.
  const mix = await evalJs(ws, `(() => {
    const heading = [...document.querySelectorAll("div")]
      .find((d) => d.className?.includes?.("mb-2") && d.textContent.trim() === "Tool mix");
    if (!heading) return null;
    const mixEl = heading.parentElement;
    const list = mixEl.querySelector(".space-y-2");
    const rows = list ? [...list.querySelectorAll(":scope > div.flex.items-center")] : [];
    const counts = rows.map((r) => {
      const spans = r.querySelectorAll("span");
      return spans[spans.length - 1]?.textContent?.trim() ?? "";
    });
    const note = list ? list.querySelector('p[class*="text-[10px]"]')?.textContent?.trim() ?? null : null;
    return { rowCount: rows.length, counts, note };
  })()`);
  if (!mix) {
    fail("M2", "tool mix section not found in the DOM (seeded data state expected)");
    await shot(ws, "usage-dash-M2-FAIL");
  } else {
    const zeroRows = mix.counts.filter((c) => c === "0").length;
    if (zeroRows === 0 && mix.rowCount === 3) {
      pass("M2", `no zero-count rows; exactly the 3 seeded tool types render (${mix.counts.join(", ")})`);
    } else {
      fail("M2", `rows=${mix.rowCount} (expected 3), zero-count rows=${zeroRows}, counts=${JSON.stringify(mix.counts)}`);
      await shot(ws, "usage-dash-M2-FAIL");
    }
    const m = mix.note ? mix.note.match(/^(\d+) of (\d+) tool types unused\.$/) : null;
    if (m && Number(m[2]) - Number(m[1]) === mix.rowCount) {
      pass("M3", `honesty line "${mix.note}" is self-consistent (rows shown = ${mix.rowCount} = ${m[2]}-${m[1]})`);
    } else {
      fail("M3", `honesty line broken — note=${JSON.stringify(mix.note)}, rows=${mix.rowCount}`);
      await shot(ws, "usage-dash-M3-FAIL");
    }
  }

  // M4 — console hygiene, read while __errs is still alive. r299 fix: this
  // read used to sit AFTER the restore-reload below, which wipes window state
  // — it always saw undefined and passed vacuously (r298 DIAG finding).
  const errs = await evalJs(ws, `window.__errs`);
  if (!errs || errs.length === 0) pass("M4", "no console errors during the suite");
  else fail("M4", `console errors: ${JSON.stringify(errs)}`);

  // Restore the pre-test conversations (no seed pollution) — same-eval
  // location.reload() so a debounced persist flush can't overwrite the
  // restore after the tab unloads.
  await evalJs(ws, `(() => {
    const raw = ${JSON.stringify(convBefore)};
    if (raw === null) localStorage.removeItem("praison-conversations");
    else localStorage.setItem("praison-conversations", raw);
    location.reload();
    return true;
  })()`);
  await waitFor(ws, `document.readyState === "complete"`, 60_000);
} catch (e) {
  fail("DRIVE", `harness error: ${e.message}`);
  try { await shot(ws, "usage-dash-DRIVE-FAIL"); } catch {}
} finally {
  try { await fetch(`http://127.0.0.1:9222/json/close/${page.id}`, { method: "GET" }); } catch {}
}

const passed = results.filter(([, ok]) => ok).length;
const failed = results.length - passed;
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("DIAG: failures above; screenshots in ops/qa/usage-dash-*.png");
  process.exit(1);
}
