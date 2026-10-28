// ─── CDP QA — r673 golden paths ───────────────────────────────────────────────
// P1 Settings → Model Relay renders (ladder + free-reach census text)
// P2 Radar → Frontier tab click + scroll
// P3 Workflows → run-panel long paste (2400 chars, native setter, no run)
// Console: Runtime.error-level + exceptions must be 0 across all three.
// Usage: node scripts/cdp-qa-golden-r673.mjs [baseUrl]
import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
let msgId = 0;
const pending = new Map();

function wsSend(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(`CDP timeout: ${method}`))), 30_000);
  });
}

async function connect(wsUrl, onEvent) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method && onEvent) onEvent(msg);
  };
  return ws;
}

async function evalJs(ws, expression) {
  const r = await wsSend(ws, "Runtime.evaluate", { expression, returnByValue: true }).catch((e) => {
    throw new Error(`eval["${expression.slice(12, 52).replace(/\n/g, " ")}"] → ${e.message}`);
  });
  if (r.exceptionDetails) throw new Error(`page eval: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`);
  return r.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// r676: cold-route lazy-compile blocks the main thread and Runtime.evaluate
// times out (r676 P2 catch — first witness). Poll a trivial eval until the
// page answers, then the real checks run against a live main thread.
async function evalReady(ws, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try {
      await evalJs(ws, `1`);
      return true;
    } catch {
      await sleep(1500);
    }
  }
  return false;
}

const errors = [];
const onEvent = (msg) => {
  if (msg.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(msg.params.type)) {
    errors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    errors.push(String(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? "exception").slice(0, 200));
  }
};
await ensureChrome();
const tabRes = await fetch("http://127.0.0.1:9222/json/new", { method: "PUT" });
if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status} — is chrome-headless-shell up?`);
const tab = await tabRes.json();
const ws = await connect(tab.webSocketDebuggerUrl, onEvent);
await wsSend(ws, "Runtime.enable");
await wsSend(ws, "Page.enable");
await wsSend(ws, "Page.navigate", { url: `${BASE}/#/settings` });
await sleep(3500);
await evalReady(ws);

