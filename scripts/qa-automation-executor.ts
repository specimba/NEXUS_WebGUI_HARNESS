// r204/r207 — Local Automation Vault executor QA: drives tickOnce() directly
// against the real database (no live server needed) and asserts every
// contract path. The network dial is MOCKED (deterministic 200 / 401) so the
// success and failure paths are proven without depending on gateway mood.
//
// STATE DISCIPLINE (learned the hard way this round): the first draft of
// this QA claimed REAL registry rows (the executor's oldest-first claim
// jumped the queue past the fixture), wrote mocked junk runs into user
// history, wiped the vault, and left a stale heartbeat. This version
// snapshots EVERYTHING it touches and restores it in `finally`:
//   • all AutomationWorkflow rows (enabled/nextRunAt/failStreak) restored
//   • non-fixture enabled rows deferred during the test so the claim
//     ordering can never leak past the fixture
//   • vault rows + heartbeat snapshotted and restored byte-for-byte
//   • only run rows CREATED during the test are deleted

import { db } from "../src/lib/db";
import {
  tickOnce,
  resolveServerDialFromSlots,
  executeWorkflow,
  type TickResult,
} from "../src/lib/server/automation-executor";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  ✓" : "  ✗"} ${m}`);
  if (c) pass++; else fail++;
};

// ── deterministic dial mock ─────────────────────────────────────────────────
// r535 repair: vyce is registry dialect "anthropic" since r528 — the server
// lane dials /v1/messages (x-api-key, content-block response), so the old
// /chat/completions-only mock went blind and EVERY dial hit the real
// gateway. The mock now intercepts both URLs and answers in the matching
// wire shape, keeping the same dialStatus contract (200 = success).
let dialStatus = 200;
const realFetch = globalThis.fetch.bind(globalThis);
(globalThis as { fetch: typeof fetch }).fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("/chat/completions") || u.includes("/v1/messages")) {
    const anthropic = u.includes("/v1/messages");
    if (dialStatus !== 200) {
      return new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
        status: dialStatus,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify(
        anthropic
          ? { content: [{ type: "text", text: "E-OK mocked completion" }] }
          : { choices: [{ message: { content: "E-OK mocked completion" } }] },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return realFetch(url as Parameters<typeof realFetch>[0], init);
}) as typeof fetch;

const WF_ID = "qa-executor-wf";
const PROVIDER = "vyce"; // real registry id (Vyce AI gateway)
const stale = () => new Date(Date.now() - 10 * 60_000);
const fresh = () => new Date();

// ── state snapshots (restored in finally) ───────────────────────────────────
type WfSnap = { id: string; enabled: boolean; nextRunAt: Date; failStreak: number };
let wfSnapshot: WfSnap[] = [];
let vaultSnapshot: { provider: string; key: string; label: string | null }[] = [];
let heartbeatSnapshot: Date | null = null;
let runIdSnapshot: Set<string> = new Set();

async function snapshotState() {
  wfSnapshot = (await db.automationWorkflow.findMany({})).map((r) => ({
    id: r.id,
    enabled: r.enabled,
    nextRunAt: r.nextRunAt,
    failStreak: r.failStreak,
  }));
  vaultSnapshot = (await db.automationVault.findMany({})).map((v) => ({
    provider: v.provider,
    key: v.key,
    label: v.label,
  }));
  const st = await db.automationState.findUnique({ where: { id: "singleton" } });
  heartbeatSnapshot = st?.lastSeenAt ?? null;
  runIdSnapshot = new Set((await db.automationRun.findMany({ select: { id: true } })).map((r) => r.id));
}

async function restoreState() {
  for (const s of wfSnapshot) {
    await db.automationWorkflow.update({
      where: { id: s.id },
      data: { enabled: s.enabled, nextRunAt: s.nextRunAt, failStreak: s.failStreak },
    });
  }
  await db.automationVault.deleteMany({});
  for (const v of vaultSnapshot) {
    await db.automationVault.create({ data: v });
  }
  if (heartbeatSnapshot) {
    await db.automationState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", lastSeenAt: heartbeatSnapshot },
      update: { lastSeenAt: heartbeatSnapshot },
    });
  }
  // delete only runs the test created (anything not in the pre-test snapshot)
  await db.automationRun.deleteMany({
    where: { id: { notIn: [...runIdSnapshot] } },
  });
}

async function resetFixture() {
  await db.automationWorkflow.deleteMany({ where: { id: WF_ID } });
  await db.automationVault.deleteMany({}); // provider is unique — clear before re-seeding (snapshot restores user rows in finally)
  await db.automationState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastSeenAt: stale() },
    update: { lastSeenAt: stale() },
  });
  await db.automationWorkflow.create({
    data: {
      id: WF_ID,
      name: "QA Executor Pipeline",
      task: "probe the server lane",
      stepsJson: JSON.stringify([
        { label: "Step one", prompt: "Reply with exactly E1" },
        { label: "Step two", prompt: "Reply with exactly E2" },
      ]),
      intervalMs: 3_600_000,
      enabled: true,
      nextRunAt: new Date(Date.now() - 500), // earliest due → the fixture wins claim ordering
      failStreak: 0,
    },
  });
  await db.automationVault.create({
    data: { provider: PROVIDER, key: "sk-qa-fake-key", label: "qa" },
  });
}

