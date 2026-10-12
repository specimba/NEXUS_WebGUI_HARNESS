// r371 QA fixture — drive runToMarkdown offline to witness the two new
// report blocks (header novelty line + Failure section) without a browser
// download interception. Run: bun run scripts/qa-r371-runreport.ts
import { runToMarkdown } from "../src/lib/helpers";

const now = Date.now();

const doneRun = {
  id: "r-done",
  workflowId: "w-fixture",
  status: "done",
  task: "Fixture: done run with a low novelty score",
  startedAt: now - 2000,
  finishedAt: now,
  novelty: 22,
  steps: [],
  callLog: [],
  resumeCount: 0,
} as any;

const failedRun = {
  id: "r-fail",
  workflowId: "w-fixture",
  status: "error",
  task: "Fixture: failed run",
  startedAt: now - 5000,
  finishedAt: now,
  steps: [
    { label: "ok step", agentEmoji: "A", agentName: "Agent A", status: "done", ms: 10, output: "fine", toolCalls: [] },
    { label: "bad step", agentEmoji: "B", agentName: "Agent B", status: "error", ms: 20, output: "", toolCalls: [] },
  ],
  error: {
    stepIndex: 1,
    stepLabel: "bad step",
    stepId: "s2",
    agentName: "Agent B",
    kind: "llm_error",
    llmLabel: "Fixture LLM",
    message: "boom — gateway 429",
    hint: "Check the provider key or retry later",
    toolCallsOk: 0,
    attempts: 2,
    autoRetried: true,
  },
  callLog: [],
  resumeCount: 0,
} as any;

console.log("=== DONE RUN header (expect Evolution novelty 22% + stall language) ===");
console.log(runToMarkdown({ name: "Fixture W" }, doneRun).split("\n").slice(0, 10).join("\n"));
console.log("");
console.log("=== FAILED RUN header (expect Failure block before Task) ===");
console.log(
  runToMarkdown({ name: "Fixture W" }, failedRun)
    .split("\n")
    .slice(0, 22)
    .join("\n")
);
