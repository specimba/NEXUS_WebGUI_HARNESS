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

const KNOWN = new Set(["web_search", "read_url", "run_code", "current_time", "arxiv_search"]);

// r26 SECURITY: same-origin gate. The executor can search the web, fetch
// arbitrary URLs and run sandboxed code — a foreign website's page must not
// be able to drive it from a victim's browser (drive-by CSRF). Same-origin
// POSTs from our own UI always carry an Origin header matching the host;
// non-browser clients that send no Origin are allowed (local CLI/server use).
function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
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
