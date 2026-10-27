// r658 QA — looped-depth OUTCOME chip: pure mapping + source pins.
// Dial-free (bun scripts/qa-looped-outcome.ts). Mirrors qa-calllog-lane shape.
import { loopedOutcomeChip } from "../src/lib/looped-outcome";
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

// ── pure mapping logic (9) ──────────────────────────────────────────────────
const pv = loopedOutcomeChip("pass-verdict");
check("pass-verdict → pass tone", pv.tone === "pass");
check("pass-verdict → label 'pass'", pv.label === "pass");
const rx = loopedOutcomeChip("rework-exhausted");
check("rework-exhausted → warn tone (quality refusal stays amber)", rx.tone === "warn");
check("rework-exhausted → label 'best kept'", rx.label === "best kept");
const cr = loopedOutcomeChip("cap-reached");
check("cap-reached → warn tone", cr.tone === "warn");
check("cap-reached → label 'unsure at cap'", cr.label === "unsure at cap");
const ju = loopedOutcomeChip("judge-unavailable");
check("judge-unavailable → muted tone (infra stop ≠ quality warning)", ju.tone === "muted");
const junk = loopedOutcomeChip("SOMETHING-ELSE");
check("unknown reason → muted honest, never a guessed verdict", junk.tone === "muted" && junk.label === "exit unknown");
const noThrow =
  loopedOutcomeChip(null).tone === "muted" &&
  loopedOutcomeChip(undefined).tone === "muted" &&
  loopedOutcomeChip(42).tone === "muted" &&
  loopedOutcomeChip("").tone === "muted";
check("null/undefined/number/empty never-throw → muted", noThrow);

// ── source pins (6) ─────────────────────────────────────────────────────────
const runner = readFileSync("src/lib/workflow-runner.ts", "utf8");
check("runner writes pass-verdict", runner.includes('"pass-verdict"'));
check("runner writes rework-exhausted", runner.includes('"rework-exhausted"'));
check("runner writes judge-unavailable", runner.includes('"judge-unavailable"'));
check("runner writes cap-reached", runner.includes('"cap-reached"'));
const panel = readFileSync("src/components/nexus/workflows/workflow-run-panel.tsx", "utf8");
check("run-panel imports the shared adapter (no local re-map)", panel.includes('loopedOutcomeChip') && panel.includes("looped-outcome"));
check("run-panel renders the visible suffix '· {oc.label}'", panel.includes("{oc.label}"));

console.log(`qa-looped-outcome: ${pass}/${pass + fail}`);
if (fail > 0) process.exit(1);
