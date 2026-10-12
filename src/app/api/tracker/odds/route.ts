import { NextResponse } from "next/server";

// ─── Model Odds proxy (r51) ──────────────────────────────────────────────────
// models.lunarwerx.com publishes free, keyless launch-forecast odds ("which
// AI model ships next", worked out from the gaps between past releases). The
// platform reads it as fleet intel: a 78% GLM-5.4 window means zai/aihubmix
// catalog churn is coming, which feeds the versioned-ranks + watchdog
// doctrine. HONESTY: upstream numbers are statistical estimates from public
// launch records, not vendor schedules — the caveat rides through to the UI
// verbatim. 5-minute memory cache mirrors the upstream's own CDN semantics.

export const dynamic = "force-dynamic";

const BASE = "https://models.lunarwerx.com/api/v1";
const UA = "Mozilla/5.0 (compatible; PraisonAI-radar/1.0; local BYOK platform)";
const CACHE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

interface UpstreamCompany {
  key: string;
  label: string;
  lines: number;
}

interface UpstreamEstimator {
  key?: string;
  fit?: { within?: Record<string, number>; q50?: string };
}

interface UpstreamLine {
  line?: string;
  label?: string;
  what?: string;
  current?: { name?: string; date?: string };
  next?: { likely?: string; alternative?: string };
  waitDays?: number;
  estimators?: UpstreamEstimator[];
}

interface UpstreamOdds {
  generatedAt?: string;
  caveat?: string;
  companies?: UpstreamCompany[];
  lines?: UpstreamLine[];
}

export interface OddsRow {
  company: string;
  companyLabel: string;
  lineKey: string;
  lineLabel: string;
  what?: string;
  currentName?: string;
  currentDate?: string;
  nextName?: string;
  nextAlternative?: string;
  /** Days since the current model dropped (upstream "wait"). */
  waitDays?: number;
  /** 30-day odds range across upstream estimators (honest spread). */
  p30min: number;
  p30max: number;
  /** Median expected-date band from the primary estimator, if published. */
  q50?: string;
}

interface OddsPayload {
  generatedAt?: string;
  caveat?: string;
  upstreamFetchAt: string;
  rows: OddsRow[];
  errors: string[];
}

let cache: { at: number; payload: OddsPayload } | null = null;

function extractOdds(line: UpstreamLine): { min: number; max: number; q50?: string } {
  const p30s: number[] = [];
  let q50: string | undefined;
  for (const e of line.estimators ?? []) {
    const w = e.fit?.within;
    const v = w?.["30"];
    if (typeof v === "number" && v >= 0 && v <= 1) p30s.push(v);
    if (!q50 && e.fit?.q50) q50 = e.fit.q50;
  }
  if (p30s.length === 0) return { min: 0, max: 0, q50 };
  return { min: Math.min(...p30s), max: Math.max(...p30s), q50 };
}

function normalize(src: UpstreamOdds, company: string, label: string): OddsRow[] {
  const rows: OddsRow[] = [];
  for (const l of src.lines ?? []) {
    const { min, max, q50 } = extractOdds(l);
    rows.push({
      company,
      companyLabel: label,
      lineKey: l.line ?? "?",
      lineLabel: l.label ?? l.line ?? "?",
      what: l.what,
      currentName: l.current?.name,
      currentDate: l.current?.date,
      nextName: l.next?.likely,
      nextAlternative: l.next?.alternative,
      waitDays: typeof l.waitDays === "number" ? l.waitDays : undefined,
      p30min: min,
      p30max: max,
      q50,
    });
  }
  return rows;
}

async function fetchCompany(key: string): Promise<UpstreamOdds> {
  const res = await fetch(`${BASE}/odds?company=${encodeURIComponent(key)}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as UpstreamOdds;
}

async function gather(): Promise<OddsPayload> {
  // Bootstrap: the default response doubles as the company index AND
  // anthropic's own data (saves one upstream call).
  let bootstrap: UpstreamOdds | null = null;
  try {
    bootstrap = await fetchCompany("anthropic");
  } catch {
    bootstrap = null;
  }
  const companies: UpstreamCompany[] = bootstrap?.companies ?? [];
  const wanted = companies.filter((c) => c.key !== "anthropic");

  const settled = await Promise.allSettled(
    wanted.map((c) => fetchCompany(c.key))
  );

  const rows: OddsRow[] = [];
  const errors: string[] = [];
  if (bootstrap) {
    rows.push(...normalize(bootstrap, "anthropic", "Anthropic"));
  } else {
    errors.push("Anthropic: upstream unreachable");
  }
  wanted.forEach((c, i) => {
    const s = settled[i];
    if (s.status === "fulfilled") {
      rows.push(...normalize(s.value, c.key, c.label));
    } else {
      errors.push(`${c.label}: ${(s.reason as Error)?.message ?? "unreachable"}`);
    }
  });

  rows.sort((a, b) => b.p30max - a.p30max || (a.waitDays ?? 999) - (b.waitDays ?? 999));
  return {
    generatedAt: bootstrap?.generatedAt,
    caveat:
      bootstrap?.caveat ??
      "Statistical estimates from the public launch record, not a schedule from any company.",
    upstreamFetchAt: new Date().toISOString(),
    rows,
    errors,
  };
}

export async function GET() {
  try {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      return NextResponse.json({ ...cache.payload, cached: true });
    }
    const payload = await gather();
    cache = { at: Date.now(), payload };
    return NextResponse.json({ ...payload, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: "Model Odds upstream unreachable", detail: (e as Error).message },
      { status: 502 }
    );
  }
}
