import { NextResponse } from "next/server";
import {
  enqueueResearchTargets,
  getAutonomySnapshot,
  runAutonomyCycle,
} from "@/lib/server/autonomy";

export const dynamic = "force-dynamic";

// ─── r515: Autonomous Improvement Engine (AIE) API ───────────────────────────
// GET: the full snapshot the panel polls — latest cycle log, latest report,
// queue counts, the 5 most recent moves, and the engine's arm/next-fire
// state. Read-only, no gate (house convention: read GETs ungated).
// POST: two state-changing actions behind the house CSRF double-gate:
//   {action:"cycle"}   → run one 10-min bucket now (idempotent — a same-bucket
//                        re-run answers {alreadyRan:true} instead of faking).
//   {action:"enqueue", urls:[...]} → normalized bulk import into the
//                        ResearchQueue (dedupe by id, cap 500, honest counts).

function csrfOk(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) return true; // CLI / server-to-server
  if (req.headers.get("x-nexus-csrf") !== "1") return false; // preflight gate
  return site !== "cross-site";
}

const csrfReject = () =>
  NextResponse.json({ ok: false, error: "autonomy rejects cross-site browser calls (CSRF gate)" }, { status: 403 });

export async function GET() {
  try {
    const snapshot = await getAutonomySnapshot();
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!csrfOk(req)) return csrfReject();
  try {
    let body: { action?: unknown; urls?: unknown };
    try {
      body = (await req.json()) as { action?: unknown; urls?: unknown };
    } catch {
      return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
    }
    if (body.action === "cycle") {
      const result = await runAutonomyCycle();
      const snapshot = await getAutonomySnapshot();
      return NextResponse.json({ ok: true, alreadyRan: result.alreadyRan, log: result.log, ...snapshot });
    }
    if (body.action === "enqueue") {
      if (!Array.isArray(body.urls)) {
        return NextResponse.json({ ok: false, error: "urls must be an array of strings" }, { status: 400 });
      }
      const counts = await enqueueResearchTargets(body.urls, "manual");
      return NextResponse.json({ ok: true, ...counts });
    }
    return NextResponse.json(
      { ok: false, error: 'unknown action — expected "cycle" or "enqueue"' },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
