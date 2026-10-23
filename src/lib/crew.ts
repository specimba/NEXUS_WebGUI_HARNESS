// ─── Crew harness (r511) ─────────────────────────────────────────────────────
// Owner directive: "lets focus on here for automated, autonomous, assigned,
// aligned workers as Praison promised. A strategy like OpenClaw and Hermes
// agents works, and we should obtain or create our harness system within our
// whole workflow."
//
// Doctrine (harness.ts r31 sweep, unchanged): borrow vocabulary, never import
// a framework. PraisonAI's role/task/expected_output alignment and the
// Hermes-style closed learning loop are expressed here as PLAIN DATA the
// platform already consumes: a role is a goal + backstory + an expected-output
// contract + a SystemOne judge-gate policy. No runtime, no scheduler, no new
// dependency. Where harness.ts tunes HOW the stack runs (relay bias, budgets,
// lessons), crew.ts says WHO does what and what "done" means for each worker.
//
// Everything in this module is pure data + pure functions — no store imports,
// no side effects — so the panel, the runner and any future harness consumer
// read the exact same definitions.

import type { Agent, Workflow } from "./types";

// ─── Crew roles ──────────────────────────────────────────────────────────────

export type CrewRoleId = "scout" | "judge" | "curator" | "implementer" | "operator" | "reviewer";

export interface CrewRoleDef {
  id: CrewRoleId;
  name: string;
  glyph: string;
  /** One-sentence objective this worker optimizes for (Praison goal). */
  goal: string;
  /** Persona grounding (Praison backstory). */
  backstory: string;
  /** Praison expected_output contract — what a finished artifact looks like. */
  expectedOutput: string;
  /** SystemOne judge-gate policy for outputs of this role (free ladder, r510). */
  gate: {
    enabled: boolean;
    /** noul gate question template; {{output}} placeholder. */
    question: string;
    /** Minimum noul confidence for a PASS (aligns with SYSTEMONE_GATE_CONFIDENCE). */
    threshold: number;
  };
}

/**
 * The six crew roles. Gate policy mirrors the workflow-runner's verification
 * doctrine: gates run where a wrong artifact is expensive to catch downstream
 * (judgments, builds, reviews) and stay off where the next consumer re-checks
 * the work anyway (raw finds, filed material, live ops notes).
 */
