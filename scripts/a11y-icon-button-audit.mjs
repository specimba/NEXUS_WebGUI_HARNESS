// r419 a11y audit (extends r150): static low-false-positive scan over all
// praison components for five accessibility classes:
//   1. icon-only <Button size="icon"> without aria-label        (r150 original)
//   2. raw <button> whose whole content is unnamed (icon-only)  (r419)
//   3. clickable div/span with onClick but no role/tabIndex     (r419)
//   4. <img>/<Image> without an alt attribute                   (r419; alt="" is legal)
//   5. <Input>/<input>/<Textarea>/<textarea> with no label plumbing
//      (aria-label | aria-labelledby | id | aria-hidden)        (r419)
// Deliberately NOT scanned (high false-positive risk without a DOM):
// heading order, contrast, live-region coverage, ARIA semantics.
// Exit code stays 0 — this is a report, not a gate.
import fs from "node:fs";
import path from "node:path";

const ROOT = "src/components/praison";
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".tsx")) files.push(p);
  }
})(ROOT);

// Read one JSX tag starting at src[i] === "<", respecting {…} spans so a ">"
// inside an expression doesn't end the tag. Returns the tag text and the
// index just past the closing ">".
function readTag(src, i) {
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === ">" && depth === 0) break;
  }
  return { tag: src.slice(i, j + 1), end: j + 1 };
}

// Index of the matching "</name>" for an element whose tag ends at `from`,
// counting nested same-name opens.
function closeIndex(src, from, name) {
  const open = "<" + name;
  const close = "</" + name;
  let depth = 1;
  let i = from;
  while (i < src.length) {
    const no = src.indexOf("<", i);
    if (no === -1) return -1;
    if (src.startsWith(close, no)) {
      depth--;
      if (depth === 0) return no;
      i = no + close.length;
    } else if (src.startsWith(open, no) && !/[A-Za-z]/.test(src[no + open.length] ?? "")) {
      depth++;
      i = no + open.length;
    } else {
      i = no + 1;
    }
  }
  return -1;
}

// Strip JSX expressions and tags, leaving human-visible text.
function visibleText(jsx) {
  let depth = 0;
  let out = "";
  for (let i = 0; i < jsx.length; i++) {
    const c = jsx[i];
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  return out.replace(/<[^>]*>/g, " ");
}

const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// Precompute comment ranges (line + block) so matches inside comments are
// skipped — the r419 run flagged the literal "<img>" inside a r241 comment.
// String literals are not tracked (a "<button" inside one is rare here, and
// a lexer-lite for strings risks breaking on regex/JSX edge cases).
function commentRanges(src) {
  const ranges = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("//", i)) {
      const end = src.indexOf("\n", i);
      ranges.push([i, end === -1 ? src.length : end]);
      i = end === -1 ? src.length : end;
    } else if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      ranges.push([i, end === -1 ? src.length : end + 2]);
      i = end === -1 ? src.length : end + 2;
    } else {
      i++;
    }
  }
  return ranges;
}

const counts = { iconButton: 0, rawButton: 0, clickableDiv: 0, imgAlt: 0, inputLabel: 0 };
const flags = { iconButton: [], rawButton: [], clickableDiv: [], imgAlt: [], inputLabel: [] };
const flag = (cat, f, line, tag) => {
  flags[cat].push(`${f}:${line}  ${tag.replace(/\s+/g, " ").slice(0, 140)}`);
};

