import { NextRequest, NextResponse } from "next/server";
import { executeTool } from "@/lib/server/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── POST /api/tools/execute ─────────────────────────────────────────────────
// Tool executor for the BROWSER-DIRECT engine: when the agentic LLM loop runs
// in the user's browser (their network, their keys, no server-region 403s),
// tools still execute here — web_search needs the server SDK and read_url
// needs a CORS-free fetcher. Body: { name, args } → ToolResult JSON.
// Allowlist: only known tool ids are executable.

const KNOWN = new Set([
  "web_search",
  "read_url",
  "run_code",
  "current_time",
  "arxiv_search",
  // r26-3 tools expansion (all keyless; SDK wrappers included)
  "wikipedia_search",
  "hacker_news_search",
  "github_repo_read",
  "package_info",
  "market_rates",
  "uuid_hash",
  "image_generate",
  "tts_speak",
]);

// r26.1 SECURITY: CSRF gate — REBUILT to survive gateway/iframe deployments.
// The executor can search the web, fetch arbitrary URLs and run sandboxed
// code — a foreign website's page must not be able to drive it from a victim's
// browser (drive-by CSRF). Two independent gates:
//   1. Custom-header gate — our UI always sends "x-praison-csrf: 1". Cross-
//      origin pages CANNOT attach custom headers without a successful CORS
//      preflight, and we never grant preflight to foreign origins. This alone
//      defeats drive-by CSRF — and unlike the old `Origin === Host` check it
//      keeps working when a gateway/proxy rewrites Host (the bug that 403'd
//      every legitimate tool call in preview).
//   2. Fetch-metadata gate — modern browsers stamp Sec-Fetch-Site; a foreign
//      page driving the victim's browser yields "cross-site" → rejected.
// Non-browser clients (local CLI, server-to-server) send neither Origin nor
// Sec-Fetch-Site and remain allowed.
function csrfOk(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) return true; // CLI / server-to-server
  if (req.headers.get("x-praison-csrf") !== "1") return false; // preflight gate
  return site !== "cross-site";
}

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) {
    return NextResponse.json({ error: "Cross-origin tool execution is not allowed" }, { status: 403 });
  }
  let body: { name?: string; args?: string };
  try {
    body = (await req.json()) as { name?: string; args?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = body.name?.trim() ?? "";
  if (!name || !KNOWN.has(name)) {
    return NextResponse.json({ error: `Unknown tool "${name}"` }, { status: 400 });
  }
  const args = typeof body.args === "string" ? body.args : "{}";
  // r25: client disconnects cancel in-flight tool work where the underlying
  // implementation can honor a signal.
  const result = await executeTool(name, args, req.signal);
  return NextResponse.json(result);
}

/** GET: advertise the executable tool ids. */
export async function GET() {
  return NextResponse.json({ tools: [...KNOWN] });
}
