/**
 * r654 — vault drift auto-heal (the closed-tab lane dials the FRESH key).
 *
 * WHY: the server lane's slot (Settings → Automation vault) can silently fall
 * behind the browser provider vault — the Owner rotates a key in Providers,
 * `mirrorCandidates` excludes the provider (a slot already exists), the r337
 * strip disappears, and every closed-tab schedule keeps dialing the OLD key
 * from SQLite. The live evidence: the Vyce AI slot — the FIRST dial — sat on
 * "key drifted — re-mirror" while its browser key had already been re-validated.
 *
 * Doctrine: the vault is OPT-IN storage — "nothing ever copies silently"
 * (r337). The heal therefore only ever RE-upserts a slot that ALREADY exists
 * (a provider with no slot returns "no-slot" and nothing is created); a
 * deleted browser key heals nothing ("clean" — a deletion must not nag).
 * Never-throw throughout: any failure returns "failed" and the existing amber
 * manual chip ("key drifted — re-mirror") stays as the fallback — server down
 * degrades to today's UX, never to silence.
 */

/** Same mask as the server route + the vault card's maskOf (r149/r218). */
function maskOf(raw: string): string {
  return raw.length > 12 ? `${raw.slice(0, 4)}••••${raw.slice(-4)}` : "••••••••";
}

/**
 * Pure drift predicate — the vault card's slotDrifted, QA-importable.
 * Mismatch = drift; no browser key → no drift claim (the slot may be
 * intentionally manual); short keys mask to all dots on BOTH sides, so they
 * can never false-positive.
 */
export function slotIsDrifted(
  browserKey: string | undefined | null,
  maskedKey: string
): boolean {
  try {
    const k = (browserKey ?? "").trim();
    if (!k) return false;
    return maskOf(k) !== maskedKey;
  } catch {
    return false;
  }
}

export type RemirrorResult = "healed" | "clean" | "no-slot" | "failed";

/**
 * Idempotent best-effort heal for ONE provider slot.
 * - no/empty browser key            → "clean"   (r340: deletion must not nag)
 * - GET finds no slot for provider  → "no-slot" (opt-in doctrine: never create)
 * - masks agree (fresh GET)         → "clean"   (concurrent calls are no-ops)
 * - drift + successful upsert       → "healed"  (label rides the slot row)
 * - anything else                   → "failed"  (manual chip remains)
 */
export async function remirrorIfDrifted(
  providerId: string,
  browserKey?: string | null
): Promise<RemirrorResult> {
  try {
    const key = (browserKey ?? "").trim();
    if (!key) return "clean";
    // cache:"no-store" (r218): the answer must never come from the HTTP cache —
    // a cached mask would heal against yesterday's slot.
    const getRes = await fetch("/api/vault", {
      cache: "no-store",
      headers: { "x-nexus-csrf": "1" },
    });
    if (!getRes.ok) return "failed";
    const json = (await getRes.json()) as {
      vault?: Array<{ provider?: string; maskedKey?: string }>;
    };
    const list = Array.isArray(json.vault) ? json.vault : [];
    const slot = list.find((s) => !!s && s.provider === providerId);
    if (!slot) return "no-slot";
    if (!slotIsDrifted(key, slot.maskedKey ?? "")) return "clean";
    const postRes = await fetch("/api/vault", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nexus-csrf": "1" },
      body: JSON.stringify({
        provider: providerId,
        key,
        label: "auto re-mirrored — drift heal",
      }),
    });
    if (!postRes.ok) return "failed";
    const postJson = (await postRes.json().catch(() => ({}))) as { ok?: boolean };
    if (postJson && postJson.ok === false) return "failed";
    return "healed";
  } catch {
    return "failed";
  }
}
