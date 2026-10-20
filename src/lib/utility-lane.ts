// ─── Utility fast-lane routing (r506 owner directive) ────────────────────────
// "AI upgraded default usage buttons also backup substitutions smartly emergent
// for fast responses … for that kind of small edits and planning parts
// automation smarter and usefully faster than trying to select default largest
// and highest parameter reasoning alternative … fast and above moderate
// planning reasoning smartness … with knowledge of what exactly wanted from it."
//
// The AI utility buttons (plan generation, auto-assign, memory consolidation)
// used to dial the GLOBAL primary verbatim — the largest reasoning model in the
// vault — with NO relay ladder. One degraded flagship (Vyce-class silent hang)
// and the button dead-ends ("Couldn't generate a plan, add steps manually").
//
// Doctrine now: utility tasks are SMALL and one-shot → they dial a FAST,
// above-moderate lane (free flash-class first), carry their own short
// first-token budget, and ride a substitution ladder so a sick lane is replaced
// mid-flight ("backup substitutions smartly emergent"). Ladder outcomes feed
// the same health memory + provider breaker every other dial uses, so the
// substitution pool self-heals. UTILITY_SYSTEM_SUFFIX carries the "knowledge of
// what exactly wanted from it" — task-shape awareness in the prompt itself.

import {
  buildRelayChain,
  buildRelayWire,
  hopIsFree,
  laneRecentlyFailed,
  hopBreakerDocked,
  relayHealthSnapshot,
  type RelayHop,
  type RelayWireHop,
} from "./relay";
import { providerBreakerSnapshot } from "./provider-breaker";
import { resolveLlm, type ResolvedLlm } from "./llm-config";
import type { Settings } from "./types";

/**
 * First-token budget for a utility dial. A small planning/edit task must show
 * life within 30s or the hop is a corpse — rotate (engine honors the explicit
 * budget; r505 silence doctrine rotates instead of re-dialing the same lane).
 */
export const UTILITY_FAST_BUDGET_MS = 30_000;

/**
 * Wider than the relay's task-fit FAST_RE: utility work wants snappy
 * above-moderate brains — flash/mini/turbo classes of every era qualify.
 */
const UTILITY_FAST_RE =
  /flash|mini|lite|fast|turbo|lightning|instant|small|nano|air|haiku|8b|12b|20b|bonsai|compound/i;

/** How many keyed substitution hops ride behind the utility primary. */
const UTILITY_BACKUPS = 2;

/**
 * Appended to every utility system prompt — the model is told the TASK SHAPE
 * (small, fast, exactly-specified) so a mid-tier lane performs like a briefed
 * specialist instead of an under-powered generalist.
 */
export const UTILITY_SYSTEM_SUFFIX =
  "\n\nUtility-task doctrine: this is a small, fast, well-specified subtask " +
  "(a plan, an assignment, or a compact edit) — not a deep research pass. " +
  "Do exactly what is asked, nothing more: keep any reasoning internal and " +
  "brief, never call tools, never ask follow-up questions, and output ONLY " +
  "the requested artifact in the requested format.";

export interface UtilityWire {
  /** The lane the button dials first. */
  primary: ResolvedLlm;
  /** Substitution ladder (keyed fast backups + built-in engine last). */
  relay: RelayWireHop[];
  /** Human-readable dial order for the settings preview. */
  preview: string;
  /** True when the fast-lane profile actually shaped this wire. */
  fast: boolean;
}

/**
 * Build the utility-task wire for the current vault.
 *
 * - `relayEnabled === false` → the user disabled the relay; the global primary
 *   dials bare (their explicit choice, honored everywhere).
 * - `utilityFastLane === false` → legacy behavior: global primary + standard
 *   decision-fit ladder (fast-LEANING, but the primary still leads).
 * - Default (undefined/on): rank the health-filtered chain by the utility
 *   profile — free fast → paid fast → rest (the chain's dock/failed/policy
 *   sorting is inherited; corpse rungs are filtered OUT entirely, a one-shot
 *   button never pays a 30s silent window on a known corpse). When the global
 *   primary is the built-in engine, it stays primary and fast lanes become the
 *   substitutions — the user's engine choice is respected, not overridden.
 */
export function buildUtilityWire(settings: Settings): UtilityWire {
  const base = resolveLlm(settings, "auto");

  if (settings.relayEnabled === false) {
    return {
      primary: base,
      relay: [],
      preview: `${base.label} — relay is off`,
      fast: false,
    };
  }

  if (settings.utilityFastLane === false) {
    const relay = buildRelayWire(
      settings,
      { providerId: base.providerId, model: base.model },
      { taskFit: "decision" }
    );
    return {
      primary: base,
      relay,
      preview: `${base.label} → ${relay.length} ladder hop${relay.length === 1 ? "" : "s"} (standard)`,
      fast: false,
    };
  }

  const chain = buildRelayChain(settings, { taskFit: "decision" });
  const health = relayHealthSnapshot();
  const breaker = providerBreakerSnapshot();
  const usable = chain.filter(
    (h) =>
      h.providerId === "auto" ||
      (!hopBreakerDocked(h, breaker, health) && !laneRecentlyFailed(health[h.key]))
  );
  const keyed = usable.filter((h) => h.providerId !== "auto");
  const isFast = (h: RelayHop) => UTILITY_FAST_RE.test(`${h.model} ${h.note ?? ""}`);
  const fastFree = keyed.filter((h) => isFast(h) && hopIsFree(h));
  const fastPaid = keyed.filter((h) => isFast(h) && !hopIsFree(h));
  const rest = keyed.filter((h) => !isFast(h));
  const ranked = [...fastFree, ...fastPaid, ...rest];

  // Built-in engine primary: keep it (zero-config promise), fast keyed lanes
  // ride as substitutions — same "backup substitutions emerge" contract.
  if (base.provider === "auto") {
    const subs = ranked.slice(0, UTILITY_BACKUPS);
    return {
      primary: base,
      relay: subs.map(toWireHop),
      preview:
        subs.length > 0
          ? `${base.label} → ${subs.map((h) => h.label).join(" → ")}`
          : `${base.label} — no keyed fast lane to substitute`,
      fast: subs.length > 0,
    };
  }

  if (ranked.length === 0) {
    // No fast lane anywhere (vault empty / all docked) — legacy wire with the
    // standard decision ladder; honest preview says why.
    const relay = buildRelayWire(
      settings,
      { providerId: base.providerId, model: base.model },
      { taskFit: "decision" }
    );
    return {
      primary: base,
      relay,
      preview: `${base.label} → ${relay.length} ladder hops — no fast lane available`,
      fast: false,
    };
  }

  const [head, ...backups] = ranked;
  const primary: ResolvedLlm = {
    provider: "custom",
    apiKey: head.apiKey,
    baseUrl: head.baseUrl,
    model: head.model,
    label: head.label,
    providerId: head.providerId,
  };
  const relay: RelayWireHop[] = [
    ...backups.slice(0, UTILITY_BACKUPS).map(toWireHop),
    { model: "auto", label: "Built-in engine", useAuto: true },
  ];
  return {
    primary,
    relay,
    preview: [head.label, ...backups.slice(0, UTILITY_BACKUPS).map((h) => h.label), "Built-in engine"].join(" → "),
    fast: true,
  };
}

function toWireHop(h: RelayHop): RelayWireHop {
  return {
    key: h.key,
    ...(h.baseUrl ? { baseUrl: h.baseUrl } : {}),
    ...(h.apiKey ? { apiKey: h.apiKey } : {}),
    model: h.model,
    label: h.label,
  };
}
