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
 * both prepend this to the system side. Oldest-added skills win the budget
 * (stable behavior), the block states its own provenance so the model knows
 * these are user-curated capabilities, not the operator's live voice.
 */
export function buildSkillsBlock(skills: AgentSkill[] | undefined): string {
  if (!skills || skills.length === 0) return "";
  const enabled = skills.filter((s) => s.enabled);
  if (enabled.length === 0) return "";

  let budget = SKILLS_INJECT_MAX_CHARS;
  const parts: string[] = [];
  for (const s of enabled) {
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
