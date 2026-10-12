#!/usr/bin/env node
// r359 — global search covers agents & workflows (probe)
// Asserts the CONTRACT: named hits rank above message hits, navigation wires
// to the existing primitives (setActiveAgentId+setView / requestHighlight-
// Workflow), caps, IME parity preserved, message-search path untouched.
// NOTE: assert via node-side string matching — display transports can eat
// bracket sequences, but readFileSync never lies.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const f = readFileSync(join(ROOT, "src/components/praison/global-search-dialog.tsx"), "utf8");

let pass = 0, fail = 0;
const results = [];
function check(name, ok) {
  if (ok) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}`); }
}

// ── 1. builder shape ──
check("buildNamedHits exists with Agent[]/Workflow[] signature",
  /function buildNamedHits\(agents: Agent\[\], workflows: Workflow\[\], query: string\): NamedHit\[\]/.test(f));
check("2-char gate present in builder", /if \(q\.length < 2\) return \[\];/.test(f));
check("agents matched on name + role + description",
  /a\.name\.toLowerCase\(\)\.includes\(q\) \|\|\s*\n\s*a\.role\.toLowerCase\(\)\.includes\(q\) \|\|\s*\n\s*a\.description\.toLowerCase\(\)\.includes\(q\)/.test(f));
check("workflows matched on name + description",
  /w\.name\.toLowerCase\(\)\.includes\(q\) \|\| w\.description\.toLowerCase\(\)\.includes\(q\)/.test(f));
check("workflow subtitle falls back to step count",
  /w\.description \|\| `\$\{w\.steps\.length\} step/.test(f));
check("per-kind cap = 3 enforced in both loops",
  (f.match(/MAX_NAMED_PER_KIND = 3/g) || []).length === 1 &&
  (f.match(/\.kind === "agent"\)\.length >= MAX_NAMED_PER_KIND\) break;/g) || []).length === 1 &&
  (f.match(/\.kind === "workflow"\)\.length >= MAX_NAMED_PER_KIND\) break;/g) || []).length === 1);

// ── 2. navigation wiring ──
check("runNamed exists", /const runNamed = React\.useCallback\(/.test(f));
check("agent hit → setActiveAgentId + setView('chat')",
  /ui\.setActiveAgentId\(hit\.id\);\s*\n\s*ui\.setView\("chat"\);/.test(f));
check("workflow hit → requestHighlightWorkflow(hit.id)",
  /ui\.requestHighlightWorkflow\(hit\.id\);/.test(f));
check("runNamed closes the dialog first (open→navigate rhythm)",
  /const runNamed = React\.useCallback\(\s*\n\s*\(hit: NamedHit\) => \{\s*\n\s*setOpen\(false\);/.test(f));

// ── 3. Enter-first contract + IME parity preserved ──
check("Enter prefers named hit over message hit",
  /const firstNamed = namedHits\[0\];\s*\n\s*if \(firstNamed\) \{/.test(f));
check("message fallback preserved (jump(hits[0]))",
  /else if \(hits\.length > 0\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*jump\(hits\[0\]\);/.test(f));
check("r245 IME guard still present (!isComposing)",
  /!e\.nativeEvent\.isComposing/.test(f));

// ── 4. counter + ranking ──
check("totalHits counts named + message hits",
  /const totalHits = namedHits\.length \+ hits\.length;/.test(f));
check("named section renders ABOVE conversation groups",
  f.indexOf("namedHits.length > 0 && (") < f.indexOf("grouped.map(([convId, convHits]) => ("));

// ── 5. copy honesty ──
check("old 'Search all chats' title GONE", !f.includes("Search all chats"));
check("new title present", f.includes("Search chats, agents and workflows"));
check("placeholder updated", f.includes("Search chats, agents, workflows"));
check("empty state covers all three kinds",
  f.includes("no agents, workflows or messages"));
check("hint explains the new scope",
  f.includes("matches agent and workflow names, and every message body"));

// ── 6. message-search contract UNTOUCHED ──
check("buildGlobalHits still present (signature intact)",
  /function buildGlobalHits\(/.test(f));
check("MAX_CONVS still 6, MAX_HITS_PER_CONV still 3",
  /const MAX_CONVS = 6;/.test(f) && /const MAX_HITS_PER_CONV = 3;/.test(f));
check("r258 category-error guard comment intact",
  f.includes("hits-vs-conversations category error"));
check("grouped memo deps still [hits]", /}, \[hits\]\);/.test(f));
check("message jump flow unchanged (setActive + agent sync + requestFocusMessage)",
  /\.setActive\(hit\.convId\);/.test(f) && /requestFocusMessage\(hit\.convId, hit\.msgId\);/.test(f));

// ── 7. house style ──
check("no /quota/i vocabulary in this file", !/quota/i.test(f));

// ── report ──
console.log(`probe-r359-global-search-named: ${pass} pass / ${fail} fail`);
for (const r of results) console.log(r);
process.exit(fail === 0 ? 0 : 1);
