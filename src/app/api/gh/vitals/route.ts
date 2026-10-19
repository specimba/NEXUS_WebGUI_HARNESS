import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import { ghAuthHeaders, ghOriginRepo } from "@/lib/server/gh-token";

// ─── GET /api/gh/vitals — GitHub Ops panel (r501-p2) ─────────────────────────
// One authenticated sweep over the GitHub REST API with the PAT that has lived
// in the origin remote URL since r498, trimmed to what the ops card renders:
//
//   • identity + token expiry (github-authentication-token-expiry header)
//   • rate-limit budget (GET /rate_limit is FREE — burns nothing)
//   • sync state: local HEAD (git rev-parse) vs remote refs/heads/<default>
//   • repos fleet (top 5 by push) + gists fleet (count + names)
//
// Every section is independent (allSettled-style try/catch): a dead section
// degrades its own key instead of failing the panel. Explicit user-triggered
// fetch only — no silent calls, zero telemetry. The token NEVER reaches the
// browser bundle.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 12_000;

interface Section<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function gh(path: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: ghAuthHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

function fail(section: string, err: unknown): Section<never> {
  const timedOut = err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message);
  return {
    ok: false,
    error: timedOut ? `${section}: GitHub took too long to answer.` : `${section}: unreachable.`,
  };
}

function localHead(): string | null {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", timeout: 5_000 }).trim() || null;
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  const repo = ghOriginRepo();
  if (!repo) {
    return NextResponse.json(
      { error: "No origin remote configured — cannot locate the GitHub repo." },
      { status: 404 }
    );
  }

  // 1) Identity + token expiry (the header carries the expiry ISO).
  let identity: Section<{ login: string; tokenExpiry: string | null }> = {
    ok: false,
    error: "identity: not probed",
  };
  try {
    const res = await gh("/user");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { login?: string };
    identity = {
      ok: true,
      data: {
        login: body.login ?? "unknown",
        tokenExpiry: res.headers.get("github-authentication-token-expiration"),
      },
    };
  } catch (err) {
    identity = fail("identity", err);
  }

  // 2) Rate budget — free endpoint, the honest meter for every other call.
  let rate: Section<{
    core: { limit: number; used: number; remaining: number; reset: number };
    search: { limit: number; used: number; remaining: number };
  }> = { ok: false, error: "rate: not probed" };
  try {
    const res = await gh("/rate_limit");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      resources?: { core?: Record<string, number>; search?: Record<string, number> };
    };
    const core = body.resources?.core;
    const search = body.resources?.search;
    if (core) {
      rate = {
        ok: true,
        data: {
          core: {
            limit: core.limit ?? 0,
            used: core.used ?? 0,
            remaining: core.remaining ?? 0,
            reset: core.reset ?? 0,
          },
          search: {
            limit: search?.limit ?? 0,
            used: search?.used ?? 0,
            remaining: search?.remaining ?? 0,
          },
        },
      };
    }
  } catch (err) {
    rate = fail("rate", err);
  }

  // 3) Sync state — default branch tip vs the working tree's HEAD.
  let sync: Section<{
    localHead: string | null;
    remoteHead: string | null;
    inSync: boolean;
    defaultBranch: string;
    pushedAt: string | null;
  }> = { ok: false, error: "sync: not probed" };
  try {
    const repoRes = await gh(`/repos/${repo.owner}/${repo.name}`);
    if (!repoRes.ok) throw new Error(`HTTP ${repoRes.status}`);
    const repoBody = (await repoRes.json()) as {
      default_branch?: string;
      pushed_at?: string;
    };
    const branch = repoBody.default_branch || "main";
    const refRes = await gh(`/repos/${repo.owner}/${repo.name}/git/refs/heads/${branch}`);
    if (!refRes.ok) throw new Error(`HTTP ${refRes.status}`);
    const refBody = (await refRes.json()) as { object?: { sha?: string } };
    const remoteHead = refBody.object?.sha ?? null;
    const head = localHead();
    sync = {
      ok: true,
      data: {
        localHead: head,
        remoteHead,
        inSync: !!head && !!remoteHead && head === remoteHead,
        defaultBranch: branch,
        pushedAt: repoBody.pushed_at ?? null,
      },
    };
  } catch (err) {
    sync = fail("sync", err);
  }

  // 4) Repos fleet (top 5 by recent push) — the owner's active surface.
  let repos: Section<{ name: string; pushedAt: string; private: boolean }[]> = {
    ok: false,
    error: "repos: not probed",
  };
  try {
    const res = await gh("/user/repos?sort=pushed&per_page=5&direction=desc");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Array<{
      name: string;
      pushed_at?: string;
      private?: boolean;
    }>;
    repos = {
      ok: true,
      data: body.map((r) => ({
        name: r.name,
        pushedAt: r.pushed_at ?? "",
        private: r.private ?? false,
      })),
    };
  } catch (err) {
    repos = fail("repos", err);
  }

  // 5) Gists fleet — count + file names (READ works today; WRITE is the
  //    r501-p2 finding: fine-grained PATs need the account "Gists" permission,
  //    so the snapshot-backup integration stays parked until a regen).
  let gists: Section<{ count: number; names: string[] }> = {
    ok: false,
    error: "gists: not probed",
  };
  try {
    const res = await gh("/gists?per_page=100");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Array<{
      files?: Record<string, unknown>;
    }>;
    const names = body.flatMap((g) => Object.keys(g.files ?? {}));
    gists = { ok: true, data: { count: body.length, names: names.slice(0, 6) } };
  } catch (err) {
    gists = fail("gists", err);
  }

  return NextResponse.json({
    repo: { owner: repo.owner, name: repo.name },
    identity,
    rate,
    sync,
    repos,
    gists,
    probedAt: Date.now(),
  });
}
