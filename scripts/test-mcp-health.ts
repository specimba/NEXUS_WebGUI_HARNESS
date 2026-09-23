/**
 * r39 unit test — MCP tool health ledger (scripts/test-mcp-health.ts)
 * Run: bun scripts/test-mcp-health.ts
 * Mocks localStorage (the ledger's only external dependency) and verifies:
 *  1. outcomes accumulate (calls/oks/fails/meanMs window)
 *  2. failStreak resets on success, drives tone + model-facing hint
 *  3. reset wipes rows; eviction never throws
 */
import {
  recordMcpToolOutcome,
  getMcpToolHealth,
  resetMcpToolHealth,
  summarizeToolHealth,
  mcpHealthHint,
  MCP_HEALTH_WINDOW,
  MCP_HEALTH_FLAKY_STREAK,
} from "../src/lib/mcp-health";

// ── minimal localStorage mock ────────────────────────────────────────────────
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const DEF = "mcp__deepwiki__ask_question";

// 1. ok calls accumulate
recordMcpToolOutcome(DEF, true, 200);
recordMcpToolOutcome(DEF, true, 400);
let h = getMcpToolHealth(DEF)!;
check("two ok calls recorded", h.calls === 2 && h.oks === 2 && h.fails === 0);
check("meanMs = window mean (300)", h.meanMs === 300, `got ${h.meanMs}`);
check("failStreak stays 0 on success", h.failStreak === 0);
check("no hint when healthy", mcpHealthHint(DEF) === "");

// 2. failures build a streak; hint appears at threshold
recordMcpToolOutcome(DEF, false, 5000, "upstream 502");
h = getMcpToolHealth(DEF)!;
check("fail recorded", h.calls === 3 && h.fails === 1 && h.lastError === "upstream 502");
check("streak = 1 below hint threshold", h.failStreak === 1 && mcpHealthHint(DEF) === "");
recordMcpToolOutcome(DEF, false, 8000, "upstream 502 again");
h = getMcpToolHealth(DEF)!;
check(`streak ${MCP_HEALTH_FLAKY_STREAK} → flaky`, h.failStreak === 2);
check("flaky hint mentions streak + last error", mcpHealthHint(DEF).includes("failed its last 2") && mcpHealthHint(DEF).includes("502 again"));
const sum = summarizeToolHealth("deepwiki", { name: "ask_question" } as never);
check("summary tone flaky", sum.tone === "flaky", `got ${sum.tone}`);

// 3. success resets streak
recordMcpToolOutcome(DEF, true, 150);
h = getMcpToolHealth(DEF)!;
check("ok resets failStreak", h.failStreak === 0 && h.lastOkAt != null);
check("hint clears after recovery", mcpHealthHint(DEF) === "");

// 4. window cap on mean
for (let i = 0; i < MCP_HEALTH_WINDOW + 5; i++) recordMcpToolOutcome(DEF, true, 100);
h = getMcpToolHealth(DEF)!;
check("mean uses last window only", h.meanMs === 100, `got ${h.meanMs}`);

// 5. reset + never-throw contract
resetMcpToolHealth(DEF);
check("reset wipes row", getMcpToolHealth(DEF) == null);
recordMcpToolOutcome("", true, 10); // empty def ignored
resetMcpToolHealth(); // full wipe must not throw
check("full reset + empty-name call safe", true);

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
