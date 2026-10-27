// r622: DB corruption repair after the r621 sandbox rollback.
// Situation: db/custom.db (main file, Sep 14 vintage from the snapshot) is
// paired with a newer 1.5MB WAL (Oct 26) — mixed generations made SQLite
// report "database disk image is malformed" (SQLITE_CORRUPT, ext code 11)
// on AutomationState reads (automation-bridge sync 500s, console warnings).
//
// Ladder (stop at the first level that yields integrity_check == ok):
//   L1 — open + PRAGMA wal_checkpoint(TRUNCATE) + integrity_check
//        (if the WAL is self-consistent, replaying it rebuilds a current image)
//   L2 — VACUUM INTO a fresh file from the live connection, integrity_check it
//   L3 — report honestly: which tables read, which fail (evidence for handoff)
// Never destructive: every original file is backed up before this runs.
import { Database } from "bun:sqlite";

const DB = "db/custom.db";
const RECOVERED = "db/custom.db.recovered-r622";

function integrity(db: Database, label: string): string {
  const rows = db.query("PRAGMA integrity_check;").all() as Array<{ integrity_check: string }>;
  const msg = rows.map((r) => r.integrity_check).join(" | ");
  console.log(`[integrity:${label}] ${msg.slice(0, 200)}`);
  return msg;
}

function counts(db: Database, label: string): void {
  try {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    const out: string[] = [];
    let bad = 0;
    for (const t of tables) {
      try {
        const n = (db.query(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number }).n;
        out.push(`${t.name}=${n}`);
      } catch (e) {
        bad += 1;
        out.push(`${t.name}=UNREADABLE(${String(e).slice(0, 40)})`);
      }
    }
    console.log(`[counts:${label}] tables=${tables.length} unreadable=${bad}\n  ${out.join("\n  ")}`);
  } catch (e) {
    console.log(`[counts:${label}] FAILED: ${String(e).slice(0, 120)}`);
  }
}

// ── L1: live checkpoint + integrity ──────────────────────────────────────────
let db: Database;
try {
  db = new Database(DB); // plain open — bun:sqlite option objects vary by version
} catch (e) {
  console.log(`[open] FAILED: ${String(e).slice(0, 200)}`);
  process.exit(1);
}
console.log("[open] ok (journal_mode=", db.query("PRAGMA journal_mode;").get(), ")");
try {
  const ck = db.query("PRAGMA wal_checkpoint(TRUNCATE);").all();
  console.log("[checkpoint:TRUNCATE]", JSON.stringify(ck));
} catch (e) {
  console.log(`[checkpoint] FAILED: ${String(e).slice(0, 160)}`);
}
const v1 = integrity(db, "after-checkpoint");
if (v1 === "ok") {
  counts(db, "final");
  console.log("[VERDICT] L1 succeeded — live DB repaired by WAL checkpoint; no swap needed.");
  db.close();
  process.exit(0);
}

// ── L2: VACUUM INTO a fresh image ────────────────────────────────────────────
counts(db, "live-before-recovery");
try {
  db.query(`VACUUM INTO '${RECOVERED}';`).run();
  console.log("[vacuum-into] ok");
  const db2 = new Database(RECOVERED);
  const v2 = integrity(db2, "recovered");
  if (v2 === "ok") {
    counts(db2, "recovered");
    console.log(`[VERDICT] L2 succeeded — clean image at ${RECOVERED}; swap it in (server restart required).`);
    db2.close();
    db.close();
    process.exit(2); // 2 = recovered file ready, swap needed
  }
  db2.close();
} catch (e) {
  console.log(`[vacuum-into] FAILED: ${String(e).slice(0, 200)}`);
}

// ── L3: honest failure report ────────────────────────────────────────────────
console.log("[VERDICT] L3 — both levels failed; corrupt-backup preserved, escalate to Owner.");
db.close();
process.exit(3);
