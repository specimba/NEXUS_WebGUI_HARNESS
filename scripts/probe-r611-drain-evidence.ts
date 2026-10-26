/** r611 evidence probe (READONLY): is the backlog actually draining, and at
 * what rate? Prints queue census + last 12 cycle summaries + move ledger. */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient({
  datasources: { db: { url: "file:/home/z/my-project/db/custom.db?mode=ro&connection_limit=1" } },
});

async function main() {
  const [queued, researched, failedRows, byKindQueued] = await Promise.all([
    db.researchQueue.count({ where: { status: "queued" } }),
    db.researchQueue.count({ where: { status: "researched" } }),
    db.researchQueue.count({ where: { status: "failed" } }),
    db.researchQueue.groupBy({ by: ["kind"], where: { status: "queued" }, _count: { kind: true } }),
  ]);
  console.log("QUEUE:", JSON.stringify({ queued, researched, failed: failedRows, byKindQueued }));

  const cycles = await db.autonomyLog.findMany({
    where: { kind: "cycle" },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, summary: true, statsJson: true, createdAt: true },
  });
  console.log("--- last 12 cycles (newest first) ---");
  for (const c of cycles) {
    let executed = "?", suppressed = "?", ms = "?";
    try {
      const s = JSON.parse(c.statsJson) as { executed?: number; proposed?: number; ms?: number };
      executed = String(s.executed ?? "?");
      ms = String(s.ms ?? "?");
      suppressed = c.summary.includes("suppressed") ? "SUPPRESSED" : "proposed";
    } catch { /* keep ? */ }
    console.log(`${c.id} | exec=${executed} ${suppressed} ${ms}ms | ${new Date(c.createdAt).toISOString()}`);
  }

  const moves = await db.nextMove.groupBy({
    by: ["status", "kind"],
    _count: { kind: true },
  });
  console.log("MOVES LEDGER:", JSON.stringify(moves.map((m) => ({ kind: m.kind, status: m.status, n: m._count.kind }))));

  const oldestQueued = await db.researchQueue.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (oldestQueued) {
    const ageH = ((Date.now() - oldestQueued.createdAt.getTime()) / 3_600_000).toFixed(1);
    console.log(`OLDEST QUEUED AGE: ${ageH}h`);
  }
}

main()
  .then(() => process.exitCode = 0)
  .catch((e) => { console.error("probe failed:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
