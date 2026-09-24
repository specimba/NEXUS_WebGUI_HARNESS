/**
 * r42 unit tests — suite-schedule hygiene math (pure, no DOM).
 * Run: bun scripts/test-suite-schedule.ts
 */
import { sanitizeSuiteSchedule } from "../src/lib/suite-schedule";
import { SUITE_REPEATS_MAX, SUITE_SCHEDULE_MIN_MS } from "../src/lib/constants";
import type { SuiteSchedule } from "../src/lib/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

const HEALTHY: SuiteSchedule = {
  enabled: true,
  intervalMs: 6 * 60 * 60_000,
  repeats: 1,
  nextRunAt: 2_000_000_000_000,
  lastRunAt: 1_999_000_000_000,
};

console.log("passthrough:");
{
  const r = sanitizeSuiteSchedule(HEALTHY);
  check("healthy schedule → report", r !== null);
  check("healthy schedule unchanged", r!.changed === false);
  check("not quarantined", r!.quarantined === false);
  check("no notes", r!.notes.length === 0);
  check("enabled preserved", r!.schedule.enabled === true);
  check("nextRunAt preserved", r!.schedule.nextRunAt === HEALTHY.nextRunAt);
  check("lastWinners absent preserved", r!.schedule.lastWinners === undefined);
}
{
  const r = sanitizeSuiteSchedule(undefined);
  check("undefined → null", r === null);
}

console.log("NaN / corruption repair:");
{
  const r = sanitizeSuiteSchedule({ ...HEALTHY, intervalMs: NaN });
  check("NaN intervalMs changed", r!.changed === true);
  check("NaN intervalMs clamped to floor", r!.schedule.intervalMs === SUITE_SCHEDULE_MIN_MS);
  check("notes mention interval", r!.notes.some((n) => n.includes("intervalMs")));
}
{
  const r = sanitizeSuiteSchedule({ ...HEALTHY, nextRunAt: NaN });
  check("NaN nextRunAt reset to undefined (fires next tick)", r!.schedule.nextRunAt === undefined);
  check("still enabled (repairable, not garbage)", r!.quarantined === false);
}
{
  const r = sanitizeSuiteSchedule({ ...HEALTHY, nextRunAt: Infinity });
  check("Infinity nextRunAt reset", r!.schedule.nextRunAt === undefined);
}
{
  const r = sanitizeSuiteSchedule({ ...HEALTHY, intervalMs: 60_000 });
  check("sub-floor interval clamped", r!.schedule.intervalMs === SUITE_SCHEDULE_MIN_MS);
  check("clamp noted", r!.notes.some((n) => n.includes("clamped")));
  check("not quarantined for a clamp", r!.quarantined === false);
}

console.log("quarantine (garbage beyond repair):");
{
  const r = sanitizeSuiteSchedule({ ...HEALTHY, intervalMs: "six hours" as unknown as number });
  check("non-number intervalMs quarantined", r!.quarantined === true);
  check("quarantine disarms", r!.schedule.enabled === false);
  check("interval falls back to floor", r!.schedule.intervalMs === SUITE_SCHEDULE_MIN_MS);
}
{
  const r = sanitizeSuiteSchedule({ ...HEALTHY, enabled: "yes" as unknown as boolean });
  check("truthy garbage enabled fails closed", r!.schedule.enabled === false && r!.quarantined === true);
}
{
  const r = sanitizeSuiteSchedule({ ...HEALTHY, enabled: false });
  check("explicit false stays false, NOT quarantined", r!.schedule.enabled === false && r!.quarantined === false && r!.changed === false);
}

console.log("field clamps:");
{
  const r = sanitizeSuiteSchedule({ ...HEALTHY, repeats: 99 });
  check("repeats clamped to max", r!.schedule.repeats === SUITE_REPEATS_MAX);
  const r2 = sanitizeSuiteSchedule({ ...HEALTHY, repeats: -3 });
  check("negative repeats → 1", r2!.schedule.repeats === 1);
  const r3 = sanitizeSuiteSchedule({ ...HEALTHY, repeats: 2.7 });
  check("fractional repeats rounded", r3!.schedule.repeats === 3);
}
{
  const r = sanitizeSuiteSchedule({ ...HEALTHY, failStreak: -2 });
  check("negative failStreak repaired to 0", r!.schedule.failStreak === 0);
  const r2 = sanitizeSuiteSchedule({ ...HEALTHY, failStreak: NaN as unknown as number });
  check("NaN failStreak repaired to 0", r2!.schedule.failStreak === 0);
  const r3 = sanitizeSuiteSchedule({ ...HEALTHY, failStreak: 2 });
  check("valid failStreak kept", r3!.schedule.failStreak === 2 && r3!.changed === false);
}

console.log("lastWinners / autoAdopt shape:");
{
  const r = sanitizeSuiteSchedule({ ...HEALTHY, lastWinners: { wf1: "deep-research", wf2: "fast" } });
  check("valid lastWinners kept", JSON.stringify(r!.schedule.lastWinners) === '{"wf1":"deep-research","wf2":"fast"}');
  const r2 = sanitizeSuiteSchedule({ ...HEALTHY, lastWinners: "nope" as unknown as Record<string, string> });
  check("non-record lastWinners dropped", r2!.schedule.lastWinners === undefined);
  const r3 = sanitizeSuiteSchedule({ ...HEALTHY, lastWinners: { wf1: 42, wf2: "fast" } as unknown as Record<string, string> });
  check("non-string winner values filtered", JSON.stringify(r3!.schedule.lastWinners) === '{"wf2":"fast"}');
  const r4 = sanitizeSuiteSchedule({ ...HEALTHY, autoAdopt: 1 as unknown as boolean });
  check("non-boolean autoAdopt dropped", r4!.schedule.autoAdopt === undefined);
  const r5 = sanitizeSuiteSchedule({ ...HEALTHY, autoAdopt: true });
  check("boolean autoAdopt kept", r5!.schedule.autoAdopt === true && r5!.changed === false);
}

console.log("non-mutation + idempotence:");
{
  const input: SuiteSchedule = { ...HEALTHY, intervalMs: NaN, repeats: 99, lastWinners: { a: "b" } };
  const snapshot = JSON.stringify(input);
  const first = sanitizeSuiteSchedule(input)!;
  check("input not mutated", JSON.stringify(input) === snapshot);
  const second = sanitizeSuiteSchedule(first.schedule)!;
  check("sanitized output is idempotent", second.changed === false && second.quarantined === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
