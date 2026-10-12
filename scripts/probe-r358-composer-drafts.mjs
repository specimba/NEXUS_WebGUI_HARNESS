#!/usr/bin/env node
// r358 — per-conversation composer draft persistence (probe)
// Asserts the CONTRACT: per-conversation keying, the load/write effect split
// that prevents cross-conversation stamping, quota safety, send-clears-draft,
// cap eviction, storage-key uniqueness across src. (r349 lesson: assert the
// contract, not the prose shape.)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const composer = readFileSync(join(ROOT, "src/components/praison/chat/composer.tsx"), "utf8");
const chatView = readFileSync(join(ROOT, "src/components/praison/chat/chat-view.tsx"), "utf8");

let pass = 0, fail = 0;
const results = [];
function check(name, ok) {
  if (ok) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}`); }
}

// ── extraction helpers ──
const block = (src, startMarker, endMarker) => {
  const s = src.indexOf(startMarker);
  if (s === -1) return null;
  const e = src.indexOf(endMarker, s);
  return e === -1 ? src.slice(s) : src.slice(s, e);
};
const persistence = block(composer, "r358 per-conversation draft persistence", "// ─── Slash commands");
const hooksBlock = block(composer, "r358: per-conversation draft persistence", "// Voice input");

// ── 1. prop plumbing ──
check("ComposerProps declares conversationId: string | null",
  /conversationId\s*:\s*string\s*\|\s*null/.test(composer));
check("component destructures conversationId",
  /export function Composer\(\{[^}]*conversationId,[^}]*\}\s*:\s*ComposerProps\)/s.test(composer));
check("chat-view passes conversationId={activeId}", chatView.includes("conversationId={activeId}"));

// ── 2. storage shape ──
check("storage key is praison-drafts", composer.includes('const DRAFTS_KEY = "praison-drafts"'));
check("readDrafts rejects arrays + non-objects",
  persistence && /!Array\.isArray\(parsed\)/.test(persistence) && /typeof parsed === "object"/.test(persistence));
check("readDraft guards null convId",
  persistence && /if \(!convId\) return ""/.test(persistence));
check("readDraft guards non-string entry",
  persistence && /typeof d === "string"/.test(persistence));

// ── 3. quota safety ──
check("writeDraft guarded by try/catch",
  persistence && /function writeDraft[\s\S]*?try \{[\s\S]*?catch \(e\)/.test(persistence));
check("setItem inside try (quota/private-mode safe)",
  persistence && /try \{[\s\S]*?setItem[\s\S]*?\} catch/.test(persistence));
check("fallback is console.info (never user-facing toast)",
  persistence && /console\.info\(/.test(persistence) && !/toast\(/.test(persistence));

// ── 4. THE ordering contract: load before write can stamp ──
check("load effect deps are exactly [conversationId]",
  hooksBlock && /setValue\(readDraft\(conversationId\)\);\s*\}, \[conversationId\]\);/.test(hooksBlock));
check("load effect repoints draftConvRef BEFORE setValue",
  hooksBlock && /draftConvRef\.current = conversationId;[\s\S]*?setValue\(readDraft/.test(hooksBlock));
check("write effect deps are exactly [value] (never conversationId)",
  hooksBlock && /writeDraft\(draftConvRef\.current, value\);\s*\}, \[value\]\);/.test(hooksBlock));
check("write effect attributes its write to draftConvRef",
  hooksBlock && /writeDraft\(draftConvRef\.current, value\)/.test(hooksBlock));
check("write effect does NOT reference conversationId directly",
  (() => {
    const m = hooksBlock && hooksBlock.match(/React\.useEffect\(\(\) => \{\s*writeDraft[\s\S]*?\}, \[value\]\);/);
    return m && !/conversationId/.test(m[0]);
  })());

// ── 5. lifecycle: send clears, empty deletes, cap evicts ──
check("submit still clears value (draft deleted via write effect)",
  /const submit = React\.useCallback\(\(\) => \{[\s\S]*?setValue\(""\);[\s\S]*?\}, \[value, attachments, streaming, onSend, onQueue\]\);/.test(composer));
check("empty text deletes the stored entry (map stays lean)",
  persistence && /else delete drafts\[convId\]/.test(persistence));
check("cap constant exists (DRAFT_MAP_CAP)",
  persistence && /DRAFT_MAP_CAP = \d+/.test(persistence));
check("eviction slices oldest-inserted beyond cap",
  persistence && /keys\.slice\(0, keys\.length - DRAFT_MAP_CAP\)/.test(persistence));

// ── 6. scope honesty: attachments NOT persisted ──
check("persistence block never touches attachments",
  persistence && !/attachments/.test(persistence));

// ── 7. storage-key uniqueness across src ──
let keyClash = false;
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) { if (f !== "node_modules" && f !== ".next") walk(p); continue; }
    if (!/\.(tsx?|mjs|ts)$/.test(f)) continue;
    if (p.endsWith("probe-r358-composer-drafts.mjs")) continue;
    const txt = readFileSync(p, "utf8");
    if (txt.includes("praison-drafts") && !p.includes("composer.tsx")) keyClash = true;
  }
};
walk(join(ROOT, "src"));
walk(join(ROOT, "scripts"));
check("praison-drafts key used by composer.tsx only (no store collision)", !keyClash);

// ── report ──
console.log(`probe-r358-composer-drafts: ${pass} pass / ${fail} fail`);
for (const r of results) console.log(r);
process.exit(fail === 0 ? 0 : 1);
