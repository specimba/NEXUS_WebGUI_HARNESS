/**
 * r654 QA — deep-pass non-fatality (the RSI loop saver, K-series).
 * Run: bun scripts/qa-deep-resilience.ts
 * Covers: the synthetic-deep predicate (prefix AND instruction are both
 * load-bearing), the transient-family parity with park-policy, the countable
 * note vocabulary, and source-level pins on the runner's continue-branch +
 * run-level degradedDeep stamp + the scheduler reset staying intact.
 */
import { readFileSync } from "node:fs";
import {
  DEEP_PASSES,
  DEEP_RESEARCH_INSTRUCTION,
  deepPassSkipNote,
  isSyntheticDeepStep,
  isTransientErrorKind,
} from "../src/lib/deep-pass";
import { resolvePark } from "../src/lib/park-policy";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. The synthetic-deep predicate ──────────────────────────────────────────
check("materialized deep pass matches", isSyntheticDeepStep("deep_abc123def456", DEEP_RESEARCH_INSTRUCTION));
check("authored step id NEVER matches (prefix is load-bearing)",
  !isSyntheticDeepStep("step_abc123def456", DEEP_RESEARCH_INSTRUCTION));
check("verification pass id never matches", !isSyntheticDeepStep("verify_abc123def456", DEEP_RESEARCH_INSTRUCTION));
check("authored step with coinciding instruction NEVER matches (both halves load-bearing)",
  !isSyntheticDeepStep("step_abc123def456", `${DEEP_RESEARCH_INSTRUCTION} `));
check("deep id with absent instruction does not match", !isSyntheticDeepStep("deep_abc123def456", undefined));
check("garbage inputs never throw",
  isSyntheticDeepStep(null as never, undefined) === false &&
    isSyntheticDeepStep(123 as never, 456 as never) === false);

// ── 2. The transient family — parity with park-policy ────────────────────────
const kinds = ["rate-limit", "network", "timeout", "auth", "model", "billing", "region", "unknown"];
check("transient family is exactly rate-limit/network/timeout",
  kinds.every((k) => isTransientErrorKind(k) === (k === "rate-limit" || k === "network" || k === "timeout")));
check("family parity: isTransientErrorKind(k) === (resolvePark(k) parks) for every kind",
  kinds.every((k) => isTransientErrorKind(k) === (resolvePark(k as never, {}) !== null)));
check("garbage kind never throws", isTransientErrorKind(undefined as never) === false);

// ── 3. The countable note vocabulary ─────────────────────────────────────────
const note = deepPassSkipNote("rate-limit", "HTTP 429: too many requests");
check("note starts with the census prefix", note.startsWith("Deep pass — skipped"));
check("census regex matches", /Deep pass — skipped/.test(note));
check("note embeds the kind", note.includes("rate-limit"));
check("note embeds the capped message", note.includes("HTTP 429"));
check("note ends with the continuation claim", note.includes("run continues without it"));
const longNote = deepPassSkipNote("timeout", "z".repeat(10_000));
check("10k-char message is capped (bounded notes)", longNote.length < 300, String(longNote.length));
check("non-string message never throws",
  deepPassSkipNote("network", undefined as never).startsWith("Deep pass — skipped"));

// ── 4. Source-level pins on the runner wiring ────────────────────────────────
const runner = readFileSync("src/lib/workflow-runner.ts", "utf8");
const branchStart = runner.indexOf("r654: deep-pass NON-FATALITY");
// anchor the FATAL call AFTER the branch marker — the review-gate catch (~2263)
// carries the same `failRun(i, err as Error)` text earlier in the file
const failRunCall = branchStart !== -1 ? runner.indexOf("failRun(i, err as Error)", branchStart) : -1;
check("the continue-branch sits BEFORE the fatal failRun call",
  branchStart !== -1 && failRunCall !== -1 && branchStart < failRunCall);
const branchSlice = branchStart !== -1 ? runner.slice(branchStart, failRunCall) : "";
check("the branch CONTINUES instead of dying", branchSlice.includes("continue;"));
check("the branch never calls stopRemaining", !branchSlice.includes("stopRemaining("));
check("the branch pushes the countable note through pushCall",
  branchSlice.includes("pushCall({") && branchSlice.includes("deepPassSkipNote("));
check("the branch gates on the synthetic predicate + transient family",
  branchSlice.includes("isSyntheticDeepStep(step.stepId, step.instruction)") &&
    branchSlice.includes("isTransientErrorKind(deepKind)"));
check("terminal patch stamps degradedDeep ONLY on done runs",
  runner.includes('status === "done" && deepSkips.count > 0') &&
    runner.includes("degradedDeep: { skipped: deepSkips.count, kinds: [...deepSkips.kinds] }"));
check("definitions moved to the pure module (no copy left behind)",
  !runner.includes("Deep research pass 2 — verify & broaden") &&
    runner.includes('from "@/lib/deep-pass"'));
check("r171/r455 scheduler reset untouched (a degraded-done run still resets the streak)",
  runner.includes("failStreak: 0, autoResumeTrips: 0"));
const scheduler = readFileSync("src/components/nexus/workflows/workflow-scheduler.tsx", "utf8");
check("r185 depth-degrade ladder stays armed as the fatal-class safety net",
  scheduler.includes("deep passes paused"));

// ── 5. UI honesty chips ──────────────────────────────────────────────────────
const kanban = readFileSync("src/components/nexus/workflows/run-kanban.tsx", "utf8");
check("board card renders the deep-skipped chip", kanban.includes("deep skipped (") && kanban.includes("run.degradedDeep"));
const panel = readFileSync("src/components/nexus/workflows/workflow-run-panel.tsx", "utf8");
check("run panel renders the deep-skipped row with the not-deep-verified caveat",
  panel.includes("deep skipped (") && panel.includes("not deep-verified"));

// ── 6. Labels unchanged (r26 contract) ───────────────────────────────────────
check("deep pass labels unchanged", DEEP_PASSES.length === 2 &&
  DEEP_PASSES[0].label === "Deep research pass 2 — verify & broaden" &&
  DEEP_PASSES[1].label === "Deep research pass 3 — cross-check sources");

console.log(`\nqa-deep-resilience: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
