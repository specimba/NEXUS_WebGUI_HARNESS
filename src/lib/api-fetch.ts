// ─── r778: the gateway-502 save class (Owner-reported) ───────────────────────
// On 2026-10-30 ~03:54 UTC the dev server was OOM-killed mid-session (dmesg:
// "Out of memory: Killed process 1729 (next-server)", rss ~1.5 GB). While a
// death/restart window is open, the gateway answers every /api request with an
// HTML 502/504 error page, and the cards res.json() then surfaced the raw
// browser parse error ("Unexpected token '<', \"<!DOCTYPE \"... is not valid
// JSON") into toasts. A save that failed that way looks like a "rollback"
// after the next refresh — the Owner reported exactly that: configurations on
// the vault / egress / GitHub cards "rolling back many times with a simple
// refresh".
//
// apiJson() turns the class into honest, self-healing behavior:
//   • a non-JSON body (an HTML error page) or a network-level failure is
//     detected BEFORE parsing and becomes a plain-language ApiError — the raw
//     parse noise never reaches a toast;
//   • one automatic retry after ~1.5 s. Every call site that uses this helper
//     is an idempotent upsert, a delete, or a read, so a retry can never
//     double-apply — a blip shorter than the window self-heals and the save
//     lands;
//   • after a final failure the error names the situation plainly, so a miss
//     reads as "not saved — retry" instead of a silent "rollback".
//
// Client-safe (no server imports); init passes through untouched — CSRF
// headers and abort signals ride along unchanged.

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type ApiJsonResult<T> = { res: Response; json: T };

const RETRY_DELAY_MS = 1500;

const HTML_PAGE_HINT = "Server unreachable — an HTML error page came back instead of JSON";

function describeBody(res: Response): string {
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  return ct.includes("html") || !ct.includes("json")
    ? `${HTML_PAGE_HINT} (HTTP ${res.status}). Nothing was saved; retry once the server answers.`
    : `The server sent an unreadable body (HTTP ${res.status}). Nothing was saved; retry once the server answers.`;
}

async function attempt<T>(url: string, init?: RequestInit): Promise<ApiJsonResult<T>> {
  const res = await fetch(url, init);
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("json")) {
    // A gateway/server error page (502/504 HTML) or any other non-JSON body.
    // These routes always answer JSON on their own error paths, so a
    // non-JSON body is the death-window signature, never app data.
    throw new ApiError(describeBody(res), res.status);
  }
  try {
    const json = (await res.json()) as T;
    return { res, json };
  } catch {
    throw new ApiError(describeBody(res), res.status);
  }
}

export async function apiJson<T = unknown>(
  url: string,
  init?: RequestInit,
  opts: { retries?: number; delayMs?: number } = {},
): Promise<ApiJsonResult<T>> {
  const retries = opts.retries ?? 1;
  const delayMs = opts.delayMs ?? RETRY_DELAY_MS;
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      return await attempt<T>(url, init);
    } catch (err) {
      last = err;
      if (err instanceof ApiError || err instanceof TypeError) {
        continue; // gateway HTML page or a dead socket — retryable
      }
      throw err; // programmer error (bad URL, an aborted signal) — surface it
    }
  }
  if (last instanceof ApiError) throw last;
  if (last instanceof TypeError) {
    throw new ApiError(
      "Server unreachable — the request could not be sent (network error). Nothing was saved; retry once the server answers.",
    );
  }
  throw last;
}
