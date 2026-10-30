// r787 (Owner-directed): serves the EXACT edge-function source file from the
// repo tree so the Settings → Cortex Edge "Copy function source" button can
// paste it into the Supabase AI chat (or the Via Editor) without shipping a
// 64 KB string inside the client bundle. The file is already public in the
// repository (deliverables/nexus-cortex-harness/) — no secret material rides
// this route; it is read fresh per request so a source bump always serves the
// current bytes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_PATH = join(
  process.cwd(),
  "deliverables",
  "nexus-cortex-harness",
  "nexus-cortex-harness-edge-function.ts",
);

export async function GET() {
  try {
    const src = readFileSync(SOURCE_PATH, "utf8");
    return new NextResponse(src, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-nexus-cortex-source-bytes": String(Buffer.byteLength(src, "utf8")),
      },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "source file not found in the repo tree — expected deliverables/nexus-cortex-harness/nexus-cortex-harness-edge-function.ts",
      },
      { status: 500 },
    );
  }
}
