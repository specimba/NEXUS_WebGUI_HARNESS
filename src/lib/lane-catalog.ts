"use client";

// ─── r503: Lane catalog — the quality-marked picker pool ─────────────────────
// Owner directive: "at workflows it is better when we can able to select
// providers and models with their responsive quality marks of usage trust
// etc." The pool is the relay chain itself (buildRelayChain) — one truth, no
// parallel universe: every dialable hop (doctrine catalog, live rosters,
// no-key free lanes, radar-adopted lanes) appears here with its LIVE marks:
//
//   • QUALITY  — Generation-Era tier (Frontier/Modern/Legacy) + arena Elo
//   • TRUST    — the rotator's health memory per hop (ok N / sick / throttled
//                / blocked / demoted), same source the rotation actually uses
//   • USAGE    — dial counts (answered N× / failed N×)
//   • COST     — free/paid flag (note text + no-key registry membership)
//   • FRESHNESS— radar-adopted lanes carry "first seen Xh ago"
//
// Consumers: the workflow editor's pipeline-default + per-step lane pickers.

import { buildRelayChain, relayHealthSnapshot, TIER_LABEL, type RelayHealthEntry } from "./relay";
import type { Settings } from "./types";
import type { PickerOption } from "@/components/nexus/model-picker";

export interface LaneCatalog {
  options: PickerOption[];
  /** Health snapshot used to build the marks (callers can re-render on it). */
  health: Record<string, RelayHealthEntry>;
  /** True when the vault offers more than just the built-in engine. */
  keyedLanes: number;
}

/** "providerId::model" → short display "Provider · model" is already on the
 * hop label; this trims a pinned value to its model half for tight chips. */
export function laneShortName(lane?: string): string {
  if (!lane) return "";
  if (lane === "auto::builtin") return "Built-in engine";
  const idx = lane.indexOf("::");
  return idx === -1 ? lane : lane.slice(idx + 2);
}

export function buildLaneCatalog(settings: Settings): LaneCatalog {
  const health = relayHealthSnapshot();
  const hops = buildRelayChain(settings, { taskFit: "any" });
  const options: PickerOption[] = [];

  for (const hop of hops) {
    const entry = health[hop.key];
    const isAuto = hop.providerId === "auto";
    // Cost flag: free when the note says so ($0 / free / no-key) — the same
    // honest text the relay row shows; no separate price universe.
    const free = isAuto || /free|\$0/i.test(hop.note ?? "");
    // Trust/usage marks straight from the rotator's memory.
    let badge: string | undefined;
    let badgeTone: PickerOption["badgeTone"];
    if (entry && (entry.ok > 0 || entry.fail > 0)) {
      if (entry.dead && entry.lastFailAt && Date.now() - entry.lastFailAt < 6 * 3600_000) {
        badge = "blocked";
        badgeTone = "amber";
      } else if (entry.lastFailAt && Date.now() - entry.lastFailAt < 5 * 60_000 && !entry.soft) {
        badge = "sick";
        badgeTone = "amber";
      } else if (entry.lastFailAt && Date.now() - entry.lastFailAt < 5 * 60_000 && entry.soft) {
        badge = "throttled";
        badgeTone = "muted";
      } else {
        badge = `ok ${entry.ok}×`;
        badgeTone = "emerald";
      }
    } else if (free) {
      badge = "free";
      badgeTone = "emerald";
    }
    // Never-dialed paid lanes: show the tier as the badge instead of nothing.
    if (!badge && !isAuto) {
      badge = `T${hop.tier} ${TIER_LABEL[hop.tier]}`;
      badgeTone = hop.tier === 1 ? "violet" : "muted";
    }
    const usage = entry
      ? `usage: ${entry.ok} answered · ${entry.fail} failed`
      : "usage: never dialed yet";
    const trust = entry?.lastError ? ` · last error: ${entry.lastError.slice(0, 80)}` : "";
    options.push({
      id: hop.key,
      label: hop.label,
      note: `${TIER_LABEL[hop.tier]} · Elo ${hop.elo.toFixed(2)} · ${usage}${trust}`,
      group: isAuto ? "Fallback" : hop.label.split(" · ")[0] || hop.providerId,
      badge,
      badgeTone,
      keywords: [hop.providerId, hop.model, hop.tier === 1 ? "frontier" : "modern", free ? "free" : "paid", ...(isAuto ? ["auto", "builtin"] : [])],
    });
  }

  const keyedLanes = options.filter((o) => o.group !== "Fallback").length;
  return { options, health, keyedLanes };
}
