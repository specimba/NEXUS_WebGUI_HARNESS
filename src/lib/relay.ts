"use client";

// ─── Model Relay — automatic fallback chain across your free-frontier vault ──
// Doctrine ported from the local ModelRelay/"Genius rotator": models are ranked
// by Generation-Era tier (1 frontier > 2 modern > 3 legacy), then arena Elo,
// and when the active model fails (gateway drop, 429, out of credits, dead
// model id) the run rotates down the chain until someone answers.
// The chain is built CLIENT-SIDE from the key vault (keys never persist
// server-side) and travels with each /api/chat request as `relay` hops.
//
// r22 additions (Genius-rotator completeness):
//  • FULL-VAULT CATALOG — every registry provider with a key joins the chain
//    (was vyce/groq/pollinations only; a keyed Google/Mistral/NVIDIA never
//    got asked to back a dying run).
//  • HEALTH MEMORY — per-hop ok/fail counts persist in localStorage; hops
//    that failed recently are demoted (they already burned 3 engine retries
//    last run — don't queue them first again).
//  • TASK FIT — research steps (search tools) prefer fast models first;
//    quality steps (writing/review) prefer flagships first. The chain order
//    adapts to the task instead of one static ranking.

import { providerBaseUrl, providerById } from "./providers";
import { loadLiveCatalog } from "./providers";
import type { Settings } from "./types";

export interface RelayHop {
  /** Stable key "providerId::model" — used for ordering + de-duplication. */
  key: string;
  providerId: string;
  model: string;
  label: string;
  /** OpenAI-compatible base URL; undefined ⇒ the built-in auto engine. */
  baseUrl?: string;
  apiKey?: string;
  tier: 1 | 2 | 3;
  /** Arena Elo 0–1 (evidence-grounded quality estimate, see docs). */
  elo: number;
  note?: string;
}

/** Wire shape sent to /api/chat (no ids — server is stateless). */
export interface RelayWireHop {
  /** Stable hop key — echoed back by the server's rotation status lines so the client can record health. */
  key?: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  label?: string;
  /** True ⇒ server uses the built-in auto engine for this hop. */
  useAuto?: boolean;
}

/** How the chain should order itself for the task at hand. */
export type RelayTaskFit = "research" | "quality" | "decision" | "any";

/** Generation-Era arena catalog (tier → Elo), from the ModelRelay doctrine. */
const ARENA_CATALOG: Record<
  string,
  { label: string; models: { id: string; tier: 1 | 2 | 3; elo: number; note?: string }[] }
