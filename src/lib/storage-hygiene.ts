// ─── Storage hygiene: cache compaction ───────────────────────────────────────
// r800: the Owner's profile sat at 4.81/5.00 MB — one save away from quota
// errors. The r414/r455 ladders already cap the budgeted stores (chats,
// workflows) on write; what nothing reclaimed were the REFILLABLE caches:
// radar/ticker fetches, the intel ladder index, the free-catalog index. All
// of them rehydrate from their APIs on the next visit, so clearing them is
// zero-data-loss — never touches chats, workflows, settings, UI state, or
// the provider vault. Compaction is disclosed per-key, measured in the same
// UTF-16 characters the quota budgeted (the meter's unit, not bytes).

export interface CompactKeyStat {
  key: string;
  chars: number;
}

export interface CompactResult {
  beforeChars: number;
  afterChars: number;
  freedChars: number;
  cleared: CompactKeyStat[];
}

// Only keys with an unambiguous refetch path belong here. nexus-relay-adopted
// is deliberately NOT in this set: adopted lanes are a user decision, not a
// cache. nexus-relay-health stays too: its consumer's tolerance for a
// truncated tail is unverified, and honesty beats optimism.
export const COMPACTABLE_CACHE_KEYS: readonly string[] = [
  "nexus-tracker-cache",
  "nexus-radar-hf",
  "nexus-radar-arxiv",
  "nexus-radar-gh",
  "nexus-intelligence-index",
  "nexus-freellm-index",
  "nexus-free-catalog",
  "nexus-free-catalog-at",
];

// 92% of the ~5 MB per-origin character budget the quota errors actually hit.
export const AUTO_COMPACT_THRESHOLD_CHARS = 4_600_000;

function measureOriginChars(): number {
  let total = 0;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key == null) continue;
    total += key.length + (window.localStorage.getItem(key)?.length ?? 0);
  }
  return total;
}

/** Clear the refillable cache keys; returns the honest per-key delta. */
export function compactNexusStorage(): CompactResult {
  const beforeChars = measureOriginChars();
  const cleared: CompactKeyStat[] = [];
  if (typeof window === "undefined" || !window.localStorage) {
    return { beforeChars, afterChars: beforeChars, freedChars: 0, cleared };
  }
  for (const key of COMPACTABLE_CACHE_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (raw == null) continue;
    try {
      window.localStorage.removeItem(key);
      cleared.push({ key, chars: key.length + raw.length });
    } catch {
      // Private-mode / quota-poisoned removes: record nothing, keep going —
      // the next save attempt is the real test and the meter re-measures it.
    }
  }
  const afterChars = measureOriginChars();
  return {
    beforeChars,
    afterChars,
    freedChars: Math.max(0, beforeChars - afterChars),
    cleared,
  };
}

/**
 * Boot-time pressure responder: compacts ONLY above the threshold, at most
 * once per boot, and returns null (a no-op) under it. Callers own the toast.
 */
export function maybeAutoCompact(): CompactResult | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  let total = 0;
  try {
    total = measureOriginChars();
  } catch {
    return null;
  }
  if (total < AUTO_COMPACT_THRESHOLD_CHARS) return null;
  return compactNexusStorage();
}
