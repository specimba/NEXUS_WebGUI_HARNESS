// r364 probe: transport-class hygiene on providers/account + route-level
// guard on tools/execute + gateway/pulse surveyed-clean drift pin.
// CONTRACT (not string shapes): transport failures never leak raw
// err.message; tool route failures stay ToolResult-shaped; pulse untouched.
// Reads ROUTE FILES only — never its own source (r349 lesson).
import { readFileSync } from "node:fs";

const ROOT = "/home/z/my-project";
const FILES = {
  account: `${ROOT}/src/app/api/providers/account/route.ts`,
  tools: `${ROOT}/src/app/api/tools/execute/route.ts`,
  pulse: `${ROOT}/src/app/api/gateway/pulse/route.ts`,
};
const src = {};
for (const [k, p] of Object.entries(FILES)) src[k] = readFileSync(p, "utf8");

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log(`FAIL ${name}`); } };
const count = (hay, re) => (hay.match(re) || []).length;

// ── providers/account: transport classes replace the raw catch ───────────────
ok("account.no-raw-message-catch", !/instanceof Error \? err\.message/.test(src.account));
ok("account.raw-logged-server-side", /console\.error\("\[api:providers-account\]/.test(src.account));
ok("account.timeout-class", src.account.includes('err.name === "TimeoutError"') && src.account.includes("timed out after 10s — safe to retry"));
ok("account.malformed-class", /instanceof SyntaxError/.test(src.account) && src.account.includes("malformed response (not JSON)"));
ok("account.unreachable-class", src.account.includes("Could not reach the account endpoint — check the network and retry"));
ok("account.502-count", count(src.account, /status: 502/g) === 2);

// providers/account regression pins (untouched doctrine surfaces)
ok("pin.account-provider-body-path", src.account.includes("text.slice(0, 200)"));
ok("pin.account-timeout-signal", src.account.includes("AbortSignal.timeout(10_000)"));
ok("pin.account-allowlist", src.account.includes('vyce: "https://vyceai.com/v1/me"'));
ok("pin.account-whitelist-fields", src.account.includes("never echo the raw payload"));
ok("pin.account-validation-400s", count(src.account, /status: 400/g) === 3);

// ── tools/execute: route-level guard, ToolResult-shaped ──────────────────────
ok("tools.imports-policy", src.tools.includes('from "@/lib/local-failure"'));
ok("tools.site", src.tools.includes('localFailure("tools:execute"'));
ok("tools.try-wraps-executor", /try \{[\s\S]{0,140}await executeTool\(name, args, req\.signal\)/.test(src.tools));
ok("tools.catch-shape", /} catch \(err\) \{[\s\S]{0,80}ok: false,[\s\S]{0,120}content: localFailure\("tools:execute"[\s\S]{0,120}ms: Date\.now\(\) - started,[\s\S]{0,60}status: 500/.test(src.tools));
ok("tools.500-count", count(src.tools, /status: 500/g) === 1);

// tools/execute regression pins (untouched doctrine surfaces)
ok("pin.tools-csrf-403", src.tools.includes("Cross-origin tool execution is not allowed"));
ok("pin.tools-unknown-400", src.tools.includes('Unknown tool "${name}"'));
ok("pin.tools-allowlist", src.tools.includes('"web_search"') && src.tools.includes('"image_generate"'));
ok("pin.tools-signal-r25", src.tools.includes("req.signal"));
ok("pin.tools-400-count", count(src.tools, /status: 400/g) === 2);
ok("pin.tools-403-count", count(src.tools, /status: 403/g) === 1);

// ── gateway/pulse: surveyed-clean drift detector (must remain untouched) ─────
ok("pin.pulse-untouched", src.pulse.includes("gatewayPulse()") && src.pulse.includes('recordGateway429(model, "browser-direct")'));
ok("pin.pulse-202", count(src.pulse, /status: 202/g) === 1);
ok("pin.pulse-400-guard", count(src.pulse, /status: 400/g) === 1);

console.log(`probe-r364: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
