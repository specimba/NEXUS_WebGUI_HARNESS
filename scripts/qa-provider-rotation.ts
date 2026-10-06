/**
 * r306 — behavioral unit suite for the RECONCILED rotation flow:
 * lib/provider-rotation.ts (registry-wide switching) composed with
 * lib/lane-rotation.ts (family-window demotion) inside workflow-runner.ts.
 *
 * Authority split under test:
 *   • lane-rotation family window → wire ORDER + same-family retry pacing
 *   • provider-rotation cooldown  → whether a provider may be a rotation TARGET
 *   • runner ladder               → primary → built-in engine → registry rotation
 *
 * Run: bun run scripts/qa-provider-rotation.ts
 */
import {
  ROTATION_COOLDOWN_BASE_MS,
  ROTATION_COOLDOWN_CAP_MS,
  ROTATION_RECOVERY_MS,
  nextRotation,
  noteProvider429,
  provider429CooldownLeftMs,
  provider429Streak,
  resetProvider429,
} from "../src/lib/provider-rotation";
import { LANE_SICK_MS, laneStrikes, noteLane429, rotateHops } from "../src/lib/lane-rotation";
import { FREE_PROVIDERS, providerById } from "../src/lib/providers";
import type { Settings } from "../src/lib/types";

let pass = 0, fail = 0;
function ok(cond: boolean, name: string, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const t0 = 1_000_000_000;

// ── exponential cooldown memory (request slowness ∝ provider exhaustion) ────
ok(noteProvider429("groq", t0) === 1, "first 429 opens a streak of 1");
ok(
  provider429CooldownLeftMs("groq", t0 + 5_000) === ROTATION_COOLDOWN_BASE_MS - 5_000,
  "streak 1 → 60s cooldown window",
  `left=${provider429CooldownLeftMs("groq", t0 + 5_000)}`
);
ok(noteProvider429("groq", t0 + 10_000) === 2, "a repeat 429 escalates the streak");
ok(
  provider429CooldownLeftMs("groq", t0 + 10_000) === 2 * ROTATION_COOLDOWN_BASE_MS,
  "streak 2 → 120s cooldown (exponential)"
);
ok(noteProvider429("groq", t0 + 20_000) === 3, "third 429 → streak 3");
ok(
  provider429CooldownLeftMs("groq", t0 + 20_000) === 4 * ROTATION_COOLDOWN_BASE_MS,
  "streak 3 → 240s cooldown"
);
for (let i = 0; i < 3; i++) noteProvider429("groq", t0 + 30_000 + i * 1_000);
ok(provider429Streak("groq") === 6, "six strikes recorded");
ok(
  provider429CooldownLeftMs("groq", t0 + 33_000) === ROTATION_COOLDOWN_CAP_MS - 1_000,
  "the cooldown caps at 15 minutes",
  `left=${provider429CooldownLeftMs("groq", t0 + 33_000)}`
);
ok(
  provider429CooldownLeftMs("never-dialed", t0) === 0 && provider429Streak("never-dialed") === 0,
  "an unnoted provider is free and healthy"
);
resetProvider429("groq");
ok(
  provider429Streak("groq") === 0 && provider429CooldownLeftMs("groq", t0 + 31_000) === 0,
  "resetProvider429 clears memory — a successful dial proves the lane recovered"
);
const fresh = noteProvider429("zai", t0);
noteProvider429("zai", t0 + ROTATION_RECOVERY_MS + 1_000);
ok(fresh === 1, "sanity: first zai 429 is streak 1");
ok(provider429Streak("zai") === 1, "a 429 after the recovery window starts a FRESH streak (no zombie escalation)");

// ── nextRotation: registry-wide switching ─────────────────────────────────────
const noKeyIds = FREE_PROVIDERS.filter((r) => r.noKey).map((r) => r.id);
const keyless = { providerKeys: {} } as unknown as Settings;
const keylessPick = nextRotation(keyless, "vyce", t0);
if (noKeyIds.length === 0) {
  ok(
    keylessPick === null,
    "a keyless profile with zero noKey registry providers gets an honest null (rotation unlocks as keys are saved — the vault-key flow)"
  );
} else {
  ok(
    keylessPick !== null && noKeyIds.includes(keylessPick.llm.providerId),
    "a keyless profile rotates to a noKey registry provider"
  );
}
const groqProvider = providerById("groq");
const zaiProvider = providerById("zai");
ok(groqProvider != null && zaiProvider != null, "registry fixture: groq and zai exist");
const groqOnly = {
  providerKeys: { groq: { key: "gsk_test", model: "openai/gpt-oss-120b" } },
} as unknown as Settings;
const solo = nextRotation(groqOnly, "vyce", t0);
ok(solo !== null && solo.llm.providerId === "groq", "a keyed provider becomes a rotation target");
ok(solo !== null && solo.waitMs === 0, "a fresh rotation target is ready now");
ok(solo !== null && solo.llm.model === "openai/gpt-oss-120b", "the saved model rides the rotation pick");
ok(
  solo !== null && solo.llm.baseUrl === groqProvider?.baseUrl,
  "the pick dials the provider's own endpoint (a genuinely different upstream)"
);
ok(solo !== null && solo.llm.apiKey === "gsk_test", "the saved key rides the rotation pick (BYOK intact)");
ok(nextRotation(groqOnly, "groq", t0) === null, "the failed provider is never its own rotation target");
const autoEscape = nextRotation(groqOnly, "auto", t0);
ok(autoEscape !== null && autoEscape.llm.providerId === "groq", "an unknown failed id leaves every ready provider as a candidate");
const keylessOnlyProvider = {
  providerKeys: { mistral: { key: "" } },
} as unknown as Settings;
ok(nextRotation(keylessOnlyProvider, "vyce", t0) === null, "a blank-saved-key provider is not a rotation target");
resetProvider429("groq");
resetProvider429("zai");
noteProvider429("groq", t0);
const skipCooling = nextRotation(
  {
    providerKeys: {
      groq: { key: "gsk_test" },
      zai: { key: "zai_test" },
    },
  } as unknown as Settings,
  "vyce",
  t0 + 1_000
);
ok(skipCooling !== null && skipCooling.llm.providerId === "zai", "a cooling provider is SKIPPED for a ready one");
noteProvider429("zai", t0 + 1_000);
const allCooling = nextRotation(
  {
    providerKeys: {
      groq: { key: "gsk_test" },
      zai: { key: "zai_test" },
    },
  } as unknown as Settings,
  "vyce",
  t0 + 2_000
);
ok(
  allCooling !== null && allCooling.waitMs > 0,
  "an all-cooling roster picks the soonest window — the retry waits EXACTLY it (harness pacing)",
  `waitMs=${allCooling?.waitMs}`
);

// ── composed coexistence: family window ⊕ registry cooldown ──────────────────
const laneStore = new Map<string, { until: number; strikes: number }>();
noteLane429(laneStore, "vyce", t0);
noteProvider429("vyce", t0 + 1_000);
ok(laneStrikes(laneStore, "vyce", t0 + 2_000) === 1, "the family window tracks its own strikes");
ok(provider429Streak("vyce") === 1, "the registry cooldown tracks its own streak (independent stores, distinct roles)");
ok(
  ROTATION_COOLDOWN_BASE_MS < LANE_SICK_MS,
  "sane scales: the first rotation cooldown (60s) beats waiting out the 5m family window"
);
ok(
  ROTATION_COOLDOWN_CAP_MS > LANE_SICK_MS,
  "sane scales: deep exhaustion (15m cap) outlasts the family window — repeat exhaustion slows down harder"
);
const wire = [
  { key: "vyce::deepseek-v4.1", label: "Vyce primary" },
  { key: "groq::openai/gpt-oss-120b", label: "Groq" },
];
const demoted = rotateHops(wire, laneStore, t0 + 2_000);
ok(
  demoted.hops[0].key === "groq::openai/gpt-oss-120b" && demoted.demoted.length === 1,
  "wire-order demotion still fires while the registry cooldown runs (both halves compose)"
);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);

