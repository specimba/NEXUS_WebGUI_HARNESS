// ─── Frontier Scout (r511) ───────────────────────────────────────────────────
// Trend-ingestion + judge harness — "agents research new findings … trend
// papers … new trend GitHub repositories … if we can make trustworthy and
// reliable judge systems controlling these meaningfully" (owner, r511).
//
// Pipeline:  server aggregate (/api/radar/frontier) → THIS module scores and
// judges → high-scorers become Improvement seeds → the Evolution layer embeds
// them into stalled-pipeline variation proposals (self-development loop).
//
// Judge cascade (arXiv:2609.29769 "Decision Models vs LLM judges — wrong in
// the same places" + arXiv:2610.07177 "confidence-gated cascading" +
// arXiv:2609.01345 "cheap verifiers, large blind spots"):
//   ① RULES   — deterministic rubric (velocity/evidence/novelty-vs-ledger)
//   ② SYSTEMONE — typed noul relevance gate + choice adopt/watch/skip verdict
//      via the free Intern Decision-4B ladder (r510 wire, 200 RPM decision
//      quota) — the ONLY LLM rung for the clear cases.
//   ③ BAND ESCALATION — the choice rung is asked only when rules put the item
//      in the watch/adopt band or the noul gate is uncertain (0.4–0.75) —
//      exactly the mid-band escalation the cascade papers prescribe. The paid
//      Jev rung stays demoted last inside decide() (owner doctrine r510).
//
// Every verdict is logged with WHICH rung decided it — the "judgment
// boundary" table (per-slice escalation accuracy doctrine, arXiv:2609.01345).

import { shingles, jaccard } from "./evolution";
import { decide } from "./systemone";
import type { Settings } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FrontierKind = "paper" | "repo";

/** One normalized candidate from the server aggregation (/api/radar/frontier). */
export interface FrontierItem {
  /** Stable id: "arxiv:<arxivId>" | "hf:<paperId>" | "gh:<owner/repo>". */
  id: string;
  kind: FrontierKind;
  title: string;
  url: string;
  /** Abstract (papers) or repo description — trimmed upstream to ≤400 chars. */
  summary: string;
  authors?: string;
  /** Source hub label: "huggingface-papers" | "arxiv" | "github". */
  hub: string;
  upvotes?: number;
  stars?: number;
  createdAt?: string;
  topics?: string[];
  fetchedAt: number;
}

/** Deterministic rubric — the parts a rule engine CAN score. */
export interface FrontierScores {
  /** 0–30 — platform fit; neutral 12 until a judge refines it. */
  relevance: number;
  /** 0–20 — distance from everything already in the seed ledger. */
  novelty: number;
  /** 0–20 — implementability in THIS sandbox (no GPU, BYOK, free lanes). */
  implementability: number;
  /** 0–15 — source quality (curated hub, benchmarks, code). */
  evidence: number;
  /** 0–15 — community velocity (stars/upvotes + recency). */
  velocity: number;
}

export type FrontierVerdict = "adopt" | "watch" | "skip";

export interface FrontierJudgment {
  total: number;
  scores: FrontierScores;
  // "jev" (r510's demoted-paid rung inside decide()) is part of the cascade's
  // real return space — without it the two `via = gate.via` assignments below
  // do not typecheck (tsc 2 errors).
  via: "rules" | "intern-systemone" | "fast-model" | "jev";
  verdict: FrontierVerdict;
  confidence?: number;
  reason: string;
  judgedAt: number;
  ms?: number;
}

/** A paste-into-Studio improvement seed distilled from a high scorer. */
export interface FrontierSeed {
  id: string;
  kind: FrontierKind;
  title: string;
  url: string;
  total: number;
  seed: string;
  judgedAt: number;
  /** r582 AWorld loop: the scout's deterministic reproduction verdict —
   *  every seed carries one (seedFromItem attaches it; older ledger rows
   *  gain theirs on first verify). */
  reproduction?: SeedReproduction;
}

