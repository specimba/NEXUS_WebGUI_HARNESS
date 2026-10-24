import { NextResponse } from "next/server";

// ─── GET /api/radar/github — Trend Radar · GitHub Stars (r26) ────────────────
// Thin proxy over the public GitHub starred-repos API. The browser used to
// call api.github.com directly; that works from a residential IP but dies on
// shared/egress IPs (60 req/h unauthenticated pool). The proxy:
//   • sanitizes the username (^[A-Za-z0-9-]{1,39}$ — no path injection),
//   • attaches the SERVER-side GITHUB_TOKEN when present (5000 req/h) and
//     never ships it to the client,
//   • r516: on a 403/429 from the shared egress IP, retries ONCE through the
//     Webshare egress pool (r514) when a token is configured — the pool rides
//     residential exits, so a rate-limited datacenter IP stops being the end
//     of the story. Success responses carry `via: "pool"` so the UI can say
//     so honestly; when the pool also fails the original honest message stays.
// Still an explicit user-triggered fetch — no silent calls, zero telemetry.

import { loadEgressPool, pickProxies, proxiedFetch } from "@/lib/server/egress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GH_TIMEOUT_MS = 15_000;
const POOL_TIMEOUT_MS = 12_000;
const MAX_PAGES = 10;

interface GhRepoTrimmed {
  id: number;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  pushed_at: string | null;
  topics?: string[];
}

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "NEXUS-WebGUI/1.0 (trend radar; local-first agentic workflow platform)",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function parseBatch(text: string): GhRepoTrimmed[] | null {
  try {
    const batch = JSON.parse(text) as Array<Record<string, unknown>>;
    if (!Array.isArray(batch)) return null;
    return batch
      .filter((r) => r && typeof r.id === "number" && typeof r.full_name === "string")
      .map((r) => ({
        id: r.id as number,
        full_name: r.full_name as string,
        description: typeof r.description === "string" ? r.description : null,
        html_url: typeof r.html_url === "string" ? r.html_url : "",
        stargazers_count: typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
        language: typeof r.language === "string" ? r.language : null,
        pushed_at: typeof r.pushed_at === "string" ? r.pushed_at : null,
        topics: Array.isArray(r.topics) ? (r.topics as unknown[]).slice(0, 6).map(String) : [],
      }));
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const user = (url.searchParams.get("user") ?? "").trim();
  const pageRaw = Number(url.searchParams.get("page") ?? 1) || 1;
  const page = Math.min(Math.max(Math.trunc(pageRaw), 1), MAX_PAGES);

  if (!/^[A-Za-z0-9-]{1,39}$/.test(user)) {
    return NextResponse.json({ error: "Invalid GitHub username" }, { status: 400 });
  }

  const target = `https://api.github.com/users/${encodeURIComponent(user)}/starred?per_page=100&page=${page}`;
  const headers = ghHeaders();

  try {
    const res = await fetch(target, { headers, signal: AbortSignal.timeout(GH_TIMEOUT_MS) });
    if (res.status === 404) {
      return NextResponse.json({ error: `GitHub user "${user}" was not found.` }, { status: 404 });
    }
    if (res.status === 403 || res.status === 429) {
      // ── r516: the shared-egress escape hatch. Direct was rate-limited (or
      // WAF'd); try up to 3 pool proxies before admitting defeat. Every
      // outcome stays honest in the response (`via` / note).
      try {
        const pool = await loadEgressPool({ forceRefresh: false });
        if (pool.ok && pool.pool.length > 0) {
          const candidates = pickProxies(pool.pool, 3);
          for (const proxy of candidates) {
            const via = await proxiedFetch(
              target,
              { headers, method: "GET" },
              { proxy, timeoutMs: POOL_TIMEOUT_MS }
            );
            if ("status" in via && via.status >= 200 && via.status < 300) {
              const repos = parseBatch(via.bodyText);
              if (repos) {
                return NextResponse.json(
                  { page, count: repos.length, repos, via: "pool" },
                  { headers: { "Cache-Control": "no-store" } }
                );
              }
            }
            if ("status" in via && (via.status === 404)) {
              return NextResponse.json(
                { error: `GitHub user "${user}" was not found.` },
                { status: 404 }
              );
            }
          }
        }
      } catch {
        /* pool infrastructure trouble — fall through to the honest 429 */
      }
      return NextResponse.json(
        {
          error:
            "GitHub API rate limit hit even on the server hop — the egress pool retry could not complete either. Try again in a bit (limits reset hourly), or set Generic routing to Pool in Settings → Egress.",
        },
        { status: 429 }
      );
    }
    if (!res.ok) {
      return NextResponse.json({ error: `GitHub API returned HTTP ${res.status}.` }, { status: 502 });
    }
    const repos = parseBatch(await res.text());
    if (!repos) {
      return NextResponse.json({ error: "Unexpected response from the GitHub API." }, { status: 502 });
    }
    return NextResponse.json({ page, count: repos.length, repos, via: "direct" });
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message);
    return NextResponse.json(
      { error: timedOut ? "GitHub took too long to answer — try again." : "Could not reach the GitHub API." },
      { status: 504 }
    );
  }
}
