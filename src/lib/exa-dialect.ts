// ─── r531 — TASK-102 slice 6: Exa acquisition-lane adapter ───────────────────
// The NEXUS_BOT wave's acquisition requirement: the platform's research lane
// (Radar → Frontier) ingests trends from three free hubs (HF papers, GitHub
// search, arXiv feed). Exa (exa.ai) is the paid NEURAL-search acquisition
// lane: /search speaks its own wire dialect (POST + x-api-key, {query,
// numResults, startPublishedDate} body, results[] rows) and must never be
// force-fit into the OpenAI chat/completions lanes.
//
// This module is the dialect boundary, mirroring src/lib/anthropic-dialect.ts:
//   • exaAuthHeaders — x-api-key auth (NOT Bearer; the redaction choke never
//     touches auth headers, the r524 invariant holds across dialects).
//   • frontierQueryToExaBody — house research intent → /search body (query
//     capped, numResults clamped, 30-day freshness window).
//   • exaResponseToHouse — results[] → house FrontierItem rows (hub "exa",
//     kind inferred from the URL) so the existing dedupe + rule rubric sort
//     consume them unchanged.
//   • exaDialUrl / isExaStyleEndpoint — URL join + endpoint gate (no /v1/v1
//     double-prefix class bugs; qa-anthropic-dialect caught that family in
//     r528 and this module is asserted the same way).
//
// GATING HONESTY (r531, updated r537): the lane is wired in
// /api/radar/frontier. r536 added the vault-slot gate — an "acquisition"
// provider class in the registry + a probeSlotDial guard so the LLM lanes
// can never dial it — and r537 made the route resolve the key VAULT-FIRST
// (an AutomationVault "exa" slot, decrypted server-side) with EXA_API_KEY
// as the machine-secret fallback. Unconfigured ⇒ the lane contributes
// NOTHING (no items, no error row) — the three free hubs stay byte-identical.
//
// The redaction choke (src/lib/redaction.ts) stays dialect-agnostic: it
// deep-walks JSON bodies and masks secret-shaped strings, so the /search
// body rides the same choke the LLM dials use.

import type { FrontierItem } from "./frontier-scout";

// ─── Auth ────────────────────────────────────────────────────────────────────

/** Exa /search auth — x-api-key, never a Bearer literal in the body. */
export function exaAuthHeaders(key: string): Record<string, string> {
  return { "x-api-key": key.trim() };
}

/**
 * r537: the Exa lane's key resolution ORDER, pure so QA can drive it —
 * a vault slot (provider "exa", already decrypted server-side) wins;
 * the EXA_API_KEY machine-secret is the fallback; neither ⇒ "" (the lane
 * stays silent — no items, no error row).
 */
export function exaKeyFromSources(
  vaultSlots: { provider: string; key: string }[] | null,
  envKey: string | undefined,
): string {
  const slot = (vaultSlots ?? []).find((s) => s.provider === "exa" && s.key.trim());
  if (slot) return slot.key.trim();
  return envKey?.trim() ?? "";
}

// ─── Body shaping ────────────────────────────────────────────────────────────

export interface ExaSearchBody {
  query: string;
  numResults: number;
  type: "auto";
  /** "news" is the documented, certain enum value — the frontier's niche
   *  (papers/repos have dedicated free sources already). */
  category: "news";
  /** ISO 8601 freshness floor — present only when a window is requested. */
  startPublishedDate?: string;
}

const QUERY_CAP = 400;

/**
 * Shape the house research intent into an Exa /search body. The query is
 * trimmed and capped (a runaway template must not mint a giant bill),
 * numResults clamped 1–10, and the freshness window is honest ISO.
 */
export function frontierQueryToExaBody(
  query: string,
  opts: { numResults?: number; sinceDays?: number; now?: number } = {}
): ExaSearchBody {
  const q = query.replace(/\s+/g, " ").trim().slice(0, QUERY_CAP);
  const now = opts.now ?? Date.now();
  const sinceDays = opts.sinceDays ?? 30;
  return {
    query: q,
    numResults: Math.max(1, Math.min(10, Math.round(opts.numResults ?? 8))),
    type: "auto",
    category: "news",
    ...(sinceDays > 0
      ? { startPublishedDate: new Date(now - sinceDays * 86_400_000).toISOString() }
      : {}),
  };
}

// ─── URL gate + join ─────────────────────────────────────────────────────────

/** True when the dial base is an Exa-style endpoint (exa.ai or a subdomain). */
export function isExaStyleEndpoint(base: string): boolean {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return host === "exa.ai" || host.endsWith(".exa.ai");
  } catch {
    return false;
  }
}

/** Join a dial base onto /search — trailing slashes collapsed, never doubled. */
export function exaDialUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/search`;
}

// ─── Response parse ──────────────────────────────────────────────────────────

function trim400(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 400 ? `${t.slice(0, 400)}…` : t;
}

function kindOfUrl(url: string): FrontierItem["kind"] {
  return /github\.com/i.test(url) ? "repo" : "paper";
}

/**
 * results[] → house FrontierItem rows. Defensive by doctrine: a garbage
 * payload yields an honest error string, individual junk rows are skipped,
 * and every row rides the SAME shape the three free hubs emit — the
 * downstream dedupe + rubric sort never learns a new dialect.
 */
export function exaResponseToHouse(
  payload: unknown,
  now = Date.now()
): { items: FrontierItem[]; error?: string } {
  if (!payload || typeof payload !== "object") {
    return { items: [], error: "exa: unexpected response shape" };
  }
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    return { items: [], error: "exa: unexpected response shape" };
  }
  const items: FrontierItem[] = [];
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const r = row as {
      url?: unknown;
      title?: unknown;
      text?: unknown;
      author?: unknown;
      publishedDate?: unknown;
    };
    if (typeof r.url !== "string" || !r.url.trim()) continue;
    if (typeof r.title !== "string" || !r.title.trim()) continue;
    const summary = typeof r.text === "string" ? trim400(r.text) : "";
    items.push({
      id: `exa:${r.url.trim()}`,
      kind: kindOfUrl(r.url),
      hub: "exa",
      url: r.url.trim(),
      title: r.title.replace(/\s+/g, " ").trim(),
      summary,
      ...(typeof r.author === "string" && r.author.trim()
        ? { authors: r.author.trim().slice(0, 120) }
        : {}),
      ...(typeof r.publishedDate === "string" && r.publishedDate.trim()
        ? { createdAt: r.publishedDate.trim() }
        : {}),
      fetchedAt: now,
    });
  }
  return { items };
}
