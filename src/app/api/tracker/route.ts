import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runKeylessSources, runVyceSource, TRACKER_SOURCES } from "@/lib/tracker-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── GET /api/tracker ────────────────────────────────────────────────────────
// Snapshot read for the ticker + radar tab: tracked models (new/free first),
// recent events, per-source health. Cheap — SQLite only.
//
// ─── POST /api/tracker (sync) ────────────────────────────────────────────────
// Diff-based catalog watcher:
//   • TTL guard: 4h between full syncs; `force` allowed once per 10 min.
//   • Keyless Tier-A sources always polled; Vyce polled ONLY when the client
//     sends the vault key per-request (BYOK — never persisted server-side).
//   • Baseline-first: a source's very first sync records rows WITHOUT emitting
//     "new" events (no 446-row spam on day one).
//   • False-alert defense: authoritative sources alert immediately; the noisy
//     HuggingFace signal feed is stored but never alerts; removals require
//     sightings ≥ 2; the 48h "new" window is enforced server-side.
//   • Upstream `created` timestamps are never trusted for novelty (vyce sends
//     a static placeholder — see tracker-sources.ts).

const SYNC_TTL_MS = 4 * 60 * 60_000; // 4h — the "firsthand window" cadence
const FORCE_MIN_GAP_MS = 10 * 60_000; // "Sync now" throttle
const NEW_WINDOW_MS = 48 * 60 * 60_000; // 2-day firsthand-advantage window
const EVENT_CAP = 300;
const PRUNE_AFTER_MS = 14 * 24 * 60 * 60_000; // drop rows unseen for 14 days

function csrfOk(req: NextRequest): boolean {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) return true; // CLI / server-to-server
  if (req.headers.get("x-praison-csrf") !== "1") return false;
  return site !== "cross-site";
}

interface TrackedRow {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string | null;
  contextWindow: number | null;
  priceIn: number | null;
  priceOut: number | null;
  free: boolean;
  sightings: number;
  isNew: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  meta: string | null;
}

