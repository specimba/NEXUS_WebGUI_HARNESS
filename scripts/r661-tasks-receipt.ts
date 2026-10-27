// r661: insert the live-witness receipt into the TASKS.md Looped entry,
// right after its "Open unchanged:" sentence (exact-string anchor; exits 1
// without writing if the anchor is absent).
import { readFileSync, writeFileSync } from "node:fs";

const p = "docs/strategy/TASKS.md";
const src = readFileSync(p, "utf8");

const anchor =
  "Open unchanged: a live run where the judge ANSWERS (confident PASS/FAIL) — needs a less congested window.";
const receipt =
  ' r661 receipt: 6th live run (morning window, 2164-char output) — the gate ENGAGED and the r660 no-judge line FIRED LIVE ×2, once per gated step (authored + standard-depth synthetic verification): "Decision gate engaged but no judge answered — output accepted unchanged (verdict not possible, not a pass)"; run done/done, looped correctly never engaged (no FAIL), fixture removed 6/6. The visible-line contract is now live-proven end to end; the confident-verdict line stays the sole open witness — judge answered 0/6 live runs (judge-availability-gated, not code-gated).';

if (!src.includes(anchor)) {
  console.error("ANCHOR NOT FOUND");
  process.exit(1);
}
if (src.includes("r661 receipt:")) {
  console.error("ALREADY INSERTED");
  process.exit(1);
}
writeFileSync(p, src.replace(anchor, anchor + receipt));
console.log("INSERTED r661 receipt after the Open-unchanged sentence");
