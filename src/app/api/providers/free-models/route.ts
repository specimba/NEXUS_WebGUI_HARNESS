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
// This keeps providers' model rosters current (Gemini 3.8 Flash, new Groq
// uploads, Vyce additions…) with a single button — like OpenRouter's live
// catalog, everywhere.

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

// ─── Key-authed /models allowlist (one row per registry provider) ────────────
// {ACCOUNT_ID} is spliced from the vault entry (Cloudflare). Most providers
// speak the OpenAI `{ data: [...] }` shape; Cloudflare uses { result: [...] }.

interface KeyedEndpoint {
  url: string;
  /** Response shape: OpenAI-compatible "openai" | Cloudflare search "cf". */
  shape: "openai" | "cf";
  /** Some providers accept a key but work without one. */
  keyOptional?: boolean;
}

const KEYED_ENDPOINTS: Record<string, KeyedEndpoint> = {
  vyce: { url: "https://vyceai.com/v1/models", shape: "openai", keyOptional: true },
  groq: { url: "https://api.groq.com/openai/v1/models", shape: "openai" },
  "google-ai-studio": { url: "https://generativelanguage.googleapis.com/v1beta/openai/models", shape: "openai" },
  mistral: { url: "https://api.mistral.ai/v1/models", shape: "openai", keyOptional: true },
  zai: { url: "https://api.z.ai/api/paas/v4/models", shape: "openai" },
  "nvidia-nim": { url: "https://integrate.api.nvidia.com/v1/models", shape: "openai", keyOptional: true },
  sambanova: { url: "https://api.sambanova.ai/v1/models", shape: "openai" },
  cohere: { url: "https://api.cohere.ai/compatibility/v1/models", shape: "openai" },
  together: { url: "https://api.together.xyz/v1/models", shape: "openai", keyOptional: true },
  cerebras: { url: "https://api.cerebras.ai/v1/models", shape: "openai" },
  cloudflare: {
    url: "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1/models",
    shape: "cf",
  },
};

/** Non-text / internal models we never want in a chat picker. */
const NON_TEXT_RE = /embed|whisper|\btts\b|guard|rerank|moderation|sdxl|imagen|imagine|diffusion|vision-?(?:enc|only)/i;

interface RawModelRow {
  id?: string;
  name?: string;
  context_window?: number;
  context_length?: number;
  type?: string;
  owned_by?: string;
  description?: string;
}

function normalizeOpenAI(data: unknown): { id: string; label?: string; contextLength?: number }[] {
  const rows = (data as { data?: RawModelRow[] } | null)?.data ?? [];
  const out: { id: string; label?: string; contextLength?: number }[] = [];
  for (const m of rows) {
    const id = typeof m.id === "string" ? m.id : typeof m.name === "string" ? m.name : "";
    if (!id || NON_TEXT_RE.test(id)) continue;
    if (m.type && m.type !== "model" && m.type !== "text") continue; // e.g. vyce type:"image"
    const ctx =
      typeof m.context_window === "number"
        ? m.context_window
        : typeof m.context_length === "number"
          ? m.context_length
          : undefined;
    out.push({ id, label: prettifyLabel(id), contextLength: ctx });
  }
  return out;
}

function normalizeCf(data: unknown): { id: string; label?: string; contextLength?: number }[] {
  const rows = (data as { result?: RawModelRow[] } | null)?.result ?? [];
  const out: { id: string; label?: string; contextLength?: number }[] = [];
  for (const m of rows) {
    const id = typeof m.name === "string" ? m.name : typeof m.id === "string" ? m.id : "";
    if (!id || NON_TEXT_RE.test(id)) continue;
    out.push({ id, label: prettifyLabel(id), contextLength: undefined });
  }
  return out;
}

/** "meta-llama/Llama-3.3-70B-Instruct-Turbo" → "Llama 3.3 70B Instruct Turbo" */
function prettifyLabel(id: string): string {
  const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return tail
    .replace(/[:_]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? " — the saved key was rejected; re-check it on the provider card"
          : "";
      return NextResponse.json(
        { error: `HTTP ${res.status}${hint}: ${text.slice(0, 160) || "models endpoint failed"}` },
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
