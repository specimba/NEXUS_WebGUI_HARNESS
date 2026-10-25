import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptVaultKey } from "@/lib/server/vault-crypto";
import { providerById } from "@/lib/providers";
import {
  provider429CooldownLeftMs,
  providerBillingDeadLeftMs,
  resetProvider429,
} from "@/lib/provider-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── POST /api/providers/recheck ─────────────────────────────────────────────
// r335 (user report): the rotation memories (6h billing quarantine, congestion
// streaks) only self-healed on a proven dial FROM THE LANE THAT NOTED THE
// DEATH. The server lane (tab-closed executor) skips a quarantined provider —
// so it never dials it, never proves it healthy, and stays skipped for the
// full 6h EVEN AFTER the wallet is topped up (witnessed: Vyce balance
// $236.57, grok-imagine-2 online, while stale memories still said "insufficient
// balance"). This route is the manual, zero-cost truth probe + heal:
//   1. reads the provider's key from the SERVER vault (db.automationVault);
//   2. probes the account endpoint (Vyce /v1/me — live balance) with a
//      /v1/models fallback (liveness + roster, both free — no token spend);
//   3. on ANY HTTP 200, clears that provider's quarantine + streak via
//      resetProvider429 (the same call a proven dial makes), reporting what
//      was cleared; on failure it clears NOTHING — a still-dead lane keeps
//      its memory.
// The key is read server-side and never echoed, stored, or logged. The
// BROWSER lane's memory heals separately (provider-gallery checkCredits now
// resets it on the same evidence) — the two maps are separate module
// instances by design (documented lifetime class).

interface RecheckBody {
  providerId?: string;
}

// Server-side allowlist (mirrors /api/providers/account — mePath is
// domain-relative, and only providers with an explicit account endpoint).
const ME_ENDPOINTS: Record<string, string> = {
  vyce: "https://vyceai.com/v1/me",
};

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: NextRequest) {
  let body: RecheckBody;
  try {
    body = (await req.json()) as RecheckBody;
  } catch {
    return jsonError(400, "Invalid JSON body");
  }
  const providerId = body.providerId?.trim();
  if (!providerId) return jsonError(400, "providerId is required");

  const reg = providerById(providerId);
  if (!reg) return jsonError(400, `Unknown provider "${providerId}"`);

  // Server vault: oldest first; use the newest slot that has a key for this
  // provider (the executor's own resolution order, minus rotation logic —
  // this probe is about TRUTH, not lane selection).
  // r526: rows hold AES-256-GCM ciphertext at rest — probe the raw key.
  const fetchedSlots = await db.automationVault.findMany({ orderBy: { createdAt: "asc" } });
  const slots = await Promise.all(
    fetchedSlots.map(async (s) => ({ ...s, key: await decryptVaultKey(s.key) })),
  );
  const slot = [...slots].reverse().find((s) => s.provider === providerId && s.key.trim());
  if (!slot) {
    return NextResponse.json({
      ok: false,
      why: "no-server-key",
      detail:
        "No key for this provider in the server vault — the browser lane heals itself (or via reload); nothing to re-check server-side.",
      providerId,
    });
  }
  const key = slot.key.trim();

  // Pre-clear memory read (what the lane believed BEFORE this probe).
  const before = {
    billingLeftMs: providerBillingDeadLeftMs(providerId),
    cooldownLeftMs: provider429CooldownLeftMs(providerId),
  };

  let meFailure: { status: number; slice: string } | undefined;

  const probe = async (url: string, timeoutMs: number) => {
    const t0 = Date.now();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const text = await res.text().catch(() => "");
    return { res, text, ms: Date.now() - t0 };
  };

  // 1) account endpoint (live balance — the honest witness).
  const meUrl = ME_ENDPOINTS[providerId];
  if (meUrl) {
    try {
      const { res, text, ms } = await probe(meUrl, 10_000);
      if (res.ok) {
        let fields: Record<string, unknown> = {};
        try {
          const data = JSON.parse(text) as Record<string, unknown>;
          // Whitelist only display fields — never echo raw payloads.
          fields = {
            name: typeof data.name === "string" ? data.name : undefined,
            balance: typeof data.balance === "number" ? data.balance : undefined,
            rateLimit: typeof data.rateLimit === "number" ? data.rateLimit : undefined,
            enabled: typeof data.enabled === "boolean" ? data.enabled : undefined,
            totalSpent: typeof data.totalSpent === "number" ? data.totalSpent : undefined,
            totalRequests: typeof data.totalRequests === "number" ? data.totalRequests : undefined,
          };
        } catch {
          /* non-JSON 2xx — still a proven-healthy response */
        }
        resetProvider429(providerId);
        return NextResponse.json({
          ok: true,
          providerId,
          source: "me",
          httpStatus: 200,
          latencyMs: ms,
          ...fields,
          cleared: before,
        });
      }
      // /me answered but non-OK — remember the shape, try the models fallback.
      meFailure = { status: res.status, slice: text.slice(0, 160) };
    } catch {
      /* network-level failure on /me — fall through to /models */
    }
  }

  // 2) models fallback (liveness + auth + roster proof).
  try {
    const { res, text, ms } = await probe(`${reg.baseUrl}/models`, 10_000);
    if (res.ok) {
      let modelCount: number | undefined;
      let hasImageModel: boolean | undefined;
      try {
        const data = JSON.parse(text) as { data?: Array<{ id?: string }> };
        const ids = (data.data ?? []).map((m) => m.id ?? "");
        modelCount = ids.length;
        hasImageModel = ids.includes("grok-imagine-2");
      } catch {
        /* non-JSON 2xx — still proven healthy */
      }
      resetProvider429(providerId);
      return NextResponse.json({
        ok: true,
        providerId,
        source: "models",
        httpStatus: 200,
        latencyMs: ms,
        modelCount,
        hasImageModel,
        meFailure,
        cleared: before,
      });
    }
    // Both lanes answered non-OK: report the LAST failure honestly, clear nothing.
    return NextResponse.json(
      {
        ok: false,
        providerId,
        why: "probe-failed",
        status: res.status,
        bodySlice: text.slice(0, 200),
        latencyMs: ms,
        meFailure,
        memory: before,
        note: "Stale quarantine (if any) is KEPT — the lane is still not proven healthy.",
      },
      { status: 502 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        ok: false,
        providerId,
        why: "unreachable",
        error: message,
        meFailure,
        memory: before,
        note: "Stale quarantine (if any) is KEPT — the lane is still not proven healthy.",
      },
      { status: 502 }
    );
  }
}
