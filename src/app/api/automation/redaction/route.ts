import { NextResponse } from "next/server";
import { redactionStats } from "@/lib/redaction";

export const dynamic = "force-dynamic";

// ─── TASK-102 slice 2 (r525): telemetry surface for the redaction choke ─────
// The Engine panel (server-autopilot) polls this alongside /api/automation/sync
// so the operator SEES the guard working: every string the choke has masked
// (pattern classes + exact vault values) since server boot, in-memory only.
export async function GET() {
  return NextResponse.json({ ok: true, redaction: redactionStats() });
}
