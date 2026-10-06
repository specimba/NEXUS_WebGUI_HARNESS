#!/usr/bin/env node
// ─── r287 QA rider: HF Trending keyword filter (r287 SHIPPED), in-vivo ───────
// RESTORED r288 (verbatim from session record) after the sandbox rolled back
// to the r275 snapshot and lost r276-r287. The r287 radar-view edits were
// re-applied to the rolled-back tree, so this suite should pass as before.
// The GitHub Stars tab always had a keyword filter; the HF board (30 items ×
// 3 kinds) rendered everything with no way to narrow it. r287 ships a live
// filter (id / pipeline_tag / library_name) + an honest "N of M" count line.
// This rider seeds a throwaway HF cache (snapshot → seed → reload through
// #/radar), drives the real tab + filter input in the real DOM, and restores
// the original snapshot byte-for-byte.
//   V0  app boots
//   V1  HF tab mounts with the 6 seeded cards
//   V2  honest baseline count line reads "6 of 6 models"
//   V3  filter "llama" narrows to 3 cards (2 id hits + 1 library_name hit)
//       and the count line says "3 of 6 models matching “llama”"
//   V4  clearing the filter restores all 6 cards
//   V5  cleanup: original praison-radar-hf snapshot restored byte-for-byte
// House shape (r265-r287 doctrine): self-created tab via PUT /json/new, tab
// closed on success AND error, waitFor tolerates transient evals, and — r287
// doctrine — Radix TabsTrigger needs pointerdown/focus: a bare synthetic
// .click() does NOT switch tabs.
// Usage: node scripts/cdp-qa-hf-filter.mjs [baseUrl]

import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";
const LS_KEY = "praison-radar-hf";
const FILTER_ARIA = "Filter HF items by keyword";

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

// 6 seeded trending models: "llama" matches two ids directly and one item
// ONLY via library_name ("llamaindex") — proving the haystack covers all
// three fields, not just the id.
const SEED = {
  fetchedAt: Date.now(),
  models: [
    { id: "acme/llama-widget-7b", likes: 120, downloads: 1000, pipeline_tag: "text-generation", library_name: "transformers" },
    { id: "acme/llama-memory-kit", likes: 80, downloads: 500, pipeline_tag: "text-generation", library_name: "transformers" },
    { id: "acme/bert-sandwich", likes: 10, downloads: 20, pipeline_tag: "fill-mask", library_name: "sentence-transformers" },
    { id: "acme/vision-looper", likes: 5, downloads: 9, pipeline_tag: "image-classification", library_name: "timm" },
    { id: "acme/whisper-hum", likes: 3, downloads: 7, pipeline_tag: "speech-recognition", library_name: "transformers" },
    { id: "acme/tiny-rag-sauce", likes: 1, downloads: 2, pipeline_tag: "question-answering", library_name: "llamaindex" },
  ],
  datasets: [],
  spaces: [],
};

const CARD_SEL = '[role="region"][aria-label="Trending models"] a[aria-label^="Open acme/"]';

function cardCount(ws) {
  return evalJs(ws, `document.querySelectorAll(${JSON.stringify(CARD_SEL)}).length`);
}

