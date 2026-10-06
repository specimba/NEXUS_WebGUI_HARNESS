// r311 QA — role-tag honesty noise policy: when EVERY tagged step mismatches
// its worker (imported plans authored for a different agent chain), the
// surfaces render ONE summary note instead of identical per-step chips.
// Unit tests run the pure helper; source asserts pin both render sites.
// Run: bun run scripts/qa-role-tag-honesty.ts

import { summarizeRoleTagMismatches } from "../src/lib/helpers";
import * as fs from "node:fs";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (c) pass++; else fail++;
};

const step = (label: string, agentName: string | null, roleId?: string | null) => ({
  label,
  agentName,
  roleId: roleId ?? null,
});

console.log("T1 — matching chains stay per-step silent (no summary, no noise)");
const allMatch = summarizeRoleTagMismatches([
  step("[Research Scout] map the topic", "Research Scout"),
  step("[Research Scout] search evidence", "Research Scout"),
]);
ok(allMatch.tagged === 2 && allMatch.mismatched === 0 && !allMatch.universal, "all tags agree → universal=false");

console.log("T2 — universal mismatch (the user's imported plan) collapses to one note");
const allWrong = summarizeRoleTagMismatches([
  step("[Strategic Planner] Establish three research tracks", "Research Scout"),
  step("[Code Smith] Inventory the system context", "Research Scout"),
  step("[Tech Writer] Search implementation evidence", "Research Scout"),
]);
ok(allWrong.tagged === 3 && allWrong.mismatched === 3 && allWrong.universal, "3/3 tagged steps mismatch → universal=true");

console.log("T3 — partial mismatch keeps per-step chips (they are actionable)");
const partial = summarizeRoleTagMismatches([
  step("[Research Scout] map the topic", "Research Scout"),
  step("[Strategic Planner] plan sources", "Research Scout"),
]);
ok(partial.mismatched === 1 && !partial.universal, "1 of 2 mismatch → universal=false, chip stays");

console.log("T4 — untagged steps carry no signal and never force the summary");
const mostlyUntagged = summarizeRoleTagMismatches([
  step("[Strategic Planner] plan sources", "Research Scout"),
  step("no tag at all", "Research Scout"),
  step("also untagged", "Code Smith"),
]);
ok(mostlyUntagged.tagged === 1 && !mostlyUntagged.universal, "single tagged step → universal=false even when mismatched");

console.log("T5 — a missing worker name counts as a mismatch (nothing to agree with)");
const orphan = summarizeRoleTagMismatches([
  step("[Strategic Planner] a", null),
  step("[Code Smith] b", null),
]);
ok(orphan.universal && orphan.mismatched === 2, "2 tagged steps, no workers → universal=true");

console.log("T6 — explicit roleId wins over the label tag; identity matching is substring-tolerant");
const explicitWins = summarizeRoleTagMismatches([
  step("[Research Scout] label lies", "Code Smith", "Code Smith"),
  step("[Research Scout] label lies 2", "Code Smith", "Code Smith"),
]);
ok(!explicitWins.universal, "explicit roleId agreeing with the worker → not a mismatch");
const tolerant = summarizeRoleTagMismatches([
  step("[Scout] short tag", "Research Scout"),
  step("[Scout] short tag 2", "Research Scout"),
]);
ok(!tolerant.universal, "substring identity ('Scout' ⊂ 'Research Scout') agrees");

console.log("T7 — source wiring: both surfaces gate the noise behind the summary");
const panelSrc = fs.readFileSync("src/components/praison/workflows/workflow-run-panel.tsx", "utf8");
const viewSrc = fs.readFileSync("src/components/praison/workflows/workflows-view.tsx", "utf8");
const helpersSrc = fs.readFileSync("src/lib/helpers.ts", "utf8");
ok(/roleMismatch && !roleUniversal/.test(panelSrc), "run panel suppresses per-step chips on universal mismatch");
ok(/summary\.universal/.test(panelSrc) && /source plan/.test(panelSrc), "run panel renders the single summary note");
ok(/roleMismatch && !roleUniversal/.test(viewSrc), "board card de-ambers chips + dots on universal mismatch");
ok(/summary\.universal/.test(viewSrc) && /source-plan role tags/.test(viewSrc), "board card renders the summary line");
ok(/export function summarizeRoleTagMismatches/.test(helpersSrc), "helper lives in lib/helpers (one truth, testable)");

console.log(`\nrole-tag honesty: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
