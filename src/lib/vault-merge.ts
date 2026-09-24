/**
 * r41-c — Provider-vault import math (pure, unit-tested).
 *
 * The advisory pack (r41) delivered `praison-provider-vault.json` — a
 * `{kind, exportedAt, providerKeys, activeProviderId, defaultModel, provider}`
 * slice whose 17 real keys could not arm a profile because the Settings
 * importer only accepted full exports (agents/conversations/workflows arrays)
 * and merged `settings` SHALLOWLY, wholesale-overwriting the local vault.
 *
 * Doctrine (BYOK paranoia): an import may FILL empty local keys, may adopt
 * identical keys harmlessly, but must NEVER silently overwrite a locally-set
 * key. Conflicts are reported, not resolved in secret.
 */

import type { ProviderKeyEntry } from "./types";

export interface VaultMergeResult {
  /** The merged vault map (new object; inputs never mutated). */
  merged: Record<string, ProviderKeyEntry>;
  /** Ids adopted from the incoming vault (local key was missing or empty). */
  added: string[];
  /** Ids already present locally — identical value, nothing changed. */
  same: string[];
  /** Ids where local and incoming DIFFER — local kept, incoming reported. */
  conflicts: string[];
  /** Incoming entries with an empty/missing key material — ignored. */
  skipped: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A vault-shaped file: kind marker OR providerKeys object without app arrays. */
export function looksLikeProviderVault(parsed: unknown): boolean {
  if (!isRecord(parsed)) return false;
  if (parsed.kind === "praison-provider-vault") return true;
  return isRecord(parsed.providerKeys) && !Array.isArray(parsed.agents);
}

/** A full app export: the three arrays the classic importer requires. */
export function looksLikeFullExport(parsed: unknown): boolean {
  if (!isRecord(parsed)) return false;
  return (
    Array.isArray(parsed.agents) &&
    Array.isArray(parsed.conversations) &&
    Array.isArray(parsed.workflows)
  );
}

/**
 * Honest one-line summary of a merge result — shared by every vault-import
 * entry point (provider-gallery Restore + Settings → Your Data import) so
 * the user sees the same truth regardless of which door they used.
 */
export function describeMergeResult(r: VaultMergeResult): string {
  const parts: string[] = [];
  if (r.added.length) parts.push(`${r.added.length} key${r.added.length === 1 ? "" : "s"} armed`);
  if (r.same.length) parts.push(`${r.same.length} already set`);
  if (r.conflicts.length) {
    const ids = r.conflicts.slice(0, 3).join(", ");
    parts.push(
      `${r.conflicts.length} kept local (differing: ${ids}${r.conflicts.length > 3 ? "…" : ""})`
    );
  }
  if (r.skipped.length) parts.push(`${r.skipped.length} skipped (empty)`);
  return parts.length ? parts.join(" · ") : "nothing to change";
}

/**
 * Merge an incoming vault over the local one. Fill-empty, never overwrite:
 * identical keys count as `same`, differing keys keep the LOCAL value and
 * surface as `conflicts` so the UI can tell the user exactly what stayed.
 */
export function mergeProviderKeys(
  local: Record<string, ProviderKeyEntry> | undefined,
  incoming: unknown
): VaultMergeResult {
  const base: Record<string, ProviderKeyEntry> = {};
  for (const [id, entry] of Object.entries(local ?? {})) {
    if (isRecord(entry)) base[id] = { ...entry } as ProviderKeyEntry;
  }
  const result: VaultMergeResult = {
    merged: base,
    added: [],
    same: [],
    conflicts: [],
    skipped: [],
  };
  if (!isRecord(incoming)) return result;

  for (const [id, raw] of Object.entries(incoming)) {
    const entry = isRecord(raw) ? (raw as Partial<ProviderKeyEntry>) : null;
    if (entry === null) continue;
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    if (!key) {
      result.skipped.push(id);
      continue;
    }
    const current = base[id];
    const localKey = typeof current?.key === "string" ? current.key.trim() : "";
    if (!localKey) {
      // Fill-empty: adopt the incoming entry wholesale (key + model/account hints).
      base[id] = { ...(entry as ProviderKeyEntry), key };
      result.added.push(id);
    } else if (localKey === key) {
      // Same key — still top up missing model/account hints the local entry lacks.
      if (current) {
        if (!current.model && entry.model) current.model = entry.model;
        if (!current.accountId && entry.accountId) current.accountId = entry.accountId;
      }
      result.same.push(id);
    } else {
      // Both set and different: BYOK paranoia wins — keep local, report.
      result.conflicts.push(id);
    }
  }
  return result;
}
