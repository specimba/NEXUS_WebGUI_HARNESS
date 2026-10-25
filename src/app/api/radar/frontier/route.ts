import { NextResponse } from "next/server";
import { hfAuthHeaders } from "@/lib/server/hf-token";
import { decodeXml, parseArxivFeed } from "@/lib/server/tools";
// Types + PURE helpers only — ruleScores/fuseScores never touch localStorage,
// so they are safe on the server (the novelty axis is refined client-side
// against the real seed ledger; here it scores against an empty ledger).
import { fuseScores, ruleScores } from "@/lib/frontier-scout";
import {
  exaAuthHeaders,
  exaDialUrl,
  exaResponseToHouse,
  frontierQueryToExaBody,
} from "@/lib/exa-dialect";
import type { FrontierItem } from "@/lib/frontier-scout";

// ─── GET /api/radar/frontier — Frontier Scout aggregation (r511) ─────────────
// Trend ingestion for the judge cascade: three parallel free-hub source probes
// + one optional Exa acquisition lane (r531 — TASK-102 slice 6, env-gated) →
// normalized FrontierItem[] → cross-source dedupe (HF upvotes beat arXiv) →
// rule-rubric sort, capped. Partial-success doctrine: one source failing
// (403/429/timeout/garbage) never sinks the others — failures ride back as
// `errors[]` strings while the survivors ship. Module-level cache on
// globalThis (HMR-safe, capability-radar pattern), TTL 30 min, ?fresh=1 bypass.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_TIMEOUT_MS = 15_000;
const TTL_MS = 30 * 60 * 1000;

const NEXUS_UA =
  "Mozilla/5.0 (compatible; NEXUS-WebGUI/1.0; local-first agentic workflow platform)";

const MAX_HF = 16;
const MAX_GH = 12;
const MAX_ARXIV = 12;
const FINAL_CAP = 30;

// ─── HMR-safe cache on globalThis (capability-radar pattern) ─────────────────

interface FrontierPayload {
  items: FrontierItem[];
  errors: string[];
  fetchedAt: number;
}

const g = globalThis as unknown as {
  __frontierScoutCache?: { at: number; payload: FrontierPayload } | null;
};

// ─── Source 1: HuggingFace daily papers ──────────────────────────────────────

interface HfDailyRow {
  paper?: {
    id?: unknown;
    title?: unknown;
    summary?: unknown;
    authors?: Array<{ name?: unknown }>;
    publishedAt?: unknown;
    upvotes?: unknown;
  };
  publishedAt?: unknown;
  upvotes?: unknown;
}

function trim400(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 400 ? `${t.slice(0, 400)}…` : t;
}

