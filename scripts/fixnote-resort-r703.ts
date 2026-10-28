// r703 codemod v3: restore the r242 doctrine — FIXES stays CHRONOLOGICAL
// ascending (oldest→newest, new receipts append at the bottom); the component
// renders [...FIXES].reverse() so the newest receipt displays first. The
// r696-r700 receipts were stranded mid-array (descending block) under the
// r674-r682 run, scrambling both the display order and RANGE_LABEL. This
// parses multi-line entry blocks, tolerates+preserves comment lines, sorts
// ASCENDING (stable), appends the r703 fix note + owed r702 note at the
// bottom, and aborts without writing on any parse surprise.
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/components/nexus/settings/whats-fixed.tsx";
const src = readFileSync(FILE, "utf8");

const headMarker = "const FIXES: FixNote[] = [\n";
const start = src.indexOf(headMarker);
if (start < 0) throw new Error("FIXES head not found");
const bodyStart = start + headMarker.length;
const endLineIdx = src.slice(bodyStart).split("\n").findIndex((l) => l === "];");
if (endLineIdx < 0) throw new Error("FIXES close not found");
const lines = src.slice(bodyStart).split("\n").slice(0, endLineIdx);

const startRe = /^  \{ round: "r(\d+)"/;
const blocks: { round: number; text: string }[] = [];
const comments: string[] = [];
let cur: string[] | null = null;
let inBacktick = false;
for (const line of lines) {
  // Track template-literal state so `{`/`},` inside multi-line strings are
  // never mistaken for structure (abort-guarded, so a wrong guess aborts).
  const bt = (line.match(/\\?`/g) ?? []).length; // count backticks (crude: escaped ones pair up)
  const wasInBacktick = inBacktick;
  inBacktick = (Number(inBacktick) + bt) % 2 === 1;
  const opensBlock = !wasInBacktick && !inBacktick && (startRe.test(line) || line.trim() === "{");
  if (opensBlock && cur === null) {
    cur = [line];
  } else if (cur !== null) {
    cur.push(line);
    const t = line.trim();
    if (!inBacktick && (t.endsWith("},") || t === "}")) {
      const rm = cur.join("\n").match(/round: "r(\d+)/); // leading number: range labels like "r187-r188" sort by their first round
      if (!rm) throw new Error(`entry block without a round marker: FIRST 400 CHARS: ${cur.join("\n").slice(0, 400)}`);
      blocks.push({ round: Number(rm[1]), text: cur.join("\n") });
      cur = null;
    }
  } else if (line.trim().startsWith("//")) {
    comments.push(line);
  } else if (line.trim() === "") {
    continue;
  } else {
    throw new Error(`stray line outside entry block: ${line.slice(0, 90)}`);
  }
}
if (cur !== null) throw new Error("unterminated entry block at array end");
console.log(`parsed blocks: ${blocks.length}, comments preserved: ${comments.length}`);
if (blocks.length < 100) throw new Error(`expected 100+ entries, got ${blocks.length}`);

// Stable sort ASCENDING per the r242 doctrine (newest appends at bottom).
blocks.sort((a, b) => a.round - b.round);

const note703 = `  { round: "r703", title: "The What's-fixed ledger reads newest-first again — the r242 chronological doctrine restored", detail: "QA-adjacent catch while paying the r702 FixNote debt: the panel renders [...FIXES].reverse() (the r242 contract: array chronological oldest→newest, display newest-first), but the array itself was scrambled — an ascending r674→r682 run sat at the TOP, the r696-r700 receipts were stranded mid-array as a descending block, and the panel's actual first paint was a week-old note (the reversed array surfaced the r668 tail). RANGE_LABEL read from the wrong ends too. A one-off codemod (scripts/fixnote-resort-r703.ts, kept as the recoverable artifact) parsed all 100+ multi-line entry blocks, preserved the in-array doctrine comments, restored strict chronological order, and appends new receipts at the bottom again. The owed r702 note rides at the bottom of the array = top of the panel, with this note above it.", lookFor: "Settings → What's fixed: the first receipt is r703, then r702, then r700 — and the header range label reads oldest→newest in one direction." },`;
const note702 = `  { round: "r702", title: "The intel vintage badge answers the pointer — tone-faithfully, dashed = provisional preserved", detail: "The r697/r700 pointer-answer doctrine had one remaining gap on the Model Relay card: the intel vintage badge (live boards · HH:MM / snapshot · HH:MM) carried a full-sentence title since r605 but gave the pointer no visual answer. It now brightens through its own tone channel per state — live arm emerald border /40→/70 + wash /10→/20, snapshot arm amber the same steps with its dashed border preserved (dashed = provisional fallback stays legible) — over transition-colors duration-500, the r690 fade doctrine, nothing snaps. Round context: the first confident verdicts on the fresh corpus landed (census 14 · verdicts 2 · fails 1, board re-lit emerald, witnessed), and the r701 redaction 'ready slice' dissolved under inspection — the choke already covered the relay lane (a grep quote-form miss).", lookFor: "Settings → Model Relay → Benchmark intelligence: hover the vintage badge — its emerald (live) or amber (snapshot) border and wash deepen, and fade back on leave." },`;
// r704: append neutralized — the r702/r703 notes are already in the array; a rerun must not duplicate them

const tailPart = src.slice(bodyStart).split("\n").slice(endLineIdx + 1).join("\n");
const rebuilt = headMarker + comments.join("\n") + "\n" + blocks.map((b) => b.text).join("\n") + "\n];";
writeFileSync(FILE, src.slice(0, start) + rebuilt + tailPart);
console.log(`wrote ${blocks.length} entries ascending: r${blocks[0].round} -> r${blocks[blocks.length - 1].round}`);
