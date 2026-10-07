// r340 probe — automation-vault-card key-drift detection + re-mirror affordance.
// Bug class (r337 queue): a mirrored server slot silently falls behind when
// the user rotates the browser key — mirrorCandidates excludes providers that
// already have a slot, the r337 strip disappears, and closed-tab runs keep
// dialing the OLD key with no hint. Fix: slotDrifted() compares the browser
// key masked with the server's exact algorithm (maskOf) against the slot's
// masked preview; a drift chip on the slot row offers a one-click re-mirror
// (mirrorProvider = idempotent upsert by provider id).
import { readFileSync } from "node:fs";

const SRC = "src/components/praison/settings/automation-vault-card.tsx";
const src = readFileSync(SRC, "utf8");

let pass = 0;
const total = 6;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (ok) pass += 1;
}

check(
  "slotDrifted defined: browser key masked via maskOf and compared to slot maskedKey",
  /const slotDrifted = \(s: VaultSlot\): boolean => \{\s*const browserKey = settings\.providerKeys\?\.\[s\.provider\]\?\.key\?\.trim\(\);\s*return !!browserKey && maskOf\(browserKey\) !== s\.maskedKey;\s*\};/.test(src)
);

check(
  "no-false-positive gate: drift requires a browser key to exist",
  /return !!browserKey && maskOf\(browserKey\) !== s\.maskedKey;/.test(src)
);

check(
  "drift chip rendered on the slot row with the honest label",
  src.includes("key drifted \\u2014 re-mirror") || src.includes("key drifted \u2014 re-mirror")
);

check(
  "chip click reuses mirrorProvider (idempotent upsert path)",
  /onClick=\{\(\) => void mirrorProvider\(s\.provider\)\}/.test(src)
);

check(
  "chip gated on resolvable slots only (unknown providers never nag)",
  /resolvable && slotDrifted\(s\)/.test(src)
);

// Server-mask parity: maskOf must stay byte-identical to the API's maskKey
// (first4••••last4 for >12 chars; all-dots otherwise) — the r135/r218 Test
// round-trip contract depends on it, and so does this drift check.
check(
  "maskOf keeps server-mask parity (first4••••last4 / all-dots ≤12)",
  /return raw\.length > 12 \? `\$\{raw\.slice\(0, 4\)\}••••\$\{raw\.slice\(-4\)\}` : "••••••••";/.test(src)
);

console.log(`\n${pass}/${total} PASS — r340 vault key-drift hint doctrine`);
process.exit(pass === total ? 0 : 1);
