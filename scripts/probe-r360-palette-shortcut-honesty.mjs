#!/usr/bin/env node
// r360 — command palette shortcut honesty (probe)
// CONTRACT: ⌘⇧F is wired AND advertised; browser-reserved shortcuts
// (⌘⇧N, ⌘1–⌘9) are no longer advertised anywhere; stale search label gone;
// ⌘K wiring + palette actions untouched (regression pins).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const f = readFileSync(join(ROOT, "src/components/nexus/command-palette.tsx"), "utf8");

let pass = 0, fail = 0;
const results = [];
function check(name, ok) {
  if (ok) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name}`); }
}

// ── 1. ⌘⇧F wiring ──
check("Shift+F handler exists with mod+shift+F", /mod && e\.shiftKey && e\.key\.toLowerCase\(\) === "f"/.test(f));
check("⌘⇧F preventDefault (suppresses native find)", /"f" && !e\.isComposing\) \{\s*\n\s*e\.preventDefault\(\);/.test(f));
check("⌘⇧F opens global search dialog", /setGlobalSearchOpen\(true\)/.test(f));
check("⌘⇧F closes the palette first (replace, never stack)", /setPaletteOpen\(false\); \/\/ replace, never stack/.test(f));
check("IME guard on ⌘⇧F (!isComposing)", /!e\.isComposing/.test(f));
check("shortcut advertised on the palette item (⌘⇧F label kept)", /<CommandShortcut>⌘⇧F<\/CommandShortcut>/.test(f));

// ── 2. unfulfillable shortcuts removed ──
check("⌘⇧N label GONE (Chrome reserves it for incognito)", !f.includes("<CommandShortcut>⌘⇧N"));
check("⌘1–⌘5 labels GONE (browsers reserve 1–9 for tab switching)", !/<CommandShortcut>⌘[0-9]/.test(f));
check("NAV type no longer carries a shortcut field", /const NAV: \{ view: View; label: string; icon: React\.ElementType \}/.test(f));
check("dead-shortcut rationale recorded in-file", f.includes("advertised-but-dead shortcut is a lie"));

// ── 3. stale label fixed ──
check("old 'Search all chats…' label GONE from palette", !f.includes("Search all chats"));
check("new label mirrors the dialog scope", f.includes("Search chats, agents & workflows…"));

// ── 4. regression pins ──
check("⌘K toggle still wired", /mod && e\.key\.toLowerCase\(\) === "k"/.test(f) && /setPaletteOpen\(!/.test(f));
check("window keydown listener + cleanup intact",
  /window\.addEventListener\("keydown", onKey\);/.test(f) && /window\.removeEventListener\("keydown", onKey\);/.test(f));
check("chatWithAgent still creates + lands in fresh chat",
  /chatWithAgent[\s\S]*?create\(agentId\);\s*\n\s*setView\("chat"\);/.test(f));
check("workflow run action intact (requestRunWorkflow)", /requestRunWorkflow\(w\.id\)/.test(f));
check("recent-chats + agents groups still gated on non-empty",
  /agents\.length > 0 &&/.test(f) && /recentConversations\.length > 0 &&/.test(f) && /workflows\.length > 0 &&/.test(f));

// ── 5. house style ──
check("no /quota/i vocabulary in this file", !/quota/i.test(f));

// ── report ──
console.log(`probe-r360-palette-shortcut-honesty: ${pass} pass / ${fail} fail`);
for (const r of results) console.log(r);
process.exit(fail === 0 ? 0 : 1);
