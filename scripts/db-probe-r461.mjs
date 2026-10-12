// r461 witness seed/inspect: find a real workflow id + existing RunReport rows.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const wfs = await db.workflow.findMany({
    select: { id: true, name: true },
    take: 3,
    orderBy: { updatedAt: "desc" },
  });
  console.log("WF:", JSON.stringify(wfs));
  const reports = await db.runReport.findMany({
    select: { id: true, workflowId: true, status: true, source: true },
    take: 5,
    orderBy: { startedAt: "desc" },
  });
  console.log("REPORTS:", JSON.stringify(reports));
} finally {
  await db.$disconnect();
}