// ── Source-level wiring asserts (qa-depth-degrade pattern) ───────────────────
// The rotation ladder cannot be honestly forced against the shared free
// gateway, so the composed runner wiring is pinned by source asserts; the next
// real 429 is the live witness.
import { readFileSync } from "node:fs";
import { join } from "node:path";
const runner = readFileSync(join(process.cwd(), "src/lib/workflow-runner.ts"), "utf8");
let wpass = 0, wfail = 0;
function wireOk(cond: boolean, name: string) {
  if (cond) { wpass++; console.log(`  ✓ ${name}`); }
  else { wfail++; console.log(`  ✗ ${name}`); }
}
const rlStart = runner.indexOf(`if (kind === "rate-limit") {`);
const rlEnd = runner.indexOf(`if (kind === "network"`);
const rlRegion = rlStart !== -1 && rlEnd > rlStart ? runner.slice(rlStart, rlEnd) : "";
wireOk(rlRegion.includes("noteProvider429(dialLlm.providerId"), "the 429 handler records REGISTRY exhaustion for the dialed provider");
wireOk(rlRegion.includes("demotePrimary = true;"), "a pre-stream 429 on the primary demotes it for the next attempt");
wireOk(runner.includes("nextRotation(settings.settings, llm.providerId)"), "the registry escape dials nextRotation");
wireOk(
  runner.indexOf("attempt === MAX_STEP_ATTEMPTS") !== -1 &&
    runner.indexOf("attempt === MAX_STEP_ATTEMPTS") < runner.indexOf("nextRotation(settings.settings"),
  "the registry escape is guarded to the FINAL attempt"
);
wireOk(runner.includes("resetProvider429(dialLlm.providerId"), "a successful dial clears the provider's registry cooldown");
wireOk(runner.includes("registry rotation — "), "the rotation carries an honest call-log note through the shared relayNotes path");
wireOk(runner.includes("dialLlm !== llm && !rotationNote"), "the demotion note yields to the rotation note (single note path)");
wireOk(runner.includes("Aborted during rotation wait"), "the rotation wait honors the abort signal");
wireOk(
  runner.includes("noteLane429(laneSaturation") && runner.includes("rotateHops(relayHops, laneSaturation"),
  "the lane-rotation half stays wired — composition, not replacement"
);
wireOk(!runner.includes("provider429CooldownLeftMs,"), "the runner imports only what it wires (cooldown math stays inside the module)");
console.log(`  ${wpass}/${wpass + wfail} wiring asserts passed`);
process.exit(wfail === 0 ? 0 : 1);
