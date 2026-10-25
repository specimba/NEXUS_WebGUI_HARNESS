// r550 — serverless QA for the acquisition registry class + probeSlotDial guard
// (TASK-102 tail). No network, no db writes: vault reads are stubbed via the
// guard's deps seam; env is pinned via deps.envKey. Mirrors the r548
// qa-realign-heal pattern (static imports — TS1375-safe under bun).

import {
  ACQUISITION_PROVIDERS,
  acquisitionById,
  acquisitionKeyFromSources,
  isAcquisitionProvider,
} from "../src/lib/acquisition-registry";
import {
  probeSlotDial,
  resolveAcquisitionSlot,
} from "../src/lib/server/acquisition-vault";
import { exaKeySourceFromSources } from "../src/lib/exa-dialect";

let pass = 0;
const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.error(`FAIL  ${name}`);
  }
}

async function main() {
  console.log("── registry class ──");
  check("exa is acquisition-class", isAcquisitionProvider("exa"));
  check("chat provider is NOT acquisition-class", !isAcquisitionProvider("openai"));
  check("builtin is NOT acquisition-class", !isAcquisitionProvider("builtin"));
  check("registry entry carries env fallback name", acquisitionById("exa")?.envFallback === "EXA_API_KEY");
  check("registry dial base is the Exa production endpoint", acquisitionById("exa")?.dialBase === "https://api.exa.ai");
  check("unknown id resolves to null info", acquisitionById("nope") === null);
  check(
    "registry carries the two dormant rows (brightdata + webshare)",
    ACQUISITION_PROVIDERS.length === 3 && isAcquisitionProvider("brightdata") && isAcquisitionProvider("webshare"),
  );
  check(
    "dormant rows declare honest envFallback names",
    acquisitionById("brightdata")?.status === "dormant" && acquisitionById("brightdata")?.envFallback === "BRIGHTDATA_TOKEN" &&
      acquisitionById("webshare")?.status === "dormant" && acquisitionById("webshare")?.envFallback === "WEBSHARE_TOKEN",
  );
  check("exa is the only live row", ACQUISITION_PROVIDERS.filter((p) => p.status === "live").length === 1);

  console.log("── acquisitionKeyFromSources (the ONE ordering) ──");
  const vault = [
    { provider: "exa", key: "  sk-old-vault  " }, // trimmed on win
    { provider: "exa", key: "" }, // blank slot: skipped, never wins
    { provider: "orca", key: "sk-not-mine" }, // other provider: ignored
  ];
  const k1 = acquisitionKeyFromSources(vault, "exa", "sk-env");
  check("vault slot wins + key trimmed", k1?.key === "sk-old-vault" && k1?.source === "vault");
  const k2 = acquisitionKeyFromSources([], "exa", "  sk-env  ");
  check("no slots → env fallback (trimmed)", k2?.key === "sk-env" && k2?.source === "env");
  const k3 = acquisitionKeyFromSources(
    [{ provider: "exa", key: "   " }], // blank-only vault
    "exa",
    undefined,
  );
  check("blank slot + no env → null (lane silent)", k3 === null);
  check("neither source → null", acquisitionKeyFromSources(null, "exa", undefined) === null);
  const k4 = acquisitionKeyFromSources(
    [{ provider: "orca", key: "sk-other" }],
    "exa",
    "sk-env",
  );
  check("foreign-provider slot does not shadow env", k4?.source === "env");

  console.log("── vocabulary agreement with the exa-named twin (13/13 QA intact) ──");
  const dec = [{ provider: "exa", key: "sk-vault" }];
  check("vault case agrees", exaKeySourceFromSources(dec, "sk-env") === (acquisitionKeyFromSources(dec, "exa", "sk-env")?.source ?? null));
  check("env case agrees", exaKeySourceFromSources(null, "sk-env") === (acquisitionKeyFromSources(null, "exa", "sk-env")?.source ?? null));
  check("unconfigured case agrees (null)", exaKeySourceFromSources(null, undefined) === (acquisitionKeyFromSources(null, "exa", undefined)?.source ?? null));

  console.log("── resolveAcquisitionSlot (guard core, stubbed vault) ──");
  const r1 = await resolveAcquisitionSlot("exa", {
    listSlots: async () => dec,
    envKey: "sk-env",
  });
  check("vault-first through the guard", r1?.source === "vault" && r1?.key === "sk-vault");
  const r2 = await resolveAcquisitionSlot("exa", { envKey: "sk-env" });
  check("vault-unavailable degrades to env-only (never throws)", r2?.source === "env");
  const r3 = await resolveAcquisitionSlot("exa", {
    listSlots: async () => {
      throw new Error("master key missing");
    },
    envKey: "sk-env",
  });
  check("THROWING vault read degrades to env-only", r3?.source === "env");
  const r4 = await resolveAcquisitionSlot("exa", { envKey: undefined });
  check("fully unconfigured → null", r4 === null);
  const r5 = await resolveAcquisitionSlot("openai", { envKey: "sk-env" });
  check("non-acquisition provider refused", r5 === null);
  const r6 = await resolveAcquisitionSlot("brightdata", { envKey: "bd-token" });
  check(
    "dormant provider still resolves through the guard (dial absence is a route concern)",
    r6?.source === "env" && r6?.key === "bd-token",
  );

  console.log("── probeSlotDial (the guarded dial) ──");
  let dialCalls = 0;
  const p1 = await probeSlotDial("exa", async () => {
    dialCalls++;
    return "dialed";
  }, { envKey: undefined });
  check("unconfigured: skipped, dial NEVER invoked", p1.skipped === true && dialCalls === 0);
  const p2 = await probeSlotDial("exa", async (key, source) => `${source}:${key}`, {
    listSlots: async () => dec,
    envKey: "sk-env",
  });
  check(
    "configured: dial once with (key, source), result passes through",
    !p2.skipped && p2.result === "vault:sk-vault",
  );

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error(failures.map((f) => `  - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("QA crashed:", e);
  process.exit(1);
});
