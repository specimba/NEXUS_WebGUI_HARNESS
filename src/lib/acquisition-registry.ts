// r550 — TASK-102 tail: the ACQUISITION registry class.
//
// NEXUS_BOT wave doctrine (r531 slice 6 → r537 slice 8 → r539 honesty chip):
// acquisition providers are NOT chat providers — the vault may hold a key for
// them, the executor must never dial them as an LLM step, and their dials are
// data acquisition (Exa /search). Until now that classification lived as
// scattered per-lane code: the route carried the vault→env ordering INLINE
// (twice — once for the honesty chip, once for the dial), and "which providers
// are acquisition-class" existed only as `lane: "acquisition"` on the chat
// registry plus prose in the vault card.
//
// This module is the single isomorphic vocabulary:
//   • ACQUISITION_PROVIDERS — the registry class (id, env fallback name, dial base)
//   • acquisitionKeyFromSources — the PURE key-source ordering every acquisition
//     dial shares: vault slot first (executor scan convention — rows arrive
//     oldest-createdAt-first, blank keys skipped), machine-secret env fallback
//     second, null = unconfigured (the lane stays silent, never an error row).
//
// Pure and dependency-free: the route, the server guard, and QA all import the
// SAME ordering — no second implementation to drift.

export interface AcquisitionProviderInfo {
  id: string;
  label: string;
  /** Machine-secret fallback env var read when no vault slot qualifies. */
  envFallback: string;
  /** Default API base the acquisition dialect dials. */
  dialBase: string;
  /** "live" = a dial dialect exists and a lane dials it today (the frontier
   *  route probes it); "dormant" = registry ground truth only — the key can
   *  already be stored/resolved through the guard, but the dial dialect ships
   *  in a later wave. Honest vocabulary for the fleet readout. */
  status: "live" | "dormant";
  /** One-line user-facing description (vault card + docs share this). */
  blurb: string;
}

export const ACQUISITION_PROVIDERS: readonly AcquisitionProviderInfo[] = [
  {
    id: "exa",
    label: "Exa",
    envFallback: "EXA_API_KEY",
    dialBase: "https://api.exa.ai",
    status: "live",
    blurb:
      "Neural web-search acquisition — powers Radar Frontier's /search lane (picked up on the next Frontier refresh).",
  },
  {
    id: "brightdata",
    label: "Bright Data",
    envFallback: "BRIGHTDATA_TOKEN",
    dialBase: "https://api.brightdata.com",
    status: "dormant",
    blurb:
      "Web-unlocker acquisition (SERP / web unlock) — awaiting a token; the unlocker dial dialect ships in a later wave.",
  },
  {
    id: "webshare",
    label: "Webshare",
    envFallback: "WEBSHARE_TOKEN",
    dialBase: "https://proxy.webshare.io",
    status: "dormant",
    blurb:
      "Residential proxy pool (the pool tier) — awaiting a token; rotation wiring ships with the pool dialect.",
  },
] as const;

export function acquisitionById(id: string): AcquisitionProviderInfo | null {
  return ACQUISITION_PROVIDERS.find((p) => p.id === id) ?? null;
}

export function isAcquisitionProvider(id: string): boolean {
  return acquisitionById(id) !== null;
}

/** Which source served the lane — same union the Frontier chip already speaks. */
export type AcquisitionKeySource = "vault" | "env" | null;

export interface AcquisitionKey {
  key: string;
  source: "vault" | "env";
}

/**
 * The ONE ordering for acquisition dials (r550 — generalized from
 * exaKeyFromSources/exaKeySourceFromSources, which keep their exa-named exports
 * for the 13/13 dialect QA): a decrypted vault slot for `providerId` whose key
 * is non-blank WINS (rows arrive oldest-createdAt-first — the executor's scan
 * convention; the first qualifying slot is the one the executor would dial),
 * then the machine-secret env fallback, else null = unconfigured.
 */
export function acquisitionKeyFromSources(
  vaultSlots: { provider: string; key: string }[] | null,
  providerId: string,
  envKey: string | undefined,
): AcquisitionKey | null {
  const slot = (vaultSlots ?? []).find(
    (s) => s.provider === providerId && s.key.trim(),
  );
  if (slot) return { key: slot.key.trim(), source: "vault" };
  const env = envKey?.trim();
  if (env) return { key: env, source: "env" };
  return null;
}
