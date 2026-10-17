/**
 * r496 probe — "single report bigger than batch exports" fix.
 * Fixtures: the owner's own uploads.
 *   - upload/nexus-workflows (1).json          (definitions-only batch export, 9,650 B)
 *   - upload/nexus-run-test-run-continuous-research-evaluation-run006-20261017-0958.md
 *     (single run report, 68,568 B)
 * Asserts:
 *   A1 definitions payload ≈ the owner's file (no regression)
 *   A2 FULL pack payload > the single run report (the complaint, inverted)
 *   A3 round-trip: sanitizeImportedRun restores outputs/callLog/toolCalls
 *   A4 honesty coercions: running→stopped, pending/running steps→skipped, junk→null
 */
import { buildWorkflowExport, sanitizeImportedRun } from "/home/z/my-project/src/lib/helpers";
import type { Workflow, WorkflowRun } from "/home/z/my-project/src/lib/types";
import { readFileSync } from "node:fs";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const defs = JSON.parse(readFileSync("/home/z/my-project/upload/nexus-workflows (1).json", "utf8")) as {
  workflows: Array<{ name: string; description: string; steps: unknown[]; depth?: string }>;
};
const singleReportBytes = readFileSync(
  "/home/z/my-project/upload/nexus-run-test-run-continuous-research-evaluation-run006-20261017-0958.md"
).length;

// Synthesize per-workflow run history from the real report text (5 chunked
// outputs ≈ the real run's output mass), as the store would hold it.
const report = readFileSync(
  "/home/z/my-project/upload/nexus-run-test-run-continuous-research-evaluation-run006-20261017-0958.md",
  "utf8"
);
const chunkSize = Math.ceil(report.length / 5);
const outputs = Array.from({ length: 5 }, (_, i) => report.slice(i * chunkSize, (i + 1) * chunkSize));

const workflows: Workflow[] = defs.workflows.map((w, wi) => ({
  id: `wf_probe_${wi}`,
  name: w.name,
  description: w.description,
  steps: (w.steps as Array<{ id: string; agentId: string; label: string; instruction?: string }>).map((s) => ({
    id: s.id,
    agentId: s.agentId,
    label: s.label,
    ...(s.instruction ? { instruction: s.instruction } : {}),
  })),
  runs: wi === 0 ? [run006Fixture()] : [],
  createdAt: Date.now() - 86400_000,
  updatedAt: Date.now(),
  ...(w.depth === "quick" || w.depth === "standard" || w.depth === "deep" ? { depth: w.depth } : {}),
}));

function run006Fixture(): WorkflowRun {
  return {
    id: "run_006",
    workflowId: "wf_probe_0",
    workflowName: defs.workflows[0].name,
    task: 'test run "Continuous Research & Evaluation" for recursive self improvement and agent harnesses',
    status: "done",
    startedAt: Date.now() - 1200_000,
    finishedAt: Date.now() - 194_000,
    source: "manual",
    novelty: 61,
    steps: outputs.map((output, i) => ({
      stepId: `step_${i}`,
      agentId: "a-researcher",
      agentName: "Research Scout",
      agentEmoji: "🔎",
      label: `Step ${i + 1}`,
      output,
      toolCalls:
        i === 0
          ? [{ id: "t1", name: "web_search", args: '{"query":"recursive self improvement"}', result: "x".repeat(6000), ok: true, ms: 1234 }]
          : [],
      status: "done",
      ms: 40_300 + i,
    })),
    callLog: outputs.map((_, i) => ({
      at: Date.now() - 1_000_000 + i * 1000,
      stepLabel: `Step ${i + 1}`,
      engine: "browser-direct",
      model: "gpt-5.2",
      ms: 30_000 + i,
      ok: true,
      attempt: 1,
    })),
  };
}

const nameById = new Map([
  ["a-planner", "Strategic Planner"],
  ["a-researcher", "Research Scout"],
  ["a-coder", "Code Smith"],
  ["a-writer", "Wordsmith"],
  ["agent_1f0457d5bda0", "Nexus Assistant"],
]);

// A1 — definitions payload matches the owner's file scale
const defPayload = buildWorkflowExport(workflows, "definitions", nameById);
const defBytes = JSON.stringify(defPayload).length;
check("A1 definitions payload stays small", defBytes < 16_000, `${defBytes} B (owner file: 9,650 B)`);

// A2 — full pack outweighs the single run report
const fullPayload = buildWorkflowExport(workflows, "full", nameById);
const fullBytes = JSON.stringify(fullPayload).length;
check(
  "A2 full pack > single run report (68,568 B)",
  fullBytes > singleReportBytes,
  `full=${fullBytes} B vs report=${singleReportBytes} B`
);
const fw0 = (fullPayload.workflows as Array<Record<string, unknown>>)[0];
check("A2b full pack carries runs + schedule-ready shape", Array.isArray(fw0.runs) && (fw0.runs as unknown[]).length === 1);
check("A2c steps carry agentName for rebind", (fw0.steps as Array<Record<string, unknown>>)[0].agentName === "Strategic Planner");

// A3 — round-trip restore
const restored = sanitizeImportedRun((fw0.runs as unknown[])[0], "wf_new", "test run");
check("A3 run restored", restored !== null);
if (restored) {
  check("A3b outputs preserved", restored.steps.every((s) => s.output.length > 10_000), `first output ${restored.steps[0].output.length} chars`);
  check("A3c tool result capped at 4000+suffix", (restored.steps[0].toolCalls[0]?.result?.length ?? 0) <= 4100, `result len ${restored.steps[0].toolCalls[0]?.result?.length} (was 6000)`);
  check("A3d callLog restored (5 entries)", restored.callLog?.length === 5);
  check("A3e profile-local ids regenerated", restored.id.startsWith("run_") && restored.workflowId === "wf_new");
  check("A3f novelty clamped through", restored.novelty === 61);
}

// A4 — honesty coercions
const liveish = sanitizeImportedRun(
  {
    status: "running",
    task: "mid-flight export",
    startedAt: Date.now(),
    steps: [
      { stepId: "s1", agentId: "a", agentName: "A", agentEmoji: "🤖", label: "done step", output: "ok", status: "done" },
      { stepId: "s2", agentId: "a", agentName: "A", agentEmoji: "🤖", label: "running step", output: "", status: "running" },
      { stepId: "s3", agentId: "a", agentName: "A", agentEmoji: "🤖", label: "pending step", output: "", status: "pending" },
    ],
  },
  "wf_new",
  "live-ish"
);
check("A4 running run coerces to stopped", liveish?.status === "stopped");
check("A4b mid-flight steps become skipped", liveish?.steps.map((s) => s.status).join(",") === "done,skipped,skipped");
check("A4c junk run (no steps) drops", sanitizeImportedRun({ status: "done", steps: [] }, "w", "junk") === null);
check("A4d unknown status drops", sanitizeImportedRun({ status: "weird", steps: [{ label: "x", status: "done" }] }, "w", "x") === null);
check("A4e non-object drops", sanitizeImportedRun("nope", "w", "x") === null);

console.log(failures === 0 ? "\nALL PROBES PASSED" : `\n${failures} PROBE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
