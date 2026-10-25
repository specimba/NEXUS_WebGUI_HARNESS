// ─── r526 — TASK-102 slice 3: vault at-rest encryption (AES-256-GCM) ─────────
// The AutomationVault rows used to hold RAW provider keys in SQLite (the r138
// local-first trust model). Honest upgrade, per the TASK-102 acceptance
// "vault round-trips server-only": keys are now encrypted at rest with
// AES-256-GCM before they touch the DB, so a copied/exfiltrated dev.db (the
// realistic local threat: backups, support bundles, sync) no longer yields
// usable provider keys on its own.
//
// THREAT MODEL HONESTY: this defends the DB FILE, not the whole machine. The
// master key lives beside the machine's own trust anchors (env or a 0600 file
// in db/), so full-disk compromise still wins. That is the same boundary the
// r493 vault-seed.json rehydration already drew, stated out loud.
//
// Master key resolution (first match):
//   1. NEXUS_VAULT_MASTER_KEY env — 32 bytes as hex (64 chars) or base64.
//   2. db/vault-master.key machine file — generated once (32 random bytes,
//      hex, 0600) on first use; .gitignore'd (r526).
//
// Wire format:  enc:v1:<iv_b64>:<ciphertext||tag_b64>   (12-byte IV, 128-bit
// GCM tag appended by WebCrypto). Any stored value WITHOUT the prefix is
// legacy plaintext and decrypts as-is — the honest legacy read path — while
// the boot migration (instrumentation.ts) re-encrypts those rows exactly once.
//
// r519 discipline: no static `import("node:…")` / `process.cwd` reads — the
// Edge bundle statically analyzes those and instrumentation.ts compiles into
// both runtimes. WebCrypto (globalThis.crypto.subtle) is isomorphic; the
// machine-file branch loads fs/path through runtime-constructed importers.

const PREFIX = "enc:v1:";

type FsLike = {
  readFile: (p: string, enc: string) => Promise<string>;
  writeFile: (p: string, data: string, opts?: { mode?: number }) => Promise<void>;
  mkdir: (p: string, opts?: { recursive?: boolean }) => Promise<string | undefined>;
};

const nodeImport = new Function("s", "return import(s)") as (
  s: string
) => Promise<Record<string, unknown>>;
const nodeCwd = new Function("return process.cwd()") as () => string;

// ── base64 helpers (isomorphic; vault payloads are <1KB) ─────────────────────
function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error("vault-crypto: WebCrypto unavailable in this runtime");
  }
  return c.subtle;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function bytesFromMaterial(material: string): Uint8Array | null {
  const trimmed = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  try {
    const decoded = fromB64(trimmed);
    if (decoded.length === 32) return decoded;
  } catch {
    // not base64 — fall through to the honest error below
  }
  return null;
}

// ── master key (cached per resolved material — env rotation is honored on
// the next call; the machine-file branch caches once it has been resolved) ───
let cachedMaterial = "";
let cachedKey: CryptoKey | null = null;
let cachedSource: "env" | "machine-file" | null = null;

async function importMasterKey(bytes: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("raw", bytes as BufferSource, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function getMasterKey(): Promise<{
  key: CryptoKey;
  source: "env" | "machine-file";
}> {
  const envMaterial = (process.env.NEXUS_VAULT_MASTER_KEY ?? "").trim();
  if (envMaterial) {
    const bytes = bytesFromMaterial(envMaterial);
    if (!bytes) {
      // An operator-set env var that cannot be parsed must fail LOUDLY —
      // silently falling back to the file key would just fail every decrypt.
      throw new Error(
        "vault-crypto: NEXUS_VAULT_MASTER_KEY must be 32 bytes (hex or base64)"
      );
    }
    if (cachedKey && cachedSource === "env" && cachedMaterial === envMaterial) {
      return { key: cachedKey, source: "env" };
    }
    const key = await importMasterKey(bytes);
    cachedMaterial = envMaterial;
    cachedKey = key;
    cachedSource = "env";
    return { key, source: "env" };
  }
  if (cachedKey && cachedSource === "machine-file") {
    return { key: cachedKey, source: "machine-file" };
  }
  // Machine-file branch: db/vault-master.key, generated on first use.
  const fs = (await nodeImport("node:fs/promises")) as unknown as FsLike;
  const path = (await nodeImport("node:path")) as unknown as {
    join: (...parts: string[]) => string;
  };
  const dir = path.join(nodeCwd(), "db");
  const keyPath = path.join(dir, "vault-master.key");
  let material: string | null = null;
  try {
    material = await fs.readFile(keyPath, "utf8");
  } catch {
    material = null;
  }
  let bytes = material ? bytesFromMaterial(material) : null;
  if (!bytes) {
    const fresh = toB64(randomBytes(32)); // store base64, 44 chars
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(keyPath, `${fresh}\n`, { mode: 0o600 });
    bytes = bytesFromMaterial(fresh);
    if (!bytes) throw new Error("vault-crypto: generated master key failed to parse");
  }
  const key = await importMasterKey(bytes);
  cachedMaterial = material?.trim() ?? "";
  cachedKey = key;
  cachedSource = "machine-file";
  return { key, source: "machine-file" };
}

export function isEncryptedVaultKey(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function vaultKeySource(): "env" | "machine-file" | "unset" {
  return cachedSource ?? (process.env.NEXUS_VAULT_MASTER_KEY ? "env" : "unset");
}

/** Encrypt a raw provider key for at-rest storage. Random IV per call. */
export async function encryptVaultKey(plain: string): Promise<string> {
  const { key } = await getMasterKey();
  const iv = randomBytes(12);
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain) as BufferSource
  );
  return `${PREFIX}${toB64(iv)}:${toB64(new Uint8Array(ct))}`;
}

/**
 * Decrypt an at-rest value. Values without the enc:v1: prefix are LEGACY
 * plaintext (r138 trust model) and pass through unchanged — the honest read
 * path the boot migration upgrades. Tampered or wrong-key ciphertexts THROW
 * (GCM auth) rather than returning garbage.
 */
export async function decryptVaultKey(stored: string): Promise<string> {
  if (!isEncryptedVaultKey(stored)) return stored;
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 2) {
    throw new Error("vault-crypto: malformed ciphertext envelope");
  }
  const { key } = await getMasterKey();
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: fromB64(parts[0]) as BufferSource },
    key,
    fromB64(parts[1]) as BufferSource
  );
  return new TextDecoder().decode(plain);
}