// ─── AWorld explore→reproduce→improve (r582) ─────────────────────────────
// AWorld's loop (TASKS.md P3 "frontier-scout v2"): a claim is only worth
// improving on if it can be REPRODUCED first. With no keyed lanes (dial-free
// doctrine) reproduction here is deterministic structural verification of the
// seed's own record — provenance, core claim, directive, promotion band —
// each check producing an honest evidence line. Never a network call.

export type SeedReproductionVerdict = "reproduced" | "not-reproduced" | "unverifiable";

export interface SeedReproduction {
  verdict: SeedReproductionVerdict;
  /** One line per check — "ok — <what held>" / "fail — <what broke>". */
  evidence: string[];
  checkedAt: number;
}

const ARXIV_ABS_RE = /arxiv\.org\/abs\/(\d{4}\.\d{4,5})(v\d+)?$/;
const HF_PAPERS_RE = /hf\.co\/papers\/(\d{4}\.\d{4,5})(v\d+)?$/;
const GITHUB_REPO_RE = /github\.com\/([\w.-]+)\/([\w.-]+)/;

/** Minimum chars of extracted core claim for the claim check to hold. */
const CLAIM_MIN_CHARS = 30;

/**
 * Deterministic AWorld-lite reproduction check over the seed's own record.
 * Pure: no dials, no storage, same input → same verdict. "reproduced" means
 * the record is structurally what it claims to be (resolvable provenance,
 * an extracted core claim, a known directive, a promotion-consistent band);
 * "not-reproduced" names the failing check in evidence; "unverifiable" means
 * the record is too empty to even attempt.
 */
export function reproduceSeed(seed: FrontierSeed): SeedReproduction {
  const evidence: string[] = [];
  const text = (seed.seed ?? "").trim();
  const url = (seed.url ?? "").trim();
  if (!text || !url) {
    return {
      verdict: "unverifiable",
      evidence: [`fail — record too empty to attempt: ${!url ? "no url" : "no seed text"}`],
      checkedAt: Date.now(),
    };
  }

  // ① provenance — the url resolves to the kind of record it claims.
  if (seed.kind === "repo") {
    const gh = GITHUB_REPO_RE.exec(url);
    evidence.push(
      gh
        ? `ok — provenance: github ${gh[1]}/${gh[2]}`
        : "fail — provenance: repo url does not resolve to github owner/repo"
    );
  } else {
    const ax = ARXIV_ABS_RE.exec(url) ?? HF_PAPERS_RE.exec(url);
    evidence.push(
      ax
        ? `ok — provenance: arXiv record ${ax[1]}`
        : "fail — provenance: paper url does not resolve to an arXiv/HF record id"
    );
  }

  // ② core claim — the distilled seed carries an extractable claim.
  const afterClaim = text.split("Core claim: ")[1] ?? "";
  const claimLen = afterClaim.includes("…") ? afterClaim.indexOf("…") : afterClaim.length;
  evidence.push(
    claimLen >= CLAIM_MIN_CHARS
      ? `ok — claim: ${claimLen} chars of core claim on record`
      : `fail — claim: core claim missing or too thin (${claimLen} chars, need ≥${CLAIM_MIN_CHARS})`
  );

  // ③ directive — the seed ends in a known area directive (not freeform).
  // Built lazily at call time: AREA_DIRECTIVES/FALLBACK live further down the
  // file and a module-load-time Set would be a TDZ ReferenceError.
  const directiveTexts: ReadonlySet<string> = new Set([
    ...AREA_DIRECTIVES.map((a) => a.directive),
    FALLBACK_DIRECTIVE,
  ]);
  const directiveKnown = [...directiveTexts].some((d) => text.includes(d));
  evidence.push(
    directiveKnown
      ? "ok — directive: matched a known area directive"
      : "fail — directive: no known area directive in the seed text"
  );

  // ④ promotion band — a seed below the watch band contradicts its promotion.
  evidence.push(
    seed.total >= FRONTIER_WATCH_AT
      ? `ok — band: total ${seed.total}/100 ≥ watch threshold ${FRONTIER_WATCH_AT}`
      : `fail — band: total ${seed.total}/100 below watch threshold ${FRONTIER_WATCH_AT} — promotion inconsistent`
  );

  const failed = evidence.filter((e) => e.startsWith("fail")).length;
  return {
    verdict: failed === 0 ? "reproduced" : "not-reproduced",
    evidence,
    checkedAt: Date.now(),
  };
}

