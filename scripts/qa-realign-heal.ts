// r548 QA — vault-realignment browser heal (Owner bug: "same 429 after the
// key was realigned"). A realigned key must not inherit the OLD key's browser
// dial memory, and the clear must stay SCOPED to that provider.
// Run: bun scripts/qa-realign-heal.ts
import {
  clearProviderLaneHealth,
  recordRelayHopResult,
  relayHealthSnapshot,
} from "../src/lib/relay";
import {
  isProviderQuarantined,
  providerBreakerSnapshot,
  recordProviderOutcome,
  resetProviderBreaker,
} from "../src/lib/provider-breaker";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`ok ${pass} - ${name}`);
  } else {
    fail++;
    console.log(`NOT OK - ${name}`);
  }
}

// Stub the localStorage both modules use (best-effort memory, same contract).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

// Seed: an earlier 429 storm stamped vyce lanes soft/dead + docked the
// provider breaker; an unrelated orca lane carries its own soft stamp.
recordRelayHopResult("vyce::m1", false, '429 {"error":"Too many requests"}', "soft");
recordRelayHopResult("vyce::m2", false, "hard boom", "dead");
recordRelayHopResult("orcarouter::m", false, "429", "soft");
recordProviderOutcome("vyce", false, true, "streak");
recordProviderOutcome("orcarouter", false, false, "");

// The realignment heal — browser half.
const dropped = clearProviderLaneHealth("vyce");
const health = relayHealthSnapshot();
check("scoped clear drops BOTH vyce lane entries", dropped === 2 && !health["vyce::m1"] && !health["vyce::m2"]);
check("unrelated orca lane memory untouched", !!health["orcarouter::m"]);

resetProviderBreaker("vyce");
const bmap = providerBreakerSnapshot();
check("vyce breaker entry gone", !bmap["vyce"]);
check("orca breaker entry untouched", !!bmap["orcarouter"]);

check("scoped clear on unknown provider = no-op 0", clearProviderLaneHealth("nosuch") === 0);
check("empty providerId no-op safe", clearProviderLaneHealth("") === 0);
resetProviderBreaker("");

recordRelayHopResult("vyce::m1", true);
check("fresh key re-records cleanly post-heal", relayHealthSnapshot()["vyce::m1"]?.ok === 1);
check("success heals the provider breaker too", !isProviderQuarantined("vyce"));

console.log(fail === 0 ? `\n${pass}/${pass} realignment-heal checks passed` : `\n${fail} FAILURES / ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
