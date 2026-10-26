import { createHash } from "node:crypto";
import { db } from "@/lib/db";

// ─── r515-c: Strategic Context Layer (SCL) ───────────────────────────────────
// Owner diagnosis (r515-b feedback): the AIE ran but proposed idle no-ops —
// "automatically created prompts for random api agent calls [did not]
// understand the task and environment … we need proper instruction and
// agent.md tasks.md worklogs.md etc — a strategical system for disciplined
// continuous work … this is still void for a connected system."
//
// The SCL is that connective system, in two halves:
//
//   GIT half  — docs/strategy/AGENT.md (charter + capability elevation cycle),
//               docs/strategy/TASKS.md (versioned backlog mirror),
//               docs/strategy/WORKLOGS.md (log discipline pointer).
//   RUNTIME   — this module: a queryable StrategyItem backlog the AIE advances
//               with data-only moves; a rolling distilled-findings digest;
//               a context pack; and /api/briefing — the markdown brief any
//               scheduled agent (Owner's z.ai crons, workflow steps, dev
//               rounds) reads to understand the environment BEFORE acting.
//
// The capability elevation cycle this serves (Owner doctrine, encoded):
//   1. RESEARCH  — in-app workers + AIE + radar sweep topics/repos/experiments.
//                  They can never pause or edit the platform that serves them.
//   2. DISTILL   — the chat-side architect turns verdicts/findings/stalls into
//                  StrategyItem rows + TASKS.md entries (nextAction + acceptance).
//   3. IMPLEMENT — the chat-side architect edits platform code in dev rounds,
//                  gated (tsc/lint/QA), pushed to both remotes.
//   4. OPERATE   — platform-internal loops (AIE 10-min, radar hourly, workflow
//                  schedules) run tab-closed and vault-free.
//   5. LEARN     — outcomes feed the digest and the next proposal batch. Each
//                  loop raises platform capability. Recursive by construction.

const DIGEST_KV_ID = "strategy.digest";
const DIGEST_CAP = 40;
const NOTES_MAX = 1_200;

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