/** Stamp a seed with a fresh reproduction verdict (pure — never mutates). */
export function withReproduction(seed: FrontierSeed): FrontierSeed {
  return { ...seed, reproduction: reproduceSeed(seed) };
}

// ─── Thresholds (rubric: adopt ≥70 · watch 50–69 · skip <50) ─────────────────

export const FRONTIER_ADOPT_AT = 70;
export const FRONTIER_WATCH_AT = 50;
/** noul confidence band that escalates to the choice rung (cascade doctrine). */
export const FRONTIER_ESCALATE_BELOW = 0.75;
export const FRONTIER_ESCALATE_ABOVE = 0.4;

// ─── localStorage ledger (browser-side, BYOK judges — nothing leaves) ────────

const ITEMS_KEY = "nexus-frontier-items";
const JUDGMENTS_KEY = "nexus-frontier-judgments";
export const SEEDS_KEY = "nexus-frontier-seeds";
const DIGEST_KEY = "nexus-frontier-digest";

const ITEMS_CAP = 500;
const JUDGMENTS_CAP = 250;
export const SEEDS_CAP = 24;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota — non-fatal, the scout is advisory
  }
}

/** id → seenAt, LRU-capped. Marks what we already showed the owner. */
export function readSeenLedger(): Record<string, number> {
  return readJson<Record<string, number>>(ITEMS_KEY, {});
}

export function markSeen(ids: string[]): void {
  if (!ids.length) return;
  const ledger = readSeenLedger();
  const now = Date.now();
  for (const id of ids) ledger[id] = now;
  const entries = Object.entries(ledger)
    .sort((a, b) => b[1] - a[1])
    .slice(0, ITEMS_CAP);
  writeJson(ITEMS_KEY, Object.fromEntries(entries));
}

export function readJudgments(): Record<string, FrontierJudgment> {
  return readJson<Record<string, FrontierJudgment>>(JUDGMENTS_KEY, {});
}

export function readJudgment(id: string): FrontierJudgment | undefined {
  return readJudgments()[id];
}

export function recordJudgment(id: string, j: FrontierJudgment): void {
  const all = readJudgments();
  all[id] = j;
  const entries = Object.entries(all)
    .sort((a, b) => b[1].judgedAt - a[1].judgedAt)
    .slice(0, JUDGMENTS_CAP);
  writeJson(JUDGMENTS_KEY, Object.fromEntries(entries));
}

/** The bridge the Evolution layer reads: newest judged seeds first. */
export function readFrontierSeeds(): FrontierSeed[] {
  return readJson<FrontierSeed[]>(SEEDS_KEY, []);
}

export function saveFrontierSeeds(seeds: FrontierSeed[]): void {
  const sorted = [...seeds]
    .sort((a, b) => b.judgedAt - a.judgedAt || b.total - a.total)
    .slice(0, SEEDS_CAP);
  writeJson(SEEDS_KEY, sorted);
}

export interface FrontierDigestMeta {
  fetchedAt: number;
  counts: { items: number; adopt: number; watch: number; skip: number; byRung: Record<string, number> };
}

export function readDigestMeta(): FrontierDigestMeta | null {
  return readJson<DigestMetaSafe>(DIGEST_KEY, null);
}
type DigestMetaSafe = FrontierDigestMeta | null;

export function saveDigestMeta(meta: FrontierDigestMeta): void {
  writeJson(DIGEST_KEY, meta);
}

/** Clear everything (Settings “reset scout ledger” / QA). */
export function clearFrontierLedger(): void {
  try {
    localStorage.removeItem(ITEMS_KEY);
    localStorage.removeItem(JUDGMENTS_KEY);
    localStorage.removeItem(SEEDS_KEY);
    localStorage.removeItem(DIGEST_KEY);
  } catch {
    // ignore
  }
}

