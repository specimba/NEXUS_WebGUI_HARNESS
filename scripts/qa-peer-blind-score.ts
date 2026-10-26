// r578 — dial-free QA for the peer blind-scoring pure module (slice 1 of the
// P2 experiment). The runner wiring is source-pinned in
// scripts/qa-executor-resume.ts; this script witnesses the module's own
// contract: blind input shape, threshold semantics, and the three call-log
// note verdicts the crew panel can count.
import {
  BLIND_REVIEW_QUESTION,
  buildBlindReviewInput,
  peerBlindNote,
  peerBlindShouldRevise,
} from "../src/lib/peer-blind-score";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  ✓" : "  ✗"} ${m}`);
  if (c) pass++; else fail++;
};

// 1. Blind input: output only — no task/step/assignment vocabulary, capped.
const longOutput = "x".repeat(6000);
const blind = buildBlindReviewInput(longOutput);
ok(
  blind.startsWith("OUTPUT UNDER BLIND REVIEW:\n") &&
    blind.length <= "OUTPUT UNDER BLIND REVIEW:\n".length + 5000 &&
    !blind.includes("STEP") &&
    !blind.includes("ASSIGNMENT"),
  "blind input carries the output only (header + 5000-char cap, no assignment context)",
);

// 2. Threshold semantics — revise ONLY on a confident no.
ok(
  peerBlindShouldRevise({ answer: "no", confidence: 0.9 }) === true,
  "confident no (≥ gate confidence) → revise",
);
ok(
  peerBlindShouldRevise({ answer: "no", confidence: 0.6 }) === false,
  "uncertain no (< gate confidence) → accept, no revise",
);
ok(
  peerBlindShouldRevise({ answer: "yes", confidence: 0.95 }) === false &&
    peerBlindShouldRevise(null) === false,
  "confident yes / no judge → never revises",
);

// 3. The three note verdicts — distinct, countable patterns.
ok(
  /^Peer blind score PASS \d+% \(.+\) — independent reviewer concurs$/.test(
    peerBlindNote({ answer: "yes", confidence: 0.9, via: "intern-systemone" }),
  ),
  "PASS note matches the countable pattern",
);
ok(
  /^Peer blind score FAIL \d+% \(.+\) — one blind-revise pass runs$/.test(
    peerBlindNote({ answer: "no", confidence: 0.9, via: "fast-judge" }),
  ),
  "FAIL note matches the countable pattern",
);
ok(
  /^Peer blind score UNCERTAIN \d+% \(.+\) — output accepted unchanged$/.test(
    peerBlindNote({ answer: "no", confidence: 0.6, via: "fast-judge" }),
  ),
  "UNCERTAIN note matches the countable pattern",
);

// 4. The question is genuinely blind (no task context baked into the prompt).
ok(
  BLIND_REVIEW_QUESTION.type === "noul" &&
    BLIND_REVIEW_QUESTION.id === "peer-blind" &&
    !BLIND_REVIEW_QUESTION.prompt.includes("assignment"),
  "question shape: noul + peer-blind id + blind prompt",
);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
