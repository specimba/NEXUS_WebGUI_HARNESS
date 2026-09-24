/**
 * r45 unit tests — tracker capability extraction + badge helpers (pure, no DOM).
 * Run: bun scripts/test-tracker-caps.ts
 */
import { extractCaps } from "../src/lib/tracker-sources";
import { capsOf, declaresNoTools, CAP_META } from "../src/lib/tracker-types";
import { parseCapsIndex, capsForModel, laneLacksTools, toolWarningFor, agentLaneSummary, agentLaneKey } from "../src/lib/tracker-caps-index";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// Live-captured real shapes (2026-09-24, OpenRouter + Kilo probes).
const OR_REAL = {
  id: "z-ai/glm-5.3-prime",
  architecture: {
    modality: "text->text",
    input_modalities: ["text"],
    output_modalities: ["text"],
    tokenizer: "Other",
    instruct_type: null,
  },
  supported_parameters: [
    "frequency_penalty",
    "include_reasoning",
    "logprobs",
    "max_tokens",
    "presence_penalty",
    "reasoning",
    "reasoning_effort",
    "response_format",
    "seed",
    "stop",
    "temperature",
    "tool_choice",
    "tools",
    "top_k",
    "top_logprobs",
    "top_p",
  ],
};

const KILO_REAL = {
  id: "kilo-auto/efficient",
  architecture: { input_modalities: ["text", "image"], output_modalities: ["text"], tokenizer: "Other" },
  supported_parameters: ["max_tokens", "temperature", "tools", "reasoning", "include_reasoning"],
};

console.log("extractCaps — real catalog shapes:");
const or = extractCaps(OR_REAL);
check("glm-5.3-prime: tools true", or?.tools === true);
check("glm-5.3-prime: structured true (response_format)", or?.structured === true);
check("glm-5.3-prime: reasoning true (reasoning + include_reasoning)", or?.reasoning === true);
check("glm-5.3-prime: vision false (text-only input)", or?.vision === false);

const kilo = extractCaps(KILO_REAL);
check("kilo-auto/efficient: tools true", kilo?.tools === true);
check("kilo-auto/efficient: vision true (image input)", kilo?.vision === true);
check("kilo-auto/efficient: structured false (no response_format/structured_outputs)", kilo?.structured === false);
check("kilo-auto/efficient: reasoning true", kilo?.reasoning === true);

console.log("extractCaps — honest unknowns:");
check("no fields at all → null", extractCaps({}) === null);
check("empty params array + no architecture → null", extractCaps({ supported_parameters: [] }) === null);
check("null architecture → null", extractCaps({ architecture: null }) === null);
check("non-array params ignored", extractCaps({ supported_parameters: "tools" }) === null);
check(
  "params array present but empty + image mods → vision-only shape still derives",
  extractCaps({ supported_parameters: [], architecture: { input_modalities: ["image"] } })?.vision === true
);
check(
  "non-string params entries filtered",
  extractCaps({ supported_parameters: [1, "tools", null], architecture: { input_modalities: [] } })?.tools === true
);
check(
  "structured_outputs flag counts",
  extractCaps({ supported_parameters: ["structured_outputs"], architecture: { input_modalities: ["text"] } })?.structured === true
);
check(
  "reasoning via include_reasoning alone counts",
  extractCaps({ supported_parameters: ["include_reasoning"], architecture: { input_modalities: ["text"] } })?.reasoning === true
);

console.log("capsOf — meta reading:");
check("meta null → null (unknown stays unknown)", capsOf({ meta: null }) === null);
check("meta without caps → null", capsOf({ meta: { created: 123 } }) === null);
check("caps garbage shape → null (garbage reads as unknown, not as no)", capsOf({ meta: { caps: "garbage" } }) === null);
check("strict booleans: 1 / 'yes' are NOT true", (() => {
  const c = capsOf({ meta: { caps: { tools: 1, structured: "yes" } } });
  return c !== null && !c.tools && !c.structured;
})());
check("real caps round-trip", capsOf({ meta: { caps: or } })?.tools === true);
check("declaresNoTools: caps present + tools false → true", declaresNoTools({ meta: { caps: { tools: false } } }));
check("declaresNoTools: unknown caps → false (never a false accusation)", declaresNoTools({ meta: null }) === false);
check("declaresNoTools: tools true → false", declaresNoTools({ meta: { caps: { tools: true } } }) === false);

console.log("CAP_META integrity:");
check("four capabilities documented", CAP_META.length === 4);
check("glyphs unique", new Set(CAP_META.map((c) => c.glyph)).size === 4);
check("every entry has hint + class", CAP_META.every((c) => c.hint.length > 10 && c.cls.length > 0));