export const CREW_ROLE_DEFS: Record<CrewRoleId, CrewRoleDef> = {
  scout: {
    id: "scout",
    name: "Scout",
    glyph: "🔭",
    goal: "Find new verifiable inputs — sources, facts, tools and leads — and hand them forward with provenance.",
    backstory:
      "A frontier scout who trusts primary sources over summaries, records where every claim came from, and would rather report an honest dead end than a plausible guess.",
    expectedOutput:
      "A concise findings brief: each claim with its source link or tool provenance, explicit gaps and dead ends, and a one-line 'worth pursuing next' list.",
    gate: {
      enabled: false,
      question:
        "Is {{output}} a faithful findings brief — every load-bearing claim carries provenance and the gaps are stated, not hidden?",
      threshold: 0.75,
    },
  },
  judge: {
    id: "judge",
    name: "Judge",
    glyph: "⚖️",
    goal: "Return calibrated verdicts — pass/rework decisions with confidence and reasons a reviewer can audit.",
    backstory:
      "A calm adjudicator who separates evidence from opinion, states a confidence number with every verdict, and treats 'not enough information' as a legitimate answer.",
    expectedOutput:
      "A verdict (pass or rework) with a confidence figure, the specific criteria met or missed, and what evidence would change the decision.",
    gate: {
      // A judge judging judges: verdicts are the one artifact every other
      // worker trusts, so the gate audits the auditor.
      enabled: true,
      question:
        "Is {{output}} a well-calibrated verdict — does the cited evidence actually support the decision, with confidence matching the strength of that evidence?",
      threshold: 0.75,
    },
  },
  curator: {
    id: "curator",
    name: "Curator",
    glyph: "🗂️",
    goal: "Keep the working set organized — deduplicate, index and file every artifact so the crew can find it later.",
    backstory:
      "A meticulous librarian who names things consistently, merges duplicates instead of hoarding them, and believes an unfindable finding is a lost finding.",
    expectedOutput:
      "An indexed, deduplicated collection: stable names, one canonical entry per item, cross-references where artifacts relate, and a short changelog of what moved.",
    gate: {
      enabled: false,
      question:
        "Is {{output}} properly curated — deduplicated, consistently named and indexed so a teammate could retrieve any item without asking?",
      threshold: 0.75,
    },
  },
  implementer: {
    id: "implementer",
    name: "Implementer",
    glyph: "🛠️",
    goal: "Turn plans into working artifacts — code, configs and drafts that are complete enough to ship as-is.",
    backstory:
      "A hands-on builder who defines 'done' as runs-without-hand-holding, refuses to leave placeholders behind, and states every assumption the artifact depends on.",
    expectedOutput:
      "A complete, self-contained artifact: no placeholders or TODOs where substance belongs, assumptions stated, and exactly what was built (and what was not) declared up front.",
    gate: {
      enabled: true,
      question:
        "Is {{output}} compile-ready/complete — no placeholder stubs, no missing pieces, usable as-is without a follow-up question?",
      threshold: 0.75,
    },
  },
  operator: {
    id: "operator",
    name: "Operator",
    glyph: "🛰️",
    goal: "Keep the machines running — schedules, lanes, monitors and retries, with honest status notes.",
    backstory:
      "A shift operator from the automation floor: checks the pulse before acting, writes down what changed and why, and escalates the moment a pattern repeats.",
    expectedOutput:
      "An ops log entry: what ran, what failed, what was retried or re-routed, current state of every monitored lane, and the next check time.",
    gate: {
      enabled: false,
      question:
        "Is {{output}} an actionable ops note — current state, actions taken and next steps are all stated without ambiguity?",
      threshold: 0.75,
    },
  },
  reviewer: {
    id: "reviewer",
    name: "Reviewer",
    glyph: "🔬",
    goal: "Audit finished work against its goal — catch gaps, overclaims and drift before anything ships.",
    backstory:
      "A sharp but fair reviewer who reads the goal first and the artifact second, cites the exact line where work drifts, and always pairs a rejection with a fixable next step.",
    expectedOutput:
      "A review note: explicit pass/rework, the goal criteria checked one by one, precise locations of any gaps or overclaims, and concrete fix suggestions.",
    gate: {
      enabled: true,
      question:
        "Is {{output}} a complete review — does it check every goal criterion, cite specific evidence for each finding, and give an actionable verdict?",
      threshold: 0.75,
    },
  },
};

/** Canonical role ordering used by the roster sort and the seed order. */
export const CREW_ROLE_ORDER: CrewRoleId[] = [
  "scout",
  "judge",
  "curator",
  "implementer",
  "operator",
  "reviewer",
];

/**
 * Map an existing agent onto a crew role by keyword — deterministic,
 * case-insensitive, tested name FIRST, then role, then description, with the
 * documented default ("scout") when nothing matches. The keyword map is data,
 * not magic: it exists so the crew panel can label a legacy roster the moment
 * the panel mounts, without touching any agent record.
 */
const ROLE_KEYWORDS: Array<{ id: CrewRoleId; re: RegExp }> = [
  { id: "scout", re: /research|scout|discover/i },
  { id: "judge", re: /judge|eval|verif/i },
  { id: "curator", re: /curator|librar|index/i },
  { id: "implementer", re: /implement|build|code|engineer/i },
  { id: "operator", re: /ops|schedul|monitor|autopilot/i },
  { id: "reviewer", re: /review|refine|edit/i },
];

