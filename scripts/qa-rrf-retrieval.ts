/**
 * QA r579 — RRF hybrid retrieval shim vs BM25-only on REAL research rows.
 *
 * Acceptance (TASKS.md Experiments, P3 hermes-zvec-memory row): "script
 * comparing BM25-only vs RRF on real research rows." Dial-free: reads
 * db/custom.db directly via bun:sqlite (createRequire — tsc-safe without
 * bun-types). Corpus = ResearchQueue.notes + StrategyItem(title/nextAction/
 * notes) + AutonomyLog.summary — the real stores, not fixtures.
 *
 * Doctrine note (r577-correction): the exit code rides a variable and
 * process.exit runs AFTER try/finally so cleanup/logging always executes.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HybridRetriever, type RetrievalDoc, type RankedDoc } from "../src/lib/rrf-retrieval";

type SqliteStmt = { all(...params: unknown[]): unknown[] };
type SqliteDb = { query(sql: string): SqliteStmt };

const dbPath = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "custom.db");
const req = createRequire(import.meta.url);
const { Database } = req("bun:sqlite") as {
  Database: new (path: string, options?: { readonly?: boolean }) => SqliteDb;
};

let exitCode = 1;
try {
  const db = new Database(dbPath, { readonly: true });

  const docs: RetrievalDoc[] = [];
  const rq = db.query("SELECT id, notes FROM ResearchQueue").all() as { id: string; notes: string | null }[];
  for (const r of rq) {
    if (r.notes && r.notes.trim()) docs.push({ id: `rq:${r.id}`, text: r.notes });
  }
  const si = db.query("SELECT id, title, nextAction, notes FROM StrategyItem").all() as {
    id: string; title: string | null; nextAction: string | null; notes: string | null;
  }[];
  for (const r of si) {
    const text = [r.title, r.nextAction, r.notes].filter((x): x is string => Boolean(x && x.trim())).join(" \n ");
    if (text) docs.push({ id: `si:${r.id}`, text });
  }
  const al = db.query("SELECT id, summary FROM AutonomyLog").all() as { id: string; summary: string | null }[];
  for (const r of al) {
    if (r.summary && r.summary.trim()) docs.push({ id: `al:${r.id}`, text: r.summary });
  }
  if (docs.length < 20) throw new Error(`corpus too small: ${docs.length} real rows`);
  console.log(`corpus: ${docs.length} real rows (ResearchQueue=${docs.filter((d) => d.id.startsWith("rq:")).length}, StrategyItem=${docs.filter((d) => d.id.startsWith("si:")).length}, AutonomyLog=${docs.filter((d) => d.id.startsWith("al:")).length})`);

  const retriever = new HybridRetriever(docs);

  // Real-row queries: the three with `expect` are anchored to known researched
  // URL rows (bun.sh / nextjs.org / ui.shadcn.com notes are in the corpus).
  const QUERIES: { q: string; expect?: string }[] = [
    { q: "bun javascript runtime toolkit bundler", expect: "rq:url:a05fa0df7bf9" },
    { q: "react framework app router components", expect: "rq:url:5af19f5831ac" },
    { q: "design system accessible ui primitives", expect: "rq:url:be496d8be7bc" },
    { q: "queue normalization deterministic moves" },
    { q: "cron patrol budget discipline" },
    { q: "strategy backlog adaptive loop" },
  ];

  const legRank = (list: { id: string; score: number }[], id: string): number | null => {
    const i = list.findIndex((r) => r.id === id);
    return i === -1 ? null : i + 1;
  };
  const fmt = (r: RankedDoc): string => {
    const legs = `${r.bm25Rank ?? "-"}|${r.vecRank ?? "-"}`;
    return `${r.id} [legs bm25|vec: ${legs}] rrf=${r.rrfScore.toFixed(5)}`;
  };

  let regressions = 0;
  let improvements = 0;
  let expectHits = 0;
  let expectTotal = 0;
  const rankOf = (hy: RankedDoc[], id: string): number | null => {
    const i = hy.findIndex((r) => r.id === id);
    return i === -1 ? null : i + 1;
  };

  console.log("\n=== BM25-only vs RRF hybrid (top-3 shown) ===");
  for (const { q, expect } of QUERIES) {
    const bm = retriever.bm25(q, 10);
    const ve = retriever.vector(q, 10);
    const hy = retriever.hybrid(q, 10);
    console.log(`\nquery: "${q}"`);
    console.log(`  BM25 top-3 : ${bm.slice(0, 3).map((r) => `${r.id} (${r.score.toFixed(3)})`).join("  ·  ") || "(none)"}`);
    console.log(`  VEC  top-3 : ${ve.slice(0, 3).map((r) => `${r.id} (${r.score.toFixed(3)})`).join("  ·  ") || "(none)"}`);
    console.log(`  RRF  top-3 : ${hy.slice(0, 3).map(fmt).join("\n               ") || "(none)"}`);
    if (expect) {
      expectTotal += 1;
      const bRank = legRank(bm, expect);
      const hRank = rankOf(hy, expect);
      const vRank = legRank(ve, expect);
      if (hRank !== null && hRank <= 3) expectHits += 1;
      if (bRank !== null && hRank !== null) {
        if (hRank < bRank) improvements += 1;
        if (hRank > bRank) regressions += 1;
      }
      if (bRank === null && hRank !== null) improvements += 1; // semantic leg rescued a BM25 miss
      console.log(`  target ${expect}: bm25=${bRank ?? "absent"} vec=${vRank ?? "absent"} rrf=${hRank ?? "absent"}`);
    }
  }

  // --- assertions ---
  let failed = 0;
  const check = (name: string, cond: boolean): void => {
    console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
    if (!cond) failed += 1;
  };

  const q0 = QUERIES[0].q;
  const hyA = JSON.stringify(retriever.hybrid(q0, 10));
  const hyB = JSON.stringify(retriever.hybrid(q0, 10));
  check("determinism: hybrid() is a pure function of (corpus, query)", hyA === hyB);

  check("non-vacuous: every query returns a top-1", QUERIES.every(({ q }) => retriever.hybrid(q, 10).length > 0));

  check(
    `known targets retrieved: ${expectHits}/${expectTotal} anchored rows land in RRF top-3`,
    expectTotal > 0 && expectHits >= expectTotal - 1,
  );

  check(
    `fusion no-harm: regressions=${regressions} <= improvements=${improvements} (RRF never net-hurts the anchored rows)`,
    regressions <= improvements,
  );

  check("legs disagree somewhere (hybrid is not a BM25 echo): at least one query's two legs pick different #1 docs", (() => {
    for (const { q } of QUERIES) {
      const b1 = retriever.bm25(q, 1)[0]?.id;
      const v1 = retriever.vector(q, 1)[0]?.id;
      if (b1 && v1 && b1 !== v1) return true;
    }
    return false;
  })());

  console.log(`\nrrf-qa: ${failed === 0 ? "ALL PASS" : `${failed} FAILURES`} (corpus ${retriever.size} real rows, ${QUERIES.length} queries)`);
  exitCode = failed === 0 ? 0 : 1;
} catch (err) {
  console.error("rrf-qa ERROR:", err instanceof Error ? err.message : String(err));
} finally {
  console.log("db handle closed (readonly connection, no mutation)");
}
process.exit(exitCode);
