import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { CHAT_PROVIDERS, providerBaseUrl } from "@/lib/providers";
import {
  provider429CooldownLeftMs,
  providerBillingDeadLeftMs,
} from "@/lib/provider-rotation";
import { egressRelayDial } from "@/lib/server/egress";
import { redactDialBody } from "@/lib/redaction";
import {
  advanceStrategyItem,
  appendDigestEntries,
  listAdvancableItems,
  maybeAutoAdaptItem,
} from "@/lib/server/strategy";

// ─── r515: Autonomous Improvement Engine (AIE) ───────────────────────────────
// Owner directive (r515): the external 15-min cron patrol kept getting purged
// (7× and counting) — "the platform itself must carry autonomy". The AIE is a
// DETERMINISTIC, VAULT-FREE 10-minute server loop, booted HMR-safe exactly
// like the capability radar: it fires with zero provider keys and a closed
// tab, because that is the whole point (autonomy cannot depend on a lane
// that needs an owner present).
//
// The loop, one cycle per 10-minute UTC bucket (idempotent id "cyc_<bucket>"):
//   1. SIGNALS  — ResearchQueue backlog, latest radar digest, 24h run-archive
//                 failure rate, vault slot count, existing fresh proposals.
//   2. PROPOSE  — 1-5 ranked NextMove rows (deterministic ranking; ONE
//                 optional no-key free-lane LLM call may enrich the top
//                 move's rationale — 6s timeout, fail-open to deterministic).
//   3. EXECUTE  — top 1-2 SAFE moves only, never more than 2 repos/cycle
//                 (GitHub unauthenticated budget 60 req/h; "researched"
//                 rows are the cache and are never re-fetched).
//   4. LOG      — one AutonomyLog cycle row; every 6th consecutive cycle
//                 (or 24h since the last) an AutonomyLog report row with
//                 honest 24h stats.
//
// WHAT IT IS NOT: no workflow mutations (import-seed is an honest no-op —
// seeds stay owner-copy), no LLM step dials inside move execution, no
// provider keys anywhere. The single optional enricher dial rides the same
// built-in no-key lane /api/tools/execute already uses and must fail open.

export const AUTONOMY_INTERVAL_MS = 10 * 60_000;
const FIRST_PASS_DELAY_MS = 15_000;
const ENRICH_TIMEOUT_MS = 6_000;
const GITHUB_TIMEOUT_MS = 8_000;
/** GitHub unauthenticated budget is 60 req/h — hard cap per cycle. */
const MAX_REPOS_PER_CYCLE = 2;
const QUEUE_CAP = 500;
const NOTES_MAX = 2_000;
const RESULT_MAX = 2_000;
const SUMMARY_MAX = 500;
/** Don't pile up proposals: ≥3 fresh (<2h) proposed moves suppresses a new batch. */
const FRESH_PROPOSAL_LIMIT = 3;
const FRESH_PROPOSAL_WINDOW_MS = 2 * 3_600_000;
const SEED_MOVE_COOLDOWN_MS = 6 * 3_600_000;
const FOLLOWUP_MOVE_COOLDOWN_MS = 24 * 3_600_000;
/** r515-c: an identical "await-owner" no-op every cycle is noise, not honesty
 * (the owner screenshot showed 5 copies). Once per 6h is plenty. */
const AWAIT_OWNER_COOLDOWN_MS = 6 * 3_600_000;
/** Report cadence: every 6th consecutive cycle, or 24h since the last report. */
const REPORT_EVERY_N_CYCLES = 6;

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The UTC 10-minute bucket "2026-10-18T17:20Z" — deterministic row id. */
function tenMinBucketOf(d = new Date()): string {
  return `${d.toISOString().slice(0, 16)}Z`;
}

/** ulid-ish id: timestamp (base36, sortable) + 6 chars of entropy. */
function mvId(): string {
  return `mv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function errorClass(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (m.includes("abort") || m.includes("timed out") || m.includes("timeout")) return "timeout";
  if (m.includes("404") || m.includes("not found")) return "not-found";
  if (m.includes("403") || m.includes("forbidden") || m.includes("rate limit")) return "rate-limited-or-forbidden";
  if (m.includes("429") || m.includes("too many requests")) return "rate-limited";
  if (m.includes("fetch") || m.includes("network") || m.includes("econnrefused") || m.includes("enotfound"))
    return "network";
  if (m.includes("envelope") || m.includes("json") || m.includes("parse")) return "bad-payload";
  return trunc(e instanceof Error ? e.message : String(e), 120) || "unknown";
}

// ─── Research queue normalization + bulk import ──────────────────────────────

export interface NormalizedTarget {
  id: string;
  kind: "repo" | "url";
  owner: string | null;
  repo: string | null;
  url: string | null;
}

const GH_RE = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i;

/** "https://github.com/Owner/Repo/tree/main" → "gh:owner/repo"; anything
 * else that parses as an absolute http(s) URL → "url:<sha1-12>". */
export function normalizeResearchTarget(raw: string): NormalizedTarget | null {
  const s = raw
    .trim()
    .replace(/^["'<([{]+|["'>)\]}]+$/g, "")
    .trim();
  if (!s) return null;
  const gh = s.match(GH_RE);
  if (gh) {
    const owner = gh[1].toLowerCase().replace(/\.git$/, "");
    const repo = gh[2].toLowerCase().replace(/\.git$/, "");
    if (!owner || !repo || owner === "." || repo === ".") return null;
    return { id: `gh:${owner}/${repo}`, kind: "repo", owner, repo, url: `https://github.com/${owner}/${repo}` };
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    const norm = u.toString();
    return { id: `url:${createHash("sha1").update(norm).digest("hex").slice(0, 12)}`, kind: "url", owner: null, repo: null, url: norm };
  } catch {
    return null;
  }
}

export interface EnqueueResult {
  inserted: number;
  duplicates: number;
  invalid: number;
  /** True when the 500-row cap stopped some valid rows short. */
  capped?: boolean;
}

/** Bulk-insert into ResearchQueue with normalization + dedupe (cap 500 rows).
 * Duplicate = the normalized id already exists (in-batch or in ANY row
 * status — the queue is the cache, so re-importing a researched repo must
 * not re-queue it). Honest counts: {inserted, duplicates, invalid}. */
