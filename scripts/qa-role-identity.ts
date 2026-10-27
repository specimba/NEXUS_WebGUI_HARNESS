/**
 * r180 QA — role-tag honesty (K-series, directive item (a)).
 * Run: bun run scripts/qa-role-identity.ts
 * Covers parseRolePrefix + roleMatchesAgent against the REAL label strings
 * from the user's exported Continuous-Research workflow (the failed-run
 * evidence where a "[Strategic Planner]" title was shown under Research Scout).
 */
import { parseRolePrefix, roleMatchesAgent } from "../src/lib/helpers";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. Real labels from the user's workflow export ──────────────────────────
const planner = parseRolePrefix(
  "[Strategic Planner] Establish three separate research tracks—agent harness and team automation, bounded recursive self-i"
);
check("role extracted from real label", planner.role === "Strategic Planner", JSON.stringify(planner.role));
check("clean label drops the tag + bracket spacing",
  planner.cleanLabel.startsWith("Establish three separate research tracks"),
  planner.cleanLabel.slice(0, 40));
check("real mismatch: [Strategic Planner] tag vs Research Scout worker",
  roleMatchesAgent(planner.role!, "Research Scout") === false);
const smith = parseRolePrefix("[Code Smith] Inventory the system context available to this workflow");
check("second real label parsed", smith.role === "Code Smith");
check("real match: [Code Smith] tag vs Code Smith worker",
  roleMatchesAgent(smith.role!, "Code Smith") === true);

// ── 2. Tolerance cases ───────────────────────────────────────────────────────
check("no tag → role null, label passthrough",
  (() => { const r = parseRolePrefix("Plain step label"); return r.role === null && r.cleanLabel === "Plain step label"; })());
check("empty label → null + empty",
  (() => { const r = parseRolePrefix(""); return r.role === null && r.cleanLabel === ""; })());
check("leading whitespace tolerated",
  (() => { const r = parseRolePrefix("  [Reviewer] Check outputs"); return r.role === "Reviewer" && r.cleanLabel === "Check outputs"; })());
check("unclosed bracket is NOT a tag",
  parseRolePrefix("[Unclosed step label").role === null);
check("case + emoji-insensitive matching",
  roleMatchesAgent("research scout", "🌻 Research Scout") === true);
check("substring agreement (partial tag)",
  roleMatchesAgent("Research", "Research Scout") === true);
check("empty inputs never match",
  roleMatchesAgent("", "x") === false && roleMatchesAgent("x", "") === false);
check("different roles never match",
  roleMatchesAgent("Code Smith", "Strategic Planner") === false);

// ── 3. Display doctrine: tag never routes (parse is display-only) ────────────
const round2 = parseRolePrefix(planner.cleanLabel);
check("clean label re-parse yields no second tag",
  round2.role === null && round2.cleanLabel === planner.cleanLabel);

// ── 4. r182: effective-role preference (explicit roleId wins) ────────────────
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveStepRole } from "../src/lib/helpers";

check("explicit roleId wins over a disagreeing label prefix",
  (() => {
    const r = resolveStepRole("Research Scout", "[Strategic Planner] Establish tracks");
    return r.role === "Research Scout" && r.source === "explicit";
  })());
check("parsed prefix is the fallback when roleId absent",
  (() => {
    const r = resolveStepRole(undefined, "[Code Smith] Inventory context");
    return r.role === "Code Smith" && r.source === "parsed";
  })());
check("whitespace-only roleId collapses to the parsed fallback",
  (() => {
    const r = resolveStepRole("   ", "[Code Smith] Inventory context");
    return r.role === "Code Smith" && r.source === "parsed";
  })());
check("both signals absent → null (no chip)",
  (() => {
    const r = resolveStepRole("", "Review & refine");
    return r.role === null && r.source === null;
  })());
check("explicit roleId beats label prefix even when the prefix agrees too",
  (() => {
    const r = resolveStepRole("Tech Writer", "[Tech Writer] Publish");
    return r.role === "Tech Writer" && r.source === "explicit";
  })());

// ── 5. r182 integration: editor writes it, surfaces prefer it, runs carry it ─
const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const editorSrc = read("src/components/nexus/workflows/workflow-editor-dialog.tsx");
const panelSrc = read("src/components/nexus/workflows/workflow-run-panel.tsx");
const viewSrc2 = read("src/components/nexus/workflows/workflows-view.tsx");
const runnerSrc = read("src/lib/workflow-runner.ts");
const typesSrc = read("src/lib/types.ts");

check("editor has the Role tag input writing step.roleId",
  editorSrc.includes("patchStep(step.id, { roleId: e.target.value })"));
check("editor shows an authoring-time mismatch warning for explicit roles",
  editorSrc.includes("routing follows the worker") && editorSrc.includes("roleMatchesAgent(explicit, agent.name)"));
check("editor save normalizes whitespace-only roleId to absent",
  editorSrc.includes("roleId: s.roleId?.trim() ? s.roleId.trim() : undefined"));
check("run panel prefers resolveStepRole and phrases the chip by source",
  panelSrc.includes("resolveStepRole(step.roleId, step.label)") &&
    panelSrc.includes('roleInfo.source === "explicit" ? "role" : "tag"'));
check("card chips prefer resolveStepRole too",
  viewSrc2.includes("resolveStepRole(step.roleId, step.label || \"\")"));
check("runner materializes roleId into run steps (base + deep clones)",
  runnerSrc.includes("roleId: s.roleId,") && runnerSrc.includes("roleId: first.roleId,"));
check("WorkflowRunStep carries the optional roleId field",
  typesSrc.includes("roleId?: string;"));

console.log(`\nK-series (role-identity): ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
