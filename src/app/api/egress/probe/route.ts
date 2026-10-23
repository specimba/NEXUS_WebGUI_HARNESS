import { NextResponse } from "next/server";
import { probeEgress } from "@/lib/server/egress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── r514: egress probe (GET) ────────────────────────────────────────────────
// Runs probeEgress(): every target (generic Cloudflare-trace, groq models)
// dialed DIRECT and through up to 3 pool proxies, in parallel per target.
// 20s hard cap — an honest TIMEOUT shape on overrun. Result carries statuses,
// country codes and typed errors ONLY (never bodies, IPs, or proxy identities).

const PROBE_BUDGET_MS = 20_000;

export async function GET() {

  const budget = new Promise<{ timedOut: true }>((resolve) => {
    const t = setTimeout(() => resolve({ timedOut: true }), PROBE_BUDGET_MS);
    if (typeof t === "object" && t && "unref" in t) (t as { unref: () => void }).unref();
  });

  const raced = await Promise.race([
    probeEgress().then((probe) => ({ timedOut: false as const, probe })),
    budget,
  ]);

  if (raced.timedOut) {
    return NextResponse.json(
      {
        ok: true,
        probe: {
          checkedAt: new Date().toISOString(),
          timedOut: true,
          error: "probe exceeded its 20s budget — one of the targets is hanging (honest timeout, no fabricated results).",
          targets: [],
        },
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, probe: raced.probe });
}