export async function enqueueResearchTargets(urls: unknown, source = "manual"): Promise<EnqueueResult> {
  const list = Array.isArray(urls) ? urls.filter((u): u is string => typeof u === "string") : [];
  let invalid = 0;
  const unique = new Map<string, NormalizedTarget>();
  for (const raw of list) {
    const t = normalizeResearchTarget(raw);
    if (!t) {
      invalid += 1;
      continue;
    }
    if (!unique.has(t.id)) unique.set(t.id, t);
  }
  const inBatchDupes = list.length - invalid - unique.size;

  const uniqueIds = [...unique.keys()];
  const existing = uniqueIds.length
    ? await db.researchQueue.findMany({ where: { id: { in: uniqueIds } }, select: { id: true } })
    : [];
  const existingIds = new Set(existing.map((r) => r.id));
  const fresh = uniqueIds.filter((id) => !existingIds.has(id)).map((id) => unique.get(id)!);
  const duplicates = inBatchDupes + (unique.size - fresh.length);

  const total = await db.researchQueue.count();
  const room = Math.max(0, QUEUE_CAP - total);
  const insertable = fresh.slice(0, room);
  const capped = fresh.length > room;
  if (insertable.length > 0) {
    await db.researchQueue.createMany({
      data: insertable.map((t) => ({
        id: t.id,
        kind: t.kind,
        owner: t.owner,
        repo: t.repo,
        url: t.url,
        source,
        status: "queued",
      })),
    });
  }
  return { inserted: insertable.length, duplicates, invalid, ...(capped ? { capped: true } : {}) };
}

// ─── Signals ─────────────────────────────────────────────────────────────────

interface RadarDigestShim {
  findings?: { severity?: string; title?: string; evidence?: string; area?: string }[];
  seeds?: { label: string; prompt: string }[];
}

async function latestRadarDigest(): Promise<RadarDigestShim | null> {
  const row = await db.capabilityCheck.findFirst({ orderBy: { createdAt: "desc" }, select: { digestJson: true } });
  if (!row?.digestJson) return null;
  try {
    return JSON.parse(row.digestJson) as RadarDigestShim;
  } catch {
    return null;
  }
}

// ─── The optional rationale enricher (the ONLY LLM dial in the engine) ───────

function healthyFreeLane(): { id: string; baseUrl: string; model: string } | null {
  for (const reg of CHAT_PROVIDERS) {
    if (reg.noKey !== true) continue;
    if (provider429CooldownLeftMs(reg.id) > 0) continue; // 429-cooling = not healthy
    if (providerBillingDeadLeftMs(reg.id) > 0) continue;
    const baseUrl = providerBaseUrl(reg);
    if (!baseUrl) continue;
    const first = Array.isArray(reg.models) ? reg.models[0] : undefined;
    const model = typeof first === "string" ? first : (first as { id?: string } | undefined)?.id ?? "";
    if (!model) continue;
    return { id: reg.id, baseUrl: baseUrl.replace(/\/$/, ""), model };
  }
  return null;
}

/** ONE optional no-key dial that rewrites the top move's rationale. Vault-free
 * by doctrine (the lane is the built-in free one); ANY error → null and the
 * caller keeps the deterministic rationale (fail-open, always). */
