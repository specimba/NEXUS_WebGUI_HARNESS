import { NextResponse } from "next/server";

// ─── GET /api/radar/github — Trend Radar · GitHub Stars (r26) ────────────────
// Thin proxy over the public GitHub starred-repos API. The browser used to
// call api.github.com directly; that works from a residential IP but dies on
// shared/egress IPs (60 req/h unauthenticated pool). The proxy:
//   • sanitizes the username (^[A-Za-z0-9-]{1,39}$ — no path injection),
//   • attaches the SERVER-side GITHUB_TOKEN when present (5000 req/h) and
//     never ships it to the client,
//   • passes through only the fields the radar grid renders.
// Still an explicit user-triggered fetch — no silent calls, zero telemetry.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GH_TIMEOUT_MS = 15_000;
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

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const user = (url.searchParams.get("user") ?? "").trim();
  const pageRaw = Number(url.searchParams.get("page") ?? 1) || 1;
  const page = Math.min(Math.max(Math.trunc(pageRaw), 1), MAX_PAGES);

  if (!/^[A-Za-z0-9-]{1,39}$/.test(user)) {
    return NextResponse.json({ error: "Invalid GitHub username" }, { status: 400 });
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "PraisonAgent/1.0 (trend radar; +https://github.com/specimba/PraisonAI)",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(user)}/starred?per_page=100&page=${page}`,
      { headers, signal: AbortSignal.timeout(GH_TIMEOUT_MS) }
    );
    if (res.status === 404) {
      return NextResponse.json({ error: `GitHub user "${user}" was not found.` }, { status: 404 });
    }
    if (res.status === 403 || res.status === 429) {
      return NextResponse.json(
        {
          error:
            "GitHub API rate limit hit even on the server hop — try again in a bit (limits reset hourly).",
        },
        { status: 429 }
      );
    }
    if (!res.ok) {
      return NextResponse.json({ error: `GitHub API returned HTTP ${res.status}.` }, { status: 502 });
    }
    const batch = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(batch)) {
      return NextResponse.json({ error: "Unexpected response from the GitHub API." }, { status: 502 });
    }
    const repos: GhRepoTrimmed[] = batch
      .filter((r) => r && typeof r.id === "number" && typeof r.full_name === "string")
      .map((r) => ({
        id: r.id as number,
        full_name: r.full_name as string,
        description: typeof r.description === "string" ? r.description : null,
        html_url: typeof r.html_url === "string" ? r.html_url : `https://github.com/${user}`,
        stargazers_count: typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
        language: typeof r.language === "string" ? r.language : null,
        pushed_at: typeof r.pushed_at === "string" ? r.pushed_at : null,
        topics: Array.isArray(r.topics) ? (r.topics as unknown[]).slice(0, 6).map(String) : [],
      }));
    return NextResponse.json({ page, count: repos.length, repos });
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message);
    return NextResponse.json(
      { error: timedOut ? "GitHub took too long to answer — try again." : "Could not reach the GitHub API." },
      { status: 504 }
    );
  }
}
