/**
 * r670: fixture for the gate-census adapter (dial-free, house qa doctrine).
 * Pins the r669 two-family verdict counting AND the r670 last-verdict-wins
 * verdictLine + verdictTone semantics (a FAIL verdict must never read green).
 */
import { gateCensusOf } from "../src/lib/gate-census";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.log("FAIL: " + name);
  }
}

// 1-2. tolerant empties
const empty = gateCensusOf([]);
check("empty: engaged 0", empty.engaged === 0);
check("empty: no verdictLine", empty.verdictLine === undefined);
const nul = gateCensusOf(null);
check("null: engaged 0", nul.engaged === 0 && nul.verdicts === 0);

// 3. deep-pass family alone
const sysFail = gateCensusOf([{ note: "System-One gate FAIL 95% — rework → full verification pass runs" }]);
check("system-one fail: verdicts 1", sysFail.verdicts === 1);
check("system-one fail: line FAIL 95%", sysFail.verdictLine === "FAIL 95%");
check("system-one fail: tone fail", sysFail.verdictTone === "fail");

// 4. fast-model family alone
const fastPass = gateCensusOf([{ note: "Decision gate PASS 95% (fast-model) — output accepted" }]);
check("fast-model pass: verdicts 1", fastPass.verdicts === 1);
check("fast-model pass: line PASS 95%", fastPass.verdictLine === "PASS 95%");
check("fast-model pass: tone pass", fastPass.verdictTone === "pass");

// 5-6. no-judge stays engagement-only, even with outcome-shaped text inside
const noJudge = gateCensusOf([
  { note: "Decision gate engaged but no judge answered (tried: intern-systemone — not armed; fast-judge A…)" },
]);
check("no-judge: engaged 1", noJudge.engaged === 1);
check("no-judge: verdicts 0", noJudge.verdicts === 0);
check("no-judge: no tone", noJudge.verdictTone === undefined);
const anchored = gateCensusOf([
  { note: "Decision gate engaged but no judge answered (verdict not possible, not a pass) — trace mentions FAIL 95% internally" },
]);
check("anchored regex: no verdict from tail text", anchored.verdicts === 0 && anchored.verdictLine === undefined);

// 7. last-wins: FAIL then PASS reads PASS (final gate state)
const failThenPass = gateCensusOf([
  { note: "System-One gate FAIL 95% — rework → full verification pass runs" },
  { note: "Decision gate PASS 95% (fast-model) — output accepted" },
]);
check("fail-then-pass: verdicts 2", failThenPass.verdicts === 2);
check("fail-then-pass: line PASS 95%", failThenPass.verdictLine === "PASS 95%");
check("fail-then-pass: tone pass", failThenPass.verdictTone === "pass");

// 8. reverse: PASS then FAIL reads FAIL (amber, never green)
const passThenFail = gateCensusOf([
  { note: "Decision gate PASS 95% (fast-model) — output accepted" },
  { note: "System-One gate FAIL 95% — rework → full verification pass runs" },
]);
check("pass-then-fail: line FAIL 95%", passThenFail.verdictLine === "FAIL 95%");
check("pass-then-fail: tone fail", passThenFail.verdictTone === "fail");

// 9. the live c0c31b shape: both families FAIL, engaged 1
const c0c31b = gateCensusOf([
  { note: "System-One gate FAIL 95% — rework → full verification pass runs" },
  { note: "Decision gate FAIL 95% (fast-model) — one free rework pass runs" },
]);
check("c0c31b shape: engaged 1 verdicts 2", c0c31b.engaged === 1 && c0c31b.verdicts === 2);
check("c0c31b shape: tone fail", c0c31b.verdictTone === "fail");

// 10. no-judge + verdict mix (dossier-then-verdict shape)
const mixed = gateCensusOf([
  { note: "Decision gate engaged but no judge answered (tried: …)" },
  { note: "System-One gate PASS 96% — output accepted" },
]);
check("mixed: engaged 1 verdicts 1", mixed.engaged === 1 && mixed.verdicts === 1);
check("mixed: tone pass", mixed.verdictTone === "pass");

// 11-12. tolerant junk rows
const junk = gateCensusOf([null, {}, { note: 123 as unknown as string }] as { note?: string }[]);
check("junk: zeros", junk.engaged === 0 && junk.verdicts === 0);

// 13. verdict note without an outcome keeps the previous line honest
const noOutcomeLast = gateCensusOf([
  { note: "Decision gate PASS 95% (fast-model) — output accepted" },
  { note: "System-One gate verdict recorded" },
]);
check("no-outcome last: line PASS 95%", noOutcomeLast.verdictLine === "PASS 95%");
check("no-outcome last: tone pass", noOutcomeLast.verdictTone === "pass");

// 14. r692: latestAt — the newest gate-relevant `at` (epoch ms), the digest
// ⚖ chip's visible-run freshness input. ONLY census-counted rows stamp it;
// junk at-values are skipped (the tolerant-input doctrine).
const stamped = gateCensusOf([
  { note: "Decision gate PASS 95% (fast-model)", at: 1_000 },
  { note: "System-One gate FAIL 90% — output replaced", at: 3_000 },
  { note: "Unrelated engine call", at: 9_999 },
]);
check("latestAt: max over gate rows only", stamped.latestAt === 3_000);
check("latestAt: junk at skipped", gateCensusOf([{ note: "Decision gate engaged", at: "x" as unknown as number }]).latestAt === undefined);
check("latestAt: NaN skipped", gateCensusOf([{ note: "System-One gate PASS 90%", at: Number.NaN }]).latestAt === undefined);
check("latestAt: absent on empty census", empty.latestAt === undefined);

console.log(`qa-gate-census: ${pass}/${pass + fail}`);
if (fail > 0) process.exit(1);
