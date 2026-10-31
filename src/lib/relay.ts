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

import { CHAT_PROVIDERS, providerBaseUrl, providerById } from "./providers";
import { loadLiveCatalog } from "./providers";
import { enabledAdoptedLanes } from "./lane-adopt";
// r504: provider-level circuit breaker — N consecutive hard lane-fails dock
// the provider's lanes to the back of the chain (fresh-ok lanes keep their
// seat). Pure localStorage module, no import cycle.
import {
  FRESH_OK_WINDOW_MS,
  isProviderQuarantined,
  providerBreakerSnapshot,
  recordProviderOutcome,
  type ProviderBreakerMap,
} from "./provider-breaker";
import type { Settings } from "./types";
// r516: benchmark intelligence index — the chain's within-class ordering now
// leads with LIVE leaderboard data (arena webdev/agent + Artificial Analysis)
// blended over the static catalog Elo prior. Isomorphic helpers, localStorage
// cache; the index itself is produced server-side (/api/intelligence).
import {
  blendedIntel,
  readIntelligenceCache,
  type IntelligenceIndex,
} from "./intelligence";

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
  /** r516: benchmark-blended ordering score (live index 0.65 · elo prior
   * 0.35). Falls back to `elo` when no leaderboard row matches. */
  intel?: number;
  /** "live" = a leaderboard row matched this model; "prior" = elo only. */
  intelOrigin?: "live" | "prior";
  /** Canonical leaderboard name that matched (UI honesty chip). */
  intelName?: string;
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
  /**
   * r530 (TASK-102): "anthropic" rides the /v1/messages wire end-to-end for
   * this hop (URL + x-api-key + shaped body + SSE translation). Produced by
   * buildRelayWire from the provider registry; absent ⇒ OpenAI dialect.
   */
  dialect?: string;
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
      // r28: verified REAL (Vyce /v1/models owned_by:alibaba ctx:1000000 +
      // HF Qwen/Qwen3.8-Flash-Next + OpenRouter qwen/qwen3.8-flash) — $0.10/$0.40.
      { id: "qwen3.8-flash", tier: 1, elo: 0.965, note: "Alibaba Qwen 3.8 · 1M ctx · $0.10/$0.40" },
      // r504: absorbed from the owner's live Vyce status-page roster — a
      // degraded fleet still lists healthy lanes worth rotating onto, and the
      // status page IS ground truth (uptime 58.3%, family 503s witnessed).
      { id: "claude-sonnet-4-6-pro", tier: 1, elo: 0.975, note: "Sonnet 4.6 Pro · $3/$15 · status-page roster" },
      { id: "gpt-5.6-terra", tier: 1, elo: 0.96, note: "GPT 5.6 Terra · $2.5/$15 · status-page roster" },
      { id: "deepseek-v4-flash-lr", tier: 2, elo: 0.918, note: "Long-range · stayed online at 380ms during the family outage" },
      { id: "glm-5.3-flash", tier: 2, elo: 0.92, note: "FREE · Z.ai flash via Vyce · $0 · ~10s TTFT" },
      { id: "deepseek-v4-pro", tier: 2, elo: 0.92, note: "V4 Pro · $0.50/$2 · status-page roster" },
      { id: "deepseek-v4-flash", tier: 2, elo: 0.915, note: "Ultra-fast" },
      { id: "agnes-3.0-flash", tier: 2, elo: 0.91, note: "Agentic · 512K ctx · $0.05/$0.15" },
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
      // r493 re-applied (lost in the Oct-13 .git rollback): the r489 owner
      // directive — qwen3.8-max-free joins the high-priority list; flash-free is
      // the healthy sibling lane. First-hand AIHubMix telemetry (owner model-page
      // dump): max-free edge TTFT ~55s / 9 tok/s at peak; flash-free ~5.4s / 36 tok/s.
      { id: "qwen3.8-max-free", tier: 1, elo: 0.945, note: "Qwen 3.8 Max free lane · 1M ctx · $0 · peak TTFT ~55s / 9 tok/s" },
      { id: "qwen3.8-flash-free", tier: 1, elo: 0.912, note: "Qwen 3.8 Flash free lane · 1M ctx · $0 · healthy ~5.4s / 36 tok/s" },
      { id: "deepseek-v4-flash", tier: 2, elo: 0.93, note: "Budget frontier · 1M ctx · $0.142/$0.284" },
      // r502: radar-new lanes absorbed into the dials-first order.
      { id: "minimax-m3.1-flash", tier: 2, elo: 0.92, note: "NEW · 1M ctx · $0.17/$0.66" },
      { id: "glm-5.3-flash", tier: 2, elo: 0.925, note: "Z.ai fast lane · 1M ctx · $0.11/$0.39" },
      { id: "coding-glm-5.3-free", tier: 2, elo: 0.912, note: "FREE coding lane · 1M ctx · tools" },
      { id: "coding-kimi-k3-free", tier: 2, elo: 0.905, note: "FREE · Kimi coding · 1M ctx" },
      { id: "xiaomi-mimo-v2.6-pro-free", tier: 2, elo: 0.9, note: "FREE · omni-in · 1M ctx" },
      { id: "nemotron-3-ultra-550b-a55b-free", tier: 2, elo: 0.895, note: "FREE · 550B MoE · 1M ctx" },
    ],
  },
  orcarouter: {
    label: "OrcaRouter",
    models: [
      { id: "google/gemini-3.8-flash", tier: 1, elo: 0.975, note: "Current-gen Gemini · 1M ctx" },
      { id: "kimi/kimi-k3", tier: 1, elo: 0.975, note: "Moonshot frontier" },
      { id: "z-ai/glm-5.3", tier: 1, elo: 0.97, note: "GLM 5.3 flagship" },
      { id: "minimax/minimax-m3", tier: 1, elo: 0.92, note: "Long-horizon agentic" },
      // r502: radar-new OrcaRouter lanes.
      { id: "deepseek/deepseek-v4.1-flash-1017", tier: 2, elo: 0.925, note: "NEW · latest V4.1 flash cut · free roster" },
      { id: "tencent/hy4-preview-free", tier: 2, elo: 0.9, note: "NEW · Hy4 preview MoE · free roster" },
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
    // r510: re-grounded — devstral-latest retired upstream; leanstral joins
    // (5M TPM makes it the throughput lane of the whole free fleet).
    models: [
      { id: "mistral-medium-latest", tier: 2, elo: 0.89, note: "Stronger, still free" },
      { id: "mistral-small-latest", tier: 2, elo: 0.87, note: "Best free default" },
      { id: "labs-leanstral-1-5-1", tier: 2, elo: 0.86, note: "NEW · 262K ctx · 5M TPM" },
      { id: "codestral-latest", tier: 2, elo: 0.85, note: "Code specialist" },
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
      // r502: minimax-m3.1-flash:free absorbed (tracker "new", 1M ctx, $0/$0).
      { id: "minimax/minimax-m3.1-flash:free", tier: 2, elo: 0.918, note: "NEW · 1M ctx · $0/$0" },
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
  // r510: the two r509 providers never joined the relay chain — no arena
  // entries AND a broken refresh path meant their live-roster extras never
  // materialized either. The owner dialed workflows THROUGH these grants.
  inception: {
    label: "Inception Labs",
    models: [
      { id: "mercury-3", tier: 1, elo: 0.95, note: "Diffusion LM · 1M ctx · tools · 100M free tokens" },
      { id: "mercury-2", tier: 2, elo: 0.88, note: "128K ctx · json_mode" },
      // r510: the typed decision primitive rides the chat wire too — it joins
      // the fastJudge chain (taskFit "decision") as the SECOND free decision
      // model next to the Intern SystemOne primitive (owner: "not only
      // discovery internal — most providers have special decision models").
      { id: "mercury-decide", tier: 3, elo: 0.84, note: "Typed decisions lane · $0.02/M · router/judge class" },
    ],
  },
  "intern-discovery": {
    label: "Intern TokenPlan",
    models: [
      { id: "deepseek-v4-flash-0731", tier: 1, elo: 0.94, note: "1M ctx · deep thinking · grant tier" },
      { id: "glm-5.3", tier: 1, elo: 0.94, note: "1M ctx · Z.ai flagship class" },
      { id: "deepseek-v4-pro-0813", tier: 1, elo: 0.945, note: "1M ctx · deep-reasoning" },
      { id: "minimax-m3", tier: 2, elo: 0.92, note: "1M ctx · efficiency frontier" },
      { id: "Atria-Dawn", tier: 2, elo: 0.91, note: "512K ctx · scientific reasoning" },
      { id: "kimi-k2.6", tier: 2, elo: 0.9, note: "256K ctx · agentic multimodal" },
      { id: "Agents-A1", tier: 2, elo: 0.9, note: "256K ctx · multimodal · tool calling" },
      // NOTE: intern-decision-4b is deliberately NOT here — it speaks only the
      // SystemOne decision protocol (systemone.ts), not chat. It powers the
      // FREE System-One decision rung via settings.providerKeys, not the relay.
    ],
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

export const RELAY_HEALTH_KEY = "nexus-relay-health";

export interface RelayHealthEntry {
  ok: number;
  fail: number;
  lastOkAt?: number;
  lastFailAt?: number;
  lastError?: string;
  /** Soft failures (429s, capacity) are recorded but NEVER demote a hop. */
  soft?: boolean;
  /** r187: dead = permanent-for-this-hop rejection (401 auth, 403 region /
   * permission, account-tier paywall, maintenance). Demoted for hours, not
   * minutes — re-dialing these burns a ladder rung on a corpse every turn
   * (live evidence: the same tier/region/auth errors recurred across the
   * user's turns at 02:15, 02:17 and 02:18). Absent on old entries → read
   * as plain hard (short cooldown), so persisted localStorage stays valid. */
  dead?: boolean;
}

// ─── Failure taxonomy (r187/r188/r194) — moved to ./relay-core (r309) ────────
// The SOFT/HARD/DEAD classifiers are pure text logic, but THIS module is
// "use client" while agent-engine is deliberately isomorphic (it runs both
// server-side inside /api/chat and browser-direct via chat-client). Importing
// the classifiers from here made every server-side classification throw Next's
// client-reference error — the relay ladder died at its FIRST hop failure
// ("Attempted to call isDeadlyRelayFailure() from the server") instead of
// rotating. The pure core now lives directive-free in relay-core.ts and is
// re-exported below, so every existing client import path keeps working.
import { AUTH_RE, isDeadlyRelayFailure, isSoftRelayFailure } from "./relay-core";

export {
  isAuthRelayFailure,
  isDeadlyRelayFailure,
  isHardRelayFailure,
  isSoftRelayFailure,
} from "./relay-core";

type RelayHealth = Record<string, RelayHealthEntry>;

/** Cooldown windows: a hard-failed hop is demoted this recently; a DEAD hop
 * (auth/region/tier) is demoted for hours — re-dialing it sooner just burns
 * a ladder rung on a corpse (r187). */
const HEALTH_COOLDOWN_MS = 5 * 60_000;
const DEAD_COOLDOWN_MS = 6 * 60 * 60_000;

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

/** Record one hop outcome (called from the rotation status lines the server emits).
 * `verdict` (r188) is the server's classification from the FULL upstream error —
 * it overrides display-text classification, which only ever sees the 90-char
 * `shortError` fragment and can miss a keyword buried past the cut. */
export function recordRelayHopResult(
  key: string,
  ok: boolean,
  error?: string,
  verdict?: "dead" | "auth" | "soft",
): void {
  if (!key || key === "auto::builtin") return;
  const h = loadHealth();
  const e = h[key] ?? { ok: 0, fail: 0 };
  if (ok) {
    e.ok += 1;
    e.lastOkAt = Date.now();
    e.lastError = undefined;
    e.soft = false;
    e.dead = false; // r187: a success proves the hop lives — rejoin the chain
    // r504: one answer heals the provider breaker too (streak/trips/quarantine
    // all reset — the next dial is a clean slate for the whole family).
    const pidHeal = key.slice(0, key.indexOf("::"));
    if (pidHeal) recordProviderOutcome(pidHeal, true, false);
  } else {
    e.fail += 1;
    e.lastFailAt = Date.now();
    e.soft = verdict === "soft" || (!verdict && isSoftRelayFailure(error));
    e.dead = verdict === "dead" || verdict === "auth" || (!verdict && isDeadlyRelayFailure(error));
    if (error) e.lastError = error.slice(0, 160);
    // r504: feed the PROVIDER circuit breaker — hard/dead lane failures build
    // a per-provider streak; 3 in a row dock the whole family to the back of
    // the chain (soft capacity noise never counts — e.soft short-circuits).
    const pidBreaker = key.slice(0, key.indexOf("::"));
    if (pidBreaker) recordProviderOutcome(pidBreaker, false, !e.soft, error);
    // OrcaRouter gates are WORKSPACE-wide (all keys share one bucket —
    // docs.orcarouter.ai/operations/rate-limits): one lane's 429 means every
    // orca lane is throttled, and r310 adds the 402 credit drain — one lane's
    // empty wallet means every orca lane is drained. A server verdict counts
    // even when the keyword sits past the display truncation cut.
    if (key.startsWith("orcarouter::")) {
      const workspace429 =
        e.soft && (verdict === "soft" || (error && /\b429\b|rate.?limit/i.test(error)));
      const workspaceBilling = e.dead && !!error && /\b402\b|credit|billing/i.test(error);
      if (workspace429 || workspaceBilling) {
        let stamp: { soft: boolean; dead: boolean; lastError: string };
        if (workspace429) {
          stamp = { soft: true, dead: false, lastError: "workspace-wide rate limit" };
        } else {
          stamp = { soft: false, dead: true, lastError: "workspace-wide credit gate" };
        }
        for (const k of Object.keys(h)) {
          if (k.startsWith("orcarouter::") && k !== key) {
            h[k] = {
              ...(h[k] ?? { ok: 0, fail: 0 }),
              lastFailAt: Date.now(),
              soft: stamp.soft,
              dead: stamp.dead,
              lastError: stamp.lastError,
            };
          }
        }
      }
    }
    // r187: an AUTH-class death (401 / rejected key) means EVERY hop sharing
    // that provider's key is equally dead — the key travels with the request,
    // not the model. Stamp the whole provider family so the ladder skips the
    // corpse instead of re-learning it one hop at a time. An "auth" verdict
    // (r188) stamps the family even when the truncated display text hides the
    // keyword — the server saw the full error.
    if (
      e.dead &&
      (verdict === "auth" || (error && AUTH_RE.test(error))) &&
      key.includes("::")
    ) {
      const pid = key.slice(0, key.indexOf("::"));
      for (const k of Object.keys(h)) {
        if (k.startsWith(`${pid}::`) && k !== key) {
          h[k] = {
            ...(h[k] ?? { ok: 0, fail: 0 }),
            lastFailAt: Date.now(),
            soft: false,
            dead: true,
            lastError: "shared key rejected (auth)",
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

/** r548: vault-realignment heal (browser half). A freshly stored key must not
 * inherit the OLD key's dial memory — drop every lane-health entry for ONE
 * provider (`${providerId}::...`) so the fresh credential re-enters every
 * browser wire immediately. The browser-side mirror of the r335 server
 * recheck: mirror heal = recheck (server) + scoped clear (browser). Returns
 * the number of entries dropped (0 = nothing pinned, a safe no-op). */
export function clearProviderLaneHealth(providerId: string): number {
  if (!providerId) return 0;
  const h = loadHealth();
  const prefix = `${providerId}::`;
  let dropped = 0;
  for (const k of Object.keys(h)) {
    if (k.startsWith(prefix)) {
      delete h[k];
      dropped++;
    }
  }
  if (dropped > 0) saveHealth(h);
  return dropped;
}

// ─── r188: the relay status wire — one parser for every consumer ─────────────
// The server (agent-engine) classifies each rotation failure from the FULL
// upstream error and labels the line with a verdict marker; clients used to
// re-classify from the display text, which is a 90-char `shortError` fragment
// and can hide the tier/region/auth keyword inside a JSON error envelope.
// Markers: [hop:x] failed · [hopok:x] answered · [hopdead]/[hopauth]/[hopsoft].

/** Strip every relay marker from a status line — display / error-text form. */
export function stripRelayMarkers(m: string): string {
  return m.replace(/\s*\[hop[a-z]*(?::[^\]]+)?\]/g, "").trim();
}

export interface ParsedRelayStatus {
  ok: boolean;
  key: string;
  /** Display text minus all markers — the best error text available client-side. */
  error: string;
  /** Server's verdict from the full upstream error; undefined on legacy lines
   * without a marker → consumers fall back to display-text classification. */
  verdict?: "dead" | "auth" | "soft";
}

/** Parse one relay status line into a hop outcome. Returns null for non-relay
 * lines and for marker-less failures (nothing to record). */
export function parseRelayStatusLine(m: string): ParsedRelayStatus | null {
  if (!/Model relay:/i.test(m)) return null;
  const okHop = /\[hopok:([^\]]+)\]/.exec(m);
  if (okHop) return { ok: true, key: okHop[1], error: stripRelayMarkers(m) };
  const failHop = /\[hop:([^\]]+)\]/.exec(m);
  if (!failHop) return null;
  return {
    ok: false,
    key: failHop[1],
    error: stripRelayMarkers(m),
    verdict: /\[hopauth\]/.test(m)
      ? "auth"
      : /\[hopdead\]/.test(m)
        ? "dead"
        : /\[hopsoft\]/.test(m)
          ? "soft"
          : undefined,
  };
}

/** Feed the rotator's memory from a raw status line. Chat view and workflow
 * runner both call this — one wire format, one parser, no parallel truth. */
export function recordRelayStatusLine(m: string): ParsedRelayStatus | null {
  const p = parseRelayStatusLine(m);
  if (!p) return null;
  recordRelayHopResult(p.key, p.ok, p.error, p.verdict);
  return p;
}

// ─── Health badge (r73): the rotator's memory, surfaced in model pickers ──────
// ClawLabs/free-ai-models doctrine: catalog presence means nothing if the last
// dials died — pickers should show a lane's LIVE verdict next to its name.
// Hard/soft rules mirror the rotator exactly (no parallel truth).

export interface RelayHealthBadge {
  label: string;
  tone: "emerald" | "amber" | "muted";
  /** Last error text when the verdict is bad (note / tooltip fodder). */
  detail?: string;
}

/** One-hop health verdict from the rotator's memory. `snapshot` lets callers
 * building many rows pass relayHealthSnapshot() ONCE instead of re-reading
 * localStorage per row. Undefined = never dialed (no data, no opinion):
 * hard death inside the cooldown window → "sick" (amber); soft capacity
 * failure → "throttled" (muted); otherwise any history → "ok <n>" (emerald). */
export function relayHopBadge(
  providerId: string,
  model: string,
  snapshot?: Record<string, RelayHealthEntry>
): RelayHealthBadge | undefined {
  const entry = (snapshot ?? loadHealth())[hopKey(providerId, model)];
  if (!entry || (entry.ok === 0 && entry.fail === 0)) return undefined;
  const windowMs = entry.dead ? DEAD_COOLDOWN_MS : HEALTH_COOLDOWN_MS;
  const failedRecently =
    entry.lastFailAt !== undefined &&
    Date.now() - entry.lastFailAt < windowMs;
  if (failedRecently && entry.dead) {
    return { label: "blocked", tone: "amber", detail: entry.lastError };
  }
  if (failedRecently && !entry.soft) {
    return { label: "sick", tone: "amber", detail: entry.lastError };
  }
  if (failedRecently && entry.soft) {
    return { label: "throttled", tone: "muted", detail: entry.lastError };
  }
  return { label: `ok ${entry.ok}`, tone: "emerald" };
}

/** Wipe the rotator's health memory (settings card button). */
export function resetRelayHealth(): void {
  try {
    localStorage.removeItem(RELAY_HEALTH_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the hop failed inside its cooldown window (hard = 5min,
 * dead = 6h — r187). Soft failures never demote. */
function recentlyFailed(entry: RelayHealthEntry | undefined): boolean {
  // Soft failures (429/capacity) never demote — only hard deaths do (r25).
  if (!entry?.lastFailAt || entry.soft) return false;
  const windowMs = entry.dead ? DEAD_COOLDOWN_MS : HEALTH_COOLDOWN_MS;
  return Date.now() - entry.lastFailAt < windowMs;
}

// ─── r504: smart failover policy — free frontiers + provider breaker ─────────
// Owner directive (Vyce fleet degraded, 58.3% uptime): "we have to be prepared
// for these problems and auto-rotate them to the best available alternative
// FREE frontiers for continuation smartly." Two mechanisms answer it:
//
//  • PROVIDER BREAKER DOCK — a provider whose lanes hard-fail 3× in a row is
//    quarantined (10m → 20m → 40m → 60m escalation) and its lanes sink to the
//    back of the chain, so a degraded fleet stops burning 60s+ ladder rungs.
//    EXCEPTION: a lane that ANSWERED inside the fresh-ok window keeps its
//    seat — partial outages must not sink the family's healthy members
//    (live evidence: deepseek-v4-flash-lr stayed online at 380ms while its
//    siblings died).
//  • FAILOVER POLICY — "smart" (default) keeps Generation-Era tiers but prefers
//    FREE lanes within a tier; "free" prefers free lanes across tiers; "quality"
//    is the classic tier→Elo order. Smart protects the wallet during an outage
//    without sacrificing tier quality when a paid lane is genuinely better.

/** r504 failover ordering policies. */
export type RelayFailoverPolicy = "smart" | "quality" | "free";

/** A hop is a FREE frontier lane when its note says so (adopted lanes carry
 * "free"/"paid" verbatim; doctrine notes carry "$0"/"free"; no-key lanes are
 * free by construction). "\$0" must not match "\$0.10" — negative lookahead. */
export function hopIsFree(hop: RelayHop): boolean {
  if (hop.providerId === "auto") return true;
  return /\bfree\b|\$0(?![.\d])|no-key/i.test(hop.note ?? "");
}

/** r504: breaker-docked = the provider is quarantined AND this lane has not
 * proven itself fresh. Snapshot passed in — callers building/sorting chains
 * read the breaker map ONCE (same doctrine as the health snapshot). */
function breakerDocked(
  hop: RelayHop,
  breaker: ProviderBreakerMap,
  health: RelayHealth
): boolean {
  if (!isProviderQuarantined(hop.providerId, breaker)) return false;
  const e = health[hop.key];
  if (e?.lastOkAt && Date.now() - e.lastOkAt < FRESH_OK_WINDOW_MS) return false;
  return true;
}

/** r504: read-only verdict for UI boards — same window math as the chain sort
 * (one truth: boards must agree with what the rotator actually does). */
export function laneRecentlyFailed(entry: RelayHealthEntry | undefined): boolean {
  return recentlyFailed(entry);
}

/** r504: read-only breaker-dock verdict for UI rows (hop chip + fleet board). */
export function hopBreakerDocked(
  hop: RelayHop,
  breaker: ProviderBreakerMap,
  health: Record<string, RelayHealthEntry>
): boolean {
  return breakerDocked(hop, breaker, health);
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
    // r510: also exclude SystemOne decision primitives (intern-decision-4b) —
    // they 404 on openai_chat; they are wired as decision gates, not hops.
    const liveExtras = (loadLiveCatalog()[providerId] ?? []).filter(
      (m) => !seen.has(m.id) && !/imagine|embed|whisper|tts|image|decision|system-?one/i.test(m.id)
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

  // r318: no-key FREE registry lanes join the chain. With ONE saved key the
  // chain used to degenerate to the saturated provider's own models + AUTO —
  // witnessed live (r318 user report: "⇄0 relay", a 429'd step had nowhere
  // to rotate but its own quota bucket, park 1/4). nextRotation already
  // treats noKey lanes as valid rotation targets (provider-rotation r306);
  // the per-call relay chain now agrees. Health memory self-corrects if a
  // free lane misbehaves — sick hops sink in the sort below.
  for (const reg of CHAT_PROVIDERS) {
    if (reg.noKey !== true) continue;
    if (hops.some((h) => h.providerId === reg.id)) continue; // keyed pass covered it
    const model = reg.models[0]?.id;
    if (!model) continue;
    hops.push({
      key: hopKey(reg.id, model),
      providerId: reg.id,
      model,
      label: `${reg.name} · ${model}`,
      baseUrl: providerBaseUrl(reg, undefined),
      tier: 2,
      elo: 0.7,
      note: "no-key free lane",
    });
  }

  // r503: radar-ADOPTED lanes join as real hops (the lane-adopt pipeline —
  // tracker first-seen → registry → chain). This is the wiring that stops
  // every run funneling into one saturated primary while fresh free capacity
  // sits un dialed in the radar: an adopted lane dials on the very next chain
  // build, and the rotator's health memory demotes it if it disappoints.
  // r512: enabledAdoptedLanes() also runs the lazy auto-retire pass and
  // EXCLUDES lanes the tracker (or 2 dial strikes) proved removed from their
  // provider catalog — a corpse lane never joins the rotation here.
  for (const lane of enabledAdoptedLanes()) {
    if (hops.some((h) => h.key === lane.key)) continue; // keyed/live pass covered it
    const reg = providerById(lane.providerId);
    if (!reg) continue;
    const entry = settings.providerKeys?.[lane.providerId];
    // Dialability gate — an adopted lane from a keyed provider WITHOUT a
    // vault key is a corpse rung (the engine would burn a rotation hop on
    // it every dial). Adopted lanes join only when they can actually answer;
    // the settings card still lists them (the registry is the audit trail).
    const key = entry?.key?.trim() ?? "";
    if (!key && !reg.noKey) continue;
    const ageH = Math.max(
      0,
      Math.round((Date.now() - new Date(lane.firstSeenAt).getTime()) / 3_600_000)
    );
    const ctxNote = lane.contextWindow
      ? lane.contextWindow >= 1_000_000
        ? `${+(lane.contextWindow / 1_000_000).toFixed(1)}M ctx`
        : `${Math.round(lane.contextWindow / 1000)}K ctx`
      : null;
    hops.push({
      key: lane.key,
      providerId: lane.providerId,
      model: lane.modelId,
      label: `${reg.name} · ${lane.modelId}`,
      baseUrl: providerBaseUrl(reg, entry?.accountId),
      apiKey: key || undefined,
      tier: 2,
      elo: 0.86,
      note:
        `radar adopt · ${lane.free ? "free" : "paid"} · first seen ${ageH}h ago` +
        (ctxNote ? ` · ${ctxNote}` : ""),
    });
  }

  // Generation-Era doctrine, r516 intelligence-led: breaker-docked providers
  // sink FIRST (a quarantined fleet must not burn ladder rungs even when its
  // tier is flagship), then recently-failed hops, then the failover policy's
  // free-frontier preference, then tier → LIVE INTELLIGENCE (benchmark blend;
  // the static Elo is only the 0.35 prior) → task fit, stable within rank.
  // Owner r516: "This needs to be really smart routing, not on words only" —
  // mercury-3 (diffusion speed lane) no longer outranks benchmark-proven
  // free frontier (qwen3.8-max) just because a hand-typed constant said so.
  const health = loadHealth();
  const breaker = providerBreakerSnapshot();
  const idx: IntelligenceIndex | null = readIntelligenceCache();
  for (const h of hops) {
    const b = blendedIntel(idx, h.model, h.elo);
    h.intel = b.intel;
    h.intelOrigin = b.origin;
    if (b.name) h.intelName = b.name;
  }
  const policy: RelayFailoverPolicy = settings.relayFailoverPolicy ?? "smart";
  const freeRank = (h: RelayHop) => (hopIsFree(h) ? 0 : 1);
  hops.sort((a, b) => {
    const dp =
      (breakerDocked(a, breaker, health) ? 1 : 0) -
      (breakerDocked(b, breaker, health) ? 1 : 0);
    if (dp) return dp;
    const hp = recentlyFailed(health[a.key]) ? 1 : 0;
    const hb = recentlyFailed(health[b.key]) ? 1 : 0;
    if (hp !== hb) return hp - hb;
    // "free": free frontiers across tiers — during a paid-fleet outage the
    // continuation rides free capacity before it spends a cent.
    if (policy === "free") {
      const fp = freeRank(a) - freeRank(b);
      if (fp) return fp;
    }
    // r798: benchmark-led tier jump — when BOTH hops carry benchmark-backed
    // intel (blendedIntel origin "live": the index knows the model, not the
    // catalog Elo prior), the smarter lane outranks ACROSS tiers. The r516
    // tier wall parked radar-adopted free frontier (hardcoded tier 2) below
    // unproven tier-1 siblings forever — the Owner verdict 2026-10-31:
    // "ordering is still not the smartest and best available frontier".
    // Tier now only orders lanes the boards don't cover.
    if (a.intelOrigin === "live" && b.intelOrigin === "live") {
      const ja = a.intel ?? a.elo;
      const jb = b.intel ?? b.elo;
      if (jb !== ja) return jb - ja;
    }
    if (a.tier !== b.tier) return a.tier - b.tier;
    // "smart" (default): free-first WITHIN a tier — quality tiers preserved,
    // wallet protected (a free lane beats a paid sibling of the same era).
    if (policy === "smart") {
      const fp = freeRank(a) - freeRank(b);
      if (fp) return fp;
    }
    const ia = a.intel ?? a.elo;
    const ib = b.intel ?? b.elo;
    if (ib !== ia) return ib - ia;
    if (b.elo !== a.elo) return b.elo - a.elo;
    const tb = taskBoost(b, fit);
    const ta = taskBoost(a, fit);
    if (tb !== ta) return tb - ta;
    return 0;
  });

  // Apply the user's saved ordering (if any): listed keys keep their index,
  // unlisted keys follow in default order — but demoted hops ALWAYS sink to
  // the back of the saved order (r25: the old override silently disabled
  // health-demotion for anyone who had ever dragged a row); r504 adds the
  // breaker dock to that same invariant (health outranks human drag).
  const order = settings.relayOrder ?? [];
  if (order.length > 0) {
    const idx = (k: string) => {
      const i = order.indexOf(k);
      return i === -1 ? order.length + hops.findIndex((h) => h.key === k) : i;
    };
    hops.sort((a, b) => {
      const da =
        (breakerDocked(a, breaker, health) ? 1 : 0) -
        (breakerDocked(b, breaker, health) ? 1 : 0);
      if (da) return da;
      const fa = recentlyFailed(health[a.key]) ? 1 : 0;
      const fb = recentlyFailed(health[b.key]) ? 1 : 0;
      if (fa !== fb) return fa - fb;
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
  let chain = buildRelayChain(settings, opts).filter(
    (h) => h.key !== excludeKey && !(excludeAuto && h.providerId === "auto")
  );

  // r493 re-applied (lost in the Oct-13 .git rollback): r491 provider affinity —
  // when the request pins a provider, STABLY reorder into four buckets so the
  // pinned provider's own healthy lanes dial before a foreign tier-1 flagship
  // (the "pinned AIHubMix, answered Vyce" incident). Hard-failed hops sink
  // within their provider group; soft (429/capacity) hops NEVER demote
  // (recentlyFailed already enforces that — the rotator doctrine, one truth).
  const affinityId =
    primary?.providerId && primary.providerId !== "auto" ? primary.providerId : undefined;
  if (affinityId) {
    const health = loadHealth();
    // r504: a quarantined pinned provider's lanes sink within their own
    // bucket too — the user's pin decides the provider dials FIRST among the
    // chain, not that corpse lanes dial before healthy foreign ones.
    const breaker = providerBreakerSnapshot();
    const sick = (h: RelayHop) =>
      recentlyFailed(health[h.key]) || breakerDocked(h, breaker, health);
    const buckets: RelayHop[][] = [[], [], [], []];
    for (const h of chain) {
      buckets[(sick(h) ? 2 : 0) + (h.providerId === affinityId ? 0 : 1)].push(h);
    }
    chain = [...buckets[0], ...buckets[1], ...buckets[2], ...buckets[3]];
  }

  // r493 re-applied: the built-in engine stays the unconditional last resort —
  // under the MAX_RELAY_HOPS cap the AUTO slot is reserved, never sliced off
  // by keyed hops (r491 live note: the affinity reshuffle squeezed AUTO out).
  const keyed = chain.filter((h) => h.providerId !== "auto");
  const autoHop = chain.find((h) => h.providerId === "auto");
  const capped = autoHop
    ? [...keyed.slice(0, MAX_RELAY_HOPS - 1), autoHop]
    : keyed.slice(0, MAX_RELAY_HOPS);

  return capped
    .map((h) => ({
      key: h.key,
      ...(h.baseUrl ? { baseUrl: h.baseUrl } : {}),
      ...(h.apiKey ? { apiKey: h.apiKey } : {}),
      model: h.model,
      label: h.label,
      ...(h.providerId === "auto" ? { useAuto: true } : {}),
      // r530 (TASK-102): the registry dialect rides the wire hop so the
      // engine dials the right dialect per hop (vyce → /v1/messages).
      ...(h.providerId !== "auto" && providerById(h.providerId)?.dialect === "anthropic"
        ? { dialect: "anthropic" }
        : {}),
    }));
}

export const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: "Frontier",
  2: "Modern",
  3: "Legacy",
};
