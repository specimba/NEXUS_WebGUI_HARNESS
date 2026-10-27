// r342 probe — lane-attributed run-failure display (user report 2026-10-08).
// Report: a run failed across THREE lanes (Vyce AI, auto gateway, AIHubMix),
// but the recovery dialog showed ONE lane's "Please recharge" as the whole
// verdict — next to the user's funded Vyce key ($236.40, checked live).
// Fix: when ≥2 distinct lanes failed, the dialog renders a per-lane error
// attribution strip built from callLog entries (each carries its own error
// text), before the generic hint. Single-lane failures unchanged.
import { readFileSync } from "node:fs";

const src = readFileSync("src/components/nexus/workflows/workflow-run-panel.tsx", "utf8");

let pass = 0;
const total = 7;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (ok) pass += 1;
}

check(
  "laneFailures groups per-dial errors by lane (callLog error text kept per lane)",
  /const laneFailures = \(\(\) => \{\s*const map = new Map<string, \{ lane: string; message: string; count: number \}>\(\);[\s\S]*?const message = \(c\.error \?\? ""\)\.trim\(\);[\s\S]*?return \[\.\.\.map\.values\(\)\];\s*\}\)\(\);/.test(src)
);

check(
  "strip gated to multi-lane failures only (≥2 distinct lanes)",
  /\{laneFailures\.length >= 2 \? \(/.test(src)
);

check(
  "strip reports the total dial count and per-lane counts",
  src.includes("All {failedDials} dials failed across {laneFailures.length} lanes") &&
    /\{f\.count > 1 \? ` ×\$\{f\.count\}` : ""\}/.test(src)
);

check(
  "'auto' lane named honestly as the built-in gateway",
  /const laneLabel = \(l: string\) => \(l === "auto" \? "built-in gateway" : l\);/.test(src)
);

check(
  "strip sits before the generic hint (attribution first, advice second)",
  src.indexOf("each lane reported its own error") < src.indexOf("<span>{err.hint}</span>")
);

check(
  "r320 failedChip lane witness intact (still built from failedLanes)",
  /const failedChip =\s*failedDials > 0\s*\? ` · ✗\$\{failedDials\} failed dials \(\$\{\[\.\.\.failedLanes\.entries\(\)\]/.test(src)
);

check(
  "single laneOf helper shared (no drift between chip and strip)",
  (src.match(/laneOf\(c\.engine/g) ?? []).length === 2
);

console.log(`\n${pass}/${total} PASS — r342 lane-attributed failure display`);
process.exit(pass === total ? 0 : 1);
