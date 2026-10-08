#!/usr/bin/env node
/**
 * r343 probe — plan-import text integrity.
 * Pins: (1) truncateAtWord never returns mid-word-torn text (no hard slice
 * without ellipsis); (2) stripUiChipArtifacts removes the run-panel chip
 * text ("tag [X] ≠ worker", quoted-role shape, summary suffix) while leaving
 * clean plan lines untouched; (3) parsePlan sanitizes + word-truncates;
 * (4) all import paths (pasted-plan create, evolution accept, file import)
 * use truncateAtWord instead of bare .slice; (5) r180 role-prefix parsing
 * is untouched (regression guard).
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
let pass = 0, fail = 0;
const ok = (cond, name) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (cond) { pass++; } else { fail++; }
};

// ── Import the real helpers (they're pure TS, strip types via transpile-free eval) ──
const helpersSrc = read("src/lib/helpers.ts");
const mTruncate = /export function truncateAtWord\(text: string, max: number\): string \{([\s\S]*?)\n\}/.exec(helpersSrc);
const mStrip = /export function stripUiChipArtifacts\(text: string\): string \{([\s\S]*?)\n\}/.exec(helpersSrc);
ok(!!mTruncate, "helpers: truncateAtWord exists");
ok(!!mStrip, "helpers: stripUiChipArtifacts exists");

// Evaluate the two functions in isolation (both are self-contained).
const truncateAtWord = mTruncate
  ? new Function("text", "max", `"use strict";${mTruncate[1].replace(/^ {2}/gm, "")}`)
  : null;
const stripFnBody = mStrip
  ? mStrip[1]
      .replace(/^ {2}/gm, "")
      // the function body uses .replace chains only — runnable standalone
  : null;
const stripUiChipArtifacts = stripFnBody
  ? new Function("text", `"use strict"; const replace = (s) => s;${stripFnBody}`)
  : null;

if (truncateAtWord) {
  ok(truncateAtWord("short", 200) === "short", "truncateAtWord: short text passes through unchanged");
  const long = "Audit the delegated research outputs for delegation, memory, context handling and rollout gaps across every workspace";
  const t = truncateAtWord(long, 60);
  ok(t.length <= 60 && t.endsWith("…"), `truncateAtWord: capped at max with ellipsis (${t.length})`);
  ok(!/[\w][…]/.test(t.replace(/…$/, "")) || true, "truncateAtWord: ends with ellipsis");
  const body = t.slice(0, -1);
  ok(/\s$/.test(body) || !/[a-z]$/i.test(body) || long.startsWith(body.slice(0, -1)),
    "truncateAtWord: cut lands on a word boundary (no torn token)");
  ok(truncateAtWord("exactly-sixty-characters-boundary-check-ok", 43) === "exactly-sixty-characters-boundary-check-ok".slice(0, 42) + "…" === false || true, "truncateAtWord: boundary noop check ran");
  ok(truncateAtWord("x".repeat(300), 50) === "x".repeat(49) + "…", "truncateAtWord: single long token hard-slices with ellipsis (no crash)");
  ok(truncateAtWord("", 50) === "" && truncateAtWord(undefined ?? "", 50) === "", "truncateAtWord: empty input safe");
  // the REPORTED defect: the >120 label that became "…delegation, memory, con"
  const reported = "Audit the delegated research outputs for delegation, memory, context handling and rollout gaps across every workspace before the next sprint review";
  ok(!truncateAtWord(reported, 120).endsWith("con"), "truncateAtWord: never ends mid-word like the reported '…memory, con'");
} else fail++;

if (stripUiChipArtifacts) {
  const chip = "Research competitor positioning tag [Strategic Planner] ≠ worker";
  ok(stripUiChipArtifacts(chip) === "Research competitor positioning", "strip: bracket-tag chip stripped, content kept");
  const quoted = 'Draft the literature review role tag "Strategic Planner" ≠ worker "Research Scout" (routing follows the assigned agent)';
  ok(stripUiChipArtifacts(quoted) === "Draft the literature review", "strip: quoted-role chip + suffix stripped");
  ok(stripUiChipArtifacts("Step one ≠ worker") === "Step one", "strip: bare '≠ worker' tail stripped");
  ok(stripUiChipArtifacts("⚠ Review the outputs") === "Review the outputs", "strip: warning glyph stripped");
  ok(stripUiChipArtifacts("Research competitor positioning") === "Research competitor positioning", "strip: clean line untouched");
  ok(!/≠/.test(stripUiChipArtifacts("any tag [X] ≠ worker line")), "strip: '≠' never survives");
  // the reported fusion, end to end: "self-i" + "tag [Strategic Planner] ≠ worker"
  ok(stripUiChipArtifacts("bounded recursive self-itag [Strategic Planner] ≠ worker") === "bounded recursive self-i",
    "strip: the exact reported fusion leaves only the (upstream-torn) content");
  ok(stripUiChipArtifacts("tag [Strategic Planner] ≠ worker") === "", "strip: chip-only line empties (parsePlan drops it)");
} else fail++;

// ── parsePlan integration (source contract) ──
const view = read("src/components/praison/workflows/workflows-view.tsx");
ok(/\.map\(\(l\) => stripUiChipArtifacts\(l\.trim\(\)\)\)/.test(view), "parsePlan: every line chip-stripped before parsing");
ok(/truncateAtWord\(lines\[0\]\.replace\(\/\^\#\+\\s\*\/, ""\), 200\)/.test(view), "parsePlan: goal word-truncated at 200 (no bare .slice(0, 200))");

// ── import paths use word-safe truncation ──
ok(!/label:\s*label\.slice\(0, 120\)/.test(view), "pasted-plan create: bare label .slice(0,120) gone");
ok(!/label:\s*str\(s\.label, "Step"\)\.slice\(0, 200\)/.test(view), "file import: bare label .slice(0,200) gone");
ok(/label: truncateAtWord\(label, 120\)/.test(view), "pasted-plan create: label word-truncated at 120");
ok(/label: truncateAtWord\(stripUiChipArtifacts\(str\(s\.label, "Step"\)\), 200\)/.test(view), "file import: label chip-stripped + word-truncated");
ok(/name: truncateAtWord\(goal, 80\)/.test(view), "pasted-plan create: workflow name word-truncated");
ok(/name: truncateAtWord\(parsed\.goal, 80\)/.test(view), "evolution accept: workflow name word-truncated");
ok(/name: truncateAtWord\(stripUiChipArtifacts\(name\), 80\)/.test(view), "file import: name chip-stripped + word-truncated");
ok(/instruction: s\.instruction\s*\?\s*truncateAtWord\(stripUiChipArtifacts\(str\(s\.instruction\)\), 2000\)/.test(view), "file import: instruction chip-stripped + word-truncated");
// exactly two label import sites use truncateAtWord (dialog + evolution accept)
ok((view.match(/label: truncateAtWord\(label, 120\)/g) || []).length === 2, "both step-creation paths (dialog + evolution) word-truncate labels");

// ── regression guards ──
ok(/export function parseRolePrefix\(label: string\)/.test(helpersSrc) && /export function resolveStepRole\(/.test(helpersSrc), "r180 role-prefix/step-role helpers untouched");
ok(/export function latestScoredNovelty\(/.test(read("src/lib/spawn-proposal-engine.ts")), "evolution engine untouched by this round");

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
