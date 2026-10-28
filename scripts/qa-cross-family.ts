/**
 * r673 — qa-cross-family: fixtures for the KB-1-a #1 adaptation (the
 * cross-family judge). Frozen contracts:
 *   1. judgeFamilyOf  — hop-key form ("vyce::deepseek-v4.1" → "vyce") and
 *      bare-name form ("glm-4.7-air" → "zai"); junk → "" (never guessed).
 *   2. orderJudgeChain — family-DISJOINT hops lead when the generator's
 *      family is known; honest degradation (unchanged chain) when no
 *      disjoint hop exists. The gate never blocks on family.
 *   3. crossFamilyTag  — the verdict-note witness suffix contract.
 *   4. Census compatibility — suffixed verdict notes still parse as verdicts
 *      through gateCensusOf / gateEventsOf (note-head anchored, tone
 *      derived, latest-wins), and the forensic-diagnosis regressions stay
 *      frozen (junk note skip, leading-junk note is not a verdict).
 * Run: bun scripts/qa-cross-family.ts
 */
import { crossFamilyTag, judgeFamilyOf, orderJudgeChain } from "../src/lib/systemone";
import type { RelayHop } from "../src/lib/relay";
import { gateCensusOf, gateEventsOf } from "../src/lib/gate-census";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// ─── 1. judgeFamilyOf ─────────────────────────────────────────────────────────
check("hop key → provider family", judgeFamilyOf("vyce::deepseek-v4.1"), "vyce");
check("orca hop key keeps its id", judgeFamilyOf("orcarouter::glm-4.7-air"), "orcarouter");
check("bare glm name → zai", judgeFamilyOf("glm-4.7-air"), "zai");
check("bare deepseek name", judgeFamilyOf("deepseek-v4-flash-lr"), "deepseek");
check("intern decision model → intern-ai", judgeFamilyOf("intern-decision-4b"), "intern-ai");
check("jev model → typesafe", judgeFamilyOf("jev-latest"), "typesafe");
check("whitespace + case tolerant", judgeFamilyOf("  Qwen-Max "), "qwen");
check("empty → '' (unknown)", judgeFamilyOf(""), "");
check("junk → never throws, bare passthrough", judgeFamilyOf("mystery-model"), "mystery-model");

// ─── 2. orderJudgeChain ───────────────────────────────────────────────────────
function hop(key: string, model: string): RelayHop {
  return { key, providerId: key.split("::")[0] ?? key, model, label: `${key} label`, tier: 2, elo: 0.9 };
}
const sameFam = hop("vyce::deepseek-v4.1", "deepseek-v4.1");
const disjoint = hop("orcarouter::glm-4.7-air", "glm-4.7-air");
const disjoint2 = hop("zai::kimi-k2", "kimi-k2");
const unknownFam = hop("weird::mystery-7b", "mystery-7b");

const reordered = orderJudgeChain([sameFam, disjoint, disjoint2, unknownFam], "vyce");
check("disjoint hops lead", reordered[0]?.key, disjoint.key);
check("disjoint order preserved among themselves", reordered[1]?.key, disjoint2.key);
check("same-family falls to the tail (honest fallback)", reordered[3]?.key, sameFam.key);
check("unknown-family counts as disjoint", reordered[2]?.key, unknownFam.key);
check("no generator family → chain unchanged", orderJudgeChain([sameFam, disjoint], undefined)[0]?.key, sameFam.key);
check("all same-family → chain unchanged (never blocks)", orderJudgeChain([sameFam], "vyce")[0]?.key, sameFam.key);
check("empty chain → unchanged", orderJudgeChain([], "vyce").length, 0);
const stability = orderJudgeChain([disjoint2, disjoint], "vyce");
check("relative order of disjoint hops kept", `${stability[0]?.key}|${stability[1]?.key}`, `${disjoint2.key}|${disjoint.key}`);

// ─── 3. crossFamilyTag (the verdict-note witness) ─────────────────────────────
check("cross-family tag", crossFamilyTag({ judgeFamily: "zai", crossFamily: true }), " · cross-family");
check("same-family tag (honest)", crossFamilyTag({ judgeFamily: "vyce", crossFamily: false }), " · same-family");
check("family without cross flag → '' (pre-r673 verdicts)", crossFamilyTag({ judgeFamily: "zai" }), "");
check("empty object → ''", crossFamilyTag({}), "");
check("null/undefined → ''", crossFamilyTag(null), "");
check("note composes: PASS with witness", `Decision gate PASS 95% (fast-model${crossFamilyTag({ judgeFamily: "zai", crossFamily: true })}) — output accepted`, "Decision gate PASS 95% (fast-model · cross-family) — output accepted");

// ─── 4. census compatibility (suffixed notes stay first-class verdicts) ───────
const crossPass = "Decision gate PASS 95% (fast-model · cross-family) — output accepted";
const sameFail = "Decision gate FAIL 90% (fast-model · same-family) — one free rework pass runs";
const noJudge = "Decision gate engaged but no judge answered (tried: intern-systemone — not armed (no intern-discovery key)) — output accepted unchanged (verdict not possible, not a pass)";

const census = gateCensusOf([
  { note: sameFail },
  { note: crossPass },
  { note: noJudge },
]);
check("engagement counts every gate note", census.engaged, 3);
check("suffixed verdicts count as verdicts", census.verdicts, 2);
check("latest-wins on suffixed notes (rework-then-pass reads PASS)", census.verdictLine, "PASS 95%");
check("verdict tone follows the LATEST verdict", census.verdictTone, "pass");

const events = gateEventsOf([
  { note: crossPass, stepId: "s1" },
  { note: sameFail, stepId: "s2" },
  { note: noJudge, stepId: "s3" },
]);
check("typed events: 2 verdicts + 1 no-judge engagement (r672 ledger shape)", events.length, 3);
check("event carries the step id", events[0]?.stepId, "s1");
check("no-judge note mints an engagement event, never a verdict", gateEventsOf([{ note: noJudge, stepId: "s4" }]).length, 1);
check("leading junk is not a verdict (note-head anchored)", gateEventsOf([{ note: `…${crossPass}`, stepId: "s5" }]).length, 0);
check("junk row (note: 123) skipped, never throws (r670 regression)", gateCensusOf([{ note: 123 as unknown as string }, { note: crossPass }]).verdicts, 1);

console.log(`\nqa-cross-family: ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
