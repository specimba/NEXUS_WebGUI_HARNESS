// ─── qa-exa-dialect (r531) — TASK-102 slice 6, dial-free verification ────────
// Proves the Exa acquisition-lane adapter without touching the live wire:
// auth shape, /search body shaping (caps/clamps/freshness), URL join + gate,
// results[]→FrontierItem parse, garbage tolerance, rubric compatibility, and
// the redaction choke riding the SHAPED body (r524 invariant across dialects).
import { redactDialBody } from "@/lib/redaction";
import {
  exaAuthHeaders,
  frontierQueryToExaBody,
  exaResponseToHouse,
  exaDialUrl,
  isExaStyleEndpoint,
} from "@/lib/exa-dialect";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// 1. AUTH — x-api-key, never Bearer.
const auth = exaAuthHeaders("sk-test-exa-key-1234");
check(
  "auth is x-api-key (no Bearer)",
  auth["x-api-key"] === "sk-test-exa-key-1234" &&
    !Object.keys(auth).some((k) => k.toLowerCase() === "authorization"),
  JSON.stringify(auth)
);

// 2. BODY — defaults: clamped numResults, auto type, news category, 30d window.
const body = frontierQueryToExaBody("  agentic   LLM harness  ");
const window = body.startPublishedDate ? Date.parse(body.startPublishedDate) : NaN;
check(
  "body shaping defaults (clamp/auto/news/30d ISO window)",
  body.query === "agentic LLM harness" &&
    body.numResults === 8 &&
    body.type === "auto" &&
    body.category === "news" &&
    Number.isFinite(window) &&
    Date.now() - window > 29 * 86_400_000 &&
    Date.now() - window < 31 * 86_400_000,
  JSON.stringify(body)
);

// 3. BODY — runaway inputs are capped honestly.
const wild = frontierQueryToExaBody("x".repeat(5000), { numResults: 99 });
check(
  "query capped at 400 chars, numResults clamped 1–10",
  wild.query.length === 400 && wild.numResults === 10,
  `len=${wild.query.length} n=${wild.numResults}`
);

// 4. URL — join never doubles and the gate discriminates.
check(
  "exaDialUrl joins /search without doubling",
  exaDialUrl("https://api.exa.ai") === "https://api.exa.ai/search" &&
    exaDialUrl("https://api.exa.ai/") === "https://api.exa.ai/search",
  exaDialUrl("https://api.exa.ai/")
);
check(
  "isExaStyleEndpoint gates exa.ai only",
  isExaStyleEndpoint("https://api.exa.ai") &&
    isExaStyleEndpoint("https://exa.ai/search") &&
    !isExaStyleEndpoint("https://api.openai.com/v1") &&
    !isExaStyleEndpoint("not a url"),
  "gate cases"
);

// 5. PARSE — results[] → house FrontierItem rows (hub exa, kind by URL).
const now = Date.now();
const canned = {
  requestId: "canned",
  results: [
    {
      title: "Agent Harness Weekly: judges go cascading",
      url: "https://example.com/harness-weekly",
      text: "A dense roundup of cascade judge systems. ".repeat(30),
      author: "A. Researcher",
      publishedDate: "2026-10-20T00:00:00.000Z",
    },
    {
      title: "rl-harness-kit",
      url: "https://github.com/acme/rl-harness-kit",
      text: "Post-training harness scaffold.",
    },
    { title: "no-url row", text: "skipped" },
    { url: "https://example.com/titleless", text: "skipped" },
  ],
};
const house = exaResponseToHouse(canned, now);
const first = house.items[0];
check(
  "results parse into house rows (id/hub/trim/authors/createdAt)",
  house.items.length === 2 &&
    !!first &&
    first.id === "exa:https://example.com/harness-weekly" &&
    first.hub === "exa" &&
    first.kind === "paper" &&
    first.summary.length <= 401 && // trim400 caps at 400 chars + the ellipsis
    first.authors === "A. Researcher" &&
    first.createdAt === "2026-10-20T00:00:00.000Z",
  JSON.stringify(house).slice(0, 160)
);
check(
  "github URL rows map to kind repo",
  house.items[1]?.kind === "repo" && house.items[1]?.title === "rl-harness-kit",
  JSON.stringify(house.items[1] ?? {}).slice(0, 120)
);

// 6. GARBAGE — honest errors, never a throw.
check(
  "garbage payloads yield honest errors, no throw",
  exaResponseToHouse(null).error !== undefined &&
    exaResponseToHouse({ results: "not-an-array" }).error !== undefined &&
    exaResponseToHouse({ nope: 1 }).error !== undefined,
  "garbage cases"
);

// 7. RUBRIC — exa rows ride the SAME rule rubric as the free hubs.
try {
  const { ruleScores, fuseScores } = await import("@/lib/frontier-scout");
  const item = house.items[0];
  if (item) {
    const total = fuseScores(ruleScores(item, []));
    check(
      "exa rows score through the shared rubric",
      Number.isFinite(total) && total >= 0 && total <= 100,
      `total=${total}`
    );
  } else {
    check("exa rows score through the shared rubric", false, "no item");
  }
} catch (err) {
  check("exa rows score through the shared rubric", false, String(err));
}

// 8. CHOKE — the redaction choke rides the SHAPED /search body (r524).
const leaky = frontierQueryToExaBody(
  'summarize releases referencing sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKKLLLLMMMMNNNNOOOOPPPP'
);
const masked = redactDialBody(leaky as unknown as Record<string, unknown>, []);
const maskedQuery =
  masked && typeof masked === "object" && "query" in masked
    ? String((masked as { query?: unknown }).query)
    : "";
check(
  "redaction choke masks a key-shaped string inside the /search body",
  maskedQuery.includes("[REDACTED:") && leaky.query.includes("sk-ant-"),
  maskedQuery.slice(0, 120)
);

console.log(`${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