// ─── ① RULES — deterministic rubric ─────────────────────────────────────────

const log1p = (n: number): number => Math.log1p(Math.max(0, n));

/** Score the axes rules can judge honestly; relevance starts neutral. */
export function ruleScores(
  item: FrontierItem,
  seedLedgerTitles: string[]
): FrontierScores {
  const ageDays = item.createdAt
    ? Math.max(0, (Date.now() - Date.parse(item.createdAt)) / 86_400_000)
    : 14;

  // velocity 0–15: log stars/upvotes (whichever exists) + fresh-repo bonus.
  const traction = Math.max(item.stars ?? 0, item.upvotes ?? 0);
  let velocity = Math.min(10, log1p(traction) * 1.55);
  if (ageDays <= 7) velocity += 3;
  else if (ageDays <= 30) velocity += 1.5;
  velocity = Math.round(Math.min(15, velocity));

  // evidence 0–15: curated hub + topic signals (benchmark/code/eval).
  let evidence = item.hub === "huggingface-papers" ? 8 : item.hub === "github" ? 5 : 4;
  const topics = (item.topics ?? []).map((t) => t.toLowerCase());
  if (topics.some((t) => /benchmark|eval|dataset/.test(t))) evidence += 4;
  if (topics.some((t) => /rl|reinforcement|post-training|grpo|dpo/.test(t))) evidence += 2;
  if ((item.stars ?? 0) >= 500) evidence += 2;
  evidence = Math.round(Math.min(15, evidence));

  // novelty 0–20: shingle-Jaccard distance vs seed-ledger titles (L0 prefilter
  // doctrine — semantic judgment stays with the decision model).
  const cur = shingles(`${item.title} ${item.summary}`.slice(0, 600));
  let maxSim = 0;
  for (const t of seedLedgerTitles) {
    maxSim = Math.max(maxSim, jaccard(cur, shingles(t)));
  }
  const novelty = Math.round(Math.min(20, (1 - maxSim) * 20));

  // implementability 0–20: has-code repos implement directly; papers need a
  // harness translation (still possible — the platform is the harness).
  let implementability = item.kind === "repo" ? 14 : 10;
  if (topics.some((t) => /agent|workflow|harness|orchestr/.test(t))) implementability += 4;
  if (/gpu|train|fine-tun/i.test(item.summary)) implementability -= 4;
  implementability = Math.round(Math.max(0, Math.min(20, implementability)));

  return { relevance: 12, novelty, implementability, evidence, velocity };
}

export function fuseScores(s: FrontierScores): number {
  return Math.round(s.relevance + s.novelty + s.implementability + s.evidence + s.velocity);
}

export function verdictOf(total: number): FrontierVerdict {
  return total >= FRONTIER_ADOPT_AT ? "adopt" : total >= FRONTIER_WATCH_AT ? "watch" : "skip";
}

// ─── ②/③ SYSTEMONE cascade — typed verdicts on the free decision ladder ─────

function clampState(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 1200);
}

export interface FrontierJudgeOptions {
  /** Skip the LLM rungs entirely (rules-only mode / no keys configured). */
  rulesOnly?: boolean;
  signal?: AbortSignal;
}

/**
 * Judge one item through the cascade. Never throws — the worst case is a
 * rules-only judgment. Returns the judgment and, when the SYSTEMONE rungs
 * fired, refines the relevance axis so the rubric total reflects the judge.
 */