function digestId(): string {
  return `dg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Doctrine seeds — the distilled integration backlog ─────────────────────
// Seeded from docs/repo-sweep-report-2410.md (r515-a research), the r514
// security findings, and the NEXUS_BOT adaptation queue. `syncStrategyFromSignals`
// inserts these idempotently (dedupeKey), so re-syncing never duplicates.

interface SeedItem {
  title: string;
  kind: "integration" | "research" | "experiment" | "owner-action";
  source: string;
  status: "proposed" | "ready" | "in-progress" | "blocked";
  priority: 1 | 2 | 3;
  nextAction: string;
  acceptance?: string;
  notes?: string;
}

export const STRATEGY_SEEDS: SeedItem[] = [
  // — Tier-1 integrations (repo-sweep combination plays) —
  {
    title: "Two-tier routing tier-1: 9router auto-fallback ladder in relay.ts",
    kind: "integration",
    source: "repo-sweep-2410",
    status: "ready",
    priority: 1,
    nextAction:
      "Chat-side architect: map the current relay hop ladder in src/lib/provider-rotation.ts, add decolua/9router-style auto-fallback (ladder walk on 429/403/5xx with token-lean request shaping).",
    acceptance: "Lane rotation survives provider 429/403 storms with zero manual toggles; measured in a qa script.",
    notes: "9router 31,313★ — auto-fallback + token-lean routing is its core doctrine.",
  },
  {
    title: "Durable-step semantics for scheduled runs (upstash/workflow-js × QStash)",
    kind: "integration",
    source: "repo-sweep-2410",
    status: "ready",
    priority: 1,
    nextAction:
      "Chat-side architect: give automation-executor per-step retry + resume-after-restart semantics (invoke/retry/waitForEvent shape) on the existing QStash wiring — no new service.",
    acceptance: "A scheduled server-lane run that dies mid-way resumes at the failed step after restart; visible in the run archive.",
    notes: "Combination play M from the sweep report; workflow-js 156★, still active 2026-10.",
  },
  {
    title: "NEXUS_BOT adaptation wave: AES vault, redaction choke, dialect lanes, acquisition lanes",
    kind: "integration",
    source: "nexus-bot-2210",
    status: "ready",
    priority: 1,
    nextAction:
      "Chat-side architect: port from upload/NEXUSbot2210v3.tar — server-side AES-256-GCM vault, a single redaction choke point in front of every outbound LLM dial, Anthropic-dialect lanes, Exa/Bright Data acquisition lanes.",
    acceptance: "Vault round-trips server-only; one redaction module covers relay + engine + radar dials.",
    notes: "Owner's parallel project with its own git lineage — adapt, do not import wholesale.",
  },
  // — Integrations, next tier —
  {
    title: "Plugin-manifest doctrine: deepseek-harness drop-in pack format",
    kind: "integration",
    source: "repo-sweep-2410",
    status: "proposed",
    priority: 2,
    nextAction:
      "Chat-side architect: define one JSON manifest that registers a tool+lane+crew pack without code edits ('Everything is a Plugin' — deepseek-harness 260k★ ecosystem anchor).",
    acceptance: "A sample pack JSON drops into a watched folder and appears in the tools registry after reload.",
  },
  {
    title: "Harness-agnostic lane-adapter spec (HarnessRouter)",
    kind: "integration",
    source: "repo-sweep-2410",
    status: "proposed",
    priority: 2,
    nextAction:
      "Chat-side architect: write the adapter interface so NEXUS lanes can serve foreign harnesses (request/response dialect mapping), informed by HarnessRouter 3,290★.",
    acceptance: "Spec doc + one reference adapter passing a fixture test in qa.",
  },
  {
    title: "Peer blind-scoring quality gate on crew steps (SakanaAI/mass × Intern tier)",
    kind: "experiment",
    source: "repo-sweep-2410",
    status: "proposed",
    priority: 2,
    nextAction:
      "Chat-side architect: after each crew step, a second cheap-lane pass blind-scores the output (mass doctrine); gate = score below threshold triggers one revise pass.",
    acceptance: "Crew run log shows scorer verdicts; 1-2 rounds budget.",
  },
  {
    title: "url-kind research lane (direct page reader) for the gitcode remainder",
    kind: "integration",
    source: "aie-signal",
    status: "ready",
    priority: 2,
    nextAction:
      "Chat-side architect: wire a URL research lane in autonomy.ts (og:description + title scrape, same scoring shape) so ~10 queued url-kind rows stop waiting honestly forever.",
    acceptance: "Queued gitcode rows flip to researched/skipped with honest notes within one cycle budget.",
  },
  {
    title: "hermes-zvec-memory RRF hybrid retrieval shim (BM25 + vector)",
    kind: "experiment",
    source: "repo-sweep-2410",
    status: "proposed",
    priority: 3,
    nextAction: "Chat-side architect: prototype a reciprocal-rank-fusion shim over the platform's existing notes/research stores.",
    acceptance: "Retrieval demo notebook or script comparing BM25-only vs RRF on real research rows.",
  },
  {
    title: "AWorld explore→reproduce→improve loop for frontier-scout v2",
    kind: "experiment",
    source: "repo-sweep-2410",
    status: "proposed",
    priority: 3,
    nextAction: "Chat-side architect: make frontier-scout re-verify yesterday's seeds before hunting new ones (explore→reproduce→improve).",
    acceptance: "Scout output marks each seed reproduced/not-reproduced with evidence.",
  },
  {
    title: "nexent constraint-bound agent auto-generation → spawn-proposal fuel",
    kind: "experiment",
    source: "repo-sweep-2410",
    status: "proposed",
    priority: 3,
    nextAction: "Chat-side architect: feed spawn-proposal-engine hard constraints (tool budget, lane caps) in the nexent style.",
    acceptance: "Spawn proposals carry a constraint block; editor validates them.",
  },
  // — Owner actions (blocked on the owner, surfaced everywhere until done) —
  {
    title: "Rotate the GitHub PAT exposed in bb6120b31 (public history)",
    kind: "owner-action",
    source: "security-514",
    status: "blocked",
    priority: 1,
    nextAction: "Owner: rotate the PAT on GitHub; scripts/backup-push.sh already refuses to run without an exported GITHUB_BACKUP_PAT.",
    acceptance: "Old PAT dead on GitHub; backup push succeeds with the new one.",
  },
  {
    title: "Paste the real Webshare token on Settings → Egress (witness 403→401)",
    kind: "owner-action",
    source: "security-514",
    status: "blocked",
    priority: 1,
    nextAction: "Owner: paste token in the Egress card → 'Pool armed' → groq probe flips 403 WAF → 401 key-level.",
    acceptance: "Probe result strip shows the 401 flip from the pool lane.",
  },
  {
    title: "Decide the 2 baselined preseed keys in src/lib/constants.ts (rotate/relocate)",
    kind: "owner-action",
    source: "security-514",
    status: "blocked",
    priority: 2,
    nextAction: "Owner: rotate or vault-seed the two keys the r514 scanner baselined (lines 19/29); scanner stays loud until then.",
    acceptance: ".secret-baseline drops to zero entries.",
  },
  {
    title: "Add a fine-grained GitHub PAT to PlatformSetting → api research lane auto-resumes",
    kind: "owner-action",
    source: "aie-signal",
    status: "blocked",
    priority: 2,
    nextAction: "Owner: paste a read-only fine-grained PAT; the engine's html-fallback lane yields to the api lane automatically when the key appears.",
    acceptance: "New research rows carry 'source: api' instead of 'source: html-fallback'.",
  },
  {
    title: "Recreate the z.ai-side 15-min dev patrol cron from YOUR account (gating-proof)",
    kind: "owner-action",
    source: "cron-doctrine",
    status: "blocked",
    priority: 1,
    nextAction:
      "Owner: create the cron yourself via the z.ai scheduler UI (hourly is fine) — paste the brief from Settings/Strategy 'Copy cron brief' or GET /api/briefing. Chat-side auto-created crons get gated ('Disabled due to exec limits exceeded' witnessed on jobs 472456/473048); Owner-created ones are the resilient control plane.",
    acceptance: "A cron fires periodic dev rounds that read worklog.md + TASKS.md and continue the top item.",
  },
];

// ─── Item ids / CRUD ─────────────────────────────────────────────────────────

async function nextTaskId(): Promise<string> {
  const rows = await db.strategyItem.findMany({
    where: { id: { startsWith: "TASK-" } },
    select: { id: true },
  });
  let max = 99;
  for (const r of rows) {
    const n = Number.parseInt(r.id.slice(5), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `TASK-${max + 1}`;
}

export interface StrategyItemDTO {
  id: string;
  title: string;
  kind: string;
  source: string;
  status: string;
  priority: number;
  nextAction: string;
  acceptance: string | null;
  notes: string | null;
  advancedCount: number;
  advancedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDTO(r: {
  id: string;
  title: string;
  kind: string;
  source: string;
  status: string;
  priority: number;
  nextAction: string;
  acceptance: string | null;
  notes: string | null;
  advancedCount: number;
  advancedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): StrategyItemDTO {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    source: r.source,
    status: r.status,
    priority: r.priority,
    nextAction: r.nextAction,
    acceptance: r.acceptance,
    notes: r.notes,
    advancedCount: r.advancedCount,
    advancedAt: r.advancedAt ? r.advancedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export const STRATEGY_STATUSES = ["proposed", "ready", "in-progress", "blocked", "done"] as const;

export async function createStrategyItem(input: {
  title: string;
  kind: string;
  source?: string;
  status?: string;
  priority?: number;
  nextAction?: string;
  acceptance?: string;
  notes?: string;
  dedupeKey?: string;
  originJson?: string;
}): Promise<{ created: boolean; item: StrategyItemDTO }> {
  const title = trunc(input.title.trim(), 200);
  if (!title) throw new Error("title required");
  if (input.dedupeKey) {
    const existing = await db.strategyItem.findUnique({ where: { dedupeKey: input.dedupeKey } });
    if (existing) return { created: false, item: toDTO(existing) };
  }
  const id = await nextTaskId();
  const row = await db.strategyItem.create({
    data: {
      id,
      title,
      kind: trunc(input.kind || "integration", 40),
      source: trunc(input.source || "chat-side", 60),
      status: STRATEGY_STATUSES.includes((input.status ?? "") as (typeof STRATEGY_STATUSES)[number])
        ? (input.status as string)
        : "proposed",
      priority: Math.min(3, Math.max(1, Math.round(input.priority ?? 2))),
      nextAction: trunc(input.nextAction ?? "", 500),
      acceptance: input.acceptance ? trunc(input.acceptance, 500) : null,
      notes: input.notes ? trunc(input.notes, NOTES_MAX) : null,
      dedupeKey: input.dedupeKey,
      originJson: input.originJson,
    },
  });
  return { created: true, item: toDTO(row) };
}

// ─── Digest (the rolling distilled-findings stream) ─────────────────────────

export interface DigestEntry {
  id: string;
  ts: string;
  source: string;
  text: string;
}

export async function readDigest(): Promise<DigestEntry[]> {
  const row = await db.platformSetting.findUnique({ where: { id: DIGEST_KV_ID } });
  if (!row?.value) return [];
  try {
    const arr = JSON.parse(row.value) as DigestEntry[];
    return Array.isArray(arr) ? arr.slice(0, DIGEST_CAP) : [];
  } catch {
    return [];
  }
}

/** Append entries to the rolling digest (newest first, capped at 40). */
export async function appendDigestEntries(entries: { source: string; text: string }[]): Promise<number> {
  const clean = entries
    .map((e) => ({ id: digestId(), ts: new Date().toISOString(), source: trunc(e.source, 40), text: trunc(e.text, 240) }))
    .filter((e) => e.text.length > 0);
  if (clean.length === 0) return 0;
  const current = await readDigest();
  const next = [...clean, ...current].slice(0, DIGEST_CAP);
  await db.platformSetting.upsert({
    where: { id: DIGEST_KV_ID },
    create: { id: DIGEST_KV_ID, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  return clean.length;
}

// ─── AIE hooks ───────────────────────────────────────────────────────────────

/** Top open items the engine may advance: not done/blocked, not advanced in
 * the last 30 minutes (advancement touch cooldown), oldest-priority first. */
export async function listAdvancableItems(take = 2): Promise<StrategyItemDTO[]> {
  const cooldown = new Date(Date.now() - 30 * 60_000);
  const rows = await db.strategyItem.findMany({
    where: {
      status: { in: ["proposed", "ready", "in-progress"] },
      OR: [{ advancedAt: null }, { advancedAt: { lt: cooldown } }],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take,
  });
  return rows.map(toDTO);
}

export async function advanceStrategyItem(id: string, _by: string): Promise<StrategyItemDTO | null> {
  const row = await db.strategyItem.update({
    where: { id },
    data: { advancedCount: { increment: 1 }, advancedAt: new Date() },
  });
  return toDTO(row);
}

/** After a repo research lands an ADAPT verdict: auto-create a backlog item so
 * the finding cannot evaporate — the recursive research→backlog loop. */
export async function maybeAutoAdaptItem(
  queueRowId: string,
  owner: string,
  repo: string,
  score: number,
  description: string | undefined,
): Promise<{ created: boolean; itemId?: string }> {
  const dedupeKey = `auto-adapt:${queueRowId}`;
  const existing = await db.strategyItem.findUnique({ where: { dedupeKey } });
  if (existing) return { created: false };
  const id = await nextTaskId();
  const row = await db.strategyItem.create({
    data: {
      id,
      title: `Evaluate adaptation: ${owner}/${repo} (score ${score}/10, ADAPT)`,
      kind: "integration",
      source: "aie:auto-adapt",
      status: "proposed",
      priority: 2,
      nextAction: `Chat-side architect: read the engine's research notes for ${owner}/${repo} (research queue) and distill a concrete integration item — or flip this row to done/WATCH if the score flattered it.`,
      acceptance: "Distilled into a concrete item or honestly closed.",
      notes: trunc(description ?? "", 300),
      dedupeKey,
      originJson: JSON.stringify({ queueRowId, score, owner, repo }),
    },
  });
  await appendDigestEntries([{ source: "aie", text: `${id}: ${owner}/${repo} scored ADAPT (${score}/10) — auto-enqueued for distillation` }]);
  return { created: true, itemId: row.id };
}

