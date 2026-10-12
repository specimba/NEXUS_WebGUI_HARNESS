// r461 witness probe — FIXED r465.
// The original version queried `db.workflow`, which does NOT exist: workflows live
// in localStorage (Local Automation Vault). The database holds only RunReport rows
// (server-side run history written by the runner's auto-archive hook, r455).
// This probe answers: what settled runs exist server-side right now?
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const total = await db.runReport.count();
  const reports = await db.runReport.findMany({
    select: {
      id: true,
      workflowId: true,
      workflowName: true,
      task: true,
      status: true,
      source: true,
      startedAt: true,
      durationMs: true,
    },
    take: 5,
    orderBy: { startedAt: "desc" },
  });
  console.log("RunReport total:", total);
  console.log("Recent 5 (newest first):");
  for (const r of reports) {
    const dur = r.durationMs != null ? `${Math.round(r.durationMs / 1000)}s` : "?";
    console.log(
      `  ${r.startedAt.toISOString()}  ${r.status ?? "?"}/${r.source ?? "?"}  ${dur}  ${r.workflowName || "(unnamed)"} — ${(r.task || "").slice(0, 60)}`
    );
  }
} finally {
  await db.$disconnect();
}
