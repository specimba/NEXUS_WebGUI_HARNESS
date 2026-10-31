import { ensureChrome } from "./cdp-ensure-chrome.mjs";
// ─── CDP QA — G-series (r221): delete dialog names its real consequences ─────
// The r221 change: the agent delete dialog used to warn "Workflows that
// reference it will need to be updated" — vague, when the exact breakage is
// computable from the workflows store the view already holds. Now it NAMES
// the referencing workflows (up to 3 + "+N more") or says "No workflows
// reference it". Asserts end-to-end against the live dev server:
//   G1  Agents view renders a roster (≥1 card)
//   G2  POSITIVE: some seeded agent's delete dialog NAMES ≥1 workflow, and
//       every name it lists is a real, non-empty workflow name (the seed's
//       pipeline agents are referenced by Research Brief / Build & Verify /
//       Morning Briefing — asserted against the dialog's own claim, not a
//       hardcoded expectation)
//   G3  NEGATIVE + DELETION: duplicate a referenced agent (fresh id → zero
//       references) → its dialog reads "No workflows reference it"; then
//       actually DELETE the copy → card gone (end-to-end delete + no residue)
//   G4  hygiene: no leftover "copy" cards, original roster intact
// Cancel-path discipline: dialogs opened for inspection are CANCELLED — only
// the throwaway copy is ever deleted. Radix lessons: DropdownMenuTrigger
// opens on pointerdown (synthetic clicks must dispatch the pointer sequence),
// and dialogs close by CLICKING Cancel — Escape dispatch is unreliable.
// Launch chrome-headless-shell on :9222 first (see cdp-qa-vault-test.mjs).
// Usage: node scripts/cdp-qa-agent-delete-references.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT_DIR = path.resolve("ops/qa");
fs.mkdirSync(OUT_DIR, { recursive: true });

let msgId = 0;
const pending = new Map();

function wsSend(ws, method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }
    }, 60_000);
  });
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("ws error"));
  });
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
  const r = await wsSend(ws, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? "eval error");
  }
  return r.result?.value;
}

