// ─── One-time localStorage rebrand migration (praison → nexus) ───────────────
// The platform rebranded from PraisonAI to NEXUS WebGUI and every persistence
// key moved to the `nexus-` / `nexus.` prefix. This module runs ONCE on import
// (it is the first import of stores.ts and run-archive.ts, so it executes
// before any persist hydration or archive read) and copies legacy keys to
// their new names so existing agents, chats, workflows, settings, vault and
// radar caches survive the rename.
//
// Safety doctrine:
// - Idempotent: guarded by the `nexus-migrated-from-praison-v1` flag key.
// - Non-destructive: legacy keys are NEVER deleted (rollback safety), and a
//   value is copied only when the new key does not already exist.
// - Failure-isolated: per-key try/catch (a quota error on one key must never
//   abort the loop) and the whole body is guarded so storage failures never
//   break boot.

const MIGRATION_FLAG = "nexus-migrated-from-praison-v1";

/** Prefix rule: `praisonai.X` → `nexus.X`, `praison-X` → `nexus-X`. */
function nexusKey(legacy: string): string | null {
  if (legacy.startsWith("praisonai.")) return "nexus." + legacy.slice("praisonai.".length);
  if (legacy.startsWith("praison-")) return "nexus-" + legacy.slice("praison-".length);
  return null;
}

function migrateLegacyStorage(): void {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem(MIGRATION_FLAG)) return;

    // Snapshot matching keys first — the loop below writes new entries and
    // must not iterate a mutating key collection.
    const legacy: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith("praison-") || k.startsWith("praisonai."))) legacy.push(k);
      }
    } catch {
      return; // storage unreadable — nothing to migrate, boot must proceed
    }

    let migrated = 0;
    for (const k of legacy) {
      const next = nexusKey(k);
      if (!next) continue;
      try {
        const value = localStorage.getItem(k);
        if (value == null) continue;
        if (localStorage.getItem(next) == null) {
          localStorage.setItem(next, value);
          migrated++;
        }
      } catch {
        // quota / private-mode failure on one key — keep going
      }
    }

    try {
      localStorage.setItem(MIGRATION_FLAG, new Date().toISOString());
    } catch {
      // Flag not persisted: the migration is copy-only, so a re-run is
      // harmless (existing new-key values are never overwritten).
    }
    if (migrated > 0) {
      console.info(`[nexus] migrated ${migrated} legacy storage key(s)`);
    }
  } catch {
    // Whole-body guard — storage failures never break boot.
  }
}

migrateLegacyStorage();
