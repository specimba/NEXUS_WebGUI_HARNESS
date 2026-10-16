import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── v25/r133: Automation Vault consumer handoff ────────────────────────────
// The headless scheduler mini-service runs OUTSIDE this app (sandbox process,
// heartbeat-driven — see /api/automation/sync). When it claims a due workflow
// it dials LLM lanes directly and needs the user's stored vault key so
// closed-tab runs use the user's own quota instead of the congested shared
// lane. This endpoint is that handoff: POST { provider } → { key }.
//
// Trust model (r138: ENFORCED, no longer just assumed): the key already
// lives in this machine's SQLite DB in plain text — any same-host process
// can read it directly. Serving it over localhost HTTP adds no new exposure
// and gives the service a stable, DB-agnostic contract (it never touches
// Prisma/SQLite paths). This endpoint is therefore LOCALHOST-ONLY: requests
// whose Host is not localhost/127.0.0.1/::1, or that arrive through a proxy
// (non-local x-forwarded-host / x-forwarded-for / x-real-ip, or any
// `forwarded` header), are rejected 403 BEFORE any key lookup. Guard limits
// (honest): a same-LAN client can still spoof `Host` — this is
// defense-in-depth against accidental remote exposure, not auth; deliberate
// exposure beyond localhost must add real auth.
//
// r321 browser drive-by gate (house doctrine, mirrors tools/execute r26.1):
// the r138 guard stops proxies and DNS-rebinding but a page on ANOTHER origin
// in the user's browser could still FIRE this POST — a text/plain body skips
// preflight and the route's json().catch(() => ({})) defaults provider to
// "builtin". The response was unreadable to that page under same-origin
// policy — but that shield is one CORS misconfiguration away from gone, so
// the gate is enforced here instead of trusted upstream: foreign pages cannot
// attach "x-nexus-csrf" without a granted preflight (never granted), and
// Sec-Fetch-Site "cross-site" is rejected outright. Non-browser callers (the
// scheduler mini-service, CLI) send neither Origin nor Sec-Fetch-Site and
// pass — the r133 handoff contract is unchanged. The same-LAN raw-process
// limit above remains honestly open.
// The key is NEVER logged,
// never telemetered, and never returned by GET /api/vault (masked-only).
//
// Response shapes:
//   200 { ok: true, provider, key, updatedAt }
//   400 { ok: false, error: "provider required" }
//   403 { ok: false, error: "consume is localhost-only (<reason>)" }
//   403 { ok: false, error: "consume rejects cross-site browser calls (CSRF gate)" }
//   404 { ok: false, error: "no vault key stored for this provider" }

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

function csrfOk(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) return true; // CLI / server-to-server
  if (req.headers.get("x-nexus-csrf") !== "1") return false; // preflight gate
  return site !== "cross-site";
}

export async function POST(req: Request) {
  try {
    const guard = localGuard(req);
    if (!guard.ok) {
      return NextResponse.json(
        { ok: false, error: `consume is localhost-only (${guard.reason})` },
        { status: 403 }
      );
    }
    if (!csrfOk(req)) {
      return NextResponse.json(
        { ok: false, error: "consume rejects cross-site browser calls (CSRF gate)" },
        { status: 403 }
      );
    }
    const body = (await req.json().catch(() => ({}))) as { provider?: string };
    const provider = (body.provider ?? "builtin").trim();
    if (!provider) {
      return NextResponse.json({ ok: false, error: "provider required" }, { status: 400 });
    }
    const row = await db.automationVault.findUnique({ where: { provider } });
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `no vault key stored for provider "${provider}"` },
        { status: 404 }
      );
    }
    return NextResponse.json({
      ok: true,
      provider: row.provider,
      key: row.key,
      updatedAt: row.updatedAt,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
