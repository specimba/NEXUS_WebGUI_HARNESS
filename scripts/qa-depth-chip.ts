/**
 * r304 — behavioral unit suite for lib/depth-chip.ts (the "deep paused" card
 * chip). Before r304 the chip hardcoded "deep paused · firing standard"
 * whenever a Deep workflow's failStreak hit 2 — even while the failure breaker
 * or a 429 backoff had the schedule PAUSED (nothing fires at all then; the lie
 * was witnessed live stacked on the "auto-paused · click to resume" chip).
 * The rule now lives in one dependency-free module the board renders verbatim.
 * Run: bun run scripts/qa-depth-chip.ts
 */
import { deepPauseChip } from "../src/lib/depth-chip";

let pass = 0, fail = 0;
function ok(cond: boolean, name: string, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Enabled schedule + streak ≥ 2 → scheduled fires degrade, chip says so.
const enabled = deepPauseChip({
  depth: "deep",
  schedule: { enabled: true, failStreak: 2 },
});
ok(enabled?.label === "deep paused · firing standard", "enabled schedule: label names firing standard", `got "${enabled?.label}"`);
ok(!!enabled?.title.includes("scheduled fires run Standard"), "enabled schedule: title explains the degradation");
ok(!!enabled?.title.includes("manual Run keeps Deep"), "enabled schedule: title keeps the manual-depth promise");

// THE r304 FIX — paused schedule must NOT claim "firing standard".
const breaker = deepPauseChip({
  depth: "deep",
  schedule: { enabled: false, failStreak: 3 },
});
ok(breaker?.label === "deep paused", "breaker-paused: label drops the firing claim", `got "${breaker?.label}"`);
ok(!breaker?.label.includes("firing standard"), "breaker-paused: label never says 'firing standard'");
ok(!!breaker?.title.includes("auto-paused by the failure breaker"), "breaker-paused: title names the breaker");
ok(!!breaker?.title.includes("nothing fires at all"), "breaker-paused: title says nothing fires");
ok(!!breaker?.title.includes("manual Runs keep the authored Deep depth"), "breaker-paused: title keeps the manual-depth promise");

// Congestion backoff: also paused (self-healing), also no firing claim.
const backoff = deepPauseChip({
  depth: "deep",
  schedule: { enabled: false, failStreak: 2, autoResumeAt: Date.now() + 5 * 60_000 },
});
ok(backoff?.label === "deep paused", "429 backoff: label drops the firing claim", `got "${backoff?.label}"`);
ok(!backoff?.label.includes("firing standard"), "429 backoff: label never says 'firing standard'");
ok(!!backoff?.title.includes("rate-limit backoff"), "429 backoff: title names the backoff");
ok(/auto-resume in ~\d+m/.test(backoff?.title ?? ""), "429 backoff: title carries the auto-resume ETA", `got "${backoff?.title}"`);

// Null cases — the chip must not exist.
ok(deepPauseChip({ depth: "deep", schedule: { enabled: true, failStreak: 1 } }) === null, "streak 1 → null (below degrade threshold)");
ok(deepPauseChip({ depth: "deep", schedule: { enabled: true } }) === null, "no streak → null");
ok(deepPauseChip({ depth: "standard", schedule: { enabled: true, failStreak: 5 } }) === null, "standard depth → null");
ok(deepPauseChip({ depth: "quick", schedule: { enabled: false, failStreak: 9 } }) === null, "quick depth paused → null");
ok(deepPauseChip({ depth: "deep", schedule: null }) === null, "no schedule → null");
ok(deepPauseChip({}) === null, "bare workflow → null");

// Streak scaling: the number surfaces in every title (3 ≠ 2).
ok(!!enabled?.title.startsWith("Deep passes are paused after 2 consecutive"), "enabled title cites the streak");
ok(!!breaker?.title.startsWith("Deep passes are paused after 3 consecutive"), "paused title cites its own streak");

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);

// ── Source-level wiring asserts (qa-depth-degrade pattern) ───────────────────
// The in-vivo sweep can only witness the paused branch when a paused Deep
// pipeline actually exists on the board; these asserts pin the render wiring
// so the chip path cannot silently detach from the module.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const view = readFileSync(
  join(process.cwd(), "src/components/nexus/workflows/workflows-view.tsx"),
  "utf8"
);
let wpass = 0, wfail = 0;
function wire(cond: boolean, name: string) {
  if (cond) { wpass++; console.log(`  ✓ ${name}`); }
  else { wfail++; console.log(`  ✗ ${name}`); }
}
wire(
  view.includes(`import { deepPauseChip } from "@/lib/depth-chip";`),
  "view imports deepPauseChip from lib/depth-chip"
);
wire(
  view.includes("const chip = deepPauseChip(wf);") && view.includes('{chip.label}'),
  "card render derives the chip from the module and prints its label"
);
wire(
  view.includes('data-testid="deep-pause-chip"'),
  "chip carries the DOM handle the QA sweep reads"
);
wire(
  !view.includes("deep paused · firing standard"),
  "view no longer hardcodes the full chip label (module is the single source)"
);
console.log(`  ${wpass}/${wpass + wfail} wiring asserts passed`);
process.exit(wfail === 0 ? 0 : 1);
