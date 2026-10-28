/**
 * qa-family-witness — r676 fixture.
 *
 * Freezes the NOTE CONTRACT between the runner's family-witnessed verdict
 * notes (workflow-runner, via crossFamilyTag) and the run-panel renderer's
 * witness regex /· (cross-family|same-family)/. If a future note rewording
 * drops or reshapes the witness token, this fixture fails BEFORE the board
 * silently loses the drift witness.
 *
 * The split under test IS the shipped helper — r677 lifted the regex to
 * src/lib/family-witness.ts (panel + ledger tally import the same home).
 */
import { crossFamilyTag } from "../src/lib/systemone";
import { splitFamilyWitness } from "../src/lib/family-witness";

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.error(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  }
}

const split = splitFamilyWitness;

// 1. Tag vocabulary — the runner composes notes as (via + tag)
check("tag cross", crossFamilyTag({ judgeFamily: "zai", crossFamily: true }), " · cross-family");
check("tag same", crossFamilyTag({ judgeFamily: "zai", crossFamily: false }), " · same-family");
check("tag unknown empty", crossFamilyTag(null), "");
check("tag no-family empty", crossFamilyTag({ judgeFamily: undefined }), "");

// 2. Decision-gate PASS shape (witness trailing inside the via-paren)
const g1 = `Decision gate PASS 95% (fast-model${crossFamilyTag({ judgeFamily: "typesafe", crossFamily: true })})`;
check("gate PASS split", split(g1), { head: "Decision gate PASS 95% (fast-model ", witness: "cross", tail: ")" });

// 3. Decision-gate FAIL mid-note shape (rework note composes witness mid-string)
const g2 = `Rework pass delivered after Decision gate FAIL (${gateVia("fast-model::x")}${crossFamilyTag({ judgeFamily: "zai", crossFamily: false })}) — output replaced`;
check("rework mid-note split", split(g2), {
  head: "Rework pass delivered after Decision gate FAIL (fast-model ",
  witness: "same",
  tail: ") — output replaced",
});

// 4. Peer blind score trailing shape (r674 vocabulary)
const g3 = `Peer blind score PASS 92% (intern-decision-4b${crossFamilyTag({ judgeFamily: "intern-ai", crossFamily: true })})`;
check("peer trailing split", split(g3), { head: "Peer blind score PASS 92% (intern-decision-4b ", witness: "cross", tail: ")" });

// 5. Pre-r673 verdicts render no tag — the renderer must NOT chip them
const plain = [
  "Decision gate PASS 95% (fast-model)",
  "Looped exit at pass 1/2 (pass-verdict) — output accepted",
  "Decision gate judge errored — no verdict arrived; output accepted unchanged (infra stop, not quality) (tried: vyce::m)",
  "Decision gate engaged but no judge answered — output accepted unchanged",
  "Blind-revise pass delivered after Peer blind score FAIL (fast-model) — output replaced",
  "Looped pass 1/2 delivered (tied block) — re-judging",
];
for (const [i, note] of plain.entries()) {
  check(`plain note ${i} no witness`, split(note), null);
}

// 6. Census-compat: the suffix was frozen parseable in qa-cross-family — the
// extractor anchors on note HEADS, so head text must be unchanged by split.
const headed = `Decision gate FAIL 90% (fast-model${crossFamilyTag({ judgeFamily: "zai", crossFamily: true })}) — output replaced`;
check("head preserved for note-head anchoring", (split(headed)?.head ?? "").startsWith("Decision gate FAIL 90% (fast-model"), true);

// 7. First-match-wins: a pathological note mentioning both tokens keeps the
// FIRST witness (renderer chips one, prose keeps the rest verbatim).
const both = "A · cross-family then B · same-family";
check("first match wins", split(both), { head: "A ", witness: "cross", tail: " then B · same-family" });

// 8. Junk safety: empty/whitespace notes pass through untouched.
check("empty note", split(""), null);
check("dot-only note", split("· cross-family"), { head: "", witness: "cross", tail: "" });

function gateVia(hopKey: string): string {
  // mirrors the runner's via rendering: the hop's display name
  return hopKey.includes("::") ? hopKey.split("::")[0] : hopKey;
}

console.log(`qa-family-witness: ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
