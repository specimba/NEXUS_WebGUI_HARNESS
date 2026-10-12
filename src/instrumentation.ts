// r204 — Next.js instrumentation hook (Local Automation Vault epic).
// Boots the server-side claim loop exactly once per server process: when the
// open tab's heartbeat goes stale (>120s), due AutomationWorkflow rows are
// claimed and executed through the opt-in local vault key (BYOK preserved —
// see src/lib/server/automation-executor.ts for the full contract).
//
// While the tab is open the loop stands down entirely; the client scheduler
// keeps driving with keys that never leave the browser.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // r451: reconcile server-lane zombie runs BEFORE the claim loop starts.
  // The executor runs pipelines in-process and resolves every run to
  // done/error itself — so no "running" row can legitimately survive a
  // process restart. A restart mid-run (the sandbox reaps the dev server
  // routinely) used to strand the row forever: the kanban's Working column
  // then claimed "runs streaming right now" eternally and the run drawer
  // showed a live run that could never finish. This is the DB counterpart
  // of the r25 local-store zombie sweep — same class, stricter provability:
  // at boot there is no live process at all.
  try {
    const { db } = await import("@/lib/db");
    const swept = await db.automationRun.updateMany({
      where: { status: "running" },
      data: {
        status: "error",
        error: "interrupted by a server restart — the run cannot resume",
        finishedAt: new Date(),
      },
    });
    if (swept.count > 0) {
      console.info(
        `[boot] reconciled ${swept.count} automation run(s) left "running" by a previous process`
      );
    }
  } catch (err) {
    // First boot may race the schema migration; a failed sweep must never
    // block the claim loop — the next boot sweeps again.
    console.warn(
      "[boot] zombie-run sweep skipped:",
      err instanceof Error ? err.message : err
    );
  }
  const { startAutomationExecutor } = await import("@/lib/server/automation-executor");
  startAutomationExecutor();
}