async function fetchHfPapers(): Promise<{ items: FrontierItem[]; error?: string }> {
  try {
    const res = await fetch("https://huggingface.co/api/daily_papers?limit=30", {
      headers: { "User-Agent": NEXUS_UA, ...hfAuthHeaders() },
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (res.status === 403 || res.status === 429) {
      return { items: [], error: "huggingface-papers: rate-limited" };
    }
    if (!res.ok) return { items: [], error: `huggingface-papers: HTTP ${res.status}` };
    const batch: unknown = await res.json();
    if (!Array.isArray(batch)) {
      return { items: [], error: "huggingface-papers: unexpected response shape" };
    }
    const now = Date.now();
    const items: FrontierItem[] = [];
    for (const row of batch as HfDailyRow[]) {
      const paper = row?.paper;
      if (!paper || typeof paper.id !== "string" || !paper.id) continue;
      if (typeof paper.title !== "string" || !paper.title.trim()) continue;
      const authors = Array.isArray(paper.authors)
        ? paper.authors
            .map((a) => (a && typeof a.name === "string" ? a.name.trim() : ""))
            .filter(Boolean)
            .slice(0, 3)
            .join(", ")
        : undefined;
      const upvotes =
        typeof row.upvotes === "number"
          ? row.upvotes
          : typeof paper.upvotes === "number"
            ? paper.upvotes
            : 0;
      const createdAt =
        typeof row.publishedAt === "string"
          ? row.publishedAt
          : typeof paper.publishedAt === "string"
            ? paper.publishedAt
            : undefined;
      items.push({
        id: `hf:${paper.id}`,
        kind: "paper",
        hub: "huggingface-papers",
        url: `https://huggingface.co/papers/${paper.id}`,
        title: decodeXml(paper.title).replace(/\s+/g, " ").trim(),
        summary: typeof paper.summary === "string" ? trim400(paper.summary) : "",
        ...(authors ? { authors } : {}),
        upvotes,
        ...(createdAt ? { createdAt } : {}),
        fetchedAt: now,
      });
      if (items.length >= MAX_HF) break;
    }
    return { items };
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message);
    return {
      items: [],
      error: timedOut
        ? "huggingface-papers: timed out after 15s"
        : `huggingface-papers: ${err instanceof Error ? err.message : "unreachable"}`,
    };
  }
}

// ─── Source 2: GitHub newly-minted agent/RL repos ────────────────────────────

interface GhSearchRow {
  full_name?: unknown;
  html_url?: unknown;
  description?: unknown;
  stargazers_count?: unknown;
  topics?: unknown;
  created_at?: unknown;
  owner?: { login?: unknown };
}

async function fetchGithubRepos(): Promise<{ items: FrontierItem[]; error?: string }> {
  try {
    const sinceISO = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    // NOTE (r511): GitHub's search API rejects `topic:X OR topic:Y` with 422
    // "Logical operators only apply to text, not to qualifiers" — probed live.
    // The any-of intent survives as bare text terms (OR valid on text), which
    // match repo name/description/readme for the same four concept areas.
    const q =
      "llm-agents OR agent-framework OR post-training OR rlhf " +
      `created:>${sinceISO}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": NEXUS_UA,
    };
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}` +
        "&sort=stars&order=desc&per_page=15",
      { headers, signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) }
    );
    if (res.status === 403 || res.status === 429) {
      return { items: [], error: `github: ${res.status} rate-limited` };
    }
    if (!res.ok) return { items: [], error: `github: HTTP ${res.status}` };
    const body: unknown = await res.json();
    const rows =
      body && typeof body === "object" && Array.isArray((body as { items?: unknown }).items)
        ? ((body as { items: unknown[] }).items as GhSearchRow[])
        : null;
    if (!rows) return { items: [], error: "github: unexpected response shape" };

    const now = Date.now();
    const items: FrontierItem[] = [];
    for (const r of rows) {
      if (!r || typeof r.full_name !== "string" || !r.full_name) continue;
      const topics = Array.isArray(r.topics)
        ? (r.topics as unknown[]).slice(0, 6).map(String)
        : [];
      items.push({
        id: `gh:${r.full_name}`,
        kind: "repo",
        hub: "github",
        url: typeof r.html_url === "string" ? r.html_url : `https://github.com/${r.full_name}`,
        title: r.full_name,
        summary: typeof r.description === "string" ? trim400(r.description) : "",
        ...(typeof r.owner?.login === "string" ? { authors: r.owner.login } : {}),
        stars: typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
        ...(topics.length ? { topics } : {}),
        ...(typeof r.created_at === "string" ? { createdAt: r.created_at } : {}),
        fetchedAt: now,
      });
      if (items.length >= MAX_GH) break;
    }
    return { items };
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message);
    return {
      items: [],
      error: timedOut
        ? "github: timed out after 15s"
        : `github: ${err instanceof Error ? err.message : "unreachable"}`,
    };
  }
}

// ─── Source 3: arXiv harness/RL feed (reuses the shared Atom parser) ─────────

async function fetchArxivHarness(): Promise<{ items: FrontierItem[]; error?: string }> {
  try {
    const inner =
      '(all:"agent harness" OR all:"agentic reinforcement learning" OR all:"post-training" ' +
      'OR all:"LLM judge" OR all:"reward hacking")';
    const feedUrl =
      `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(inner)}` +
      "&start=0&max_results=12&sortBy=submittedDate&sortOrder=descending";
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": NEXUS_UA },
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (!res.ok) return { items: [], error: `arxiv: HTTP ${res.status}` };
    const xml = await res.text();
    const papers = parseArxivFeed(xml);
    const now = Date.now();
    const items: FrontierItem[] = papers.slice(0, MAX_ARXIV).map((p) => ({
      id: `arxiv:${p.id}`,
      kind: "paper",
      hub: "arxiv",
      url: p.pdf || `https://arxiv.org/abs/${p.id}`,
      title: p.title,
      summary: trim400(p.summary),
      ...(p.authors ? { authors: p.authors } : {}),
      ...(p.published ? { createdAt: p.published } : {}),
      fetchedAt: now,
    }));
    return { items };
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message);
    return {
      items: [],
      error: timedOut
        ? "arxiv: timed out after 15s"
        : `arxiv: ${err instanceof Error ? err.message : "unreachable"}`,
    };
  }
}

