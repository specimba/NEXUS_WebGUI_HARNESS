// r430 QA fixture — seed/clean ONE AutomationRun row so the kanban server
// lane (and thus ServerRunDrawer) can be exercised live. Fixed id, explicit
// cleanup, honest before/after counts. Not part of the product.
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const ID = "qa-seed-run-r430";
const mode = process.argv[2];

if (mode === "seed") {
  const wf = await p.automationWorkflow.findFirst();
  if (!wf) {
    console.log("NO-WORKFLOW-ROW");
    process.exit(1);
  }
  // idempotent: drop any leftover from a crashed earlier attempt
  await p.automationRun.deleteMany({ where: { id: ID } });
  const run = await p.automationRun.create({
    data: {
      id: ID,
      workflowId: wf.id,
      workflowName: wf.name,
      trigger: "manual",
      status: "done",
      currentStep: 2,
      stepsTotal: 2,
      stepsJson: JSON.stringify([
        { label: "QA seed step one", output: "Seeded output for focus-trap QA (r430).", ms: 1234, ok: true },
        { label: "QA seed step two", output: "Second step, exercises the ok=false path.", ms: 800, ok: false },
      ]),
      finalReport: "QA-seeded final report — safe to delete.",
      startedAt: new Date(Date.now() - 5 * 60_000),
      finishedAt: new Date(),
    },
  });
  console.log("SEEDED", run.id, "wf:", wf.id, JSON.stringify(wf.name));
} else if (mode === "cleanup") {
  const before = await p.automationRun.count();
  await p.automationRun.deleteMany({ where: { id: ID } });
  const after = await p.automationRun.count();
  console.log("CLEANUP before:", before, "after:", after, after === before - 1 ? "REMOVED-OK" : "UNEXPECTED");
} else {
  console.log("usage: bun scripts/qa-server-run-seed.ts seed|cleanup");
  process.exit(1);
}
await p.$disconnect();
