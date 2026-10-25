// r527 — two-way vault seed bridge (upgraded from the export-only r493 tool).
//
// DEFAULT (export): db/vault-seed.json <- the vault, DECRYPTED back to
//   plaintext. The seed file is the owner's local plaintext backup (r493
//   trust class: localhost-only, gitignored); exporting the r526 ciphertext
//   would strand a fresh clone (different machine key) with rows it can
//   never decrypt. Legacy plaintext rows pass through unchanged.
// --import: db/vault-seed.json -> the vault, ENCRYPTED via the r526
//   AES-256-GCM module (src/lib/server/vault-crypto.ts) — the owner's
//   re-entry path after the r521 rollback; also usable to (re)fill a vault
//   that is NOT empty (boot rehydration only fires on a zero-row table).
//
// Never prints a full key — masked previews only.
// Run: bun scripts/seedwrite.ts [--import] [--file=db/vault-seed.json]
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { encryptVaultKey, decryptVaultKey } from "../src/lib/server/vault-crypto";

const args = process.argv.slice(2);
const doImport = args.includes("--import");
const fileArg = args.find((a) => a.startsWith("--file="));
const file = fileArg ? fileArg.slice("--file=".length) : "db/vault-seed.json";

const mask = (k: string) =>
  k.length > 12 ? `${k.slice(0, 4)}••••${k.slice(-4)}` : "••••••••";

(async () => {
  if (doImport) {
    let slots: { provider?: string; key?: string; label?: string }[] = [];
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as {
        slots?: { provider?: string; key?: string; label?: string }[];
      };
      slots = Array.isArray(raw?.slots) ? raw.slots : [];
    } catch (e) {
      console.error(
        `cannot read ${file}: ${e instanceof Error ? e.message : e} — nothing imported`
      );
      process.exit(1);
    }
    if (slots.length === 0) {
      console.log(`no slots in ${file} — nothing to import`);
      process.exit(0);
    }
    let n = 0;
    for (const s of slots) {
      const provider = (s?.provider ?? "").trim();
      const key = (s?.key ?? "").trim();
      if (!provider || !key) continue; // honest skip, mirrors the backup importer
      const label = s.label?.trim() ? s.label.trim() : null;
      const stored = await encryptVaultKey(key); // r526: ciphertext at rest
      await db.automationVault.upsert({
        where: { provider },
        create: { provider, key: stored, label },
        update: { key: stored, label },
      });
      console.log(`imported ${provider} ${mask(key)}`);
      n += 1;
    }
    console.log(`seed -> vault: ${n} slot(s) written encrypted (AES-256-GCM)`);
  } else {
    const rows = await db.automationVault.findMany({ orderBy: { provider: "asc" } });
    const slots = await Promise.all(
      rows.map(async (s) => ({
        provider: s.provider,
        // r526: the DB holds ciphertext — the seed backup stays plaintext.
        key: await decryptVaultKey(s.key),
        label: s.label ?? undefined,
      })),
    );
    writeFileSync(file, JSON.stringify({ slots }, null, 2) + "\n");
    console.log(
      `vault -> seed: ${slots.length} slot(s) exported as plaintext (localhost backup) -> ${file}`
    );
  }
  process.exit(0);
})();
