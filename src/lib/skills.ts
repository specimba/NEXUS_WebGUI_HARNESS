"use client";

// ─── Skills (r36, PraisonAI SKILL.md doctrine — instructions-only) ───────────
// The real PraisonAI repo is skills-centric: a SKILL.md file (YAML frontmatter
// with name/description + a markdown body) teaches an agent a reusable
// capability. This module parses those documents and budgets their injection
// into agent context.
//
// HARD DOCTRINE (unchanged since r1): a skill's scripts/ folder is NEVER
// executed. v1 doesn't even parse the scripts section — the body is plain
// guidance text, and the node:vm sandbox discipline holds untouched.

import {
  SKILLS_INJECT_MAX_CHARS,
  SKILL_BODY_MAX_CHARS,
  SKILLS_MAX,
  SKILL_RELEVANCE_SCAN_CHARS,
} from "@/lib/constants";
import type { AgentSkill } from "@/lib/types";

export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

/**
 * Parse a SKILL.md document: YAML frontmatter (--- blocks) provides
 * name/description; everything after the frontmatter is the body. Falls back
 * to the first markdown heading (name) and first paragraph (description) when
 * frontmatter is absent — real-world skill files are messy, be forgiving.
 */
export function parseSkillMarkdown(raw: string): { ok: true; skill: ParsedSkill } | { ok: false; error: string } {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (text.length === 0) return { ok: false, error: "The file is empty." };

  let name = "";
  let description = "";
  let body = text;

  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (fm) {
    body = text.slice(fm[0].length).trim();
    for (const line of fm[1].split(/\r?\n/)) {
      const m = /^(name|description)\s*:\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (m[1] === "name" && value) name = value;
      if (m[1] === "description" && value) description = value;
    }
  }

  // Fallbacks: first H1 for the name, first non-heading paragraph for the blurb.
  if (!name) {
    const h1 = /^#\s+(.+)$/m.exec(body);
    name = (h1?.[1] ?? "Untitled skill").trim().slice(0, 80);
  }
  if (!description) {
    const para = body
      .split(/\r?\n\r?\n/)
      .map((p) => p.trim())
      .find((p) => p.length > 0 && !p.startsWith("#") && !p.startsWith("```"));
    description = (para ?? "").replace(/\s+/g, " ").slice(0, 200);
  }

  const clipped = body.slice(0, SKILL_BODY_MAX_CHARS);
  if (clipped.trim().length === 0) {
    return { ok: false, error: "No instruction body found (frontmatter only?)." };
  }

  return {
    ok: true,
    skill: {
      name: name || "Untitled skill",
      description,
      body: clipped,
    },
  };
}

/**
 * Budgeted injection block for enabled skills — chat turns and pipeline steps
 * both prepend this to the system side. r37 relevance ranking: when a task is
 * provided, skills whose name/description/body share vocabulary with the task
 * ride FIRST (the budget is finite — the most relevant skill must not be the
 * one that gets truncated). Ties and task-less calls keep the stable
 * oldest-added order. The block states its own provenance so the model knows
 * these are user-curated capabilities, not the operator's live voice.
 */
export function buildSkillsBlock(skills: AgentSkill[] | undefined, task?: string): string {
  if (!skills || skills.length === 0) return "";
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return "";

  const ordered = rankSkillsByRelevance(enabled, task);

  let budget = SKILLS_INJECT_MAX_CHARS;
  const parts: string[] = [];
  for (const s of ordered) {
    if (budget <= 200) break;
    const body = s.body.slice(0, Math.min(s.chars, budget));
    if (body.length === 0) continue;
    parts.push(
      `### Skill: ${s.name}\n${s.description ? `(${s.description})\n` : ""}${body}`
    );
    budget -= body.length + 40;
  }
  if (parts.length === 0) return "";

  return (
    "\n\nSKILLS the user has installed for you (follow them when relevant to " +
    "the current task — they are curated instructions, not passing chatter):\n\n" +
    parts.join("\n\n")
  );
}

