import { NextResponse } from "next/server";
import { BUILTIN_TOOL_IDS } from "@/lib/types";
import { buildToolDefs } from "@/lib/tools-defs";
import { loadPluginPacks } from "@/lib/server/plugin-loader";

// r575 — TASK-103 slice 1: the tools-registry readout. Builtins stay the
// closed typed set; plugin packs appear here on the next registry hit after
// a drop/edit (r614: the loader's mtime sweep invalidates its cache — no
// reload wait). Invalid packs are listed WITH
// their validation errors (honest registry — a broken pack is visible, not
// silently dropped and never boot-crashing).
//
// r576 — per-base schema arg names: the r575-correction advisory made
// visible. A pack preset must use the executor's argument vocabulary (the
// sample pack once pinned "algo" where the executor reads args.op); the
// readout now surfaces each base's schema-declared arg names so that drift
// is diagnosable from the UI, without reading engine code.
//
// r577 — the advisory became a flag: preset keys outside the base's schema
// vocabulary are surfaced as unknownPresetKeys (the exact drift class from
// the r575 correction, caught at registry time instead of execution time).

// Schema arg vocabulary per builtin — the isomorphic tool defs are the same
// source of truth the browser-direct engine shares with this executor, so
// these names ARE the executor contract (advisory, not enforcement).
const schemaArgs: Record<string, string[]> = {};
for (const def of buildToolDefs([...BUILTIN_TOOL_IDS])) {
  const props = (def.function.parameters as { properties?: Record<string, unknown> })
    .properties;
  schemaArgs[def.function.name] = Object.keys(props ?? {});
}

export async function GET() {
  const { packs, invalid } = loadPluginPacks();
  return NextResponse.json({
    ok: true,
    builtins: BUILTIN_TOOL_IDS,
    packs: packs.map((p) => ({
      id: p.manifest.id,
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      dir: p.dir,
      lanes: p.manifest.lanes ?? [],
      crews: p.manifest.crews ?? [],
      tools: p.manifest.tools.map((t) => ({
        name: t.name,
        base: t.base,
        description: t.description,
        preset: t.preset ?? null,
        args: schemaArgs[t.base] ?? [],
        unknownPresetKeys: t.preset
          ? Object.keys(t.preset).filter((k) => !(schemaArgs[t.base] ?? []).includes(k))
          : [],
      })),
    })),
    invalid,
  });
}
