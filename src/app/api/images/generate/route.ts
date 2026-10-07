import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── POST /api/images/generate ───────────────────────────────────────────────
// BYOK image generation for providers that expose an images endpoint
// (Vyce /v1/images/generations · Grok Imagine 2 today). The key travels
// per-request from the user's local vault, is used ONLY against the provider
// they picked, and is never stored or logged server-side (zero telemetry).

interface ImageBody {
  providerId?: string;
  key?: string;
  prompt?: string;
  size?: string;
  n?: number;
}

const ALLOWED_SIZES = new Set(["1024x1024", "1024x768", "768x1024"]);
// r334: the r332 disease's last un-migrated copy lived in this route. Vyce's
// drained wallet arrives as a 403 whose body says "balance is insufficient …
// Please recharge" — the old blanket mapped every 401/403 to "Invalid or
// unauthorized key", telling the user to fix a HEALTHY key (the exact
// mis-advice r332 fixed on the chat/workflow surfaces). This is the canonical
// billing regex family (workflow-runner / agent-engine / automation-executor),
// mirrored here to keep the route dependency-free; if the provider reports a
// drained wallet with NOVEL phrasing, this is the one place to teach it.
const BILLING_BODY_RE =
  /\b402\b|out of credits|insufficient (?:credits?|balance|funds)|(?:credits?|balance|funds) (?:is|are) insufficient|please recharge|credit.?gate|add credits|payment required/i;
const MAX_PROMPT = 1200;
const MAX_RESPONSE_BYTES = 12_000_000; // ≈9 MB base64 ceiling

export async function POST(req: NextRequest) {
  let body: ImageBody;
  try {
    body = (await req.json()) as ImageBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const providerId = body.providerId?.trim();
  const key = body.key?.trim();
  const prompt = body.prompt?.trim() ?? "";
  const size = body.size?.trim() ?? "1024x1024";
  const n = Math.min(Math.max(Number(body.n ?? 1) || 1, 1), 2);

  if (!providerId || !key) {
    return NextResponse.json({ error: "providerId and key are required" }, { status: 400 });
  }
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json({ error: `prompt is too long (max ${MAX_PROMPT} chars)` }, { status: 400 });
  }
  if (!ALLOWED_SIZES.has(size)) {
    return NextResponse.json({ error: `size must be one of ${[...ALLOWED_SIZES].join(", ")}` }, { status: 400 });
  }

  // Server-side allowlist — only providers with an explicit images endpoint.
  const IMAGES_ENDPOINTS: Record<string, { url: string; model: string }> = {
    vyce: { url: "https://vyceai.com/v1/images/generations", model: "grok-imagine-2" },
  };
  const target = IMAGES_ENDPOINTS[providerId];
  if (!target) {
    return NextResponse.json(
      { error: `Provider "${providerId}" has no image endpoint` },
      { status: 400 },
    );
  }

  const started = Date.now();
  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ model: target.model, prompt, n, size }),
      signal: AbortSignal.timeout(150_000), // image gen is slow (15–60s observed)
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      let msg = `HTTP ${res.status}: ${text.slice(0, 200) || "image generation failed"}`;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
        const inner = parsed?.error?.message ?? parsed?.message;
        if (inner) msg = `HTTP ${res.status}: ${inner}`;
      } catch {
        /* keep raw text */
      }
      // r334: classify on the BODY first (any status) — a 403 with billing
      // phrasing is an empty wallet, not a broken key. Bare 401/403 (no
      // billing language in the body) stays a genuine key/region problem.
      if (res.status === 402 || BILLING_BODY_RE.test(text) || BILLING_BODY_RE.test(msg)) {
        msg = `Out of credits: the provider's balance is exhausted — top up the account (daily credit windows reset at 00:00 UTC) or point Image Studio at a second provider, then try again.`;
      } else if (res.status === 401 || res.status === 403) {
        msg = `Invalid or unauthorized key (${res.status}). Check it in Settings → Providers.`;
      } else if (res.status === 429) {
        msg = `Rate limited (HTTP 429) — wait a moment and try again.`;
      }
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    if (text.length > MAX_RESPONSE_BYTES) {
      return NextResponse.json({ error: "Image response too large" }, { status: 502 });
    }

    const data = JSON.parse(text) as {
      data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
    };
    const item = data?.data?.[0];
    let dataUrl: string | undefined = item?.url;
    if (!dataUrl && item?.b64_json) dataUrl = `data:image/jpeg;base64,${item.b64_json}`;

    if (!dataUrl || !/^data:image\/(png|jpeg|jpg|webp);base64,|^https:\/\//i.test(dataUrl)) {
      return NextResponse.json(
        { error: "The provider returned no usable image (unexpected response shape)" },
        { status: 502 },
      );
    }
    if (dataUrl.length > MAX_RESPONSE_BYTES) {
      return NextResponse.json({ error: "Image too large to display" }, { status: 502 });
    }

    return NextResponse.json({
      providerId,
      model: target.model,
      size,
      imageUrl: dataUrl,
      revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : undefined,
      ms: Date.now() - started,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const friendly = /timeout|timed out/i.test(message)
      ? "The image took too long to generate (gateway timeout) — try a shorter prompt."
      : message;
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
