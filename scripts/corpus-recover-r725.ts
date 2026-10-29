/**
 * r725 ONE-SHOT corpus recovery — restore the EvalEvent corpus from the
 * committed git witness (scripts/qa_r724_evals.json, the /api/evals runs[]
 * payload captured at 13:30, minutes before the sandbox recycle wiped the
 * runtime tables at the 13:37 slot boundary).
 *
 * What it does:
 *  - reads runs[] rows { runId, note, createdAt } from the r724 QA payload
 *    (43 rows / 9 runIds — the complete corpus, verified: total == rows),
 *    merged with the r722/r723 payloads (dedupe by runId+note+createdAt).
 *  - derives kind / verdict / confidence from the VERBATIM note heads
 *    (the same prefixes the gate-census classifier and the r715 watch key
 *    on — never invented, unparsable rows are skipped and counted).
 *  - workflow: recovered names for 7/9 runIds from the r722-r724 worklog
 *    witnesses; the rest carry an honest provenance marker.
 *  - id: deterministic "rec-" + sha1(runId|note|createdAt) — re-running is
 *    idempotent (INSERT OR IGNORE).
 *  - NEVER touches AutomationVault (key material — the standing rule).
 */
import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { readFileSync } from "fs";

type Row = { runId: string; note: string; createdAt: string | null };

function load(f: string): Row[] {
  const j = JSON.parse(readFileSync(f, "utf8"));
  return (j.runs ?? []).filter(
    (r: unknown): r is Row =>
      !!r && typeof (r as Row).runId === "string" && typeof (r as Row).note === "string"
  );
}

// Workflow names witnessed in the r722-r724 worklogs / watch prints.
const WORKFLOW_BY_RUN: Record<string, string> = {
  run_5125af84dac7: "Deep Research Dossier",
  run_3ce26a7dc9a8: "Continuous Research & Evaluation",
  run_5c98b87879cc: "Continuous Research & Evaluation",
  run_fd8fd1f21c89:
    "Recursive self-improvement engine: Z.ai agent harness upgrade cycle",
  run_14a887b12e58: 'test run "Continuous Research & Evaluation',
  run_1dd667e858a7: 'test run "Continuous Research & Evaluation',
  run_caf98e5426e6: 'test run "Continuous Research & Evaluation',
};
const PROVENANCE = "recovered from git witness (r725, r724 QA payload)";

function classify(note: string): {
  kind: string;
  verdict?: string;
  confidence?: number;
} | null {
  const v = /^(?:System-One gate|Decision gate) (PASS|FAIL) (\d+)%/.exec(note);
  if (v) return { kind: "gate-verdict", verdict: v[1], confidence: Number(v[2]) };
  if (/^System-One gate/.test(note)) return { kind: "gate-verdict" };
  const u = /^Decision gate uncertain (\d+)%/.exec(note);
  if (u) return { kind: "gate-uncertain", confidence: Number(u[1]) };
  if (/^Decision gate uncertain/.test(note)) return { kind: "gate-uncertain" };
  if (/^Decision gate engaged/.test(note)) return { kind: "gate-no-judge" };
  if (/^Decision gate/.test(note)) return { kind: "gate-judge-error" };
  return null; // unparsable — skipped and counted, never invented
}

const seen = new Set<string>();
const merged: Row[] = [];
for (const f of [
  "scripts/qa_r724_evals.json",
  "scripts/qa_r723_evals.json",
  "scripts/qa_r722_evals.json",
]) {
  for (const r of load(f)) {
    const k = `${r.runId}|${r.note}|${r.createdAt ?? ""}`;
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(r);
    }
  }
}

const db = new Database("db/custom.db");
db.exec("PRAGMA busy_timeout = 5000");
const live = db.query("SELECT COUNT(*) c FROM EvalEvent").get() as { c: number };
if (live.c > 0) {
  console.log(`live corpus holds ${live.c} rows — refusing to run a recovery into a non-empty ledger (one-shot is for the empty case)`);
  process.exit(1);
}

let parsed = 0;
let skipped = 0;
let inserted = 0;
const ins = db.query(
  "INSERT OR IGNORE INTO EvalEvent (id,runId,workflow,stepId,kind,verdict,confidence,note,createdAt) VALUES (?,?,?,?,?,?,?,?,?)"
);
db.exec("BEGIN");
for (const r of merged) {
  const c = classify(r.note);
  if (!c) {
    skipped += 1;
    continue;
  }
  parsed += 1;
  const id =
    "rec-" + createHash("sha1").update(`${r.runId}|${r.note}|${r.createdAt ?? ""}`).digest("hex").slice(0, 20);
  const at = r.createdAt ? new Date(r.createdAt).getTime() : Date.now();
  const res = ins.run(
    id,
    r.runId,
    WORKFLOW_BY_RUN[r.runId] ?? PROVENANCE,
    null,
    c.kind,
    c.verdict ?? null,
    c.confidence ?? null,
    r.note.slice(0, 500),
    at
  );
  inserted += res.changes;
}
db.exec("COMMIT");
const after = db.query("SELECT COUNT(*) c FROM EvalEvent").get() as { c: number };
console.log(
  JSON.stringify({ merged: merged.length, parsed, skipped, inserted, liveAfter: after.c })
);
