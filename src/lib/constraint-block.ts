/**
 * nexent constraint-block (r581) — hard constraints attached to a spawn
 * proposal so the Evolution editor VALIDATES before spawning (TASKS.md P3
 * "nexent constraint-bound agent auto-generation → spawn-proposal fuel";
 * acceptance: spawn proposals carry a constraint block the editor validates).
 *
 * Doctrine mirrors:
 *  - never-throw envelopes (harness-adapter R1): buildConstraintBlock never
 *    raises — junk in, warnings + a sane block out.
 *  - the editor's own 8-step cap (r569/r571): CONSTRAINT_LIMITS.stepCap.max
 *    is 8, so a constraint block can never promise more than the editor
 *    actually honors.
 *  - strict structural validation (plugin-manifest validator): unknown keys
 *    are violations, not silently ignored.
 *
 * Pure + isomorphic: no node/bun API, no store imports, no dials.
 */

export interface ConstraintBlock {
  /** Schema version — validation is strict to v1 (forward blocks rejected). */
  version: 1;
  /** Max steps the spawned pipeline may run (the editor's paste/spawn cap). */
  stepCap: number;
  /** Max distinct executor tools the spawned pipeline may bind. */
  toolBudget: number;
  /** Per-lane dial caps — a lane absent from the map is unconstrained here. */
  laneCaps: Record<string, number>;
  /** How the spawned pipeline may dial: "gated" (relay-gated, default),
   * "dial-free" (no LLM dials at all), "open" (owner-acknowledged loosening). */
  dialPolicy: "dial-free" | "gated" | "open";
}

/** The lanes a constraint block may cap — the house lane vocabulary. */
export const CONSTRAINT_LANE_KEYS = [
  "chat",
  "research",
  "utility",
  "review",
  "acquisition",
] as const;

export const CONSTRAINT_LIMITS = {
  stepCap: { min: 2, max: 8 },
  toolBudget: { min: 1, max: 12 },
  laneCap: { min: 0, max: 200 },
} as const;

export interface ConstraintValidation {
  ok: boolean;
  violations: string[];
  /** Present only when ok — the validated block, verbatim. */
  block?: ConstraintBlock;
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/**
 * Strict structural validation. Accepts ONLY a well-formed v1 block:
 * exact key set, integer bounds, lane-key whitelist, dialPolicy enum.
 * Never throws — any junk input comes back as ok:false with violations.
 */
export function validateConstraintBlock(raw: unknown): ConstraintValidation {
  const violations: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, violations: ["constraint block must be a JSON object"] };
  }
  const b = raw as Record<string, unknown>;
  if (b.version !== 1) violations.push(`version must be 1 (got ${JSON.stringify(b.version) ?? "undefined"})`);
  if (!isInt(b.stepCap) || b.stepCap < CONSTRAINT_LIMITS.stepCap.min || b.stepCap > CONSTRAINT_LIMITS.stepCap.max) {
    violations.push(`stepCap must be an integer ${CONSTRAINT_LIMITS.stepCap.min}–${CONSTRAINT_LIMITS.stepCap.max}`);
  }
  if (!isInt(b.toolBudget) || b.toolBudget < CONSTRAINT_LIMITS.toolBudget.min || b.toolBudget > CONSTRAINT_LIMITS.toolBudget.max) {
    violations.push(`toolBudget must be an integer ${CONSTRAINT_LIMITS.toolBudget.min}–${CONSTRAINT_LIMITS.toolBudget.max}`);
  }
  if (typeof b.laneCaps !== "object" || b.laneCaps === null || Array.isArray(b.laneCaps)) {
    violations.push("laneCaps must be an object");
  } else {
    const caps = b.laneCaps as Record<string, unknown>;
    for (const [lane, cap] of Object.entries(caps)) {
      if (!(CONSTRAINT_LANE_KEYS as readonly string[]).includes(lane)) {
        violations.push(`laneCaps key "${lane}" is not a known lane (${CONSTRAINT_LANE_KEYS.join("/")})`);
      } else if (!isInt(cap) || cap < CONSTRAINT_LIMITS.laneCap.min || cap > CONSTRAINT_LIMITS.laneCap.max) {
        violations.push(`laneCaps.${lane} must be an integer ${CONSTRAINT_LIMITS.laneCap.min}–${CONSTRAINT_LIMITS.laneCap.max}`);
      }
    }
  }
  if (b.dialPolicy !== "dial-free" && b.dialPolicy !== "gated" && b.dialPolicy !== "open") {
    violations.push('dialPolicy must be "dial-free" | "gated" | "open"');
  }
  const known = new Set(["version", "stepCap", "toolBudget", "laneCaps", "dialPolicy"]);
  for (const key of Object.keys(b)) {
    if (!known.has(key)) violations.push(`unknown field "${key}"`);
  }
  if (violations.length > 0) return { ok: false, violations };
  return {
    ok: true,
    violations: [],
    block: {
      version: 1,
      stepCap: b.stepCap as number,
      toolBudget: b.toolBudget as number,
      laneCaps: b.laneCaps as Record<string, number>,
      dialPolicy: b.dialPolicy as ConstraintBlock["dialPolicy"],
    },
  };
}

