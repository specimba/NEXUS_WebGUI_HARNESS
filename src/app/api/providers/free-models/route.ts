import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── GET /api/providers/free-models?provider=<id> ────────────────────────────
// Dynamic tracking for rotating free catalogs (OpenRouter, Pollinations).
// Server-side fetch avoids CORS + keeps the user's browser clean; results are
// cached in memory per provider for 10 minutes so multiple tabs don't hammer
// the upstream APIs.

interface CacheEntry {
  at: number;
  models: { id: string; label?: string; contextLength?: number }[];
}

const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, CacheEntry>();

const SUPPORTED = new Set(["openrouter", "pollinations"]);

interface OpenRouterModel {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

/** Pollinations /models rows (only the fields we consume). */
interface PollinationsModel {
  name?: string;
  description?: string;
  tier?: string;
  output_modalities?: string[];
}

async function fetchOpenRouter(): Promise<{ id: string; label?: string; contextLength?: number }[]> {
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
  return models;
}

async function fetchPollinations(): Promise<{ id: string; label?: string; contextLength?: number }[]> {
  const res = await fetch("https://text.pollinations.ai/models", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Pollinations responded HTTP ${res.status}`);
  const data = (await res.json()) as PollinationsModel[];
  const models = (Array.isArray(data) ? data : [])
    .filter(
      (m) =>
        typeof m.name === "string" &&
        m.name.length > 0 &&
        !(m.output_modalities ?? ["text"]).includes("image") // text models only
    )
    .map((m) => ({
      id: m.name as string,
      label: [m.description ?? m.name, m.tier && m.tier !== "anonymous" ? `(${m.tier} tier)` : ""]
        .filter(Boolean)
        .join(" "),
    }));
  if (models.length === 0) throw new Error("No text models in upstream catalog");
  return models;
}

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider") ?? "openrouter";
  if (!SUPPORTED.has(provider)) {
    return NextResponse.json({ provider, models: [], error: `Unknown provider "${provider}"` }, { status: 400 });
  }

  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ provider, models: hit.models, fetchedAt: hit.at, cached: true });
  }

  try {
    const models = provider === "pollinations" ? await fetchPollinations() : await fetchOpenRouter();
    cache.set(provider, { at: Date.now(), models });
    return NextResponse.json({ provider, models, fetchedAt: cache.get(provider)!.at, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { provider, models: hit?.models ?? [], error: message, fetchedAt: hit?.at ?? null },
      { status: 502 }
    );
  }
}