> = {
  vyce: {
    label: "Vyce AI",
    models: [
      { id: "deepseek-v4.1", tier: 1, elo: 0.985, note: "Apex flagship · 270K ctx" },
      { id: "claude-sonnet-4-6", tier: 1, elo: 0.978, note: "Frontier coding" },
      { id: "deepseek-v4-flash-lr", tier: 2, elo: 0.918, note: "Long-range" },
      { id: "deepseek-v4-flash", tier: 2, elo: 0.915, note: "Ultra-fast" },
      { id: "agnes-3.0-flash", tier: 2, elo: 0.91, note: "Agentic · 512K ctx" },
    ],
  },
  orcarouter: {
    label: "OrcaRouter",
    models: [
      { id: "google/gemini-3.8-flash", tier: 1, elo: 0.975, note: "Current-gen Gemini · 1M ctx" },
      { id: "kimi/kimi-k3", tier: 1, elo: 0.975, note: "Moonshot frontier" },
      { id: "z-ai/glm-5.3", tier: 1, elo: 0.97, note: "GLM 5.3 flagship" },
      { id: "minimax/minimax-m3", tier: 1, elo: 0.92, note: "Long-horizon agentic" },
      // r27: the $0 GLM-5.3-Flash lane (verified against the live 197-model roster).
      { id: "z-ai/glm-5.3-flash-free", tier: 2, elo: 0.91, note: "$0 · GLM 5.3 Flash" },
      { id: "deepseek/deepseek-v4-flash-free", tier: 2, elo: 0.915, note: "Free · 1M ctx" },
      { id: "orcarouter/free", tier: 2, elo: 0.9, note: "Difficulty-routed free pool · never bills" },
    ],
  },
  "google-ai-studio": {
    label: "Google AI Studio",
    models: [
      { id: "gemini-3.8-flash", tier: 1, elo: 0.975, note: "Current generation · 1M ctx" },
      // r27 roster audit (r27-2b): gemini-3.5-pro does NOT exist (user-reported +
      // Google docs / OrcaRouter / HF all lack it) — the real Pro line today is
      // gemini-3.1-pro-preview. gemini-3.8-flash-lite also does not exist; the
      // lite line tops at gemini-3.5-flash-lite.
      { id: "gemini-3.1-pro-preview", tier: 1, elo: 0.96, note: "Strongest current Gemini" },
      { id: "gemini-3.5-flash-lite", tier: 2, elo: 0.88, note: "Highest free quota" },
      { id: "gemini-2.5-pro", tier: 2, elo: 0.92, note: "Legacy · stable" },
    ],
  },
  groq: {
    label: "Groq",
    models: [
      { id: "openai/gpt-oss-120b", tier: 2, elo: 0.92, note: "Open weights · ludicrous speed" },
      { id: "llama-3.3-70b-versatile", tier: 2, elo: 0.895, note: "Fast open weights" },
      { id: "openai/gpt-oss-20b", tier: 2, elo: 0.88, note: "Fastest frontier-class" },
      { id: "qwen/qwen3.8-27b", tier: 2, elo: 0.87, note: "Multilingual" },
    ],
  },
  "nvidia-nim": {
    label: "NVIDIA NIM",
    models: [
      { id: "nvidia/nemotron-3-ultra-550b-a55b", tier: 1, elo: 0.955, note: "Flagship MoE · 1K credits" },
      { id: "deepseek-ai/deepseek-v4-flash-0731", tier: 2, elo: 0.9, note: "Fast reasoning" },
    ],
  },
  cohere: {
    label: "Cohere",
    // r27: command-a-02-2025 was retired — the live flagship is 03-2025.
    models: [{ id: "command-a-03-2025", tier: 2, elo: 0.9, note: "Flagship · trial key" }],
  },
  mistral: {
    label: "Mistral",
    models: [
      { id: "mistral-medium-latest", tier: 2, elo: 0.89, note: "Stronger, still free" },
      { id: "mistral-small-latest", tier: 2, elo: 0.87, note: "Best free default" },
    ],
  },
  sambanova: {
    label: "SambaNova",
    models: [{ id: "Meta-Llama-3.3-70B-Instruct", tier: 2, elo: 0.88, note: "Fast distills" }],
  },
  together: {
    label: "Together AI",
    // r27: the -Free Llama endpoint was retired; the only free serverless
    // model today is Ternary-Bonsai-27B (docs.together.ai serverless list).
    models: [
      { id: "Prism-ML/Ternary-Bonsai-27B", tier: 2, elo: 0.87, note: "Free serverless · ternary GGUF lineage" },
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", tier: 2, elo: 0.88, note: "Paid · reliable fallback" },
    ],
  },
  zai: {
    label: "Z.ai",
    models: [
      // r27 roster audit: GLM-5.3 flagship + the missing GLM-5.3-Flash
      // (HF zai-org/GLM-5.3-Flash, docs.z.ai pricing — cheap, NOT free).
      { id: "glm-5.3", tier: 1, elo: 0.97, note: "GLM 5.3 flagship · 1M ctx" },
      { id: "glm-5.3-flash", tier: 2, elo: 0.92, note: "GLM 5.3 Flash · cheap tier" },
      { id: "glm-4.7-flash", tier: 3, elo: 0.86, note: "$0 Flash" },
    ],
  },
  openrouter: {
    label: "OpenRouter",
    models: [
      { id: "nvidia/nemotron-3.5-lightning:free", tier: 2, elo: 0.88, note: "1M ctx · rotating :free" },
      { id: "google/gemma-4-31b-it:free", tier: 2, elo: 0.84, note: "Google open model" },
    ],
  },
  cerebras: {
    label: "Cerebras",
    models: [{ id: "gpt-oss-120b", tier: 2, elo: 0.9, note: "Wafer-scale speed · card trial" }],
  },
  pollinations: {
    label: "Pollinations",
    models: [{ id: "openai-fast", tier: 3, elo: 0.85, note: "Keyed free tier" }],
  },
};

/** The built-in engine hop — always available, the chain's last resort. */
const AUTO_HOP: RelayHop = {
  key: "auto::builtin",
  providerId: "auto",
  model: "builtin",
  label: "Built-in engine",
  tier: 2,
  elo: 0.88,
  note: "Zero-config fallback — never dead-ends",
};

/** Hard cap on backup hops per request (worst-case latency guard). */
export const MAX_RELAY_HOPS = 5;

