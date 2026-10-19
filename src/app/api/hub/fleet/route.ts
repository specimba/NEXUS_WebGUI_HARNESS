import { NextResponse } from "next/server";
import { hfAuthHeaders, hfToken } from "@/lib/server/hf-token";

// ─── GET /api/hub/fleet — authenticated Hugging Face fleet sweep (r501-p2) ───
// Deep-dive outcome made concrete: with the owner's PAT the Hub exposes a
// whole ops surface the radar never tapped:
//
//   • identity      → /api/whoami-v2 (billing truth: canPay/prepaid/isPro)
//   • spaces fleet  → /api/spaces?author=… + per-space /runtime (stage)
//   • owned models/datasets + collections (curation surface)
//   • webhooks      → /api/settings/webhooks  (NOT /api/webhooks — that route
//                     401s under every auth scheme; the settings route is the
//                     real one, verified r501-p2. Surfaces HF's silent
//                     "suspended-after-failure" auto-disable.)
//   • router lanes  → router.huggingface.co/v1/models (public): 135 models ×
//                     14 live providers annotated with latency/throughput/
//                     pricing — the provider-annotated catalog. Dialing is
//                     credit-gated (402, 0 prepaid credits) so this is a
//                     CATALOG lane, not an inference lane, until that changes.
//
// Every section degrades independently. Explicit user-triggered fetch only.
// The token never reaches the browser bundle.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 12_000;

interface Section<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface SpaceRow {
  id: string;
  likes: number;
  stage: string | null;
  hardware: string | null;
}

interface RouterLane {
  id: string;
  provider: string;
  context: number | null;
  inPrice: number | null;
  outPrice: number | null;
  ms: number | null;
  tps: number | null;
  tools: boolean;
}

async function hub(path: string, timeout = TIMEOUT_MS): Promise<Response> {
  return fetch(`https://huggingface.co${path}`, {
    headers: { ...hfAuthHeaders(), "User-Agent": "NEXUS-WebGUI/1.0 (hub fleet panel)" },
    signal: AbortSignal.timeout(timeout),
    cache: "no-store",
  });
}

function fail(section: string, err: unknown): Section<never> {
  const timedOut = err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message);
  return {
    ok: false,
    error: timedOut ? `${section}: the Hub took too long to answer.` : `${section}: unreachable.`,
  };
}

