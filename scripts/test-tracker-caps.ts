/**
 * r45 unit tests — tracker capability extraction + badge helpers (pure, no DOM).
 * Run: bun scripts/test-tracker-caps.ts
 */
import { extractCaps } from "../src/lib/tracker-sources";
import { capsOf, declaresNoTools, CAP_META } from "../src/lib/tracker-types";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
