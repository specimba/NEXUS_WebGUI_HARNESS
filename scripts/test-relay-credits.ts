/**
 * r43 unit tests — relay credits handling + decision-tier Jev preference.
 * Run: bun scripts/test-relay-credits.ts
 * (relay.ts touches localStorage lazily — stub it before the calls.)
 */
import type { Settings } from "../src/lib/types";

// Minimal localStorage stub (relay health + live catalog read/write here).
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
  key: () => null,
  get length() {
    return store.size;
  },
} as Storage;

import { buildRelayChain, isFreeLane, isHardRelayFailure, providerRecentlyHardFailed, recordRelayHopResult, relayHealthSnapshot } from "../src/lib/relay";

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

console.log("credits classification (hard vs soft):");
check("402 out-of-credits is a HARD failure", isHardRelayFailure("Out of credits (HTTP 402): You're out of credits — this request needs $0.03. Add credits: https://x.ai/billing (request id: 20260924023746854234558268d9d6)") === true);
check("plain 402 is hard", isHardRelayFailure("HTTP 402 Payment Required") === true);
check("429 stays soft", isHardRelayFailure("Rate limit exceeded (HTTP 429)") === false);
check("quota wording stays soft", isHardRelayFailure("quota exceeded for this project") === false);
check("network death is hard", isHardRelayFailure("fetch failed") === true);

console.log("account-wide credit stamping:");
recordRelayHopResult("orcarouter::z-ai/glm-5.3-flash-free", true); // sibling lane, healthy first
recordRelayHopResult("orcarouter::google/gemini-3.8-flash", false, "Out of credits (HTTP 402): needs $0.03 — add credits");
const health = relayHealthSnapshot();
check(
  "sibling orca lane stamped at the same moment (account-wide)",
  (health["orcarouter::z-ai/glm-5.3-flash-free"]?.lastFailAt ?? 0) > 0 &&
    health["orcarouter::z-ai/glm-5.3-flash-free"]?.lastError === "account out of credits"
);
check("stamping lane records its own hard fail", (health["orcarouter::google/gemini-3.8-flash"]?.fail ?? 0) === 1);
check("other providers untouched", !health["kilo::kilo-auto/free"]);
recordRelayHopResult("orcarouter::deepseek/deepseek-v4-flash-free", true); // clean sibling first
recordRelayHopResult("orcarouter::kimi/kimi-k3", false, "Rate limit exceeded (HTTP 429)");
const health2 = relayHealthSnapshot();
check(
  "429 does NOT un-deaden a fresh hard 402 stamp (account still broke)",
  health2["orcarouter::google/gemini-3.8-flash"]?.soft !== true &&
    health2["orcarouter::google/gemini-3.8-flash"]?.lastError === "Out of credits (HTTP 402): needs $0.03 — add credits"
);
check("429 softens clean siblings (workspace throttle)", health2["orcarouter::deepseek/deepseek-v4-flash-free"]?.soft === true);
check("providerRecentlyHardFailed true for the credits-dead provider", providerRecentlyHardFailed("orcarouter") === true);
check("providerRecentlyHardFailed false for untouched providers", providerRecentlyHardFailed("kilo") === false);
check("providerRecentlyHardFailed false for auto", providerRecentlyHardFailed("auto") === false);

console.log("decision-tier Jev preference (free jev leads the judge chain):");
const settings: Settings = {
  provider: "custom",
  apiKey: "",
  baseUrl: "",
  defaultModel: "",
  temperature: 0.7,
  framework: "custom",
  displayName: "QA",
  seeded: true,
  providerKeys: {
    opencode: { key: "oc_sk_test", model: "claude-fable-5" },
    vyce: { key: "vyce_test" },
  },
} as unknown as Settings;
const chain = buildRelayChain(settings, { taskFit: "decision" });
const jevHop = chain.find((h) => h.model === "jev-1.13-free");
check("jev-1.13-free joins the chain from the doctrine catalog", !!jevHop);
const FLAGSHIP_RE = /pro|ultra|flagship|v4\.1|large|frontier|sonnet|120b|550b|command-a|medium|kimi-k3|minimax-m3|glm-5\.3(?!-flash)|fusion/i;
const jevPos = chain.indexOf(jevHop!);
const beforeJev = chain.slice(0, jevPos);
check(
  "NO flagship lane ranks ahead of the free jev lane (decision doctrine)",
  beforeJev.every((h) => !FLAGSHIP_RE.test(h.model))
);
check(
  "the fastJudge's first two slots are flagship-free",
  chain.slice(0, 2).every((h) => !FLAGSHIP_RE.test(h.model))
);
check("tier-1 flagships sink behind fast lanes for decision fit", chain.findIndex((h) => FLAGSHIP_RE.test(h.model)) > jevPos);
check("isFreeLane recognizes jev-1.13-free", isFreeLane("jev-1.13-free") === true);
check("isFreeLane negative case", isFreeLane("claude-fable-5") === false);
const anyChain = buildRelayChain(settings, { taskFit: "any" });
check(
  "fit 'any' keeps tier-first order (flagship tier-1 leads)",
  anyChain[0].tier === 1
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
