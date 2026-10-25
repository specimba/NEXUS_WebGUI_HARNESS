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
        // TASK-101 (r520): the durable-step resume contract. A mid-run death
        // cannot resume the interrupted step in-process, but the WORK is not
        // lost: nextRunAt only advances at completion, so it is still in the
        // past — the claim loop naturally re-fires the schedule on the next
        // tick after boot. The error text now says that out loud.
        error:
          "interrupted by a server restart — the run cannot resume mid-step; the schedule re-fires automatically on the next claim tick (durable-step semantics)",
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
    // r526: rehydrated slots go straight to at-rest ciphertext (the migration
    // below would re-encrypt any plaintext on the next boot — belt and braces).
    const { encryptVaultKey } = await import("@/lib/server/vault-crypto");
    // r519 — edge-bundler silence: the node builtins below are loaded through
    // runtime-constructed importers. register() already stands down outside
    // the nodejs runtime, so runtime behavior is unchanged — but the Edge
    // bundle (which statically analyzes literal `import("node:…")` specifiers
    // and `process.cwd` reads) can no longer see them. This kills the
    // per-recompile "not supported in the Edge Runtime" warning spam that
    // polluted dev.log after every recompile (r515 regression, queued r518).
    const nodeImport = new Function("s", "return import(s)") as (
      s: string
    ) => Promise<{
      readFile: (p: string, enc: string) => Promise<string>;
      join: (...parts: string[]) => string;
    }>;
    const nodeCwd = new Function("return process.cwd()") as () => string;
    const fs = await nodeImport("node:fs/promises");
    const path = await nodeImport("node:path");
    const readFile = (p: string) => fs.readFile(p, "utf8");
    const seedPath = path.join(nodeCwd(), "db", "vault-seed.json");
    const seed = JSON.parse(await readFile(seedPath)) as {
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
        const stored = await encryptVaultKey(key);
        await bootDb.automationVault.upsert({
          where: { provider },
          create: { provider, key: stored, label },
          update: { key: stored, label },
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
  // r526 — TASK-102 slice 3: one-time at-rest migration. Any vault row still
  // holding legacy plaintext (r138 trust model) is re-encrypted with
  // AES-256-GCM here; rows already carrying the enc:v1: prefix are untouched,
  // so the pass is idempotent and free on every later boot.
  try {
    const { db: migDb } = await import("@/lib/db");
    const { encryptVaultKey, isEncryptedVaultKey, vaultKeySource } = await import(
      "@/lib/server/vault-crypto"
    );
    const rows = await migDb.automationVault.findMany();
    let n = 0;
    for (const r of rows) {
      const k = r.key.trim();
      if (!k || isEncryptedVaultKey(k)) continue;
      await migDb.automationVault.update({
        where: { id: r.id },
        data: { key: await encryptVaultKey(k) },
      });
      n += 1;
    }
    if (n > 0) {
      console.info(
        `[boot] vault at-rest migration: encrypted ${n} slot(s) with AES-256-GCM (master key: ${
          vaultKeySource() === "env" ? "NEXUS_VAULT_MASTER_KEY env" : "machine file db/vault-master.key"
        })`
      );
    }
  } catch (err) {
    // Never block boot — the legacy plaintext read path keeps the lane alive
    // and the next boot retries the migration.
    console.warn(
      "[boot] vault at-rest migration skipped:",
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
  // r515 — Autonomous Improvement Engine (AIE): the owner's answer to the
  // 7×-purged external cron patrol — the platform itself carries autonomy.
  // Deterministic + vault-free (zero provider keys, closed tab) 10-minute
  // cycle over first-party signals: propose ranked next moves, execute the
  // SAFE ones (GitHub research on the unauthenticated budget), log honestly.
  // Boot pattern mirrors startCapabilityRadar: globalThis guard, +15s first
  // pass, unref'd interval, never throws.
  const { startAutonomyEngine } = await import("@/lib/server/autonomy");
  startAutonomyEngine();
}
