// ─── Plugin pack loader (server) ─────────────────────────────────────────────
// TASK-103 slice 1 — scans the watched folder `plugins/<dir>/manifest.json`,
// validates every manifest through the isomorphic contract, and exposes:
//   • loadPluginPacks()  → validated packs + invalid packs WITH their errors
//     (a broken pack NEVER crashes boot — it lands in `invalid` with the
//     honest reason, visible in the registry readout)
//   • getPluginPreset()  → executor dispatch lookup for preset tools
// Per-process cache: a pack dropped into the folder appears after the next
// server reload — exactly the doctrine's "appears in the tools registry after
// reload" (dev recompiles and production restarts both refresh the process).

import fs from "node:fs";
import path from "node:path";
import {
  validatePluginManifest,
  type PluginManifest,
} from "../plugin-manifest";

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

export function pluginsRoot(): string {
  return path.join(process.cwd(), "plugins");
}

export function loadPluginPacks(force = false): PluginPackScan {
  if (cache && !force) return cache;
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
