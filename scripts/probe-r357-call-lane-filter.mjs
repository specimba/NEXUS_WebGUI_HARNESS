// r357 probe — CallLogList lane filter (static pins).
// The shared grouped call-log renderer (recovery card + history expander)
// must gain a ⇄/⊙ lane lens: chips carry counts + aria-pressed, global #N
// numbering survives filtering (groupCallLog takes PAIRED entries), the
// resilience digest stays computed from the FULL log, and a lane with zero
// calls gets an honest empty state instead of a silent blank.
import { readFileSync } from "node:fs";

const FILE = "src/components/praison/workflows/workflow-run-panel.tsx";
const src = readFileSync(FILE, "utf8");

let pass = 0;
let fail = 0;
function ok(cond, label) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}`);
  }
}

console.log("probe-r357-call-lane-filter");

// ── 1. Lane derivation — single truth with the laneChip predicate ──
ok(
  /function laneOf\(c: RunCallLogEntry\): "relay" \| "direct" \| null \{[\s\S]*?startsWith\("server relay"\)[\s\S]*?startsWith\("browser-direct"\)/.test(src),
  "laneOf derives relay/direct from the same note prefixes laneChip counts",
);
ok(
  src.includes('if (n.startsWith("server relay")) return "relay";') &&
    src.includes('if (n.startsWith("browser-direct")) return "direct";'),
  "laneOf returns the lane kinds explicitly (null for legacy laneless notes)",
);
ok(/type CallLane = "all" \| "relay" \| "direct";/.test(src), "CallLane union declared");

// ── 2. Numbering survives the filter — paired entries, not bare indices ──
ok(
  src.includes("function groupCallLog(log: { c: RunCallLogEntry; idx: number }[])"),
  "groupCallLog takes paired {c, idx} entries (global numbering through filters)",
);
ok(
  /log\.forEach\(\(\{ c, idx \}\) => \{/.test(src),
  "groupCallLog destructures the pair (no re-indexing of filtered arrays)",
);
ok(
  src.includes("const paired = React.useMemo(() => log.map((c, idx) => ({ c, idx })), [log]);"),
  "pairs are built from the FULL log before any lane filter",
);
ok(
  /const visible = React\.useMemo\(\s*\n\s*\(\) => \(lane === "all" \? paired : paired\.filter\(\(\{ c \}\) => laneOf\(c\) === lane\)\),/.test(src),
  "filter applies to the paired list (idx preserved), not a re-mapped array",
);

// ── 3. Digest semantics — full-log truth ──
ok(
  src.includes("const d = resilienceDigest(log);"),
  "resilience digest computed from the FULL log, not the filtered view",
);
ok(!src.includes("resilienceDigest(visible)"), "digest never runs on the filtered set");

// ── 4. Chips UI — counts, a11y, honest titles ──
ok(src.includes('aria-label="Filter calls by lane"'), "chip row carries role-group + aria-label");
ok(
  /aria-pressed=\{lane === chip\.id\}/.test(src),
  "each chip exposes aria-pressed (toggle state, r355 a11y convention)",
);
ok(
  src.includes("label: `all ${log.length}`") &&
    src.includes("label: `⇄ relay ${laneCounts.relay}`") &&
    src.includes("label: `⊙ direct ${laneCounts.direct}`"),
  "chips show counts (all N · ⇄ relay M · ⊙ direct K)",
);
ok(
  src.includes("the key stayed in your browser"),
  "direct chip title explains the lane in plain language",
);
ok(
  /laneCounts\.relay \+ laneCounts\.direct > 0 \? \(/.test(src),
  "chip row hidden entirely when no call carries a lane marker (legacy logs stay clean)",
);

// ── 5. Empty state — a zero lane says so, never renders a silent blank ──
ok(
  src.includes("no {lane === \"relay\" ? \"relay\" : \"browser-direct\"} calls recorded on this run"),
  "zero-call lane renders the honest empty-state line",
);
ok(
  /\{visible\.length === 0 \? \(/.test(src) && /\)\}\s*\n    <\/>/.test(src),
  "list is conditional on visible.length (ternary closes with )} before the fragment end)",
);

// ── 6. Shared surface contract — both consumers still pass just the log ──
ok(
  (src.match(/<CallLogList log=\{[^}]+\} \/>/g) || []).length >= 1,
  "CallLogList call sites unchanged (log prop only — filter is internal state)",
);
ok(src.includes("function CallLogList({ log }: { log: RunCallLogEntry[] })"), "CallLogList signature unchanged");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
