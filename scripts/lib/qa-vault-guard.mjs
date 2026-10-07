// r326 INCIDENT GUARD — QA suites must never touch a populated user vault.
//
// What happened (2026-10-07 ~19:30 +08): cdp-qa-vault-slot-affordances E1
// upserted a throwaway key over the user's REAL Vyce slot (POST /api/vault is
// an upsert — the real key was destroyed in SQLite), then E6 deleted the slot
// and asserted the vault EMPTY. The wipe was only visible because the user's
// Server-autopilot chip flipped from "server lane: Vyce AI sk-5••••c4f3" to
// "no key". The suites predate real user data; from now on they refuse to
// run unless the vault is empty. The guard itself is read-only (masked GET).
export async function assertVaultEmptyOrAbort(base, suite) {
  const res = await fetch(`${base}/api/vault`);
  const json = await res.json().catch(() => null);
  const n = Array.isArray(json?.vault) ? json.vault.length : -1;
  if (n !== 0) {
    console.error(
      `[qa-guard] ${suite}: ABORT — /api/vault holds ` +
        `${n >= 0 ? n : "an unreadable number of"} slot(s). ` +
        `These suites upsert+DELETE real provider slots; running against a ` +
        `populated vault would DESTROY user keys (the r326 incident). ` +
        `Remove the slots for the duration of QA, or run on a throwaway profile.`
    );
    process.exit(2);
  }
  console.log(`[qa-guard] ${suite}: vault empty — safe to proceed`);
}
