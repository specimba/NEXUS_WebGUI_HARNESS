// ─── Relay health → badge application (r75 consolidation) ────────────────────
// ONE shared implementation of "apply the rotator's verdict to a picker/row
// object". This closure lived copy-pasted in the chat composer and the agent
// form (both splitting "providerId::modelId" by hand); the provider gallery
// had no badges at all. Doctrine (ClawLabs/free-ai-models): catalog presence
// means nothing if the last dials died — every model row shows the rotator's
// LIVE verdict next to its name.
//
// Lives in its own module (NOT lib/relay.ts) so editing it never invalidates
// the rotator core's import graph mid-run — a deliberate HMR-safety choice.

import {
  relayHopBadge,
  type RelayHealthEntry,
} from "@/lib/relay";

/** Any row carrying an optional badge — ModelPicker options and tracker rows
 * both qualify. `badgeTone` stays `string` so caller-side unions (e.g. the
 * gallery's "violet") satisfy the constraint unchanged. */
export interface RelayBadgeCarrier {
  id: string;
  badge?: string;
  badgeTone?: string;
}

/**
 * Apply the rotator's health verdict to an object whose `id` is the rotator's
 * hopKey ("providerId::modelId"). A verdict (`ok N` / `sick` / `throttled`)
 * OVERRIDES the row's static badge — actionable beats decorative (r73
 * doctrine); lanes never dialed keep their existing badge or none.
 * `snapshot` lets callers building many rows pass `relayHealthSnapshot()` ONCE
 * instead of re-reading localStorage per row.
 */
export function withRelayHealth<T extends RelayBadgeCarrier>(
  o: T,
  snapshot?: Record<string, RelayHealthEntry>
): T {
  const sep = o.id.indexOf("::");
  const hb =
    sep > 0
      ? relayHopBadge(o.id.slice(0, sep), o.id.slice(sep + 2), snapshot)
      : undefined;
  return (hb ? { ...o, badge: hb.label, badgeTone: hb.tone } : o) as T;
}
