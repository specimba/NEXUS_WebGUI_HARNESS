// ─── Free/New Model Tracker — source fetchers (r28) ──────────────────────────
// Server-side only. Every URL here is a FIXED, allowlisted constant (no user
// input flows into fetch), so no SSRF surface. Sources are tiered:
//   • Tier A keyless always-on: OpenRouter, OrcaRouter, AIHubMix, Pollinations
//   • Tier A "signal" (noisy, stored but never ticker-alerted): HuggingFace
//   • Tier B key-authed-when-key-travels: Vyce (BYOK — key sent per-request
//     by the client from the vault, never persisted server-side)
//
// Ground truth: docs/research/free-model-tracker-r28.md — upstream `created`
// timestamps are UNTRUSTWORTHY for vyce (static placeholder) and inconsistent
// elsewhere, so novelty is determined by OUR diff (firstSeenAt), never by the
// upstream clock.

/** Filter for non-chat internal models (same doctrine as provider-refresh). */
const NON_TEXT_RE =
  /embed|whisper|\btts\b|guard|rerank|moderation|sdxl|imagen|imagine|diffusion|vision-?(?:enc|only)|voice|transcribe/i;

export interface TrackerRow {
  key: string; // "providerId::modelId" — matches the relay hopKey convention
  providerId: string;
  modelId: string;
  displayName?: string;
  contextWindow?: number;
  priceIn?: number; // $ per 1M prompt tokens
  priceOut?: number; // $ per 1M completion tokens
  free: boolean;
  meta?: Record<string, unknown>;
}

export interface SourceResult {
  sourceId: string;
  ok: boolean;
  rows: TrackerRow[];
  error?: string;
}

const TIMEOUT_MS = 14_000;

