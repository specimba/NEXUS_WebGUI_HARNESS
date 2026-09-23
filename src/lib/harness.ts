// ─── Harness selection (r34) ─────────────────────────────────────────────────
// The user's r34 directive: "why our system is lack of harness selection
// capabilities beside our system" — inspired by the PraisonAI lineage ("Hire a
// 24/7 AI Workforce … built-in memory, RAG, and support for 100+ LLMs") and the
// advisory-backed AIHubMix LLM Router policies (cost / balanced / quality /
// latency). A harness preset is ONE selector that retunes the whole agentic
// stack — relay ordering, tool budget, stall resilience, lessons & dreams —
// identically for chat turns and workflow pipelines.
//
// Doctrine (r31 sweep): borrow vocabulary and concepts, never import a
// framework. These presets are plain data consumed by existing code paths.

import type { RelayTaskFit } from "./relay";

export type HarnessId = "balanced" | "free-frontier" | "deep-research" | "fast" | "worker";

/** The knobs a harness preset turns. Every one maps to real behavior. */
export interface HarnessKnobs {
  /** Relay chain ordering bias (Genius-rotator doctrine). */
  taskFit: RelayTaskFit;
  /** true ⇒ the vault's free lanes (:free / -free / router-free) lead the
   *  chain, paid frontier becomes the backup instead of the default. */
  freeFirst: boolean;
  /** Mid-run stall resumes allowed per turn (r32 stall-resume hardening).
   *  0 disables resumes (fail fast); 3 is the maximum honest retry budget. */
  stallResumes: number;
  /** Added to each agent's own maxIterations (tool-round budget). */
  maxIterationsBonus: number;
  /** Inject the workflow's Reflexion lessons into run context (rank-③). */
  lessonsInject: boolean;
  /** Participate in dreaming-lite consolidation after runs settle (r33). */
  dreamEligible: boolean;
}

export interface HarnessPreset {
  id: HarnessId;
  name: string;
  glyph: string;
  tagline: string;
  /** One-sentence "what changes under the hood" for the settings card. */
  description: string;
  /** Concrete capability chips rendered under the description. */
  chips: string[];
  knobs: HarnessKnobs;
}

export const HARNESS_PRESETS: HarnessPreset[] = [
  {
    id: "balanced",
    name: "Balanced",
    glyph: "⚖️",
    tagline: "The default harness — adaptive and calm",
    description:
      "Lets each step pick its own relay bias (research steps go fast-first, review steps go flagship-first) with the standard stall-resume budget and full lessons + dreams.",
    chips: ["step-aware routing", "stall resume ×2", "lessons + dreams"],
    knobs: {
      taskFit: "any",
      freeFirst: false,
      stallResumes: 2,
      maxIterationsBonus: 0,
      lessonsInject: true,
      dreamEligible: true,
    },
  },
  {
    id: "free-frontier",
    name: "Free Frontier",
    glyph: "🆓",
    tagline: "Atria doctrine — free lanes lead, paid backs them up",
    description:
      "Rebuilds the relay chain so the vault's free frontier lanes (kilo-auto/free, Mimo, Nemotron, GLM free…) answer first; paid flagships are demoted to backup hops. Built for the tons of good free models that now exist.",
    chips: ["free lanes first", "stall resume ×2", "lessons + dreams"],
    knobs: {
      taskFit: "any",
      freeFirst: true,
      stallResumes: 2,
      maxIterationsBonus: 0,
      lessonsInject: true,
      dreamEligible: true,
    },
  },
  {
    id: "deep-research",
    name: "Deep Research",
    glyph: "🔬",
    tagline: "Long-horizon research with a bigger survival budget",
    description:
      "Extra tool rounds and the maximum stall-resume budget for the exact failure mode that killed 15-tool research turns; fast models lead the relay for search-heavy steps.",
    chips: ["+2 tool rounds", "stall resume ×3", "fast-first relay", "lessons + dreams"],
    knobs: {
      taskFit: "research",
      freeFirst: false,
      stallResumes: 3,
      maxIterationsBonus: 2,
      lessonsInject: true,
      dreamEligible: true,
    },
  },
  {
    id: "fast",
    name: "Fast",
    glyph: "⚡",
    tagline: "Latency-critical turns — minimal overhead",
    description:
      "No lessons injection, no dream consolidation, a single stall resume. Mirrors the LLM Router's latency_critical policy: prefer the quickest capable lane and stay lean.",
    chips: ["lean context", "stall resume ×1", "no dream overhead"],
    knobs: {
      taskFit: "any",
      freeFirst: false,
      stallResumes: 1,
      maxIterationsBonus: 0,
      lessonsInject: false,
      dreamEligible: false,
    },
  },
  {
    id: "worker",
    name: "Autonomy Worker",
    glyph: "🛠️",
    tagline: "Automation-ready — scheduled pipelines that survive",
    description:
      "Tuned for 24/7 scheduled runs: maximum stall resilience, extra tool rounds, lessons and dreams fully on. Flagship-first relay so one excellent pass finishes the job.",
    chips: ["+2 tool rounds", "stall resume ×3", "flagship-first", "lessons + dreams"],
    knobs: {
      taskFit: "quality",
      freeFirst: false,
      stallResumes: 3,
      maxIterationsBonus: 2,
      lessonsInject: true,
      dreamEligible: true,
    },
  },
];

export const DEFAULT_HARNESS_ID: HarnessId = "balanced";

export function isHarnessId(v: unknown): v is HarnessId {
  return typeof v === "string" && HARNESS_PRESETS.some((p) => p.id === v);
}

/** Resolve a preset defensively — anything unknown (old persisted state,
 *  typos, quarantined values) lands on the balanced default. */
export function harnessById(id?: string | null): HarnessPreset {
  return isHarnessId(id) ? HARNESS_PRESETS.find((p) => p.id === id)! : HARNESS_PRESETS[0];
}

/**
 * Compose a harness's relay bias with a step's own derived fit: a neutral
 * harness ("any") defers to the step; a specialized harness overrides.
 */
export function composeTaskFit(harness: HarnessPreset, stepFit: RelayTaskFit): RelayTaskFit {
  return harness.knobs.taskFit === "any" ? stepFit : harness.knobs.taskFit;
}