// ─── Sync (idempotent seed + radar tryables → backlog) ───────────────────────

export interface SyncResult {
  seedsInserted: number;
  seedsSkipped: number;
  radarAdded: number;
  digestAppended: number;
}

export async function syncStrategyFromSignals(): Promise<SyncResult> {
  let seedsInserted = 0;
  let seedsSkipped = 0;
  for (const seed of STRATEGY_SEEDS) {
    const dedupeKey = `seed:${slugify(seed.title)}`;
    const exists = await db.strategyItem.findUnique({ where: { dedupeKey } });
    if (exists) {
      seedsSkipped += 1;
      continue;
    }
    const id = await nextTaskId();
    await db.strategyItem.create({
      data: {
        id,
        title: seed.title,
        kind: seed.kind,
        source: seed.source,
        status: seed.status,
        priority: seed.priority,
        nextAction: seed.nextAction,
        acceptance: seed.acceptance,
        notes: seed.notes,
        dedupeKey,
      },
    });
    seedsInserted += 1;
  }

  // Radar tryables → experiment items (cap 3 newest findings, deduped).
  let radarAdded = 0;
  const check = await db.capabilityCheck.findFirst({ orderBy: { createdAt: "desc" } });
  if (check) {
    let digest: { findings?: { title?: string; tryable?: string }[] } = {};
    try {
      digest = JSON.parse(check.digestJson) as { findings?: { title?: string; tryable?: string }[] };
    } catch {
      digest = {};
    }
    for (const f of (digest.findings ?? []).slice(0, 6)) {
      if (!f.tryable || radarAdded >= 3) continue;
      const dedupeKey = `radar:${createHash("sha1").update(f.tryable).digest("hex").slice(0, 16)}`;
      const exists = await db.strategyItem.findUnique({ where: { dedupeKey } });
      if (exists) continue;
      const id = await nextTaskId();
      await db.strategyItem.create({
        data: {
          id,
          title: trunc(`Radar tryable: ${f.title ?? "capability experiment"}`, 200),
          kind: "experiment",
          source: "radar",
          status: "proposed",
          priority: 3,
          nextAction: trunc(f.tryable, 500),
          dedupeKey,
          originJson: JSON.stringify({ checkId: check.id }),
        },
      });
      radarAdded += 1;
    }
  }

  const digestAppended = await appendDigestEntries([
    { source: "sync", text: `Strategy sync: +${seedsInserted} seeds, +${radarAdded} radar tryables (${seedsSkipped} already present)` },
  ]);
  return { seedsInserted, seedsSkipped, radarAdded, digestAppended };
}

