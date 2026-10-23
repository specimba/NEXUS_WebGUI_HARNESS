import { NextResponse } from "next/server";
import {
  EGRESS_UPSTREAMS,
  readRoutingMap,
  writeRoutingMap,
  type EgressMode,
} from "@/lib/server/egress";

export const dynamic = "force-dynamic";

// ─── r514: per-upstream egress routing registry (GET / PUT) ──────────────────
// The owner-facing control for the `egress.routing` PlatformSetting that
// server/egress.ts consumes via readRoutingMap()/routeFor(). Per-upstream
// decisions DEFAULT to "direct" (absent = direct); "pool" sends an upstream
// through the owner's Webshare pool. Only the known upstream keys (groq, vyce,
// openai, generic) are settable — everything else is refused.
//
// P7: this endpoint deals ONLY in mode strings — no secret values are
// accepted, stored, or returned. Writing a mode is independent of the
// Webshare token state (a pool decision against an unconfigured pool honestly
// fails at probe/use time, not here).

const KNOWN_UPSTREAMS: readonly string[] = EGRESS_UPSTREAMS;
const ROUTING_MODES: readonly EgressMode[] = ["direct", "pool"];

function isEgressMode(v: unknown): v is EgressMode {
  return v === "direct" || v === "pool";
}

function csrfOk(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) return true; // CLI / server-to-server
  if (req.headers.get("x-nexus-csrf") !== "1") return false; // preflight gate
  return site !== "cross-site";
}

export async function GET() {
  const routing = await readRoutingMap();
  return NextResponse.json({
    ok: true,
    routing,
    upstreams: KNOWN_UPSTREAMS,
  });
}

export async function PUT(req: Request) {
  if (!csrfOk(req)) {
    return NextResponse.json({ ok: false, error: "egress rejects cross-site browser calls (CSRF gate)" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const raw = (body ?? {}) as { upstreamKey?: unknown; mode?: unknown };

  if (typeof raw.upstreamKey !== "string" || !KNOWN_UPSTREAMS.includes(raw.upstreamKey)) {
    return NextResponse.json(
      {
        ok: false,
        error: `upstreamKey must be one of: ${KNOWN_UPSTREAMS.join(", ")}.`,
      },
      { status: 400 },
    );
  }
  if (!isEgressMode(raw.mode)) {
    return NextResponse.json(
      {
        ok: false,
        error: `mode must be exactly one of: ${ROUTING_MODES.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  const upstreamKey = raw.upstreamKey;
  const mode: EgressMode = raw.mode;
  const persisted = await writeRoutingMap(upstreamKey, mode);
  if (!persisted) {
    return NextResponse.json(
      { ok: false, error: "Could not persist the egress routing decision — try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, routing: await readRoutingMap() });
}
