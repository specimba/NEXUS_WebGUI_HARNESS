/**
 * r651 — dial-free QA for the precedent-exemplar lane (arXiv 2610.31421
 * F6/F7 adaptation over the r579 RRF shim). Pure fixtures, no db, no dials.
 * Exit-after-report per the r577-correction doctrine.
 */

import {
  eligiblePrecedents,
  precedentRetrieval,
  type PrecedentRow,
} from "../src/lib/precedent-lane";
import { ANCHOR_TAG, TARGET_TAG } from "../src/lib/looped-icl";

let pass = 0;
const fails: string[] = [];
function check(name: string, cond: boolean): void {
  if (cond) {
    pass += 1;
  } else {
    fails.push(name);
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────
const ROWS: PrecedentRow[] = [
  {
    id: "p1",
    workflowName: "Novelty Lab",
    task: "summarize the weekly research digest into novelty moves",
    output: "Executed 27 moves: proposed, judged and drained the queue with zero failures. Verdicts 0A/0W/0S.",
    status: "done",
  },
  {
    id: "p2",
    workflowName: "Digest Mailer",
    task: "draft the weekly digest email for the owner",
    output: "Drafted a 6-paragraph digest with the radar findings table inline.",
    status: "done",
  },
  {
    id: "p3",
    workflowName: "Broken Run",
    task: "summarize the weekly research digest into novelty moves",
    output: "",
    status: "done",
  },
  {
    id: "p4",
    workflowName: "Placeholder Run",
    task: "summarize the weekly research digest into novelty moves",
    output: "(no output recorded)",
    status: "done",
  },
  {
    id: "p5",
    workflowName: "Blind Lineage",
    task: "summarize the weekly research digest into novelty moves",
    output: "Looks fine but the caller says its rows are blind.",
    status: "done",
    lineageOk: false,
  },
  { id: "p6", workflowName: "Failed Run", task: "digest", output: "content", status: "error" },
];

// ── 1. the honesty filter ────────────────────────────────────────────────
const elig = eligiblePrecedents(ROWS);
check("filter: only done rows", elig.every((r) => r.status === "done"));
check("filter: empty output refused (impersonates evidence)", !elig.some((r) => r.id === "p3"));
check("filter: the (no output recorded) marker refused (F6 wrapper shape)", !elig.some((r) => r.id === "p4"));
check("filter: lineageOk=false refused (blind rows are not quotable)", !elig.some((r) => r.id === "p5"));
check("filter: errored rows refused", !elig.some((r) => r.id === "p6"));
check("filter: clean rows kept", elig.some((r) => r.id === "p1") && elig.some((r) => r.id === "p2"));
check("filter: garbage input never throws", eligiblePrecedents(undefined as never).length === 0);
check("filter: deterministic", JSON.stringify(eligiblePrecedents(ROWS)) === JSON.stringify(eligiblePrecedents(ROWS)));

// ── 2. retrieval + two-occurrence assembly ───────────────────────────────
const q = "summarize the weekly research digest into novelty moves";
const lane = precedentRetrieval(q, ROWS, 2);
check("lane: retrieval returns the top-2 contract", lane.exemplars.length === 2);
check("lane: rank-1 is the strongest lexical match (p1)", lane.exemplars[0]?.id === "p1");
check("lane: rrf scores sorted descending", lane.exemplars[0].rrfScore >= lane.exemplars[1].rrfScore);
check("lane: note is countable (Precedent lane — prefix)", lane.note.startsWith("Precedent lane —"));
check("lane: note names eligible count + both exemplars", lane.note.includes("2 eligible") && lane.note.includes("p1") === false && lane.note.includes("Novelty Lab") && lane.note.includes("Digest Mailer"));
check("lane: legs vocabulary is both|single", lane.exemplars.every((e) => e.legs === "both" || e.legs === "single"));
check("lane: prompt block assembled", lane.promptBlock.length > 0);
check("lane: anchor occurrence uses the looped-icl ANCHOR_TAG", lane.promptBlock.includes(ANCHOR_TAG));
check("lane: target occurrence uses the looped-icl TARGET_TAG", lane.promptBlock.includes(TARGET_TAG));
check("lane: generation point adjacent to the target (Generate now:)", lane.promptBlock.includes("Generate now:"));
check("lane: two-occurrence invariant — the rank-1 excerpt appears TWICE", lane.promptBlock.split(lane.exemplars[0].excerpt).length - 1 === 2);
check("lane: anchor precedes target (induction grows with position)", lane.anchorIndex >= 0 && lane.targetIndex > lane.anchorIndex);
check("lane: rank-2 rides the anchor zone exactly once (no target dilution)", lane.promptBlock.split(lane.exemplars[1].excerpt).length - 1 === 1);
check("lane: supporting precedent named in the block", lane.promptBlock.includes("Supporting precedent (Digest Mailer"));
check("lane: excerpt cap respected", lane.exemplars.every((e) => e.excerpt.length <= 600));
check("lane: prompt block cap respected", lane.promptBlock.length <= 4001);

// ── 3. edges ─────────────────────────────────────────────────────────────
const none = precedentRetrieval(q, [], 2);
check("edge: empty corpus => empty lane", none.exemplars.length === 0 && none.promptBlock === "" && none.eligible === 0);
const noQuery = precedentRetrieval("   ", ROWS, 2);
check("edge: blank query => no exemplars, eligible count still told", noQuery.exemplars.length === 0 && noQuery.eligible === 2);
const one = precedentRetrieval(q, ROWS, 1);
check("edge: topN=1 => single exemplar, no supporting block", one.exemplars.length === 1 && !one.promptBlock.includes("Supporting precedent"));
const clamp = precedentRetrieval(q, ROWS, 99);
check("edge: topN clamped at 4", clamp.exemplars.length <= 4);
const garbage = precedentRetrieval(undefined as never, undefined as never, 2);
check("edge: garbage input never throws => empty lane", garbage.exemplars.length === 0 && garbage.note === "");
const nonMatch = precedentRetrieval("quantum chromodynamics lattice gauge repair", ROWS, 2);
check("edge: off-domain query stays structural (eligible told, <=2 exemplars, countable note)", nonMatch.eligible === 2 && nonMatch.exemplars.length <= 2 && nonMatch.note.startsWith("Precedent lane"));
check("edge: deterministic end to end", JSON.stringify(precedentRetrieval(q, ROWS, 2)) === JSON.stringify(precedentRetrieval(q, ROWS, 2)));

// ── verdict ─────────────────────────────────────────────────────────────
const total = pass + fails.length;
console.log(`QA:PRECEDENT-LANE ${pass}/${total} checks PASS`);
if (fails.length > 0) {
  console.log(fails.map((f) => `FAIL ${f}`).join("\n"));
  process.exitCode = 1;
}