// ─── Context pack + briefing ─────────────────────────────────────────────────

export interface StrategyContext {
  items: StrategyItemDTO[];
  open: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  digest: DigestEntry[];
  radar: { at: string | null; findings: number; criticals: number; tryables: number };
  queue: { queued: number; researched: number; failed: number };
  /** r580: queued/researched rows for the Strategy card's hybrid search (head-capped notes). */
  queueDocs: { id: string; label: string; text: string }[];
  lastAieReport: { at: string; summary: string } | null;
  engine: { armed: boolean };
  ownerActions: StrategyItemDTO[];
}

export async function getStrategyContext(): Promise<StrategyContext> {
  const [items, digest, check, queueRows, lastReport, queueList] = await Promise.all([
    db.strategyItem.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }], take: 200 }),
    readDigest(),
    db.capabilityCheck.findFirst({ orderBy: { createdAt: "desc" } }),
    db.researchQueue.groupBy({ by: ["status"], _count: { _all: true } }),
    db.autonomyLog.findFirst({ where: { kind: "report" }, orderBy: { createdAt: "desc" } }),
    // r580: docs for the Strategy card's hybrid search — head-capped notes, small payload.
    db.researchQueue.findMany({
      where: { status: { in: ["queued", "researched"] } },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: { id: true, url: true, notes: true },
    }),
  ]);
  const dtos = items.map(toDTO);
  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const it of dtos) {
    byStatus[it.status] = (byStatus[it.status] ?? 0) + 1;
    byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
  }
  let radarDigest: { findings?: unknown[] } = {};
  try {
    radarDigest = check ? (JSON.parse(check.digestJson) as { findings?: unknown[] }) : {};
  } catch {
    radarDigest = {};
  }
  const g = globalThis as unknown as { __autonomyEngineArmed?: boolean };
  return {
    items: dtos,
    open: dtos.filter((i) => i.status !== "done").length,
    byStatus,
    byKind,
    digest,
    radar: {
      at: check ? check.createdAt.toISOString() : null,
      findings: check?.findings ?? 0,
      criticals: check?.critical ?? 0,
      tryables: (radarDigest.findings ?? []).filter((f) => (f as { tryable?: string }).tryable).length,
    },
    queue: Object.fromEntries(queueRows.map((r) => [r.status, r._count._all])) as StrategyContext["queue"],
    queueDocs: queueList.map((r) => ({
      id: r.id,
      label: r.url || r.id,
      text: (r.notes || r.url || r.id).slice(0, 400),
    })),
    lastAieReport: lastReport ? { at: lastReport.createdAt.toISOString(), summary: lastReport.summary } : null,
    engine: { armed: g.__autonomyEngineArmed === true },
    ownerActions: dtos.filter((i) => i.kind === "owner-action" && i.status !== "done"),
  };
}