export function crewRoleIdForAgent(agent: Pick<Agent, "name" | "role" | "description">): CrewRoleId {
  const fields = [agent.name ?? "", agent.role ?? "", agent.description ?? ""];
  for (const field of fields) {
    for (const kw of ROLE_KEYWORDS) {
      if (kw.re.test(field)) return kw.id;
    }
  }
  return "scout";
}

// ─── Roster + alignment ──────────────────────────────────────────────────────

export interface CrewMember {
  agent: Agent;
  roleId: CrewRoleId;
  def: CrewRoleDef;
  /** True when the agent carries a non-empty goal (Praison L1 alignment). */
  hasGoal: boolean;
}

/** Project a roster onto the crew roles (pure — no store reads). */
export function crewRoster(agents: Agent[]): CrewMember[] {
  return agents.map((agent) => {
    const roleId = crewRoleIdForAgent(agent);
    return { agent, roleId, def: CREW_ROLE_DEFS[roleId], hasGoal: !!agent.goal?.trim() };
  });
}

/**
 * How aligned the crew + pipelines are, in one snapshot: goal coverage on the
 * roster, step assignment coverage across workflows, and what the judge gates
 * actually did in recorded runs.
 */
export interface CrewAlignment {
  agents: number;
  withGoal: number;
  steps: number;
  assignedSteps: number;
  gatedSteps: number;
  gatePass: number;
  gateFail: number;
}

export function crewAlignment(agents: Agent[], workflows: Array<Pick<Workflow, "steps" | "runs">>): CrewAlignment {
  const byId = new Map(crewRoster(agents).map((m) => [m.agent.id, m]));

  let steps = 0;
  let assignedSteps = 0;
  let gatedSteps = 0;
  for (const wf of workflows) {
    for (const st of wf.steps ?? []) {
      steps += 1;
      const member = byId.get(st.agentId);
      if (!member) continue;
      assignedSteps += 1;
      if (member.def.gate.enabled) gatedSteps += 1;
    }
  }

  // Gate outcomes — primary signal is the runner's callLog: the verification
  // gate records `note: "System-One gate PASS <n>% (<via>) — …"` on pass
  // (workflow-runner.ts r511). No FAIL note exists today (a FAIL falls through
  // to the full verification pass without a log entry), but future variants
  // are counted defensively. Fallback signal (be defensive — shapes evolved
  // across rounds): review-step verdicts (pass/rework) from run steps.
  let gatePass = 0;
  let gateFail = 0;
  let callLogGateEntries = 0;
  let verdictPass = 0;
  let verdictRework = 0;
  for (const wf of workflows) {
    for (const run of wf.runs ?? []) {
      for (const entry of run.callLog ?? []) {
        const note = typeof entry?.note === "string" ? entry.note : "";
        if (!note) continue;
        if (/system-one gate pass/i.test(note)) {
          callLogGateEntries += 1;
          gatePass += 1;
        } else if (/system-one gate (?:fail|rework)/i.test(note)) {
          callLogGateEntries += 1;
          gateFail += 1;
        }
      }
      for (const st of run.steps ?? []) {
        if (st?.kind !== "review" || !st.verdict) continue;
        if (st.verdict === "pass") verdictPass += 1;
        else if (st.verdict === "rework") verdictRework += 1;
      }
    }
  }
  if (callLogGateEntries === 0) {
    gatePass = verdictPass;
    gateFail = verdictRework;
  }

  return {
    agents: agents.length,
    withGoal: agents.filter((a) => !!a.goal?.trim()).length,
    steps,
    assignedSteps,
    gatedSteps,
    gatePass,
    gateFail,
  };
}

// ─── Presets (crew-size starting lineups) ────────────────────────────────────

export interface CrewPreset {
  id: string;
  name: string;
  glyph: string;
  tagline: string;
  description: string;
  roleIds: CrewRoleId[];
  chips: string[];
}

