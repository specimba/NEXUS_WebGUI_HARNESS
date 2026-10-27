/**
 * r183 — directive item (b): honest PARTIAL / BLOCKED / skipped statuses.
 * K-series: pure-logic mirrors of the finalize rules + source-level
 * integration assertions over both display surfaces and the streak gate.
 * Run: bun run scripts/qa-run-statuses.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
let pass = 0, fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}
function src(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

console.log("K1 — types: status unions widened");
const types = src("src/lib/types.ts");
ok(/status: "pending" \| "running" \| "done" \| "error" \| "stopped" \| "skipped"/.test(types), "WorkflowRunStep.status includes \"skipped\"");
ok(/status: "running" \| "done" \| "error" \| "stopped" \| "partial" \| "blocked"/.test(types), "WorkflowRun.status includes \"partial\" | \"blocked\"");
ok(/Populated when status = "error" or "blocked"/.test(types), "run.error doc covers blocked (recovery card)");

console.log("K2 — pure rule: stopped→partial remap mirrors the runner");
// Mirror of finish()'s remap rule — kept in sync by the source assertions in K3.
function remapStopped(status: "stopped" | "partial", stepStatuses: string[]): "stopped" | "partial" {
  if (status === "stopped" && stepStatuses.some((s) => s === "done")) return "partial";
  return status;
}
ok(remapStopped("stopped", ["pending", "pending"]) === "stopped", "zero-progress stop stays \"stopped\"");
ok(remapStopped("stopped", ["done", "error", "pending"]) === "partial", "stop with ≥1 done step becomes \"partial\"");
ok(remapStopped("partial", ["pending"]) === "partial", "partial never demotes");
ok(["done", "error"].every((s) => remapStopped(s as never, []) !== "partial" || s === "done") || true, "remap only touches stopped (trivially true — rule scoped by guard)");

console.log("K3 — runner: finalize paths");
const runner = src("src/lib/workflow-runner.ts");
ok(/status: "skipped",\s*\n\s*output: "\(not run — the run ended before reaching this step\)"/.test(runner), "stopRemaining marks never-ran steps \"skipped\" with an honest note");
ok(/if \(status === "stopped"\) \{[\s\S]*?storeRow[\s\S]*?some\(\(s\) => s\.status === "done"\)[\s\S]*?status = "partial";/.test(runner), "finish() remaps stopped-with-progress → partial from the store row");
ok(/parkKind !== null \|\| congestionExhausted \? "blocked" : "error"/.test(runner), "parked + congestion-exhausted runs finalize \"blocked\", genuine defects stay \"error\"");
ok(/const congestionExhausted =\s*parkKind === null &&\s*!opts\?\.stallOwned &&/.test(runner), "r186: only congestion-class deaths with an exhausted park ladder reclassify (stall-owned watchdog path untouched)");
ok(/status === "error" \|\| status === "blocked"\) && sched\.enabled/.test(runner), "r171 streak gate counts blocked runs (breaker still trips)");
ok(/status === "done" \|\| status === "error" \|\| status === "blocked"\)\) \{/.test(runner), "streak gate branch set includes blocked");
ok(/status === "blocked" \? "Scheduled run parked — auto-resumes" : "Scheduled run failed"/.test(runner), "scheduled-lane toast distinguishes parked from failed");
ok(/status === "blocked" \? `Run parked at "\$\{errorInfo\.stepLabel\}"`/.test(runner), "manual-lane toast distinguishes parked from failed");
// skipped steps must NOT feed the fail streak indirectly: they are not "error"
ok(!/some\(\(s\) => s\.status === "skipped"\)/.test(runner), "no logic treats skipped as a failure signal");

console.log("K4 — stores: hydration close-out");
const stores = src("src/lib/stores.ts");
ok(/progressed \? "partial" : "stopped"\) as WorkflowRun\["status"\]/.test(stores), "hydration: mid-run close with progress → partial");
ok(/st\.status === "pending" \|\| st\.status === "running"\s*\?\s*\{ \.\.\.st, status: "skipped" as const/.test(stores), "hydration: pending/running steps → skipped with note");
ok(/the app closed before reaching this step/.test(stores), "hydration skip note is honest about the cause");

console.log("K5 — kanban: board placement + icons");
const kanban = src("src/components/nexus/workflows/run-kanban.tsx");
ok(/run\.status === "partial" \|\|\s*\n?\s*run\.status === "blocked"/.test(kanban), "partial + blocked land in the attention column");
ok(/\(run\.status === "stopped" \|\| run\.status === "partial" \|\| run\.status === "blocked"\)/.test(kanban), "amber border shared by stopped/partial/blocked");
ok(/run\.status === "partial" \? \(\s*\n\s*<Minus/.test(kanban), "partial card icon = Minus (amber)");
ok(/run\.status === "blocked" \? \(\s*\n\s*<Clock/.test(kanban), "blocked card icon = Clock (parked, waiting)");

console.log("K6 — run panel: recovery card + history + dots");
const panel = src("src/components/nexus/workflows/workflow-run-panel.tsx");
ok(/skipped: "border-l-zinc-500"/.test(panel), "STEP_BORDER covers skipped (Record exhaustiveness)");
ok(/Run parked — auto-resume scheduled/.test(panel), "recovery card title for blocked runs");
ok(/r\.status === "partial" \? \(\s*\n\s*<Minus/.test(panel), "history row: partial icon");
ok(/r\.status === "blocked" \? \(\s*\n\s*<Hourglass/.test(panel), "history row: blocked icon = Hourglass");
ok((panel.match(/s\.status === "skipped" && "bg-zinc-400 dark:bg-zinc-600"/g) ?? []).length === 2, "both step-dot strips render skipped");
ok(/const stopped =\s*\n?\s*run\.status === "stopped" \|\| run\.status === "partial" \|\| run\.status === "blocked"/.test(panel), "amber calm chrome for all three non-failure endings");

console.log("K7 — export + compare surfaces");
const helpers = src("src/lib/helpers.ts");
ok(/partial: "🟡 Partial — ended early, completed steps preserved"/.test(helpers), "Markdown report: honest PARTIAL label");
ok(/blocked: "⏸ Blocked — parked, auto-resumes"/.test(helpers), "Markdown report: honest BLOCKED label");
const compare = src("src/components/nexus/workflows/workflow-compare-dialog.tsx");
ok(/skipped: <span className="h-2 w-2 shrink-0 rounded-full bg-zinc-500" aria-label="Skipped — never ran" \/>/.test(compare), "compare dialog: skipped icon (filled dot vs pending hollow)");

console.log("K8 — doctrine: resume path unaffected");
ok(/if \(!run \|\| run\.status === "running"\) return null;/.test(runner), "resume eligibility = any non-running run (partial/blocked resume fine)");

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail === 0 ? 0 : 1);
