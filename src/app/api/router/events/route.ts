import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── /api/router/events — the failover event log (r49, first-class feature) ──
// POST: batched rows from the client funnel (relay-events.ts). GET: queryable
// history for the Router view + the watchdog's pattern scans. No secrets are
// accepted or stored — hop keys, kinds, actions, clipped prose only.

interface EventRow {
  requestId?: unknown;
  hopKey?: unknown;
  providerId?: unknown;
  modelId?: unknown;
  ok?: unknown;
  kind?: unknown;
  attempt?: unknown;
  action?: unknown;
  latencyMs?: unknown;
  error?: unknown;
  transport?: unknown;
}

function clip(v: unknown, n: number): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;
}

const KINDS = new Set(["rate-limit", "network", "timeout", "credits", "auth", "region", "model", "unknown"]);
const ATTEMPTS = new Set(["primary", "relay", "probe"]);
const TRANSPORTS = new Set(["browser", "server", "probe"]);

export async function POST(req: NextRequest) {
  let body: { events?: EventRow[] };
  try {
    body = (await req.json()) as { events?: EventRow[] };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rows = Array.isArray(body.events) ? body.events.slice(0, 100) : [];
  if (rows.length === 0) return Response.json({ ok: true, inserted: 0 });

  const data = rows
    .filter((r) => typeof r.hopKey === "string" && r.hopKey.includes("::") && typeof r.ok === "boolean")
    .map((r) => {
      const hopKey = (r.hopKey as string).slice(0, 200);
      const idx = hopKey.indexOf("::");
      const kind = typeof r.kind === "string" && KINDS.has(r.kind) ? r.kind : undefined;
      const attempt = typeof r.attempt === "string" && ATTEMPTS.has(r.attempt) ? r.attempt : "relay";
      const transport = typeof r.transport === "string" && TRANSPORTS.has(r.transport) ? r.transport : "browser";
      return {
        requestId: clip(r.requestId, 120) ?? "",
        hopKey,
        providerId: clip(r.providerId, 80) ?? hopKey.slice(0, idx),
        modelId: hopKey.slice(idx + 2),
        ok: r.ok === true,
        kind,
        attempt,
        action: clip(r.action, 40),
        latencyMs: num(r.latencyMs),
        error: clip(r.error, 300),
        transport,
      };
    });

  try {
    const result = await db.relayEvent.createMany({ data });
    return Response.json({ ok: true, inserted: result.count });
  } catch (err) {
    console.error("[router/events] insert failed:", err);
    return Response.json({ error: "Insert failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider")?.trim();
  const requestId = url.searchParams.get("requestId")?.trim();
  const hopKey = url.searchParams.get("hopKey")?.trim();
  const kind = url.searchParams.get("kind")?.trim();
  const okParam = url.searchParams.get("ok")?.trim();
  const limitRaw = Number(url.searchParams.get("limit") ?? "150");
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.round(limitRaw))) : 150;
  const sinceRaw = Number(url.searchParams.get("since") ?? "");
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? new Date(sinceRaw) : undefined;

  try {
    const events = await db.relayEvent.findMany({
      where: {
        ...(provider ? { providerId: provider } : {}),
        ...(requestId ? { requestId } : {}),
        ...(hopKey ? { hopKey } : {}),
        ...(kind ? { kind } : {}),
        ...(okParam === "true" || okParam === "false" ? { ok: okParam === "true" } : {}),
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return Response.json({ ok: true, events });
  } catch (err) {
    console.error("[router/events] query failed:", err);
    return Response.json({ error: "Query failed" }, { status: 500 });
  }
}
