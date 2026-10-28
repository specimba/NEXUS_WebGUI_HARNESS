// r709 (Cortex local-fallback, first slice): the app's own server dials the
// Upstash trio's REST APIs directly on the probe's behalf — the browser never
// CORS-fights Upstash/Box, and no Supabase edge function needs to exist for
// the lanes to be seen. BYOK doctrine: the config rides the POST body, is
// used for the dials, and is never persisted or logged; the response carries
// booleans + latency only (no secrets ride back).
import { NextResponse } from "next/server";
import { probeUpstashDirect, type CortexConfig } from "@/lib/cortex-edge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<CortexConfig> | null;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const cfg: CortexConfig = {
    url: "",
    ...(str(body?.vectorUrl) ? { vectorUrl: str(body?.vectorUrl) } : {}),
    ...(str(body?.vectorToken) ? { vectorToken: str(body?.vectorToken) } : {}),
    ...(str(body?.qstashToken) ? { qstashToken: str(body?.qstashToken) } : {}),
    ...(str(body?.boxApiKey) ? { boxApiKey: str(body?.boxApiKey) } : {}),
  };
  const out = await probeUpstashDirect(cfg);
  return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
}
