// One-shot generator (r513): mirrors deliverables/nexus-cortex-harness/SUPABASE_AI_PASTE_PACK.md
// into src/lib/cortex-edge-paste-pack.ts as CORTEX_PASTE_PACK. Run: bun scripts/gen-cortex-pack.ts
import { readFileSync, writeFileSync } from "node:fs";

const mdPath = "deliverables/nexus-cortex-harness/SUPABASE_AI_PASTE_PACK.md";
const outPath = "src/lib/cortex-edge-paste-pack.ts";

const md = readFileSync(mdPath, "utf8");

// The deliverable file embeds the pack inside a ```markdown fence that itself
// contains nested ```sql / ```json fences — so grab from the first ```markdown
// opener to the LAST fence close in the file.
const startMatch = md.match(/```(?:markdown)?[^\n]*\n/);
if (!startMatch) throw new Error("no markdown fence opener found");
const startIdx = (startMatch.index ?? 0) + startMatch[0].length;
const endIdx = md.lastIndexOf("```");
if (endIdx <= startIdx) throw new Error("no closing fence after opener");
const pack = md.slice(startIdx, endIdx).trim();

if (pack.length < 4000) throw new Error(`pack extraction looks wrong (${pack.length} chars)`);

// Template-literal escaping: backslash, backtick, ${.
const lit = pack
  .replace(/\\/g, "\\\\")
  .replace(/`/g, "\\`")
  .replace(/\$\{/g, "\\${");

const banner = `// NEXUS Cortex Harness — shared constants for the Settings card + copy button.
// The full deliverables live in /deliverables/nexus-cortex-harness/ (Deno source
// + paste pack). This module only carries what the UI needs at runtime.
//
// CORTEX_PASTE_PACK is GENERATED — regenerate with: bun scripts/gen-cortex-pack.ts
// (mirrors deliverables/nexus-cortex-harness/SUPABASE_AI_PASTE_PACK.md, v2).

export const CORTEX_FUNCTION_NAME = "nexus-cortex-harness";
export const CORTEX_DEFAULT_FUNCTION_URL = \`https://vwottesqbdgcsmvvvzok.supabase.co/functions/v1/\${CORTEX_FUNCTION_NAME}\`;

export const CORTEX_PROBE_TIMEOUT_MS = 8000;
export const CORTEX_TOOL_TIMEOUT_MS = 26000;

// The exact text the owner pastes into the Supabase AI Assistant (project
// vwottesqbdgcsmvvvzok) to run the migration + deploy/update the v2 function.
// Keep deliverables/.../SUPABASE_AI_PASTE_PACK.md in sync (it is the source).
export const CORTEX_PASTE_PACK = \`
${lit}
\`;
`;

writeFileSync(outPath, banner);
console.log(`wrote ${outPath} — pack ${pack.length} chars`);
