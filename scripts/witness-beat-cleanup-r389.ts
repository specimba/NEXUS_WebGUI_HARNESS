// r389 witness — the noop-beat cleanup decision, imported from the REAL
// chat-heartbeat module (r385 pure-function witness pattern: bun + TS import).
// The OLD code ran truncateFrom(inclusive) in ALL four shapes below — shapes
// 2 and 3 are the data-loss fix: a user turn landing mid-beat must survive.
import { beatNoopCleanup } from "../src/components/praison/chat/chat-heartbeat";

const cases: Array<[string, string[], string, string]> = [
  ["fresh silent beat (placeholder still last)", ["m1", "hb1"], "hb1", "truncate"],
  ["user msg landed mid-beat (THE fix)", ["m1", "hb1", "u2"], "hb1", "delete-one"],
  ["user msg + reply landed mid-beat", ["m1", "hb1", "u2", "a2"], "hb1", "delete-one"],
  ["empty list (conv mutated mid-flight)", [], "hb1", "delete-one"],
];

let pass = 0;
let fail = 0;
for (const [name, msgs, id, want] of cases) {
  const got = beatNoopCleanup(
    msgs.map((mid) => ({ id: mid })),
    id,
  );
  if (got === want) {
    console.log(`PASS: ${name} -> ${got}`);
    pass++;
  } else {
    console.log(`FAIL: ${name} -> ${got}, want ${want}`);
    fail++;
  }
}
console.log(fail === 0 ? `WITNESS: ${pass}/${cases.length}` : `WITNESS FAILED: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
