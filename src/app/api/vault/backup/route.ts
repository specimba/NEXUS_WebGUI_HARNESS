import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptVaultKey, encryptVaultKey } from "@/lib/server/vault-crypto";
import { localFailure } from "@/lib/local-failure";
import { localGuard } from "@/lib/vault-local";

export const dynamic = "force-dynamic";

// ─── r380: Automation Vault backup — export (GET) / import (POST) ───────────
// The vault's own honest gap: keys lived in this machine's SQLite with per-
// slot Test/Reveal (r218) but NO way to back them up, restore them, or move
// them to another machine running the platform. A wiped browser profile or a
// dead disk meant every stored key was gone forever. This route is the
// round-trip fix: GET returns every slot (raw keys included) as a marked,
// versioned JSON document; POST accepts that same document back and upserts
// it slot-by-slot with the SAME semantics as POST /api/vault.
//
// Trust model — deliberately identical to /api/vault/consume (r138), whose
// localGuard this route shares via src/lib/vault-local.ts (one definition):
// the keys already sit plaintext in this machine's SQLite, so serving them
// over localhost adds no new exposure; the guard blocks accidental remote/
// proxied access, not deliberate same-host reads. What IS new is the output
// artifact: the exported FILE is plaintext JSON holding every key — the UI
// says so on the confirm click and in the success toast, and the download
// is a two-click deliberate action (no auto-download, no clipboard).
//
// Response shapes:
//   GET  200 { ok: true, app: "nexus-automation-vault", version: 1,
//              exportedAt, slots: [{ provider, label, key, createdAt, updatedAt }] }
//   GET  403 (non-local)
//   POST 200 { ok: true, imported, skipped, providers: [...] }
//   POST 400 (body not an object / slots missing or not an array / empty /
//             over MAX_IMPORT_SLOTS / malformed slot structure reported via skipped)
//   POST 403 (non-local)
//   POST 500 (DB write failure mid-import reports per-route localFailure)

const MAX_IMPORT_SLOTS = 100;

interface ImportSlot {
  provider?: unknown;
  key?: unknown;
  label?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function GET(req: Request) {
  const guard = localGuard(req);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, error: `vault export is localhost-only (${guard.reason})` },
      { status: 403 }
    );
  }
  try {
    const rows = await db.automationVault.findMany({ orderBy: { provider: "asc" } });
    return NextResponse.json({
      ok: true,
      app: "nexus-automation-vault",
      version: 1,
      exportedAt: new Date().toISOString(),
      slots: await Promise.all(
        rows.map(async (r) => ({
          provider: r.provider,
          label: r.label,
          // raw — the whole point of a backup; guarded + documented above
          // (r526: decrypts the at-rest ciphertext server-side before export)
          key: await decryptVaultKey(r.key),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      ),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: localFailure("vault:export", e, "Vault export failed — check the server console for detail") },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const guard = localGuard(req);
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, error: `vault import is localhost-only (${guard.reason})` },
      { status: 403 }
    );
  }
  try {
    const body = (await req.json().catch(() => null)) as { slots?: unknown } | null;
    if (!body || typeof body !== "object" || !Array.isArray(body.slots)) {
      return NextResponse.json(
        { ok: false, error: "malformed import — expected an object with a slots array (export the vault first)" },
        { status: 400 }
      );
    }
    if (body.slots.length === 0) {
      return NextResponse.json(
        { ok: false, error: "the imported file holds no slots — nothing to do" },
        { status: 400 }
      );
    }
    if (body.slots.length > MAX_IMPORT_SLOTS) {
      return NextResponse.json(
        { ok: false, error: `too many slots (${body.slots.length}; max ${MAX_IMPORT_SLOTS})` },
        { status: 400 }
      );
    }
    let imported = 0;
    let skipped = 0;
    const providers: string[] = [];
    for (const raw of body.slots as ImportSlot[]) {
      const provider = isNonEmptyString(raw?.provider) ? raw.provider.trim() : null;
      const key = isNonEmptyString(raw?.key) ? raw.key.trim() : null;
      // A slot without a resolvable provider+key cannot exist in the vault —
      // skip it and count it honestly rather than failing the whole import.
      if (!provider || !key) {
        skipped += 1;
        continue;
      }
      const label = typeof raw?.label === "string" && raw.label.trim().length > 0 ? raw.label.trim() : null;
      // r526: imported raw keys are encrypted before they touch SQLite.
      const stored = await encryptVaultKey(key);
      await db.automationVault.upsert({
        where: { provider },
        create: { provider, key: stored, label },
        update: { key: stored, label },
      });
      providers.push(provider);
      imported += 1;
    }
    return NextResponse.json({ ok: true, imported, skipped, providers });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: localFailure("vault:import", e, "Vault import failed — check the server console for detail") },
      { status: 500 }
    );
  }
}
