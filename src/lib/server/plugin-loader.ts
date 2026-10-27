// ─── Plugin pack loader (server) ─────────────────────────────────────────────
// TASK-103 slice 1 — scans the watched folder `plugins/<dir>/manifest.json`,
// validates every manifest through the isomorphic contract, and exposes:
//   • loadPluginPacks()  → validated packs + invalid packs WITH their errors
//     (a broken pack NEVER crashes boot — it lands in `invalid` with the
//     honest reason, visible in the registry readout)
//   • getPluginPreset()  → executor dispatch lookup for preset tools
// r614: the per-process cache no longer hides dropped/edited manifests — a
// quick mtime sweep of the watched folder invalidates it, so a new pack
// appears on the NEXT registry/dispatch call instead of after a full reload.

import fs from "node:fs";
import path from "node:path";
import {
  validatePluginManifest,
  type PluginManifest,
} from "../plugin-manifest";
import { BUILTIN_TOOL_IDS, type ToolId } from "../types";
import { buildPackToolDefs, buildToolDefs, type ToolDef } from "../tools-defs";

export interface LoadedPack {
  dir: string;
  manifest: PluginManifest;
}

export interface InvalidPack {
  dir: string;
  errors: string[];
}

export interface PluginPackScan {
  packs: LoadedPack[];
  invalid: InvalidPack[];
}

export interface PluginPresetRef {
  packId: string;
  packName: string;
  tool: PluginManifest["tools"][number];
}

let cache: PluginPackScan | null = null;
let cacheBuiltAtMs = 0;

/** r614: one readdir + N stats — cheap enough to run on every cache hit.
 * Any manifest.json newer than the cache (or a pack dir that lost its
 * manifest = a removal) forces a rescan. Unreadable folder keeps the last
 * good scan (honest degradation, never a crash). */
function watchedFolderChanged(): boolean {
  if (!cache) return true;
  try {
    const entries = fs.readdirSync(pluginsRoot(), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        const st = fs.statSync(path.join(pluginsRoot(), e.name, "manifest.json"));
        if (st.mtimeMs > cacheBuiltAtMs) return true;
      } catch {
        return true; // manifest vanished — pack removed, rescan
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function pluginsRoot(): string {
  return path.join(process.cwd(), "plugins");
}

export function loadPluginPacks(force = false): PluginPackScan {
  if (cache && !force && !watchedFolderChanged()) return cache;
  const root = pluginsRoot();
  const scan: PluginPackScan = { packs: [], invalid: [] };
  let dirs: string[] = [];
  try {
    dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    // No watched folder yet — honest empty registry, not an error.
    cache = scan;
    cacheBuiltAtMs = Date.now();
    return scan;
  }
  for (const dir of dirs) {
    const file = path.join(root, dir, "manifest.json");
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      scan.invalid.push({
        dir,
        errors: [
          `manifest.json unreadable: ${err instanceof Error ? err.message : String(err)}`,
        ],
      });
      continue;
    }
    const v = validatePluginManifest(raw);
    if (v.ok && v.manifest) {
      scan.packs.push({ dir, manifest: v.manifest });
    } else {
      scan.invalid.push({ dir, errors: v.errors });
    }
  }
  cache = scan;
  cacheBuiltAtMs = Date.now();
  return scan;
}

/** Executor dispatch: plugin tool name → its pack + declaration, or null. */
export function getPluginPreset(name: string): PluginPresetRef | null {
  const { packs } = loadPluginPacks();
  for (const p of packs) {
    const tool = p.manifest.tools.find((t) => t.name === name);
    if (tool) {
      return { packId: p.manifest.id, packName: p.manifest.name, tool };
    }
  }
  return null;
}

// ─── Registry-fed pack defs (r616, TASK-103 slice 2 frontier) ────────────────
/** LLM defs for the pack tools named in `toolIds`, sourced from the
 * mtime-swept registry scan. Non-pack ids are ignored; a pack tool's def
 * reuses its BASE builtin's parameter schema — the dispatcher (executeTool →
 * getPluginPreset) merges the manifest preset UNDER the caller's args and
 * prefixes the provenance. First pack in scan order wins a cross-pack name
 * clash, mirroring getPluginPreset. The browser-direct engine stays
 * builtin-only until the picker slice wires the same source client-side. */
export function buildRegistryPackDefs(toolIds: readonly string[]): ToolDef[] {
  const packIds = toolIds.filter((t) => !(BUILTIN_TOOL_IDS as readonly string[]).includes(t));
  if (packIds.length === 0) return [];
  const wanted = new Set(packIds);
  const scan = loadPluginPacks();
  const decls = scan.packs
    .flatMap((p) => p.manifest.tools)
    .filter((d) => wanted.has(d.name));
  if (decls.length === 0) return [];
  const bases = [...new Set(decls.map((d) => d.base))] as ToolId[];
  return buildPackToolDefs(decls, buildToolDefs(bases));
}