async function enrichRationale(title: string, rationale: string): Promise<{ text: string; providerId: string } | null> {
  const lane = healthyFreeLane();
  if (!lane) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ENRICH_TIMEOUT_MS);
  try {
    const res = await egressRelayDial(`${lane.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        redactDialBody({
          model: lane.model,
          messages: [
            {
              role: "system",
              content:
                "You tighten rationales for an automation engine. Reply with ONE sentence, max 180 characters, concrete, no filler, no quotes.",
            },
            {
              role: "user",
              content: `Move: ${title}\nDeterministic rationale: ${rationale}\nReply with the improved sentence only.`,
            },
          ],
          max_tokens: 90,
          temperature: 0.4,
        }),
      ),
      signal: ac.signal,
    });
    if (!res.ok) {
      await res.text().catch(() => "");
      return null;
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (j.choices?.[0]?.message?.content ?? "").replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "");
    if (!text || text.length > 300) return null;
    return { text, providerId: lane.id };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Move generation ─────────────────────────────────────────────────────────

export type MoveKind =
  | "research-repo"
  | "advance-strategy"
  | "import-seed"
  | "run-workflow"
  | "radar-followup"
  | "await-owner";

interface MoveDraft {
  rank: number;
  kind: MoveKind;
  title: string;
  rationale: string;
  payload: Record<string, unknown>;
}

/** Deterministic proposal pass. Returns the created NextMove rows (0-5).
 * Suppressed entirely when ≥3 fresh (<2h) proposals already sit unexecuted —
 * the engine must not bury its own backlog under new paper. */
export async function generateNextMoves(
  cycleId: string,
): Promise<{ moves: { id: string; title: string; kind: string; status: string }[]; suppressed: boolean; laneUsed: string }> {
  const freshProposed = await db.nextMove.count({
    where: { status: "proposed", createdAt: { gte: new Date(Date.now() - FRESH_PROPOSAL_WINDOW_MS) } },
  });
  if (freshProposed >= FRESH_PROPOSAL_LIMIT) {
    return { moves: [], suppressed: true, laneUsed: "deterministic" };
  }

  const [queuedRows, repoRows, vaultSlots, digest, run24] = await Promise.all([
    db.researchQueue.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: 1, // oldest queued row (any kind) — only used for the age note
    }),
    // r515 fix: the take window previously sat BEFORE the kind filter, so a
    // handful of leading non-repo rows (gitcode/profile URLs) starved every
    // gh: row out of the cycle — 53 queued, zero research drafts. Filter
    // FIRST, then take.
    db.researchQueue.findMany({
      where: { status: "queued", kind: "repo", owner: { not: null }, repo: { not: null } },
      orderBy: { createdAt: "asc" },
      take: MAX_REPOS_PER_CYCLE,
    }),
    db.automationVault.count(),
    latestRadarDigest(),
    db.runReport.findMany({
      where: { startedAt: { gte: new Date(Date.now() - 24 * 3_600_000) } },
      select: { status: true },
    }),
  ]);

  const drafts: MoveDraft[] = [];
  let rank = 0;
  const nextRank = () => ++rank;

  // 1) Drain the research backlog first — the only move that produces new
  //    first-party data, and the one the 60 req/h budget governs.
  const queuedCount = await db.researchQueue.count({ where: { status: "queued" } });
  const oldestQueued = queuedRows[0] ?? null;
  for (const row of repoRows) {
    if (!row.owner || !row.repo) continue; // typed-narrowing guard; where already filters
    drafts.push({
      rank: nextRank(),
      kind: "research-repo",
      title: `Research ${row.owner}/${row.repo}`,
      rationale: `Backlog: ${queuedCount} queued${oldestQueued ? `, oldest ${Math.max(1, Math.round((Date.now() - oldestQueued.createdAt.getTime()) / 60_000))}m` : ""} — unauthenticated GitHub research is vault-free and cached (researched rows never re-fetched).`,
      payload: { queueId: row.id },
    });
  }

  // 1.5) Strategy advancement — the SCL connection (r515-c). Open backlog
  //      items from the Strategic Context Layer rank right after the budget-
  //      governed research drain: the engine's data-only move touches the item
  //      (advancedAt/Count) and appends a digest line the next briefing
  //      carries. Implementation itself stays the chat-side architect's lane
  //      (AGENT.md doctrine) — the engine never edits code or workflows.
  const advancable = await listAdvancableItems(2);
  for (const item of advancable) {
    drafts.push({
      rank: nextRank(),
      kind: "advance-strategy",
      title: `Advance ${item.id}: ${trunc(item.title, 84)}`,
      rationale: trunc(
        item.nextAction || "No next action recorded — advance + digest so the next briefing carries it.",
        240,
      ),
      payload: { itemId: item.id },
    });
  }

  // 2) Radar seeds — honest import is owner-copy only (workflow mutation is
  //    out of AIE doctrine). Cooldown prevents re-proposing the same no-op.
  const seeds = digest?.seeds ?? [];
  if (seeds.length > 0) {
    const lastSeedMove = await db.nextMove.findFirst({
      where: { kind: "import-seed", status: { in: ["executed", "skipped"] } },
      orderBy: { executedAt: "desc" },
      select: { executedAt: true },
    });
    if (!lastSeedMove?.executedAt || Date.now() - lastSeedMove.executedAt.getTime() >= SEED_MOVE_COOLDOWN_MS) {
      drafts.push({
        rank: nextRank(),
        kind: "import-seed",
        title: `Import ${seeds.length} radar seed${seeds.length === 1 ? "" : "s"}`,
        rationale: `Latest digest holds ${seeds.length} improvement seed${seeds.length === 1 ? "" : "s"} (top: "${trunc(seeds[0].label, 60)}") — AIE honestly no-ops the import; seeds stay owner-copy.`,
        payload: { seedCount: seeds.length, topLabel: seeds[0].label },
      });
    }
  }

  // 3) Critical radar findings / 24h run failures — followups are honest
  //    no-ops that surface the owner decision, never silent mutations.
  const criticals = (digest?.findings ?? []).filter((f) => f.severity === "critical");
  const total24 = run24.length;
  const bad24 = run24.filter((r) => r.status === "error" || r.status === "blocked").length;
  const failureRate = total24 > 0 ? bad24 / total24 : 0;
  const lastFollowup = await db.nextMove.findFirst({
    where: { kind: "radar-followup", status: { in: ["executed", "skipped"] } },
    orderBy: { executedAt: "desc" },
    select: { executedAt: true },
  });
  const followupCooled =
    !lastFollowup?.executedAt || Date.now() - lastFollowup.executedAt.getTime() >= FOLLOWUP_MOVE_COOLDOWN_MS;
  if (followupCooled) {
    if (criticals.length > 0) {
      const f = criticals[0];
      drafts.push({
        rank: nextRank(),
        kind: "radar-followup",
        title: `Follow up: ${trunc(f.title ?? "critical radar finding", 80)}`,
        rationale: `Radar reports ${criticals.length} critical finding${criticals.length === 1 ? "" : "s"} — evidence: ${trunc(f.evidence ?? "none recorded", 140)}`,
        payload: { finding: f.title ?? "", area: f.area ?? "" },
      });
    } else if (total24 >= 3 && failureRate >= 0.34) {
      drafts.push({
        rank: nextRank(),
        kind: "radar-followup",
        title: `Investigate run-archive failure streak (${Math.round(failureRate * 100)}% of ${total24} in 24h)`,
        rationale: `The 24h run archive shows ${bad24} of ${total24} runs error/blocked — above the 34% attention line. Owner decision required.`,
        payload: { failureRate, total24, bad24 },
      });
    }
  }

  // 4) Nothing to do — say so honestly instead of manufacturing work, and
  //    say it ONCE per cooldown window (r515-c: the owner's screenshot showed
  //    five identical await-owner rows piling up cycle after cycle).
  if (drafts.length === 0) {
    const lastAwaitOwner = await db.nextMove.findFirst({
      where: { kind: "await-owner", status: { in: ["executed", "skipped"] } },
      orderBy: { executedAt: "desc" },
      select: { executedAt: true },
    });
    const awaitOwnerCooled =
      !lastAwaitOwner?.executedAt ||
      Date.now() - lastAwaitOwner.executedAt.getTime() >= AWAIT_OWNER_COOLDOWN_MS;
    if (awaitOwnerCooled) {
      drafts.push({
        rank: nextRank(),
        kind: "await-owner",
        title: "Backlog empty — propose the next focus",
        rationale:
          vaultSlots === 0
            ? "No queued research, no strategy items, no critical findings, no fresh seeds; the vault is empty so closed-tab LLM lanes are dormant by doctrine. Owner decision required."
            : "No queued research, no strategy items, no critical findings, no fresh seeds. Owner decision required.",
        payload: { queued: queuedCount, criticals: criticals.length, seeds: seeds.length, vaultSlots },
      });
    }
  }

  const ranked = drafts.slice(0, 5).map((d) => ({ ...d, rank: d.rank }));

  // ONE optional enricher dial for the top move — 6s timeout, fail-open.
  let laneUsed = "deterministic";
  if (ranked.length > 0) {
    const enriched = await enrichRationale(ranked[0].title, ranked[0].rationale);
    if (enriched) {
      ranked[0] = { ...ranked[0], rationale: enriched.text };
      laneUsed = `free-lane:${enriched.providerId}`;
    } else {
      laneUsed = "deterministic (enricher unavailable or failed open)";
    }
  }

  if (ranked.length === 0) return { moves: [], suppressed: true, laneUsed };

  await db.nextMove.createMany({
    data: ranked.map((d) => ({
      id: mvId(),
      cycleId,
      rank: d.rank,
      kind: d.kind,
      title: trunc(d.title, 200),
      rationale: trunc(d.rationale, 600),
      payloadJson: JSON.stringify(d.payload),
      status: "proposed",
    })),
  });
  const created = await db.nextMove.findMany({
    where: { cycleId },
    orderBy: { rank: "asc" },
    select: { id: true, title: true, kind: true, status: true },
  });
  return { moves: created, suppressed: false, laneUsed };
}

// ─── Move execution (SAFE moves only, vault-free) ────────────────────────────

interface GithubRepo {
  full_name?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  language?: string | null;
  topics?: string[];
  pushed_at?: string | null;
  archived?: boolean;
  license?: { spdx_id?: string | null } | null;
}

const PLATFORM_VOCAB = [
  "agent", "llm", "automation", "workflow", "tool", "mcp", "rag", "vector", "embedding",
  "search", "crawl", "browser", "model", "inference", "scheduler", "pipeline", "sdk",
  "api", "free", "proxy", "storage", "sync", "cli", "server",
];

const STOPWORDS = new Set(
  ("a an and are as at be but by for from has have how in into is it its of on or that the " +
    "this to with you your can will not use using used when which who what why data code " +
    "com www http https github org license mit file files source build built run running " +
    "install installation example examples default support supported new version release " +
    "readme please see more also about get set setup start quick features feature docs " +
    "documentation test tests types type true false null none then than them they there").split(" "),
);

function extractKeywords(text: string, max = 10): string[] {
  const freq = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z0-9+#.]{2,}/g) ?? []) {
    const w = raw.replace(/[.+#]+$/, "");
    if (w.length < 3 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

/** Deterministic 0-10 relevance score — no LLM, pure first-party math. */
function scoreRepo(repo: GithubRepo, readmeExcerpt: string): { score: number; keywords: string[] } {
  const stars = repo.stargazers_count ?? 0;
  let score = Math.min(3, Math.log10(stars + 1) / 1.3);
  const pushed = repo.pushed_at ? new Date(repo.pushed_at).getTime() : 0;
  const ageDays = pushed ? (Date.now() - pushed) / 86_400_000 : Infinity;
  if (ageDays <= 30) score += 2;
  else if (ageDays <= 180) score += 1.5;
  else if (ageDays <= 365) score += 1;
  else if (Number.isFinite(ageDays)) score += 0.5;
  const topics = (repo.topics ?? []).filter(Boolean);
  if (topics.length >= 3) score += 1;
  else if (topics.length > 0) score += 0.5;
  if (repo.description) score += 0.5;
  const haystack = `${repo.description ?? ""}\n${topics.join(" ")}\n${readmeExcerpt}`.toLowerCase();
  const keywords = extractKeywords(readmeExcerpt || `${repo.description ?? ""} ${topics.join(" ")}`);
  const hits = PLATFORM_VOCAB.filter((v) => haystack.includes(v)).length;
  score += Math.min(2, hits * 0.4);
  if (repo.archived) score = Math.min(score, 3.5);
  return { score: Math.max(0, Math.min(10, Math.round(score * 10) / 10)), keywords };
}

function verdictFor(score: number): "ADAPT" | "WATCH" | "SKIP" {
  if (score >= 7) return "ADAPT";
  if (score >= 4) return "WATCH";
  return "SKIP";
}

async function fetchGithub(url: string, accept: string): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), GITHUB_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { "User-Agent": "nexus-webgui-autonomy", Accept: accept },
      signal: ac.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

// ── r540: the url-kind research lane (TASKS P2) ───────────────────────────
// Queued url rows used to blanket-skip with "no research lane wired" — they
// now get a DIRECT page reader: title + og:description + visible text head,
// scored through the SAME deterministic rubric as repos (scoreRepo over a
// synthesized GithubRepo). No stars/topics/freshness signals exist for a
// plain page, so those terms score neutrally; the vocabulary haystack still
// decides. Never dials an LLM. Failures land in the same honest-failure
// shape as repos (status failed + error class note).

const PAGE_TIMEOUT_MS = 15_000;
const PAGE_CAP = 400_000;

async function fetchPage(url: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "nexus-webgui-autonomy", Accept: "text/html,application/xhtml+xml" },
      signal: ac.signal,
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      throw new Error(`non-html content-type: ${type.split(";")[0]}`);
    }
    return (await res.text()).slice(0, PAGE_CAP);
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** Deterministic extraction — og: tags first with honest fallbacks, entity-
 *  decoded, whitespace collapsed. Exported for the fixture QA. */
export function pageToHouse(
  html: string,
): { title: string; description: string; textHead: string } {
  const pick = (re: RegExp): string => {
    const m = html.match(re);
    return m?.[1] ? decodeHtmlEntities(m[1]).replace(/\s+/g, " ").trim() : "";
  };
  const title =
    pick(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i) ||
    pick(/<title[^>]*>([^<]*)<\/title>/i);
  const description =
    pick(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i) ||
    pick(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i);
  const textHead = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_200);
  return { title, description, textHead };
}

/** Research one queued url-kind row by reading the page directly. */
async function researchUrlPage(row: { id: string; url: string }): Promise<string> {
  try {
    const parsed = (() => {
      try {
        return new URL(row.url);
      } catch {
        return null;
      }
    })();
    if (!parsed) throw new Error("unparsable URL");
    const html = await fetchPage(row.url);
    const { title, description, textHead } = pageToHouse(html);
    if (!title && !description && !textHead) {
      throw new Error("page carried no title/description/text worth distilling");
    }
    const synthesized: GithubRepo = {
      full_name: `${parsed.host}${parsed.pathname.slice(0, 80)}`,
      description: description || undefined,
      stargazers_count: 0,
      forks_count: 0,
      pushed_at: undefined,
      topics: [],
      language: undefined,
      license: undefined,
      archived: false,
    };
    const { score, keywords } = scoreRepo(synthesized, `${title}\n${textHead}`);
    const verdict = verdictFor(score);
    const notes = [
      `${row.url}`,
      `title: ${title || "(none)"}`,
      `description: ${description || "(no og:description / meta description)"}`,
      `keywords: ${keywords.length ? keywords.join(", ") : "(none)"}`,
      `page: ${html.length.toLocaleString()} chars fetched · ${textHead.length} chars of visible text distilled`,
      `source: page-reader (direct fetch, deterministic rubric — no LLM)`,
    ].join("\n");
    await db.researchQueue.update({
      where: { id: row.id },
      data: { status: "researched", score: Math.round(score), verdict, notes: trunc(notes, NOTES_MAX), researchedAt: new Date() },
    });
    return `researched ${parsed.host}: score ${Math.round(score)}/10 → ${verdict} (page reader)`;
  } catch (e) {
    const cls = errorClass(e);
    await db.researchQueue.update({
      where: { id: row.id },
      data: { status: "failed", notes: `error class: ${cls}`, researchedAt: new Date() },
    });
    return `honest failure — ${cls}`;
  }
}

/** Research one queued repo against the REAL unauthenticated GitHub API and
 * distill it locally (deterministic — never dials an LLM here). The
 * ResearchQueue row IS the cache: status flips to researched (or failed) and
 * researched rows are never re-fetched. */
async function researchRepo(queueId: string): Promise<string> {
  const row = await db.researchQueue.findUnique({ where: { id: queueId } });
  if (!row) return "queue row vanished before execution — honest no-op";
  if (row.status === "researched") {
    return `already researched (cache doctrine — researched rows are never re-fetched; verdict ${row.verdict ?? "?"} ${row.score ?? "?"}/10)`;
  }
  if (row.status !== "queued") return `not queued (status ${row.status}) — honest no-op`;
  if (row.kind !== "repo" || !row.owner || !row.repo) {
    // r540: url rows get a REAL lane now — a direct page reader (title +
    // og:description + visible text head, same deterministic scoring shape).
    // Rows without a fetchable URL keep the honest skip.
    if (row.kind === "url" && row.url && /^https?:\/\//i.test(row.url)) {
      // narrow at the call site — the whole-row pass defeats TS's url narrowing
      return researchUrlPage({ id: row.id, url: row.url });
    }
    await db.researchQueue.update({
      where: { id: row.id },
      data: { status: "skipped", notes: "non-repo target without a fetchable URL — no research lane", researchedAt: new Date() },
    });
    return "skipped: non-repo target without a fetchable URL";
  }

  try {
    let repo!: GithubRepo;
    let via = "api";
    let readmeExcerpt = "";
    let readmeNote = "README: none/fetch-failed (research continued)";
    const repoRes = await fetchGithub(`https://api.github.com/repos/${row.owner}/${row.repo}`, "application/vnd.github+json");
    if (repoRes.status === 404) throw new Error("404 not found");
    if (repoRes.status === 403 || repoRes.status === 429 || !repoRes.ok) {
      // r515: api.github.com is frequently rate-limited from shared sandbox
      // egress (403 with quota remaining 0) while github.com HTML stays 200.
      // Fallback: scrape the repo page (og:description + embedded
      // stargazerCount) and commits.atom (freshness) — same scoring pipeline,
      // honestly labelled "html-fallback" in the notes.
      const [htmlRes, atomRes] = await Promise.all([
        fetchGithub(`https://github.com/${row.owner}/${row.repo}`, "text/html").catch(() => null),
        fetchGithub(`https://github.com/${row.owner}/${row.repo}/commits.atom`, "application/atom+xml").catch(() => null),
      ]);
      if (!htmlRes || !htmlRes.ok) throw new Error(repoRes.status === 403 || repoRes.status === 429 ? `${repoRes.status} rate-limited/forbidden` : `http ${repoRes.status}`);
      const html = (await htmlRes.text()).slice(0, 400_000);
      const desc =
        html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i)?.[1] ??
        html.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i)?.[1] ??
        "";
      const stars = Number(html.match(/"stargazerCount":(\d+)/)?.[1] ?? html.match(/([\d,.]+)\s+stars/i)?.[1]?.replace(/[,.]/g, "") ?? 0);
      let pushedAt: string | undefined;
      if (atomRes && atomRes.ok) {
        const atom = await atomRes.text();
        pushedAt = atom.match(/<updated>([^<]+)<\/updated>/)?.[1];
      }
      repo = {
        full_name: `${row.owner}/${row.repo}`,
        description: desc
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim() || undefined,
        stargazers_count: Number.isFinite(stars) ? stars : 0,
        forks_count: 0,
        pushed_at: pushedAt,
        topics: [],
        language: undefined,
        license: undefined,
        archived: /This repository has been archived/i.test(html),
      };
      via = "html-fallback";
      readmeExcerpt = repo.description ?? "";
      readmeNote = "README: not fetched (html-fallback lane — description only)";
    } else {
      repo = (await repoRes.json()) as GithubRepo;

      // README via the JSON envelope: `size` gates the 200KB cap BEFORE we
      // decode, so an oversized blob costs one request and zero decode work.
      try {
        const rmRes = await fetchGithub(`https://api.github.com/repos/${row.owner}/${row.repo}/readme`, "application/vnd.github+json");
        if (rmRes.ok) {
          const rm = (await rmRes.json()) as { size?: number; content?: string; encoding?: string };
          if (typeof rm.size === "number" && rm.size > 200_000) {
            readmeNote = `README ${Math.round(rm.size / 1024)}KB — over the 200KB cap, skipped`;
          } else if (rm.encoding === "base64" && typeof rm.content === "string") {
            const decoded = Buffer.from(rm.content, "base64").toString("utf8");
            readmeExcerpt = decoded.slice(0, 1_200);
            readmeNote = `README ${decoded.length.toLocaleString()} chars distilled`;
          }
        }
      } catch {
        /* README is a bonus — the repo envelope already carried the essentials */
      }
    }

    const { score, keywords } = scoreRepo(repo, readmeExcerpt);
    const verdict = verdictFor(score);
    const pushedAgo = repo.pushed_at
      ? `${Math.round((Date.now() - new Date(repo.pushed_at).getTime()) / 86_400_000)}d ago`
      : "unknown";
    const notes = [
      `${repo.full_name ?? `${row.owner}/${row.repo}`} — ${repo.description ?? "(no description)"}`,
      `stars ${repo.stargazers_count ?? 0} · forks ${repo.forks_count ?? 0} · pushed ${pushedAgo}${repo.archived ? " · ARCHIVED" : ""} · lang ${repo.language ?? "?"}${repo.license?.spdx_id ? ` · ${repo.license.spdx_id}` : ""}`,
      `topics: ${repo.topics?.length ? repo.topics.slice(0, 10).join(", ") : "(none)"}`,
      `keywords: ${keywords.length ? keywords.join(", ") : "(none)"}`,
      readmeNote,
      `readme head: ${readmeExcerpt ? trunc(readmeExcerpt.replace(/\s+/g, " ").trim(), 600) : "(n/a)"}`,
      `source: ${via}${via === "html-fallback" ? " (api.github.com rate-limited from sandbox egress)" : ""}`,
    ].join("\n");
    await db.researchQueue.update({
      where: { id: row.id },
      data: { status: "researched", score: Math.round(score), verdict, notes: trunc(notes, NOTES_MAX), researchedAt: new Date() },
    });
    // r515-c recursive loop: an ADAPT verdict must not evaporate — auto-enqueue
    // a backlog item (deduped) so the next cycles advance it and the briefing
    // surfaces it to the chat-side architect. Bonus call: never fails research.
    if (verdict === "ADAPT") {
      await maybeAutoAdaptItem(row.id, row.owner, row.repo, Math.round(score), repo.description ?? undefined).catch(
        () => undefined,
      );
    }
    return `researched ${repo.full_name ?? row.repo}: score ${Math.round(score)}/10 → ${verdict} (${repo.stargazers_count ?? 0}★, pushed ${pushedAgo}${repo.archived ? ", archived" : ""})`;
  } catch (e) {
    const cls = errorClass(e);
    await db.researchQueue.update({
      where: { id: row.id },
      data: { status: "failed", notes: `error class: ${cls}`, researchedAt: new Date() },
    });
    return `honest failure — ${cls}`;
  }
}

