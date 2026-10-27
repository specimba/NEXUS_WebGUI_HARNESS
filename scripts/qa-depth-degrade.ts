/**
 * r185 — user report ("0 progression getting worse and worse"): adaptive
 * depth degradation. Deep pipelines on an unstable lane burned 45min–2.3h per
 * doomed run; the fix fires them Standard after 2+ consecutive failures until
 * a run completes. K-series: a pure mirror of the degrade rule + source-level
 * wiring assertions across the scheduler → runner → materializer chain.
 * Run: bun run scripts/qa-depth-degrade.ts
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

console.log("K1 — pure rule: adaptive depth (mirror of the scheduler)");
// Mirrors workflow-scheduler.tsx's degrade condition — keep in sync (K3 pins it).
function effectiveDepth(depth: "quick" | "standard" | "deep" | undefined, failStreak: number | undefined) {
  const degraded = (failStreak ?? 0) >= 2 && (depth ?? "standard") === "deep";
  return degraded ? "standard" : depth ?? "standard";
}
ok(effectiveDepth("deep", 0) === "deep", "healthy lane keeps authored deep");
ok(effectiveDepth("deep", 1) === "deep", "one failure is not a pattern — deep stays");
ok(effectiveDepth("deep", 2) === "standard", "2 consecutive failures degrade deep → standard");
ok(effectiveDepth("deep", 12) === "standard", "long streak stays degraded");
ok(effectiveDepth("standard", 12) === "standard", "standard workflows unaffected");
ok(effectiveDepth(undefined, 12) === "standard", "undefined depth treated as standard");
ok(effectiveDepth("deep", undefined) === "deep", "no streak data → authored depth (fail-open)");

console.log("K2 — restore path");
ok(/failStreak: 0, autoResumeTrips: 0, autoResumeAt: undefined/.test(src("src/lib/workflow-runner.ts")), "done run resets failStreak (existing r171 reset = deep restores itself)");

console.log("K3 — scheduler wiring");
const sched = src("src/components/nexus/workflows/workflow-scheduler.tsx");
ok(/wf\.schedule\?\.failStreak \?\? 0\) >= 2 && \(wf\.depth \?\? "standard"\) === "deep"/.test(sched), "degrade condition present (streak ≥ 2 AND deep)");
ok(/depthOverride: degraded \? "standard" : undefined/.test(sched), "scheduled fire passes depthOverride");
ok(/standard depth \(deep passes paused — lane unstable\)/.test(sched), "fire toast discloses the degradation");
ok(/noteScheduleDeferred\(wf\.id, wf\.name, "depth-degraded"\)/.test(sched), "degraded fires leave an audit-trail entry");
ok(/closeScheduleDeferral\(wf\.id, now\);\s*\n\s*\}\s*\n\s*\n?\s*toast\(`Scheduled run started`/.test(sched.replace(/\r/g, "")), "degraded episode closes immediately (same tick)");

console.log("K4 — runner plumbing");
const runner = src("src/lib/workflow-runner.ts");
ok(/depthOverride\?: PipelineDepth;/.test(runner), "ExecuteRunOptions.depthOverride declared");
ok(/materializeRunSteps\(wf, agentsNow, runnerDegraded \? "standard" : options\.depthOverride\)/.test(runner), "executeWorkflowRun forwards the effective depth to materialization");
ok(/const runnerDegraded =\s*options\.depthOverride === undefined &&\s*source === "scheduled" &&/.test(runner), "r186: runner itself degrades scheduled fires of stuck deep workflows (choke point, scheduler bypass-proof)");
ok(/depth: runnerDegraded \? "standard" : \(options\.depthOverride \?\? wf\.depth\)/.test(runner), "run row stamps the effective depth (self-diagnosing history)");
ok(/export function materializeRunSteps\(wf: Workflow, agentsNow: Agent\[\], depthOverride\?: PipelineDepth\)/.test(runner), "materializeRunSteps accepts the override");
ok(/const depth: PipelineDepth = depthOverride \?\? wf\.depth \?\? "standard";/.test(runner), "override wins over authored depth; authored wins over default");

console.log("K5 — scope discipline");
ok(/resume \(above\) is untouched/i.test(runner) || !/resume[\s\S]{0,200}depthOverride/i.test(runner.slice(runner.indexOf("options.resume"), runner.indexOf("options.resume") + 400)), "resume path does not re-materialize with the override (old runs stay byte-identical)");
const skips = src("src/lib/schedule-skips.ts");
ok(/"depth-degraded"/.test(skips) && /"active-run" \| "gateway-saturated" \| "depth-degraded"/.test(skips), "skip reason type covers depth-degraded");
const view = src("src/components/nexus/workflows/workflows-view.tsx");
ok(/fired at standard depth/.test(view) && /a completed run restores deep/.test(view), "card audit line explains the degradation + restore path");

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail === 0 ? 0 : 1);
