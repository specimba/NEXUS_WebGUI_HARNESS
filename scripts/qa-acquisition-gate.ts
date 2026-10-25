// qa-acquisition-gate.ts — r536 TASK-102 slice 7
// The acquisition-provider class gate, end to end:
//   1. registry: exa exists with lane "acquisition"; every legacy provider stays chat.
//   2. CHAT_PROVIDERS excludes exa and keeps every chat provider (no spray into
//      relay chains, rotation ladders, chat pickers — the r531 honesty note).
//   3. probeSlotDial refuses an exa slot ("acquisition-provider") — a vault slot
//      can never steer a step dial at a /search endpoint.
//   4. Legacy refusals intact (no key / unknown provider).
//   5. A chat slot (vyce) still resolves to a real dial.
import { CHAT_PROVIDERS, FREE_PROVIDERS, isChatProvider, providerById } from "../src/lib/providers";
//   6. r537: exaKeyFromSources — vault-first ordering, env fallback, silence.
import { exaKeyFromSources } from "../src/lib/exa-dialect";
import { probeSlotDial } from "../src/lib/server/automation-executor";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`  ok ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// 1 — registry shape
const exa = providerById("exa");
check("exa registered", !!exa);
check("exa lane is acquisition", exa?.lane === "acquisition");
check(
  "legacy providers stay chat",
  FREE_PROVIDERS.filter((p) => p.id !== "exa").every((p) => p.lane !== "acquisition"),
);

// 2 — chat surfaces stay clean
check("CHAT_PROVIDERS excludes exa", !CHAT_PROVIDERS.some((p) => p.id === "exa"));
check("CHAT_PROVIDERS keeps every chat provider", CHAT_PROVIDERS.length === FREE_PROVIDERS.length - 1);
check("isChatProvider(exa) is false", isChatProvider(exa) === false);

// 3 — the dial-boundary refusal
const exaRefusal = probeSlotDial({ provider: "exa", key: "test-key-123" });
check(
  "probeSlotDial refuses exa",
  !exaRefusal.dial && exaRefusal.why === "acquisition-provider",
  JSON.stringify(exaRefusal),
);

// 4 — legacy refusals intact
const noKey = probeSlotDial(null);
check("no-vault-key intact", !noKey.dial && noKey.why === "no-vault-key");
const unknown = probeSlotDial({ provider: "builtin", key: "k" });
check("no-resolvable-provider intact", !unknown.dial && unknown.why === "no-resolvable-provider");

// 5 — chat dial untouched
const vyce = probeSlotDial({ provider: "vyce", key: "sk-test" });
check(
  "chat slot still resolves",
  !!vyce.dial && typeof vyce.dial.url === "string" && vyce.dial.url.length > 0,
  JSON.stringify(vyce).slice(0, 140),
);

// 6 — r537: vault-first key resolution ordering (pure helper)
const vaultOnly = exaKeyFromSources([{ provider: "exa", key: " vault-key " }], "env-key");
check("vault slot wins over env", vaultOnly === "vault-key");
const envFallback = exaKeyFromSources([{ provider: "vyce", key: "k" }], " env-key ");
check("env fallback when no exa slot", envFallback === "env-key");
const silentLane = exaKeyFromSources(null, undefined);
check("no sources ⇒ empty key (lane silent)", silentLane === "");

console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
