import { NextResponse } from "next/server";

// ─── GET /api/freellm — free reach census (r517) ─────────────────────────────
// The producer (lib/server/freellm-index.ts) crawls freellm.sh's served
// flight payload ONCE and derives the Owner's filtered view server-side:
// access ∈ {free-tier, free-forever, signup-credits} ∧ status operational,
// newest first. This is PUBLIC reach data — the relay panel reads it to pair
// with the r516 benchmark intelligence index (reach × intelligence); no vault
// key is ever consulted here. ?fresh=1 forces a re-fetch (Refresh button);
// otherwise the 6h PlatformSetting cache answers. The producer fail-opens —
// this route only 500s if the module itself cannot load.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fresh = url.searchParams.get("fresh") === "1";
  try {
    const { getFreellmIndex } = await import("@/lib/server/freellm-index");
    const index = await getFreellmIndex({ fresh });
    return NextResponse.json(index, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Free reach census failed: ${err.message.slice(0, 120)}`
            : "Free reach census failed.",
      },
      { status: 500 }
    );
  }
}
