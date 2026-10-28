/**
 * r672: fixture for gateEventsOf — the RSI ledger's event extractor (dial-free).
 * Pins the 7 note families from the runner to typed events, with the
 * note-head anchoring doctrine (tail text can never mint an event).
 */
import { gateEventsOf } from "../src/lib/gate-census";

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; } else { fail += 1; console.log("FAIL: " + name); }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 1. system-one verdict (with role via)
const e1 = gateEventsOf([{ note: "System-One gate FAIL 95% (role:novelty) — rework → full verification pass runs" }]);
check("sys-one fail → verdict event", e1.length === 1 && e1[0].kind === "gate-verdict" && e1[0].verdict === "FAIL" && e1[0].confidence === 95 && e1[0].via === "role:novelty");

// 2. system-one pass, no via
const e2 = gateEventsOf([{ note: "System-One gate PASS 88% — flagship verification pass skipped" }]);
check("sys-one pass no via", e2.length === 1 && e2[0].verdict === "PASS" && e2[0].confidence === 88 && e2[0].via === undefined);

// 3. decision gate fast-model verdict
const e3 = gateEventsOf([{ note: "Decision gate PASS 95% (fast-model) — output accepted" }]);
check("fast-model pass → verdict + via", e3.length === 1 && e3[0].verdict === "PASS" && e3[0].via === "fast-model");

// 4. uncertain
const e4 = gateEventsOf([{ note: "Decision gate uncertain 40% (fast-model) — no confident verdict; output accepted unchanged" }]);
check("uncertain event", e4.length === 1 && e4[0].kind === "gate-uncertain" && e4[0].confidence === 40 && e4[0].via === "fast-model");

// 5. no-judge (with tried-ladder trace that MENTIONS percents — must not mint)
const e5 = gateEventsOf([{ note: "Decision gate engaged but no judge answered (tried: intern-systemone — not armed; fast-judge at 95% congestion) — output accepted unchanged (verdict not possible, not a pass)" }]);
check("no-judge event, no minted verdict", e5.length === 1 && e5[0].kind === "gate-no-judge" && e5[0].verdict === undefined);

// 6. judge errored
const e6 = gateEventsOf([{ note: "Decision gate judge errored — no verdict arrived; output accepted unchanged (infra stop, not quality) (tried: fast-judge A)" }]);
check("judge-error event", e6.length === 1 && e6[0].kind === "gate-judge-error");

// 7. the live c0c31b shape → 2 verdict events, latest FAIL
const e7 = gateEventsOf([
  { note: "System-One gate FAIL 95% — rework → full verification pass runs" },
  { note: "Decision gate FAIL 95% (fast-model) — one free rework pass runs" },
]);
check("c0c31b: two verdict events", e7.length === 2 && e7.every(e => e.kind === "gate-verdict" && e.verdict === "FAIL"));

// 8. non-gate notes ignored (relay, precedent, blind-score)
const e8 = gateEventsOf([
  { note: "Model relay: primary (deepseek-v4.1) answered ✓" },
  { note: "Precedent lane — 13 eligible precedents" },
  { note: "Peer blind score FAIL 80% — revise" },
]);
check("non-gate notes → zero events", e8.length === 0);

// 9. junk tolerance
const e9 = gateEventsOf([null, {}, { note: 42 as unknown as string }] as { note?: string }[]);
check("junk rows → zero events", e9.length === 0);

// 10. note cap at 500
const long = "Decision gate judge errored — " + "x".repeat(900);
const e10 = gateEventsOf([{ note: long }]);
check("note capped at 500", e10.length === 1 && e10[0].note.length === 500);

// 11. census consistency: events' verdict count == census.verdicts on the same log
import { gateCensusOf } from "../src/lib/gate-census";
const log = [
  { note: "System-One gate FAIL 95% — rework" },
  { note: "Decision gate PASS 95% (fast-model) — output accepted" },
  { note: "Decision gate engaged but no judge answered (tried: x) — output accepted unchanged" },
];
const evs = gateEventsOf(log).filter(e => e.kind === "gate-verdict").length;
const cen = gateCensusOf(log).verdicts;
check("census/event agreement", evs === cen && evs === 2);

// 12. empty inputs
check("null log → zero", gateEventsOf(null).length === 0);
check("empty log → zero", gateEventsOf([]).length === 0);

console.log(`qa-gate-events: ${pass}/${pass + fail}`);
if (fail > 0) process.exit(1);
