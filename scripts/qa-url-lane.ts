// r540 — the url-kind research lane QA (TASKS P2 acceptance).
// Drives executeMove("research-repo") against a queued URL row with the
// network MOCKED (executor-QA doctrine: global fetch intercepted for the
// fixture URLs only, everything else passes through). Proves the full path:
//   queued url row → page fetch → title/og:description extraction →
//   deterministic scoreRepo rubric → researched + score + verdict + honest
//   notes — and the honest-failure paths (404, non-html, unparsable).
// STATE DISCIPLINE: only rows CREATED during the test are deleted; nothing
// else in the queue (or any other table) is touched.

import { db } from "../src/lib/db";
import { executeMove, pageToHouse } from "../src/lib/server/autonomy";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  ✓" : "  ✗"} ${m}`);
  if (c) pass++; else fail++;
};

// ── fixture pages ────────────────────────────────────────────────────────────
const GOOD_URL = "https://qa-fixture.example/harness-post";
const DEEP_URL = "https://qa-fixture.example/deep/post";
const NOT_FOUND_URL = "https://qa-fixture.example/missing";
const CSS_URL = "https://qa-fixture.example/style";

const GOOD_HTML = `<!doctype html><html><head>
<title>Agent Harness Post &amp; Research</title>
<meta property="og:description" content="A deep dive into agentic LLM workflow harness judge post-training &amp; evaluation.">
</head><body><h1>ignored chrome</h1>
<script>alert("must not leak into textHead")</script>
<style>.x{color:red}</style>
<p>The article covers agent harnesses, LLM evaluation loops and workflow judging for post-training research.</p>
</body></html>`;

const DEEP_HTML = `<html><head><meta property="og:title" content="OG title wins over &lt;title&gt;"><meta name="description" content="meta description fallback"></head><body><main>Minimal page body.</main></body></html>`;

const realFetch = globalThis.fetch.bind(globalThis);
(globalThis as { fetch: typeof fetch }).fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  const reply = (body: string, type = "text/html; charset=utf-8", status = 200) =>
    new Response(body, { status, headers: { "content-type": type } });
  if (u === GOOD_URL) return reply(GOOD_HTML);
  if (u === DEEP_URL) return reply(DEEP_HTML);
  if (u === NOT_FOUND_URL) return reply("<html>gone</html>", "text/html", 404);
  if (u === CSS_URL) return reply("body{color:red}", "text/css");
  return realFetch(url as Parameters<typeof realFetch>[0], init);
}) as typeof fetch;

// ── queue snapshot (restore-only-what-we-created) ───────────────────────────
const preExisting = new Set(
  (await db.researchQueue.findMany({ select: { id: true } })).map((r) => r.id),
);

async function enqueueUrl(url: string): Promise<string> {
  // ResearchQueue.id has no default — the real lane derives it from the
  // target (`gh:owner/repo` / `url:<sha1-12>`); the fixture mints its own.
  const row = await db.researchQueue.create({
    data: {
      id: `url:qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "url",
      url,
      source: "qa-url-lane",
      status: "queued",
    },
  });
  return row.id;
}

async function runResearch(queueId: string) {
  return executeMove({
    id: `qa-move-${queueId.slice(-6)}`,
    kind: "research-repo",
    payloadJson: JSON.stringify({ queueId }),
  });
}

try {
  // 1. pure extraction: og:title beats <title>, entities decode, script/style
  //    never reach textHead.
  const good = pageToHouse(GOOD_HTML);
  ok(
    good.title === "Agent Harness Post & Research" &&
      good.description.includes("agentic LLM workflow harness judge") &&
      good.description.includes("& evaluation."),
    "pageToHouse: og:description + <title> extracted, entities decoded",
  );
  ok(
    !good.textHead.includes("must not leak") && !good.textHead.includes("color:red") &&
      good.textHead.includes("article covers agent harnesses"),
    "pageToHouse: script/style stripped from the visible text head",
  );
  const deep = pageToHouse(DEEP_HTML);
  ok(
    deep.title === "OG title wins over <title>" && deep.description === "meta description fallback",
    "pageToHouse: og:title precedence + meta-description fallback",
  );

  // 2. integration: a queued url row researches END-TO-END through the move.
  const goodId = await enqueueUrl(GOOD_URL);
  const mv = await runResearch(goodId);
  ok(mv.status === "executed" && /researched qa-fixture\.example.*page reader/.test(mv.result),
    "move executed: queued url row → researched via the page reader");
  const goodRow = await db.researchQueue.findUnique({ where: { id: goodId } });
  ok(
    goodRow?.status === "researched" && typeof goodRow.score === "number" &&
      goodRow.score >= 0 && goodRow.score <= 10 &&
      ["ADAPT", "WATCH", "SKIP"].includes(goodRow.verdict ?? ""),
    `row researched with rubric score + verdict (score ${goodRow?.score}, verdict ${goodRow?.verdict})`,
  );
  ok(
    /title: Agent Harness Post & Research/.test(goodRow?.notes ?? "") &&
      /og:description|description: A deep dive/.test(goodRow?.notes ?? "") &&
      /source: page-reader/.test(goodRow?.notes ?? "") &&
      /chars of visible text distilled/.test(goodRow?.notes ?? ""),
    "notes carry title, description, page stats and the honest source line",
  );
  ok(
    !!goodRow?.researchedAt && goodRow.notes === (goodRow.notes ?? "").slice(0, (goodRow.notes ?? "").length),
    "researchedAt stamped (cache doctrine — never re-fetched)",
  );

  // 3. 404 → honest failure (row failed, error class note)
  const nfId = await enqueueUrl(NOT_FOUND_URL);
  const nf = await runResearch(nfId);
  ok(nf.status === "failed" && nf.result.startsWith("honest failure"),
    "404 page → honest failure at the move level");
  const nfRow = await db.researchQueue.findUnique({ where: { id: nfId } });
  ok(nfRow?.status === "failed" && /error class/.test(nfRow?.notes ?? ""),
    "404 row: status failed + error-class note (same shape as repo failures)");

  // 4. non-html content-type → honest failure
  const cssId = await enqueueUrl(CSS_URL);
  await runResearch(cssId);
  const cssRow = await db.researchQueue.findUnique({ where: { id: cssId } });
  ok(
    cssRow?.status === "failed" && /non-html content-type/.test(cssRow?.notes ?? ""),
    "non-html content-type refused honestly (no scoring of stylesheets)",
  );

  // 5. deep precedence page still researches (og:title path)
  const deepId = await enqueueUrl(DEEP_URL);
  const dm = await runResearch(deepId);
  ok(dm.status === "executed" && /researched/.test(dm.result),
    "og:title-precedence page researches end-to-end");
  const deepRow = await db.researchQueue.findUnique({ where: { id: deepId } });
  ok(/title: OG title wins over <title>/.test(deepRow?.notes ?? ""),
    "deep row notes carry the og:title extraction");
} finally {
  (globalThis as { fetch: typeof fetch }).fetch = realFetch;
  await db.researchQueue.deleteMany({
    where: { id: { notIn: [...preExisting] } },
  });
  console.log("\nrestored: research queue — pre-QA rows only");
}

console.log(`\n${pass}/${pass + fail} url-lane assertions passed`);
console.log(`SUMMARY: ${pass}/${pass + fail} url-lane assertions`);
process.exit(fail === 0 ? 0 : 1);
