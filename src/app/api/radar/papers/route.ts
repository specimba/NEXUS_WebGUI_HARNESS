import { NextResponse } from "next/server";
import { parseArxivFeed } from "@/lib/server/tools";

// ─── GET /api/radar/papers — Trend Radar · Paper Radar (r26) ─────────────────
// Thin, stateless proxy over the public arXiv Atom API. arXiv does not send
// CORS headers, so the browser cannot call it directly — the server fetches
// and reuses the exact parser the arxiv_search tool uses. No key, no tracking;
// results are cached client-side in localStorage by the radar view.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Default when the caller gives no query: fresh papers across the AI core. */
const DEFAULT_QUERY = "cat:cs.AI OR cat:cs.CL OR cat:cs.LG";

const ARXIV_TIMEOUT_MS = 15_000;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Validate: trim, hard cap 300 chars — the query is URL-encoded into an
  // upstream fetch, so never let arbitrary junk through unmolested.
  const query = (url.searchParams.get("query") ?? "").trim().slice(0, 300);

  // max clamped to 1–20; sort allow-listed (anything else → submittedDate).
  const maxRaw = Number(url.searchParams.get("max") ?? 12) || 12;
  const max = Math.min(Math.max(Math.trunc(maxRaw), 1), 20);
  const sortRaw = url.searchParams.get("sort") ?? "submittedDate";
  const sort = ["relevance", "submittedDate", "lastUpdatedDate"].includes(sortRaw)
    ? sortRaw
    : "submittedDate";

  const effectiveQuery = query || DEFAULT_QUERY;
  const feedUrl =
    `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(effectiveQuery)}` +
    `&start=0&max_results=${max}&sortBy=${sort}&sortOrder=descending`;

  try {
    const res = await fetch(feedUrl, {
      headers: {
        "User-Agent":
          "PraisonAgent/1.0 (trend radar; +https://github.com/specimba/PraisonAI)",
      },
      signal: AbortSignal.timeout(ARXIV_TIMEOUT_MS),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `arXiv API returned HTTP ${res.status}` },
        { status: 502 }
      );
    }
    const xml = await res.text();
    // Success body: a bare JSON array of parsed papers (title, authors,
    // published, summary, pdf, id) — exactly what the tool engine returns.
    return NextResponse.json(parseArxivFeed(xml));
  } catch (err) {
    const message =
      err instanceof Error
        ? /timeout|timed? ?out/i.test(err.message)
          ? "arXiv did not answer within 15s — try again."
          : err.message
        : "Unknown error contacting arXiv";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
