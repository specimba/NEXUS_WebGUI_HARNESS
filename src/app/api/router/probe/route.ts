import { NextRequest } from "next/server";
import { guardPublicUrl } from "@/lib/server/url-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── /api/router/probe — 1-token health check for cooled relay lanes (r49) ───
// The probe loop (relay-prober.ts) fires this against a capacity-cooled lane:
// a pass re-admits the lane (cooldown cleared, baseline restored), a fail
// doubles the remaining cooldown (capped) so a still-throttled lane isn't
// hammered every minute. Cheap by design: max_tokens 1, no tools, no history.
// The SSRF guard is identical to /api/chat's relay-hop guard.

interface ProbeBody {
  baseUrl?: unknown;
  apiKey?: unknown;
  model?: unknown;
}

const PROBE_TIMEOUT_MS = 10_000;

export async function POST(req: NextRequest) {
  let body: ProbeBody;
  try {
    body = (await req.json()) as ProbeBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "";

  if (!baseUrl || !model) {
    return Response.json({ error: "baseUrl and model are required" }, { status: 400 });
  }
  const verdict = guardPublicUrl(baseUrl);
  if (!verdict.ok) {
    return Response.json(
      { error: `Probe target rejected by the SSRF guard (${verdict.reason})` },
      { status: 400 }
    );
  }

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (res.ok) {
      // Drain a bounded chunk so the connection closes cleanly.
      await res.text().catch(() => "");
      return Response.json({ ok: true, status: res.status, latencyMs });
    }
    const text = await res.text().catch(() => "");
    const short = text.replace(/\s+/g, " ").slice(0, 200);
    return Response.json({ ok: false, status: res.status, latencyMs, error: short });
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err ?? "probe failed");
    return Response.json({ ok: false, latencyMs, error: msg.slice(0, 200) });
  } finally {
    clearTimeout(timer);
  }
}
