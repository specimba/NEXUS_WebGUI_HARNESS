"use client";

// ─── Model Relay — automatic fallback chain across your free-frontier vault ──
// Doctrine ported from the local ModelRelay/"Genius rotator": models are ranked
// by Generation-Era tier (1 frontier > 2 modern > 3 legacy), then arena Elo,
// and when the active model fails (gateway drop, 429, out of credits, dead
// model id) the run rotates down the chain until someone answers.
// The chain is built CLIENT-SIDE from the key vault (keys never persist
// server-side) and travels with each /api/chat request as `relay` hops.

import { providerBaseUrl, providerById } from "./providers";
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
  baseUrl?: string;
  apiKey?: string;
  model: string;
  label?: string;
  /** True ⇒ server uses the built-in auto engine for this hop. */
  useAuto?: boolean;
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
      { id: "deepseek-v4-flash-lr", tier: 2, elo: 0.918, note: "Long-range" },
      { id: "deepseek-v4-flash", tier: 2, elo: 0.915, note: "Ultra-fast" },
      { id: "agnes-3.0-flash", tier: 2, elo: 0.91, note: "Agentic · 512K ctx" },
    ],
  },
  groq: {
    label: "Groq",
    models: [{ id: "llama-3.3-70b-versatile", tier: 2, elo: 0.9, note: "Fast open weights" }],
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
export const MAX_RELAY_HOPS = 4;

function hopKey(providerId: string, model: string): string {
  return `${providerId}::${model}`;
}

/**
 * Build the ordered fallback chain for the current vault.
 * Order: user's saved relayOrder first (by index), remaining entries in
 * Generation-Era order (tier asc → Elo desc), built-in engine always last.
 * Providers without a saved key are skipped — the chain only contains hops
 * that can actually answer.
 */
export function buildRelayChain(settings: Settings): RelayHop[] {
  const hops: RelayHop[] = [];

  for (const [providerId, catalog] of Object.entries(ARENA_CATALOG)) {
    const reg = providerById(providerId);
    if (!reg) continue;
    const key = settings.providerKeys?.[providerId]?.key?.trim() ?? "";
    if (!key) continue; // no key → this provider can't answer
    const baseUrl = providerBaseUrl(reg, settings.providerKeys?.[providerId]?.accountId);
    for (const m of catalog.models) {
      hops.push({
        key: hopKey(providerId, m.id),
        providerId,
        model: m.id,
        label: `${catalog.label} · ${m.id}`,
        baseUrl,
        apiKey: key,
        tier: m.tier,
        elo: m.elo,
        note: m.note,
      });
    }
  }

  // Generation-Era doctrine: tier first, then arena Elo, stable within equal rank.
  hops.sort((a, b) => (a.tier - b.tier) || (b.elo - a.elo));

  // Apply the user's saved ordering (if any): listed keys keep their index,
  // unlisted keys follow in default order.
  const order = settings.relayOrder ?? [];
  if (order.length > 0) {
    const idx = (k: string) => {
      const i = order.indexOf(k);
      return i === -1 ? order.length + hops.findIndex((h) => h.key === k) : i;
    };
    hops.sort((a, b) => idx(a.key) - idx(b.key));
  }

  // The built-in engine is the unconditional last resort.
  hops.push(AUTO_HOP);
  return hops;
}

/**
 * Wire hops for a request whose primary is `primary`. The primary itself is
 * excluded (it is tried first via the request's own baseUrl/model) and the
 * chain is capped at MAX_RELAY_HOPS.
 */
export function buildRelayWire(
  settings: Settings,
  primary?: { providerId?: string; model?: string }
): RelayWireHop[] {
  if (settings.relayEnabled === false) return [];
  const excludeKey =
    primary?.providerId && primary?.model
      ? hopKey(primary.providerId, primary.model)
      : undefined;
  const excludeAuto = primary?.providerId === "auto";
  return buildRelayChain(settings)
    .filter((h) => h.key !== excludeKey && !(excludeAuto && h.providerId === "auto"))
    .slice(0, MAX_RELAY_HOPS)
    .map((h) => ({
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
