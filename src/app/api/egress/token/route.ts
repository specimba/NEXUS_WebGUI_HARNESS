import { NextResponse } from "next/server";
import {
  clearToken,
  getWebshareToken,
  loadEgressPool,
  maskTokenPreview,
  purgeEgressPoolCache,
  sanitizePastedToken,
  summarizePool,
  writeToken,
} from "@/lib/server/egress";

export const dynamic = "force-dynamic";

// ─── r514: Webshare token store (POST save / DELETE clear) ───────────────────
// The token lives ONLY in the PlatformSetting KV on this machine. Responses
// carry a masked last-4 preview — never the token itself. Store-then-probe
// pattern: the token is saved EVEN when the probe against Webshare rejects it,
// and the honest UNAUTHORIZED verdict is surfaced so the owner sees it
// immediately (no silent success, no silent discard).

function csrfOk(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  if (site === null && origin === null) return true; // CLI / server-to-server
  if (req.headers.get("x-nexus-csrf") !== "1") return false; // preflight gate
  return site !== "cross-site";
}

const csrfReject = () =>
  NextResponse.json({ ok: false, error: "egress rejects cross-site browser calls (CSRF gate)" }, { status: 403 });

export async function POST(req: Request) {
  if (!csrfOk(req)) return csrfReject();
  try {
    let body: { token?: unknown };
    try {
      body = (await req.json()) as { token?: unknown };
    } catch {
      return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
    }
    // Paste hygiene runs server-side too (the card does the same).
    const token = sanitizePastedToken(typeof body.token === "string" ? body.token : "");
    if (!token) {
      return NextResponse.json({ ok: false, error: "token is required" }, { status: 400 });
    }

    const stored = await writeToken(token);
    if (!stored) {
      return NextResponse.json({ ok: false, error: "could not persist the token — try again" }, { status: 500 });
    }
    purgeEgressPoolCache();

    // Store-then-probe: an UNAUTHORIZED pool load still keeps the token stored,
    // but the owner sees the honest verdict immediately.
    const probe = await loadEgressPool({ forceRefresh: true });
    if (probe.ok) {
      const summary = summarizePool(probe.pool);
      return NextResponse.json({
        ok: true,
        tokenPreview: maskTokenPreview(token),
        probe: { ok: true, count: summary.count, validCount: summary.validCount },
      });
    }
    return NextResponse.json({
      ok: true,
      tokenPreview: maskTokenPreview(token),
      probe: {
        ok: false,
        error:
          probe.code === "UNAUTHORIZED"
            ? "UNAUTHORIZED — token rejected by Webshare"
            : probe.message,
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "token save failed — try again" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  if (!csrfOk(req)) return csrfReject();
  try {
    await clearToken();
    purgeEgressPoolCache();
    return NextResponse.json({ ok: true, configured: false });
  } catch {
    return NextResponse.json({ ok: false, error: "token clear failed — try again" }, { status: 500 });
  }
}

/** Status enrichment for the card after reload — masked preview only. */
// Read-only preview GET — ungated like every other house read route (the
  // CSRF double-gate covers the state-changing POST/DELETE below).
export async function GET() {
  const token = await getWebshareToken();
  return NextResponse.json({
    ok: true,
    configured: !!token,
    ...(token ? { tokenPreview: maskTokenPreview(token) } : {}),
  });
}
