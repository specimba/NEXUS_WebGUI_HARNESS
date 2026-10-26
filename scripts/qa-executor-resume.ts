// TASK-101 slice 4 (r535) — memoized resume-after-failure QA.
// Drives executeWorkflow + resumableErroredRunId DIRECTLY against the real
// database (snapshot/restore discipline as scripts/qa-automation-executor.ts).
// DELIBERATELY not via tickOnce(): the claim loop would race the live dev
// server's own executor over the same due row (both processes see the stale
// heartbeat) — a 15s-cadence heist mid-test flaked the first chain run. The
// production RESUME lookup itself is the exported function under test; only
// the 3-line claim-side wiring stays unwitnessed here (tsc-covered).
// The dial is mocked per-step-prompt so the failure/resume choreography is
// deterministic:
//   fire 1  Alpha=200 Beta=500       → run errors at step 2 (breaker 1)
//   fire 2  all 200                  → RESUMES the same run at step 2,
//                                      memoized Alpha output reused
//                                      byte-identical, resume trail visible
//   fire 3  Beta=500 again           → latest run is DONE → fresh run
//                                      (healed pipelines don't resurrect)
//   fire 4  Alpha renamed, all 200   → prefix guard trips → fresh run from
//                                      step 1 (memoization never skips
//                                      edited pipelines)

import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import {
  executeWorkflow,
  resolveServerDialFromSlots,
  resumableErroredRunId,
} from "../src/lib/server/automation-executor";
import {
  hasMemoizedTrail,
  isResumableStepFailure,
  resumePlanFromError,
} from "../src/lib/automation-lane";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  ✓" : "  ✗"} ${m}`);
  if (c) pass++; else fail++;
};

