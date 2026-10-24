import { NextResponse } from "next/server";
import {
  advanceStrategyItem,
  appendDigestEntries,
  createStrategyItem,
  getStrategyContext,
  STRATEGY_STATUSES,
  syncStrategyFromSignals,
} from "@/lib/server/strategy";

export const dynamic = "force-dynamic";

// ─── r515-c: Strategic Context Layer (SCL) API ───────────────────────────────
// GET: the full context pack — items, digest stream, radar/queue/AIE summary,
// owner actions. Read-only, ungated (house convention for read GETs).
// POST (CSRF double-gate, house pattern):
//   {action:"sync"}                     → idempotent seed + radar-tryables import
//   {action:"status", id, status}       → status transition (owner/architect)
//   {action:"advance", id}              → manual advancement touch
//   {action:"item", title, kind, ...}   → create a manual backlog item
//   {action:"digest", source, text}     → append a distilled finding

function csrfOk(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) return true; // CLI / server-to-server
  if (req.headers.get("x-nexus-csrf") !== "1") return false; // preflight gate
  return site !== "cross-site";
}

const csrfReject = () =>
  NextResponse.json({ ok: false, error: "strategy rejects cross-site browser calls (CSRF gate)" }, { status: 403 });

export async function GET() {
  try {
    const ctx = await getStrategyContext();
    return NextResponse.json({ ok: true, ...ctx });
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
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
    }
    const action = String(body.action ?? "");

    if (action === "sync") {
      const result = await syncStrategyFromSignals();
      const ctx = await getStrategyContext();
      return NextResponse.json({ ok: true, ...result, ...ctx });
    }

    if (action === "status") {
      const id = String(body.id ?? "");
      const status = String(body.status ?? "");
      if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      if (!STRATEGY_STATUSES.includes(status as (typeof STRATEGY_STATUSES)[number])) {
        return NextResponse.json(
          { ok: false, error: `status must be one of ${STRATEGY_STATUSES.join("|")}` },
          { status: 400 },
        );
      }
      const { db } = await import("@/lib/db");
      const item = await db.strategyItem
        .update({ where: { id }, data: { status } })
        .catch(() => null);
      if (!item) return NextResponse.json({ ok: false, error: "item not found" }, { status: 404 });
      await appendDigestEntries([{ source: "owner", text: `${id} → ${status}` }]);
      return NextResponse.json({ ok: true, item });
    }

    if (action === "advance") {
      const id = String(body.id ?? "");
      if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
      const item = await advanceStrategyItem(id, "manual").catch(() => null);
      if (!item) return NextResponse.json({ ok: false, error: "item not found" }, { status: 404 });
      return NextResponse.json({ ok: true, item });
    }

    if (action === "item") {
      const title = String(body.title ?? "").trim();
      if (!title) return NextResponse.json({ ok: false, error: "title required" }, { status: 400 });
      const result = await createStrategyItem({
        title,
        kind: String(body.kind ?? "integration"),
        source: "chat-side",
        status: "proposed",
        priority: Number(body.priority ?? 2),
        nextAction: String(body.nextAction ?? ""),
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "digest") {
      const text = String(body.text ?? "").trim();
      if (!text) return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
      const appended = await appendDigestEntries([{ source: String(body.source ?? "chat-side"), text }]);
      return NextResponse.json({ ok: true, appended });
    }

    return NextResponse.json(
      { ok: false, error: 'unknown action — expected "sync" | "status" | "advance" | "item" | "digest"' },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
