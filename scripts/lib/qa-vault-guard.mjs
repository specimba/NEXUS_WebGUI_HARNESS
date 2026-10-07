// r326 INCIDENT GUARD (r327 namespace-isolation upgrade) — QA suites must
// never touch a real user vault slot.
//
// What happened (2026-10-07 ~19:30 +08): cdp-qa-vault-slot-affordances E1
// upserted a throwaway key over the user's REAL Vyce slot (POST /api/vault is
// an upsert — the real key was destroyed in SQLite), then E6 deleted the slot
// and asserted the vault EMPTY. The wipe was only visible because the user's
// Server-autopilot chip flipped from "server lane: Vyce AI sk-5••••c4f3" to
// "no key".
//
// r326 answer: refuse to run unless the vault is empty
// (assertVaultEmptyOrAbort) — safe, but it killed ALL scheduled vault QA the
// moment the user re-stores a real key: the guard would abort every run
// forever, and QA coverage of the vault surface goes to zero exactly when it
// matters (while real keys are in play).
//
// r327 answer: NAMESPACE ISOLATION. Slot-seeding suites write ONLY providers
// prefixed "qa-". The API facts that make this airtight (verified in the r327
// round against src/app/api/vault/route.ts + consume/route.ts):
//   - POST upserts keyed by the provider string — "qa-vyce" never collides
//     with the user's "vyce" slot;
//   - DELETE is an exact provider match (deleteMany where provider) — deleting
//     "qa-*" cannot remove a real slot;
//   - consume resolves ANY stored provider id (findUnique by provider, no
//     registry check) — so per-slot Test/Reveal QA still round-trips a qa-*
//     slot end-to-end (the card renders unpaired providers with an honest
//     "not pairable — skipped" chip, and the row keeps Eye/Test/Remove).
// initQaIsolation() fail-closed-aborts (exit 2) if the masked GET is
// unreadable — never write into an unverifiable vault — auto-reaps stale
// qa-* slots from crashed runs, and PROCEEDS when real slots exist (logging
// them honestly). finishQaIsolation() reaps any surviving qa-* slot and
// reports namespace cleanliness; it never asserts the whole vault empty.
//
// Two modes, by suite:
//   coexistence (initQaIsolation/finishQaIsolation) — suites that seed ONLY
//     qa-* slots: vault-slot-affordances (r327). Conversion queue:
//     vault-slot-residue, qa-automation-lane.
//   strict (assertVaultEmptyOrAbort) — suites whose ASSERTIONS read global
//     vault state (vault-chip: chip copy depends on the whole vault) and
//     suites still seeding un-namespaced slots (vault-test / vault-reveal /
//     vault-guard on the builtin box) until they convert.
export const QA_PREFIX = "qa-";

async function listVaultSlots(base) {
  const res = await fetch(`${base}/api/vault`);
  const json = await res.json().catch(() => null);
  return Array.isArray(json?.vault) ? json.vault : null;
}

// STRICT mode (unchanged contract): a populated vault means REAL keys —
// abort before any browser boot or write. Used by suites whose assertions
// assume a known global vault state, and by any suite that has not yet been
// converted to the qa-* namespace.
export async function assertVaultEmptyOrAbort(base, suite) {
  const slots = await listVaultSlots(base);
  const n = slots === null ? -1 : slots.length;
  if (n !== 0) {
    console.error(
      `[qa-guard] ${suite}: ABORT — /api/vault holds ` +
        `${n >= 0 ? n : "an unreadable number of"} slot(s). ` +
        `This suite asserts GLOBAL vault state and/or writes un-namespaced ` +
        `slots; running against a populated vault would DESTROY user keys ` +
        `(the r326 incident). Remove the slots for the duration of QA, or ` +
        `convert the suite to the qa-* namespace (see initQaIsolation).`
    );
    process.exit(2);
  }
  console.log(`[qa-guard] ${suite}: vault empty — safe to proceed`);
}

// COEXISTENCE mode, init: fail-closed if unreadable, reap stale qa-* slots,
// proceed alongside real slots (never touching them).
export async function initQaIsolation(base, suite) {
  const slots = await listVaultSlots(base);
  if (slots === null) {
    console.error(
      `[qa-guard] ${suite}: ABORT — /api/vault unreadable; refusing to ` +
        `write into an unverifiable vault (fail-closed, r326 doctrine).`
    );
    process.exit(2);
  }
  const real = slots.filter((s) => !String(s.provider ?? "").startsWith(QA_PREFIX));
  const stale = slots.filter((s) => String(s.provider ?? "").startsWith(QA_PREFIX));
  if (real.length > 0) {
    console.log(
      `[qa-guard] ${suite}: coexistence mode — ${real.length} real slot(s) ` +
        `present (${real.map((s) => s.provider).join(", ")}); this suite ` +
        `writes/deletes ONLY "${QA_PREFIX}*" slots — real slots are never ` +
        `touched (r327 namespace isolation).`
    );
  }
  for (const s of stale) {
    await fetch(`${base}/api/vault?provider=${encodeURIComponent(s.provider)}`, {
      method: "DELETE",
    });
  }
  if (stale.length > 0) {
    console.log(
      `[qa-guard] ${suite}: removed ${stale.length} stale ${QA_PREFIX}* ` +
        `slot(s) left by a previous crashed run`
    );
  }
  console.log(`[qa-guard] ${suite}: qa namespace clean — safe to proceed`);
}

// COEXISTENCE mode, finish: reap any surviving qa-* slot (idempotent — also
// usable as a standalone cleanup after a mid-suite crash), then verify the
// namespace is empty. Returns { ok, residue, realCount } so the SUITE owns
// its check() label; real slots are reported, never touched.
export async function finishQaIsolation(base, suite) {
  const slots = await listVaultSlots(base);
  if (slots !== null) {
    for (const s of slots.filter((s) =>
      String(s.provider ?? "").startsWith(QA_PREFIX)
    )) {
      await fetch(`${base}/api/vault?provider=${encodeURIComponent(s.provider)}`, {
        method: "DELETE",
      });
    }
  }
  const after = await listVaultSlots(base);
  const residue =
    after === null
      ? -1
      : after.filter((s) => String(s.provider ?? "").startsWith(QA_PREFIX)).length;
  const realCount =
    after === null ? -1 : after.length - after.filter((s) => String(s.provider ?? "").startsWith(QA_PREFIX)).length;
  console.log(
    `[qa-guard] ${suite}: finish — ${QA_PREFIX}* residue=${residue}, ` +
      `real slots untouched=${realCount}`
  );
  return { ok: residue === 0, residue, realCount };
}