async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; PraisonAI-Web/1.0; BYOK local-first)", ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── OpenRouter: 446 models, real `created`, per-token pricing ────────────────
interface OrModel {
  id?: string;
  name?: string;
  created?: number;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

async function fetchOpenRouter(): Promise<TrackerRow[]> {
  const data = (await getJson("https://openrouter.ai/api/v1/models")) as { data?: OrModel[] };
  const out: TrackerRow[] = [];
  for (const m of data.data ?? []) {
    if (typeof m.id !== "string" || !m.id) continue;
    if (NON_TEXT_RE.test(m.id)) continue;
    const pin = parseFloat(m.pricing?.prompt ?? "");
    const pout = parseFloat(m.pricing?.completion ?? "");
    const priceIn = Number.isFinite(pin) ? pin * 1_000_000 : undefined;
    const priceOut = Number.isFinite(pout) ? pout * 1_000_000 : undefined;
    out.push({
      key: `openrouter::${m.id}`,
      providerId: "openrouter",
      modelId: m.id,
      displayName: m.name,
      contextWindow: typeof m.context_length === "number" ? m.context_length : undefined,
      priceIn,
      priceOut,
      // Free lane: either the :free suffix or an exact-zero both-sides price.
      free: m.id.endsWith(":free") || (priceIn === 0 && priceOut === 0),
      meta: { created: m.created ?? null, name: m.name ?? null },
    });
  }
  if (out.length === 0) throw new Error("empty catalog");
  return out;
}

// ── OrcaRouter: 197 models, real `created`, no pricing ───────────────────────
interface OraModel {
  id?: string;
  created?: number;
  owned_by?: string;
  context_window?: number;
}

async function fetchOrcaRouter(): Promise<TrackerRow[]> {
  const data = (await getJson("https://api.orcarouter.ai/v1/models")) as { data?: OraModel[] };
  const out: TrackerRow[] = [];
  for (const m of data.data ?? []) {
    if (typeof m.id !== "string" || !m.id) continue;
    if (NON_TEXT_RE.test(m.id)) continue;
    out.push({
      key: `orcarouter::${m.id}`,
      providerId: "orcarouter",
      modelId: m.id,
      contextWindow: typeof m.context_window === "number" ? m.context_window : undefined,
      free: /(^|\/)(orcarouter\/free)|-free$|:free$/i.test(m.id),
      meta: { created: m.created ?? null, owned_by: m.owned_by ?? null },
    });
  }
  if (out.length === 0) throw new Error("empty catalog");
  return out;
}

// ── Pollinations: small keyless text catalog ─────────────────────────────────
interface PolloModel {
  name?: string;
  description?: string;
  tier?: string;
  output_modalities?: string[];
}

async function fetchPollinations(): Promise<TrackerRow[]> {
  const data = (await getJson("https://text.pollinations.ai/models")) as PolloModel[];
  const out: TrackerRow[] = (Array.isArray(data) ? data : [])
    .filter((m) => typeof m.name === "string" && m.name && !(m.output_modalities ?? ["text"]).includes("image"))
    .map((m) => ({
      key: `pollinations::${m.name}`,
      providerId: "pollinations",
      modelId: m.name as string,
      displayName: m.description ?? undefined,
      free: true,
      meta: { tier: m.tier ?? null },
    }));
  if (out.length === 0) throw new Error("empty catalog");
  return out;
}

// ── HuggingFace early signals (SIGNAL source — never ticker-alerted) ─────────
interface HfModel {
  modelId?: string;
  id?: string;
  createdAt?: string;
  downloads?: number;
  likes?: number;
  library_name?: string;
}

async function fetchHuggingFaceSignals(): Promise<TrackerRow[]> {
  const data = (await getJson(
    "https://huggingface.co/api/models?sort=createdAt&direction=-1&limit=60&pipeline_tag=text-generation"
  )) as HfModel[];
  const out: TrackerRow[] = (Array.isArray(data) ? data : [])
    .map((m) => m.modelId ?? m.id ?? "")
    .filter((id) => id && !NON_TEXT_RE.test(id))
    .map((id) => {
      const src = (data as HfModel[]).find((m) => (m.modelId ?? m.id) === id);
      return {
        key: `huggingface::${id}`,
        providerId: "huggingface",
        modelId: id,
        free: true,
        meta: {
          signal: true,
          createdAt: src?.createdAt ?? null,
          downloads: src?.downloads ?? null,
          likes: src?.likes ?? null,
        },
      } satisfies TrackerRow;
    });
  return out; // may legitimately be empty — signals are best-effort
}

// ── Vyce: key-authed /v1/models (BYOK — key travels per-request) ─────────────
interface VyceModel {
  id?: string;
  owned_by?: string;
  context_window?: number;
}

async function fetchVyce(key: string): Promise<TrackerRow[]> {
  const data = (await getJson("https://vyceai.com/v1/models", {
    Authorization: `Bearer ${key}`,
  })) as { data?: VyceModel[] };
  const out: TrackerRow[] = [];
  for (const m of data.data ?? []) {
    if (typeof m.id !== "string" || !m.id) continue;
    if (NON_TEXT_RE.test(m.id)) continue;
    out.push({
      key: `vyce::${m.id}`,
      providerId: "vyce",
      modelId: m.id,
      contextWindow: typeof m.context_window === "number" ? m.context_window : undefined,
      free: false, // /v1/models carries no pricing; "requiredTier:free" lives in the landing bundle only
      meta: { owned_by: m.owned_by ?? null },
    });
  }
  if (out.length === 0) throw new Error("empty catalog");
  return out;
}

// ── AIHubMix: keyless rich catalog — ~850 rows, USD pricing, lifecycle ──────
// r30 (docs/research/aihubmix-r30.md): /api/v1/models is the SPA's public
// catalog (300s cache + ETag): model_id / model_name / pricing{input,output}
// numeric USD-per-1M / context_length / types ("llm") / retire_stage. `types`
// is a STRING (not array); rows without "llm" are OCR/TTS/image/video lanes.
interface AhmModel {
  model_id?: string;
  model_name?: string;
  context_length?: number;
  pricing?: { input?: number; output?: number };
  types?: string;
  retire_stage?: string;
}

async function fetchAihubmix(): Promise<TrackerRow[]> {
  const data = (await getJson("https://aihubmix.com/api/v1/models")) as { data?: AhmModel[] };
  const out: TrackerRow[] = [];
  for (const m of data.data ?? []) {
    const id = m.model_id;
    if (typeof id !== "string" || !id) continue;
    if (NON_TEXT_RE.test(id)) continue;
    // types is a plain string — keep only true LLM lanes ("image_generation,llm"
    // hybrids stay: they chat). Empty types = unverifiable lane → skip.
    if (!m.types || !m.types.includes("llm")) continue;
    // Lifecycle: never track rows already leaving the catalog.
    if (m.retire_stage && m.retire_stage !== "active") continue;
    const pin = typeof m.pricing?.input === "number" ? m.pricing.input : undefined;
    const pout = typeof m.pricing?.output === "number" ? m.pricing.output : undefined;
    out.push({
      key: `aihubmix::${id}`,
      providerId: "aihubmix",
      modelId: id,
      displayName: m.model_name ?? undefined,
      contextWindow: typeof m.context_length === "number" ? m.context_length : undefined,
      priceIn: pin,
      priceOut: pout,
      free: pin === 0 && pout === 0,
      meta: { retire_stage: m.retire_stage ?? null },
    });
  }
  if (out.length === 0) throw new Error("empty catalog");
  return out;
}

// ── Kilo Gateway (r32): keyless rich catalog — 393 lanes, OpenRouter shape ──
// Live-verified 2026-09-23: GET /api/gateway/v1/models answers 200 with NO
// key. Rows carry id / name / created / pricing{prompt,completion} (USD-per-
// token strings) / context_length / isFree. kilo-auto/* routers sit alongside
// ~20 :free lanes and the MiMo V2.6 family.
interface KiloModel {
  id?: string;
  name?: string;
  created?: number;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  isFree?: boolean;
}

async function fetchKilo(): Promise<TrackerRow[]> {
  const data = (await getJson("https://api.kilo.ai/api/gateway/v1/models")) as KiloModel[] | { data?: KiloModel[] };
  const rows = Array.isArray(data) ? data : (data.data ?? []);
  const out: TrackerRow[] = [];
  for (const m of rows) {
    if (typeof m.id !== "string" || !m.id) continue;
    if (NON_TEXT_RE.test(m.id)) continue;
    const pin = parseFloat(m.pricing?.prompt ?? "");
    const pout = parseFloat(m.pricing?.completion ?? "");
    const priceIn = Number.isFinite(pin) ? pin * 1_000_000 : undefined;
    const priceOut = Number.isFinite(pout) ? pout * 1_000_000 : undefined;
    out.push({
      key: `kilo::${m.id}`,
      providerId: "kilo",
      modelId: m.id,
      displayName: m.name,
      contextWindow: typeof m.context_length === "number" ? m.context_length : undefined,
      priceIn,
      priceOut,
      free:
        m.isFree === true ||
        m.id.endsWith(":free") ||
        m.id === "kilo-auto/free" ||
        (priceIn === 0 && priceOut === 0),
      meta: { created: m.created ?? null, name: m.name ?? null, isFree: m.isFree ?? null },
    });
  }
  if (out.length === 0) throw new Error("empty catalog");
  return out;
}

// ── OpenCode Zen (r32): keyless roster — 80 lanes, the full frontier + free ─
// Live-verified 2026-09-23: GET /zen/v1/models answers 200 with NO key.
// Rows are sparse ({id, created, owned_by}) and carry NO pricing, so freeness
// is the standing "-free" lane suffix (nemotron-3-ultra-free,
// mimo-v2.6-flash-free, deepseek-v4-flash-free, …). Never inferred otherwise.
interface ZenModel {
  id?: string;
  created?: number;
  owned_by?: string;
}

async function fetchOpencode(): Promise<TrackerRow[]> {
  const data = (await getJson("https://opencode.ai/zen/v1/models")) as { data?: ZenModel[] };
  const out: TrackerRow[] = [];
  for (const m of data.data ?? []) {
    if (typeof m.id !== "string" || !m.id) continue;
    if (NON_TEXT_RE.test(m.id)) continue;
    out.push({
      key: `opencode::${m.id}`,
      providerId: "opencode",
      modelId: m.id,
      contextWindow: undefined,
      free: /-free$/i.test(m.id),
      meta: { created: m.created ?? null, owned_by: m.owned_by ?? null },
    });
  }
  if (out.length === 0) throw new Error("empty catalog");
  return out;
}

export const TRACKER_SOURCES = {
  aihubmix: { label: "AIHubMix", authoritative: true, run: fetchAihubmix },
  openrouter: { label: "OpenRouter", authoritative: true, run: fetchOpenRouter },
  orcarouter: { label: "OrcaRouter", authoritative: true, run: fetchOrcaRouter },
  pollinations: { label: "Pollinations", authoritative: true, run: fetchPollinations },
  kilo: { label: "Kilo Gateway", authoritative: true, run: fetchKilo },
  opencode: { label: "OpenCode Zen", authoritative: true, run: fetchOpencode },
  huggingface: { label: "HuggingFace signals", authoritative: false, run: fetchHuggingFaceSignals },
} as const;

export type TrackerSourceId = keyof typeof TRACKER_SOURCES;

/** Run all keyless sources in parallel; never throws (per-source errors reported). */
export async function runKeylessSources(): Promise<SourceResult[]> {
  const entries = Object.entries(TRACKER_SOURCES) as [TrackerSourceId, (typeof TRACKER_SOURCES)[TrackerSourceId]][];
  return Promise.all(
    entries.map(async ([id, src]) => {
      try {
        return { sourceId: id, ok: true, rows: await src.run() };
      } catch (err) {
        return { sourceId: id, ok: false, rows: [], error: err instanceof Error ? err.message : "failed" };
      }
    })
  );
}

/** Vyce keyed probe (Tier B) — returns a SourceResult, never throws. */
export async function runVyceSource(key: string): Promise<SourceResult> {
  try {
    return { sourceId: "vyce", ok: true, rows: await fetchVyce(key) };
  } catch (err) {
    return { sourceId: "vyce", ok: false, rows: [], error: err instanceof Error ? err.message : "failed" };
  }
}
