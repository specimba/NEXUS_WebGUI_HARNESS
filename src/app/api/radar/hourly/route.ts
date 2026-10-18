import { NextResponse } from "next/server";
import { getRadarSnapshot, runCapabilityCheck } from "@/lib/server/capability-radar";

export const dynamic = "force-dynamic";

// ─── r497: Capability Radar — the hourly platform self-check ────────────────
// GET: latest digest + trailing history (the Server autopilot panel polls
// this alongside /api/automation/sync).
// POST: run a check NOW. Idempotent per UTC hour bucket (upsert), so the
// panel's "Check now" button and the hourly timer can never duplicate rows.
// Like run-now, this mutates nothing the owner would lose — it recomputes a
// digest from first-party tables — so it carries no extra gate beyond the
// local-only server.

export async function GET() {
  try {
    const snapshot = await getRadarSnapshot();
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), latest: null, history: [] },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const digest = await runCapabilityCheck();
    const snapshot = await getRadarSnapshot();
    return NextResponse.json({ ok: true, digest, ...snapshot });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