function hopKey(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

// ─── Health memory (localStorage) ─────────────────────────────────────────────
// The rotator remembers which hops recently failed so the next run doesn't
// queue them first and burn 3 engine retries on a corpse again.

export const RELAY_HEALTH_KEY = "praison-relay-health";

export interface RelayHealthEntry {
  ok: number;
  fail: number;
  lastOkAt?: number;
  lastFailAt?: number;
  lastError?: string;
  /** Soft failures (429s, capacity) are recorded but NEVER demote a hop. */
  soft?: boolean;
}

/**
 * Hard vs soft failures (r25, LiteLLM allowed_fails_policy doctrine):
 * network death / 5xx / deadlines demote a lane; 429s and other 4xx are
 * capacity noise and must not sink a healthy provider.
 */
export function isHardRelayFailure(error?: string): boolean {
  if (!error) return true;
  return !/\b429\b|rate.?limit|quota|too many requests|\b4(?:0[13578]|1[02-9])\b/i.test(error);
}

type RelayHealth = Record<string, RelayHealthEntry>;

/** Cooldown window: a hop that failed this recently is demoted in the chain. */
const HEALTH_COOLDOWN_MS = 5 * 60_000;

function loadHealth(): RelayHealth {
  try {
    const raw = localStorage.getItem(RELAY_HEALTH_KEY);
    return raw ? (JSON.parse(raw) as RelayHealth) : {};
  } catch {
    return {};
  }
}

function saveHealth(h: RelayHealth): void {
  try {
    localStorage.setItem(RELAY_HEALTH_KEY, JSON.stringify(h));
  } catch {
    /* quota — health memory is best-effort */
  }
}

/** Record one hop outcome (called from the rotation status lines the server emits). */
export function recordRelayHopResult(key: string, ok: boolean, error?: string): void {
  if (!key || key === "auto::builtin") return;
  const h = loadHealth();
  const e = h[key] ?? { ok: 0, fail: 0 };
  if (ok) {
    e.ok += 1;
    e.lastOkAt = Date.now();
    e.lastError = undefined;
    e.soft = false;
  } else {
    e.fail += 1;
    e.lastFailAt = Date.now();
    e.soft = !isHardRelayFailure(error);
    if (error) e.lastError = error.slice(0, 160);
    // OrcaRouter rate limits are WORKSPACE-wide (all keys share one bucket —
    // docs.orcarouter.ai/operations/rate-limits): one lane's 429 means every
    // orca lane is throttled, so stamp them all.
    if (e.soft && key.startsWith("orcarouter::") && error && /\b429\b|rate.?limit/i.test(error)) {
      for (const k of Object.keys(h)) {
        if (k.startsWith("orcarouter::") && k !== key) {
          h[k] = {
            ...(h[k] ?? { ok: 0, fail: 0 }),
            lastFailAt: Date.now(),
            soft: true,
            lastError: "workspace-wide rate limit",
          };
        }
      }
    }
  }
  h[key] = e;
  saveHealth(h);
}

/** Health snapshot for the settings card. */
export function relayHealthSnapshot(): RelayHealth {
  return loadHealth();
}

/** Wipe the rotator's health memory (settings card button). */
export function resetRelayHealth(): void {
  try {
    localStorage.removeItem(RELAY_HEALTH_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the hop failed inside the cooldown window. */
function recentlyFailed(entry: RelayHealthEntry | undefined): boolean {
  // Soft failures (429/capacity) never demote — only hard deaths do (r25).
  if (!entry?.lastFailAt || entry.soft) return false;
  return Date.now() - entry.lastFailAt < HEALTH_COOLDOWN_MS;
}

// ─── Task fit heuristics ──────────────────────────────────────────────────────

const FAST_RE = /flash|mini|lite|fast|turbo|lightning|instant|small|20b|8b|bonsai|compound/i;
const FLAGSHIP_RE = /pro|ultra|flagship|v4\.1|large|frontier|sonnet|120b|550b|command-a|medium|kimi-k3|minimax-m3|glm-5\.3(?!-flash)|fusion/i;

function taskBoost(hop: RelayHop, fit: RelayTaskFit): number {
  if (fit === "any") return 0;
  const hay = `${hop.model} ${hop.note ?? ""}`;
  if (fit === "decision") {
    // System-One jobs (classify / judge / route): ONLY fast lanes — a slow
    // genius pass defeats the whole point of the decision tier (r27 Jev).
    if (FAST_RE.test(hay)) return 2;
    if (FLAGSHIP_RE.test(hay)) return -2;
    return -1;
  }
  if (fit === "research") {
    // Search steps: fast models first — many quick tool-driven calls matter
    // more than one slow genius pass.
    if (FAST_RE.test(hay)) return 1;
    if (FLAGSHIP_RE.test(hay)) return -1;
  } else {
    // Writing/review steps: flagships first — one excellent pass matters most.
    if (FLAGSHIP_RE.test(hay)) return 1;
    if (FAST_RE.test(hay)) return -1;
  }
  return 0;
}

/**
 * Build the ordered fallback chain for the current vault.
 * Order: user's saved relayOrder first (by index), remaining entries in
 * Generation-Era order (tier asc → Elo desc → task fit → health), built-in
 * engine always last. Providers without a saved key are skipped — the chain
 * only contains hops that can actually answer. Live-catalog models for keyed
 * providers are appended (tier 2) so freshly-refreshed rosters join the chain
 * even before the doctrine catalog learns about them.
 */
export function buildRelayChain(
  settings: Settings,
  opts?: { taskFit?: RelayTaskFit }
): RelayHop[] {
  const hops: RelayHop[] = [];
  const fit = opts?.taskFit ?? "any";

  for (const [providerId, catalog] of Object.entries(ARENA_CATALOG)) {
    const reg = providerById(providerId);
    if (!reg) continue;
    const key = settings.providerKeys?.[providerId]?.key?.trim() ?? "";
    if (!key) continue; // no key → this provider can't answer
    const baseUrl = providerBaseUrl(reg, settings.providerKeys?.[providerId]?.accountId);
    const seen = new Set<string>();
    // r27 evidence-grounding: models the user's own live /models roster
    // confirmed get a "live ✓" badge — fabricated catalog entries are now
    // visibly distinguishable from verified ones.
    const live = new Set((loadLiveCatalog()[providerId] ?? []).map((m) => m.id));
    for (const m of catalog.models) {
      seen.add(m.id);
      hops.push({
        key: hopKey(providerId, m.id),
        providerId,
        model: m.id,
        label: `${catalog.label} · ${m.id}`,
        baseUrl,
        apiKey: key,
        tier: m.tier,
        elo: m.elo,
        note: live.has(m.id) ? `${m.note ? `${m.note} · ` : ""}live ✓` : m.note,
      });
    }
    // Live-roster extras (Refresh models button) join as generic T2 hops.
    const liveExtras = (loadLiveCatalog()[providerId] ?? []).filter(
      (m) => !seen.has(m.id) && !/imagine|embed|whisper|tts|image/i.test(m.id)
    );
    for (const m of liveExtras.slice(0, 6)) {
      hops.push({
        key: hopKey(providerId, m.id),
        providerId,
        model: m.id,
        label: `${catalog.label} · ${m.id}`,
        baseUrl,
        apiKey: key,
        tier: 2,
        elo: 0.8,
        note: "live roster",
      });
    }
  }

  // Generation-Era doctrine: health first (don't queue recently-dead hops),
  // then tier, then Elo, then task fit, stable within equal rank.
  const health = loadHealth();
  hops.sort((a, b) => {
    const hp = recentlyFailed(health[a.key]) ? 1 : 0;
    const hb = recentlyFailed(health[b.key]) ? 1 : 0;
    if (hp !== hb) return hp - hb;
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (b.elo !== a.elo) return b.elo - a.elo;
    const tb = taskBoost(b, fit);
    const ta = taskBoost(a, fit);
    if (tb !== ta) return tb - ta;
    return 0;
  });

  // Apply the user's saved ordering (if any): listed keys keep their index,
  // unlisted keys follow in default order — but demoted hops ALWAYS sink to
  // the back of the saved order (r25: the old override silently disabled
  // health-demotion for anyone who had ever dragged a row).
  const order = settings.relayOrder ?? [];
  if (order.length > 0) {
    const idx = (k: string) => {
      const i = order.indexOf(k);
      return i === -1 ? order.length + hops.findIndex((h) => h.key === k) : i;
    };
    hops.sort((a, b) => {
      const da = recentlyFailed(health[a.key]) ? 1 : 0;
      const db = recentlyFailed(health[b.key]) ? 1 : 0;
      if (da !== db) return da - db;
      return idx(a.key) - idx(b.key);
    });
  }

  // The built-in engine is the unconditional last resort.
  hops.push(AUTO_HOP);
  return hops;
}

/**
 * Wire hops for a request whose primary is `primary`. The primary itself is
 * excluded (it is tried first via the request's own baseUrl/model) and the
 * chain is capped at MAX_RELAY_HOPS. `opts.taskFit` reorders the backups for
 * the kind of work the step does (research → fast models first).
 */
export function buildRelayWire(
  settings: Settings,
  primary?: { providerId?: string; model?: string },
  opts?: { taskFit?: RelayTaskFit }
): RelayWireHop[] {
  if (settings.relayEnabled === false) return [];
  const excludeKey =
    primary?.providerId && primary?.model
      ? hopKey(primary.providerId, primary.model)
      : undefined;
  const excludeAuto = primary?.providerId === "auto";
  return buildRelayChain(settings, opts)
    .filter((h) => h.key !== excludeKey && !(excludeAuto && h.providerId === "auto"))
    .slice(0, MAX_RELAY_HOPS)
    .map((h) => ({
      key: h.key,
      ...(h.baseUrl ? { baseUrl: h.baseUrl } : {}),
      ...(h.apiKey ? { apiKey: h.apiKey } : {}),
      model: h.model,
      label: h.label,
      ...(h.providerId === "auto" ? { useAuto: true } : {}),
    }));
}

export const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: "Frontier",
  2: "Modern",
  3: "Legacy",
};
