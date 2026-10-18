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
  // r493 — vault rehydration: the vault is the ONLY thing the closed-tab lane
  // needs, and a sandbox/DB reset silently emptied it while the registry rows
  // survived — the exact loop the owner called nonsensical ("store the same
  // keys every time"). db/vault-seed.json (localhost-only file, same plaintext
  // trust model as the vault's own SQLite) rehydrates an EMPTY vault at boot.
  // Deliberate deletions stay respected: rehydration fires only when the
  // table has ZERO slots.
  try {
    const { db: bootDb } = await import("@/lib/db");
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const seedPath = path.join(process.cwd(), "db", "vault-seed.json");
    const seed = JSON.parse(await readFile(seedPath, "utf8")) as {
      slots?: { provider?: unknown; key?: unknown; label?: unknown }[];
    };
    const slots = Array.isArray(seed?.slots) ? seed.slots : [];
    if (slots.length > 0 && (await bootDb.automationVault.count()) === 0) {
      let n = 0;
      for (const s of slots) {
        const provider = typeof s?.provider === "string" ? s.provider.trim() : "";
        const key = typeof s?.key === "string" ? s.key.trim() : "";
        if (!provider || !key) continue;
        const label =
          typeof s.label === "string" && s.label.trim() ? s.label.trim() : null;
        await bootDb.automationVault.upsert({
          where: { provider },
          create: { provider, key, label },
          update: { key, label },
        });
        n += 1;
      }
      console.info(
        `[boot] vault rehydrated ${n} slot(s) from db/vault-seed.json — the closed-tab lane can dial again`
      );
    }
  } catch (err) {
    // No seed file (fresh clone) or first-boot schema race — never block the
    // executor; the next boot re-checks.
    console.warn(
      "[boot] vault rehydration skipped:",
      err instanceof Error ? err.message : err
    );
  }
  const { startAutomationExecutor } = await import("@/lib/server/automation-executor");
  startAutomationExecutor();
  // r497 — Capability Radar: the owner's "cron automation for every 1-hour
  // check". Deterministic + vault-free (it must fire when nothing else can),
  // so it runs regardless of the tab heartbeat — one idempotent digest per
  // UTC hour bucket over the platform's own intelligence tables.
  const { startCapabilityRadar } = await import("@/lib/server/capability-radar");
  startCapabilityRadar();
}
