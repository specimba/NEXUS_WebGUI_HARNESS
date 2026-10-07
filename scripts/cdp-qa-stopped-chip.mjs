#!/usr/bin/env node
// ─── r313 QA: the USER-stopped schedule chip is honest + one-click resumes ───
// Schedule cards had chips for every paused state EXCEPT the one the user
// creates on purpose: disabled with no autoResumeAt and failStreak < 2
// rendered NOTHING — "stopped on purpose" was indistinguishable from a
// rendering gap, and resuming meant Edit → toggle. r313 adds the slate
// "stopped · click to resume" chip. This suite seeds a stopped schedule
// (cloning a real persisted workflow for render-shape fidelity) and witnesses:
//   S0  app boots
//   S1  the Workflows board renders the seeded card
//   S2  THE r313 WITNESS: the stopped chip renders, and the chip count equals
//       the store-derived stopped-schedule count (no over/under-render; the
//       three pause-family chips stay mutually exclusive)
//   S3  ONE CLICK resumes: store truth flips (enabled, failStreak reset 0,
//       autoResumeAt cleared) + "Schedule resumed" toast
//   S4  the chip count tracks the store (our wf left the stopped set)
//   S5  cleanup: original praison-workflows snapshot restored byte-for-byte
// House shape: self-created tab via PUT /json/new, tab closed on success AND
// error, JS .click() reaches visible buttons, waitFor tolerates transient
// evals, debouncedStorage (450ms) gets headroom before every LS read.
// Usage: node scripts/cdp-qa-stopped-chip.mjs [baseUrl]
import { ensureChrome } from "./cdp-ensure-chrome.mjs";

const BASE = process.argv[2] ?? "http://localhost:3000";
const CDP = "http://127.0.0.1:9222";
const WF_ID = "wf_cdp_stopped_r313";
const WF_NAME = "CDP stopped-chip r313";
const LS_KEY = "praison-workflows";

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

/** Store-derived count of USER-stopped schedules (the r313 chip condition). */
const STOPPED_COUNT_FN = `(() => {
  try {
    const bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_KEY)}) || "null");
    const list = bundle?.state?.workflows ?? [];
    return list.filter((w) => w?.schedule && !w.schedule.enabled
      && w.schedule.autoResumeAt == null && (w.schedule.failStreak ?? 0) < 2).length;
  } catch { return -1; }
})()`;

async function seedStoppedWorkflow(ws) {
  originalSnapshot = await evalJs(ws, `localStorage.getItem(${JSON.stringify(LS_KEY)})`);
  return evalJs(
    ws,
    `(() => {
      let bundle;
      try { bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_KEY)}) || "null"); } catch { bundle = null; }
      const state = bundle?.state ?? {};
      const list = Array.isArray(state.workflows) ? state.workflows : [];
      const base = list.find((w) => w && w.schedule) ?? null;
      const now = Date.now();
      const wf = base
        ? { ...base, id: ${JSON.stringify(WF_ID)}, name: ${JSON.stringify(WF_NAME)}, runs: [],
            schedule: { ...base.schedule, enabled: false, autoResumeAt: undefined,
              autoResumeTrips: undefined, failStreak: 0, nextRunAt: undefined,
              lastRunAt: undefined, intervalMs: 3_600_000,
              task: base.schedule.task ?? "probe" } }
        : { id: ${JSON.stringify(WF_ID)}, name: ${JSON.stringify(WF_NAME)}, description: "probe",
            steps: [], runs: [], createdAt: now, updatedAt: now, depth: "standard",
            schedule: { enabled: false, intervalMs: 3_600_000, task: "probe", failStreak: 0 } };
      const next = list.filter((w) => w && w.id !== wf.id);
      next.unshift(wf);
      localStorage.setItem(${JSON.stringify(LS_KEY)}, JSON.stringify({
        state: { ...state, workflows: next }, version: bundle?.version ?? 0,
      }));
      return Boolean(base);
    })()`
  );
}

