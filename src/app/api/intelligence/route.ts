import { NextResponse } from "next/server";

// ─── GET /api/intelligence — benchmark intelligence index (r516) ─────────────
// The producer (lib/server/intelligence-index.ts) distills arena.ai WebDev +
// Agent boards and artificialanalysis.ai's intelligence + coding-agents boards
// into one composite index. The relay chain (client-side, keys never leave the
// browser) reads this PUBLIC data to order lanes — the vault itself is never
// consulted here. ?fresh=1 forces a re-fetch (owner's Refresh button);
// otherwise the 6h PlatformSetting cache answers.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fresh = url.searchParams.get("fresh") === "1";
  try {
    const { getIntelligenceIndex } = await import("@/lib/server/intelligence-index");
    const index = await getIntelligenceIndex({ fresh });
    return NextResponse.json(index, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Intelligence index failed: ${err.message.slice(0, 120)}`
            : "Intelligence index failed.",
      },
      { status: 500 }
    );
  }
}
