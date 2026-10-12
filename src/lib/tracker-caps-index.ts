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
  activePid?: string | null,
  hints?: LaneDisclosureHints
): AgentLaneSummary {
  const lane = agentLaneKey(agent.model, activePid);
  const laneLabel = lane.split("::").slice(1).join("::") || lane || "auto";
  const hasTools = Array.isArray(agent.tools) && agent.tools.length > 0;
  // r48 key-awareness: when the caller supplies runtime hints, a lane the
  // resolver would NOT actually run (built-in profile, keyless provider,
  // unconfigured custom endpoint) is dormant — it rides Auto, so capability
  // warnings would be false alarms. Dormant → silence, per doctrine.
  if (hints) {
    const d = laneDisclosure(index, agent.model, { activePid, ...hints });
    if (d.state !== "provider") {
      return { lane: "auto", laneLabel: "auto", caps: null, hasTools, lacksTools: false, warning: null };
    }
    const caps = d.caps;
    const lacksTools = caps !== null && !caps.tools;
    const warning =
      hasTools && lacksTools
        ? `${agent.name}'s lane (${d.lane.split("::").slice(1).join("::") || d.lane}) does not declare tool calling — this step's tool calls may fail.`
        : null;
    return { lane: d.lane, laneLabel: d.lane.split("::").slice(1).join("::") || d.lane, caps, hasTools, lacksTools, warning };
  }
  const caps = capsForModel(index, lane);
  const lacksTools = caps !== null && !caps.tools;
  const warning =
    hasTools && lacksTools
      ? `${agent.name}'s lane (${laneLabel}) does not declare tool calling — this step's tool calls may fail.`
      : null;
  return { lane, laneLabel, caps, hasTools, lacksTools, warning };
}

// ─── r48: effective-lane disclosure (agent form + runtime-faithful UI) ──────
// The pickers group options by provider CATALOG, but resolveLlm semantics mean
// a bare model id rides the ACTIVE provider — and a keyless one rides Auto.
// One pure function derives the honest "what will actually run" answer.

export interface LaneDisclosureHints {
  /** The active provider id from settings (activeProviderId semantics). */
  activePid?: string | null;
  /**
   * pid -> key-ready map for registry providers (providerReady semantics:
   * noKey providers are always ready; others need a saved key). Absent = not
   * ready. Pure input so tests never touch a store.
   */
  ready: Record<string, boolean>;
  /** Host label of the legacy custom endpoint when one is configured. */
  customHost?: string | null;
}

export type LaneDisclosureState = "builtin" | "dormant" | "provider";

export interface LaneDisclosure {
  /**
   * The lane the resolver will actually use: the agentLaneKey value when a
   * provider lane really runs, or "auto" when the model is dormant.
   */
  lane: string;
  /** builtin = the Auto lane itself; dormant = model parked on Auto; provider = a real catalog lane. */
  state: LaneDisclosureState;
  /** Why the model is parked on Auto (null outside the dormant state). */
  dormantReason: "no-profile" | "no-key" | "no-endpoint" | null;
  /** Resolved provider id for the provider state ("custom" for the legacy endpoint). */
  providerId: string | null;
  /** The model id half of the lane. */
  modelId: string;
  /** Caps of the lane that runs (null = unknown → silence; dormant lanes never warn). */
  caps: ModelCaps | null;
  /**
   * Other held catalogs that publish this model id, excluding the running
   * provider — positive mismatch evidence only (an id in no catalog stays
   * silent). Provider ids, deduped; caller resolves display names.
   */
  otherPublishers: string[];
}

const builtinDisclosure = (modelId: string): LaneDisclosure => ({
  lane: "auto",
  state: "builtin",
  dormantReason: null,
  providerId: null,
  modelId,
  caps: null,
  otherPublishers: [],
});

const dormantDisclosure = (modelId: string, reason: NonNullable<LaneDisclosure["dormantReason"]>): LaneDisclosure => ({
  lane: "auto",
  state: "dormant",
  dormantReason: reason,
  providerId: null,
  modelId,
  caps: null,
  otherPublishers: [],
});

/**
 * Pure, runtime-faithful: what will this agent's model ACTUALLY resolve to?
 * Mirrors resolveLlm (bare id × active provider; keyless → Auto with a note;
 * custom endpoint needs a baseUrl) and resolveExplicitLlm ("::"-carrying
 * values are absolute lanes with the same honest fallbacks). Never throws,
 * never guesses: an id absent from every held catalog produces no mismatch
 * evidence, and dormant lanes carry no caps at all.
 */
export function laneDisclosure(
  index: CapsIndex,
  model: unknown,
  hints: LaneDisclosureHints,
  publishers: Record<string, string[]> = {}
): LaneDisclosure {
  const m = typeof model === "string" ? model.trim() : "";
  if (!m || m === "auto") return builtinDisclosure("auto");

  const others = (id: string, pid: string): string[] => {
    const list = publishers[id];
    if (!Array.isArray(list)) return [];
    return list.filter((p, i) => typeof p === "string" && p && p !== pid && list.indexOf(p) === i);
  };

  // Absolute lane (composer-override convention) — resolves on its OWN
  // provider, with the resolver's honest fallbacks when it cannot.
  if (m.includes("::")) {
    const pid = m.split("::")[0];
    const modelId = m.split("::").slice(1).join("::");
    if (!modelId) return builtinDisclosure(m);
    if (pid === "auto") return builtinDisclosure(modelId);
    if (pid === "custom") {
      if (hints.customHost) {
        return {
          lane: m,
          state: "provider",
          dormantReason: null,
          providerId: "custom",
          modelId,
          caps: capsForModel(index, m),
          otherPublishers: [],
        };
      }
      return dormantDisclosure(modelId, "no-endpoint");
    }
    if (hints.ready[pid]) {
      return {
        lane: m,
        state: "provider",
        dormantReason: null,
        providerId: pid,
        modelId,
        caps: capsForModel(index, m),
        otherPublishers: others(modelId, pid),
      };
    }
    return dormantDisclosure(modelId, "no-key");
  }

  // Bare id — rides the ACTIVE provider (resolveLlm semantics).
  const pid = hints.activePid?.trim() || "";
  if (!pid || pid === "auto") return dormantDisclosure(m, "no-profile");
  if (pid === "custom") {
    if (hints.customHost) {
      return {
        lane: `custom::${m}`,
        state: "provider",
        dormantReason: null,
        providerId: "custom",
        modelId: m,
        caps: capsForModel(index, `custom::${m}`),
        otherPublishers: [],
      };
    }
    return dormantDisclosure(m, "no-endpoint");
  }
  if (hints.ready[pid]) {
    return {
      lane: `${pid}::${m}`,
      state: "provider",
      dormantReason: null,
      providerId: pid,
      modelId: m,
      caps: capsForModel(index, `${pid}::${m}`),
      otherPublishers: others(m, pid),
    };
  }
  return dormantDisclosure(m, "no-key");
}