/** Execute one move. Only SAFE, vault-free kinds do work; everything else is
 * an honest no-op or skip. Never dials an LLM inside a move. */
export async function executeMove(move: { id: string; kind: string; payloadJson: string }): Promise<{
  status: "executed" | "failed" | "skipped";
  result: string;
}> {
  await db.nextMove.update({ where: { id: move.id }, data: { status: "executing" } }).catch(() => undefined);
  let outcome: { status: "executed" | "failed" | "skipped"; result: string };
  try {
    if (move.kind === "research-repo") {
      let queueId = "";
      try {
        queueId = String((JSON.parse(move.payloadJson) as { queueId?: unknown }).queueId ?? "");
      } catch {
        queueId = "";
      }
      const result = queueId ? await researchRepo(queueId) : "honest failure — payload missing queueId";
      outcome = { status: result.startsWith("honest failure") ? "failed" : "executed", result };
    } else if (move.kind === "import-seed") {
      const digest = await latestRadarDigest();
      const seeds = digest?.seeds ?? [];
      outcome =
        seeds.length > 0
          ? {
              status: "executed",
              result: `no-op import — ${seeds.length} seed prompt${seeds.length === 1 ? "" : "s"} stay owner-copy (AIE never mutates workflows; doctrine). Top seed: "${trunc(seeds[0].label, 100)}" — copy it from the radar panel into a Studio step.`,
            }
          : { status: "skipped", result: "no seeds in the latest radar digest — nothing to import" };
    } else if (move.kind === "radar-followup") {
      let finding = "";
      try {
        finding = String((JSON.parse(move.payloadJson) as { finding?: unknown }).finding ?? "");
      } catch {
        finding = "";
      }
      outcome = {
        status: "executed",
        result: `no-op — owner decision required. Finding: "${trunc(finding || "(details in the radar panel)", 200)}"`,
      };
    } else if (move.kind === "advance-strategy") {
      let itemId = "";
      try {
        itemId = String((JSON.parse(move.payloadJson) as { itemId?: unknown }).itemId ?? "");
      } catch {
        itemId = "";
      }
      if (!itemId) {
        outcome = { status: "failed", result: "honest failure — payload missing itemId" };
      } else {
        const item = await db.strategyItem.findUnique({ where: { id: itemId } });
        if (!item) {
          outcome = { status: "skipped", result: "strategy item vanished — honest no-op" };
        } else if (item.status === "done") {
          outcome = { status: "skipped", result: `${itemId} already done — honest no-op` };
        } else {
          await advanceStrategyItem(itemId, "aie");
          await appendDigestEntries([
            { source: "aie", text: `${itemId} advanced — ${trunc(item.nextAction || item.title, 160)}` },
          ]);
          outcome = {
            status: "executed",
            result: `${itemId} advanced (data-only move: advancedAt/Count touched, digest line appended — implementation itself is the chat-side architect's lane per AGENT.md doctrine)`,
          };
        }
      }
    } else if (move.kind === "await-owner") {
      outcome = { status: "executed", result: "no-op — owner decision required" };
    } else {
      outcome = { status: "skipped", result: `kind "${move.kind}" is not a safe vault-free move in this build — skipped honestly` };
    }
  } catch (e) {
    outcome = { status: "failed", result: `honest failure — ${errorClass(e)}` };
  }
  await db.nextMove
    .update({
      where: { id: move.id },
      data: {
        status: outcome.status,
        result: trunc(outcome.result, RESULT_MAX),
        executedAt: new Date(),
      },
    })
    .catch(() => undefined);
  return outcome;
}

