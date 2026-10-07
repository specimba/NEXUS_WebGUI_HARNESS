#!/usr/bin/env node
// ─── r314 QA: chat interactions survive the r312 callback stabilization ──────
// r312 swapped `conversation` → `activeId` inside regenerate/editAndResend/
// answerAs (identity-only fix so MessageItem's memo holds during streams).
// Identity is already regression-gated (cdp-qa-memo-renders ghosts = 0), but
// the RESOLUTION half — the callbacks must still find the active conversation
// — had no witness. This suite drives two real interactions end-to-end:
//   I0  app boots
//   I1  seeded conv hydrates (user turn + done reply + ERRORED last reply —
//       the error banner is what exposes the inline Retry button)
//   I2  spend-guard armed: window.fetch wrapped — /api/chat is recorded and
//       NEVER resolves (runAgentChat uses fetch("/api/chat"), chat-client.ts),
//       everything else passes through. Zero provider traffic, by construction.
//   I3  REGENERATE: click the error banner's Retry → store truth: last reply
//       emptied + status "streaming" (regenerate mutates BEFORE runTurn,
//       chat-view :609→:625) AND the stub recorded the turn firing
//   I4  EDIT-RESEND: click "Edit message", change text, Enter → store truth:
//       user content replaced, thread truncated to [user, new streaming asst],
//       title re-derived (all pre-runTurn, :751-774) AND stub recorded
//   I5  answerAs shares the guard+find+dep shape (identical r312 edit); its
//       Radix popover is not driven here — covered by the shared pattern, not
//       witnessed live (noted in worklog, not hidden)
//   I6  cleanup: BOTH seeded LS keys (conversations + agents) restored
//       byte-for-byte
// House shape: self-created tab via PUT /json/new, tab closed on success AND
// error, JS .click() reaches hover-revealed buttons, debouncedStorage (450ms)
// gets headroom before every LS read.
// Usage: node scripts/cdp-qa-chat-interactions.mjs [baseUrl]
import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";
const CONV_ID = "conv_cdp_interact_r314";
const USER_ID = "msg_cdp_interact_r314_user";
const ASST1_ID = "msg_cdp_interact_r314_a1";
const ASST2_ID = "msg_cdp_interact_r314_a2";
const AGENT_ID = "agent_qa_r314";
const EDITED_TEXT = "r314 edited turn — the reply below should restart from here.";
const LS_CONV = "praison-conversations";
const LS_AGENTS = "praison-agents";

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

let snapConv = null;
let snapAgents = null;

/** Merge the throwaway conversation + QA agent into the persisted stores.
 *  The QA agent guarantees getById() resolves for both callbacks' sourceAgent
 *  chains. Remembers BOTH original strings for byte-for-byte restore. */
