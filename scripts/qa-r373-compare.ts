// r373 QA fixture — drive comparisonToMarkdown offline to witness the new
// Novelty row in the comparison export. Run: bun run scripts/qa-r373-compare.ts
import { comparisonToMarkdown } from "../src/lib/helpers";

const now = Date.now();

const baseRun = {
  id: "r-a",
  workflowId: "w-fixture",
  status: "done",
  task: "Same task, edition one",
  startedAt: now - 60_000,
  finishedAt: now - 30_000,
  steps: [],
  callLog: [],
  resumeCount: 0,
} as any;

const runA = { ...baseRun, id: "r-a", novelty: 100 } as any;
const runB = { ...baseRun, id: "r-b", novelty: 22, startedAt: now - 30_000, finishedAt: now } as any;
const runNoNovelty = { ...baseRun, id: "r-x", novelty: undefined } as any;

const cmp = {
  a: runA,
  b: runB,
  sameTask: true,
  totalAms: 30_000,
  totalBms: 30_000,
  totalDeltaMs: 0,
  aDone: 1,
  bDone: 1,
  rows: [
    {
      stepIndex: 0,
      label: "only step",
      aAgent: "Agent A",
      bAgent: "Agent A",
      aStatus: "done",
      bStatus: "done",
      aMs: 30_000,
      bMs: 30_000,
      aOutputLen: 100,
      bOutputLen: 100,
      aToolCalls: 2,
      bToolCalls: 2,
      sameAgent: true,
    },
  ],
} as any;

const cmpMissing = { ...cmp, a: runNoNovelty, b: runNoNovelty } as any;

console.log("=== Comparison table (expect Novelty row: 100% | 22% (stall)) ===");
console.log(comparisonToMarkdown({ name: "Fixture W" }, cmp).split("\n").slice(0, 14).join("\n"));
console.log("");
console.log("=== Comparison with novelty-less runs (expect — | —) ===");
console.log(comparisonToMarkdown({ name: "Fixture W" }, cmpMissing).split("\n").slice(6, 12).join("\n"));
