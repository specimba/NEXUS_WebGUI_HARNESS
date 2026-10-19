import { execSync } from "node:child_process";

// ─── GitHub PAT (r498→r501p2) — server-side credential derived from git ──────
// The owner's fine-grained PAT has been embedded in the origin remote URL since
// r498 (https://specimba:<token>@github.com/specimba/NEXUS_WebGUI_HARNESS.git).
// r501-p2 promotes it from "git transport only" to a first-class REST API
// credential for the GitHub Ops panel (rate budget, sync state, gists fleet).
//
//  · Derived, never duplicated: the token exists ONLY in the remote URL —
//    no second copy on disk to leak or rotate out of sync.
//  · Rotation = re-embed in the remote URL (or replace the PAT) — re-detected
//    automatically on the next cache refresh (5 min TTL), no restart.
//  · Server-only: everything importing this file sits under src/app/api.
//    It never reaches the browser bundle.

const CACHE_TTL_MS = 5 * 60_000;

let cached: { token: string | null; user: string | null; at: number } = {
  token: null,
  user: null,
  at: 0,
};

function probe(): { token: string | null; user: string | null } {
  try {
    const url = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
    // https://user:token@github.com/owner/repo.git  (token may also be the
    // only credential component: https://token@github.com/... — handle both).
    const match = url.match(/^https:\/\/(?:([^:/@]+):)?([^:/@]+)@github\.com\//);
    if (!match) return { token: null, user: null };
    const user = match[1] ?? null;
    const token = match[2] || null;
    return { token: token ?? null, user };
  } catch {
    return { token: null, user: null };
  }
}

/** The embedded GitHub PAT, or null when the remote carries no credential. */
export function ghToken(): string | null {
  if (Date.now() - cached.at < CACHE_TTL_MS) return cached.token;
  const next = probe();
  cached = { ...next, at: Date.now() };
  return cached.token;
}

/** The user part of the remote credential (null for bare-token URLs). */
export function ghRemoteUser(): string | null {
  if (Date.now() - cached.at < CACHE_TTL_MS) return cached.user;
  const next = probe();
  cached = { ...next, at: Date.now() };
  return cached.user;
}

/** Authorization headers for api.github.com — empty object when no token. */
export function ghAuthHeaders(): Record<string, string> {
  const token = ghToken();
  return token
    ? {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "NEXUS-WebGUI/1.0 (github ops panel; local-first platform)",
      }
    : {};
}

/** Repo coordinates parsed from the origin remote (owner/name), for API calls. */
export function ghOriginRepo(): { owner: string; name: string } | null {
  try {
    const url = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      timeout: 5_000,
    }).trim();
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    return match ? { owner: match[1], name: match[2] } : null;
  } catch {
    return null;
  }
}
