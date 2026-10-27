/**
 * r651 (paper adaptation slice, arXiv 2610.31421 "Looping shapes ICL" F6/F7,
 * riding the r649/r650 TraceTrial archive work) — the precedent-exemplar
 * lane.
 *
 * The paper: induction circuits copy the continuation of an EARLIER
 * occurrence, and induction-head importance GROWS with token position — an
 * exemplar shown twice (early anchor + immediately before the generation
 * point) is copied far more reliably than one shown once (two-occurrence
 * rule, `twoOccurrencePrompt` in looped-icl.ts). The house lane: the run
 * archive IS our precedent store — the top-2 similar past-successful
 * outputs, retrieved by the r579 RRF hybrid shim, laid out through that
 * rule (rank-1 gets the full two-occurrence treatment; rank-2 rides in the
 * anchor zone as a single supporting reference so it adds diversity without
 * diluting the generation-point target).
 *
 * Port the QUESTIONS, never the mechanism: pure, dial-free, never-throw.
 * Eligibility is honesty-first — a precedent must have SUCCEEDED and carry
 * a replayable output (empty strings and the archive's "(no output
 * recorded)" placeholder IMPERSONATE evidence and are refused, the same F6
 * discipline the archive chip enforces); a caller that KNOWS a precedent
 * failed its lineage criterion (harnessChipForArchiveRun tone "warn")
 * passes lineageOk:false and the row is refused — you cannot quote a row
 * that was never replayable. Unknown lineage (undefined) stays eligible:
 * unobservable is not fail.
 */

import { twoOccurrencePrompt } from "./looped-icl";
// The r579 RRF hybrid shim (BM25 + hashed-trigram cosine, RRF k=60) — the
// embedder-agnostic retrieval layer the lane rides on.
import { HybridRetriever } from "./rrf-retrieval";

/** The archive's no-output placeholder (run-archive writers) — refused. */
const NO_OUTPUT_MARKER = "(no output recorded)";

/** Structural precedent row: a settled archive entry (or any past run). */
export interface PrecedentRow {
  id: string;
  workflowName?: string;
  /** The task the precedent ran (retrieval leg text). */
  task?: string;
  /** The settled output (retrieval leg text + the exemplar body). */
  output?: string;
  /** Agent-layer outcome — only "done" precedents are eligible. */
  status?: string;
  /** Caller-known lineage verdict: false REFUSES the row (blind rows are
   * not quotable); undefined = unobservable = still eligible. */
  lineageOk?: boolean;
}

export interface PrecedentExemplar {
  id: string;
  workflowName: string;
  /** RRF-fused similarity of the precedent to the current task. */
  rrfScore: number;
  /** Which legs agreed (cyan = both, amber = single — the r579 vocabulary). */
  legs: "both" | "single";
  /** The quoted output head (whitespace-collapsed, capped). */
  excerpt: string;
}

export interface PrecedentLaneResult {
  /** Eligible precedents considered, after the honesty filter. */
  eligible: number;
  /** Top exemplars (<= topN) in RRF order. */
  exemplars: PrecedentExemplar[];
  /** The assembled two-occurrence prompt block (empty when no exemplar). */
  promptBlock: string;
  /** Char index of the rank-1 anchor inside promptBlock (-1 when empty). */
  anchorIndex: number;
  /** Char index of the rank-1 generation-point target (-1 when empty). */
  targetIndex: number;
  /** Countable note (house vocabulary) — "" when nothing eligible. */
  note: string;
}

const EXCERPT_CAP = 600;
const DOC_TEXT_CAP = 1200;
const PROMPT_BLOCK_CAP = 4000;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The honesty filter: succeeded + replayable output + (optionally) known-
 * good lineage. Deterministic and silent about refusals except via counts. */
export function eligiblePrecedents(rows: PrecedentRow[]): PrecedentRow[] {
  try {
    const list = Array.isArray(rows) ? rows : [];
    return list.filter((r) => {
      if (!r || typeof r !== "object") return false;
      if (r.status !== "done") return false;
      const out = typeof r.output === "string" ? r.output.trim() : "";
      if (out.length === 0 || out === NO_OUTPUT_MARKER) return false;
      if (r.lineageOk === false) return false;
      return true;
    });
  } catch {
    return [];
  }
}

/**
 * Retrieve the top-2 similar past-successful outputs and assemble the
 * two-occurrence prompt block. `topN` defaults to 2 (the handoff contract);
 * rank-1 receives the anchor+target layout, rank-2 (when present) joins the
 * anchor zone as a single supporting reference.
 */
export function precedentRetrieval(
  task: string,
  rows: PrecedentRow[],
  topN = 2,
): PrecedentLaneResult {
  const empty: PrecedentLaneResult = {
    eligible: 0,
    exemplars: [],
    promptBlock: "",
    anchorIndex: -1,
    targetIndex: -1,
    note: "",
  };
  try {
    const q = typeof task === "string" ? task.trim() : "";
    const eligible = eligiblePrecedents(rows);
    if (!q || eligible.length === 0) {
      return { ...empty, eligible: eligible.length };
    }
    // Pure per-call index over capped doc texts — archive-scale corpora
    // (300-run FIFO) stay in the milliseconds, dial-free.
    const corpus = eligible.map((r) => ({
      id: r.id,
      text: collapse(
        `${r.workflowName ?? ""} ${r.task ?? ""} ${typeof r.output === "string" ? r.output.slice(0, DOC_TEXT_CAP) : ""}`,
      ),
    }));
    const retriever = new HybridRetriever(corpus);
    const ranked = retriever.hybrid(q, Math.min(Math.max(1, Math.floor(topN) || 2), 4));
    if (ranked.length === 0) {
      return { ...empty, eligible: eligible.length };
    }
    const byId = new Map(eligible.map((r) => [r.id, r]));
    const exemplars: PrecedentExemplar[] = ranked.map((r) => {
      const row = byId.get(r.id);
      const out = collapse(row?.output ?? "");
      return {
        id: r.id,
        workflowName: row?.workflowName ?? row?.id ?? r.id,
        rrfScore: r.rrfScore,
        legs: r.bm25Rank != null && r.vecRank != null ? "both" : "single",
        excerpt: out.slice(0, EXCERPT_CAP),
      };
    });
    const primary = exemplars[0];
    const two = twoOccurrencePrompt(q, primary.excerpt);
    let block = two.prompt;
    if (exemplars.length > 1 && exemplars[1].excerpt) {
      block += `\n\nSupporting precedent (${exemplars[1].workflowName}, similarity ${exemplars[1].rrfScore.toFixed(4)}):\n${exemplars[1].excerpt}`;
    }
    const capped = block.length > PROMPT_BLOCK_CAP;
    const promptBlock = capped ? `${block.slice(0, PROMPT_BLOCK_CAP)}…` : block;
    const note =
      `Precedent lane — ${eligible.length} eligible precedent${eligible.length === 1 ? "" : "s"}, ` +
      `top ${exemplars.length}: ${exemplars
        .map((e) => `${e.workflowName} (rrf ${e.rrfScore.toFixed(4)}, ${e.legs} leg${e.legs === "both" ? "s" : ""})`)
        .join("; ")} — two-occurrence layout assembled${capped ? ", prompt block capped" : ""}`;
    return {
      eligible: eligible.length,
      exemplars,
      promptBlock,
      anchorIndex: two.anchorIndex,
      targetIndex: promptBlock.lastIndexOf("Generate now:"),
      note,
    };
  } catch {
    return empty;
  }
}