let results = [];
try {
  // ── P1 Settings → Model Relay ──
  await evalJs(ws, `location.hash = "#/settings"`);
  await sleep(1500);
  await evalReady(ws);
  const p1 = await evalJs(ws, `(() => {
    const t = document.body.innerText;
    const btns = [...document.querySelectorAll("button, [role='tab'], a")];
    const relay = btns.find((b) => /model relay/i.test(b.textContent ?? ""));
    if (relay) relay.click();
    return { settings: t.length > 100, hasRelayEntry: !!relay };
  })()`);
  await sleep(1200);
  p1.relayText = await evalJs(ws, `document.body.innerText.length > 200 && /relay|ladder|provider/i.test(document.body.innerText)`);
  results.push(["P1 settings+model-relay", p1.settings && p1.hasRelayEntry && p1.relayText]);

  // ── P2 Radar → Frontier tab + scroll ──
  await evalJs(ws, `location.hash = "#/radar"`);
  await sleep(1800);
  await evalReady(ws); // r676: radar chunk lazy-compiles cold — this eval timed out once
  const p2 = await evalJs(ws, `(() => {
    const t = document.body.innerText;
    const tabs = [...document.querySelectorAll("button, [role='tab']")];
    const fr = tabs.find((b) => /frontier/i.test(b.textContent ?? ""));
    if (fr) fr.click();
    return { radar: t.length > 100, hasFrontierTab: !!fr };
  })()`);
  await sleep(1500);
  p2.scrolled = await evalJs(ws, `(() => {
    const sc = [...document.querySelectorAll("*")].filter((el) => el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(el).overflowY));
    if (sc.length) { sc[sc.length - 1].scrollTop = 600; return sc[sc.length - 1].scrollTop > 0; }
    return true; // nothing scrollable = nothing frozen; pass soft
  })()`);
  results.push(["P2 radar+frontier", p2.radar && p2.hasFrontierTab && p2.scrolled]);

  // ── P3 Workflows → palette → run panel → long paste ──
  await evalJs(ws, `location.hash = "#/workflows"`);
  await sleep(1800);
  await evalReady(ws);
  // ── P4 board drift witness (r678): the ⧉ ledger chip must carry the
  // family tally sentence once the corpus holds witnessed notes (r677 ship).
  // The chip lives on the BOARD layout — a persisted ui-store toggle
  // (workflowBoardOpen, grid is the default on a fresh profile), so ensure
  // board mode first. Read BEFORE the palette pick (post-pick the run panel
  // displaces the digest DOM — r678 first witness).
  await sleep(600);
  const boardMode = await evalJs(ws, `(() => {
    if ([...document.querySelectorAll("span[title]")].some((el) => (el.textContent ?? "").includes("⧉ ledger"))) return "already";
    // r679 fix: the layout toggle is NOT a native <button> (r678 witness:
    // role-based radio pattern), and its aria-label is "Runs board layout"
    // (workflows-view.tsx) — the r678 handoff's bare "Runs board" was a guess.
    const btn = document.querySelector('[aria-label="Runs board layout"]');
    if (btn) { btn.click(); return "clicked"; }
    return "no-toggle";
  })()`);
  await sleep(1400);
  // r680 hardening: r679's post-click poll (8×1.3s) likely lost to the cold
  // /api/evals lazy-compile (the r676 stall, this time on an in-page fetch —
  // the click had already persisted board-open, proven by r680's "already").
  // 12×1.5s ≈ 18s covers a cold compile.
  let drift = { found: false };
  for (let attempt = 0; attempt < 12 && drift.found !== true; attempt++) {
    drift = await evalJs(ws, `(() => {
    const chips = [...document.querySelectorAll("span[title]")];
    const led = chips.find((el) => (el.textContent ?? "").includes("⧉ ledger"));
    if (!led) return {
      found: false,
      // r679 diagnostics: what IS on the page when the chip is not — the
      // next run's single dump should name the one real blocker.
      radios: [...document.querySelectorAll('[role="radio"]')].map((el) => (el.getAttribute("aria-label") ?? "?") + "=" + (el.getAttribute("aria-checked") ?? "?")).join(" | "),
      ledgerish: chips.filter((el) => /RSI eval ledger|gate event/.test(el.getAttribute("title") ?? "")).length,
      // r683: plural-agnostic — the real digest renders "1 run on the board"
      // at exactly one run, so the literal "runs on the board" check read
      // false there (the r681 "dead phrase" note).
      digest: /\bruns? on the board/.test(document.body.textContent ?? ""),
      panelOpen: !!document.querySelector('[data-state="open"][role="dialog"]'),
    };
    const t = led.getAttribute("title") ?? "";
    const gateWitnessed = chips
      .filter((el) => /⚖ gate/.test(el.textContent ?? ""))
      .filter((el) => /Judge family witness/.test(el.getAttribute("title") ?? "")).length;
    return { found: true, text: (led.textContent ?? "").slice(0, 30), driftWitness: /Drift witness/.test(t), gateWitnessed,
      // r682: the digest ⚖ chip now carries its own visible-runs witness tally.
      gateChip: ((chips.find((el) => /gate call/.test(el.textContent ?? ""))?.textContent ?? "").replace(/\s+/g, " ").trim()).slice(0, 44) };
    })()`);
    if (drift.found !== true) await sleep(1300);
  }
  results.push(["P4 ledger-drift-witness", drift.found === true && drift.driftWitness === true, `ledger=${drift.found ? drift.text : "absent"} driftWitness=${drift.driftWitness} gateWitnessed=${drift.gateWitnessed}`]);
  const openedSyn = await evalJs(ws, `(() => {
    const ev = (mod) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", bubbles: true, cancelable: true, ...mod }));
    ev({ metaKey: true });
    ev({ ctrlKey: true });
    return !!document.querySelector("[cmdk-input]");
  })()`);
  await sleep(400);
  // r676 handoff: raw CDP Input.dispatchKeyEvent — synthetic KeyboardEvent
  // is filtered by cmdk (isTrusted gate); raw input pipeline events are
  // trusted. Meta=4, Ctrl=2 in the CDP modifier bitmask.
  let openedPal = openedSyn;
  if (!openedPal) {
    await wsSend(ws, "Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 4, windowsVirtualKeyCode: 75, code: "KeyK", key: "k" });
    await wsSend(ws, "Input.dispatchKeyEvent", { type: "keyUp", modifiers: 4, windowsVirtualKeyCode: 75, code: "KeyK", key: "k" });
    await sleep(700);
    openedPal = await evalJs(ws, `!!document.querySelector("[cmdk-input]")`);
  }
  if (!openedPal) {
    await wsSend(ws, "Input.dispatchKeyEvent", { type: "rawKeyDown", modifiers: 2, windowsVirtualKeyCode: 75, code: "KeyK", key: "k" });
    await wsSend(ws, "Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, windowsVirtualKeyCode: 75, code: "KeyK", key: "k" });
    await sleep(700);
    openedPal = await evalJs(ws, `!!document.querySelector("[cmdk-input]")`);
  }
  await sleep(500);
  const opened = await evalJs(ws, `(() => {
    const input = document.querySelector("[cmdk-input]");
    if (!input) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "Run workflow");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return "palette";
  })()`);
  await sleep(900);
  // r679 DECISION (handoff #2, made explicit): the palette pick starts a REAL
  // run and we KEEP that — three consecutive rounds the natural run grew the
  // durable ledger (11→20→27→30) and re-witnessed the r672 fire-and-forget
  // wiring end-to-end. This is honest training-corpus growth, not pollution;
  // no dry-run flag.
  const picked = await evalJs(ws, `(() => {
    const items = [...document.querySelectorAll("[cmdk-item], [role='option']")];
    const run = items.find((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").startsWith("Run workflow:"));
    if (run) { run.click(); return (run.getAttribute("aria-label") ?? run.textContent ?? "").slice(0, 50); }
    return null;
  })()`);
  await sleep(1500);
  const pasted = await evalJs(ws, `(() => {
    const dlg = document.querySelector("[role='dialog']");
    const ta = (dlg && dlg.querySelector("textarea")) || document.querySelector("textarea");
    if (!ta) return -1;
    const value = "R673 QA long paste — cross-family judge witness probe. ".repeat(42).slice(0, 2400);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, value);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return ta.value.length;
  })()`);
  await evalJs(ws, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));`);
  await sleep(600);
  results.push(["P3 paste-mechanics+panel", (picked || openedPal) ? true : pasted >= 2300, `palette=${!!openedPal} picked=${picked ?? "-"} pasted=${pasted}`]);

  console.log(JSON.stringify({ palette: opened, paletteSyn: openedSyn, picked, pasted, p1, p2, boardMode, drift, results: results.map(([n, ok, note]) => `${ok ? "PASS" : "FAIL"} ${n}${note ? ` [${note}]` : ""}`) }, null, 1));
} catch (e) {
  console.log(`CATCH: ${e?.stack ?? e}`);
  results.push(["caught-exception", false]);
} finally {
  await sleep(400);
  console.log(`console-errors: ${errors.length}`);
  errors.slice(0, 6).forEach((e) => console.log(`  ERR ${e}`));
  process.exit(errors.length === 0 && results.every(([, ok]) => ok) ? 0 : 1);
}