function serialiseModel(m: TrackedRow) {
  return {
    ...m,
    firstSeenAt: m.firstSeenAt.toISOString(),
    lastSeenAt: m.lastSeenAt.toISOString(),
    meta: m.meta ? safeParse(m.meta) : null,
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ─── GET ─────────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const [tracked, signals, events, metas] = await Promise.all([
      db.trackedModel.findMany({
        where: { providerId: { not: "huggingface" }, removedAt: null },
        orderBy: [{ isNew: "desc" }, { free: "desc" }, { firstSeenAt: "desc" }],
        take: 160,
      }),
      db.trackedModel.findMany({
        where: { providerId: "huggingface", removedAt: null },
        orderBy: { lastSeenAt: "desc" },
        take: 40,
      }),
      db.trackerEvent.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
      db.trackerMeta.findMany(),
    ]);
    const lastSyncAt =
      metas
        .map((m) => m.lastSyncAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return NextResponse.json({
      tracked: tracked.map(serialiseModel),
      signals: signals.map(serialiseModel),
      events,
      sources: metas
        .filter((m) => m.id !== "__overall__")
        .map((m) => ({ id: m.id, lastSyncAt: m.lastSyncAt, lastOk: m.lastOk, lastError: m.lastError, modelCount: m.modelCount })),
      status: {
        lastSyncAt,
        stale: !lastSyncAt || Date.now() - lastSyncAt.getTime() > SYNC_TTL_MS,
        nextForceEligibleAt: lastSyncAt ? lastSyncAt.getTime() + FORCE_MIN_GAP_MS : 0,
        newWindowHours: NEW_WINDOW_MS / 3_600_000,
        syncTtlHours: SYNC_TTL_MS / 3_600_000,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "tracker read failed" }, { status: 500 });
  }
}

// ─── POST (sync) ─────────────────────────────────────────────────────────────
interface SyncBody {
  force?: boolean;
  vyceKey?: string;
}

export async function POST(req: NextRequest) {
  if (!csrfOk(req)) {
    return NextResponse.json({ error: "Cross-origin tracker sync is not allowed" }, { status: 403 });
  }
  let body: SyncBody = {};
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    /* empty body = default sync */
  }

  const overall = await db.trackerMeta.findUnique({ where: { id: "__overall__" } });
  const lastOverall = overall?.lastSyncAt?.getTime() ?? 0;
  const sinceLast = Date.now() - lastOverall;
  if (!body.force && sinceLast < SYNC_TTL_MS) {
    return NextResponse.json({ skipped: true, reason: "ttl", lastSyncAt: overall?.lastSyncAt, nextSyncInMs: SYNC_TTL_MS - sinceLast });
  }
  if (body.force && sinceLast < FORCE_MIN_GAP_MS) {
    return NextResponse.json({ skipped: true, reason: "throttled", lastSyncAt: overall?.lastSyncAt, nextSyncInMs: FORCE_MIN_GAP_MS - sinceLast });
  }

  // 1) Gather rows — keyless always, vyce only when a key travels with the request.
  const results = await runKeylessSources();
  const vyceKey = body.vyceKey?.trim();
  if (vyceKey) results.push(await runVyceSource(vyceKey));

  const now = new Date();
  const eventsToCreate: { type: string; modelKey: string; providerId: string; modelId: string; payload: string | null }[] = [];
  let newCount = 0;

  // 2) Upsert rows + diff.
  for (const result of results) {
    const srcCfg =
      (TRACKER_SOURCES as Record<string, { label: string; authoritative: boolean }>)[result.sourceId] ??
      { label: result.sourceId, authoritative: true };
    const authoritative = srcCfg.authoritative;
    const previousIds = new Set(
      (
        await db.trackedModel.findMany({
          where: { providerId: result.sourceId },
          select: { id: true },
        })
      ).map((r) => r.id)
    );
    const seenIds = new Set<string>();

    if (result.ok) {
      for (const row of result.rows) {
        seenIds.add(row.key);
        const existing = await db.trackedModel.findUnique({ where: { id: row.key } });
        const metaJson = row.meta ? JSON.stringify(row.meta).slice(0, 1000) : null;
        if (!existing) {
          const baseline = previousIds.size === 0; // first sync for this source → no events
          await db.trackedModel.create({
            data: {
              id: row.key,
              providerId: row.providerId,
              modelId: row.modelId,
              displayName: row.displayName ?? null,
              contextWindow: row.contextWindow ?? null,
              priceIn: row.priceIn ?? null,
              priceOut: row.priceOut ?? null,
              free: row.free,
              sightings: 1,
              // Baseline rows are NOT "new" — otherwise the first sync would
              // stamp NEW on 400+ pre-existing models. Only models that arrive
              // AFTER a source is being watched earn the firsthand badge.
              isNew: !baseline,
              firstSeenAt: now,
              lastSeenAt: now,
              meta: metaJson,
            },
          });
          if (authoritative && !baseline) {
            eventsToCreate.push({
              type: "new",
              modelKey: row.key,
              providerId: row.providerId,
              modelId: row.modelId,
              payload: JSON.stringify({
                contextWindow: row.contextWindow ?? null,
                priceIn: row.priceIn ?? null,
                priceOut: row.priceOut ?? null,
                free: row.free,
              }),
            });
            newCount += 1;
          }
        } else {
          const reappeared = !!existing.removedAt;
          // isNew is EARNED at create-time by a post-baseline arrival (the
          // "new" event path) and only ever EXPIRES via the 48h window. It is
          // never granted on update — otherwise every freshly-baselined row
          // would flip back to "new" (the 160-badge bug).
          const expired = Date.now() - existing.firstSeenAt.getTime() > NEW_WINDOW_MS;
          await db.trackedModel.update({
            where: { id: row.key },
            data: {
              sightings: { increment: 1 },
              lastSeenAt: now,
              removedAt: null,
              isNew: existing.isNew && !expired,
              displayName: row.displayName ?? existing.displayName,
              contextWindow: row.contextWindow ?? existing.contextWindow,
              priceIn: row.priceIn ?? existing.priceIn,
              priceOut: row.priceOut ?? existing.priceOut,
              meta: metaJson ?? existing.meta,
            },
          });
          if (authoritative && reappeared) {
            eventsToCreate.push({ type: "reappeared", modelKey: row.key, providerId: row.providerId, modelId: row.modelId, payload: null });
          }
        }
      }

      // 3) Removals: seen ≥2 times before, missing now, authoritative source only.
      if (authoritative) {
        const missing = [...previousIds].filter((id) => !seenIds.has(id));
        for (const key of missing) {
          const row = await db.trackedModel.findUnique({ where: { id: key } });
          if (!row || row.removedAt) continue;
          if (row.sightings < 2) continue; // never-confirmed rows just age out
          await db.trackedModel.update({ where: { id: key }, data: { removedAt: now } });
          eventsToCreate.push({ type: "removed", modelKey: row.id, providerId: row.providerId, modelId: row.modelId, payload: null });
        }
      }
    }

    await db.trackerMeta.upsert({
      where: { id: result.sourceId },
      create: {
        id: result.sourceId,
        lastSyncAt: now,
        lastOk: result.ok,
        lastError: result.error ?? null,
        modelCount: result.rows.length,
        payload: null,
      },
      update: { lastSyncAt: now, lastOk: result.ok, lastError: result.error ?? null, modelCount: result.rows.length, payload: null },
    });
  }

  // 4) Persist events (cap) + overall meta + prune stale rows.
  if (eventsToCreate.length > 0) {
    await db.trackerEvent.createMany({ data: eventsToCreate });
  }
  const keptEvents = await db.trackerEvent.findMany({ orderBy: { createdAt: "desc" }, take: EVENT_CAP, select: { id: true } });
  if (keptEvents.length >= EVENT_CAP) {
    await db.trackerEvent.deleteMany({ where: { id: { notIn: keptEvents.map((e) => e.id) } } });
  }
  await db.trackedModel.deleteMany({ where: { lastSeenAt: { lt: new Date(Date.now() - PRUNE_AFTER_MS) } } });
  const freshNew = await db.trackedModel.count({ where: { isNew: true, removedAt: null, providerId: { not: "huggingface" } } });
  await db.trackerMeta.upsert({
    where: { id: "__overall__" },
    create: { id: "__overall__", lastSyncAt: now, lastOk: true, modelCount: freshNew, payload: JSON.stringify({ newCount }) },
    update: { lastSyncAt: now, lastOk: true, payload: JSON.stringify({ newCount }) },
  });

  return NextResponse.json({
    syncedAt: now.toISOString(),
    sources: results.map((r) => ({ id: r.sourceId, ok: r.ok, models: r.rows.length, error: r.error })),
    eventsCreated: eventsToCreate.length,
    newModels: newCount,
  });
}
