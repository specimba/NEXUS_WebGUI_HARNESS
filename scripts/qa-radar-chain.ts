// r657: radar chain-typed evidence (slice 3, paper F5) — source-level pins.
// Run: bun scripts/qa-radar-chain.ts
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) pass += 1;
  else {
    fail += 1;
    console.log(`FAIL ${name}`);
  }
}
const rel = (p: string) => new URL(p, import.meta.url).pathname;

const radar = readFileSync(rel("../src/lib/server/capability-radar.ts"), "utf8");
const tt = readFileSync(rel("../src/lib/trace-trial.ts"), "utf8");
const autopilot = readFileSync(rel("../src/components/nexus/workflows/server-autopilot.tsx"), "utf8");
const tasks = readFileSync(rel("../docs/strategy/TASKS.md"), "utf8");

// ── schema + single-vocabulary import ──
check("RadarFinding declares chain field", /chain\?\s*:\s*\{\s*status:\s*ChainStatus/.test(radar));
check("capability-radar imports the validated identity from trace-trial", radar.includes('import { VALIDATED_R640_CHAIN, type ChainStatus } from "@/lib/trace-trial"'));
check("trace-trial owns the r640 identity", tt.includes('export const VALIDATED_R640_CHAIN = "vault-empty starves the closed-tab lane"'));

// ── stamps: validated where evidence cites r640, candidate where intent is open ──
check("registry-collapse stamps VALIDATED r640 chain", /Registry collapsed[\s\S]{0,600}?chain:\s*\{\s*status:\s*"validated",\s*mechanism:\s*VALIDATED_R640_CHAIN/.test(radar));
check("registry-shrink stamps CANDIDATE co-occurrence", /Registry shrank[\s\S]{0,600}?chain:\s*\{\s*status:\s*"candidate",\s*mechanism:\s*VALIDATED_R640_CHAIN/.test(radar));
check("archive-corrupt finding stays honestly unchained", !/Run archive unreadable[\s\S]{0,400}?chain:/.test(radar));
check("no other finding invents a chain", (radar.match(/chain:\s*\{/g) ?? []).length === 2);

// ── renderer: both branches, honest wording, chip only when present ──
check("view mirror carries chain", autopilot.includes('chain?: { status: "candidate" | "validated"; mechanism: string; from: string }'));
check("renderer emits validated branch", autopilot.includes('"validated chain"'));
check("renderer emits candidate branch with the honest caveat", autopilot.includes("candidate chain — co-occurrence, not yet propagation"));
check("chip renders only when chain present", /f\.chain \? \([\s\S]{0,500}?⛓/.test(autopilot));

// ── F7: admission-gate checkboxes on the active experiment entries ──
check("TraceTrial entry carries the admission gate", /\[x\] \*\*trigger\*\* — a run artifact set/.test(tasks));
check("Looped-depth entry carries the admission gate", /\[x\] \*\*trigger\*\* — a generate step with Looped/.test(tasks));
check("peer blind-score entry carries the admission gate", /\[x\] \*\*trigger\*\* — a gate-worthy crew step/.test(tasks));
check("every active gate fixes all four F7 elements", (tasks.match(/\[x\] \*\*verdict\*\*/g) ?? []).length >= 3 && (tasks.match(/\[x\] \*\*boundary\*\*/g) ?? []).length >= 3 && (tasks.match(/\[x\] \*\*expected\*\*/g) ?? []).length >= 3);
check("TraceTrial entry records the r657 slice-3 ship", tasks.includes("r657 slice 3 SHIPPED: radar chain-typed evidence"));

console.log(`qa-radar-chain: ${pass}/${pass + fail}`);
if (fail > 0) process.exit(1);