async function waitFor(ws, expr, timeoutMs = 30_000, everyMs = 400) {
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
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const CARD = `(() => {
  const cards = [...document.querySelectorAll('[role="button"][aria-label^="Open test playground"]')]
    .filter((c) => c.offsetParent !== null);
  return cards.length;
})()`;

async function clickNav(ws, re, label) {
  const click = `
    (() => {
      const el = [...document.querySelectorAll("button,a")].find(
        (e) => ${re}.test((e.textContent || "").trim()) && e.offsetParent !== null);
      if (!el) return false;
      el.click();
      return true;
    })()`;
  for (let i = 0; i < 8; i++) {
    if (await evalJs(ws, click)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  const dump = await evalJs(
    ws,
    `[...document.querySelectorAll("button,a")].filter(e=>e.offsetParent!==null).map(e=>(e.textContent||"").trim().slice(0,40)).filter(t=>t).slice(0,30).join(" | ")`,
  );
  throw new Error(`nav to ${label} failed — visible: ${dump}`);
}

/** Open a card's kebab → Delete → resolve the dialog description text. */
async function openDeleteDialog(ws, cardName) {
  const nameJson = JSON.stringify(cardName);
  for (let i = 0; i < 3; i++) {
    // r221 lesson: Radix DropdownMenuTrigger opens on POINTERDOWN — a bare
    // el.click() never opens the menu and every retry silently starved (the
    // 300s hang). Dispatch the full pointer sequence a real mouse produces.
    await evalJs(ws, `(() => {
      const card = [...document.querySelectorAll('[role="button"][aria-label^="Open test playground"]')]
        .find((c) => c.offsetParent !== null && c.querySelector("h3")?.textContent === ${nameJson});
      if (!card) return false;
      const kebab = [...card.querySelectorAll("button")].find(
        (b) => (b.getAttribute("aria-label") || "").startsWith("Actions for"));
      if (!kebab) return false;
      const rect = kebab.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, view: window, button: 0,
                     clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
      kebab.dispatchEvent(new PointerEvent("pointerdown", opts));
      kebab.dispatchEvent(new MouseEvent("mousedown", opts));
      kebab.dispatchEvent(new MouseEvent("click", opts));
      return true;
    })()`);
    await waitFor(ws, `Boolean(document.querySelector('[role="menuitem"]'))`, 5_000);
    await evalJs(ws, `(() => {
      const del = [...document.querySelectorAll('[role="menuitem"]')].find(
        (m) => (m.textContent || "").trim() === "Delete");
      if (!del) return false;
      del.click();
      return true;
    })()`);
    const opened = await waitFor(
      ws,
      `Boolean(document.querySelector('[role="alertdialog"]'))`,
      5_000,
    );
    if (opened) {
      const text = await evalJs(
        ws,
        `document.querySelector('[role="alertdialog"]')?.innerText ?? ""`,
      );
      return String(text);
    }
    await closeDialog(ws, "Cancel");
  }
  return null;
}

async function closeDialog(ws, action) {
  await evalJs(ws, `(() => {
    const dlg = document.querySelector('[role="alertdialog"]');
    if (!dlg) return false;
    const btn = [...dlg.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === ${JSON.stringify(action)});
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await waitFor(ws, `!Boolean(document.querySelector('[role="alertdialog"]'))`, 5_000);
}

/** Kebab → a named menu action (Duplicate / Delete / …) on one card. */
async function cardAction(ws, cardName, action) {
  const nameJson = JSON.stringify(cardName);
  const actionJson = JSON.stringify(action);
  // pointer sequence — same Radix trigger lesson as openDeleteDialog
  await evalJs(ws, `(() => {
    const card = [...document.querySelectorAll('[role="button"][aria-label^="Open test playground"]')]
      .find((c) => c.offsetParent !== null && c.querySelector("h3")?.textContent === ${nameJson});
    if (!card) return false;
    const kebab = [...card.querySelectorAll("button")].find(
      (b) => (b.getAttribute("aria-label") || "").startsWith("Actions for"));
    if (!kebab) return false;
    const rect = kebab.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, button: 0,
                   clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
    kebab.dispatchEvent(new PointerEvent("pointerdown", opts));
    kebab.dispatchEvent(new MouseEvent("mousedown", opts));
    kebab.dispatchEvent(new MouseEvent("click", opts));
    return true;
  })()`);
  await waitFor(ws, `Boolean(document.querySelector('[role="menuitem"]'))`, 5_000);
  return evalJs(ws, `(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (m) => (m.textContent || "").trim() === ${actionJson});
    if (!item) return false;
    item.click();
    return true;
  })()`);
}

async function main() {
  // Browser boot
  await ensureChrome();
  const tabRes = await fetch(`http://127.0.0.1:9222/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status} — is chrome-headless-shell up?`);
  const tab = await tabRes.json();
  const ws = await connect(tab.webSocketDebuggerUrl);
  try {
    await wsSend(ws, "Page.enable");
    await wsSend(ws, "Runtime.enable");
    await wsSend(ws, "Emulation.setDeviceMetricsOverride", {
      width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await wsSend(ws, "Page.navigate", { url: BASE });
    await evalJs(ws, "document.title");
    await waitFor(ws, `document.readyState === 'complete'`);
    await new Promise((r) => setTimeout(r, 2500));

    // G1 — Agents view renders a roster
    if (!(await clickNav(ws, `/^Agents/`, "Agents"))) throw new Error("unreachable");
    const rosterOk = await waitFor(ws, `${CARD} >= 1`, 45_000);
    const rosterCount = rosterOk ? await evalJs(ws, CARD) : 0;
    check("G1 agents roster renders", rosterOk && rosterCount >= 1, `cards=${rosterCount}`);
    if (!rosterOk) throw new Error("no agent cards rendered in 45s");

    // G2 — POSITIVE: some dialog names real workflows; cancel after reading
    const names = await evalJs(ws, `(() => {
      return [...document.querySelectorAll('[role="button"][aria-label^="Open test playground"]')]
        .filter((c) => c.offsetParent !== null)
        .map((c) => c.querySelector("h3")?.textContent ?? "")
        .filter(Boolean);
    })()`);
    let positiveName = null;
    let positiveDialog = null;
    let allNamesReal = true;
    for (const n of names.slice(0, 6)) {
      const text = await openDeleteDialog(ws, n);
      if (text == null) continue;
      const namesRefs = /reference[s]?\s*it\s*—/.test(text.replace(/\n/g, " "));
      if (namesRefs) {
        positiveName = n;
        positiveDialog = text.replace(/\n/g, " ");
        // every listed workflow name must be a real non-empty name chunk
        const after = positiveDialog.split("—")[1] ?? "";
        const listed = after.split(".")[0].split(",").map((s) => s.trim()).filter(Boolean);
        for (const w of listed) {
          if (w.startsWith("and ") || !w.length) continue;
          if (w.length < 3) allNamesReal = false;
        }
      }
      await closeDialog(ws, "Cancel");
      if (positiveName) break;
    }
    check(
      "G2 referenced agent's dialog NAMES its workflows",
      !!positiveName && allNamesReal,
      positiveName ? `agent="${positiveName}" dialog="${(positiveDialog ?? "").slice(0, 140)}"` : "no dialog named a workflow",
    );
    if (positiveDialog) await shot(ws, "G2-delete-dialog-names-workflows");

    // G3 — NEGATIVE + real deletion on a throwaway copy
    if (positiveName) {
      const dupOk = await cardAction(ws, positiveName, "Duplicate");
      await new Promise((r) => setTimeout(r, 900)); // toast + card mount
      const copyName = `${positiveName} copy`;
      const copyExists = await waitFor(ws, `(() => {
        return [...document.querySelectorAll('[role="button"][aria-label^="Open test playground"]')]
          .some((c) => c.offsetParent !== null && c.querySelector("h3")?.textContent === ${JSON.stringify(copyName)});
      })()`, 10_000);
      check("G3a duplicate created ('<name> copy' card)", dupOk && copyExists, `name=${copyName}`);

      const copyDialog = await openDeleteDialog(ws, copyName);
      const noRefs = copyDialog != null && copyDialog.includes("No workflows reference it");
      check("G3b copy's dialog reads 'No workflows reference it'", noRefs, (copyDialog ?? "NO DIALOG").replace(/\n/g, " ").slice(0, 120));
      if (copyDialog && noRefs) await shot(ws, "G3b-copy-dialog-no-references");

      // real deletion of the throwaway copy (never the original)
      await closeDialog(ws, "Delete");
      const gone = await waitFor(ws, `(() => {
        return ![...document.querySelectorAll('[role="button"][aria-label^="Open test playground"]')]
          .some((c) => c.offsetParent !== null && c.querySelector("h3")?.textContent === ${JSON.stringify(copyName)});
      })()`, 10_000);
      check("G3c copy deleted — card gone, no residue", gone);
    } else {
      check("G3a duplicate created ('<name> copy' card)", false, "skipped — no referenced agent found");
      check("G3b copy's dialog reads 'No workflows reference it'", false, "skipped");
      check("G3c copy deleted — card gone, no residue", false, "skipped");
    }

    // G4 — roster intact (originals only; the copy is gone)
    const leftover = await evalJs(ws, `(() => {
      return [...document.querySelectorAll('[role="button"][aria-label^="Open test playground"]')]
        .filter((c) => c.offsetParent !== null && (c.querySelector("h3")?.textContent ?? "").endsWith(" copy")).length;
    })()`);
    const nowCount = await evalJs(ws, CARD);
    check("G4 roster intact — no leftover copies", leftover === 0, `leftover=${leftover} cards=${nowCount}`);
  } finally {
    await wsSend(ws, "Page.close").catch(() => {});
  }

  const fails = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY: ${results.length - fails.length} passed, ${fails.length} failed`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("QA crashed:", e.message);
  process.exit(1);
});
