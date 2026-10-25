// r550 — TASK-102 tail: the probeSlotDial guard for acquisition providers.
//
// Server-side twin of the acquisition registry (src/lib/acquisition-registry.ts):
// ONE resolve path for every acquisition dial. Before this module the Frontier
// route carried the vault→env read INLINE twice (once for the honesty chip,
// once for the dial) — ~35 duplicated lines that would drift the moment a
// second acquisition provider landed. Now the route asks the guard.
//
// Contract (mirrors exaLaneKeySource/fetchExaAcquisition exactly — the route's
// behavior is byte-identical when unconfigured):
//   • resolveAcquisitionSlot — vault slots for the provider (AutomationVault,
//     AES-256-GCM at rest, decrypted server-side only, createdAt asc = the
//     executor's scan convention) FIRST, the provider's machine-secret env
//     fallback second, null = unconfigured. NEVER throws: vault unavailable
//     (missing master key / table absent) degrades to env-only, the r537
//     pattern preserved verbatim.
//   • probeSlotDial — the guarded dial: when resolve returns null the dial
//     function is NEVER INVOKED (the lane contributes nothing — no items, no
//     error row, byte-identical to the pre-r531 no-op); when configured, the
//     dial runs with (key, source) and its result passes through untouched —
//     per-status error mapping stays with the caller's dialect.

import { db } from "@/lib/db";
import { decryptVaultKey } from "@/lib/server/vault-crypto";
import {
  acquisitionById,
  acquisitionKeyFromSources,
  type AcquisitionKey,
} from "@/lib/acquisition-registry";

/** Injection seams for serverless QA — production callers omit `deps`. */
export interface AcquisitionDeps {
  /** Override the vault read (QA stubs this; default = AutomationVault scan). */
  listSlots?: (providerId: string) => Promise<{ provider: string; key: string }[]>;
  /** Override the env fallback (QA pins this; default = info.envFallback). */
  envKey?: string;
}

export async function resolveAcquisitionSlot(
  providerId: string,
  deps: AcquisitionDeps = {},
): Promise<AcquisitionKey | null> {
  const info = acquisitionById(providerId);
  if (!info) return null; // not acquisition-class — the guard refuses to resolve
  let slots: { provider: string; key: string }[] | null = null;
  try {
    slots = deps.listSlots
      ? await deps.listSlots(providerId)
      : await readVaultSlots(providerId);
  } catch {
    slots = null; // vault unavailable (master key missing / table absent) → env-only
  }
  const env =
    deps.envKey !== undefined ? deps.envKey : process.env[info.envFallback];
  return acquisitionKeyFromSources(slots, providerId, env);
}

async function readVaultSlots(
  providerId: string,
): Promise<{ provider: string; key: string }[]> {
  const rows = await db.automationVault.findMany({
    where: { provider: providerId },
    orderBy: { createdAt: "asc" }, // executor scan convention: oldest first
  });
  return Promise.all(
    rows.map(async (s) => ({ provider: s.provider, key: await decryptVaultKey(s.key) })),
  );
}

export type ProbeSlotDialResult<T> =
  | { skipped: true; reason: "unconfigured" }
  | { skipped: false; result: T };

/**
 * The guarded acquisition dial. Unconfigured ⇒ `dial` is never invoked and the
 * caller maps `skipped` to its lane's silent no-op; configured ⇒ the dial runs
 * exactly once with the resolved key + honest source.
 */
export async function probeSlotDial<T>(
  providerId: string,
  dial: (key: string, source: "vault" | "env") => Promise<T>,
  deps: AcquisitionDeps = {},
): Promise<ProbeSlotDialResult<T>> {
  const resolved = await resolveAcquisitionSlot(providerId, deps);
  if (!resolved) return { skipped: true, reason: "unconfigured" };
  return { skipped: false, result: await dial(resolved.key, resolved.source) };
}
