// ─── Provider model-roster refresh (isomorphic core) ─────────────────────────
// r23: extracted from /api/providers/free-models so the BROWSER can refresh
// rosters directly when the app server is region-blocked (Groq/Cerebras/Google
// 403 the datacenter IP — your own network is fine). The server route uses the
// same table + normalizers; the gallery falls back to browserRefreshModels()
// when the server path fails with a block signature.

export interface RefreshedModel {
  id: string;
  label?: string;
  contextLength?: number;
}

interface KeyedEndpoint {
  url: string;
  /** Response shape: OpenAI-compatible "openai" | Cloudflare search "cf". */
  shape: "openai" | "cf";
  /** Some providers accept a key but work without one. */
  keyOptional?: boolean;
}

export const KEYED_ENDPOINTS: Record<string, KeyedEndpoint> = {
  vyce: { url: "https://vyceai.com/v1/models", shape: "openai", keyOptional: true },
  orcarouter: { url: "https://api.orcarouter.ai/v1/models", shape: "openai", keyOptional: true },
  groq: { url: "https://api.groq.com/openai/v1/models", shape: "openai" },
  "google-ai-studio": { url: "https://generativelanguage.googleapis.com/v1beta/openai/models", shape: "openai" },
  mistral: { url: "https://api.mistral.ai/v1/models", shape: "openai", keyOptional: true },
  zai: { url: "https://api.z.ai/api/paas/v4/models", shape: "openai" },
  "nvidia-nim": { url: "https://integrate.api.nvidia.com/v1/models", shape: "openai", keyOptional: true },
  sambanova: { url: "https://api.sambanova.ai/v1/models", shape: "openai" },
  cohere: { url: "https://api.cohere.ai/compatibility/v1/models", shape: "openai" },
  together: { url: "https://api.together.xyz/v1/models", shape: "openai", keyOptional: true },
  cerebras: { url: "https://api.cerebras.ai/v1/models", shape: "openai" },
  // r23 fix: the old /ai/v1/models path answered 405 "GET not supported" —
  // the search endpoint is the documented roster API.
  cloudflare: {
    url: "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/models/search?per_page=100",
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

export function normalizeOpenAI(data: unknown): RefreshedModel[] {
  const rows = (data as { data?: RawModelRow[] } | null)?.data ?? [];
  const out: RefreshedModel[] = [];
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

export function normalizeCf(data: unknown): RefreshedModel[] {
  const rows = (data as { result?: RawModelRow[] } | null)?.result ?? [];
  const out: RefreshedModel[] = [];
  for (const m of rows) {
    const id = typeof m.name === "string" ? m.name : typeof m.id === "string" ? m.id : "";
    if (!id || NON_TEXT_RE.test(id)) continue;
    out.push({ id, label: prettifyLabel(id), contextLength: undefined });
  }
  return out;
}

/** "meta-llama/Llama-3.3-70B-Instruct-Turbo" → "Llama 3.3 70B Instruct Turbo" */
export function prettifyLabel(id: string): string {
  const tail = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return tail
    .replace(/[:_]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Fetch one provider's roster DIRECTLY from the browser (user's network —
 * bypasses any app-server region block). Returns the model list, or throws
 * with an honest message covering both CORS and provider failures.
 */
export async function browserRefreshModels(
  providerId: string,
  key: string,
  accountId?: string
): Promise<RefreshedModel[]> {
  const ep = KEYED_ENDPOINTS[providerId];
  if (!ep) throw new Error(`Provider "${providerId}" has no live models endpoint`);
  const url = ep.url.replace("{ACCOUNT_ID}", (accountId ?? "").trim());
  if (url.includes("{ACCOUNT_ID}")) {
    throw new Error("This provider needs your account id (save it on the provider card)");
  }
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "Your browser was blocked too (CORS or network) — this provider only refreshes server-side right now"
    );
  }
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(`HTTP ${res.status} from your browser too — re-check the key on the provider card`);
    }
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 140) || "models endpoint failed"}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Provider returned non-JSON roster");
  }
  const models = ep.shape === "cf" ? normalizeCf(data) : normalizeOpenAI(data);
  if (models.length === 0) throw new Error("Upstream returned no chat models");
  return models;
}
