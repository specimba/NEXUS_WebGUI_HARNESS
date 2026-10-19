import * as fs from "node:fs";
import * as path from "node:path";

// ─── HF hub token (r501) — gitignored server-side credential ────────────────
// The owner supplied a fine-grained HF PAT ("hf cli hub general usage") for
// the platform's Hugging Face reads. It lives in db/hf-token.txt (chmod 600,
// gitignored like the git credentials since r498) and is attached as an
// Authorization header by the SERVER-side HF callers only:
//   • tracker-sources.ts  → fetchHuggingFaceSignals (new-model signals)
//   • /api/radar/hf       → Trend Radar trending proxy
// An authenticated HF request raises the Hub API rate-limit ceiling and
// unlocks private/gated repos the token can see (e.g. the owner's buckets).
// The token NEVER enters the browser bundle: everything importing this file
// sits under src/app/api or src/lib (server-only fetch paths).
//
// File is re-read when its mtime changes so the owner can rotate the token
// without a dev-server restart. Missing/empty file = unauthenticated reads
// (the previous behavior — nothing breaks, just lower limits).

const FILE = path.join(process.cwd(), "db", "hf-token.txt");

let cached: { token: string | null; mtimeMs: number } = { token: null, mtimeMs: -1 };

function readTokenFile(): string | null {
  try {
    const st = fs.statSync(FILE);
    if (st.mtimeMs === cached.mtimeMs) return cached.token;
    const raw = fs.readFileSync(FILE, "utf8");
    const token =
      raw
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("hf_")) ?? "";
    cached = { token: token || null, mtimeMs: st.mtimeMs };
    return cached.token;
  } catch {
    cached = { token: null, mtimeMs: -1 };
    return null;
  }
}

/** The stored HF token, or null when absent (unauthenticated reads). */
export function hfToken(): string | null {
  return readTokenFile();
}

/** Authorization headers for Hub API calls — empty object when no token. */
export function hfAuthHeaders(): Record<string, string> {
  const token = readTokenFile();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
