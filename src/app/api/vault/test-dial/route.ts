import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { KEYED_ENDPOINTS } from "@/lib/provider-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── r276: POST /api/vault/test-dial — live-dial verdict for a vault slot ────
// Retires the r142 carried risk: the vault's Test (r135/r218) proved storage
// round-trip only. This endpoint asks the PROVIDER: loads the slot
// server-side and dials the provider's allowlisted models endpoint with the
// stored raw key.
//
// Trust model: identical to /api/vault/consume — LOCALHOST-ONLY. Strictly
// LESS exposing than consume: the raw key never leaves the server here — the
// response carries only a verdict, an HTTP status, and a short upstream
// error snippet (never the key, never the full payload). The dial URL comes
// from the server-side KEYED_ENDPOINTS allowlist only (no SSRF surface).
//
// The verdict is the honest part — a 403 region block must NOT read as a bad
// key (same doctrine as free-models):
//   verified      2xx — the endpoint accepted this key
//   rejected      401 — the provider refused this credential
//   inconclusive  403/451 — region/IP block on the server's network; key unjudged
//   unreachable   network failure/timeout/other status — key never exercised
//
// Responses:
//   200 { ok: true,  provider, verdict: "verified", httpStatus }
//   200 { ok: false, provider, verdict: "rejected"|"inconclusive"|"unreachable", httpStatus?, error? }
//   400 { ok: false, error } — bad body / provider has no dial target
//   403 { ok: false, error } — non-local caller
//   404 { ok: false, error } — no slot stored for this provider

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// "localhost:3000" → "localhost"; "[::1]:9222" → "[::1]"; bare → as-is.
function hostWithoutPort(header: string): string {
  const v = header.trim().toLowerCase();
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    return end === -1 ? v : v.slice(0, end + 1);
  }
  const colon = v.indexOf(":");
  return colon === -1 ? v : v.slice(0, colon);
}

function isLocalHost(header: string | null): boolean {
  if (!header) return false;
  const host = hostWithoutPort(header);
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}

function isLoopbackIp(header: string): boolean {
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  return first === "127.0.0.1" || first === "::1" || first === "::ffff:127.0.0.1";
}

function localGuard(req: Request): { ok: true } | { ok: false; reason: string } {
  if (!isLocalHost(req.headers.get("host"))) {
    return { ok: false, reason: `non-local host "${req.headers.get("host") ?? ""}"` };
  }
  const fwdHost = req.headers.get("x-forwarded-host");
  if (fwdHost && !isLocalHost(fwdHost.split(",")[0])) {
    return { ok: false, reason: `proxied (x-forwarded-host: ${fwdHost})` };
  }
  const ffor = req.headers.get("x-forwarded-for");
  if (ffor && !isLoopbackIp(ffor)) {
    return { ok: false, reason: `proxied (x-forwarded-for: ${ffor})` };
  }
  if (req.headers.get("forwarded")) {
    return { ok: false, reason: "proxied (forwarded header)" };
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp && !isLoopbackIp(realIp)) {
    return { ok: false, reason: `proxied (x-real-ip: ${realIp})` };
  }
  return { ok: true };
}

export async function POST(req: Request) {
  const guard = localGuard(req);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, error: `test-dial is localhost-only (${guard.reason})` },
      { status: 403 }
    );
  }
  let body: { provider?: string };
  try {
    body = (await req.json()) as { provider?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const provider = (body.provider ?? "").trim();
  if (!provider) {
    return NextResponse.json({ ok: false, error: "provider required" }, { status: 400 });
  }

  // Load the slot server-side — the raw key never reaches the client.
  let key: string;
  try {
    const row = await db.automationVault.findUnique({ where: { provider } });
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `no vault key stored for provider "${provider}"` },
        { status: 404 }
      );
    }
    key = row.key;
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  const ep = KEYED_ENDPOINTS[provider];
  if (!ep) {
    return NextResponse.json(
      {
        ok: false,
        error: `Provider "${provider}" has no allowlisted dial target (builtin never dials — the executor skips it).`,
      },
      { status: 400 }
    );
  }
  if (ep.url.includes("{ACCOUNT_ID}")) {
    // Honest wall: the vault stores a key, not an account id — a verdict here
    // would be fabricated. Point at the surface that can actually test it.
    return NextResponse.json({
      ok: false,
      provider,
      verdict: "inconclusive",
      error:
        "this provider's dial needs an account id the vault doesn't store — test it from the provider card instead",
    });
  }

  try {
    const res = await fetch(ep.url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${key}`,
        "User-Agent": "Mozilla/5.0 (compatible; PraisonAI-Web/1.0; BYOK local-first)",
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (res.ok) {
      return NextResponse.json({ ok: true, provider, verdict: "verified", httpStatus: res.status });
    }
    const text = (await res.text().catch(() => "")).slice(0, 160);
    if (res.status === 401) {
      return NextResponse.json({
        ok: false, provider, verdict: "rejected", httpStatus: res.status,
        error: text || "the provider refused this credential",
      });
    }
    if (res.status === 403 || res.status === 451) {
      return NextResponse.json({
        ok: false, provider, verdict: "inconclusive", httpStatus: res.status,
        error: text || `HTTP ${res.status}`,
      });
    }
    return NextResponse.json({
      ok: false, provider, verdict: "unreachable", httpStatus: res.status,
      error: text || `HTTP ${res.status}`,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false, provider, verdict: "unreachable",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
