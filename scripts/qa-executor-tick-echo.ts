// r377 QA — the executor loop wiring records what each 15s tick decided.
// Boots the REAL startAutomationExecutor() (the same call instrumentation.ts
// makes at server boot) against the real database and asserts the tick echo
// appears after one interval, with an honest reason.
//
// DIAL SAFETY: the script REFUSES to run when any vault slot carries a key,
// so the live loop it arms can never spend a real credential on a claim.
//
// Runtime: one tick = 15s; the script waits at most ~17s for the echo, then
// exits explicitly (the interval would otherwise hold the event loop open).

import {
  peekLastExecutorTick,
  startAutomationExecutor,
} from "../src/lib/server/automation-executor";
import { db } from "../src/lib/db";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  ✓" : "  ✗"} ${m}`);
  if (c) pass++; else fail++;
};

async function main(): Promise<void> {
  console.log("r377 — executor tick echo QA");

  const slots = await db.automationVault.findMany();
  if (slots.some((s) => s.key.trim().length > 0)) {
    console.log("  ⚠ vault carries a key — skipping the live-loop run (no real dials from QA)");
    console.log("RESULT: pass=0 fail=0 (skipped)");
    return;
  }

  ok(peekLastExecutorTick() === null, "echo starts null before any tick");

  startAutomationExecutor();
  startAutomationExecutor(); // singleton guard: second call must be a no-op

  const deadline = Date.now() + 17_000;
  let echo = peekLastExecutorTick();
  while (echo === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    echo = peekLastExecutorTick();
  }
  ok(echo !== null, "echo recorded after one 15s tick");
  if (echo) {
    const age = Date.now() - new Date(echo.at).getTime();
    ok(age >= 0 && age < 20_000, `echo.at is fresh (${Math.round(age / 1000)}s old)`);
    ok(echo.error === null, "tick completed without error (db reachable)");
    ok(
      echo.claimed > 0 ||
        ["client-alive", "no-vault-key", "no-resolvable-provider", "idle"].includes(echo.reason ?? ""),
      `reason honest (${echo.reason ?? `claimed ${echo.claimed}`})`,
    );
    // No vault key existed at start → the BYOK gate must have held.
    ok(echo.claimed === 0, "no claim without a vault key");
  }

  console.log(`RESULT: pass=${pass} fail=${fail}`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("QA crashed:", e);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
