// ─── Deep search for the Owner meta-review (r606+) ─────────────────────────
// One-shot research pass: queries the z-ai web_search function over the three
// structural hard-failure areas surfaced by the Owner's conversation-log
// review. Read-only; prints condensed results. Run: bun scripts/deep-search.ts
import ZAI from "z-ai-web-dev-sdk";

interface SearchHit {
  name?: string;
  title?: string;
  url?: string;
  link?: string;
  snippet?: string;
  description?: string;
}

const QUERIES: { tag: string; query: string; num: number; recency_days?: number }[] = [
  {
    tag: "SQLITE-CONTENTION (archiver 500 / WF-row reverts)",
    query: "SQLite Prisma \"database is locked\" concurrent writes Next.js API route WAL busy_timeout fix",
    num: 4,
    recency_days: 730,
  },
  {
    tag: "PROVIDER-FAILOVER (Vyce x3 failed, 0 relay hops)",
    query: "LLM gateway provider failover network error vs rate limit classification retry rotation design",
    num: 4,
    recency_days: 730,
  },
  {
    tag: "SELF-IMPROVING-HARNESS (recursive upgrade mechanism)",
    query: "self-improving LLM agent harness regression suite memory ledger recurring evaluation loop 2025",
    num: 4,
    recency_days: 365,
  },
];

async function main() {
  const zai = await ZAI.create();
  for (const q of QUERIES) {
    console.log(`\n===== ${q.tag} =====`);
    try {
      const results = (await zai.functions.invoke("web_search", {
        query: q.query,
        num: q.num,
        recency_days: q.recency_days,
      })) as SearchHit[];
      const hits = Array.isArray(results) ? results : [];
      if (hits.length === 0) {
        console.log("(no hits)");
        continue;
      }
      for (const h of hits) {
        const title = (h.name ?? h.title ?? "").slice(0, 90);
        const url = h.url ?? h.link ?? "";
        const snip = (h.snippet ?? h.description ?? "").replace(/\s+/g, " ").slice(0, 220);
        console.log(`- ${title}\n  ${url}\n  ${snip}`);
      }
    } catch (err) {
      console.log(`SEARCH FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

void main();
