import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { buildWatchdogReport, type WatchdogEventRow } from "@/lib/router-watchdog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── /api/router/watchdog — pattern scan over the failover event log (r49) ───
// GET ?days=7 — aggregates the RelayEvent history into provider stats +
// findings (capacity cycles, hard streaks, auth locks, fail rates). Findings
// are SUGGESTIONS; the human applies weight changes in the Router view.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days") ?? "7");
  const days = Number.isFinite(daysRaw) ? Math.min(30, Math.max(1, Math.round(daysRaw))) : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const events = await db.relayEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });
    const report = buildWatchdogReport(events as WatchdogEventRow[], days);
    return Response.json({ ok: true, report });
  } catch (err) {
    console.error("[router/watchdog] scan failed:", err);
    return Response.json({ error: "Watchdog scan failed" }, { status: 500 });
  }
}
