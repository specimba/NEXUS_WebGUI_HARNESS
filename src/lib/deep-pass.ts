/**
 * r654 — deep-pass semantics, extracted as a pure module.
 *
 * WHY a separate file: workflow-runner.ts pulls zustand stores, so QA scripts
 * cannot import it (the qa-park-policy/qa-depth-degrade pattern: pure module,
 * source-level pins for the runner wiring). The deep-research instruction and
 * pass labels moved here VERBATIM from workflow-runner.ts (which re-imports
 * them — single source of truth, no copy left behind) together with the new
 * non-fatality predicates.
 *
 * The Owner's forensic evidence: the 6-hourly "Recursive self-improvement
 * engine" pipeline (13 materialized steps, depth deep) finished only 7 of 12
 * runs — EVERY non-done run died at a synthetic "Deep research pass 2/3"
 * (congestion-class errors on those 455s–734s dials), and failRun's
 * stopRemaining marked all 11 authored steps "skipped". One optional
 * enhancement pass was killing the whole self-maintaining cycle before it
 * could reach its own final "schedule next cycle" step.
 */

/** Moved verbatim from workflow-runner.ts (r26). */
export const DEEP_RESEARCH_INSTRUCTION =
  "This is a DEEP-RESEARCH pass. Search for information that previous passes did not cover: " +
  "different sources, missing numbers, contradicting viewpoints, primary sources. Verify the " +
  "key claims you see in the conversation context and correct them.";

/** Moved verbatim from workflow-runner.ts (r26). */
export const DEEP_PASSES: { n: 2 | 3; label: string }[] = [
  { n: 2, label: "Deep research pass 2 — verify & broaden" },
  { n: 3, label: "Deep research pass 3 — cross-check sources" },
];

/**
 * True ONLY for materialized synthetic deep passes. The `deep_` uid prefix is
 * exclusive to materializeRunSteps (authored steps are uid("step"), the
 * verification pass is uid("verify")) and the instruction must be the exact
 * DEEP_RESEARCH_INSTRUCTION constant — both halves are load-bearing, so an
 * authored step whose instruction text coincides can never match.
 */
export function isSyntheticDeepStep(stepId: string, instruction: string | undefined): boolean {
  try {
    return (
      typeof stepId === "string" &&
      stepId.startsWith("deep_") &&
      typeof instruction === "string" &&
      instruction === DEEP_RESEARCH_INSTRUCTION
    );
  } catch {
    return false;
  }
}

/**
 * The transient family — the SAME envelope resolvePark parks and
 * SELF_HEAL_KINDS heals (rate-limit / network / timeout). Deliberately mirrors
 * park-policy's congestion classes; QA pins the parity. Auth/model/billing/
 * region/unknown stay FATAL for deep passes: a dead key or a decommissioned
 * model id is real breakage and deserves a human (r183 doctrine — congestion
 * is weather, breakage is a defect).
 */
export function isTransientErrorKind(kind: string): boolean {
  return kind === "rate-limit" || kind === "network" || kind === "timeout";
}

/**
 * Countable note vocabulary — starts with "Deep pass — skipped" so
 * /Deep pass — skipped/ is the census regex, same convention as the other
 * note families ("Precedent lane —", "System-One gate …", "Looped pass i/r").
 */
export function deepPassSkipNote(kind: string, message: string): string {
  try {
    const m =
      typeof message === "string"
        ? message.replace(/\s+/g, " ").trim().slice(0, 160)
        : "";
    return `Deep pass — skipped after transient ${kind}${m ? `: ${m}` : ""} — run continues without it`;
  } catch {
    return "Deep pass — skipped after a transient error — run continues without it";
  }
}