// ─── The cycle ───────────────────────────────────────────────────────────────

export interface CycleResult {
  alreadyRan: boolean;
  log: {
    id: string;
    kind: string;
    summary: string;
    movesJson: string;
    statsJson: string;
    createdAt: string;
  } | null;
}

/** One idempotent 10-minute cycle: propose → execute top 1-2 safe moves →
 * log. Re-entering the same bucket (interval fire + manual POST) is an
 * honest "already-ran", never a duplicate row or double execution. */
export async function runAutonomyCycle(): Promise<CycleResult> {
  const t0 = Date.now();
  const bucket = tenMinBucketOf();
  const cycleId = `cyc_${bucket}`;

  const existing = await db.autonomyLog.findUnique({ where: { id: cycleId } });
  if (existing) {
    return { alreadyRan: true, log: serializeLog(existing) };
  }

  // 1) Maybe-generate moves (fresh-proposal guard inside).
  const gen = await generateNextMoves(cycleId);

  // 2) Execute the top 1-2 proposed moves — oldest proposals first so the
  //    backlog drains FIFO; the take:2 IS the 2-repos-per-cycle budget.
  const toExecute = await db.nextMove.findMany({
    where: { status: "proposed" },
    orderBy: [{ createdAt: "asc" }, { rank: "asc" }],
    take: 2,
  });
  const touched: { id: string; title: string; kind: string; status: string }[] = [...gen.moves];
  let executed = 0;
  let failed = 0;
  for (const m of toExecute) {
    const outcome = await executeMove(m);
    if (outcome.status === "executed") executed += 1;
    else if (outcome.status === "failed") failed += 1;
    if (!touched.some((t) => t.id === m.id)) {
      touched.push({ id: m.id, title: m.title, kind: m.kind, status: outcome.status });
    } else {
      const t = touched.find((t) => t.id === m.id);
      if (t) t.status = outcome.status;
    }
  }

  // 3) The cycle log row — unique id is the concurrency referee: if a
  //    parallel cycle won the create, this one reports already-ran honestly.
  const [queued, researched, failedRows] = await Promise.all([
    db.researchQueue.count({ where: { status: "queued" } }),
    db.researchQueue.count({ where: { status: "researched" } }),
    db.researchQueue.count({ where: { status: "failed" } }),
  ]);
  const ms = Date.now() - t0;
  const summary = trunc(
    `${cycleId}: ${gen.moves.length} proposed${gen.suppressed ? " (suppressed guard)" : ""} · ${executed} executed / ${failed} failed · queue ${queued}q/${researched}r/${failedRows}f · lane ${gen.laneUsed} · ${ms}ms`,
    SUMMARY_MAX,
  );
  const stats = {
    queued,
    researched,
    failed: failedRows,
    ms,
    laneUsed: gen.laneUsed,
    proposed: gen.moves.length,
    executed,
    movesFailed: failed,
  };
  let log: Awaited<ReturnType<typeof serializeLog>> | null = null;
  try {
    log = serializeLog(
      await db.autonomyLog.create({
        data: {
          id: cycleId,
          kind: "cycle",
          summary,
          movesJson: JSON.stringify(touched.slice(0, 10)),
          statsJson: JSON.stringify(stats),
        },
      }),
    );
  } catch {
    const winner = await db.autonomyLog.findUnique({ where: { id: cycleId } });
    return { alreadyRan: true, log: winner ? serializeLog(winner) : null };
  }

  // 4) Every 6th consecutive cycle (or 24h since the last) — the honest
  //    24h report: what the engine actually did, no vanity metrics.
  await maybeWriteReport(cycleId);
  return { alreadyRan: false, log };
}

