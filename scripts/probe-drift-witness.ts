// r577 probe: positive-witness the registry drift flag in-process. A fresh
// bun process rescans plugins/ live — the dev server (warm loader cache) is
// never touched, no restart spent. Creates a temporary pack with one inert
// pin (current_time has no schema args) and one known-key pin, asserts the
// registry readout flags exactly the right one, then removes the pack.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";

const dir = "plugins/probe-drift-pack";
mkdirSync(dir, { recursive: true });
writeFileSync(
  `${dir}/manifest.json`,
  JSON.stringify(
    {
      id: "probe-drift-pack",
      name: "Probe Drift Pack",
      version: "0.0.1",
      description: "temporary in-process drift-flag probe (auto-removed)",
      tools: [
        {
          name: "probe_now",
          base: "current_time",
          description: "probe alias with an inert pin (timezone is not in the base schema)",
          preset: { timezone: "UTC" },
        },
        {
          name: "probe_stamp",
          base: "uuid_hash",
          description: "probe with a known-key pin (op IS in the base schema)",
          preset: { op: "sha256" },
        },
      ],
    },
    null,
    2,
  ),
);

try {
  const { GET } = await import("../src/app/api/tools/registry/route");
  const res = await GET();
  const j = await res.json();
  const pack = j.packs.find((p: { id: string }) => p.id === "probe-drift-pack");
  if (!pack) {
    console.log("PROBE MISSING — FAIL");
    process.exit(1);
  }
  const now = pack.tools.find((t: { name: string }) => t.name === "probe_now");
  const stamp = pack.tools.find((t: { name: string }) => t.name === "probe_stamp");
  const pass =
    JSON.stringify(now.unknownPresetKeys) === '["timezone"]' &&
    JSON.stringify(stamp.unknownPresetKeys) === "[]" &&
    JSON.stringify(stamp.preset) === '{"op":"sha256"}' &&
    now.args.length === 0 &&
    stamp.args.includes("op");
  console.log(
    "PROBE pack_now drift:",
    JSON.stringify(now.unknownPresetKeys),
    "| pack_stamp drift:",
    JSON.stringify(stamp.unknownPresetKeys),
    "| stamp preset:",
    JSON.stringify(stamp.preset),
    "| stamp args include op:",
    stamp.args.includes("op"),
  );
  console.log(pass ? "DRIFT-FLAG POSITIVE WITNESS: PASS" : "DRIFT-FLAG WITNESS: FAIL");
  process.exit(pass ? 0 : 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
  console.log("probe pack removed:", !existsSync(dir));
}
