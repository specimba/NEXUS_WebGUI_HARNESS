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
// r791 addendum 3 — THE THRESHOLD DOCTRINE (measured live): the warm-boot
// steady state of this Next 16 Turbopack dev server is 1.87-1.93 GB RSS
// (pid 17131, measured one minute after the 22:56 UTC boot; the .next warm
// cache loads more per boot than it did when the historical ~1.4-1.5 GB boot
// baseline was recorded). An RSS-only threshold at the old 1.74 GB mark would
// fire on every check and LOOP restarts. The honest kill signal is PRESSURE,
// not absolute RSS — the historical kernel kills (rss 1.82/1.71/1.56 GB at
// death) fired under box pressure while the box now sits HEALTHY at 1.87 GB
// with MemAvailable ~1.5 GB. So: PRIMARY tripwire = MemAvailable from
// /proc/meminfo below MEM_GUARD_AVAIL_KB (default 600,000 KB — enough runway
// for the restart's own compile burst); SECONDARY = RSS above MEM_GUARD_KB
// (default 2,150,000 KB — the ~2.1 GB hover zone that historically preceded
// the kills). A 2.0 GB milestone line records the hover entry for the OOM
// curve without firing.
//
// WHAT IT DOES on a breach: spawns scripts/dev-restart.sh DETACHED (reparented
// to init, it survives the pkill that kills this process; the fresh server
// re-arms the guard at boot). 300s cooldown so a compile-slow boot can never
// loop it. The dead-server REVIVE half stays with the patrol rounds — a dead
// process cannot revive itself.
//
// Log: scripts/mem-guard.log (best-effort appendFileSync; the restart never
// depends on the log succeeding).

import { appendFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const RSS_THRESHOLD_KB = Number(process.env.MEM_GUARD_KB ?? 2_150_000);
const AVAIL_THRESHOLD_KB = Number(process.env.MEM_GUARD_AVAIL_KB ?? 600_000);
const RSS_MILESTONE_KB = 2_000_000;
const CHECK_MS = 120_000;
const COOLDOWN_MS = 300_000;

function memAvailableKb(): number {
  try {
    const m = /^MemAvailable:\s+(\d+)\s+kB/m.exec(
      readFileSync("/proc/meminfo", "utf8"),
    );
    return m ? Number(m[1]) : -1;
  } catch {
    return -1; // non-Linux / unreadable — the RSS tripwire still stands
  }
}

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
  let milestoneLogged = false;
  const timer = setInterval(() => {
    const rssKb = Math.round(process.memoryUsage().rss / 1024);
    const availKb = memAvailableKb();
    if (!milestoneLogged && rssKb > RSS_MILESTONE_KB) {
      milestoneLogged = true;
      log(
        `RSS milestone: ${rssKb} KB crossed 2.0 GB${
          availKb >= 0 ? ` (MemAvailable ${availKb} KB)` : ""
        } — the historical hover zone entered; the pressure tripwire is the active guard below`,
      );
    }
    const rssBreach = rssKb > RSS_THRESHOLD_KB;
    const availBreach = availKb >= 0 && availKb < AVAIL_THRESHOLD_KB;
    if (!rssBreach && !availBreach) return;
    if (Date.now() - lastRestart < COOLDOWN_MS) return;
    lastRestart = Date.now();
    log(
      `${
        rssBreach
          ? `RSS ${rssKb} KB > ${RSS_THRESHOLD_KB} KB`
          : `MemAvailable ${availKb} KB < ${AVAIL_THRESHOLD_KB} KB`
      } — GRACEFUL RESTART (pre-OOM, in-process guard, pid ${process.pid}, rss ${rssKb} KB${
        availKb >= 0 ? ` / avail ${availKb} KB` : ""
      })`,
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
    `mem-guard (in-process) armed: pid ${process.pid}, rss threshold ${RSS_THRESHOLD_KB} KB, avail threshold ${AVAIL_THRESHOLD_KB} KB, check ${
      CHECK_MS / 1000
    }s, cooldown ${COOLDOWN_MS / 1000}s`,
  );
}
