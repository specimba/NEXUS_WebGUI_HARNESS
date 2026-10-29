/**
 * r725: the corpus restore road — INSERT OR IGNORE the newest snapshot
 * (db/corpus-snapshots/latest.json) back into EvalEvent, idempotent by id.
 * For the post-recycle case: git holds the snapshots, the sandbox holds an
 * empty ledger. Never touches AutomationVault (key material).
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";

const doc = JSON.parse(readFileSync("db/corpus-snapshots/latest.json", "utf8"));
const rows: Array<Record<string, unknown>> = doc.rows ?? [];
const db = new Database("db/custom.db");
db.exec("PRAGMA busy_timeout = 5000");
const ins = db.query(
  "INSERT OR IGNORE INTO EvalEvent (id,runId,workflow,stepId,kind,verdict,confidence,note,createdAt) VALUES (?,?,?,?,?,?,?,?,?)"
);
db.exec("BEGIN");
let n = 0;
for (const r of rows) {
  if (typeof r.id !== "string" || typeof r.runId !== "string" || typeof r.note !== "string") continue;
  const res = ins.run(
    r.id,
    r.runId,
    typeof r.workflow === "string" ? r.workflow : "unknown",
    typeof r.stepId === "string" ? r.stepId : null,
    typeof r.kind === "string" ? r.kind : "gate-judge-error",
    typeof r.verdict === "string" ? r.verdict : null,
    typeof r.confidence === "number" ? r.confidence : null,
    r.note.slice(0, 500),
    typeof r.createdAt === "number" ? r.createdAt : Date.now()
  );
  n += res.changes;
}
db.exec("COMMIT");
const after = db.query("SELECT COUNT(*) c FROM EvalEvent").get() as { c: number };
console.log(JSON.stringify({ snapshotCount: rows.length, restored: n, liveAfter: after.c }));