/** Type into the React-controlled filter input via the native setter. */
function typeFilter(ws, value) {
  return evalJs(
    ws,
    `(() => {
      const input = document.querySelector('input[aria-label=${JSON.stringify(FILTER_ARIA)}]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
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

  // V0 — app boots
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  check(
    "V0 app renders",
    await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`)
  );
  await new Promise((r) => setTimeout(r, 600));

  // Seed: snapshot the original HF cache, write the throwaway board.
  originalSnapshot = await evalJs(ws, `localStorage.getItem(${JSON.stringify(LS_KEY)})`);
  const seeded = await evalJs(
    ws,
    `localStorage.setItem(${JSON.stringify(LS_KEY)}, ${JSON.stringify(JSON.stringify(SEED))}); true`
  ).catch(() => null);
  if (!seeded) {
    check("seed HF cache written to localStorage", false);
    await finish(ws);
    return;
  }

  // Reload onto the radar view; the default tab is "models", so explicitly
  // click the "HF Trending" trigger to mount HfTrendingTab (it reads the
  // cache on mount — seeded value, no network fetch).
  await evalJs(ws, `location.hash = "#/radar"; location.reload(); true`).catch(() => {});
  const tabsReady = await waitFor(
    ws,
    `[...document.querySelectorAll('button[role="tab"]')].some((b) => /HF Trending/.test(b.textContent || ""))`,
    20_000
  );
  if (!tabsReady) {
    check("V1 radar view mounts with tab triggers", false);
    await finish(ws);
    return;
  }
  // Radix TabsTrigger activates on pointerdown/focus — a bare synthetic
  // .click() (click event only) does NOT switch the tab. Dispatch the full
  // sequence and focus the trigger (automatic activation follows focus).
  const clicked = await evalJs(
    ws,
    `(() => {
      const tab = [...document.querySelectorAll('button[role="tab"]')].find((b) => /HF Trending/.test(b.textContent || ""));
      if (!tab) return "no-tab";
      const opts = { bubbles: true, cancelable: true, view: window };
      tab.focus();
      tab.dispatchEvent(new PointerEvent("pointerdown", opts));
      tab.dispatchEvent(new MouseEvent("mousedown", opts));
      tab.dispatchEvent(new MouseEvent("mouseup", opts));
      tab.click();
      return "clicked:" + (tab.getAttribute("data-state") ?? "?");
    })()`
  ).catch(() => "eval-err");

  // V1 — seeded cards hydrate on the HF tab.
  const cards = await waitFor(ws, `document.querySelectorAll(${JSON.stringify(CARD_SEL)}).length === 6`, 15_000);
  if (cards) {
    check("V1 HF tab mounts with the 6 seeded cards", true, `count=${await cardCount(ws)}`);
  } else {
    const diag = await evalJs(
      ws,
      `[...document.querySelectorAll('button[role="tab"]')].map((b) => (b.getAttribute("data-state") ?? "?") + ":" + (b.textContent || "").trim().slice(0, 12)).join(" | ")`
    );
    check("V1 HF tab mounts with the 6 seeded cards", false, `click=${clicked} tabs=[${diag}]`);
  }

  // V2 — honest baseline count line.
  const baseLine = await waitFor(
    ws,
    `[...document.querySelectorAll("p")].some((p) => /6 of 6 models/.test(p.textContent || ""))`,
    8_000
  );
  check("V2 baseline count line reads '6 of 6 models'", baseLine);

  // V3 — filter "llama": 2 id hits + 1 library_name (llamaindex) hit.
  const inputPresent = await waitFor(
    ws,
    `document.querySelector('input[aria-label=${JSON.stringify(FILTER_ARIA)}]') !== null`,
    8_000
  );
  const typed = inputPresent ? await typeFilter(ws, "llama") : false;
  const narrowed = typed
    ? await waitFor(ws, `document.querySelectorAll(${JSON.stringify(CARD_SEL)}).length === 3`, 10_000)
    : false;
  const matchLine = await waitFor(
    ws,
    `[...document.querySelectorAll("p")].some((p) => /3 of 6 models matching/.test(p.textContent || ""))`,
    8_000
  );
  check("V3 filter 'llama' narrows to 3 cards", narrowed, `typed=${Boolean(typed)}`);
  check("V3 count line says '3 of 6 models matching'", matchLine);
  const narrowedIds = await evalJs(
    ws,
    `[...document.querySelectorAll(${JSON.stringify(CARD_SEL)})].map((a) => a.getAttribute("aria-label"))`
  );
  const idsOk =
    Array.isArray(narrowedIds) &&
    narrowedIds.length === 3 &&
    narrowedIds.some((s) => String(s).includes("acme/llama-widget-7b")) &&
    narrowedIds.some((s) => String(s).includes("acme/llama-memory-kit")) &&
    narrowedIds.some((s) => String(s).includes("acme/tiny-rag-sauce"));
  check("V3 narrowed set = 2 id hits + 1 library_name hit", idsOk, JSON.stringify(narrowedIds));

  // V4 — clearing the filter restores the full board.
  await typeFilter(ws, "");
  const restored6 = await waitFor(ws, `document.querySelectorAll(${JSON.stringify(CARD_SEL)}).length === 6`, 10_000);
  check("V4 clearing the filter restores all 6 cards", restored6);

  await finish(ws);
}

async function finish(ws) {
  // V5 — cleanup: restore the ORIGINAL snapshot exactly and verify it stuck
  // (no fetch happened, so the app never rewrites the cache behind us).
  if (originalSnapshot !== null) {
    await evalJs(
      ws,
      `localStorage.setItem(${JSON.stringify(LS_KEY)}, ${JSON.stringify(originalSnapshot)}); true`
    ).catch(() => {});
  } else {
    await evalJs(ws, `localStorage.removeItem(${JSON.stringify(LS_KEY)}); true`).catch(() => {});
  }
  await evalJs(ws, `location.reload(); true`).catch(() => {});
  await waitFor(ws, `document.readyState === "complete"`, 15_000).catch(() => {});
  await new Promise((r) => setTimeout(r, 900));
  const now = await evalJs(ws, `localStorage.getItem(${JSON.stringify(LS_KEY)})`);
  const clean = originalSnapshot === null ? now === null : now === originalSnapshot;
  check("V5 original praison-radar-hf snapshot restored byte-for-byte", clean);

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
