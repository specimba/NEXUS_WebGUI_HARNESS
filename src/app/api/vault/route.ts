import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptVaultKey, encryptVaultKey } from "@/lib/server/vault-crypto";

export const dynamic = "force-dynamic";

// ─── v25: Local Automation Vault ─────────────────────────────────────────────
// Opt-in storage for a user-chosen key the HEADLESS server lane may use when
// the tab is closed. The browser BYOK lane keeps keys client-side and never
// touches this. Local-first: the key lives only in this machine's SQLite DB,
// nothing is telemetered, and GET never returns the raw key — only a masked
// preview. POST upserts a slot; DELETE removes it.
//
// r325: the whole route now sits behind the house r26.1 CSRF double-gate
// (same local copy as consume r321, tools/execute, tracker). POST/DELETE are
// state-changing — a drive-by page could overwrite or sabotage stored slots
// with a preflight-free simple request — and GET joins the gate for family
// symmetry (masked previews are not for foreign pages either). Non-browser
// callers (headless scheduler, CLI, QA scripts — no Origin/Sec-Fetch-Site
// headers) pass unchanged.

const MASK_MIN = 12;
const maskKey = (k: string) =>
  k.length > MASK_MIN ? `${k.slice(0, 4)}••••${k.slice(-4)}` : "••••••••";

// r321 double-gate applied route-wide (r325; consume/tools-execute/tracker
// carry the same local copy): (1) custom-header gate — foreign pages cannot
// attach "x-nexus-csrf" without a granted preflight (never granted), so a
// text/plain simple-request bypass dies here; (2) fetch-metadata gate —
// Sec-Fetch-Site "cross-site" rejected. No browser headers at all = CLI /
// scheduler pass.
function csrfOk(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) return true; // CLI / server-to-server
  if (req.headers.get("x-nexus-csrf") !== "1") return false; // preflight gate
  return site !== "cross-site";
}

const csrfReject = () =>
  NextResponse.json(
    { ok: false, error: "vault rejects cross-site browser calls (CSRF gate)" },
    { status: 403 },
  );

export async function GET(req: Request) {
  if (!csrfOk(req)) return csrfReject();
  try {
    const rows = await db.automationVault.findMany({ orderBy: { provider: "asc" } });
    // r526: rows hold AES-256-GCM ciphertext at rest — decrypt server-side for
    // the masked preview (legacy plaintext passes through unchanged).
    const slots = await Promise.all(
      rows.map(async (r) => ({ ...r, key: await decryptVaultKey(r.key) })),
    );
    return NextResponse.json({
      vault: slots.map((r) => ({
        provider: r.provider,
        label: r.label,
        maskedKey: maskKey(r.key),
        updatedAt: r.updatedAt,
        // r210: slot age is functionally meaningful — the executor dials the
        // OLDEST resolvable slot (r207), so the card must show createdAt.
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { vault: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  if (!csrfOk(req)) return csrfReject();
  try {
    const body = (await req.json()) as { provider?: string; key?: string; label?: string };
    const provider = (body.provider ?? "builtin").trim();
    const key = (body.key ?? "").trim();
    if (!provider || !key) {
      return NextResponse.json(
        { ok: false, error: "provider and key are required" },
        { status: 400 }
      );
    }
    // r526: the raw key is encrypted (AES-256-GCM) before it touches SQLite.
    const stored = await encryptVaultKey(key);
    const row = await db.automationVault.upsert({
      where: { provider },
      create: { provider, key: stored, label: body.label ?? null },
      update: { key: stored, label: body.label ?? null },
    });
    return NextResponse.json({
      ok: true,
      provider: row.provider,
      maskedKey: maskKey(key),
      updatedAt: row.updatedAt,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  if (!csrfOk(req)) return csrfReject();
  try {
    const provider = new URL(req.url).searchParams.get("provider") ?? "builtin";
    await db.automationVault.deleteMany({ where: { provider } });
    return NextResponse.json({ ok: true, provider });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
