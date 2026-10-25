// r526 — TASK-102 slice 3 verify: dial-free round-trip proof for vault-crypto.
// Run: bun scripts/qa-vault-crypto.ts
// Covers: round-trip, envelope format, random IV, legacy plaintext passthrough,
// tamper detection (GCM auth), wrong-master-key rejection, unicode keys.
process.env.NEXUS_VAULT_MASTER_KEY =
  "3f2a9c1e7744b2d0c8e5f1a3b9d7c2e4f6a8b0d2c4e6f8a1b3d5c7e9f0a2b4c6";

import {
  encryptVaultKey,
  decryptVaultKey,
  isEncryptedVaultKey,
} from "@/lib/server/vault-crypto";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const KEY = "sk-test-roundtrip-abcdef1234567890";

// 1. round-trip through the real module (env-master-key path)
const enc = await encryptVaultKey(KEY);
check("round-trip encrypt/decrypt", (await decryptVaultKey(enc)) === KEY);

// 2. envelope: enc:v1:<iv>:<ct||tag>, random IV per call
check("envelope prefix enc:v1:", enc.startsWith("enc:v1:") && enc.split(":").length === 4);
const enc2 = await encryptVaultKey(KEY);
check("random IV (same plaintext, different ciphertext)", enc !== enc2);
check("isEncryptedVaultKey true on ciphertext", isEncryptedVaultKey(enc));

// 3. honest legacy read path: plaintext passes through unchanged
check("legacy plaintext passthrough", (await decryptVaultKey(KEY)) === KEY);
check("legacy plaintext not flagged encrypted", !isEncryptedVaultKey(KEY));

// 4. tamper → GCM auth must throw, never return garbage
const parts = enc.split(":");
const ct = parts[3];
const flipped = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
let threw = false;
try {
  await decryptVaultKey([parts[0], parts[1], parts[2], flipped].join(":"));
} catch {
  threw = true;
}
check("tampered ciphertext rejected", threw);

// 5. wrong master key → throws (cache is keyed by material, rotation honored)
process.env.NEXUS_VAULT_MASTER_KEY =
  "1111111111111111111111111111111111111111111111111111111111111111";
threw = false;
try {
  await decryptVaultKey(enc);
} catch {
  threw = true;
}
check("wrong master key rejected", threw);

// 6. non-ascii key material round-trips
const UNI = "kéc-клю쿠-鍵";
check("unicode key round-trip", (await decryptVaultKey(await encryptVaultKey(UNI))) === UNI);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
