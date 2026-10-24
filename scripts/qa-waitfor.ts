// ─── TASK-101 slice 3 (r521) — dial-free QA for the durable waitForEvent shape
// Drives the REAL server claim loop (15s cadence) over the real DB and asserts
// the full state machine:
//   1. a workflow whose only step carries waitFor parks its run as "waiting"
//      with a persisted sentinel (event + since + deadline in stepsJson);
//   2. emitting the event through the REAL /api/automation/events route makes
//      the claim loop resume the WAIT (not re-run steps) → run "done" with an
//      honest "[event … received after Xs — resuming]" trail;
//   3. a deadline already in the past fails the step honestly (timeout class).
// No provider dials: wait steps never dial. Driven via in-process tickOnce()
// (fresh module code) — the keyless vault (sandbox DB rollback) stands the
// SERVER loop's fresh-claim path down, and wait-only resumes are dial-free by
// design, so this process is the only actor touching these runs.
import { db } from "@/lib/db";
import { tickOnce } from "@/lib/server/automation-executor";

const WF_WAIT = "qa-waitfor-r521";
const WF_TIMEOUT = "qa-waitfor-timeout-r521";
const EVENT_NAME = "qa-gate-r521";
const BASE = "http://localhost:3000";

async function poll(label: string, until: () => Promise<string | null>, timeoutMs: number): Promise<string> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await until();
    if (v !== null) return v;
    // Drive the claim loop IN-PROCESS — each iteration is one real tick.
    try {
      await tickOnce();
    } catch (e) {
      console.log("  tick error (retried):", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`QA timeout waiting for: ${label}`);
}

async function cleanup() {
  for (const id of [WF_WAIT, WF_TIMEOUT]) {
    await db.automationRun.deleteMany({ where: { workflowId: id } }).catch(() => {});
    await db.automationWorkflow.deleteMany({ where: { id } }).catch(() => {});
  }
}

async function main() {
  console.log("== waitForEvent QA (dial-free, server-loop driven) ==");
  await cleanup();

  // Stale heartbeat → the claim lane is allowed to act (tab parked blank;
  // no client lane will refresh this while the QA runs).
  await db.automationState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", lastSeenAt: new Date(Date.now() - 10 * 60_000) },
    update: { lastSeenAt: new Date(Date.now() - 10 * 60_000) },
  });

  // Scenario 1+2: ONE waitFor step, no prompt → no dial possible.
  await db.automationWorkflow.create({
    data: {
      id: WF_WAIT,
      name: "QA waitForEvent (r521)",
      task: "",
      stepsJson: JSON.stringify([
        { label: "Wait for qa-gate", prompt: "", waitFor: { event: EVENT_NAME, timeoutMs: 120_000 } },
      ]),
      intervalMs: 60_000,
      enabled: true,
      nextRunAt: new Date(Date.now() - 5_000),
    },
  });

  const waitingRunId = await poll(
    "run parked waiting",
    async () => {
      // keep the heartbeat stale — nothing else refreshes it in this QA
      await db.automationState.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", lastSeenAt: new Date(Date.now() - 10 * 60_000) },
        update: { lastSeenAt: new Date(Date.now() - 10 * 60_000) },
      });
      return (await db.automationRun.findFirst({ where: { workflowId: WF_WAIT, status: "waiting" } }))?.id ?? null;
    },
    60_000,
  );
  const waitingRow = await db.automationRun.findUnique({ where: { id: waitingRunId } });
  const parsed = JSON.parse(waitingRow!.stepsJson) as {
    waiting?: { event: string; since: string; deadline: string };
  }[];
  const sentinel = parsed.find((e) => e.waiting)?.waiting;
  if (!sentinel || sentinel.event !== EVENT_NAME || !sentinel.since || !sentinel.deadline) {
    throw new Error(`sentinel malformed: ${waitingRow!.stepsJson.slice(0, 300)}`);
  }
  console.log("PASS 1  run parked waiting; sentinel persisted (event/since/deadline)");

  const emitRes = await fetch(`${BASE}/api/automation/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: EVENT_NAME, payload: "qa emission" }),
  });
  if (!emitRes.ok) throw new Error(`emit route failed: ${emitRes.status}`);
  const done = await poll(
    "run resumed to done",
    async () => {
      const r = await db.automationRun.findUnique({ where: { id: waitingRunId } });
      return r?.status === "done" ? (r.finalReport ?? "done") : null;
    },
    60_000,
  );
  if (!done.includes(`event "${EVENT_NAME}" received after`)) {
    throw new Error(`final report missing event trail: ${done.slice(0, 200)}`);
  }
  console.log("PASS 2  emit → resumed the WAIT → done (completed steps NOT re-run)");

  // Scenario 3: pre-craft a waiting row whose deadline is already past —
  // the very next tick must fail it honestly (timeout class, no dial).
  await db.automationWorkflow.create({
    data: {
      id: WF_TIMEOUT,
      name: "QA waitForEvent timeout (r521)",
      task: "",
      stepsJson: JSON.stringify([
        { label: "Wait for nothing", prompt: "", waitFor: { event: "qa-never-r521", timeoutMs: 30_000 } },
      ]),
      intervalMs: 60_000,
      enabled: true,
      nextRunAt: new Date(Date.now() - 5_000),
    },
  });
  const past = new Date(Date.now() - 5 * 60_000);
  await db.automationRun.create({
    data: {
      workflowId: WF_TIMEOUT,
      workflowName: "QA waitForEvent timeout (r521)",
      trigger: "schedule",
      status: "waiting",
      currentStep: 1,
      stepsTotal: 1,
      stepsJson: JSON.stringify([
        {
          label: "Wait for nothing",
          output: '[waiting for event "qa-never-r521"]',
          ms: 1000,
          ok: true,
          waiting: {
            event: "qa-never-r521",
            since: new Date(past.getTime() - 60_000).toISOString(),
            deadline: past.toISOString(),
          },
        },
      ]),
    },
  });
  const timeoutErr = await poll(
    "deadline-past run errored",
    async () =>
      (await db.automationRun.findFirst({ where: { workflowId: WF_TIMEOUT, status: "error" } }))?.error ?? null,
    60_000,
  );
  if (!timeoutErr.includes("timed out waiting for event")) {
    throw new Error(`unexpected timeout error: ${timeoutErr}`);
  }
  console.log("PASS 3  deadline-past wait fails honestly (timeout class)");

  console.log("== ALL waitForEvent QA PASSED ==");
}

main()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("QA FAILED:", e instanceof Error ? e.message : e);
    await cleanup();
    process.exit(1);
  });