// ── per-prompt dial mock (deterministic choreography) ──────────────────────
// NOTE: vyce is registry dialect "anthropic" since r528 — the server lane
// dials /v1/messages with a content-block response, NOT /chat/completions.
// The mock intercepts BOTH URLs and answers in the matching wire shape.
const statusFor: Record<string, number> = { ALPHA: 200, BETA: 500, GAMMA: 200 };
const dialLog: string[] = [];
const realFetch = globalThis.fetch.bind(globalThis);
(globalThis as { fetch: typeof fetch }).fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  if (u.includes("/chat/completions") || u.includes("/v1/messages")) {
    const anthropic = u.includes("/v1/messages");
    let prompt = "";
    try {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: { role?: string; content?: string }[] };
      const msgs = Array.isArray(body.messages) ? body.messages : [];
      prompt = [...msgs].reverse().find((m) => m?.role === "user")?.content ?? "";
    } catch { /* unreadable body → empty prompt → GAMMA bucket */ }
    dialLog.push(prompt);
    const key = prompt.includes("ALPHA") ? "ALPHA" : prompt.includes("BETA") ? "BETA" : "GAMMA";
    const status = statusFor[key] ?? 500;
    if (status !== 200) {
      return new Response(JSON.stringify({ error: { message: `mock ${status}` } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    const text = `E-OK ${key}`;
    return new Response(
      JSON.stringify(
        anthropic
          ? { content: [{ type: "text", text }] }
          : { choices: [{ message: { content: text } }] },
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return realFetch(url as Parameters<typeof realFetch>[0], init);
}) as typeof fetch;

const WF_ID = "qa-resume-wf";
const PROVIDER = "vyce"; // real registry id — probeSlotDial must resolve it

// ── state snapshots (restored in finally — the r204 discipline) ────────────
type WfSnap = { id: string; enabled: boolean; nextRunAt: Date; failStreak: number };
let wfSnapshot: WfSnap[] = [];
let vaultSnapshot: { provider: string; key: string; label: string | null }[] = [];
let runIdSnapshot: Set<string> = new Set();

async function snapshotState() {
  wfSnapshot = (await db.automationWorkflow.findMany({})).map((r) => ({
    id: r.id,
    enabled: r.enabled,
    nextRunAt: r.nextRunAt,
    failStreak: r.failStreak,
  }));
  // r570: self-heal crash debris — a hard-killed run (tool timeout SIGKILL)
  // skips the finally-restore and leaves the qa key row behind. Sweep
  // QA-signature rows BEFORE snapshotting so the restore can't resurrect them.
  await db.automationVault.deleteMany({
    where: { label: "qa", key: { startsWith: "sk-qa-" } },
  });
  vaultSnapshot = (await db.automationVault.findMany({})).map((v) => ({
    provider: v.provider,
    key: v.key,
    label: v.label,
  }));
  runIdSnapshot = new Set((await db.automationRun.findMany({ select: { id: true } })).map((r) => r.id));
}

async function restoreState() {
  for (const s of wfSnapshot) {
    await db.automationWorkflow.update({
      where: { id: s.id },
      data: { enabled: s.enabled, nextRunAt: s.nextRunAt, failStreak: s.failStreak },
    });
  }
  await db.automationVault.deleteMany({});
  for (const v of vaultSnapshot) {
    await db.automationVault.create({ data: v });
  }
  // delete only runs the test created (anything not in the pre-test snapshot)
  await db.automationRun.deleteMany({
    where: { id: { notIn: [...runIdSnapshot] } },
  });
}

const STEPS_V1 = [
  { label: "Alpha probe", prompt: "Say ALPHA" },
  { label: "Beta probe", prompt: "Say BETA" },
  { label: "Gamma probe", prompt: "Say GAMMA" },
];

async function resetFixture(steps: { label: string; prompt: string }[]) {
  await db.automationWorkflow.deleteMany({ where: { id: WF_ID } });
  await db.automationVault.deleteMany({});
  await db.automationWorkflow.create({
    data: {
      id: WF_ID,
      name: "QA resume fixture",
      task: "",
      stepsJson: JSON.stringify(steps),
      intervalMs: 3_600_000,
      // enabled:false keeps the fixture INVISIBLE to the live dev server's
      // claim loop (tickOnce requires enabled:true) — with a stale real
      // heartbeat the server would heist the due fixture between fires and
      // corrupt the run trail with its own unmocked 401 runs.
      enabled: false,
      nextRunAt: new Date(Date.now() - 500),
      failStreak: 0,
    },
  });
  await db.automationVault.create({
    data: { provider: PROVIDER, key: "sk-qa-resume-key", label: "qa" },
  });
}

type RunRow = { id: string; status: string; stepsJson: string; finalReport: string | null; error: string | null };

async function runRow(id: string): Promise<RunRow | null> {
  const r = await db.automationRun.findUnique({ where: { id } });
  // r553: error joined the row — the badge-contract asserts consume the REAL
  // executor mint, not a fixture copy.
  return r ? { id: r.id, status: r.status, stepsJson: r.stepsJson, finalReport: r.finalReport, error: r.error } : null;
}

try {
  await snapshotState();
  // the direct-drive dial: resolve through the SAME production resolver the
  // claim loop uses (vyce slot → anthropic-dialect /v1/messages dial)
  const dial = resolveServerDialFromSlots([{ provider: PROVIDER, key: "sk-qa-resume-key" }]).dial;
  if (!dial) throw new Error("dial did not resolve — fixture broken");

  // ── fire 1: Beta dead → run errors at step 2, Alpha memoized ──
  await resetFixture(STEPS_V1);
  statusFor.ALPHA = 200; statusFor.BETA = 500; statusFor.GAMMA = 200;
  const wf1 = await db.automationWorkflow.findUnique({ where: { id: WF_ID } });
  if (!wf1) throw new Error("fixture workflow missing");
  const f1 = await executeWorkflow(wf1, dial);
  ok(f1.status === "error", "fire 1: step 2 failure fails the run honestly");
  const f1run = await runRow(f1.runId);
  ok(f1run?.status === "error", "fire 1: run row is error");
  const f1steps = JSON.parse(f1run?.stepsJson ?? "[]") as { label: string; ok: boolean; output: string }[];
  ok(f1steps.length === 2 && f1steps[0]?.ok === true && f1steps[1]?.ok === false, "fire 1: trail = [Alpha ok, Beta failed]");
  const wfAfter1 = await db.automationWorkflow.findUnique({ where: { id: WF_ID } });
  ok(wfAfter1?.failStreak === 1, "fire 1: breaker counts the fire (failStreak 1)");
  const f1RunId = f1.runId;

  // ── fire 2: all lanes healthy → RESUME the same run at step 2 ──
  statusFor.BETA = 200;
  const resumeId2 = await resumableErroredRunId(WF_ID, STEPS_V1);
  ok(resumeId2 === f1RunId, "fire 2: the production resolver serves the errored run for resume");
  const f2 = await executeWorkflow(wf1, dial, resumeId2 ?? undefined);
  ok(f2.status === "done" && f2.runId === f1RunId, "fire 2: the SAME run id resumes and completes (memoized, not a fresh copy)");
  const f2run = await runRow(f2.runId);
  const f2steps = JSON.parse(f2run?.stepsJson ?? "[]") as { label: string; ok: boolean; output: string }[];
  ok(f2steps.length === 3 && f2steps.every((s) => s.ok), "fire 2: trail = 3 ok rows");
  ok(f2steps[0]?.output === "E-OK ALPHA", "fire 2: Alpha output reused byte-identical (memoized, never re-dialed)");
  ok(
    (f2steps[1]?.output ?? "").startsWith("[resumed at this step after the prior fire failed:") &&
      (f2steps[1]?.output ?? "").includes("dial 500"),
    "fire 2: Beta row opens with the resume trail quoting the prior failure",
  );
  ok(!!f2run?.finalReport && f2run.finalReport.includes("## Gamma probe"), "fire 2: final report carries all three sections");
  const wfAfter2 = await db.automationWorkflow.findUnique({ where: { id: WF_ID } });
  ok(wfAfter2?.failStreak === 0, "fire 2: success resets the breaker (failStreak 0)");
  ok(dialLog.filter((p) => p.includes("ALPHA")).length === 1, "fire 2: Alpha was NOT re-dialed (one dial total across fires 1-2)");

  // ── fire 3: Beta dead again, latest run is DONE → honest fresh run ──
  statusFor.BETA = 500;
  const resumeId3 = await resumableErroredRunId(WF_ID, STEPS_V1);
  ok(resumeId3 === null, "fire 3: resolver refuses a DONE latest run (healed pipelines don't resume)");
  const f3 = await executeWorkflow(wf1, dial);
  ok(f3.status === "error" && f3.runId !== f1RunId, "fire 3: fresh run errors (the done run was never resurrected)");
  const f3RunId = f3.runId;

  // ── fire 4: completed-step label renamed → prefix guard trips ──
  const STEPS_V2 = [
    { label: "Alpha renamed", prompt: "Say ALPHA" },
    { label: "Beta probe", prompt: "Say BETA" },
    { label: "Gamma probe", prompt: "Say GAMMA" },
  ];
  await db.automationWorkflow.update({ where: { id: WF_ID }, data: { stepsJson: JSON.stringify(STEPS_V2) } });
  statusFor.BETA = 200;
  const resumeId4 = await resumableErroredRunId(WF_ID, STEPS_V2);
  ok(resumeId4 === null, "fire 4: the prefix guard refuses the stale memo (renamed completed step)");
  // the claim loop re-READS the row at fire time — mirror that here so the
  // run executes the EDITED steps (the stale wf1 object carried old labels;
  // the 17/18 run caught exactly that test-side staleness)
  const wf4 = await db.automationWorkflow.findUnique({ where: { id: WF_ID } });
  if (!wf4) throw new Error("fixture workflow missing");
  const f4 = await executeWorkflow(wf4, dial);
  ok(f4.status === "done" && f4.runId !== f3RunId, "fire 4: edited pipeline runs fresh to done");
  const f4run = await runRow(f4.runId);
  const f4steps = JSON.parse(f4run?.stepsJson ?? "[]") as { label: string; output: string }[];
  ok(
    f4steps[0]?.label === "Alpha renamed" && !(f4steps[0]?.output ?? "").startsWith("[resumed"),
    "fire 4: step 1 re-executed under its new label with NO resume trail",
  );
  const alphaDials = dialLog.filter((p) => p.includes("ALPHA")).length;
  ok(alphaDials === 3, `fire 4: the guard re-dialed Alpha (3 Alpha dials across 4 fires, got ${alphaDials})`);

  // ── r553: cross-layer contract — the "↻ resumes" badge predicate ──
  // The badge (server-autopilot.tsx) and the executor MUST agree on which
  // error strings carry resume semantics. These checks consume the REAL
  // error string fire 1 produced (f1run.error) — not a fixture copy — so a
  // message-format drift on either side fails here before it misleads the
  // Owner's archive view.
  ok(
    f1run?.error != null && isResumableStepFailure(f1run.error),
    `contract: the executor's REAL step-failure message matches the badge predicate (${String(f1run?.error).slice(0, 44)}…)`,
  );
  const plan1 = resumePlanFromError(f1run?.error ?? null);
  ok(
    plan1?.step === 2 && plan1.total === 3 && plan1.label === "Beta probe",
    "contract: the resume plan parses step/total/label out of the real message (2/3 \"Beta probe\")",
  );
  const waitShaped = 'step 1/2 "Hold" timed out waiting for event "go" (90s budget)';
  ok(
    isResumableStepFailure(waitShaped) && resumePlanFromError(waitShaped)?.label === "Hold",
    "contract: the wait-timeout failure shape also carries resume semantics",
  );
  ok(
    !isResumableStepFailure("dial resolve failed: no resolvable slot") &&
      !isResumableStepFailure(null) &&
      !isResumableStepFailure('step x/y "junk"'),
    "contract: non-step failures (dial resolve, null, malformed) never render as resumable",
  );

  // ── r555: drawer-note drift guard (source-level) ──
  // The amber drawer note must speak the SAME parsed plan as the badge
  // tooltip (r553) — interpolated step/total/label from the executor's real
  // message — while keeping the generic fallback for unexpected shapes.
  // Static-source checks: the drawer template in server-autopilot.tsx is
  // UI-only (unimportable from a serverless QA), but its drift would be the
  // same Owner-facing lie the r553 badge contract guards against.
  const autopilotSrc = readFileSync(
    new URL("../src/components/nexus/workflows/server-autopilot.tsx", import.meta.url),
    "utf8",
  );
  const drawerIdx = autopilotSrc.indexOf("↻ Resumable");
  const drawerRegion = drawerIdx >= 0 ? autopilotSrc.slice(drawerIdx, drawerIdx + 500) : "";
  ok(
    drawerRegion.includes("resumePlan") &&
      drawerRegion.includes('re-enters at step ${resumePlan.step}/${resumePlan.total}'),
    "contract: the run-drawer note interpolates the parsed resume plan (step/total/label)",
  );
  ok(
    drawerRegion.includes("the next scheduled fire re-enters at the failed step"),
    "contract: the drawer's generic fallback survives for unexpected shapes",
  );
  ok(
    drawerRegion.includes("failStreak now {wfFailStreak}") &&
      drawerRegion.includes("every fire counts, resumed or not"),
    "contract: the drawer's failStreak parenthetical interpolates the CURRENT registry count (r559)",
  );

  // ── r557: schedule-row drift guard (source-level) ──
  // The ARMED SCHEDULE rows must speak the same parsed plan (TASK-101): the
  // join must mirror the executor's LATEST-schedule-run rule (trigger filter
  // + first-hit-wins over the newest-first runs array) and re-use the badge
  // predicate, and the row must interpolate step/total while keeping the
  // generic fallback. A wording or join drift fails here, not the Owner's eyes.
  const joinIdx = autopilotSrc.indexOf("const resumeByWf");
  const joinRegion = joinIdx >= 0 ? autopilotSrc.slice(joinIdx, joinIdx + 400) : "";
  ok(
    joinRegion.includes('run.trigger !== "schedule"') &&
      joinRegion.includes("hasMemoizedTrail(run.stepsJson)") &&
      joinRegion.includes("if (!resumable) continue;"),
    "contract: the join picks the workflow's LATEST schedule-trigger run, demands the memoized prefix, and stays SILENT (no chip) on a step-1 death",
  );
  const schedRowIdx = autopilotSrc.indexOf("data-testid={`schedule-resume-");
  // r558: the className grew (hover/focus polish) — widen the window so the
  // interpolated template still lands inside it.
  const schedRowRegion = schedRowIdx >= 0 ? autopilotSrc.slice(schedRowIdx, schedRowIdx + 700) : "";
  ok(
    schedRowRegion.includes("title={planTitle}") &&
      schedRowRegion.includes("at step ${plan.step}/${plan.total}") &&
      schedRowRegion.includes("at the failed step"),
    "contract: the schedule row carries the plan tooltip, interpolates step/total, keeps the generic fallback",
  );

  // ── r557: the memoized-prefix honesty guard ──
  // A step-1 death leaves NO memoized prefix — the executor runs FRESH — so
  // neither the schedule-row chip nor the archive badge may claim a resume.
  // The claims now demand hasMemoizedTrail; these checks consume the REAL
  // fire-1 trail (Alpha landed, Beta died ⇒ prefix EXISTS) against the
  // all-fail shape (first step died ⇒ prefix ABSENT ⇒ fresh run).
  ok(
    f1run?.stepsJson != null &&
      hasMemoizedTrail(f1run.stepsJson) &&
      !hasMemoizedTrail('[{"label":"Solo probe","ok":false,"output":"dial 500"}]') &&
      !hasMemoizedTrail("not json") &&
      !hasMemoizedTrail(null),
    "contract: hasMemoizedTrail is true for the real fire-1 trail, false for a step-1 death / corrupt / null",
  );
  const joinWire = (autopilotSrc.match(/hasMemoizedTrail\(run\.stepsJson\)/g) ?? []).length;
  const badgeWire = (autopilotSrc.match(/hasMemoizedTrail\(r\.stepsJson\)/g) ?? []).length;
  ok(
    joinWire >= 1 && badgeWire >= 1,
    `contract: BOTH resume claims (schedule-row join + archive badge) demand the memoized prefix (join ${joinWire}, badge ${badgeWire})`,
  );

  // ── r558: one existence definition + chip-to-drawer affordance ──
  const executorSrc = readFileSync(
    new URL("../src/lib/server/automation-executor.ts", import.meta.url),
    "utf8",
  );
  ok(
    executorSrc.includes("hasMemoizedTrail(latest.stepsJson)"),
    "contract: the executor's resume resolver gates existence through the SAME shared helper the UI renders through",
  );
  const chipIdx = autopilotSrc.indexOf("data-testid={`schedule-resume-");
  // the <button tag sits just before the testid; the planTitle literal lives
  // up in the map block (~750 chars up) — check it file-wide instead.
  const chipRegion = chipIdx >= 0 ? autopilotSrc.slice(Math.max(0, chipIdx - 200), chipIdx + 420) : "";
  ok(
    chipRegion.includes("<button") &&
      chipRegion.includes("setOpenRun(hit.runId)") &&
      autopilotSrc.includes("click to open this run's trail"),
    "contract: the schedule chip is a button that opens the run's drawer, and the title says so",
  );

  // ── r560: the paste-plan dialog's live char count ──
  // Long pastes (8k+ chars are the realistic Owner case — r549's 27,829-char
  // closure, r559's 8,011-char re-verification) now show their scale live.
  const planSrc = readFileSync(
    new URL("../src/components/nexus/workflows/workflows-view.tsx", import.meta.url),
    "utf8",
  );
  const badgeIdx = planSrc.indexOf('data-testid="plan-char-count"');
  // r560: the badge's long base-className string pushes toLocaleString past a
  // 420 window — widen to 560 (fix the window, not the product; r558 lesson).
  const badgeRegion = badgeIdx >= 0 ? planSrc.slice(badgeIdx, badgeIdx + 560) : "";
  ok(
    badgeRegion.includes("planText.length.toLocaleString()") &&
      badgeRegion.includes("planText.length >= 4000") &&
      planSrc.includes('id="plan-text"'),
    "contract: the paste-plan textarea carries a live char-count badge (toLocaleString'd, amber at the 4k long-paste threshold) wired to the planText state",
  );

  // ── r563: the rotation preview speaks create()'s mapping ──
  ok(
    planSrc.includes("detected — mapped to agents in order") &&
      planSrc.includes("{rotationEcho}") &&
      planSrc.includes("Math.min(stepLines.length, 3)") &&
      planSrc.includes("selected[i % selected.length]") &&
      planSrc.includes("{i + 1}"),
    "contract: the paste-plan rotation preview names the agents WITH their step indices ({i + 1} spans) and mirrors create()'s round-robin (min(steps, 3) names, ellipsis when more)",
  );

  // ── r569: the 8-step cap is honest ──
  ok(
    planSrc.includes('data-testid="plan-step-cap"') &&
      planSrc.includes("8-step cap") &&
      planSrc.includes("Math.max(0, cleaned.length - 8)"),
    "contract: the 8-step cap warns — parsePlan counts the overflow and the dialog shows an amber cap note instead of silently dropping the plan tail",
  );
  // r570: the GOAL line gets the same prefix hygiene as steps, and the dialog
  // previews the cleaned name before Create.
  ok(
    planSrc.includes('data-testid="plan-goal-preview"') &&
      planSrc.includes("r570: the goal gets the same prefix hygiene"),
    "contract: pasted GOAL lines get the step-prefix strip and the dialog previews the cleaned workflow name (plan-goal-preview)",
  );
  // r571: the Evolution spawn path reads the overflow too — no silent tail
  // loss outside the paste dialog.
  ok(
    planSrc.includes("8-step cap dropped") &&
      planSrc.includes("const overflow = parsed.overflow;") &&
      planSrc.includes("${capNote}"),
    "contract: the Evolution spawn accept reads parsed.overflow — a proposal past the 8-step cap warns in the toast (8-step cap dropped …) and carries the capNote in the card description instead of losing its tail silently",
  );
  // r572: the history rows surface the plan size at a glance, amber past the cap.
  ok(
    planSrc.includes('data-testid="proposal-plan-size"') &&
      planSrc.includes("(p.planLines?.length ?? 0) > 8"),
    "contract: Evolution history rows render a census-grammar plan-size chip (proposal-plan-size) that turns amber when the proposal's planLines exceed the 8-step cap",
  );
  // r573: the empty inbox explains itself instead of rendering blank space.
  ok(
    planSrc.includes('data-testid="evo-inbox-empty"') &&
      planSrc.includes("No open proposals"),
    "contract: the Evolution Inbox renders a dashed census-family empty line (evo-inbox-empty) when no proposals are open, pointing at Suggest variation and history",
  );

  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail > 0) process.exit(1);
} catch (err) {
  console.error("QA crashed:", err);
  process.exit(1);
} finally {
  await restoreState();
}
