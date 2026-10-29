// r717 provenance probe: where did the r712–r714 26→31-verdict corpus live?
// The durable EvalEvent table has held 4 rows since r715's remap — this probe
// snapshots ALL table row counts + the db file's mtime/size + sibling db files,
// to distinguish "eval-table trim" from "whole-db reset" from "different store".
import { Database } from "bun:sqlite";
import { statSync, readdirSync } from "node:fs";
const db = new Database("/home/z/my-project/db/custom.db", { readonly: true });
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
for (const t of tables) {
  const c = db.query(`SELECT count(*) c FROM "${t}"`).get().c;
  console.log(`${t}: ${c}`);
}
db.close();
const st = statSync("/home/z/my-project/db/custom.db");
console.log("custom.db mtime:", st.mtime.toISOString(), "· size:", st.size, "bytes");
try {
  console.log("db/ dir:", readdirSync("/home/z/my-project/db").join(", "));
} catch (e) {
  console.log("db/ dir read failed:", e.message);
}