try {
  await snapshotState();
  // defer every other enabled row so oldest-first claims can only hit the fixture
  await db.automationWorkflow.updateMany({
    where: { enabled: true, NOT: { id: WF_ID } },
    data: { nextRunAt: new Date(Date.now() + 365 * 24 * 3_600_000) },
  });

  // 1. per-slot unit paths (pure, no dialing) — r211: probed through the ONE
  // canonical resolver (1-element scans) after the resolveServerDial fold.
  ok(
    resolveServerDialFromSlots(null).dial === null &&
      (resolveServerDialFromSlots(null) as { why: string }).why === "no-vault-key",
    "fromSlots(1-slot probe): no vault entry → no-vault-key",
  );
  ok(
    resolveServerDialFromSlots([{ provider: "builtin", key: "sk-x" }]).dial === null &&
      (resolveServerDialFromSlots([{ provider: "builtin", key: "sk-x" }]) as { why: string }).why ===
        "no-resolvable-provider",
    "fromSlots(1-slot probe): builtin slot is skipped honestly (never guessed)",
  );
  const resolvedOk = resolveServerDialFromSlots([{ provider: PROVIDER, key: " sk-qa-space-key " }]);
  ok(
    resolvedOk.dial !== null &&
      // r535 repair: vyce is registry dialect "anthropic" since r528 — the
      // resolved dial is anthropicDialectUrl(base) (/v1/messages), not the
      // OpenAI /chat/completions shape this assertion pre-registered.
      resolvedOk.dial.url.endsWith("/v1/messages") &&
      resolvedOk.dial.key === "sk-qa-space-key" &&
      resolvedOk.dial.model.length > 0,
    "fromSlots(1-slot probe): registry provider resolves baseUrl + model id + trimmed key",
  );

  // 1b. r207: resolveServerDialFromSlots — first RESOLVABLE slot wins.
  const fs0 = resolveServerDialFromSlots(null);
  ok(
    fs0.dial === null && (fs0 as { why: string }).why === "no-vault-key",
    "fromSlots: null list → no-vault-key (defensive)",
  );
  const fs1 = resolveServerDialFromSlots([]);
  ok(
    fs1.dial === null && (fs1 as { why: string }).why === "no-vault-key",
    "fromSlots: empty vault → no-vault-key",
  );
  const fs2 = resolveServerDialFromSlots([{ provider: "builtin", key: "sk-x" }]);
  ok(
    fs2.dial === null && (fs2 as { why: string }).why === "no-resolvable-provider",
    "fromSlots: builtin-only vault → no-resolvable-provider (unchanged honesty)",
  );
  const fs3 = resolveServerDialFromSlots([
    { provider: "builtin", key: "sk-legacy" },
    { provider: PROVIDER, key: "sk-new" },
  ]);
  ok(
    fs3.dial !== null && fs3.slot.provider === PROVIDER && fs3.dial.key === "sk-new",
    "fromSlots: builtin OLDEST + registry key newer → dials the newer slot (promotion, no delete needed)",
  );
  const fs4 = resolveServerDialFromSlots([
    { provider: PROVIDER, key: "sk-first" },
    { provider: "builtin", key: "sk-legacy" },
  ]);
  ok(
    fs4.dial !== null && fs4.slot.provider === PROVIDER && fs4.dial.key === "sk-first",
    "fromSlots: resolvable slot oldest → wins (stable order, not last-resolvable)",
  );
  const fs5 = resolveServerDialFromSlots([
    { provider: PROVIDER, key: "   " },
    { provider: PROVIDER, key: "sk-blank-first" },
  ]);
  ok(
    fs5.dial !== null && fs5.slot.key === "sk-blank-first",
    "fromSlots: blank-key slot skipped, scan continues (not a fatal no-vault-key)",
  );
  const fs6 = resolveServerDialFromSlots([{ provider: PROVIDER, key: "   " }]);
  ok(
    fs6.dial === null && (fs6 as { why: string }).why === "no-vault-key",
    "fromSlots: only blank-key slots → no-vault-key (honest reason aggregation)",
  );
  const fs7 = resolveServerDialFromSlots([
    { provider: "builtin", key: "sk-legacy" },
    { provider: "totally-unknown-provider", key: "sk-x" },
  ]);
  ok(
    fs7.dial === null && (fs7 as { why: string }).why === "no-resolvable-provider",
    "fromSlots: keys exist but none pairs with a registry provider → no-resolvable-provider",
  );

  // 1c. r207 integration: the OLD executor died here — builtin oldest in the
  // vault poisoned the whole lane even with a good registry key present.
  await resetFixture();
  await db.automationVault.create({
    data: {
      provider: "builtin",
      key: "sk-legacy-builtin",
      label: "legacy",
      createdAt: new Date(Date.now() - 60_000), // explicitly OLDER than the vyce slot
    },
  });
  dialStatus = 200;
  const promoted: TickResult = await tickOnce();
  ok(
    promoted.claimed === 1 && promoted.outcome?.status === "done",
    "tick integration: builtin slot oldest + registry key newer → run claims and completes (r207 promotion)",
  );

  // 2. fresh heartbeat → stand down
  await resetFixture();
  await db.automationState.update({ where: { id: "singleton" }, data: { lastSeenAt: fresh() } });
  const alive: TickResult = await tickOnce();
  ok(alive.claimed === 0 && alive.reason === "client-alive", "fresh heartbeat → stands down (BYOK lane driving)");

  // 3. stale heartbeat, no vault key → honest no-op
  await resetFixture();
  await db.automationVault.deleteMany({});
  const noKey: TickResult = await tickOnce();
  ok(noKey.claimed === 0 && noKey.reason === "no-vault-key", "no vault key → honest no-op (never implicit credentials)");

  // 4. DONE path: mocked 200 across both steps
  await resetFixture();
  dialStatus = 200;
  const done: TickResult = await tickOnce();
  ok(done.claimed === 1 && done.workflowIds[0] === WF_ID, "due workflow claimed (oldest-first) when heartbeat stale + vault resolvable");
  ok(done.outcome?.status === "done", "mocked-200 dial completes the run (done outcome)");
  const doneRun = await db.automationRun.findFirst({ where: { workflowId: WF_ID }, orderBy: { startedAt: "desc" } });
  ok(
    !!doneRun && doneRun.status === "done" && doneRun.currentStep === 2 && doneRun.stepsTotal === 2,
    "run row: done at step 2/2 (progress written per step)",
  );
  ok(
    !!doneRun && /Step one[\s\S]*E-OK/.test(doneRun.finalReport ?? "") && /Step two/.test(doneRun.finalReport ?? ""),
    "finalReport carries both step outputs",
  );
  const wfDone = await db.automationWorkflow.findUnique({ where: { id: WF_ID } });
  ok(
    !!wfDone && wfDone.failStreak === 0 && wfDone.nextRunAt.getTime() > Date.now() + 30 * 60_000,
    "success resets failStreak and advances nextRunAt by intervalMs",
  );

  // 5. ERROR path: mocked 401 on the first step
  await resetFixture();
  dialStatus = 401;
  const errored: TickResult = await tickOnce();
  ok(errored.claimed === 1 && errored.outcome?.status === "error", "mocked-401 dial fails honestly (error outcome)");
  const errRun = await db.automationRun.findFirst({ where: { workflowId: WF_ID }, orderBy: { startedAt: "desc" } });
  ok(
    !!errRun && errRun.status === "error" && /step 1\/2/.test(errRun.error ?? ""),
    "run row records the failing step (step 1/2) + error message",
  );
  ok(!!errRun && errRun.currentStep === 1, "progress written at the failing step (currentStep 1)");
  const wfErr = await db.automationWorkflow.findUnique({ where: { id: WF_ID } });
  ok(
    !!wfErr && wfErr.failStreak === 1 && wfErr.enabled && wfErr.nextRunAt.getTime() > Date.now() + 30 * 60_000,
    "failStreak incremented to 1, schedule still enabled, nextRunAt advanced (no hot-loop)",
  );

  // 6. breaker parity: streak 2 → one more failure parks the schedule
  await resetFixture();
  await db.automationWorkflow.update({ where: { id: WF_ID }, data: { failStreak: 2 } });
  const breaker: TickResult = await tickOnce();
  ok(breaker.claimed === 1 && breaker.outcome?.status === "error", "streak-2 workflow claims + fails again");
  const parked = await db.automationWorkflow.findUnique({ where: { id: WF_ID } });
  ok(
    !!parked && parked.failStreak === 3 && parked.enabled === false,
    "breaker: 3rd consecutive failure parks the schedule (enabled=false)",
  );

  // 7. corrupt stepsJson + empty task → no crash
  await resetFixture();
  await db.automationWorkflow.update({ where: { id: WF_ID }, data: { stepsJson: "{corrupt", task: "" } });
  const empty = await db.automationWorkflow.findUnique({ where: { id: WF_ID } });
  const dial = resolveServerDialFromSlots([{ provider: PROVIDER, key: "sk-qa-fake" }]).dial!;
  const guard = await executeWorkflow(
    { id: WF_ID, name: empty!.name, task: empty!.task, stepsJson: empty!.stepsJson, intervalMs: empty!.intervalMs },
    dial,
  );
  ok(guard.status === "error" || guard.status === "done", "corrupt stepsJson + empty task does not crash the executor");
} finally {
  dialStatus = 200;
  (globalThis as { fetch: typeof fetch }).fetch = realFetch;
  await restoreState();
  console.log("\nrestored: registry rows, vault, heartbeat, run table — pre-QA state");
}

console.log(`\n${pass}/${pass + fail} automation-executor assertions passed`);
console.log(`SUMMARY: ${pass}/${pass + fail} automation-executor assertions`);
process.exit(fail === 0 ? 0 : 1);
