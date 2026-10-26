import { NextResponse } from "next/server";
import { BUILTIN_TOOL_IDS } from "@/lib/types";
import { loadPluginPacks } from "@/lib/server/plugin-loader";

// r575 — TASK-103 slice 1: the tools-registry readout. Builtins stay the
// closed typed set; plugin packs appear here after the server reload picks
// them up from plugins/<dir>/manifest.json. Invalid packs are listed WITH
// their validation errors (honest registry — a broken pack is visible, not
// silently dropped and never boot-crashing).

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
      tools: p.manifest.tools.map((t) => ({
        name: t.name,
        base: t.base,
        description: t.description,
        preset: t.preset ?? null,
      })),
    })),
    invalid,
  });
}