console.log("caps index — picker lookups (r46):");
const mirror = JSON.stringify({
  at: Date.now(),
  tracked: [
    { id: "openrouter::deepseek/deepseek-chat-v3.1:free", meta: { caps: { tools: true, structured: true, reasoning: true, vision: false } } },
    { id: "kilo::google/lyria-3-clip-preview", meta: { caps: { tools: false, structured: true, reasoning: false, vision: true } } },
    { id: "orcarouter::some-model", meta: { created: 1 } }, // no caps → unknown
    { id: "broken-row" }, // missing meta
    { id: 42, meta: { caps: { tools: true } } }, // non-string id dropped
  ],
  events: [],
});
const idx = parseCapsIndex(mirror);
check("rows with caps indexed", Object.keys(idx).length === 2);
check("empty mirror → {}", Object.keys(parseCapsIndex(null)).length === 0);
check("garbage JSON → {}", Object.keys(parseCapsIndex("not json{")).length === 0);
check("caps absent from meta → not indexed", !("orcarouter::some-model" in idx));
check("strict boolean survives indexing", idx["openrouter::deepseek/deepseek-chat-v3.1:free"]?.tools === true);

check("exact-key lookup hits", capsForModel(idx, "openrouter::deepseek/deepseek-chat-v3.1:free")?.tools === true);
check("miss → null (never guessed)", capsForModel(idx, "openrouter::never-seen") === null);
check("pseudo-id 'default' → null", capsForModel(idx, "default") === null);
check("pseudo-id 'auto::builtin' → null", capsForModel(idx, "auto::builtin") === null);
check("empty key → null", capsForModel(idx, "") === null);

check("laneLacksTools: tools=false lane → true", laneLacksTools(idx, "kilo::google/lyria-3-clip-preview"));
check("laneLacksTools: tools=true lane → false", laneLacksTools(idx, "openrouter::deepseek/deepseek-chat-v3.1:free") === false);
check("laneLacksTools: unknown lane → false (no false accusation)", laneLacksTools(idx, "orcarouter::some-model") === false);
check("laneLacksTools: missing lane → false", laneLacksTools(idx, "aihubmix::nope") === false);

check("toolWarningFor: no tools attached → null", toolWarningFor(idx, "kilo::google/lyria-3-clip-preview", false) === null);
check(
  "toolWarningFor: no-tool lane + tools → names the model",
  toolWarningFor(idx, "kilo::google/lyria-3-clip-preview", true)?.includes("google/lyria-3-clip-preview") === true
);
check("toolWarningFor: tool lane + tools → null", toolWarningFor(idx, "openrouter::deepseek/deepseek-chat-v3.1:free", true) === null);
check("toolWarningFor: unknown lane + tools → null", toolWarningFor(idx, "openrouter::unknown-lane", true) === null);
check(
  "toolWarningFor: nested provider id keeps full model suffix",
  (() => {
    const i2 = parseCapsIndex(
      JSON.stringify({ tracked: [{ id: "orcarouter::a/b/c", meta: { caps: { tools: false } } }] })
    );
    return toolWarningFor(i2, "orcarouter::a/b/c", true)?.includes("a/b/c") === true;
  })()
);

// ─── r47: agentLaneSummary — agent-level lane readiness (workflow + suites) ──
console.log("\nr47 agentLaneSummary:");
const sumIdx = parseCapsIndex(
  JSON.stringify({
    tracked: [
      { id: "openrouter::deepseek/deepseek-chat-v3.1:free", meta: { caps: { tools: true, structured: true, reasoning: false, vision: false } } },
      { id: "kilo::google/lyria-3-clip-preview", meta: { caps: { tools: false, structured: true, reasoning: false, vision: true } } },
      { id: "orcarouter::a/b/c", meta: { caps: { tools: false } } },
    ],
  })
);

const toolAgent = { name: "Researcher", model: "kilo::google/lyria-3-clip-preview", tools: ["web_search"] };
const cleanAgent = { name: "Writer", model: "openrouter::deepseek/deepseek-chat-v3.1:free", tools: ["web_search"] };
const bareAgent = { name: "Brainstormer", model: "kilo::google/lyria-3-clip-preview", tools: [] };
const autoAgent = { name: "Default", model: "auto", tools: ["web_search"] };
const unknownAgent = { name: "Mystery", model: "orcarouter::nope", tools: ["web_search"] };

