// r715 VERDICT-FLOW WATCH v2 — self-mapping (v1's note-LIKE patterns scored 0/0/0 vs baseline 31/30/8:
// the EvalEvent vocabulary is not plain 'Decision gate PASS%'-in-note; r712 doctrine: the watch must
// have a REAL mapping, so this version discovers the gate-note column and the prefix classes itself)
import { Database } from "bun:sqlite";
const db = new Database("/home/z/my-project/db/custom.db", { readonly: true });
console.log("quick_check:", JSON.stringify(db.query("PRAGMA quick_check").all()));
const cols = db.query(`PRAGMA table_info(EvalEvent)`).all().map(c => c.name);
console.log("EvalEvent cols:", cols.join(","));
const total = db.query(`SELECT count(*) c FROM EvalEvent`).get().c;
console.log("EvalEvent rows:", total);
// 1) discover which column carries the gate vocabulary
let gateCol = null;
for (const c of cols) {
  try {
    const hit = db.query(`SELECT count(*) n FROM EvalEvent WHERE "${c}" LIKE '%gate%' OR "${c}" LIKE '%judge%'`).get().n;
    if (hit > 0) { gateCol = c; console.log(`gate-bearing col: ${c} (${hit} rows)`); break; }
  } catch {}
}
// 2) prefix histogram of that column (the real vocabulary, printed for the worklog)
if (gateCol) {
  const hist = db.query(`SELECT substr("${gateCol}",1,28) p, count(*) c FROM EvalEvent GROUP BY 1 ORDER BY c DESC LIMIT 14`).all();
  console.log("prefix histogram:", JSON.stringify(hist));
}
// 3) JS-side class mapping over ALL rows (no LIKE guessing — filter on the full row text)
const rows = db.query(`SELECT rowid AS rid, * FROM EvalEvent ORDER BY rowid DESC`).all();
const rowText = (r) => cols.map(c => String(r[c] ?? "")).join(" | ");
let pass = 0, fail = 0, unc = 0, nj = 0;
const uncRows = [], njRows = [];
for (const r of rows) {
  const t = rowText(r);
  if (/no judge answered/i.test(t)) { nj += 1; if (njRows.length < 5) njRows.push(r); }
  else if (/Decision gate uncertain/i.test(t)) { unc += 1; if (uncRows.length < 12) uncRows.push(r); }
  // r718: BOTH verdict-note families count — the "System-One gate FAIL 4% —
  // rework" rows fell through the Decision-gate-only patterns into NO class
  // and printed a false FAIL 0 (two such rows predate r717's read; the r712
  // real-mapping doctrine applied to the watch itself, again).
  else if (/\b(?:Decision|System-One) gate PASS\b/i.test(t)) pass += 1;
  else if (/\b(?:Decision|System-One) gate FAIL\b/i.test(t)) fail += 1;
}
console.log(`WATCH: verdict=${pass + fail} (PASS ${pass} / FAIL ${fail}) · uncertain=${unc} · nojudge=${nj}   [durable baseline · r717 printed FAIL 0 — a classifier false zero, both verdict-note families counted since r718]`);
console.log("--- last UNCERTAIN rows (what do judges answer below confidence ON?) ---");
for (const r of uncRows) console.log(JSON.stringify(r).slice(0, 340));
console.log("--- last NO-JUDGE rows ---");
for (const r of njRows) console.log(JSON.stringify(r).slice(0, 340));
db.close();
