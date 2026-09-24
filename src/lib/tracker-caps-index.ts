// ─── r46: capability index for model pickers (client-side) ───────────────────
// The tracker mirror (praison-tracker-cache) already holds every synced row's
// meta.caps — the pickers read THAT (instant, offline-safe) instead of hitting
// /api/tracker. Keys are "providerId::modelId", the exact convention picker
// options already use, so lookups are strict exact-match: a lane the tracker
// never saw shows NO capability info rather than a guessed value.

import { TRACKER_CACHE_KEY, type ModelCaps } from "./tracker-types";

export type CapsIndex = Record<string, ModelCaps>;

/** Pure: parse a raw localStorage payload into a caps index (garbage → {}). */
export function parseCapsIndex(raw: string | null): CapsIndex {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { tracked?: { id?: unknown; meta?: unknown }[] };
    const out: CapsIndex = {};
    for (const row of parsed.tracked ?? []) {
      if (typeof row?.id !== "string" || !row.id) continue;
      const caps = (row.meta as Record<string, unknown> | null)?.caps;
      if (!caps || typeof caps !== "object") continue;
      const c = caps as Record<string, unknown>;
      const bool = (v: unknown) => v === true;
      out[row.id] = { tools: bool(c.tools), structured: bool(c.structured), reasoning: bool(c.reasoning), vision: bool(c.vision) };
    }
    return out;
  } catch {
    return {};
  }
}

/** Read the mirror into an index (client only — best-effort, never throws). */
export function loadCapsIndex(): CapsIndex {
  try {
    return parseCapsIndex(localStorage.getItem(TRACKER_CACHE_KEY));
  } catch {
    return {};
  }
}

/** Strict exact-key lookup — null when the tracker has no data for this lane. */
export function capsForModel(index: CapsIndex, modelKey: string): ModelCaps | null {
  if (!modelKey) return null;
  // Auto/builtin/default pseudo-ids never have caps.
  if (modelKey === "default" || modelKey === "auto::builtin") return null;
  return index[modelKey] ?? null;
}

/**
 * True ONLY when the catalog data positively says this lane lacks tool
 * calling. Unknown lanes (no caps) → false — never a false accusation.
 */
export function laneLacksTools(index: CapsIndex, modelKey: string): boolean {
  const c = capsForModel(index, modelKey);
  return c !== null && !c.tools;
}

/**
 * The honest warning text for "agent with tools × lane without tool calling",
 * or null when there is nothing to warn about (no tools, unknown lane, or
 * lane declares tools).
 */
export function toolWarningFor(index: CapsIndex, modelKey: string, hasTools: boolean): string | null {
  if (!hasTools) return null;
  if (!laneLacksTools(index, modelKey)) return null;
  const label = modelKey.split("::").slice(1).join("::") || modelKey;
  return `${label}'s catalog does not declare tool calling — this agent's tools may fail on this lane.`;
}
