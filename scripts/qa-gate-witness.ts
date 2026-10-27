// r659 QA — Decision-gate WITNESS lines (uncertain verdict + judge error)
// and the gate-note color families on the run panel. Dial-free.
// Backstory: two live witness runs (r659) hit the gate's silent UNCERTAIN
// accept — gate engaged, no callLog line. The panel also rendered the
// confident "Decision gate PASS" line in warning amber (the r656
// false-alarm pattern at note level).
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

const runner = readFileSync("src/lib/workflow-runner.ts", "utf8");
const panel = readFileSync("src/components/nexus/workflows/workflow-run-panel.tsx", "utf8");

// ── runner witness lines (6) ────────────────────────────────────────────────
check("uncertain verdict emits a callLog line", runner.includes("`Decision gate uncertain ${"));
check("uncertain line names the verdict gap honestly", runner.includes("no confident verdict; output accepted unchanged"));
check("judge-error catch emits a callLog line", runner.includes("`Decision gate judge errored"));
check("judge-error line is named an infra stop, not quality", runner.includes("infra stop, not quality"));
check("null verdict (no judge answered) emits a callLog line", runner.includes("Decision gate engaged but no judge answered"));
check("no-judge line refuses to impersonate a pass", runner.includes("verdict not possible, not a pass"));

// ── panel gate-note families (4) ────────────────────────────────────────────
check("Decision gate PASS gets its own calm emerald family (was amber ↻)", panel.includes('c.note.startsWith("Decision gate PASS")') && panel.includes("text-emerald-300/90"));
check("uncertain gate line gets the muted neutral family", panel.includes('c.note.startsWith("Decision gate uncertain")'));
check("no-judge gate line gets the muted neutral family too", panel.includes('c.note.startsWith("Decision gate engaged but no judge answered")'));
check("judge-errored gate line gets the muted neutral family", panel.includes('c.note.startsWith("Decision gate judge errored")'));
check("FAIL gate note keeps the honest amber default (rework incoming)", /: laneOfEntry\(c\) === "server-relay"\s*\?\s*"text-sky-300\/90"/.test(panel) && panel.includes('"text-amber-300/90"'));

// ── regression pins (3) ─────────────────────────────────────────────────────
check("looped FAIL branch still rides the confident-FAIL gate", runner.includes('note: `Decision gate FAIL ${(gate.confidence * 100).toFixed(0)}% (${gate.via}) — one free rework pass runs`'));
check("looped outcome adapter untouched", runner.includes(`patchRunStep(step.stepId, { looped: { k: loopK, r: rCap, reason: loopReason } })`));
check("gate NEVER blocks the run (catch comment intact)", runner.includes("the gate NEVER blocks a run"));

console.log(`qa-gate-witness: ${pass}/${pass + fail}`);
if (fail > 0) process.exit(1);
