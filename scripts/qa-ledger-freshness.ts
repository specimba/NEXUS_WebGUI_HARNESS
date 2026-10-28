/**
 * r689 — qa-ledger-freshness: freezes the corpus-freshness contract that
 * the ⧉ ledger chip's age token renders (r684 logic, r689 lifted to
 * src/lib/ledger-freshness.ts — one contract, one home, the r677
 * family-witness precedent).
 *   1. ledgerAgeOf — bucket edges (<60s "now", <1h "Nm", <48h "Nh", else
 *      "Nd"), clock skew clamps to "now", junk is an honest null (never a
 *      fake "now").
 *   2. ledgerAgeIsStale — a corpus quiet >= 1h reads stale (the token
 *      turns amber on the board); missing/unreadable is never an alarm.
 *   3. Source contract — run-kanban.tsx imports the lib helper and does
 *      not carry an inline copy (the r677 "one home" rule, enforced).
 * Run: bun scripts/qa-ledger-freshness.ts
 */
import { readFileSync } from "node:fs";
import { ledgerAgeIsStale, ledgerAgeOf } from "../src/lib/ledger-freshness";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
const secsAgo = (s: number): string => new Date(Date.now() - s * 1000).toISOString();

// ─── 1. ledgerAgeOf buckets (edges pinned) ────────────────────────────────────
check("0s → now", ledgerAgeOf(secsAgo(0)), "now");
check("59s → now (edge)", ledgerAgeOf(secsAgo(59)), "now");
check("60s → 1m (edge)", ledgerAgeOf(secsAgo(60)), "1m");
check("3599s → 59m (edge)", ledgerAgeOf(secsAgo(3_599)), "59m");
check("3600s → 1h (edge)", ledgerAgeOf(secsAgo(3_600)), "1h");
check("172799s → 47h (edge)", ledgerAgeOf(secsAgo(172_799)), "47h");
check("172800s → 2d (edge)", ledgerAgeOf(secsAgo(172_800)), "2d");
check("7d → 7d", ledgerAgeOf(secsAgo(7 * 86_400)), "7d");

// ─── 2. defensive parse: junk is honest absence ───────────────────────────────
check("undefined → null", ledgerAgeOf(undefined), null);
check("null → null", ledgerAgeOf(null), null);
check("empty string → null", ledgerAgeOf(""), null);
check("garbage → null", ledgerAgeOf("not-a-timestamp"), null);
check("invalid calendar date → null", ledgerAgeOf("2026-13-99T99:99:99Z"), null);

// ─── 3. clock skew clamps to "now", never negative ────────────────────────────
check("10min in the future → now (skew clamp)", ledgerAgeOf(new Date(Date.now() + 600_000).toISOString()), "now");

// ─── 4. ledgerAgeIsStale (the r689 amber threshold) ───────────────────────────
check("59min → not stale (edge)", ledgerAgeIsStale(secsAgo(3_599)), false);
check("60min → stale (edge)", ledgerAgeIsStale(secsAgo(3_600)), true);
check("1d → stale", ledgerAgeIsStale(secsAgo(86_400)), true);
check("future timestamp → never stale", ledgerAgeIsStale(new Date(Date.now() + 600_000).toISOString()), false);
check("missing timestamp → never an alarm", ledgerAgeIsStale(null), false);
check("junk timestamp → never an alarm", ledgerAgeIsStale("garbage"), false);

// ─── 5. source contract: one home, no inline copy ─────────────────────────────
const kanban = readFileSync("src/components/nexus/workflows/run-kanban.tsx", "utf8");
check("run-kanban imports the freshness home", /from "@\/lib\/ledger-freshness"/.test(kanban), true);
check("run-kanban carries no inline ledgerAgeOf copy", /const ledgerAgeOf = /.test(kanban), false);

console.log(`\nqa-ledger-freshness: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
