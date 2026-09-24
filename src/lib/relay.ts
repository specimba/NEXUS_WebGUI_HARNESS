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
import LEADERBOARD from "@/config/leaderboard.json";

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

/**
 * r34 free-frontier doctrine: “tons of good, free frontier LLMs now — we
 * should handle them working really.” A lane is FREE when its model id marks
 * it so (`:free`, `-free`, `router/free`); notes are deliberately NOT trusted
 * (r28 truth pass: big-pickle is paid despite a misleading note).
 */
export function isFreeLane(model: string): boolean {
  return /(^|[\/:_-])free$/i.test(model.trim()) || /:free(:|$)/i.test(model.trim());
}

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
      // r28: verified REAL (Vyce /v1/models owned_by:alibaba ctx:1000000 +
      // HF Qwen/Qwen3.8-Flash-Next + OpenRouter qwen/qwen3.8-flash) — $0.10/$0.40.
      { id: "qwen3.8-flash", tier: 1, elo: 0.965, note: "Alibaba Qwen 3.8 · 1M ctx · $0.10/$0.40" },
      { id: "deepseek-v4-flash-lr", tier: 2, elo: 0.918, note: "Long-range" },
      { id: "deepseek-v4-flash", tier: 2, elo: 0.915, note: "Ultra-fast" },
      { id: "agnes-3.0-flash", tier: 2, elo: 0.91, note: "Agentic · 512K ctx" },
    ],
  },
  aihubmix: {
    label: "AIHubMix",
    models: [
      { id: "claude-opus-5", tier: 1, elo: 0.988, note: "Frontier apex · 1M ctx · $5/$25" },
      { id: "claude-sonnet-5", tier: 1, elo: 0.982, note: "Frontier workhorse · 1M ctx · $2/$10" },
      { id: "gpt-5.6-luna", tier: 1, elo: 0.968, note: "OpenAI fast flagship · 1M ctx · $0.20/$1.20" },
      { id: "gemini-3.6-flash", tier: 1, elo: 0.962, note: "Google current-gen · 1M ctx · $1.50/$7.50" },
      { id: "grok-4.5", tier: 1, elo: 0.955, note: "xAI frontier · 500K ctx · $2/$6" },
      { id: "qwen3.8-max", tier: 1, elo: 0.95, note: "Alibaba flagship · 1M ctx · $1.69/$5.07" },
      { id: "deepseek-v4-flash", tier: 2, elo: 0.93, note: "Budget frontier · 1M ctx · $0.142/$0.284" },
      { id: "glm-5.3-flash", tier: 2, elo: 0.925, note: "Z.ai fast lane · 1M ctx · $0.11/$0.39" },
      { id: "coding-glm-5.3-free", tier: 2, elo: 0.912, note: "FREE coding lane · 1M ctx · tools" },
      { id: "coding-kimi-k3-free", tier: 2, elo: 0.905, note: "FREE · Kimi coding · 1M ctx" },
      { id: "xiaomi-mimo-v2.6-pro-free", tier: 2, elo: 0.9, note: "FREE · omni-in · 1M ctx" },
      { id: "nemotron-3-ultra-550b-a55b-free", tier: 2, elo: 0.895, note: "FREE · 550B MoE · 1M ctx" },
      // r34: gateway-router lanes — the user-supplied advisory (docs.aihubmix.com
      // LLM Router, pasted verbatim) documents model=auto[+policy]: the gateway
      // picks per request (cost/balanced/quality/latency) and writes the REAL
      // resolved model into the response body + x-aihubmix-router-* headers,
      // which the engine surfaces as an honest router receipt.
      { id: "auto:quality_first", tier: 1, elo: 0.985, note: "LLM Router · quality-first per request" },
      { id: "auto:latency_critical", tier: 1, elo: 0.965, note: "LLM Router · fastest capable lane" },
      { id: "auto:balanced", tier: 2, elo: 0.94, note: "LLM Router · balanced policy" },
      { id: "auto", tier: 2, elo: 0.9, note: "LLM Router · cost-first (free-biased pool)" },
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
      // r31: Free Models Router — picks a random free lane per request
      // (live-verified: 200k ctx, $0/$0, text+image→text). A free-tier
      // backstop hop, not a precision lane (non-deterministic routing).
      { id: "openrouter/free", tier: 2, elo: 0.8, note: "Free Models Router · 200k ctx · random free lane" },
      { id: "nvidia/nemotron-3.5-lightning:free", tier: 2, elo: 0.88, note: "1M ctx · rotating :free" },
      // r32: MiMo V2.6 family — verified live on OpenRouter 2026-09-23
      // ($0.435/$0.87 for the 1T-class flagship is the cheapest frontier
      // lane in the vault; flash is the ultra-budget workhorse).
      { id: "xiaomi/mimo-v2.6-pro", tier: 1, elo: 0.958, note: "1T+ MoE · 1M ctx · $0.435/$0.87" },
      { id: "xiaomi/mimo-v2.6-flash", tier: 2, elo: 0.92, note: "309B MoE · 1M ctx · $0.14/$0.28" },
      { id: "google/gemma-4-31b-it:free", tier: 2, elo: 0.84, note: "Google open model" },
    ],
  },
  // r32: the two frontier-freedom gateways (live-verified 2026-09-23).
  // OpenCode Zen freed the frontier: standing -free lanes + the entire
  // closed frontier on one key. Kilo Gateway's kilo-auto/free rotates a
  // free pool with no credits required.
  opencode: {
    label: "OpenCode Zen",
    models: [
      { id: "claude-fable-5", tier: 1, elo: 0.985, note: "Frontier apex · same key as free lanes" },
      { id: "gpt-6-astra", tier: 1, elo: 0.972, note: "OpenAI flagship" },
      { id: "gemini-3.8-flash", tier: 1, elo: 0.965, note: "Google current-gen" },
      { id: "grok-4.7", tier: 1, elo: 0.955, note: "xAI frontier" },
      // r43: the Jev GENERATION model lives free on opencode — the decision
      // tier's native talent (System-One ② leads with it when present).
      { id: "jev-1.13-free", tier: 2, elo: 0.9, note: "FREE · Jev generation — decision-tier native" },
      { id: "nemotron-3-ultra-free", tier: 2, elo: 0.9, note: "FREE · 550B MoE frontier reasoning" },
      { id: "mimo-v2.6-flash-free", tier: 2, elo: 0.9, note: "FREE · Xiaomi omni · 1M ctx" },
      { id: "deepseek-v4-flash-free", tier: 2, elo: 0.89, note: "FREE · fast reasoning" },
      { id: "nemotron-3.5-lightning-free", tier: 2, elo: 0.87, note: "FREE · fast MoE" },
    ],
  },
  kilo: {
    label: "Kilo Gateway",
    models: [
      { id: "xiaomi/mimo-v2.6-pro", tier: 1, elo: 0.958, note: "1T+ MoE flagship · $0.435/$0.87" },
      { id: "kilo-auto/efficient", tier: 2, elo: 0.88, note: "Cheapest-capable router" },
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free", tier: 2, elo: 0.895, note: "FREE · frontier MoE" },
      { id: "nex-agi/nex-n2.5-pro:free", tier: 2, elo: 0.88, note: "FREE · agentic coding" },
      { id: "poolside/laguna-s-2.1:free", tier: 2, elo: 0.87, note: "FREE · 118B coding agent" },
      { id: "kilo-auto/free", tier: 2, elo: 0.82, note: "Rotating free pool · no credits required" },
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

/**
 * r49: hard cap on backup hops per request (worst-case latency guard).
 * Raised 5 → 8 with the failover-v2 doctrine: a user-visible rate-limit error
 * is a bug unless the chain actually reached a live lane — with per-provider
 * dedup + capacity cooldowns the 8 hops land on DISTINCT, healthy providers
 * instead of burning the budget on siblings of a throttled gateway.
 */
export const MAX_RELAY_HOPS = 8;

// ─── r49 Capacity cooldown (failover state machine, STATE 3) ─────────────────
// Doctrine change: a soft 429/capacity failure used to NEVER demote a hop —
// the throttled provider kept the chain's head and every new request burned
// its engine retries there first (the "2nd-priority provider dies while idle
// alternatives wait" report). Now a capacity error puts the hop into a
// JITTERED, ESCALATING cooldown and the chain deterministically rotates past
// it. Cooldown ≠ removal: the probe loop (relay-prober.ts) re-admits recovered
// lanes; nothing is ever permanently banned.

export const CAPACITY_COOLDOWN_BASE_MS = 2 * 60_000;
export const CAPACITY_COOLDOWN_MAX_MS = 30 * 60_000;
/** ±20% jitter — prevents thundering-herd re-entry at daily credit resets. */
export const CAPACITY_COOLDOWN_JITTER = 0.2;

/**
 * Cooldown duration for the nth consecutive capacity failure.
 * base · 2^(n-1), capped at MAX, ±jitter (jitter ∈ [0,1]; 0 in tests →
 * deterministic midpoint-free base value · (1 + jitter/2) — callers pass a
 * seeded rand for production shuffle).
 */
export function capacityCooldownMs(consecutiveFails: number, rand: number): number {
  const n = Math.max(1, Math.floor(consecutiveFails));
  const raw = Math.min(CAPACITY_COOLDOWN_BASE_MS * 2 ** (n - 1), CAPACITY_COOLDOWN_MAX_MS);
  const r = Math.min(1, Math.max(0, rand));
  const jitter = 1 + CAPACITY_COOLDOWN_JITTER * (r * 2 - 1); // ±20%
  return Math.round(raw * jitter);
}

/**
 * r49 classification: does this failure text describe a CAPACITY/quota event
 * (429, rate limit, quota, capacity) — the state machine's RATE_LIMITED state?
 * Kept local (not imported from agent-engine) so the client bundle never
 * pulls the engine module: the relay builds chains browser-side.
 */
export function isCapacityError(error?: string): boolean {
  if (!error) return false;
  return /\b429\b|rate.?limit|quota|too many requests|capacity is limited/i.test(error);
}

/** Cooldown state for one hop, derived from its health entry (pure). */
export function capacityCooledUntil(entry: RelayHealthEntry | undefined, now: number): number {
  return entry?.cooldownUntil && entry.cooldownUntil > now ? entry.cooldownUntil : 0;
}

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
  /**
   * r25 (superseded r49 for capacity): soft failures no longer just note
   * themselves — they start a capacity cooldown. The flag survives to mark
   * that the last failure was capacity-flavored (probe loop uses it to pick
   * cheap re-admission checks and the UI renders a cooling badge, not a
   * corpse badge).
   */
  soft?: boolean;
  /** r49: epoch ms — while set and in the future, the chain rotates past this hop. */
  cooldownUntil?: number;
  /** r49: consecutive capacity failures — drives the escalating backoff. */
  cooldownCount?: number;
}

/**
 * Hard vs soft failures (r25, LiteLLM allowed_fails_policy doctrine):
 * network death / 5xx / deadlines demote a lane; 429s and other 4xx are
 * capacity noise and must not sink a healthy provider.
 * r49: "capacity is limited" (OrcaRouter's free-tier 429 wording — no "429"
 * or "rate limit" token in the message) is SOFT capacity, entering the
 * jittered cooldown instead of the 5-min hard demotion.
 */
export function isHardRelayFailure(error?: string): boolean {
  if (!error) return true;
  return !/\b429\b|rate.?limit|quota|too many requests|capacity is limited|\b4(?:0[13578]|1[02-9])\b/i.test(error);
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
    // r49: success = STATE 2 — recovery bonus. Any capacity cooldown ends.
    e.cooldownUntil = undefined;
    e.cooldownCount = 0;
  } else {
    e.fail += 1;
    e.lastFailAt = Date.now();
    e.soft = !isHardRelayFailure(error);
    if (error) e.lastError = error.slice(0, 160);
    // r49 STATE 3 (RATE_LIMITED): capacity/quota failure → jittered escalating
    // cooldown. The hop is NOT deleted and NOT hard-demoted (its quality is
    // fine — it's out of free quota); the chain rotates past it until the
    // probe loop or the clock re-admits it.
    if (e.soft && isCapacityError(error)) {
      const count = (e.cooldownCount ?? 0) + 1;
      e.cooldownCount = count;
      e.cooldownUntil = Date.now() + capacityCooldownMs(count, Math.random());
    } else {
      // Non-capacity failures don't extend a capacity cooldown retroactively,
      // but a HARD failure (network death, 402) invalidates any cooling grace
      // the lane had — it's not merely throttled, it's broken.
      if (!e.soft) {
        e.cooldownUntil = undefined;
        e.cooldownCount = 0;
      }
    }
    // r43 credits are ACCOUNT-wide (HTTP 402 — the whole provider console is
    // empty, not just this model): stamp every hop of the same provider as a
    // hard failure so the rotator skips the entire provider for the cooldown.
    if (!e.soft && error && /\b402\b|out of credits/i.test(error)) {
      const pid = `${key.split("::")[0]}::`;
      for (const k of Object.keys(h)) {
        if (k.startsWith(pid) && k !== key) {
          h[k] = {
            ...(h[k] ?? { ok: 0, fail: 0 }),
            lastFailAt: Date.now(),
            lastError: "account out of credits",
          };
        }
      }
    }
    // OrcaRouter rate limits are WORKSPACE-wide (all keys share one bucket —
    // docs.orcarouter.ai/operations/rate-limits): one lane's 429 means every
    // orca lane is throttled, so stamp them all. r43: a soft 429 must NEVER
    // un-deaden a fresh HARD 402 stamp — the account is still out of credits
    // even while throttled — so hard-failed siblings keep their hard state.
    if (e.soft && key.startsWith("orcarouter::") && error && /\b429\b|rate.?limit/i.test(error)) {
      for (const k of Object.keys(h)) {
        if (k.startsWith("orcarouter::") && k !== key) {
          const s = h[k] ?? { ok: 0, fail: 0 };
          const hardRecent = !!s.lastFailAt && !s.soft && Date.now() - s.lastFailAt < HEALTH_COOLDOWN_MS;
          h[k] = {
            ...s,
            lastFailAt: Date.now(),
            ...(hardRecent ? {} : { soft: true, lastError: "workspace-wide rate limit" }),
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

/**
 * r49: record a PROBE outcome (background health check for a cooled lane).
 * Pass  → exit cooldown, baseline restored (STATE: probe recovery).
 * Fail  → cooldown doubles (from the current remaining window, capped at MAX)
 *         so a still-throttled lane isn't re-probed every minute forever.
 */
export function recordProbeResult(key: string, ok: boolean, error?: string, latencyMs?: number): void {
  if (!key || key === "auto::builtin") return;
  const h = loadHealth();
  const e = h[key] ?? { ok: 0, fail: 0 };
  if (ok) {
    e.ok += 1;
    e.lastOkAt = Date.now();
    e.lastError = undefined;
    e.soft = false;
    e.cooldownUntil = undefined;
    e.cooldownCount = 0;
  } else {
    e.fail += 1;
    const now = Date.now();
    const remaining = Math.max(0, (e.cooldownUntil ?? now) - now);
    const count = Math.max(1, e.cooldownCount ?? 1);
    e.cooldownCount = count + 1;
    const extend = Math.min(
      Math.max(remaining * 2, CAPACITY_COOLDOWN_BASE_MS * 2),
      CAPACITY_COOLDOWN_MAX_MS
    );
    e.cooldownUntil = now + extend;
    e.soft = true;
    if (error) e.lastError = error.slice(0, 160);
    e.lastFailAt = now;
  }
  h[key] = e;
  saveHealth(h);
}

/** True when the hop failed inside the cooldown window. */
function recentlyFailed(entry: RelayHealthEntry | undefined): boolean {
  // Soft failures (429/capacity) never HARD-demote — only hard deaths do
  // (r25). Capacity failures cool down via cooldownUntil instead.
  if (!entry?.lastFailAt || entry.soft) return false;
  return Date.now() - entry.lastFailAt < HEALTH_COOLDOWN_MS;
}

/**
 * r49: true when the hop is in its capacity cooldown right now (chain rotates
 * past it; the probe loop works on re-admission).
 */
export function isCapacityCooled(entry: RelayHealthEntry | undefined): boolean {
  return !!entry?.cooldownUntil && entry.cooldownUntil > Date.now();
}

/**
 * r49: true when ANY hop of this provider is cooling (capacity) or recently
 * hard-failed. Used to skip a cooled PRIMARY — rotating the head of the chain
 * to a lane we already know is throttled is exactly the bug this round kills.
 */
export function providerInCooldown(providerId: string): boolean {
  if (!providerId || providerId === "auto") return false;
  const h = loadHealth();
  const prefix = `${providerId}::`;
  return Object.entries(h).some(
    ([k, v]) => k.startsWith(prefix) && (recentlyFailed(v) || isCapacityCooled(v))
  );
}

/**
 * r43: True when ANY hop of this provider hard-failed inside the cooldown
 * window (402 credits, network death…). Callers use it to skip a dead
 * PRIMARY — the chain's health sort only protects the backup hops.
 */
export function providerRecentlyHardFailed(providerId: string): boolean {
  if (!providerId || providerId === "auto") return false;
  const h = loadHealth();
  const prefix = `${providerId}::`;
  return Object.entries(h).some(([k, v]) => k.startsWith(prefix) && recentlyFailed(v));
}

// ─── Task fit heuristics ──────────────────────────────────────────────────────

const FAST_RE = /flash|mini|lite|fast|turbo|lightning|instant|small|20b|8b|bonsai|compound|\bjev/i;
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

// ─── r49 Leaderboard blend (Problem 2 — no frozen rankings) ────────────────
// src/config/leaderboard.json is a DATED, human-reviewed snapshot from
// arena.ai/leaderboard/code/webdev + artificialanalysis.ai/agents/coding-agents
// (scripts/fetch-leaderboard.ts --apply writes it; changelog inside). The
// chain blends its scores 50/50 with the doctrine catalog's Elo so daily
// leaderboard movement reorders lanes WITHOUT code edits. Missing file keys
// leave the doctrine Elo untouched — unknown ≠ worse.

interface LeaderboardFile {
  version?: number;
  updatedAt?: string;
  sources?: string[];
  scores?: Record<string, number>;
  changelog?: { date: string; note: string }[];
}

const LEADERBOARD_SCORES: Record<string, number> =
  (LEADERBOARD as LeaderboardFile)?.scores ?? {};

export function leaderboardMeta(): { updatedAt?: string; sources?: string[]; changelog: { date: string; note: string }[]; count: number } {
  const lb = LEADERBOARD as LeaderboardFile;
  return {
    ...(lb.updatedAt ? { updatedAt: lb.updatedAt } : {}),
    ...(lb.sources ? { sources: lb.sources } : {}),
    changelog: lb.changelog ?? [],
    count: Object.keys(LEADERBOARD_SCORES).length,
  };
}

/**
 * Blend doctrine Elo with the latest reviewed leaderboard snapshot (50/50).
 * Match by full hop key first ("vyce::deepseek-v4.1"), then bare model id —
 * cross-provider hits (e.g. "z-ai/glm-5.3") still count, providers differ.
 */
function leaderboardElo(hop: RelayHop): number | null {
  const byKey = LEADERBOARD_SCORES[hop.key];
  if (typeof byKey === "number" && byKey >= 0 && byKey <= 1) return byKey;
  const byModel = LEADERBOARD_SCORES[hop.model];
  if (typeof byModel === "number" && byModel >= 0 && byModel <= 1) return byModel;
  return null;
}

function effectiveElo(hop: RelayHop): number {
  const lb = leaderboardElo(hop);
  if (lb === null) return hop.elo;
  return Math.min(1, Math.max(0, 0.5 * hop.elo + 0.5 * lb));
}

/**
 * r49 watchdog weights (Settings.relayWeights): providerId → −2…+2 boost the
 * human applied from a watchdog finding. Applied as a small sort factor AFTER
 * health/cooling — a human demotion can bury a flapping provider but never
 * resurrect a cooled one.
 */
function weightBoost(settings: Settings, providerId: string): number {
  const w = settings.relayWeights?.[providerId];
  return typeof w === "number" && w >= -2 && w <= 2 ? w : 0;
}

/**
 * Build the ordered fallback chain for the current vault.
 * Order: user's saved relayOrder first (by index), remaining entries in
 * Generation-Era order (tier asc → Elo desc → task fit → health), built-in
 * engine always last. Providers without a saved key are skipped — the chain
 * only contains hops that can actually answer. Live-catalog models for keyed
 * providers are appended (tier 2) so freshly-refreshed rosters join the chain
 * even before the doctrine catalog learns about them.
 *
 * r49 failover-v2: capacity-cooled hops are EXCLUDED while ≥ MIN_HEALTHY_HOPS
 * healthy alternatives exist (don't burn the hop budget on throttled lanes);
 * otherwise they ride at the back — cooldown ≠ removal, a cooled lane can
 * still serve when everything else is dead.
 */
export function buildRelayChain(
  settings: Settings,
  opts?: { taskFit?: RelayTaskFit; freeFirst?: boolean }
): RelayHop[] {
  const hops: RelayHop[] = [];
  const fit = opts?.taskFit ?? "any";
  // r34 free-frontier harness: when set, free lanes lead the chain (after
  // health demotion) even ahead of paid tier-1 — paid frontier becomes the
  // backup, not the default.
  const freeFirst = opts?.freeFirst === true;

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
  // then — under the free-frontier harness — free lanes, then tier, then Elo
  // (r49: leaderboard-blended), then task fit, then watchdog weights, stable
  // within equal rank.
  // r43 decision-tier fix: for fit === "decision" the task boost sorts BEFORE
  // tier — the r27 doctrine says System-One jobs use ONLY fast lanes (a slow
  // genius pass defeats the decision tier), but the old tier-first comparator
  // let flagship tier-1 lanes lead every judge chain, burying taskBoost
  // entirely. Other fits keep the tier-first order untouched.
  const health = loadHealth();
  const freeBonus = (h: RelayHop) => (freeFirst && isFreeLane(h.model) ? 1 : 0);
  const boost = (h: RelayHop) => taskBoost(h, fit);
  const cooled = (h: RelayHop) => (recentlyFailed(health[h.key]) || isCapacityCooled(health[h.key]) ? 1 : 0);
  const wBoost = (h: RelayHop) => weightBoost(settings, h.providerId);
  hops.sort((a, b) => {
    const hp = cooled(a);
    const hb = cooled(b);
    if (hp !== hb) return hp - hb;
    if (fit === "decision") {
      const db = boost(b) - boost(a);
      if (db !== 0) return db;
    }
    const wb = wBoost(b) - wBoost(a);
    if (wb !== 0) return wb;
    const fb = freeBonus(b) - freeBonus(a);
    if (fb !== 0) return fb;
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (effectiveElo(b) !== effectiveElo(a)) return effectiveElo(b) - effectiveElo(a);
    const tb = boost(b);
    const ta = boost(a);
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
      const da = cooled(a);
      const db = cooled(b);
      if (da !== db) return da - db;
      const fb = freeBonus(b) - freeBonus(a);
      if (fb !== 0) return fb;
      return idx(a.key) - idx(b.key);
    });
  }

  // r49: capacity-cooled hops drop out entirely while enough healthy hops
  // remain (the probe loop re-admits them); with few alternatives they stay —
  // a cooled lane beats no lane.
  const MIN_HEALTHY_HOPS = 4;
  const healthy = hops.filter((h) => cooled(h) === 0);
  const chain = healthy.length >= MIN_HEALTHY_HOPS ? healthy : hops;

  // The built-in engine is the unconditional last resort.
  chain.push(AUTO_HOP);
  return chain;
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
  opts?: { taskFit?: RelayTaskFit; freeFirst?: boolean }
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