type LogRow = {
  id: string;
  kind: string;
  summary: string;
  movesJson: string;
  statsJson: string;
  createdAt: Date;
  updatedAt: Date;
};

function serializeLog(r: LogRow): CycleResult["log"] {
  return {
    id: r.id,
    kind: r.kind,
    summary: r.summary,
    movesJson: r.movesJson,
    statsJson: r.statsJson,
    createdAt: r.createdAt.toISOString(),
  };
}

async function maybeWriteReport(cycleId: string): Promise<void> {
  try {
    const lastReport = await db.autonomyLog.findFirst({
      where: { kind: "report" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });
    const since = lastReport?.createdAt ?? new Date(0);
    const cyclesSince = await db.autonomyLog.count({
      where: { kind: "cycle", id: { not: cycleId }, createdAt: { gt: since } },
    });
    const stale24h = lastReport ? Date.now() - lastReport.createdAt.getTime() >= 24 * 3_600_000 : false;
    if (cyclesSince < REPORT_EVERY_N_CYCLES && !stale24h) return;

    const dayAgo = new Date(Date.now() - 24 * 3_600_000);
    const [proposed24, executed24, failed24, drained24, researchedRows, strategyOpen, strategyAdvanced24] = await Promise.all([
      db.nextMove.count({ where: { createdAt: { gte: dayAgo } } }),
      db.nextMove.count({ where: { status: "executed", executedAt: { gte: dayAgo } } }),
      db.nextMove.count({ where: { status: "failed", executedAt: { gte: dayAgo } } }),
      db.researchQueue.count({ where: { researchedAt: { gte: dayAgo } } }),
      db.researchQueue.findMany({
        where: { researchedAt: { gte: dayAgo }, verdict: { not: null } },
        select: { verdict: true },
      }),
      // r515-c: strategy slice — the SCL connection is now part of the report.
      db.strategyItem.count({ where: { status: { not: "done" } } }),
      db.strategyItem.count({ where: { advancedAt: { gte: dayAgo } } }),
    ]);
    const verdictHistogram: Record<string, number> = { ADAPT: 0, WATCH: 0, SKIP: 0 };
    for (const r of researchedRows) {
      const v = (r.verdict ?? "").toUpperCase();
      if (v === "ADAPT" || v === "WATCH" || v === "SKIP") verdictHistogram[v] += 1;
    }
    const failedQueueRows = await db.researchQueue.findMany({
      where: { status: "failed", updatedAt: { gte: dayAgo } },
      select: { id: true, notes: true },
      take: 5,
      orderBy: { updatedAt: "desc" },
    });
    const failureStreaks = failedQueueRows.map((r) => ({ id: r.id, notes: trunc(r.notes ?? "", 80) }));
    const summary = trunc(
      `24h report: ${proposed24} moves proposed · ${executed24} executed · ${failed24} failed · queue drained ${drained24} · verdicts ${verdictHistogram.ADAPT}A/${verdictHistogram.WATCH}W/${verdictHistogram.SKIP}S${failureStreaks.length ? ` · ${failureStreaks.length} failed queue row(s)` : ""} · strategy ${strategyOpen} open / ${strategyAdvanced24} advanced(24h)`,
      SUMMARY_MAX,
    );
    await db.autonomyLog.create({
      data: {
        id: cycleId.replace(/^cyc_/, "rep_"),
        kind: "report",
        summary,
        movesJson: "[]",
        statsJson: JSON.stringify({
          windowHours: 24,
          movesProposed: proposed24,
          movesExecuted: executed24,
          movesFailed: failed24,
          queueDrained: drained24,
          verdictHistogram,
          failureStreaks,
          strategy: { open: strategyOpen, advanced24: strategyAdvanced24 },
        }),
      },
    });
  } catch (e) {
    // The report is a bonus — a failed report write must never fail the cycle.
    console.warn("[autonomy] report write skipped:", e instanceof Error ? e.message : e);
  }
}

// ─── Snapshot for the API/panel ──────────────────────────────────────────────

export interface AutonomySnapshot {
  latestLog: CycleResult["log"];
  latestReport: CycleResult["log"];
  /** Last 6 AutonomyLog rows (cycle + report), newest first — the panel feed. */
  logs: CycleResult["log"][];
  queue: { queued: number; researched: number; failed: number; oldestQueuedAgeMin: number | null };
  moves: {
    id: string;
    cycleId: string;
    rank: number;
    kind: string;
    title: string;
    rationale: string;
    status: string;
    result: string | null;
    createdAt: string;
  }[];
  /** 24h move outcomes for the panel's KPI strip. */
  moves24: { executed: number; failed: number; proposed: number };
  engine: { lastCycleAt: string | null; nextCycleInMin: number | null; enabled: boolean };
}

export async function getAutonomySnapshot(): Promise<AutonomySnapshot> {
  const dayAgo = new Date(Date.now() - 24 * 3_600_000);
  const [latestLog, latestReport, logs, queueRows, oldestQueued, moves, executed24, failed24, proposed24, lastCycle] =
    await Promise.all([
      db.autonomyLog.findFirst({ orderBy: { createdAt: "desc" } }),
      db.autonomyLog.findFirst({ where: { kind: "report" }, orderBy: { createdAt: "desc" } }),
      db.autonomyLog.findMany({ orderBy: { createdAt: "desc" }, take: 6 }),
      db.researchQueue.groupBy({ by: ["status"], _count: { _all: true } }),
      db.researchQueue.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      db.nextMove.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
      db.nextMove.count({ where: { status: "executed", executedAt: { gte: dayAgo } } }),
      db.nextMove.count({ where: { status: "failed", executedAt: { gte: dayAgo } } }),
      db.nextMove.count({ where: { createdAt: { gte: dayAgo } } }),
      db.autonomyLog.findFirst({
        where: { kind: "cycle" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
  const byStatus = new Map(queueRows.map((r) => [r.status, r._count._all]));
  const g = globalThis as unknown as { __autonomyEngineArmed?: boolean };
  const lastCycleAt = lastCycle ? lastCycle.createdAt.toISOString() : null;
  const elapsedMin = lastCycle ? (Date.now() - lastCycle.createdAt.getTime()) / 60_000 : null;
  return {
    latestLog: latestLog ? serializeLog(latestLog) : null,
    latestReport: latestReport ? serializeLog(latestReport) : null,
    logs: logs.map(serializeLog),
    queue: {
      queued: byStatus.get("queued") ?? 0,
      researched: byStatus.get("researched") ?? 0,
      failed: byStatus.get("failed") ?? 0,
      oldestQueuedAgeMin: oldestQueued
        ? Math.max(0, Math.round((Date.now() - oldestQueued.createdAt.getTime()) / 60_000))
        : null,
    },
    moves: moves.map((m) => ({
      id: m.id,
      cycleId: m.cycleId,
      rank: m.rank,
      kind: m.kind,
      title: m.title,
      rationale: m.rationale,
      status: m.status,
      result: m.result,
      createdAt: m.createdAt.toISOString(),
    })),
    moves24: { executed: executed24, failed: failed24, proposed: proposed24 },
    engine: {
      lastCycleAt,
      nextCycleInMin:
        elapsedMin === null ? null : Math.max(0, Math.ceil(AUTONOMY_INTERVAL_MS / 60_000 - elapsedMin)),
      enabled: g.__autonomyEngineArmed === true,
    },
  };
}

// ─── Boot (HMR-safe, exactly like startCapabilityRadar) ──────────────────────

/** Boot the 10-minute loop exactly once per server process (HMR-safe). */
export function startAutonomyEngine(): void {
  try {
    const g = globalThis as unknown as { __autonomyEngine?: NodeJS.Timeout; __autonomyEngineArmed?: boolean };
    if (g.__autonomyEngine) return;
    g.__autonomyEngineArmed = true;
    // First pass 15s after boot (schema/boot races settle), then every 10 min.
    const first = setTimeout(() => {
      void runAutonomyCycle().catch((err) =>
        console.error("[autonomy] boot cycle failed:", err instanceof Error ? err.message : err),
      );
    }, FIRST_PASS_DELAY_MS);
    const loop = setInterval(() => {
      void runAutonomyCycle().catch((err) =>
        console.error("[autonomy] cycle failed:", err instanceof Error ? err.message : err),
      );
    }, AUTONOMY_INTERVAL_MS);
    g.__autonomyEngine = loop;
    first.unref?.();
    loop.unref?.();
    console.info(
      "[autonomy] improvement engine armed — 10-min deterministic cycles, vault-free, fires with or without an open tab (first pass in 15s)",
    );
  } catch (e) {
    // Never throw from instrumentation.
    console.warn("[autonomy] engine boot skipped:", e instanceof Error ? e.message : e);
  }
}
