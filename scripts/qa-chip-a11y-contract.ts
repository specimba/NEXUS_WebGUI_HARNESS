/**
 * r688 — qa-chip-a11y-contract: pins the chip family's a11y doctrine in
 * src/components/nexus/workflows/run-kanban.tsx as a runnable source
 * contract — the legacy of the r685/r686/r687 slices:
 *   1. focusable => named — every span[tabIndex={0}] chip carries an
 *      aria-label BEFORE its className (5 sites: digest ⧉ ledger + ⚖ gate
 *      census, per-run ⚖ gate + ↻ looped + harness). A future focusable
 *      chip without a spoken name fails HERE, not in front of a
 *      screen-reader user (native titles are not reliably read by AT).
 *   2. title-bearing => pointer-honest — every title-bearing chip in the
 *      family carries cursor-help (9 sites: the five above + the
 *      hover-only ⌈floor gate-floor chip, whose r686 named exclusion from
 *      the tab order stands + the r690 ⧉ freshness token, likewise
 *      hover-only — its parent ⧉ chip is the focusable surface + the r691
 *      ▲ session-growth badge + the r692 ⚖ gate freshness token, same
 *      exclusion).
 *   3. Self-test — the checker demonstrably FAILS on synthetic bad chip
 *      blocks. A contract fixture that can never go red checks nothing.
 * This is a source-contract fixture by design: the chips render only when
 * live data does (most runs carry no gate notes), so a DOM probe would
 * witness the contract only on lucky rounds — the source pins it always.
 * Run: bun scripts/qa-chip-a11y-contract.ts
 */
import { readFileSync } from "node:fs";

const FILE = "src/components/nexus/workflows/run-kanban.tsx";
const src = readFileSync(FILE, "utf8");
const lines = src.split("\n");

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
  } else {
    fail += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * The named-before-class probe: scanning forward from an attribute line,
 * an aria-label must appear before the className line. All five chips
 * order their opening-tag attrs tabIndex → title → aria-label → className;
 * an unnamed focusable chip hits className first and fails here.
 */
function namedBeforeClass(block: string[], fromIdx: number): boolean {
  for (let i = fromIdx + 1; i < Math.min(fromIdx + 13, block.length); i++) {
    const line = block[i] ?? "";
    if (/className=\{/.test(line)) return false;
    if (/aria-label=\{/.test(line)) return true;
  }
  return false;
}

/**
 * The pointer probe: from a chip anchor line (rendered text or an attribute
 * — both live inside the opening tag), walk BACK to the nearest <span, then
 * FORWARD through the opening tag's attribute block for cursor-help.
 * Structure-aware, no line windows: inner marker spans never precede the
 * outer chip's className line, so cross-matches are impossible.
 */
function chipHasCursorHelp(block: string[], anchorIdx: number): boolean {
  let spanIdx = anchorIdx;
  while (spanIdx >= 0 && !/<span\b/.test(block[spanIdx] ?? "")) spanIdx--;
  if (spanIdx < 0) return false;
  for (let i = spanIdx; i < Math.min(spanIdx + 16, block.length); i++) {
    if (/cursor-help/.test(block[i] ?? "")) return true;
  }
  return false;
}

function lineOfIndex(index: number): number {
  return src.slice(0, index).split("\n").length - 1;
}

// ─── 1. focusable => named ────────────────────────────────────────────────────
const tabLines = Array.from(src.matchAll(/tabIndex=\{0\}/g), (m) => lineOfIndex(m.index ?? 0));
check(
  "focusable chip count pinned (5: digest ⧉+⚖, per-run ⚖+↻+harness)",
  tabLines.length === 5,
  `got ${tabLines.length} — a chip joined or left the keyboard contract; extend this fixture and give the newcomer an aria-label`,
);
tabLines.forEach((ln, i) =>
  check(`focusable chip #${i + 1} (line ${ln + 1}) is named`, namedBeforeClass(lines, ln), "aria-label must precede className in the opening tag"),
);

// ─── 2. title-bearing => pointer-honest ───────────────────────────────────────
const cursorLines = Array.from(src.matchAll(/cursor-help/g), (m) => lineOfIndex(m.index ?? 0));
check(
  "cursor-help count pinned (9 title-bearing chips)",
  cursorLines.length === 9,
  `got ${cursorLines.length} — a title-bearing chip joined the family without the pointer affordance`,
);
const anchors: Array<[string, RegExp]> = [
  ["⌈floor gate-floor chip", /⌈floor \{met\}/],
  ["↻ looped-depth chip", /↻ looped \{loopedStep\.looped\.k\}/],
  ["per-run ⚖ gate chip", /⚖ gate \{census\.engaged\}/],
  ["harness n/n chip", /Harness reliability/],
  ["digest ⚖ gate census chip", /\{boardGates\.engaged\} gate call/],
  ["digest ⧉ ledger chip", /⧉ ledger \{ledger\.total\}/],
  ["⧉ freshness token", /· \{ledgerAge\}/],
  ["⧉ session-growth badge", /▲\{ledgerGrowth\}/],
  ["⚖ gate freshness token", /· \{gateAge\}/],
];
anchors.forEach(([name, re]) => {
  const ln = lines.findIndex((l) => re.test(l));
  check(`${name} anchor exists`, ln !== -1, `marker ${re} not found — the chip's rendered text changed; update the anchor`);
  if (ln === -1) return;
  check(`${name} carries cursor-help`, chipHasCursorHelp(lines, ln), `no cursor-help in the chip's opening tag (anchor line ${ln + 1})`);
});

// ─── 3. self-test: the checker catches violations ────────────────────────────
const goodChip = ["<span", "  tabIndex={0}", '  title={"t"}', '  aria-label={"a"}', '  className={cn("x")}', ">"];
const reorderedChip = ["<span", "  tabIndex={0}", '  title={"t"}', '  className={cn("x")}', '  aria-label={"a"}', ">"];
const unnamedChip = ["<span", "  tabIndex={0}", '  title={"t"}', '  className={cn("x")}', ">"];
check("self-test: good chip passes", namedBeforeClass(goodChip, 1) === true);
check("self-test: className-before-aria-label fails", namedBeforeClass(reorderedChip, 1) === false);
check("self-test: unnamed chip fails", namedBeforeClass(unnamedChip, 1) === false);
const pointerChip = ["<span", '  title={"t"}', '  className={cn("cursor-help x")}', ">", "  ⧉ text"];
const bareChip = ["<span", '  title={"t"}', '  className={cn("x")}', ">", "  text"];
check("self-test: pointer probe finds cursor-help", chipHasCursorHelp(pointerChip, 4) === true);
check("self-test: pointer probe flags its absence", chipHasCursorHelp(bareChip, 4) === false);

console.log(`\nqa-chip-a11y-contract: ${pass} passed, ${fail} failed (${FILE})`);
if (fail > 0) process.exit(1);
