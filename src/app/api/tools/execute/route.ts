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

const KNOWN = new Set(["web_search", "read_url", "run_code", "current_time"]);

export async function POST(req: NextRequest) {
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
  const result = await executeTool(name, args);
  return NextResponse.json(result);
}

/** GET: advertise the executable tool ids. */
export async function GET() {
  return NextResponse.json({ tools: [...KNOWN] });
}
