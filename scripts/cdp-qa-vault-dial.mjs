#!/usr/bin/env node
// ─── r277 QA rider: vault live-dial (r276 SHIPPED), in-vivo ──────────────────
// Closes r276's queued rider: the Dial button on a server-lane slot must
// fire POST /api/vault/test-dial and surface an HONEST toast (verdict
// language, not silence). The API verdicts themselves were curl-proven
// in-vivo this round: no-slot → 404, openrouter → 400 allowlist guard,
// junk groq key → verdict "inconclusive" (groq answers 403 from this
// network — key-vs-IP indistinguishable, exactly the doctrine).
//   V0  app boots
//   V1  vault card hydrates with the seeded junk groq slot + Dial button
//       (hydration doctrine: wait on section CONTENT, not headings)
//   V2  clicking Dial fires /api/vault/test-dial (performance entry)
//   V3  an honest toast appears (provider name + verdict language)
//   V4  cleanup: junk slot removed from the vault DB
// House shape (r265-r276 doctrine): self-created tab via PUT /json/new, tab
// closed on success AND error, waitFor tolerates transient evals. Node-side
// fetch drives the vault API directly (localhost-only endpoints, same host).
// Usage: node scripts/cdp-qa-vault-dial.mjs [baseUrl]

import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";
const JUNK_PROVIDER = "groq";
const JUNK_KEY = "gsk_junk_cdp_rider_r277_not_real";

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

async function seedJunkSlot() {
  const res = await fetch(`${BASE}/api/vault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: JUNK_PROVIDER, key: JUNK_KEY }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`seed POST /api/vault failed: HTTP ${res.status}`);
}

async function cleanupJunkSlot() {
  try {
    await fetch(`${BASE}/api/vault?provider=${JUNK_PROVIDER}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    /* best effort — junk key is fake regardless */
  }
  try {
    const res = await fetch(`${BASE}/api/vault`, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    return !(json.vault ?? []).some((s) => s.provider === JUNK_PROVIDER);
  } catch {
    return false;
  }
}

async function main() {
  const mode = await ensureChrome();
  console.log(`ensureChrome: ${mode}`);
  await seedJunkSlot();

  const tabRes = await fetch(`${CDP}/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status}`);
  const page = await tabRes.json();
  tabId = page.id;
  const ws = await connect(page.webSocketDebuggerUrl);

  // V0 — app boots
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  check("V0 app renders", await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`));

  // V1 — vault card hydrates with the seeded slot. Hydration doctrine
  // (r275): wait on section CONTENT — the Dial button is client-rendered
  // inside the settings view; its existence IS the content signal.
  await evalJs(ws, `location.hash = "#/settings"`).catch(() => {});
  const dialReady = await waitFor(
    ws,
    `[...document.querySelectorAll("button")].some((e) => /^dial$/i.test((e.textContent || "").trim()))`,
    20_000
  );
  check("V1 vault card hydrated with a Dial button", dialReady);

  // Click the Dial button in the GROQ row specifically (other slots may exist).
  await evalJs(ws, `(() => {
    const btn = [...document.querySelectorAll("li")]
      .filter((li) => /groq/i.test(li.textContent || ""))
      .flatMap((li) => [...li.querySelectorAll("button")])
      .find((b) => /^dial$/i.test((b.textContent || "").trim()));
    if (!btn) return false;
    btn.click();
    return true;
  })()`).catch(() => false);

  // V2 — the click fired the live-dial API (resource timing).
  const reqOk = await waitFor(
    ws,
    `performance.getEntriesByType("resource").some((r) => /test-dial/.test(r.name))`,
    15_000
  );
  check("V2 Dial click fired POST /api/vault/test-dial", reqOk);

  // V3 — an HONEST toast: provider name + verdict language. groq answers 403
  // from this network → expect "unjudged" (inconclusive); accept any verdict
  // language (accepted/rejected/unjudged/unreachable) — the assertion is that
  // the button SPEAKS instead of staying silent, whatever the upstream says.
  const toastOk = await waitFor(
    ws,
    `[...document.querySelectorAll("[data-sonner-toast]")].some((t) =>
      /groq/i.test(t.textContent || "") &&
      /accepted|rejected|unjudged|unreachable/i.test(t.textContent || ""))`,
    20_000
  );
  const toastText = await evalJs(
    ws,
    `([...document.querySelectorAll("[data-sonner-toast]")].map((t) => (t.textContent || "").slice(0, 140)).join(" | ")) || null`
  );
  check("V3 honest dial toast appeared (name + verdict language)", toastOk, toastText ?? "no toast");

  await closeTab();
  ws.close();

  // V4 — cleanup: the junk slot must be gone from the vault DB.
  check("V4 junk slot removed (vault DB clean)", await cleanupJunkSlot());

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main()
  .catch(async (e) => {
    console.error("FATAL:", e?.message ?? e);
    await cleanupJunkSlot();
    await closeTab();
    process.exit(1);
  });
