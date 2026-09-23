import { NextRequest, NextResponse } from "next/server";
import { guardPublicUrl } from "@/lib/server/url-guard";
import { MCP_PROXY_RESPONSE_CAP } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── POST /api/mcp — SSRF-guarded relay for stateless MCP calls (r38) ───────
// Browser-direct transport is the doctrine (keys never touch the app server),
// but CORS-starved MCP servers cannot be reached from a browser at all. This
// proxy is the per-server OPT-IN fallback (McpServer.useProxy, default off —
// the UI says plainly that headers transit the app server when enabled).
//
// Security mirrors /api/tools/execute:
//   • CSRF gate (custom header + Sec-Fetch-Site) — drive-by CSRF impossible.
//   • guardPublicUrl() — loopback/private/link-local/metadata targets blocked;
//     https-only (MCP endpoints are API surfaces, not web pages).
//   • Header allowlist shape (alphanumeric-dash names, hop-by-hop dropped in
//     the client) + response size cap + hard deadline.
// Nothing about a request or response is persisted.

const MCP_PROXY_TIMEOUT_MS = 65_000; // slightly above the client's MCP_CALL_TIMEOUT_MS

function csrfOk(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) return true; // CLI / server-to-server
  if (req.headers.get("x-praison-csrf") !== "1") return false;
  return site !== "cross-site";
}

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) {
    return NextResponse.json({ error: "Cross-origin MCP relay is not allowed" }, { status: 403 });
  }
  let body: { url?: string; headers?: Record<string, string>; payload?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ error: "Missing MCP endpoint url" }, { status: 400 });

  // SSRF gate — same classes as read_url/relay, but https-only (no allowHttp).
  const verdict = guardPublicUrl(url);
  if (!verdict.ok) {
    return NextResponse.json({ error: `Blocked endpoint: ${verdict.reason}` }, { status: 400 });
  }

  const outHeaders: Record<string, string> = {};
  const entries = Object.entries(body.headers ?? {}).slice(0, 12);
  for (const [k, v] of entries) {
    const name = String(k).trim();
    if (!name || !/^[A-Za-z0-9-]+$/.test(name)) continue;
    if (/^(host|content-length|connection|transfer-encoding|expect|origin|referer|cookie|accept-encoding)$/i.test(name)) continue;
    if (typeof v !== "string" || !v) continue;
    outHeaders[name] = v.slice(0, 2048);
  }
  if (typeof body.payload !== "object" || body.payload === null) {
    return NextResponse.json({ error: "Missing JSON-RPC payload" }, { status: 400 });
  }

  const timeout = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(MCP_PROXY_TIMEOUT_MS) : undefined;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...outHeaders,
      },
      body: JSON.stringify(body.payload),
      ...(timeout ? { signal: timeout } : {}),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return NextResponse.json(
      { error: timedOut ? `MCP endpoint timed out after ${Math.round(MCP_PROXY_TIMEOUT_MS / 1000)}s` : "MCP endpoint unreachable" },
      { status: 504 }
    );
  }
  const contentType = upstream.headers.get("content-type") ?? "application/json";
  let text = await upstream.text().catch(() => "");
  if (text.length > MCP_PROXY_RESPONSE_CAP) {
    text = text.slice(0, MCP_PROXY_RESPONSE_CAP);
  }
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
  });
}
