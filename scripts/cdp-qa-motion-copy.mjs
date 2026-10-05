#!/usr/bin/env node
// ─── r272 QA: reduced-motion (r271) + copy-resilience (r270) + hash links ────
// One pass closes BOTH pending verification debts on a fresh bundle:
//   M0  app boots
//   M1  control — ticker marquee animates (animationName = ticker-scroll)
//   M2  emulated prefers-reduced-motion: reduce → ticker animationName = none
//       (r271 expanded CSS block, proven in-vivo via CDP media emulation)
//   M3  hash deep-links — #/agents, #/workflows, #/chat, #/settings each flip
//       the persisted ui store's view (r272 applyHashRoute completion); bare
//       #/settings also clears the section anchor
//   M4  copy-resilience (r270) — a copy button click surfaces a toast
//       (success via clipboard API or execCommand fallback, or the honest
//       failure toast; ANY of the three proves the feedback lane is live)
// House shape (r265–r268 doctrine): self-created tab via PUT /json/new — never
// rides a leftover tab; ensureChrome self-heals 9222 (wedge-aware r263, janitor
// r265). Tab closed on success AND error. waitFor tolerates transient evals.
// Usage: node scripts/cdp-qa-motion-copy.mjs [baseUrl]

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

  // M0 — app boots
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  check("M0 app renders", await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`));

  // M1 — control: probe element carrying the ticker class animates. (The real
  // ModelTicker renders null on a rows-less fresh profile, so the stylesheet
  // rule is asserted on an injected probe in the real page context.)
  await evalJs(ws, `(() => { const el = document.createElement("div"); el.className = "ticker-track"; el.id = "qa-motion-probe"; document.body.appendChild(el); return true; })()`);
  const animControl = await evalJs(ws, `getComputedStyle(document.getElementById("qa-motion-probe")).animationName`);
  check("M1 control: .ticker-track rule animates", animControl === "ticker-scroll", `animationName=${animControl}`);

  // M2 — emulated prefers-reduced-motion: reduce kills the marquee (r271)
  await cmd(ws, "Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  const animReduced = await evalJs(ws, `getComputedStyle(document.getElementById("qa-motion-probe")).animationName`);
  check("M2 reduced-motion: ticker animation disabled", animReduced === "none", `animationName=${animReduced}`);
  await evalJs(ws, `document.getElementById("qa-motion-probe")?.remove(); true`);
  // Reset emulation so later assertions run in the default media state.
  await cmd(ws, "Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });

  // M3 — hash deep-links flip the persisted ui view (r272 completion).
  // Settings is navigated LAST so M4 rides the same view state (the referral
  // card's "Copy link" lives there; the real ModelTicker renders null on a
  // rows-less profile — r272 probe run confirmed the feed-gated null render).
  const viewExpr = (head) =>
    `(JSON.parse(localStorage.getItem("praison-ui") || "{}")?.state?.view ?? null) === "${head}"`;
  for (const head of ["agents", "workflows", "chat"]) {
    await evalJs(ws, `location.hash = "#/${head}"`).catch(() => {});
    const ok = await waitFor(ws, viewExpr(head), 8_000);
    check(`M3 #/${head} deep-link flips view`, ok);
  }
  await evalJs(ws, `location.hash = "#/settings"`).catch(() => {});
  const settingsFlipped = await waitFor(ws, viewExpr("settings"), 8_000);
  check("M3 #/settings deep-link flips view", settingsFlipped);
  const anchorCleared = await evalJs(ws, `(JSON.parse(localStorage.getItem("praison-ui") || "{}").state.settingsAnchor) == null`);
  check("M3b bare #/settings clears section anchor", anchorCleared === true, `anchorCleared=${anchorCleared}`);
  check("M3c settings view painted via deep link", await waitFor(ws, `document.querySelector("h2")?.textContent?.trim() === "Settings"`));

  // M4 — copy feedback lane (r270): click a copy control on Settings, expect
  // a toast (success via clipboard API or execCommand fallback, or the
  // honest failure toast — ANY proves the feedback lane is live). The finder
  // returns diagnostics on failure instead of a bare boolean.
  const clickRes = await evalJs(ws, `(() => {
    const hay = (e) => [e.getAttribute("aria-label"), e.getAttribute("title"), e.textContent]
      .map((x) => (x || "").toLowerCase()).join(" ");
    const btns = [...document.querySelectorAll("button")];
    const btn = document.querySelector("button[aria-label^='Copy model id']")
      || btns.find((e) => /copy/.test(hay(e)) && e.offsetParent !== null);
    if (!btn) return { clicked: false, h2: document.querySelector("h2")?.textContent?.trim() ?? null, copyish: btns.filter((e) => /copy/.test(hay(e))).length };
    btn.click();
    return { clicked: true };
  })()`);
  check("M4 copy control found + clicked", clickRes?.clicked === true, JSON.stringify(clickRes));
  const toastOk = await waitFor(ws, `[...document.querySelectorAll("[data-sonner-toast]")].some((e) => /copied|copy failed/i.test(e.textContent || ""))`, 6_000);
  const toastText = await evalJs(ws, `[...document.querySelectorAll("[data-sonner-toast]")].map((e) => e.textContent || "").join(" | ")`);
  check("M4b copy feedback toast surfaced (success or honest failure)", toastOk, String(toastText).slice(0, 120));

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