// ─── Source 4: Exa acquisition lane (r531 — TASK-102 slice 6) ────────────────
// The NEXUS_BOT wave's acquisition dialect: Exa /search (POST + x-api-key,
// results[] rows) parsed into house FrontierItems via src/lib/exa-dialect.ts.
// Gated on EXA_API_KEY — the SAME machine-secret pattern this route's GitHub
// source already uses for GITHUB_TOKEN. Unconfigured ⇒ the lane contributes
// NOTHING (no items, no error row) and the three free hubs stay byte-identical.

const EXA_FRONTIER_QUERY =
  "agentic LLM workflow harness judge post-training release announcement";

async function fetchExaAcquisition(): Promise<{ items: FrontierItem[]; error?: string }> {
  const key = process.env.EXA_API_KEY?.trim();
  if (!key) return { items: [] }; // lane unconfigured — silent, not an error
  try {
    const res = await fetch(exaDialUrl("https://api.exa.ai"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": NEXUS_UA,
        ...exaAuthHeaders(key),
      },
      body: JSON.stringify(frontierQueryToExaBody(EXA_FRONTIER_QUERY, { numResults: 8 })),
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      return { items: [], error: `exa: auth rejected (HTTP ${res.status})` };
    }
    if (res.status === 402 || res.status === 429) {
      return { items: [], error: `exa: ${res.status === 402 ? "credits exhausted" : "rate-limited"}` };
    }
    if (!res.ok) return { items: [], error: `exa: HTTP ${res.status}` };
    const payload: unknown = await res.json();
    return exaResponseToHouse(payload, Date.now());
  } catch (err) {
    const timedOut = err instanceof Error && /timeout|timed? ?out|aborted/i.test(err.message);
    return {
      items: [],
      error: timedOut
        ? "exa: timed out after 15s"
        : `exa: ${err instanceof Error ? err.message : "unreachable"}`,
    };
  }
}

// ─── Cross-source dedupe + rule-rubric sort ──────────────────────────────────

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function aggregate(): Promise<FrontierPayload> {
  const settled = await Promise.allSettled([
    fetchHfPapers(),
    fetchGithubRepos(),
    fetchArxivHarness(),
    fetchExaAcquisition(),
  ]);

  const ordered: FrontierItem[] = [];
  const errors: string[] = [];
  const labels = ["huggingface-papers", "github", "arxiv", "exa"] as const;

  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      ordered.push(...r.value.items);
      if (r.value.error) errors.push(r.value.error);
    } else {
      const why = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push(`${labels[i]}: ${why}`);
    }
  });

  // Title-normalized dedupe — sources are probed HF → GitHub → arXiv, so the
  // HF copy of a paper (which carries upvotes) survives over the arXiv twin.
  const seenTitles = new Set<string>();
  const seenIds = new Set<string>();
  const deduped: FrontierItem[] = [];
  for (const item of ordered) {
    const key = normalizeTitle(item.title);
    if (key && seenTitles.has(key)) continue;
    if (seenIds.has(item.id)) continue;
    if (key) seenTitles.add(key);
    seenIds.add(item.id);
    deduped.push(item);
  }

  // Server-side rubric sort (empty ledger — novelty refined client-side).
  const items = deduped
    .sort((a, b) => fuseScores(ruleScores(b, [])) - fuseScores(ruleScores(a, [])))
    .slice(0, FINAL_CAP);

  return { items, errors, fetchedAt: Date.now() };
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fresh = url.searchParams.get("fresh") === "1";

  const hit = g.__frontierScoutCache;
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ ok: true, cached: true, ...hit.payload });
  }

  const payload = await aggregate();
  g.__frontierScoutCache = { at: Date.now(), payload };
  return NextResponse.json({ ok: true, ...payload });
}
