import { NextResponse } from "next/server";
import { hfAuthHeaders, hfToken } from "@/lib/server/hf-token";

// ─── GET /api/radar/hf — Trend Radar · HF Trending (r139) ────────────────────
// Thin proxy over the public Hugging Face Hub trending API. This is the LAST
// of the radar's three remote sources to leave the browser: GitHub Stars and
// Paper Radar already hop through /api/radar/github and /api/radar/papers,
// but HF Trending still called huggingface.co directly from the client —
// inconsistent with the other tabs and the first thing to break behind a
// strict egress/CSP setup, with no server-side error classification. The
// proxy allow-lists the section (models/datasets/spaces), clamps the limit,
// passes through only the fields the radar grid renders, and returns the
// same { error } shape as the other radar proxies. Still an explicit
// user-triggered fetch — no silent calls, zero telemetry.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HF_TIMEOUT_MS = 15_000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

const KINDS: Record<string, string> = {
  models: "models",
  datasets: "datasets",
  spaces: "spaces",
};

interface HfItemTrimmed {
  id: string;
  likes?: number;
  downloads?: number;
  pipeline_tag?: string;
  library_name?: string;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const kind = (url.searchParams.get("kind") ?? "models").trim();
  const path = KINDS[kind];
  if (!path) {
    return NextResponse.json(
      { error: `Unknown Hub section "${kind}" — expected models, datasets or spaces.` },
      { status: 400 }
    );
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT;
  const limit = Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_LIMIT);

  try {
    const res = await fetch(
      `https://huggingface.co/api/${path}?sort=trendingScore&direction=-1&limit=${limit}`,
      {
        headers: {
          "User-Agent":
            "NEXUS-WebGUI/1.0 (trend radar; local-first agentic workflow platform)",
          // r501: owner's HF PAT (db/hf-token.txt) — raises the Hub rate-limit
          // ceiling; absent file falls back to keyless reads, nothing breaks.
          ...hfAuthHeaders(),
        },
        signal: AbortSignal.timeout(HF_TIMEOUT_MS),
      }
    );
    if (res.status === 403 || res.status === 429) {
      return NextResponse.json(
        { error: "Hugging Face Hub rate limit hit — try again in a bit." },
        { status: 429 }
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: `Hugging Face API returned HTTP ${res.status}.` },
        { status: 502 }
      );
    }
    const batch = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(batch)) {
      return NextResponse.json(
        { error: "Unexpected response from the Hugging Face API." },
        { status: 502 }
      );
    }
    const items: HfItemTrimmed[] = batch
      .filter((r) => r && typeof r.id === "string")
      .map((r) => ({
        id: r.id as string,
        ...(typeof r.likes === "number" ? { likes: r.likes } : {}),
        ...(typeof r.downloads === "number" ? { downloads: r.downloads } : {}),
        ...(typeof r.pipeline_tag === "string" ? { pipeline_tag: r.pipeline_tag } : {}),
        ...(typeof r.library_name === "string" ? { library_name: r.library_name } : {}),
      }));
    return NextResponse.json({ kind, count: items.length, items, authed: hfToken() !== null });
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message);
    return NextResponse.json(
      {
        error: timedOut
          ? "Hugging Face took too long to answer — try again."
          : "Could not reach the Hugging Face Hub.",
      },
      { status: 504 }
    );
  }
}