{
  const s = agentLaneSummary(sumIdx, toolAgent);
  check("tool agent on tool-less lane → warning fires", s.warning !== null);
  check("warning names the agent", s.warning?.includes("Researcher") === true);
  check("warning names the lane", s.warning?.includes("google/lyria-3-clip-preview") === true);
  check("warning says step's tool calls may fail", s.warning?.includes("step's tool calls may fail") === true);
  check("lacksTools true (positive evidence)", s.lacksTools === true);
  check("hasTools true", s.hasTools === true);
  check("caps surface for chips (structured+vision, no tools)", s.caps?.structured === true && s.caps?.vision === true && s.caps?.tools === false);
}
{
  const s = agentLaneSummary(sumIdx, cleanAgent);
  check("tool agent on tools lane → no warning", s.warning === null);
  check("lacksTools false on tools lane", s.lacksTools === false);
}
{
  const s = agentLaneSummary(sumIdx, bareAgent);
  check("tool-less agent on tool-less lane → no warning (no false alarm)", s.warning === null);
  check("…but lacksTools still true (honest lane data)", s.lacksTools === true);
  check("hasTools false for empty tools array", s.hasTools === false);
}
{
  const s = agentLaneSummary(sumIdx, autoAgent);
  check("auto (built-in) lane → caps null, never accused", s.caps === null && s.lacksTools === false && s.warning === null);
  check("auto laneLabel reads 'auto'", s.laneLabel === "auto");
}
{
  const s = agentLaneSummary(sumIdx, unknownAgent);
  check("unknown lane → silence (no caps, no warning)", s.caps === null && s.warning === null && s.lacksTools === false);
}
{
  const s = agentLaneSummary(sumIdx, { name: "Nested", model: "orcarouter::a/b/c", tools: ["t"] });
  check("nested provider id keeps full suffix in warning", s.warning?.includes("a/b/c") === true);
}
check("non-array tools (garbage) → hasTools false", agentLaneSummary(sumIdx, { name: "G", model: "kilo::google/lyria-3-clip-preview", tools: "web_search" }).hasTools === false);
check("non-string model (garbage) → falls back to auto silently", (() => {
  const s = agentLaneSummary(sumIdx, { name: "B", model: 42 as unknown as string, tools: ["t"] });
  return s.lane === "auto" && s.laneLabel === "auto" && s.warning === null;
})());
check("auto::builtin pseudo-id → caps null", agentLaneSummary(sumIdx, { name: "B2", model: "auto::builtin", tools: ["t"] }).caps === null);

// ─── r47: agentLaneKey — runtime-faithful lane derivation ────────────────────
console.log("\nr47 agentLaneKey (runtime-faithful lanes):");
check("bare model + active provider → prefixed lane", agentLaneKey("google/lyria", "kilo") === "kilo::google/lyria");
check("bare model + auto profile → auto (dormant, never accused)", agentLaneKey("google/lyria", "auto") === "auto");
check("bare model + no provider → auto", agentLaneKey("google/lyria", undefined) === "auto");
check("bare model + empty provider → auto", agentLaneKey("google/lyria", "") === "auto");
check("'auto' model + active provider → auto", agentLaneKey("auto", "kilo") === "auto");
check("absolute 'provider::model' passes through", agentLaneKey("kilo::x/y", "kilo") === "kilo::x/y");
check("absolute key under a DIFFERENT provider still absolute", agentLaneKey("openrouter::x/y", "kilo") === "openrouter::x/y");
check("garbage model → auto", agentLaneKey(42, "kilo") === "auto");
check("whitespace-padded bare model trimmed", agentLaneKey("  google/lyria  ", "kilo") === "kilo::google/lyria");

console.log("\nr47 agentLaneSummary × activePid (runtime-faithful):");
{
  const bareToolAgent = { name: "Scout", model: "google/lyria-3-clip-preview", tools: ["web_search"] };
  const onKilo = agentLaneSummary(sumIdx, bareToolAgent, "kilo");
  check("bare no-tool model + kilo active → warning fires", onKilo.warning !== null);
  check("…lane resolves to kilo::google/lyria-3-clip-preview", onKilo.lane === "kilo::google/lyria-3-clip-preview");
  check("…caps carry kilo's structured+vision", onKilo.caps?.structured === true && onKilo.caps?.vision === true);
  const onVyce = agentLaneSummary(sumIdx, bareToolAgent, "vyce");
  check("same model on unknown provider lane → silence (no cross-provider guess)", onVyce.warning === null && onVyce.caps === null);
  const onAuto = agentLaneSummary(sumIdx, bareToolAgent, "auto");
  check("same model while profile is auto → silence (dormant lane)", onAuto.warning === null && onAuto.caps === null);
  const noToolsAgent = { name: "Planner", model: "google/lyria-3-clip-preview", tools: [] };
  check("bare no-tool model + kilo + NO tools → no warning", agentLaneSummary(sumIdx, noToolsAgent, "kilo").warning === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
