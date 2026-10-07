// r323 proof: FREE_PROVIDERS' noKey flag had ZERO setters — the r318 relay
// chain pass (relay.ts no-key tier-2 hop) and the r319 server executor
// fallback (dialNoKeyFallback) both iterated an EMPTY lane list, silently
// dead since ship. With pollinations now flagged noKey: true, this probe
// asserts the lane actually reaches the chain and the rotation pool.
// Runner: bun scripts/qa-nokey-chain.ts (plain tsx transform-fails, r2xx).
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

import { buildRelayChain } from "../src/lib/relay";
import { nextRotation } from "../src/lib/provider-rotation";

const settings = {
  relayEnabled: true,
  providerKeys: {},
} as unknown as Parameters<typeof buildRelayChain>[0];

const chain = buildRelayChain(settings, { taskFit: "research" });
const noKeyHops = chain.filter((h) => h.note === "no-key free lane");
console.log(`chain_len=${chain.length} noKey_hops=${noKeyHops.length}`);
console.log(
  noKeyHops.map((h) => `${h.providerId}:${h.model}:tier${h.tier}`).join(" ") ||
    "(none)"
);
if (noKeyHops.length === 0) {
  console.error("FAIL — no noKey hop in the chain; the r318 pass is still dead");
  process.exit(1);
}
const poll = noKeyHops.find((h) => h.providerId === "pollinations");
if (!poll) {
  console.error("FAIL — pollinations hop missing");
  process.exit(1);
}
if (poll.apiKey !== undefined) {
  console.error("FAIL — noKey hop must dial keyless (apiKey undefined)");
  process.exit(1);
}
const rot = nextRotation(settings, "vyce");
console.log(
  `nextRotation_from_vyce=${rot ? rot.llm.providerId : "(none)"}`
);
if (!rot || rot.llm.providerId !== "pollinations") {
  console.error("FAIL — nextRotation does not reach the noKey lane");
  process.exit(1);
}
console.log("PASS — noKey lane reaches chain + rotation (r318/r319 passes live)");
