// r791 — in-process pre-OOM watchdog (THE OWNER FREEZE-WATCH, server half).
//
// WHY IN-PROCESS: the sandbox reaper kills every tool-call-launched daemon at
// the tool-call boundary — three witnessed mem-guard.sh deaths in one round
// (pids 16641 / 16788 / 16925, the last with the full "proven" dev-restart
// recipe: setsid + nohup + exec wrapper + disown; it died inside its initial
// sleep). The dev server itself survives because the platform supervises it,
// not because of any launch recipe. So this guard lives where lifetime is
// already guaranteed — inside the next-server process, the same boot pattern
// as startAutomationExecutor / startCapabilityRadar / startAutonomyEngine:
// globalThis guard, unref'd interval, never throws.
//
// WHAT IT DOES: every 120s read process.memoryUsage().rss; past the threshold
// (MEM_GUARD_KB env, default 1,740,000 KB ≈ 1.70 GB — under every witnessed
// OOM-kill mark: 1.82 / 1.71 / 1.56 GB) it spawns scripts/dev-restart.sh
// DETACHED (reparented to init, it survives the pkill that kills this
// process; the fresh server re-arms the guard at boot). 300s cooldown so a
// compile-slow boot can never loop it. The dead-server REVIVE half stays with
// the patrol rounds — a dead process cannot revive itself.
//
// Log: scripts/mem-guard.log (best-effort appendFileSync; the restart never
// depends on the log succeeding).

import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const THRESHOLD_KB = Number(process.env.MEM_GUARD_KB ?? 1_740_000);
const CHECK_MS = 120_000;
const COOLDOWN_MS = 300_000;

export function startMemGuard(): void {
  const g = globalThis as typeof globalThis & { __memGuardArmed?: boolean };
  if (g.__memGuardArmed) return;
  g.__memGuardArmed = true;

  const log = (m: string): void => {
    try {
      appendFileSync("scripts/mem-guard.log", `[${new Date().toISOString()}] ${m}\n`);
    } catch {
      // best-effort only — the restart decision never depends on the log
    }
  };

  let lastRestart = 0;
  const timer = setInterval(() => {
    const rssKb = Math.round(process.memoryUsage().rss / 1024);
    if (rssKb <= THRESHOLD_KB) return;
    if (Date.now() - lastRestart < COOLDOWN_MS) return;
    lastRestart = Date.now();
    log(
      `RSS ${rssKb} KB > ${THRESHOLD_KB} KB — GRACEFUL RESTART (pre-OOM, in-process guard, pid ${process.pid})`,
    );
    try {
      // detached + stdio ignore + unref: the restart script is reparented to
      // init and survives the pkill inside dev-restart.sh that ends THIS
      // process — the fresh server re-arms the guard via instrumentation.
      spawn("bash", ["scripts/dev-restart.sh"], {
        detached: true,
        stdio: "ignore",
        cwd: process.cwd(),
      }).unref();
    } catch (err) {
      log(`restart spawn failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, CHECK_MS);
  timer.unref();
  log(
    `mem-guard (in-process) armed: pid ${process.pid}, threshold ${THRESHOLD_KB} KB, check ${CHECK_MS / 1000}s, cooldown ${COOLDOWN_MS / 1000}s`,
  );
}
