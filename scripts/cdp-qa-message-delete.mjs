#!/usr/bin/env node
// ─── r285 QA rider: single assistant-reply delete (r284 SHIPPED), in-vivo ────
// Closes r284's carried gap: the delete INTERACTION (hover-revealed trash →
// two-click arm/confirm → removal) was typed and boot-proven but never
// witnessed end-to-end. This rider seeds a throwaway conversation into the
// persisted store (snapshot → merge → reload), drives the real button in the
// real DOM, and restores the original snapshot byte-for-byte.
//   V0  app boots
//   V1  seeded conversation hydrates in the chat view (assistant node present)
//   V2  FIRST click ARMS the button (aria-label flips to confirm language)
//   V3  SECOND click removes the node + "Reply deleted" toast
//   V4  store truth: persisted conversations no longer hold the reply,
//       while the turn's user message survives
//   V5  cleanup: original praison-conversations snapshot restored (test conv gone)
// House shape (r265-r284 doctrine): self-created tab via PUT /json/new, tab
// closed on success AND error, waitFor tolerates transient evals, JS .click()
// reaches hover-revealed buttons (opacity-0 does not gate programmatic clicks).
// Usage: node scripts/cdp-qa-message-delete.mjs [baseUrl]
//
// r289 WAVE-2 RESTORE: the r284 feature (stores.deleteMessage + two-click
// confirm UI) is re-applied per the worklog r288 recipe; the r288-era
// FEATURE_PRESENT self-skip guard is removed — the suite runs for real again.
import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";
const CONV_ID = "conv_cdp_rider_r285";
const USER_MSG_ID = "msg_cdp_rider_r285_user";
const ASST_MSG_ID = "msg_cdp_rider_r285_asst";
const LS_KEY = "praison-conversations";

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

let originalSnapshot = null;

/** Merge the throwaway conversation into the persisted store, remember the
 *  original string so V5 can restore it exactly. */
async function seedConversation(ws) {
  originalSnapshot = await evalJs(ws, `localStorage.getItem(${JSON.stringify(LS_KEY)})`);
  const now = Date.now();
  const conv = {
    id: CONV_ID,
    title: "CDP rider r285 (self-cleaning)",
    messages: [
      {
        id: USER_MSG_ID,
        role: "user",
        content: "CDP rider r285 — seed turn for the delete test.",
        createdAt: now,
        toolCalls: [],
        status: "done",
      },
      {
        id: ASST_MSG_ID,
        role: "assistant",
        content: "CDP rider r285 — this reply is deleted by the test.",
        createdAt: now + 1,
        toolCalls: [],
        status: "done",
        agentName: "CDP Rider",
      },
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

  // Let any boot-triggered debounced store flushes land BEFORE the seed write,
  // so a late flush can't overwrite the seed (debouncedStorage is 450ms).
  await new Promise((r) => setTimeout(r, 900));
  const seeded = await seedConversation(ws);
  if (!seeded) {
    check("seed conversation written to localStorage", false);
    await finish(ws);
    return;
  }

  // Reload through #/chat so the hydrated store opens on the seeded conversation.
  await evalJs(
    ws,
    `location.hash = "#/chat"; location.reload(); true`
  ).catch(() => {});
  await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`);

  // V1 — the seeded assistant reply hydrates into the chat view.
  const hydrated = await waitFor(
    ws,
    `document.querySelector(${JSON.stringify(`[data-msg-id="${ASST_MSG_ID}"]`)}) !== null`,
    20_000
  );
  check("V1 seeded reply hydrates in the chat view", hydrated);

  // V2 — FIRST click arms the delete button (two-click confirm gate, r284).
  await evalJs(
    ws,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`[data-msg-id="${ASST_MSG_ID}"]`)});
      const btn = node?.querySelector('button[aria-label="Delete this reply"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`
  ).catch(() => false);
  const armed = await waitFor(
    ws,
    `document.querySelector(${JSON.stringify(`[data-msg-id="${ASST_MSG_ID}"]`)})
      ?.querySelector('button[aria-label^="Click again to confirm"]') != null`,
    8_000
  );
  check("V2 first click arms the confirm gate", armed);

  // V3 — SECOND click fires the removal: node leaves the DOM + honest toast.
  if (armed) {
    await evalJs(
      ws,
      `(() => {
        const btn = document
          .querySelector(${JSON.stringify(`[data-msg-id="${ASST_MSG_ID}"]`)})
          ?.querySelector('button[aria-label^="Click again to confirm"]');
        if (!btn) return false;
        btn.click();
        return true;
      })()`
    ).catch(() => false);
  }
  const gone = await waitFor(
    ws,
    `document.querySelector(${JSON.stringify(`[data-msg-id="${ASST_MSG_ID}"]`)}) === null`,
    10_000
  );
  const toastOk = await waitFor(
    ws,
    `[...document.querySelectorAll("[data-sonner-toast]")].some((t) => /reply deleted/i.test(t.textContent || ""))`,
    8_000
  );
  check("V3 second click removes the reply + 'Reply deleted' toast", gone && toastOk, toastOk ? "" : "toast not seen");

  // V4 — store truth (debouncedStorage flushes at 450ms; give it headroom).
  await new Promise((r) => setTimeout(r, 900));
  const storeState = await evalJs(
    ws,
    `(() => {
      try {
        const bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_KEY)}) || "null");
        const conv = (bundle?.state?.conversations ?? []).find((c) => c.id === ${JSON.stringify(CONV_ID)});
        if (!conv) return { conv: false, asst: false, user: false };
        return {
          conv: true,
          asst: conv.messages.some((m) => m.id === ${JSON.stringify(ASST_MSG_ID)}),
          user: conv.messages.some((m) => m.id === ${JSON.stringify(USER_MSG_ID)}),
        };
      } catch { return { conv: false, asst: false, user: false }; }
    })()`
  );
  check(
    "V4 persisted store dropped the reply, kept the user turn",
    storeState?.conv === true && storeState?.asst === false && storeState?.user === true,
    JSON.stringify(storeState)
  );

  await finish(ws);
}

async function finish(ws) {
  // V5 — cleanup: restore the ORIGINAL snapshot exactly, reload onto it, and
  // verify the test conversation is gone from the persisted store.
  let restored = false;
  if (originalSnapshot !== null) {
    await evalJs(
      ws,
      `localStorage.setItem(${JSON.stringify(LS_KEY)}, ${JSON.stringify(originalSnapshot)}); true`
    ).catch(() => {});
  } else {
    // No pre-existing value — the seed created it; remove the key entirely.
    await evalJs(ws, `localStorage.removeItem(${JSON.stringify(LS_KEY)}); true`).catch(() => {});
  }
  await evalJs(ws, `location.hash = "#/chat"; location.reload(); true`).catch(() => {});
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
