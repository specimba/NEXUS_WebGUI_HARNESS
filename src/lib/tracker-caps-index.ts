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
  // Auto/builtin/default pseudo-ids never have caps — "auto" is the built-in
  // GLM lane id (AUTO_MODEL.id), guarded explicitly rather than by luck.
  if (modelKey === "default" || modelKey === "auto" || modelKey === "auto::builtin") return null;
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

// ─── r47: agent-level lane summary (workflow steps + suite agent pickers) ────
// Workflow steps and suite bake-off lanes reference AGENTS; each agent's own
// model lane decides whether its attached tools can actually run. One pure
// function computes everything the UI needs — structural input, no store
// import, so it stays testable in isolation.

/** Minimal agent shape the summary needs (structural — decoupled from stores). */
export interface AgentLaneInput {
  name: string;
  model: string;
  tools: unknown;
}

export interface AgentLaneSummary {
  /** Lane key exactly as stored ("auto" for the built-in lane). */
  lane: string;
  /** Human-readable lane label ("openrouter::x/y" → "x/y", "auto" → "auto"). */
  laneLabel: string;
  caps: ModelCaps | null;
  /** True only when the agent carries at least one tool. */
  hasTools: boolean;
  /** True ONLY when caps exist and declare no tool calling (unknown ≠ no). */
  lacksTools: boolean;
  /** Honest warning or null (no tools / unknown lane / lane declares tools). */
  warning: string | null;
}

/**
 * r47: the lane an agent's saved model ACTUALLY resolves to at runtime.
 * The runners call resolveLlm(settings, agent.model): a bare model id runs
 * on the ACTIVE provider, "auto" (or a bare id while the built-in engine is
 * active) rides the built-in lane, and a value that already carries
 * "provider::" is an absolute lane key (composer-override convention).
 * Pure — garbage in, honest "auto" out.
 */
export function agentLaneKey(agentModel: unknown, activePid?: string | null): string {
  const m = typeof agentModel === "string" ? agentModel.trim() : "";
  if (!m || m === "auto") return "auto";
  if (m.includes("::")) return m;
  const pid = activePid?.trim();
  if (!pid || pid === "auto") return "auto";
  return `${pid}::${m}`;
}

/** Pure: everything the workflow/suite UI needs about one agent's lane. */
export function agentLaneSummary(
  index: CapsIndex,
  agent: AgentLaneInput,
  activePid?: string | null
): AgentLaneSummary {
  const lane = agentLaneKey(agent.model, activePid);
  const laneLabel = lane.split("::").slice(1).join("::") || lane || "auto";
  const caps = capsForModel(index, lane);
  const hasTools = Array.isArray(agent.tools) && agent.tools.length > 0;
  const lacksTools = caps !== null && !caps.tools;
  const warning =
    hasTools && lacksTools
      ? `${agent.name}'s lane (${laneLabel}) does not declare tool calling — this step's tool calls may fail.`
      : null;
  return { lane, laneLabel, caps, hasTools, lacksTools, warning };
}
