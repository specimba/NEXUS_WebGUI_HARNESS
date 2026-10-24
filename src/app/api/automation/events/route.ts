import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  AUTOMATION_EVENT_LOG_KEY,
  emitAutomationEvent,
} from "@/lib/server/automation-executor";

export const dynamic = "force-dynamic";

// ─── TASK-101 slice 3 (r521): the waitForEvent event lane ───────────────────
// POST { event, payload? } — emit a named event; any server-lane step parked
// on a waitForEvent checkpoint with that name resumes on the claim loop's
// next tick. Events live in a capped JSON log (PlatformSetting
// "automation.events.v1") — the same log the executor's wait evaluation reads.
// GET — the recent event log (operator visibility).

export async function POST(req: Request) {
  let body: { event?: unknown; payload?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* handled by the name check below */
  }
  const name = typeof body.event === "string" ? body.event.trim() : "";
  if (!name) {
    return NextResponse.json(
      { ok: false, error: "event name required" },
      { status: 400 },
    );
  }
  try {
    const payload = typeof body.payload === "string" ? body.payload : undefined;
    const logSize = await emitAutomationEvent(name, payload);
    return NextResponse.json({
      ok: true,
      event: name.slice(0, 120),
      logSize,
      note: "any step waiting on this event resumes on the next claim tick (≤15s)",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const row = await db.platformSetting.findUnique({
      where: { id: AUTOMATION_EVENT_LOG_KEY },
    });
    let events: unknown[] = [];
    try {
      const parsed = JSON.parse(row?.value ?? "[]") as unknown;
      if (Array.isArray(parsed)) events = parsed;
    } catch {
      /* corrupt log reads empty — the next emit repairs it */
    }
    return NextResponse.json({ ok: true, events });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
