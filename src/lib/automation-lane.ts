// ─── r205: server-lane truth helpers (Local Automation Vault epic) ───────────
// The r204 executor made the closed-tab lane real — and made two older
// surfaces lie by omission: the sync GET reported the vault's builtin slot
// (which the executor SKIPS), and a >24h-overdue registry row looked like a
// healthy tab-driven countdown. These pure helpers centralize the honest
// reading so the sync route, the ServerAutopilot panel, and the QA share
// one definition of "what would the executor actually do right now".

export type ExecutorLaneReason =
  | "no-vault-key"
  | "no-resolvable-provider"
  | "billing-quarantined";

export interface ExecutorLaneState {
  /** True when a due closed-tab run would dial immediately. */
  ready: boolean;
  reason: ExecutorLaneReason | null;
  /** Registry provider name (e.g. "Vyce AI") when ready. */
  providerLabel: string | null;
  /** Masked preview of the vault slot the executor would dial
   *  (r207: the first RESOLVABLE slot, not blindly the oldest). */
  maskedKey: string | null;
  /** Vault provider id of that slot ("builtin" only appears when it is
   *  the whole story — r207 skips it in favor of a resolvable sibling). */
  slotProvider: string | null;
  /** r207: total vault slots the executor scanned (drives plural copy). */
  slotCount: number;
}

export const STALE_REGISTRY_MS = 24 * 60 * 60 * 1000;

export interface StaleRegistryInput {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAt: string | null;
}

/**
 * Enabled registry rows overdue >24h that NO lane is demonstrably driving.
 *
 * The trap this encodes (seen live 2026-09-30): the DB registry's nextRunAt
 * only advances when the SERVER lane claims a run — while the tab drives,
 * it freezes in the past even for healthy schedules. So "overdue" alone is
 * normal; the row is stale only when the tab lane ALSO has no future fire
 * scheduled for the same workflow id (localNextByWf), i.e. neither lane
 * will claim it. That is exactly the r204 QA-incident shape: months-old
 * enabled rows piling up due while nothing anywhere claimed them.
 */
export function computeStaleRegistry(
  rows: StaleRegistryInput[],
  localNextByWf: Map<string, string>,
  now: number,
  staleMs: number = STALE_REGISTRY_MS,
): StaleRegistryInput[] {
  return rows.filter((r) => {
    if (!r.enabled || !r.nextRunAt) return false;
    const due = new Date(r.nextRunAt).getTime();
    if (!Number.isFinite(due) || now - due < staleMs) return false;
    const local = localNextByWf.get(r.id);
    if (!local) return true;
    const localDue = new Date(local).getTime();
    return !(Number.isFinite(localDue) && localDue > now);
  });
}

/** Human sentence for the panel's due-but-blocked strip. */
export function humanizeLaneReason(reason: ExecutorLaneReason): string {
  return reason === "no-vault-key"
    ? "no vault key is stored"
    : reason === "billing-quarantined"
      ? "every stored vault slot's provider is billing-quarantined (wallet drained — the r332 rotation memory); runs wait rather than dial a known-dead lane, and the quarantine lifts on a successful dial after a top-up"
      : "no stored vault slot pairs with a registry provider endpoint (the built-in engine slot's gateway is client-side knowledge, and it is skipped, never guessed)";
}

// ─── r210: vault-slot dial truth (card ⇄ executor parity) ───────────────────
// Since r207 the executor dials the OLDEST RESOLVABLE slot — slot age became
// functionally meaningful, so the vault card must show it. The pure helpers
// live here so the card and the QA share one definition of "which slot would
// the executor dial first" (mirrors resolveServerDialFromSlots, no drift).

export interface SlotDialInfo {
  provider: string;
  /** Masked preview — presence implies a stored key (POST enforces non-empty). */
  maskedKey?: string | null;
  createdAt: string;
}

/**
 * The slot the executor would dial first: oldest createdAt among slots that
 * have a key AND pass the caller's resolvability check (provider pairs with
 * a registry endpoint). Null when no slot qualifies. `isResolvable` is
 * injected so this module stays pure (the card wires providerById; QA wires
 * fixture booleans).
 */
export function pickExecutorSlot<T extends SlotDialInfo>(
  slots: T[],
  isResolvable: (provider: string) => boolean,
): T | null {
  const ordered = [...slots].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  for (const slot of ordered) {
    if (!slot.maskedKey) continue; // empty slot: skip, keep scanning
    if (!isResolvable(slot.provider)) continue; // builtin/unknown: skipped, not fatal
    return slot;
  }
  return null;
}

/** Compact honest age for a vault slot ("just now" / "5m ago" / "3h ago" / "2d ago"). */
export function fmtSlotAge(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