// ─── r37 relevance ranking ───────────────────────────────────────────────────

/** Chatter words that say nothing about what the task is actually about. */
const STOPWORDS = new Set(
  ("the a an and or but if then else for to of in on at by with from as is are was were be been " +
    "being do does did doing have has had having i you he she it we they me him her us them my your " +
    "this that these those there here what which who whom whose when where why how not no yes " +
    "please can could should would will shall may might must about into over under again further " +
    "out up down off all any both each few more most other some such only own same so than too very " +
    "just now also make made write written give given using use used help need want let get got " +
    "step steps first second third next last new old")
    .split(" ")
    .filter(Boolean)
);

const TOKEN_RE = /[a-z0-9][a-z0-9+#.\-]{1,30}/g;

/** Lowercased word tokens ≥2 chars, minus chatter — the shared vocabulary space. */
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(TOKEN_RE)) {
    const t = m[0].replace(/[.\-]+$/, "");
    if (t.length >= 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

/**
 * Vocabulary match with a light morphological fallback: exact hit, or a
 * shared prefix of ≥4 chars ("research" ↔ "researcher", "test" ↔ "tests").
 * Exact equality first keeps the common case honest; the ≥4 floor keeps
 * short words from cross-matching ("run" never matches "running").
 */
function termIn(set: Set<string>, term: string): boolean {
  if (set.has(term)) return true;
  if (term.length < 4) return false;
  for (const t of set) {
    if (t.length >= 4 && (t.startsWith(term) || term.startsWith(t))) return true;
  }
  return false;
}

export interface SkillRelevance {
  skill: AgentSkill;
  /** Weighted overlap score vs the task (0 = no signal). */
  score: number;
  /** Matched task terms — surfaced in the gallery as an honest "why ranked". */
  matched: string[];
}

/**
 * r37: order skills by vocabulary overlap with the task. Name matches weigh
 * ×3 (the name IS the capability), description ×2, body head ×1. A task-less
 * call (or an all-zero round) returns the input order unchanged — oldest-first
 * stays the stable default so behavior never silently shuffles.
 */
export function rankSkillsByRelevance(skills: AgentSkill[], task?: string): AgentSkill[] {
  const query = (task ?? "").trim();
  if (query.length < 8) return skills;
  const q = tokenize(query);
  if (q.size === 0) return skills;

  const scored: (SkillRelevance | null)[] = skills.map((skill) => {
    const nameTerms = tokenize(skill.name);
    const descTerms = tokenize(skill.description);
    const bodyTerms = tokenize(skill.body.slice(0, SKILL_RELEVANCE_SCAN_CHARS));
    let score = 0;
    const matched: string[] = [];
    for (const term of q) {
      const w =
        (termIn(nameTerms, term) ? 3 : 0) +
        (termIn(descTerms, term) ? 2 : 0) +
        (termIn(bodyTerms, term) ? 1 : 0);
      if (w > 0) {
        score += w;
        matched.push(term);
      }
    }
    return matched.length > 0 ? { skill, score, matched } : null;
  });

  const hits = scored.filter((x): x is SkillRelevance => x != null);
  // Nobody matched → keep the input order (no silent shuffle).
  if (hits.length === 0) return skills;

  const rank = new Map<string, number>();
  [...hits]
    .sort((a, b) => b.score - a.score)
    .forEach((h, i) => rank.set(h.skill.id, i));
  return [...skills].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

/** Gallery helper: honest total context cost of the enabled set. */
export function skillsInjectChars(skills: AgentSkill[] | undefined): number {
  if (!skills) return 0;
  return skills
    .filter((s) => s.enabled)
    .reduce((acc, s) => acc + Math.min(s.chars, SKILL_BODY_MAX_CHARS), 0);
}

/** Cap helper for the store: oldest-added skills drop beyond SKILLS_MAX. */
export function capSkills(skills: AgentSkill[]): AgentSkill[] {
  return skills.slice(-SKILLS_MAX);
}
