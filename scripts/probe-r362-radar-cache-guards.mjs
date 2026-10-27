// probe-r362-radar-cache-guards.mjs — r362 Trend Radar cache hardening.
// Asserts the CONTRACT in src/components/nexus/radar/radar-view.tsx:
// every radar cache read passes a render-contract guard, poison is dropped
// from storage + render, guards check only render-dereferenced fields
// (forward-compatible), and the papers fetch treats non-JSON / non-array
// 200 bodies as errors instead of silently overwriting a good cache.
// Usage: node scripts/probe-r362-radar-cache-guards.mjs  (exit 0 = all pass)

import { readFileSync } from "node:fs";

const SRC = "src/components/nexus/radar/radar-view.tsx";
const src = readFileSync(SRC, "utf8");

let pass = 0;
let fail = 0;

function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}

console.log("r362 — radar cache render-contract guards\n");

// ── 1. Guarded read pipeline ────────────────────────────────────────────────
console.log("[1] guarded read pipeline");
check(
  "readCache accepts an optional render-contract guard",
  src.includes("function readCache<T>(key: string, guard?: (v: unknown) => boolean): T | null {")
);
check("guard failure branch exists", src.includes("if (guard && !guard(parsed)) {"));
check(
  "poison is dropped from storage, not just from render",
  /if \(guard && !guard\(parsed\)\) \{\s*try \{\s*localStorage\.removeItem\(key\);/.test(src)
);
check("guard failure returns null to the render path", /return null;\s*\}\s*return parsed as T;/.test(src));

// ── 2. Per-cache guards check only render-dereferenced fields ──────────────
console.log("[2] per-cache guards");
check(
  "GitHub repo guard: id number + full_name/html_url strings + star count number",
  src.includes('typeof r.id === "number"') &&
    src.includes("isStr(r.full_name)") &&
    src.includes("isStr(r.html_url)") &&
    src.includes('typeof r.stargazers_count === "number"')
);
check(
  "GitHub cache guard: user string + finite fetchedAt + repos array of guarded items",
  src.includes("isStr(c.user)") &&
    src.includes("Array.isArray(c.repos) &&\n    c.repos.every(isGhRepo)")
);
check(
  "HF cache guard: all three Hub sections must be arrays (radio switches freely)",
  src.includes("Array.isArray(c.models)") &&
    src.includes("Array.isArray(c.datasets)") &&
    src.includes("Array.isArray(c.spaces)")
);
check(
  "HF item guard: id string (used as React key + link target)",
  src.includes("function isHfItem(v: unknown): boolean {") &&
    src.includes('isStr((v as Record<string, unknown>).id)')
);
check(
  "arXiv guard: paper id/title/pdf strings (key, headline and href are dereferenced)",
  src.includes("isStr(q.id) && isStr(q.title) && isStr(q.pdf)")
);
check(
  "forward-compat: guards never demand an exact key set",
  !src.includes("Object.keys") && !src.includes("Object.entries")
);
check(
  "fetchedAt finiteness asserted in all three cache guards",
  (src.match(/Number\.isFinite\(c\.fetchedAt\)/g) ?? []).length === 3
);

// ── 3. Every cache read passes a guard (no bare calls) ─────────────────────
console.log("[3] call-site coverage");
check("GitHub username read guarded", src.includes("readCache<string>(GH_USER_KEY, isStr)"));
check("GitHub stars cache read guarded", src.includes("readCache<GhCache>(GH_CACHE_KEY, isGhCache)"));
check("HF section read guarded", src.includes("readCache<HfKind>(HF_KIND_KEY, isStr)"));
check("HF trending cache read guarded", src.includes("readCache<HfCache>(HF_CACHE_KEY, isHfCache)"));
check("arXiv cache read guarded", src.includes("readCache<ArxivCache>(ARXIV_CACHE_KEY, isArxivCache)"));
check("arXiv query read guarded", src.includes("readCache<string>(ARXIV_QUERY_KEY, isStr)"));
check(
  "no bare cache read remains anywhere in the file",
  !/readCache<[A-Za-z]+>\([^,()]+\)/.test(src)
);

// ── 4. Papers fetch parity + no silent empty overwrite ─────────────────────
console.log("[4] papers fetch hardening");
check(
  "res.json() guarded against non-JSON bodies (parity with GitHub/HF tabs)",
  src.includes("const body: unknown = await res.json().catch(() => null);")
);
check(
  "200 with a non-array body throws instead of overwriting a good cache",
  src.includes("if (!Array.isArray(body)) {") &&
    src.includes('throw new Error("Unexpected response from the paper radar.");')
);
check(
  "success path still narrows to the bare-array contract",
  /const papers = body as ArxivPaper\[\];/.test(src)
);

// ── 5. Regression pins (r26/r139/r160/r240/r245) ───────────────────────────
console.log("[5] regression pins");
check("r26 GitHub proxy path untouched", src.includes("/api/radar/github?user="));
check("r139 HF proxy path untouched", src.includes("/api/radar/hf?kind="));
check("r160 stale stamp still wired", src.includes("staleAfterMs"));
check(
  "r245 IME parity on both Enter handlers (GitHub username + arXiv query)",
  (src.match(/nativeEvent\.isComposing/g) ?? []).length === 2
);
check(
  "r240 persisted HF section choice still written",
  src.includes("writeCache(HF_KIND_KEY, k)")
);
check(
  "r240 persisted arXiv query still written",
  src.includes("writeCache(ARXIV_QUERY_KEY, q)")
);
check(
  "quota-safe cache writes unchanged (radar works without persistence)",
  src.includes("/* quota — the radar works without persistence */")
);
check(
  "GitHub/HF fetch json guards predate this round and remain",
  (src.match(/res\.json\(\)\.catch\(\(\) => null\)/g) ?? []).length >= 3
);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
