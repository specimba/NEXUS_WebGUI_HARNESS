// r226 agent-io unit suite — the import sanitizer contract.
// Run: bun scripts/qa-agent-io.ts
// sanitizeAgent (agents-view) turned untrusted JSON into Agents; this suite
// pins the r226 behavior: well-formed non-colliding ids are PRESERVED
// (export → wipe → import restores workflow wiring), collisions mint fresh
// ids, flags survive as one grapheme (pre-fix: .slice(0, 2) cut 🇺🇸 in half),
// junk is skipped, numbers are clamped, tools are deduped.
import { sanitizeAgent } from "../src/components/praison/agents/agents-view";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const base = {
  id: "agent_qa226a",
  name: "qa-r226 alpha",
  emoji: "🇺🇸",
  color: "emerald",
  role: "Scout",
  description: "d",
  instructions: "You are…",
  model: "auto",
  temperature: 0.4,
  maxIterations: 6,
  tools: ["web_search", "web_search", "read_url"],
};

// 1-3: full valid entry — id preserved, fields kept, tools deduped
const a = sanitizeAgent({ ...base });
check("valid entry parses", a !== null);
check("well-formed id preserved (restore path)", a?.id === "agent_qa226a", `id=${a?.id}`);
check("tools deduped, order kept", JSON.stringify(a?.tools) === JSON.stringify(["web_search", "read_url"]), `tools=${JSON.stringify(a?.tools)}`);

// 4: flag emoji survives as ONE grapheme (THE fix — pre-fix: "🇺" + orphaned regional indicator)
check("flag emoji 🇺🇸 survives intact", a?.emoji === "🇺🇸", `emoji=${a?.emoji} (${[...(a?.emoji ?? "")].length} code points)`);

// 5: colliding id → fresh id (re-import onto existing roster never clobbers)
const taken = new Set(["agent_qa226a"]);
const b = sanitizeAgent({ ...base }, taken);
check("colliding id regenerated", b !== null && b.id !== "agent_qa226a" && /^agent_[a-z0-9]+$/.test(b.id), `id=${b?.id}`);

// 6: malformed ids → fresh id (never trust foreign id shapes)
for (const evil of ["../evil", "", "agent_", "agent_UPPER_x", null]) {
  const c = sanitizeAgent({ ...base, id: evil });
  const ok = c !== null && c.id !== evil && /^agent_[a-z0-9]+$/.test(c.id);
  check(`malformed id (${JSON.stringify(evil)}) → fresh agent_ id`, ok, `id=${c?.id}`);
}

// 7: emoji fallbacks
check("empty emoji → 🤖", sanitizeAgent({ name: "x", emoji: "" })?.emoji === "🤖");
check("missing emoji → 🤖", sanitizeAgent({ name: "x" })?.emoji === "🤖");
check("ZWJ sequence survives", sanitizeAgent({ name: "x", emoji: "👨‍👩‍👧" })?.emoji === "👨‍👩‍👧", `emoji=${sanitizeAgent({ name: "x", emoji: "👨‍👩‍👧" })?.emoji}`);

// 8: junk entries are skipped (the "(N skipped)" honesty in the toast)
check("null → null", sanitizeAgent(null) === null);
check("number → null", sanitizeAgent(42) === null);
check("blank name → null", sanitizeAgent({ name: "   " }) === null);
check("missing name → null", sanitizeAgent({}) === null);

// 9: clamps and caps
check("temperature clamped high (7 → 1.5)", sanitizeAgent({ name: "x", temperature: 7 })?.temperature === 1.5);
check("temperature clamped low (-1 → 0)", sanitizeAgent({ name: "x", temperature: -1 })?.temperature === 0);
check("temperature garbage → 0.7", sanitizeAgent({ name: "x", temperature: "hot" })?.temperature === 0.7);
check("maxIterations clamped (99 → 10)", sanitizeAgent({ name: "x", maxIterations: 99 })?.maxIterations === 10);
check("maxIterations rounded (2.6 → 3)", sanitizeAgent({ name: "x", maxIterations: 2.6 })?.maxIterations === 3);
check("missing maxIterations → 6 (form default parity, r302)", sanitizeAgent({ name: "x" })?.maxIterations === 6);
check("unknown tools dropped, deduped", JSON.stringify(sanitizeAgent({ name: "x", tools: ["nope", "run_code", "run_code"] })?.tools) === JSON.stringify(["run_code"]));
check("non-array tools → []", JSON.stringify(sanitizeAgent({ name: "x", tools: "all" })?.tools) === "[]");
check("invalid color → violet", sanitizeAgent({ name: "x", color: "hotpink" })?.color === "violet");
check("name capped at 60", sanitizeAgent({ name: "n".repeat(200) })?.name.length === 60);
check("fresh timestamps minted (not trusted)", typeof sanitizeAgent({ name: "x", createdAt: 1, updatedAt: 1 })?.createdAt === "number" && sanitizeAgent({ name: "x", createdAt: 1 })!.createdAt > 1e12);

console.log(`\n${passed}/${passed + failed} assertions pass`);
console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