/** The markdown brief — what any scheduled agent (Owner's z.ai cron, workflow
 * step, or a fresh dev-round session) reads to understand task + environment. */
export async function buildBriefing(): Promise<string> {
  const ctx = await getStrategyContext();
  const now = new Date().toISOString().slice(0, 16) + "Z";
  const top = ctx.items
    .filter((i) => i.status !== "done")
    .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 4);

  const lines: string[] = [];
  lines.push(`# NEXUS platform brief — ${now}`);
  lines.push("");
  lines.push("## Doctrine (30-second read)");
  lines.push("- Platform: NEXUS WebGUI Harness, /home/z/my-project — Next.js 16 single-route app, Prisma SQLite, BYOK local-first. WE own it fully (files, git, db).");
  lines.push("- Division of labor: in-app workers (AIE, radar, workflow agents) RESEARCH — they cannot pause or edit the platform that serves them. The chat-side architect DISTILLS their findings and IMPLEMENTS code in dev rounds. The OWNER decides and schedules.");
  lines.push("- Every round: read worklog.md tail first; gate with tsc + lint + browser QA; push BOTH remotes (origin + fork); append worklog.md with the --- template.");
  lines.push("- Cron doctrine (3 layers): (1) OWNER-created z.ai crons = the resilient control plane — chat-side auto-created ones get gated ('Disabled due to exec limits exceeded' witnessed); (2) platform-internal loops (AIE 10-min, radar hourly, workflow schedules) = purge-proof execution, tab-closed, vault-free; (3) chat-side auto-cron = best-effort bonus only.");
  lines.push("");
  lines.push("## Where the platform stands");
  lines.push(
    `- Improvement engine: ${ctx.engine.armed ? "ARMED" : "disarmed (this process)"} · research queue ${ctx.queue.queued ?? 0} queued / ${ctx.queue.researched ?? 0} researched / ${ctx.queue.failed ?? 0} failed`,
  );
  lines.push(
    `- Strategy backlog: ${ctx.open} open of ${ctx.items.length} · by status ${JSON.stringify(ctx.byStatus)} · radar ${ctx.radar.findings} findings (${ctx.radar.criticals} critical) last check ${ctx.radar.at ? ctx.radar.at.slice(0, 16) + "Z" : "never"}`,
  );
  if (ctx.lastAieReport) lines.push(`- Last AIE 24h report (${ctx.lastAieReport.at.slice(0, 16)}Z): ${ctx.lastAieReport.summary}`);
  lines.push("");
  lines.push("## Top strategic items (advance these)");
  if (top.length === 0) {
    lines.push("- Backlog empty — run the sync action on the Strategy card or POST /api/strategy {action:'sync'}.");
  } else {
    for (const it of top) {
      lines.push(`- **${it.id}** [${it.kind} · P${it.priority} · ${it.status}] ${it.title}`);
      if (it.nextAction) lines.push(`  → next: ${it.nextAction}`);
    }
  }
  lines.push("");
  if (ctx.ownerActions.length > 0) {
    lines.push("## Owner actions pending (blocked on you)");
    for (const oa of ctx.ownerActions) lines.push(`- ${oa.title} — ${oa.nextAction}`);
    lines.push("");
  }
  if (ctx.digest.length > 0) {
    lines.push("## Latest distilled findings");
    for (const d of ctx.digest.slice(0, 5)) lines.push(`- [${d.source}] ${d.text}`);
    lines.push("");
  }
  lines.push("## Rules for any agent working here");
  lines.push("- Never mutate workflows from server code; never dial an LLM implicitly; secrets stay server-side and masked.");
  lines.push("- Fail honestly: typed error classes, no silent fallbacks, no vanity metrics.");
  lines.push("- Research rows are the cache: researched queue rows are never re-fetched.");
  lines.push("");
  lines.push("## Paste-ready z.ai cron task (Owner creates it manually — hourly recommended)");
  lines.push("```text");
  lines.push(
    "cron list first (rebuild if purged: 15-min webDevReview, Europe/Istanbul). Read /home/z/my-project/worklog.md tail + GET http://localhost:3000/api/briefing for the live environment brief. Then: assess status, agent-browser QA the / route, fix bugs first; otherwise implement the top open TASK-* item from /api/strategy (chat-side architect role per docs/strategy/AGENT.md). Gate: tsc --noEmit, bun run lint, push BOTH remotes, append worklog.md with the --- template.",
  );
  lines.push("```");
  return lines.join("\n");
}
