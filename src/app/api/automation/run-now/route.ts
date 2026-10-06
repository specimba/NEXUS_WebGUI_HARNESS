import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// ─── v20: fire a registered workflow on the server immediately ──────────────
// Sets nextRunAt = now; the in-repo claim loop (automation-executor, 15s
// tick) claims it within ~30s when it is driving (tab closed or heartbeat
// stale). Meant for closed-tab mode —
// while the tab is open, the in-app Run button uses the BYOK lane.

export async function POST(req: Request) {
  try {
    const { workflowId } = (await req.json()) as { workflowId?: string };
    if (!workflowId) {
      return NextResponse.json({ ok: false, error: "workflowId required" }, { status: 400 });
    }
    const row = await db.automationWorkflow.findUnique({ where: { id: workflowId } });
    if (!row) {
      return NextResponse.json({ ok: false, error: "workflow not registered" }, { status: 404 });
    }
    await db.automationWorkflow.update({
      where: { id: workflowId },
      data: { nextRunAt: new Date(), enabled: true },
    });
    return NextResponse.json({ ok: true, queued: row.name });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