export async function GET(): Promise<Response> {
  const authed = hfToken() !== null;

  // 1) Identity — the username every later query hangs off.
  let identity: Section<{
    name: string;
    isPro: boolean;
    canPay: boolean;
    billingMode: string;
  }> = { ok: false, error: "identity: not probed" };
  let username = "specimba"; // sane default; corrected by whoami when it answers
  try {
    const res = await hub("/api/whoami-v2");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      name?: string;
      isPro?: boolean;
      canPay?: boolean;
      billingMode?: string;
    };
    if (body.name) username = body.name;
    identity = {
      ok: true,
      data: {
        name: body.name ?? username,
        isPro: body.isPro ?? false,
        canPay: body.canPay ?? false,
        billingMode: body.billingMode ?? "unknown",
      },
    };
  } catch (err) {
    identity = fail("identity", err);
  }

  // 2) Spaces fleet — listing is cheap; runtime stage needs one call per
  //    space (bounded: first 8, allSettled so a SLEEPING space can't stall
  //    the whole fleet view).
  let spaces: Section<SpaceRow[]> = { ok: false, error: "spaces: not probed" };
  try {
    const res = await hub(`/api/spaces?author=${encodeURIComponent(username)}&limit=20`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = (await res.json()) as Array<{
      id?: string;
      likes?: number;
    }>;
    const ids = list
      .filter((s): s is { id: string; likes?: number } => typeof s.id === "string")
      .slice(0, 8);
    const runtimes = await Promise.allSettled(
      ids.map((s) => hub(`/api/spaces/${s.id}/runtime`, 9_000))
    );
    const rows: SpaceRow[] = ids.map((s) => ({
      id: s.id,
      likes: s.likes ?? 0,
      stage: null,
      hardware: null,
    }));
    // parse the fulfilled runtimes (null stage = runtime call failed —
    // the row still renders, the stage chip just stays grey)
    await Promise.all(
      runtimes.map(async (rt, i) => {
        if (rt.status !== "fulfilled" || !rt.value.ok) return;
        try {
          const body = (await rt.value.json()) as {
            stage?: string;
            hardware?: { current?: string; requested?: string };
          };
          rows[i].stage = body.stage ?? null;
          rows[i].hardware = body.hardware?.requested ?? body.hardware?.current ?? null;
        } catch {
          /* stage stays null — row still renders */
        }
      })
    );
    spaces = { ok: true, data: rows };
  } catch (err) {
    spaces = fail("spaces", err);
  }

  // 3) Owned artifacts — models, datasets, collections.
  let artifacts: Section<{
    models: string[];
    datasets: string[];
    collections: { slug: string; title: string }[];
  }> = { ok: false, error: "artifacts: not probed" };
  try {
    const [mRes, dRes, cRes] = await Promise.allSettled([
      hub(`/api/models?author=${encodeURIComponent(username)}&limit=20`),
      hub(`/api/datasets?author=${encodeURIComponent(username)}&limit=20`),
      hub(`/api/collections?owner=${encodeURIComponent(username)}&limit=10`),
    ]);
    const models =
      mRes.status === "fulfilled" && mRes.value.ok
        ? ((await mRes.value.json()) as Array<{ id?: string }>)
            .map((m) => m.id ?? "")
            .filter(Boolean)
        : [];
    const datasets =
      dRes.status === "fulfilled" && dRes.value.ok
        ? ((await dRes.value.json()) as Array<{ id?: string }>)
            .map((d) => d.id ?? "")
            .filter(Boolean)
        : [];
    const collections =
      cRes.status === "fulfilled" && cRes.value.ok
        ? ((await cRes.value.json()) as Array<{ slug?: string; title?: string }>)
            .filter((c) => c.slug)
            .map((c) => ({ slug: c.slug as string, title: c.title ?? c.slug ?? "" }))
        : [];
    if (models.length + datasets.length + collections.length === 0 && mRes.status === "rejected") {
      throw mRes.reason;
    }
    artifacts = { ok: true, data: { models, datasets, collections } };
  } catch (err) {
    artifacts = fail("artifacts", err);
  }

  // 4) Webhooks — the real route (/api/settings/webhooks). A suspended
  //    webhook is a silent failure the owner only sees when it's polled.
  let webhooks: Section<
    { id: string; url: string; disabled: string | null; watched: number }[]
  > = { ok: false, error: "webhooks: not probed" };
  try {
    const res = await hub("/api/settings/webhooks");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as Array<{
      id?: string;
      url?: string;
      disabled?: string | boolean | null;
      watched?: unknown[];
    }>;
    webhooks = {
      ok: true,
      data: body
        .filter((w) => typeof w.id === "string")
        .map((w) => ({
          id: w.id as string,
          url: w.url ?? "",
          disabled: typeof w.disabled === "string" ? w.disabled : w.disabled ? "disabled" : null,
          watched: Array.isArray(w.watched) ? w.watched.length : 0,
        })),
    };
  } catch (err) {
    webhooks = fail("webhooks", err);
  }

  // 5) Router catalog — public, provider-annotated. Top lanes sorted by
  //    first_token_latency_ms among live+tool-capable providers.
  let router: Section<{
    total: number;
    liveProviders: string[];
    freeCount: number;
    topLanes: RouterLane[];
  }> = { ok: false, error: "router: not probed" };
  try {
    const res = await fetch("https://router.huggingface.co/v1/models", {
      headers: { ...hfAuthHeaders(), "User-Agent": "NEXUS-WebGUI/1.0 (router catalog)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: Array<{
        id?: string;
        providers?: Array<{
          provider?: string;
          status?: string;
          context_length?: number;
          pricing?: { input?: number; output?: number };
          is_free?: boolean;
          supports_tools?: boolean;
          first_token_latency_ms?: number;
          throughput?: number;
        }>;
      }>;
    };
    const rows = body.data ?? [];
    const liveProviders = new Set<string>();
    let freeCount = 0;
    const lanes: RouterLane[] = [];
    for (const m of rows) {
      if (!m.id) continue;
      const live = (m.providers ?? []).filter((p) => p.status === "live");
      for (const p of live) {
        if (p.provider) liveProviders.add(p.provider);
        if (p.is_free) freeCount += 1;
      }
      const best = live
        .filter((p) => typeof p.first_token_latency_ms === "number")
        .sort((a, b) => (a.first_token_latency_ms ?? 0) - (b.first_token_latency_ms ?? 0))[0];
      if (best?.provider) {
        lanes.push({
          id: m.id,
          provider: best.provider,
          context: best.context_length ?? null,
          inPrice: best.pricing?.input ?? null,
          outPrice: best.pricing?.output ?? null,
          ms: best.first_token_latency_ms ?? null,
          tps: best.throughput ?? null,
          tools: best.supports_tools ?? false,
        });
      }
    }
    lanes.sort((a, b) => (a.ms ?? 9e9) - (b.ms ?? 9e9));
    router = {
      ok: true,
      data: {
        total: rows.length,
        liveProviders: [...liveProviders].sort(),
        freeCount,
        topLanes: lanes.slice(0, 12),
      },
    };
  } catch (err) {
    router = fail("router", err);
  }

  return NextResponse.json({
    authed,
    identity,
    spaces,
    artifacts,
    webhooks,
    router,
    probedAt: Date.now(),
  });
}