async function seed(ws) {
  snapConv = await evalJs(ws, `localStorage.getItem(${JSON.stringify(LS_CONV)})`);
  snapAgents = await evalJs(ws, `localStorage.getItem(${JSON.stringify(LS_AGENTS)})`);
  return evalJs(
    ws,
    `(() => {
      const now = Date.now();
      // agents: clone-or-create so sourceAgent resolves
      let ab; try { ab = JSON.parse(localStorage.getItem(${JSON.stringify(LS_AGENTS)}) || "null"); } catch { ab = null; }
      const astate = ab?.state ?? {};
      const alist = Array.isArray(astate.agents) ? astate.agents : [];
      if (!alist.some((a) => a && a.id === ${JSON.stringify(AGENT_ID)})) {
        const base = alist[0] ?? null;
        const agent = base
          ? { ...base, id: ${JSON.stringify(AGENT_ID)}, name: "QA r314" }
          : { id: ${JSON.stringify(AGENT_ID)}, name: "QA r314", emoji: "🤖", color: "violet",
              role: "QA", description: "qa", instructions: "qa", model: "auto",
              temperature: 0.4, maxIterations: 3, tools: [], createdAt: now, updatedAt: now };
        alist.unshift(agent);
        localStorage.setItem(${JSON.stringify(LS_AGENTS)}, JSON.stringify({
          state: { ...astate, agents: alist }, version: ab?.version ?? 0,
        }));
      }
      // conversations: user turn + done reply + errored last reply (Retry lives
      // in the error banner — only an errored last message renders it)
      let cb; try { cb = JSON.parse(localStorage.getItem(${JSON.stringify(LS_CONV)}) || "null"); } catch { cb = null; }
      const cstate = cb?.state ?? {};
      const clist = Array.isArray(cstate.conversations) ? cstate.conversations : [];
      const conv = {
        id: ${JSON.stringify(CONV_ID)},
        title: "CDP interactions r314",
        messages: [
          { id: ${JSON.stringify(USER_ID)}, role: "user",
            content: "CDP interactions r314 — original question.", createdAt: now,
            toolCalls: [], status: "done" },
          { id: ${JSON.stringify(ASST1_ID)}, role: "assistant",
            content: "CDP interactions r314 — first reply, kept.", createdAt: now + 1,
            toolCalls: [], status: "done", agentId: ${JSON.stringify(AGENT_ID)}, agentName: "QA r314" },
          { id: ${JSON.stringify(ASST2_ID)}, role: "assistant",
            content: "CDP interactions r314 — failed last reply.", createdAt: now + 2,
            toolCalls: [], status: "error", error: "qa seed error (retry me)",
            agentId: ${JSON.stringify(AGENT_ID)}, agentName: "QA r314" },
        ],
        createdAt: now, updatedAt: now,
      };
      const next = clist.filter((c) => c && c.id !== conv.id);
      next.unshift(conv);
      localStorage.setItem(${JSON.stringify(LS_CONV)}, JSON.stringify({
        state: { ...cstate, conversations: next, activeId: conv.id },
        version: cb?.version ?? 0,
      }));
      return true;
    })()`
  );
}

/** Arm the spend-guard: SAME-ORIGIN passthrough only — any cross-origin URL
 *  (provider endpoints like vyceai.com/v1/chat/completions — runAgentChat CAN
 *  bypass /api/chat and dial providers directly, witnessed r314) is recorded
 *  and NEVER resolves. Zero provider traffic, by construction, regardless of
 *  which endpoint the turn uses. */
async function armStub(ws) {
  return evalJs(
    ws,
    `(() => {
      if (window.__QA_STUB_INSTALLED__) return true;
      const orig = window.fetch.bind(window);
      window.__QA_STUB__ = { chatCalls: 0, blocked: 0, urls: [] };
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : (input?.url ?? String(input));
        if (window.__QA_STUB__.urls.length < 16) window.__QA_STUB__.urls.push(url);
        const sameOrigin = url.startsWith("/") || url.includes(location.origin);
        if (!sameOrigin) {
          window.__QA_STUB__.blocked += 1;
          return new Promise(() => {}); // never resolves — zero provider traffic
        }
        if (url.includes("/api/chat")) {
          window.__QA_STUB__.chatCalls += 1;
          return new Promise(() => {}); // server lane also never completes
        }
        return orig(input, init);
      };
      window.__QA_STUB_INSTALLED__ = true;
      return true;
    })()`
  );
}

const STUB_CALLS = `((window.__QA_STUB__?.chatCalls ?? -1) + (window.__QA_STUB__?.blocked ?? -1))`;

async function hydrate(ws) {
  return waitFor(
    ws,
    `document.querySelector(${JSON.stringify(`[data-msg-id="${ASST2_ID}"]`)}) !== null`,
    20_000
  );
}

