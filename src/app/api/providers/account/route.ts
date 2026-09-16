import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── POST /api/providers/account ─────────────────────────────────────────────
// Credits/balance probe for providers that expose an account-info endpoint
// (mePath in the registry — Vyce /v1/me today). The key travels per-request
// from the user's local vault and is used ONLY against the provider they
// picked; nothing is stored or logged server-side (zero telemetry).

interface AccountBody {
  providerId?: string;
  key?: string;
}

export async function POST(req: NextRequest) {
  let body: AccountBody;
  try {
    body = (await req.json()) as AccountBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const providerId = body.providerId?.trim();
  const key = body.key?.trim();
  if (!providerId || !key) {
    return NextResponse.json({ error: "providerId and key are required" }, { status: 400 });
  }

  // Server-side allowlist — only providers with an explicit account endpoint.
  const ME_ENDPOINTS: Record<string, string> = {
    vyce: "https://vyceai.com/v1/me",
  };
  const url = ME_ENDPOINTS[providerId];
  if (!url) {
    return NextResponse.json({ error: `Provider "${providerId}" has no account endpoint` }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return NextResponse.json(
        { error: `HTTP ${res.status}: ${text.slice(0, 200) || "account endpoint failed"}` },
        { status: 502 }
      );
    }
    const data = JSON.parse(text) as Record<string, unknown>;
    // Whitelist only the display fields — never echo the raw payload.
    return NextResponse.json({
      providerId,
      name: typeof data.name === "string" ? data.name : undefined,
      balance: typeof data.balance === "number" ? data.balance : undefined,
      rateLimit: typeof data.rateLimit === "number" ? data.rateLimit : undefined,
      enabled: typeof data.enabled === "boolean" ? data.enabled : undefined,
      totalSpent: typeof data.totalSpent === "number" ? data.totalSpent : undefined,
      totalRequests: typeof data.totalRequests === "number" ? data.totalRequests : undefined,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
