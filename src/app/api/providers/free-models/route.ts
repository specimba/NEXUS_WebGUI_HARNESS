import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── GET /api/providers/free-models ──────────────────────────────────────────
// Dynamic tracking for rotating free catalogs (OpenRouter today). Server-side
// fetch avoids CORS + keeps the user's browser clean; results cached in memory
// for 10 minutes so multiple tabs don't hammer the upstream API.

interface CacheEntry {
  at: number;
  models: { id: string; label?: string; contextLength?: number }[];
}

const CACHE_TTL_MS = 10 * 60_000;
let cache: CacheEntry | null = null;

interface OpenRouterModel {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({
      provider: "openrouter",
      models: cache.models,
      fetchedAt: cache.at,
      cached: true,
    });
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`OpenRouter responded HTTP ${res.status}`);

    const data = (await res.json()) as { data?: OpenRouterModel[] };
    const models = (data.data ?? [])
      .filter((m) => typeof m.id === "string" && m.id.endsWith(":free"))
      .map((m) => ({
        id: m.id as string,
        label: (m.name ?? m.id ?? "").replace(/\s*\(free\)\s*$/i, ""),
        contextLength: typeof m.context_length === "number" ? m.context_length : undefined,
      }))
      .sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0));

    if (models.length === 0) throw new Error("No :free models in upstream catalog");

    cache = { at: Date.now(), models };
    return NextResponse.json({
      provider: "openrouter",
      models,
      fetchedAt: cache.at,
      cached: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { provider: "openrouter", models: cache?.models ?? [], error: message, fetchedAt: cache?.at ?? null },
      { status: 502 }
    );
  }
}
