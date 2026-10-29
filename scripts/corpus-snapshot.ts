/**
 * r725: the corpus's durable backup road — snapshot the RSI eval ledger
 * (EvalEvent) to a git-tracked JSON so the training corpus survives sandbox
 * recycles (the 13:37 recycle wiped every runtime table; git survived).
 *
 *  - writes db/corpus-snapshots/latest.json (stable restore input) plus a
 *    timestamped copy, pruned to the newest 8.
 *  - full fidelity: id / runId / workflow / stepId / kind / verdict /
 *    confidence / note / createdAt — restore is idempotent by id.
 *  - NEVER snapshots AutomationVault: vault lanes hold key material —
 *    the standing rule keeps keys out of logs AND out of git.
 */
import { Database } from "bun:sqlite";
import { readdirSync, unlinkSync, writeFileSync, mkdirSync } from "fs";

mkdirSync("db/corpus-snapshots", { recursive: true });
const db = new Database("db/custom.db", { readonly: true });
const rows = db
  .query(
    "SELECT id,runId,workflow,stepId,kind,verdict,confidence,note,createdAt FROM EvalEvent ORDER BY createdAt"
  )
  .all();
db.close();
const doc = {
  takenAt: new Date().toISOString(),
  count: rows.length,
  rows,
};
writeFileSync("db/corpus-snapshots/latest.json", JSON.stringify(doc));
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
writeFileSync(`db/corpus-snapshots/corpus-${stamp}.json`, JSON.stringify(doc));
const olds = readdirSync("db/corpus-snapshots")
  .filter((f) => f.startsWith("corpus-") && f.endsWith(".json"))
  .sort();
for (const f of olds.slice(0, Math.max(0, olds.length - 8))) {
  unlinkSync(`db/corpus-snapshots/${f}`);
}
console.log(`snapshot: ${rows.length} rows -> db/corpus-snapshots/latest.json (+${olds.length} kept)`);