/**
 * Never-throw builder: junk in → a SANE block out (clamped into bounds,
 * unknown lane keys dropped) plus honest warnings describing every fix.
 * The engine attaches the built block, the editor re-validates it — and
 * since the builder clamps, a built block always validates clean.
 */
export function buildConstraintBlock(raw: unknown): { block: ConstraintBlock; warnings: string[] } {
  const warnings: string[] = [];
  const b = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const clamp = (v: unknown, min: number, max: number, label: string): number => {
    if (!isInt(v)) {
      warnings.push(`${label} not an integer — defaulted`);
      return min;
    }
    if (v < min) {
      warnings.push(`${label} ${v} below min — clamped to ${min}`);
      return min;
    }
    if (v > max) {
      warnings.push(`${label} ${v} above max — clamped to ${max}`);
      return max;
    }
    return v;
  };
  const laneCaps: Record<string, number> = {};
  if (typeof b.laneCaps === "object" && b.laneCaps !== null && !Array.isArray(b.laneCaps)) {
    for (const [lane, cap] of Object.entries(b.laneCaps as Record<string, unknown>)) {
      if (!(CONSTRAINT_LANE_KEYS as readonly string[]).includes(lane)) {
        warnings.push(`laneCaps key "${lane}" dropped — not a known lane`);
        continue;
      }
      laneCaps[lane] = clamp(cap, CONSTRAINT_LIMITS.laneCap.min, CONSTRAINT_LIMITS.laneCap.max, `laneCaps.${lane}`);
    }
  } else if (b.laneCaps != null) {
    warnings.push("laneCaps not an object — dropped");
  }
  const dialPolicy =
    b.dialPolicy === "dial-free" || b.dialPolicy === "gated" || b.dialPolicy === "open"
      ? b.dialPolicy
      : (warnings.push('dialPolicy invalid — defaulted to "gated"'), "gated" as const);
  return {
    block: {
      version: 1,
      stepCap: clamp(b.stepCap, CONSTRAINT_LIMITS.stepCap.min, CONSTRAINT_LIMITS.stepCap.max, "stepCap"),
      toolBudget: clamp(b.toolBudget, CONSTRAINT_LIMITS.toolBudget.min, CONSTRAINT_LIMITS.toolBudget.max, "toolBudget"),
      laneCaps,
      dialPolicy,
    },
    warnings,
  };
}

/**
 * Constraint block derived from a source workflow's own shape (nexent style:
 * the child is bounded by what the parent actually is). stepCap = parent
 * steps + 2 (room for the review gate), clamped to the editor's 8; toolBudget
 * ≈ one tool per parent step, clamped to 12; dialPolicy "gated" — NEXUS dials
 * go through the relay gate, and a proposal never loosens that.
 */
export function buildDefaultConstraints(sourceStepCount: number): ConstraintBlock {
  const steps = Number.isFinite(sourceStepCount) ? Math.max(0, Math.floor(sourceStepCount)) : 0;
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  return {
    version: 1,
    stepCap: clamp(steps + 2, CONSTRAINT_LIMITS.stepCap.min, CONSTRAINT_LIMITS.stepCap.max),
    toolBudget: clamp(Math.max(2, steps), CONSTRAINT_LIMITS.toolBudget.min, CONSTRAINT_LIMITS.toolBudget.max),
    laneCaps: {},
    dialPolicy: "gated",
  };
}

/** One-line human summary for chips and plan lines. */
export function formatConstraintBlock(b: ConstraintBlock): string {
  const lanes = Object.entries(b.laneCaps)
    .map(([lane, cap]) => `${lane}≤${cap}`)
    .join(" ");
  return `≤${b.stepCap} steps · ≤${b.toolBudget} tools · dial ${b.dialPolicy}${lanes ? ` · ${lanes}` : ""}`;
}
