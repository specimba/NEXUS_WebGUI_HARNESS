#!/usr/bin/env node
// ─── r312 QA: chat-stream memo engagement, WITNESSED (closes r293's carried
// "perf win uninstrumented" risk) ─────────────────────────────────────────────
// r293 made MessageItem's React.memo actually engage (stable store callbacks);
// the win was structural and deliberately unmeasured that round. The r312
// render probe (message-item.tsx, window.__MSG_RENDER_PROBE__) + the QA-only
// patchBurst driver (stores.ts, window.__PRAISON_QA__) let this suite drive a
// REAL 24-token patchMessage burst through the real store and count renders:
//   V0  app boots
//   V1  seeded 1 user + 6 assistant messages all hydrate in the chat view
//   V2  LEG A — counter liveness: one patch to EACH assistant message renders
//       each of them ≥ 1 time (guards the suite against a dead counter /
//       false pass)
//   V3  LEG B — THE r293 INVARIANT: a 24-token burst into ONE message
//       re-renders that message (≥ 12 of 24) and re-renders every untouched
//       message 0 times
//   V4  store truth: the burst's last token persisted; the user turn intact
//   V5  cleanup: original praison-conversations snapshot restored byte-for-byte
// House shape (r265-r284 doctrine): self-created tab via PUT /json/new, tab
// closed on success AND error, waitFor tolerates transient evals.
// Usage: node scripts/cdp-qa-memo-renders.mjs [baseUrl]
import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";
const CONV_ID = "conv_cdp_probe_r312";
const USER_ID = "msg_cdp_probe_r312_user";
const ASST_IDS = Array.from({ length: 6 }, (_, i) => `msg_cdp_probe_r312_a${i}`);
const BURST_TARGET = ASST_IDS[2];
const BURST_TIMES = 24;
const LS_KEY = "praison-conversations";
const LAST_TOKEN = `render-probe token ${BURST_TIMES - 1}`;

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