async function main() {
  const mode = await ensureChrome();
  console.log(`ensureChrome: ${mode}`);

  // Grace: the chip edit just landed — give the dev server's HMR a beat.
  await new Promise((r) => setTimeout(r, 2000));

  const tabRes = await fetch(`${CDP}/json/new`, { method: "PUT" });
  if (!tabRes.ok) throw new Error(`/json/new failed: ${tabRes.status}`);
  const page = await tabRes.json();
  tabId = page.id;
  const ws = await connect(page.webSocketDebuggerUrl);

  // S0 — app boots
  await evalJs(ws, `location.href = ${JSON.stringify(BASE + "/")}`).catch(() => {});
  check(
    "S0 app renders",
    await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`)
  );

  // Let boot-triggered debounced store flushes land BEFORE the seed write.
  await new Promise((r) => setTimeout(r, 900));
  const clonedReal = await seedStoppedWorkflow(ws);
  console.log(`  DIAG: seeded by cloning a real persisted workflow = ${clonedReal}`);

  // Navigate to the board: hash first, then the sidebar click as fallback
  // (both are house patterns; hash wins when the shell honors it).
  await evalJs(ws, `location.hash = "#/workflows"; location.reload(); true`).catch(() => {});
  await waitFor(ws, `document.readyState === "complete" && document.body && document.body.innerText.length > 0`);
  const onBoard = await waitFor(
    ws,
    `document.body.innerText.includes(${JSON.stringify(WF_NAME)})`,
    20_000
  );
  if (!onBoard) {
    // Fallback: click the sidebar Workflows nav (deep-pause suite pattern).
    await evalJs(
      ws,
      `(() => {
        const btn = [...document.querySelectorAll("button, a")].find((b) =>
          /workflows/i.test(b.textContent || ""));
        if (btn) { btn.click(); return true; }
        return false;
      })()`
    ).catch(() => false);
  }
  check(
    "S1 Workflows board renders the seeded stopped schedule",
    await waitFor(ws, `document.body.innerText.includes(${JSON.stringify(WF_NAME)})`, 15_000)
  );

  // S2 — THE WITNESS: chip renders, and chip count === store-derived count.
  const chipAppeared = await waitFor(
    ws,
    `document.querySelector('[data-testid="stopped-schedule-chip"]') !== null`,
    12_000
  );
  const chipCount = (await evalJs(
    ws,
    `document.querySelectorAll('[data-testid="stopped-schedule-chip"]').length`
  ).catch(() => -1)) ?? -1;
  const storeCount = (await evalJs(ws, STOPPED_COUNT_FN).catch(() => -2)) ?? -2;
  check(
    "S2 stopped chip renders; chip count equals store-derived stopped count",
    chipAppeared && chipCount === storeCount && storeCount >= 1,
    `chips=${chipCount} store=${storeCount}`
  );

  // S3 — ONE CLICK resumes: store truth + honest toast.
  await evalJs(
    ws,
    `(() => {
      const chip = document.querySelector('[data-testid="stopped-schedule-chip"]');
      if (!chip) return false;
      chip.click();
      return true;
    })()`
  ).catch(() => false);
  await new Promise((r) => setTimeout(r, 900));
  const truth = await evalJs(
    ws,
    `(() => {
      try {
        const bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_KEY)}) || "null");
        const wf = (bundle?.state?.workflows ?? []).find((w) => w.id === ${JSON.stringify(WF_ID)});
        if (!wf?.schedule) return { found: false };
        return {
          found: true,
          enabled: wf.schedule.enabled === true,
          streak0: (wf.schedule.failStreak ?? 0) === 0,
          noAutoResume: wf.schedule.autoResumeAt == null,
        };
      } catch { return { found: false }; }
    })()`
  );
  const toastOk = await waitFor(
    ws,
    `[...document.querySelectorAll("[data-sonner-toast]")].some((t) => /schedule resumed/i.test(t.textContent || ""))`,
    8_000
  );
  check(
    "S3 one click resumes — store re-enabled, counters reset, toast shown",
    truth?.found === true && truth.enabled && truth.streak0 && truth.noAutoResume && toastOk,
    JSON.stringify({ ...truth, toastOk })
  );

  // S4 — the chip count tracks the store (our wf left the stopped set).
  await new Promise((r) => setTimeout(r, 400));
  const chipCountAfter = (await evalJs(
    ws,
    `document.querySelectorAll('[data-testid="stopped-schedule-chip"]').length`
  ).catch(() => -1)) ?? -1;
  const storeCountAfter = (await evalJs(ws, STOPPED_COUNT_FN).catch(() => -2)) ?? -2;
  check(
    "S4 chip count tracks the store after resume",
    chipCountAfter === storeCountAfter && storeCountAfter === storeCount - 1,
    `chips=${chipCountAfter} store=${storeCountAfter} (was ${storeCount})`
  );

  await finish(ws);
}

async function finish(ws) {
  // S5 — cleanup: restore the ORIGINAL snapshot exactly and verify the test
  // workflow is gone from the persisted store.
  let restored = false;
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
  const clean = await evalJs(
    ws,
    `(() => {
      try {
        const bundle = JSON.parse(localStorage.getItem(${JSON.stringify(LS_KEY)}) || "null");
        return !((bundle?.state?.workflows ?? []).some((w) => w.id === ${JSON.stringify(WF_ID)}));
      } catch { return false; }
    })()`
  );
  restored = clean === true;
  check("S5 original workflows snapshot restored (test wf gone)", restored);

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
