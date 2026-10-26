// ─── Plugin manifest contract (isomorphic, dial-free) ────────────────────────
// TASK-103 slice 1 — the Plugin-manifest doctrine: one JSON manifest registers
// a tool pack WITHOUT code edits. A pack may only DECLARE preset tools bound
// to builtin executors (base ∈ BUILTIN_TOOL_IDS) with fixed argument presets;
// it never ships executable code, never dials the network, never touches the
// vault. The server loader (src/lib/server/plugin-loader.ts) scans the watched
// folder and validates every manifest through THIS module so client and server
// agree on the contract.

import { BUILTIN_TOOL_IDS } from "./types";

export interface PluginToolDecl {
  /** LLM-safe snake identifier — must NOT collide with a builtin ToolId. */
  name: string;
  /** The builtin executor this preset tool dispatches through. */
  base: string;
  /** LLM-facing (slice 2: becomes the function def text) + registry blurb. */
  description: string;
  /** Fixed args merged UNDER the caller's args (caller wins). */
  preset?: Record<string, unknown>;
}

export interface PluginManifest {
  /** Slug used in provenance tags: `[plugin:<id> · preset of <base>]`. */
  id: string;
  name: string;
  version: string;
  description: string;
  tools: PluginToolDecl[];
  /** Slice-2 declarations (r614): which executor lanes / crews the pack's
   * tools SERVE. Shape-validated free strings today — the vocabulary freeze
   * lands with the picker's ToolId surgery, when these gain a consumer. */
  lanes?: string[];
  crews?: string[];
}

export interface ManifestValidation {
  ok: boolean;
  errors: string[];
  manifest?: PluginManifest;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{2,31}$/;
const PRESET_JSON_BUDGET = 2048;
const MAX_TOOLS_PER_PACK = 16;
const DECL_RE = /^[a-z][a-z0-9_-]{1,23}$/;
const MAX_DECLS_PER_FIELD = 8;

/** Slice-2 declaration arrays (lanes/crews): optional, non-empty, bounded,
 * lowercase-id shaped. Shape-only by design — the picker consumes these in
 * the ToolId surgery and freezes the vocabulary then. */
function validateDeclArray(value: unknown, field: string, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${field} must be a non-empty array of short lowercase ids (or omit it)`);
    return undefined;
  }
  if (value.length > MAX_DECLS_PER_FIELD) {
    errors.push(`${field} exceeds ${MAX_DECLS_PER_FIELD} entries`);
    return undefined;
  }
  const out: string[] = [];
  let ok = true;
  value.forEach((v, i) => {
    if (typeof v !== "string" || !DECL_RE.test(v)) {
      errors.push(`${field}[${i}] must match ${DECL_RE.source} (got ${JSON.stringify(v)})`);
      ok = false;
      return;
    }
    if (!out.includes(v)) out.push(v);
  });
  return ok && out.length > 0 ? out : undefined;
}

export function validatePluginManifest(raw: unknown): ManifestValidation {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["manifest must be a JSON object"] };
  }
  const m = raw as Record<string, unknown>;

  const known = ["id", "name", "version", "description", "tools", "lanes", "crews"];
  for (const key of Object.keys(m)) {
    if (!known.includes(key)) errors.push(`unknown top-level field: "${key}" (strict schema)`);
  }

  let id = "";
  if (typeof m.id !== "string" || !ID_RE.test(m.id)) {
    errors.push(`id must match ${ID_RE.source} (got ${JSON.stringify(m.id)})`);
  } else {
    id = m.id;
  }

  if (typeof m.name !== "string" || m.name.trim().length < 2 || m.name.length > 60) {
    errors.push("name must be a 2-60 char string");
  }
  if (typeof m.version !== "string" || m.version.length > 20 || m.version.length === 0) {
    errors.push("version must be a non-empty string of at most 20 chars");
  }
  if (typeof m.description !== "string" || m.description.trim().length < 4 || m.description.length > 400) {
    errors.push("description must be a 4-400 char string");
  }

  const tools: PluginToolDecl[] = [];
  if (!Array.isArray(m.tools) || m.tools.length === 0) {
    errors.push("tools must be a non-empty array");
  } else {
    if (m.tools.length > MAX_TOOLS_PER_PACK) {
      errors.push(`tools array exceeds ${MAX_TOOLS_PER_PACK} entries`);
    }
    const seen = new Set<string>();
    m.tools.forEach((t, i) => {
      const at = `tools[${i}]`;
      if (typeof t !== "object" || t === null || Array.isArray(t)) {
        errors.push(`${at} must be an object`);
        return;
      }
      const d = t as Record<string, unknown>;
      const dKnown = ["name", "base", "description", "preset"];
      for (const key of Object.keys(d)) {
        if (!dKnown.includes(key)) errors.push(`${at}: unknown field "${key}" (strict schema)`);
      }
      if (typeof d.name !== "string" || !TOOL_NAME_RE.test(d.name)) {
        errors.push(`${at}.name must match ${TOOL_NAME_RE.source} (got ${JSON.stringify(d.name)})`);
      } else if (seen.has(d.name)) {
        errors.push(`${at}.name duplicates "${d.name}" within the pack`);
      } else {
        seen.add(d.name);
        if ((BUILTIN_TOOL_IDS as readonly string[]).includes(d.name)) {
          errors.push(`${at}.name "${d.name}" collides with a builtin ToolId`);
        }
      }
      if (typeof d.base !== "string" || !(BUILTIN_TOOL_IDS as readonly string[]).includes(d.base)) {
        errors.push(`${at}.base must be one of the builtin ToolIds (got ${JSON.stringify(d.base)})`);
      }
      if (typeof d.description !== "string" || d.description.trim().length < 4 || d.description.length > 300) {
        errors.push(`${at}.description must be a 4-300 char string`);
      }
      if (d.preset !== undefined) {
        if (typeof d.preset !== "object" || d.preset === null || Array.isArray(d.preset)) {
          errors.push(`${at}.preset must be a plain object`);
        } else if (JSON.stringify(d.preset).length > PRESET_JSON_BUDGET) {
          errors.push(`${at}.preset exceeds the ${PRESET_JSON_BUDGET}-byte JSON budget`);
        }
      }
      if (
        typeof d.name === "string" &&
        typeof d.base === "string" &&
        (BUILTIN_TOOL_IDS as readonly string[]).includes(d.base) &&
        typeof d.description === "string" &&
        d.description.trim().length >= 4 &&
        d.description.length <= 300
      ) {
        tools.push({
          name: d.name,
          base: d.base,
          description: d.description,
          preset: (typeof d.preset === "object" && d.preset !== null && !Array.isArray(d.preset)
            ? (d.preset as Record<string, unknown>)
            : undefined),
        });
      }
    });
  }

  const lanes = validateDeclArray(m.lanes, "lanes", errors);
  const crews = validateDeclArray(m.crews, "crews", errors);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    manifest: {
      id,
      name: m.name as string,
      version: m.version as string,
      description: m.description as string,
      tools,
      ...(lanes ? { lanes } : {}),
      ...(crews ? { crews } : {}),
    },
  };
}
