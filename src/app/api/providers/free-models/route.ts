import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── GET /api/providers/free-models?provider=<id> ────────────────────────────
// Dynamic tracking for rotating free catalogs (OpenRouter, Pollinations) —
// keyless endpoints, cached server-side for 10 minutes.
//
// ─── POST /api/providers/free-models ─────────────────────────────────────────
// Universal "Refresh models" for EVERY registry provider (r22): the client
// sends { providerId, key?, accountId? } — the key travels per-request from
// the user's vault and is used ONLY against the allowlisted /models endpoint
// of the provider they picked. Nothing is stored or logged server-side.
//
// r23: the endpoint table + normalizers moved to src/lib/provider-refresh.ts
// (shared with the BROWSER fallback — when this server is region-blocked by a
// provider, the gallery retries the same roster straight from the user's
// network). OrcaRouter added (public keyless /v1/models); Cloudflare URL fixed
// to /ai/models/search (the old /ai/v1/models answered 405).

import { KEYED_ENDPOINTS, normalizeCf, normalizeOpenAI } from "@/lib/provider-refresh";

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

// ─── POST — key-authed refresh for every registry provider ───────────────────

interface RefreshBody {
  providerId?: string;
  key?: string;
  accountId?: string;
}

export async function POST(req: NextRequest) {
  let body: RefreshBody;
  try {
    body = (await req.json()) as RefreshBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const providerId = body.providerId?.trim() ?? "";
  if (!providerId) return NextResponse.json({ error: "providerId is required" }, { status: 400 });

  // Keyless rotating catalogs: delegate to the shared GET path (same cache).
  if (SUPPORTED.has(providerId)) {
    const fakeReq = new NextRequest(new URL(`/api/providers/free-models?provider=${encodeURIComponent(providerId)}`, req.url));
    return GET(fakeReq);
  }

  const ep = KEYED_ENDPOINTS[providerId];
  if (!ep) {
    return NextResponse.json({ error: `Provider "${providerId}" has no live models endpoint` }, { status: 400 });
  }
  const key = body.key?.trim() ?? "";
  if (!key && !ep.keyOptional) {
    return NextResponse.json({ error: "A saved key is required to refresh this provider's models" }, { status: 400 });
  }
  const url = ep.url.replace("{ACCOUNT_ID}", (body.accountId ?? "").trim());
  if (url.includes("{ACCOUNT_ID}")) {
    return NextResponse.json({ error: "This provider needs your account id (Settings → save it on the card)" }, { status: 400 });
  }

  const hit = cache.get(providerId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json({ providerId, models: hit.models, fetchedAt: hit.at, cached: true });
  }

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; PraisonAI-Web/1.0; BYOK local-first)",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const regionish = res.status === 403 || res.status === 451;
      const hint = regionish
        ? " — likely a server-region/IP block (your key is fine): the provider card will retry from your browser"
        : res.status === 401
          ? " — the saved key was rejected; re-check it on the provider card"
          : "";
      return NextResponse.json(
        { error: `HTTP ${res.status}${hint}: ${text.slice(0, 160) || "models endpoint failed"}`, regionBlocked: regionish },
        { status: 502 }
      );
    }
    const data = JSON.parse(text) as unknown;
    const models = ep.shape === "cf" ? normalizeCf(data) : normalizeOpenAI(data);
    if (models.length === 0) throw new Error("Upstream returned no chat models");
    cache.set(providerId, { at: Date.now(), models });
    return NextResponse.json({ providerId, models, fetchedAt: Date.now(), cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { providerId, models: hit?.models ?? [], error: message, fetchedAt: hit?.at ?? null },
      { status: 502 }
    );
  }
}