/** Inspiration cited honestly — these are vocabulary presets, not imports. */
export const CREW_PRESETS: CrewPreset[] = [
  {
    id: "research-crew",
    name: "Research Crew",
    glyph: "🔍",
    tagline: "PraisonAI-style role/task alignment — find, verify, file",
    description:
      "A three-worker research loop: the Scout gathers verifiable inputs, the Judge calibrates what the findings claim (its verdicts run under the judge gate), and the Curator files what survives.",
    roleIds: ["scout", "judge", "curator"],
    chips: ["provenance-first finds", "gated judgments", "curated index"],
  },
  {
    id: "experiment-crew",
    name: "Experiment Crew",
    glyph: "🧪",
    tagline: "Hermes-style closed learning loop — scout, build, judge the build",
    description:
      "Scout → Implementer → Judge: new inputs feed a build, and every build lands in front of a calibrated verdict before it counts. The loop closes when the judge's reasons feed the next scout.",
    roleIds: ["scout", "implementer", "judge"],
    chips: ["gate on builds", "gate on judgments", "learning loop"],
  },
  {
    id: "ops-crew",
    name: "Ops Crew",
    glyph: "🛰️",
    tagline: "Autopilot doctrine — an operator drives, a judge audits the state",
    description:
      "The minimum viable autonomy pair: the Operator keeps schedules, lanes and monitors honest, and the Judge audits ops verdicts so a stuck system says so out loud.",
    roleIds: ["operator", "judge"],
    chips: ["honest status notes", "audited ops calls", "smallest crew"],
  },
  {
    id: "full-crew",
    name: "Full Crew",
    glyph: "🧩",
    tagline: "The whole harness — all six roles, end to end",
    description:
      "Scout → Judge → Curator → Implementer → Operator → Reviewer: the complete assigned-and-aligned lineup, every expensive artifact under a gate.",
    roleIds: ["scout", "judge", "curator", "implementer", "operator", "reviewer"],
    chips: ["all six roles", "gates on build/judge/review", "full pipeline coverage"],
  },
];

/**
 * Which roles of a preset have NO agent mapped to them right now (by the
 * deterministic keyword map). Unknown preset ids yield [] — defensive against
 * old persisted panels.
 */
export function presetMissingRoles(presetId: string, agents: Agent[]): CrewRoleId[] {
  const preset = CREW_PRESETS.find((p) => p.id === presetId);
  if (!preset) return [];
  const covered = new Set(agents.map((a) => crewRoleIdForAgent(a)));
  return preset.roleIds.filter((id) => !covered.has(id));
}

// ─── Praison dossier (interoperability export) ───────────────────────────────

/**
 * A copy-paste worker dossier ("obtain or create our harness system": users
 * can lift a NEXUS worker into ANY framework — PraisonAI agents.py, CrewAI,
 * a plain system prompt — because the alignment data is plain text).
 */
export function praisonDossier(agent: Agent): string {
  const roleId = crewRoleIdForAgent(agent);
  const def = CREW_ROLE_DEFS[roleId];
  const goal = agent.goal?.trim() || def.goal;
  const backstory = agent.backstory?.trim() || def.backstory;
  const instructions = agent.instructions?.trim() || "(no instructions set)";
  return [
    `# ${agent.emoji} ${agent.name}`,
    ``,
    `- **Role:** ${agent.role || def.name}`,
    `- **Crew role:** ${def.glyph} ${def.name} (\`${roleId}\`)`,
    `- **Goal:** ${goal}`,
    `- **Backstory:** ${backstory}`,
    ``,
    `## Instructions`,
    ``,
    instructions,
    ``,
    `## Expected output`,
    ``,
    def.expectedOutput,
    ``,
    `- **Model:** ${agent.model || "auto"}`,
    `- **Tools:** ${agent.tools.length > 0 ? agent.tools.join(", ") : "(none)"}`,
    `- **Temperature:** ${agent.temperature} · **Max tool iterations:** ${agent.maxIterations}`,
  ].join("\n");
}