for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const comments = commentRanges(src);
  const inComment = (idx) => comments.some(([a, b]) => idx >= a && idx < b);
  const hasSpread = (tag) => /\{\.\.\./.test(tag);
  // onClick that ONLY stops propagation — a wrapper-zone pattern, not an
  // interactive control (e.g. kanban modal panels inside role="dialog").
  const stopPropagationOnly = (tag) => {
    const m2 = /onClick=\{([^}]*)\}/.exec(tag);
    return !!m2 && /^\s*\(?\w*\)?\s*=>\s*[\w$]+\.stopPropagation\(\)\s*;?\s*$/.test(m2[1]);
  };

  // 1. <Button size="icon"> without aria-label (r150 original heuristic).
  for (const m of src.matchAll(/<Button\b/g)) {
    if (inComment(m.index)) continue;
    counts.iconButton++;
    const { tag } = readTag(src, m.index);
    if (/size="icon"/.test(tag) && !/aria-label/.test(tag)) {
      flag("iconButton", f, lineOf(src, m.index), tag);
    }
  }

  // 2. Raw <button> with no accessible name: no aria-label/labelledby in the
  //    tag AND no static text AND no JSX expression children — an expression
  //    ({c.title}) renders a real name a static scan cannot see, so those
  //    pass (the r419 run proved this class is all false positives).
  for (const m of src.matchAll(/<button\b/g)) {
    if (inComment(m.index)) continue;
    counts.rawButton++;
    const { tag, end } = readTag(src, m.index);
    if (/aria-label|aria-labelledby|\btitle=/.test(tag)) continue;
    if (hasSpread(tag)) continue;
    const close = closeIndex(src, end, "button");
    const inner = close === -1 ? "" : src.slice(end, close);
    if (/\{/.test(inner)) continue; // dynamic children — name unknowable statically
    if (!/[A-Za-z0-9]/.test(visibleText(inner))) {
      flag("rawButton", f, lineOf(src, m.index), tag);
    }
  }

  // 3. Clickable div/span without role or tabIndex (keyboard-invisible).
  for (const m of src.matchAll(/<(div|span)\b/g)) {
    if (inComment(m.index)) continue;
    const { tag } = readTag(src, m.index);
    if (!/onClick/.test(tag)) continue;
    if (/role=|tabIndex|tabindex|aria-hidden/.test(tag)) continue;
    if (hasSpread(tag)) continue;
    if (stopPropagationOnly(tag)) continue;
    counts.clickableDiv++;
    flag("clickableDiv", f, lineOf(src, m.index), tag);
  }

  // 4. Images without an alt attribute (alt="" is legal for decoratives;
  //    spread-prop tags pass their alt dynamically — unknowable, skipped).
  for (const m of src.matchAll(/<(img|Image)\b/g)) {
    if (inComment(m.index)) continue;
    counts.imgAlt++;
    const { tag } = readTag(src, m.index);
    if (!/\balt=/.test(tag) && !hasSpread(tag)) {
      flag("imgAlt", f, lineOf(src, m.index), tag);
    }
  }

  // 5. Text inputs with no label plumbing at all (spreads skipped — the
  //    label may travel in the spread; statics cannot know).
  for (const m of src.matchAll(/<(Input|input|Textarea|textarea)\b/g)) {
    if (inComment(m.index)) continue;
    const { tag } = readTag(src, m.index);
    if (/type="hidden"/.test(tag)) continue;
    if (/aria-hidden/.test(tag)) continue;
    if (hasSpread(tag)) continue;
    if (/aria-label|aria-labelledby|\bid=/.test(tag)) continue;
    counts.inputLabel++;
    flag("inputLabel", f, lineOf(src, m.index), tag);
  }
}

const totalFlags = Object.values(flags).reduce((n, a) => n + a.length, 0);
console.log(
  `scanned ${files.length} files · ${counts.iconButton} <Button> (${flags.iconButton.length} unlabeled icon) · ` +
    `${counts.rawButton} raw <button> (${flags.rawButton.length} unnamed) · ` +
    `${counts.clickableDiv} clickable div/span (${flags.clickableDiv.length} without role) · ` +
    `${counts.imgAlt} images (${flags.imgAlt.length} without alt) · ` +
    `${counts.inputLabel} inputs (${flags.inputLabel.length} without labels)`
);
const CATS = ["iconButton", "rawButton", "clickableDiv", "imgAlt", "inputLabel"];
for (const c of CATS) {
  for (const m of flags[c]) console.log(`  [${c}] ${m}`);
}
console.log(totalFlags === 0 ? "ALL CLEAN" : `${totalFlags} finding(s)`);
process.exit(0);
