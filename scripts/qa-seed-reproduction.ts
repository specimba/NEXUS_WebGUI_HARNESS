/**
 * QA r582 — AWorld explore→reproduce→improve (frontier-scout v2): the scout
 * marks each seed reproduced/not-reproduced with evidence. Acceptance for the
 * TASKS.md P3 row. Dial-free (pure functions + fixtures — no storage, no dials).
 *
 * Doctrine: exit code rides a variable; process.exit runs AFTER try/finally.
 */
import {
  reproduceSeed,
  seedFromItem,
  withReproduction,
  FRONTIER_WATCH_AT,
  type FrontierItem,
  type FrontierJudgment,
  type FrontierSeed,
} from "../src/lib/frontier-scout";

let exitCode = 1;
try {
  let failed = 0;
  const check = (name: string, cond: boolean): void => {
    console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
    if (!cond) failed++;
  };

  const judged = (total: number): FrontierJudgment => ({
    total,
    scores: { relevance: 20, novelty: 18, implementability: 16, evidence: 12, velocity: 9 },
    via: "rules",
    verdict: total >= 70 ? "adopt" : "watch",
    reason: "fixture judgment",
    judgedAt: 1_700_000_000_000,
  });

  const paper: FrontierItem = {
    id: "arxiv:2610.12345",
    kind: "paper",
    title: "Cascade Judging for Cheap Verifiers",
    url: "https://arxiv.org/abs/2610.12345v1",
    summary:
      "A confidence-gated cascade that escalates only the uncertain middle band to a stronger judge, cutting verifier cost while holding accuracy on agentic workflow benchmarks.",
    hub: "arxiv",
    createdAt: "2026-10-01",
    fetchedAt: 1_700_000_000_000,
  };
  const repo: FrontierItem = {
    id: "gh:acme/aworld-lite",
    kind: "repo",
    title: "aworld-lite",
    url: "https://github.com/acme/aworld-lite",
    summary:
      "Explore–reproduce–improve agent loop with deterministic claim verification and evidence-carrying seed ledger for self-improving pipelines.",
    hub: "github",
    stars: 812,
    fetchedAt: 1_700_000_000_000,
  };

  // ── 1. the distiller marks every seed at creation (the acceptance) ──
  const sp = seedFromItem(paper, judged(78));
  check("seedFromItem attaches a reproduction verdict", sp.reproduction !== undefined);
  check("fresh paper seed reproduces", sp.reproduction?.verdict === "reproduced");
  check(
    "evidence covers all four checks",
    (sp.reproduction?.evidence.length ?? 0) === 4 &&
      sp.reproduction!.evidence.every((e) => e.startsWith("ok"))
  );
  check(
    "evidence names the arXiv record id",
    (sp.reproduction?.evidence[0] ?? "").includes("arXiv record 2610.12345")
  );

  const sr = seedFromItem(repo, judged(71));
  check(
    "fresh repo seed reproduces with github owner/repo evidence",
    sr.reproduction?.verdict === "reproduced" &&
      (sr.reproduction.evidence[0] ?? "").includes("github acme/aworld-lite")
  );

  // ── 2. failing shapes are honestly not-reproduced ──
  const badId: FrontierSeed = { ...sp, url: "https://arxiv.org/abs/not-an-id" };
  const rb = reproduceSeed(badId);
  check(
    "malformed arXiv id fails provenance",
    rb.verdict === "not-reproduced" && (rb.evidence[0] ?? "").startsWith("fail — provenance")
  );

  const wrongKind: FrontierSeed = { ...sp, kind: "repo" };
  const rw = reproduceSeed(wrongKind);
  check(
    "paper url judged as repo fails provenance",
    rw.verdict === "not-reproduced" && (rw.evidence[0] ?? "").includes("owner/repo")
  );

  const noClaim: FrontierSeed = { ...sp, seed: "Adapt something — ADOPT 78/100 via rules." };
  const rc = reproduceSeed(noClaim);
  check(
    "missing core claim fails the claim check",
    rc.verdict === "not-reproduced" && (rc.evidence[1] ?? "").startsWith("fail — claim")
  );

  const thinClaim: FrontierSeed = {
    ...sp,
    seed: `Adapt “x” (u) — ADOPT 78/100 via rules. Core claim: too short… ${sp.seed.split("… ")[1] ?? ""}`,
  };
  check(
    "thin core claim (<30 chars) fails the claim check",
    reproduceSeed(thinClaim).verdict === "not-reproduced"
  );

  const lowBand: FrontierSeed = { ...sp, total: FRONTIER_WATCH_AT - 1 };
  const rl = reproduceSeed(lowBand);
  check(
    "below watch band fails the band check",
    rl.verdict === "not-reproduced" && (rl.evidence[3] ?? "").startsWith("fail — band")
  );

  const noDirective: FrontierSeed = {
    ...sp,
    seed: `Adapt “x” (https://arxiv.org/abs/2610.12345) — ADOPT 78/100 via rules. Core claim: ${"an unusually long claim padding line that easily exceeds thirty characters"}… freeform closing text with no directive`,
  };
  check(
    "freeform text without a known directive fails the directive check",
    reproduceSeed(noDirective).verdict === "not-reproduced" &&
      (reproduceSeed(noDirective).evidence[2] ?? "").startsWith("fail — directive")
  );

  // ── 3. unverifiable: too empty to attempt ──
  const empty: FrontierSeed = { ...sp, seed: "  " };
  check(
    "empty seed text is unverifiable",
    reproduceSeed(empty).verdict === "unverifiable"
  );
  check(
    "empty url is unverifiable",
    reproduceSeed({ ...sp, url: "" }).verdict === "unverifiable"
  );

  // ── 4. determinism + purity ──
  const a = reproduceSeed(sp);
  const b = reproduceSeed(sp);
  check(
    "deterministic (verdict+evidence stable)",
    JSON.stringify({ v: a.verdict, e: a.evidence }) === JSON.stringify({ v: b.verdict, e: b.evidence })
  );
  const before = JSON.stringify(sp);
  reproduceSeed(sp);
  check("pure — input seed never mutated", JSON.stringify(sp) === before);

  // ── 5. withReproduction re-stamps (the UI verify path) ──
  const restamped = withReproduction({ ...sp, reproduction: undefined });
  check(
    "withReproduction re-attaches a full verdict",
    restamped.reproduction?.verdict === "reproduced" && restamped.reproduction.checkedAt > 0
  );

  console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILED`} (16 checks)`);
  exitCode = failed === 0 ? 0 : 1;
} catch (err) {
  console.error("seed-reproduction QA ERROR:", err);
} finally {
  console.log("seed-reproduction QA finished (pure functions, no dials, no storage)");
}
process.exit(exitCode);
