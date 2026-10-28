/**
 * r689 — the corpus-freshness contract lifted out of run-kanban.tsx
 * (the r684 inline helper), on the r677 precedent: one contract, one home
 * (family-witness.ts did the same for the drift witness). The ⧉ ledger
 * chip's age token reads: <60s "now" · <1h "Nm" · <48h "Nh" · else "Nd".
 * Defensive parse IS the doctrine: a missing or unreadable timestamp is
 * an honest null (the chip renders nothing) — never a fake "now"; a
 * future timestamp (clock skew) clamps to "now" via the max(0, ...).
 */

export function ledgerAgeOf(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "now";
  if (s < 3_600) return `${Math.floor(s / 60)}m`;
  if (s < 172_800) return `${Math.floor(s / 3_600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/**
 * r689: a corpus quiet for an hour or more reads STALE — the age token
 * turns amber so the stall is visible without reading (the r684 slice
 * made the stall legible; this makes it glanceable). Missing or
 * unreadable timestamps are never stale — an honest absence is not an
 * alarm, and a future timestamp (clock skew) is not either.
 */
export function ledgerAgeIsStale(iso: string | undefined | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t >= 3_600_000;
}