export async function judgeFrontierItem(
  item: FrontierItem,
  settings: Settings,
  opts: FrontierJudgeOptions = {}
): Promise<FrontierJudgment> {
  const started = Date.now();
  const ledger = readFrontierSeeds();
  const scores = ruleScores(item, ledger.map((s) => `${s.title} ${s.seed}`));
  let total = fuseScores(scores);
  let via: FrontierJudgment["via"] = "rules";
  let confidence: number | undefined;
  let reason = "Rubric only — no judge ran (rules-only mode or no decision lane).";

  if (opts.rulesOnly) {
    return { total, scores, via, verdict: verdictOf(total), reason, judgedAt: Date.now() };
  }

  const state = clampState(`${item.title}. ${item.summary}`);

  // ── ② noul relevance gate (typed, calibrated) ──
  const gate = await decide({
    settings,
    signal: opts.signal,
    state,
    question: {
      id: "frontier-relevance",
      type: "noul",
      prompt:
        "Is this finding directly relevant to improving a local-first agentic LLM workflow platform — its relay lanes, decision judges, evolution/novelty loop, or agent harness?",
      criteriaTrue:
        "The work proposes methods, harnesses, training or evaluation techniques that a multi-provider agent-workflow platform could adopt in its orchestration, judging or self-improvement loop.",
      criteriaFalse:
        "Pure domain science (biology, physics), pure theory with no system implication, or a product announcement with no method.",
    },
  });

  if (gate) {
    via = gate.via;
    confidence = gate.confidence;
    const positive = gate.answer === "yes";
    // Refine the neutral relevance axis with the calibrated verdict.
    scores.relevance = positive
      ? Math.min(30, 18 + Math.round(gate.confidence * 12))
      : Math.max(0, Math.round(12 * gate.confidence));
    total = fuseScores(scores);
    reason = `${gate.judge}: ${positive ? "relevant" : "not relevant"} (${Math.round(gate.confidence * 100)}% conf)`;

    const uncertain = gate.confidence < FRONTIER_ESCALATE_BELOW && gate.confidence > FRONTIER_ESCALATE_ABOVE;
    const inBand = total >= FRONTIER_WATCH_AT - 5;

    // ── ③ mid-band escalation → typed choice verdict (only the ambiguous
    // mass escalates — the cascade's whole point) ──
    if (uncertain || (positive && inBand && gate.confidence < 0.9)) {
      const choice = await decide({
        settings,
        signal: opts.signal,
        state,
        question: {
          id: "frontier-verdict",
          type: "choice",
          prompt:
            "Should this finding be ADOPTED (build an improvement seed and try it in a pipeline experiment), WATCHED (keep on the ledger) or SKIPPED (not actionable here)?",
          options: ["adopt", "watch", "skip"],
        },
      });
      if (choice && ["adopt", "watch", "skip"].includes(choice.answer)) {
        via = choice.via;
        confidence = choice.confidence;
        // Fuse: keep the rubric's shape, but never contradict the typed verdict.
        if (choice.answer === "adopt") total = Math.max(total, FRONTIER_ADOPT_AT);
        else if (choice.answer === "watch") total = Math.min(Math.max(total, FRONTIER_WATCH_AT), FRONTIER_ADOPT_AT - 1);
        else total = Math.min(total, FRONTIER_WATCH_AT - 1);
        reason = `${choice.judge}: ${choice.answer} (${Math.round(choice.confidence * 100)}% conf) — escalated past the relevance gate`;
      }
    }
  }

  const verdict = verdictOf(total);
  return {
    total,
    scores,
    via,
    verdict,
    confidence,
    reason,
    judgedAt: Date.now(),
    ms: Date.now() - started,
  };
}

// ─── Seed distillation ───────────────────────────────────────────────────────