function evalJs(ws, expression, awaitPromise = false) {
  return cmd(ws, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise }).then(
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

let originalSnapshot = null;

async function seedConversation(ws) {
  originalSnapshot = await evalJs(ws, `localStorage.getItem(${JSON.stringify(LS_KEY)})`);
  const now = Date.now();
  const conv = {
    id: CONV_ID,
    title: "CDP probe r312 (self-cleaning)",
    messages: [
      {
        id: USER_ID,
        role: "user",
        content: "CDP probe r312 — seed turn for the render-count test.",
        createdAt: now,
        toolCalls: [],
        status: "done",
      },
      ...ASST_IDS.map((id, i) => ({
        id,
        role: "assistant",
        content: `CDP probe r312 — reply ${i} (pre-burst).`,
        createdAt: now + 1 + i,
        toolCalls: [],
        status: "done",
        agentName: "Render Probe",
      })),
    ],
    createdAt: now,
    updatedAt: now,
  };
  const ok = await evalJs(
    ws,
    `(() => {
      let bundle;
      try { bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_KEY)}) || "null"); } catch { bundle = null; }
      const state = bundle?.state ?? {};
      const list = Array.isArray(state.conversations) ? state.conversations : [];
      const next = list.filter((c) => c && c.id !== ${JSON.stringify(CONV_ID)});
      next.unshift(${JSON.stringify(conv)});
      localStorage.setItem(${JSON.stringify(LS_KEY)}, JSON.stringify({
        state: { conversations: next, activeId: ${JSON.stringify(CONV_ID)} },
        version: bundle?.version ?? 0,
      }));
      return true;
    })()`
  );
  return Boolean(ok);
}

async function main() {
  const mode = await ensureChrome();
  console.log(`ensureChrome: ${mode}`);

  // Grace: the two probe edits just landed — give the dev server's HMR a beat.
  await new Promise((r) => setTimeout(r, 2000));

  const tabRes = await fetch(`${CDP}/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status}`);
  const page = await tabRes.json();
  tabId = page.id;
  const ws = await connect(page.webSocketDebuggerUrl);

  // V0 — app boots
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  check(
    "V0 app renders",
    await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`)
  );

  // Let boot-triggered debounced store flushes land BEFORE the seed write.
  await new Promise((r) => setTimeout(r, 900));
  const seeded = await seedConversation(ws);
  if (!seeded) {
    check("seed conversation written to localStorage", false);
    await finish(ws);
    return;
  }

  // Reload through #/chat so the hydrated store opens on the seeded conversation.
  await evalJs(ws, `location.hash = "#/chat"; location.reload(); true`).catch(() => {});
  await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`);

  // V1 — every seeded message hydrates into the chat view.
  let hydrated = true;
  for (const id of [USER_ID, ...ASST_IDS]) {
    const ok = await waitFor(
      ws,
      `document.querySelector(${JSON.stringify(`[data-msg-id="${id}"]`)}) !== null`,
      15_000
    );
    if (!ok) {
      hydrated = false;
      console.log(`  DIAG: node not hydrated: ${id}`);
    }
  }
  check("V1 seeded user turn + 6 replies hydrate in the chat view", hydrated);

  // Arm the render probe (render-time reads — set AFTER hydration, so counts
  // start at zero for exactly the legs below).
  await evalJs(ws, `window.__MSG_RENDER_PROBE__ = { counts: {} }; true`).catch(() => {});

  // V2 — LEG A, counter liveness: one patch to EACH assistant message → each
  // counted ≥ 1. Also proves the burst driver actually reaches the store.
  await evalJs(
    ws,
    `window.__PRAISON_QA__ ? Promise.all(${JSON.stringify(ASST_IDS)}.map((id) =>
        window.__PRAISON_QA__.patchBurst(${JSON.stringify(CONV_ID)}, id, 1, 0)
      )).then(() => true) : Promise.resolve(false)`,
    true
  ).catch(() => false);
  await new Promise((r) => setTimeout(r, 400));
  const legA = await evalJs(ws, `window.__MSG_RENDER_PROBE__.counts`).catch(() => null);
  const legAOk = Boolean(legA) && ASST_IDS.every((id) => (legA?.[id] ?? 0) >= 1);
  check(
    "V2 LEG A counter liveness — each patched message rendered ≥ 1",
    legAOk,
    legAOk ? "" : `counts=${JSON.stringify(legA)}`
  );

  // V3 — LEG B, THE r293 INVARIANT: 24 real tokens into ONE message.
  await evalJs(ws, `window.__MSG_RENDER_PROBE__ = { counts: {} }; true`).catch(() => {});
  const burstRan = await evalJs(
    ws,
    `window.__PRAISON_QA__
      ? window.__PRAISON_QA__.patchBurst(${JSON.stringify(CONV_ID)}, ${JSON.stringify(BURST_TARGET)}, ${BURST_TIMES}, 10).then(() => true)
      : Promise.resolve(false)`,
    true
  ).catch(() => false);
  await new Promise((r) => setTimeout(r, 400));
  const legB = await evalJs(ws, `window.__MSG_RENDER_PROBE__.counts`).catch(() => null);
  const touched = legB?.[BURST_TARGET] ?? 0;
  const untouchedIds = [USER_ID, ...ASST_IDS.filter((id) => id !== BURST_TARGET)];
  const ghosts = untouchedIds.filter((id) => (legB?.[id] ?? 0) !== 0);
  const legBOk = Boolean(burstRan) && touched >= BURST_TIMES / 2 && ghosts.length === 0;
  check(
    "V3 LEG B memo engagement — 24-token burst re-renders ONLY its target",
    legBOk,
    legBOk
      ? `target rendered ${touched}×, untouched 0×`
      : `burstRan=${burstRan} target=${touched}/${BURST_TIMES} ghosts=${JSON.stringify(ghosts)} counts=${JSON.stringify(legB)}`
  );

  // V4 — store truth: the last token persisted (debouncedStorage flushes at
  // 450ms) and the user turn is intact.
  await new Promise((r) => setTimeout(r, 900));
  const truth = await evalJs(
    ws,
    `(() => {
      try {
        const bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_KEY)}) || "null");
        const conv = (bundle?.state?.conversations ?? []).find((c) => c.id === ${JSON.stringify(CONV_ID)});
        if (!conv) return { conv: false, last: false, user: false };
        const target = conv.messages.find((m) => m.id === ${JSON.stringify(BURST_TARGET)});
        return {
          conv: true,
          last: target?.content === ${JSON.stringify(LAST_TOKEN)},
          user: conv.messages.some((m) => m.id === ${JSON.stringify(USER_ID)}),
        };
      } catch { return { conv: false, last: false, user: false }; }
    })()`
  );
  check(
    "V4 store truth — burst's last token persisted, user turn intact",
    truth?.conv === true && truth?.last === true && truth?.user === true,
    JSON.stringify(truth)
  );

  await finish(ws);
}

async function finish(ws) {
  // V5 — cleanup: restore the ORIGINAL snapshot exactly and verify the test
  // conversation is gone from the persisted store.
  let restored = false;
  if (originalSnapshot !== null) {
    await evalJs(
      ws,
      `localStorage.setItem(${JSON.stringify(LS_KEY)}, ${JSON.stringify(originalSnapshot)}); true`
    ).catch(() => {});
  } else {
    await evalJs(ws, `localStorage.removeItem(${JSON.stringify(LS_KEY)}); true`).catch(() => {});
  }
  await evalJs(ws, `delete window.__MSG_RENDER_PROBE__; location.hash = "#/chat"; location.reload(); true`).catch(() => {});
  await waitFor(ws, `document.readyState === "complete"`, 15_000).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
  const clean = await evalJs(
    ws,
    `(() => {
      try {
        const bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_KEY)}) || "null");
        return !((bundle?.state?.conversations ?? []).some((c) => c.id === ${JSON.stringify(CONV_ID)}));
      } catch { return false; }
    })()`
  );
  restored = clean === true;
  check("V5 original conversations snapshot restored (test conv gone)", restored);

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
