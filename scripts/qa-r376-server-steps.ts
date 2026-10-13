// r376 — collectServerStepUsage unit suite: drives the pure attribution
// function with fixtures (no server, no browser) and asserts exact counts.
// Covers: full-credit done run, partial credit on an error run (r162 parity:
// only ok=true steps count), label-match precedence, index fallback when the
// label drifted (closed-tab edit window), duplicate-label index fallback,
// orphaned registry rows crediting nobody, malformed stepsJson crediting
// nobody, and lastAt = finishedAt (startedAt fallback when unfinished).
import { collectServerStepUsage } from "../src/components/praison/agents/agents-view";
import type { ServerRunRow } from "../src/components/praison/workflows/use-server-runs";
import type { Workflow } from "../src/lib/types";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  ✓" : "  ✗"} ${m}`);
  if (c) pass++; else fail++;
};

const workflowA = {
  id: "wf-x",
  steps: [
    { label: "Scan", agentId: "agent-a" },
    { label: "Eval", agentId: "agent-b" },
  ],
} as unknown as Workflow;

const workflowDup = {
  id: "wf-y",
  steps: [
    { label: "Do", agentId: "agent-c" },
    { label: "Do", agentId: "agent-d" },
  ],
} as unknown as Workflow;

const run = (over: Partial<ServerRunRow>): ServerRunRow =>
  ({
    id: "sr",
    workflowId: "wf-x",
    workflowName: "X",
    trigger: "schedule",
    status: "done",
    currentStep: 2,
    stepsTotal: 2,
    error: null,
    startedAt: "2026-10-09T05:00:00.000Z",
    finishedAt: "2026-10-09T05:02:00.000Z",
    stepsJson: "[]",
    ...over,
  }) as ServerRunRow;

const usage = (runs: ServerRunRow[], workflows: Workflow[]) => {
  const m = collectServerStepUsage(runs, workflows);
  return (id: string) => m.get(id);
};

// 1. done run — every ok step credits its agent by label
let u = usage(
  [run({ stepsJson: JSON.stringify([{ label: "Scan", ok: true }, { label: "Eval", ok: true }]) })],
  [workflowA],
);
ok(u("agent-a")?.steps === 1, "done run: agent-a credited 1 step by label");
ok(u("agent-b")?.steps === 1, "done run: agent-b credited 1 step by label");
ok(u("agent-a")?.lastAt === Date.parse("2026-10-09T05:02:00.000Z"), "lastAt uses finishedAt");

// 2. error run — partial credit only (r162 parity: honest completed work)
u = usage(
  [run({ status: "error", stepsJson: JSON.stringify([{ label: "Scan", ok: true }, { label: "Eval", ok: false }]) })],
  [workflowA],
);
ok(u("agent-a")?.steps === 1, "error run: completed step still credits (r162 parity)");
ok(u("agent-b") === undefined, "error run: failed step credits nobody (absent = zero)");

// 3. label drifted (closed-tab edit) — index fallback attributes in order
u = usage(
  [run({ stepsJson: JSON.stringify([{ label: "Scan (web)", ok: true }, { label: "Eval", ok: true }]) })],
  [workflowA],
);
ok(u("agent-a")?.steps === 1, "label drift: step 0 falls back to index → agent-a");
ok(u("agent-b")?.steps === 1, "label drift: step 1 still label-matches → agent-b");

// 4. duplicate labels — ambiguous label match falls back to index
u = usage(
  [run({ workflowId: "wf-y", stepsJson: JSON.stringify([{ label: "Do", ok: true }, { label: "Do", ok: true }]) })],
  [workflowDup],
);
ok(u("agent-c")?.steps === 1 && u("agent-d")?.steps === 1,
  "duplicate labels: ambiguous match falls back to index (c/d one each)");

// 5. orphaned registry row — no client definition, credits nobody
u = usage([run({ workflowId: "wf-gone", stepsJson: JSON.stringify([{ label: "Scan", ok: true }]) })], [workflowA]);
ok(u("agent-a") === undefined, "orphan run: credits nobody");

// 6. malformed stepsJson — credit nobody rather than guess
u = usage([run({ stepsJson: "{not-json" })], [workflowA]);
ok(u("agent-a") === undefined, "malformed stepsJson: credits nobody");

// 7. unfinished run — lastAt falls back to startedAt
u = usage(
  [run({ status: "running", finishedAt: null, stepsJson: JSON.stringify([{ label: "Scan", ok: true }]) })],
  [workflowA],
);
ok(u("agent-a")?.lastAt === Date.parse("2026-10-09T05:00:00.000Z"), "unfinished run: lastAt falls back to startedAt");

// 8. merged across runs — counts accumulate per agent
u = usage(
  [
    run({ id: "r1", stepsJson: JSON.stringify([{ label: "Scan", ok: true }]) }),
    run({ id: "r2", startedAt: "2026-10-09T06:00:00.000Z", finishedAt: "2026-10-09T06:01:00.000Z", stepsJson: JSON.stringify([{ label: "Scan", ok: true }]) }),
  ],
  [workflowA],
);
ok(u("agent-a")?.steps === 2, "multiple runs: counts accumulate");
ok(u("agent-a")?.lastAt === Date.parse("2026-10-09T06:01:00.000Z"), "multiple runs: lastAt is the latest");

console.log(`SUMMARY: ${pass}/${pass + fail} server-step-usage assertions`);
if (fail > 0) process.exit(1);