const AREA_DIRECTIVES: Array<{ re: RegExp; directive: string }> = [
  {
    re: /\b(rl|reinforcement|grpo|dpo|reward|post-train|policy)\b/i,
    directive:
      "Translate its reward/credit-assignment idea into our Evolution loop: what should the runner record per step (hops, verdicts, tool calls) so a stalled pipeline gets a smarter variation angle than the fixed 4-branch router.",
  },
  {
    re: /\b(judge|verifier|evaluat|rubric|calibrat)\b/i,
    directive:
      "Map its verification scheme onto our SystemOne ladder: which gate question changes, what the typed criteria become, and where the escalation band should sit.",
  },
  {
    re: /\b(memory|context|compact|summar|note-taking|state)\b/i,
    directive:
      "Adapt its context/memory policy into our step-to-step context builder: what structured NOTES artifact each agent should maintain between steps and what gets compacted.",
  },
  {
    re: /\b(agent|harness|orchestrat|workflow|multi-agent|crew)\b/i,
    directive:
      "Borrow its harness construct into our crew layer: role/goal/expected-output contract changes, a new process mode, or a better doom-loop and completion-reason policy for the tool loop.",
  },
  {
    re: /\b(relay|routing|router|model select|cost|latency|fallback)\b/i,
    directive:
      "Turn its routing idea into a relay-lane policy: chain ordering, health signals, or a taskFit refinement for buildRelayChain — free lanes stay first.",
  },
  {
    re: /\b(novelty|diversity|entropy|dedup|search|explor)\b/i,
    directive:
      "Upgrade our novelty metric per its method: keep shingle-Jaccard as the L0 prefilter, add its signal as the L1 judge, and gate 'novel AND useful' before a stall fires a proposal.",
  },
  {
    re: /\b(tool|function call|sandbox|browser|mcp)\b/i,
    directive:
      "Fold its tool-interface lesson into our tool defs/ACI: tool description wording, result fencing, or where long tool outputs should live (inline vs on-disk grep).",
  },
];

const FALLBACK_DIRECTIVE =
  "Extract one implementable mechanism and specify it as a change to our workflow-runner, SystemOne gates or Evolution ledger — prefer S-effort wire-level adaptations over framework imports.";

/** Distill a judged item into a paste-into-Studio improvement seed. */
export function seedFromItem(item: FrontierItem, j: FrontierJudgment): FrontierSeed {
  const haystack = `${item.title} ${item.summary} ${(item.topics ?? []).join(" ")}`;
  const area = AREA_DIRECTIVES.find((a) => a.re.test(haystack));
  const oneLine = item.summary.replace(/\s+/g, " ").trim().slice(0, 180);
  const seed: FrontierSeed = {
    id: item.id,
    kind: item.kind,
    title: item.title,
    url: item.url,
    total: j.total,
    judgedAt: j.judgedAt,
    seed:
      `Adapt “${item.title}” (${item.url}) — ${j.verdict.toUpperCase()} ${j.total}/100 via ${j.via}. ` +
      `Core claim: ${oneLine}… ` +
      (area?.directive ?? FALLBACK_DIRECTIVE),
  };
  // r582 AWorld: the explore→reproduce→improve loop closes at creation —
  // every seed leaves the distiller already reproduction-marked.
  return withReproduction(seed);
}

/** Promote an adopt/watch item into the seed ledger (dedup by id, newest wins). */
export function promoteSeed(seed: FrontierSeed): FrontierSeed[] {
  const rest = readFrontierSeeds().filter((s) => s.id !== seed.id);
  const next = [seed, ...rest].slice(0, SEEDS_CAP);
  saveFrontierSeeds(next);
  return next;
}

/** Top unjudged-or-stale items the tab auto-judges first (respect BYOK: only
 *  when a decision lane exists — settings gate is applied by the caller). */
export function pickJudgeQueue(items: FrontierItem[], limit = 6): FrontierItem[] {
  const judged = readJudgments();
  const seen = readSeenLedger();
  return [...items]
    .sort((a, b) => {
      const aj = judged[a.id];
      const bj = judged[b.id];
      if (aj && !bj) return 1;
      if (bj && !aj) return -1;
      const av = Math.max(a.stars ?? 0, a.upvotes ?? 0) + (seen[a.id] ? -1e6 : 0);
      const bv = Math.max(b.stars ?? 0, b.upvotes ?? 0) + (seen[b.id] ? -1e6 : 0);
      return bv - av;
    })
    .slice(0, limit);
}

/** Aggregate the judgment-boundary table (per-rung decision counts). */
export function boundaryTable(judgments: FrontierJudgment[]): Record<string, number> {
  const out: Record<string, number> = { rules: 0, "intern-systemone": 0, "fast-model": 0 };
  for (const j of judgments) out[j.via] = (out[j.via] ?? 0) + 1;
  return out;
}