async function main() {
  const mode = await ensureChrome();
  console.log(`ensureChrome: ${mode}`);

  const tabRes = await fetch(`${CDP}/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status}`);
  const page = await tabRes.json();
  tabId = page.id;
  const ws = await connect(page.webSocketDebuggerUrl);

  // I0 — app boots
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  check(
    "I0 app renders",
    await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`)
  );

  // Boot-triggered debounced flushes land BEFORE the seed write (450ms debounce).
  await new Promise((r) => setTimeout(r, 900));
  const seeded = await seed(ws);
  if (!seeded) {
    check("seed conversation + agent written to localStorage", false);
    await finish(ws);
    return;
  }

  // Load the seeded conversation on the chat view.
  await evalJs(ws, `location.hash = "#/chat"; location.reload(); true`).catch(() => {});
  await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`);
  check("I1 seeded turn + errored reply hydrate in the chat view", await hydrate(ws));

  // I2 — arm the spend-guard (page must be loaded; reloads re-arm).
  const stubOk = await armStub(ws);
  const stubAlive = await evalJs(ws, `window.__QA_STUB_INSTALLED__ === true`).catch(() => false);
  check("I2 fetch stub armed — /api/chat recorded, never resolved", stubOk && stubAlive);

  // I3 — REGENERATE via the error banner's Retry button.
  await evalJs(
    ws,
    `(() => {
      const card = document.querySelector(${JSON.stringify(`[data-msg-id="${ASST2_ID}"]`)});
      const btn = [...(card?.querySelectorAll("button") ?? [])].find(
        (b) => (b.textContent || "").trim() === "Retry");
      if (!btn) return false;
      btn.click();
      return true;
    })()`
  ).catch(() => false);
  // runAgentChat may pre-flight (provider/relay resolution) before the chat
  // fetch — poll instead of a fixed sleep.
  const regenCalls = await waitFor(ws, `(${STUB_CALLS}) >= 1`, 15_000);
  // The blocked fetch fires BEFORE the 450ms debounced LS flush — give the
  // store's persisted copy headroom or the read below races it (seen r314).
  await new Promise((r) => setTimeout(r, 900));
  const regen = await evalJs(
    ws,
    `(() => {
      try {
        const bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_CONV)}) || "null");
        const conv = (bundle?.state?.conversations ?? []).find((c) => c.id === ${JSON.stringify(CONV_ID)});
        if (!conv) return { found: false };
        const last = conv.messages.find((m) => m.id === ${JSON.stringify(ASST2_ID)});
        return {
          found: true,
          emptied: last?.content === "",
          streaming: last?.status === "streaming",
          calls: ${STUB_CALLS},
        };
      } catch { return { found: false }; }
    })()`
  );
  check(
    "I3 Retry regenerates — reply emptied + streaming, turn fired into stub",
    regen?.found === true && regen.emptied && regen.streaming && regen.calls >= 1,
    JSON.stringify({
      ...regen,
      polled: regenCalls,
      urls: await evalJs(ws, `window.__QA_STUB__?.urls ?? []`).catch(() => null),
    })
  );

  // I4 — clean page life for the edit leg: restore → re-seed → reload → re-arm.
  await evalJs(
    ws,
    `localStorage.setItem(${JSON.stringify(LS_CONV)}, ${JSON.stringify(snapConv)}); true`
  ).catch(() => {});
  await evalJs(
    ws,
    `localStorage.setItem(${JSON.stringify(LS_AGENTS)}, ${JSON.stringify(snapAgents)}); true`
  ).catch(() => {});
  await seed(ws);
  await evalJs(ws, `location.hash = "#/chat"; location.reload(); true`).catch(() => {});
  await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`);
  const rehydrated = await hydrate(ws);
  await armStub(ws);
  if (!rehydrated) {
    check("I4 reset for edit leg (re-seed + reload)", false);
    await finish(ws);
    return;
  }
  check("I4 reset for edit leg (re-seed + reload + re-arm)", true);

  // I5 — EDIT-RESEND: open the editor, change the text, Enter resends.
  await evalJs(
    ws,
    `(() => {
      const card = document.querySelector(${JSON.stringify(`[data-msg-id="${USER_ID}"]`)});
      const btn = card?.querySelector('button[aria-label="Edit and resend message"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`
  ).catch(() => false);
  const editorOpen = await waitFor(
    ws,
    `document.querySelector('textarea[aria-label="Edit message"]') !== null`,
    8_000
  );
  if (editorOpen) {
    await evalJs(
      ws,
      `(() => {
        const ta = document.querySelector('textarea[aria-label="Edit message"]');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        setter.call(ta, ${JSON.stringify(EDITED_TEXT)});
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        return true;
      })()`
    ).catch(() => false);
  }
  // Pre-flight + truncation + append all land within one store burst — poll
  // for the full conjunction instead of a fixed sleep.
  const editReady = await waitFor(
    ws,
    `(() => {
      try {
        const bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_CONV)}) || "null");
        const conv = (bundle?.state?.conversations ?? []).find((c) => c.id === ${JSON.stringify(CONV_ID)});
        if (!conv) return false;
        const user = conv.messages.find((m) => m.id === ${JSON.stringify(USER_ID)});
        return user?.content === ${JSON.stringify(EDITED_TEXT)} && conv.messages.length === 2;
      } catch { return false; }
    })()`,
    15_000
  );
  const edited = await evalJs(
    ws,
    `(() => {
      try {
        const bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_CONV)}) || "null");
        const conv = (bundle?.state?.conversations ?? []).find((c) => c.id === ${JSON.stringify(CONV_ID)});
        if (!conv) return { found: false };
        const user = conv.messages.find((m) => m.id === ${JSON.stringify(USER_ID)});
        const last = conv.messages[conv.messages.length - 1];
        return {
          found: true,
          textSwapped: user?.content === ${JSON.stringify(EDITED_TEXT)},
          truncated: conv.messages.length === 2,
          newAsstStreaming: last?.role === "assistant" && last?.status === "streaming",
          retitled: conv.title && conv.title !== "CDP interactions r314",
          calls: ${STUB_CALLS},
        };
      } catch { return { found: false }; }
    })()`
  );
  check(
    "I5 edit + Enter resends — text swapped, thread truncated, new streaming reply, turn fired",
    edited?.found === true && edited.textSwapped && edited.truncated &&
      edited.newAsstStreaming && edited.calls >= 1,
    JSON.stringify({
      ...edited,
      editorOpen,
      polled: editReady,
      urls: await evalJs(ws, `window.__QA_STUB__?.urls ?? []`).catch(() => null),
    })
  );
  await finish(ws);
}

async function finish(ws) {
  // I6 — cleanup: restore BOTH original snapshots exactly and verify the test
  // conversation + agent are gone from the persisted stores.
  let restored = false;
  if (snapConv !== null) {
    await evalJs(ws, `localStorage.setItem(${JSON.stringify(LS_CONV)}, ${JSON.stringify(snapConv)}); true`).catch(() => {});
  } else {
    await evalJs(ws, `localStorage.removeItem(${JSON.stringify(LS_CONV)}); true`).catch(() => {});
  }
  if (snapAgents !== null) {
    await evalJs(ws, `localStorage.setItem(${JSON.stringify(LS_AGENTS)}, ${JSON.stringify(snapAgents)}); true`).catch(() => {});
  } else {
    await evalJs(ws, `localStorage.removeItem(${JSON.stringify(LS_AGENTS)}); true`).catch(() => {});
  }
  await evalJs(ws, `location.reload(); true`).catch(() => {});
  await waitFor(ws, `document.readyState === "complete"`, 15_000).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
  const clean = await evalJs(
    ws,
    `(() => {
      try {
        const cb = JSON.parse(localStorage.getItem(${JSON.stringify(LS_CONV)}) || "null");
        const ab = JSON.parse(localStorage.getItem(${JSON.stringify(LS_AGENTS)}) || "null");
        const convGone = !((cb?.state?.conversations ?? []).some((c) => c.id === ${JSON.stringify(CONV_ID)}));
        const agentGone = !((ab?.state?.agents ?? []).some((a) => a.id === ${JSON.stringify(AGENT_ID)}));
        return convGone && agentGone;
      } catch { return false; }
    })()`
  );
  restored = clean === true;
  check("I6 original conversations + agents snapshots restored", restored);

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
