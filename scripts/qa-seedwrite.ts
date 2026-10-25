// r527 — E2E proof for the seedwrite bridge over the r526 encrypted vault.
// Uses a THROWAWAY provider id and deletes it afterwards — the vault is left
// exactly as it was (currently empty after the r521 rollback).
// Run: bun scripts/qa-seedwrite.ts
import { readFile, writeFile, unlink } from "node:fs/promises";
import { db } from "../src/lib/db";

const PROV = "qa-seedwrite-selfcheck";
const KEY = "sk-qa-seedwrite-roundtrip-key-1234567890";
const seedPath = "db/qa-seedwrite-tmp.json";
const outPath = "db/qa-seedwrite-tmp.out.json";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) {
    pass += 1;
    console.log(`PASS ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

async function runSeedwrite(args: string[]) {
  const p = Bun.spawn(["bun", "scripts/seedwrite.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  return { code, out, err };
}

(async () => {
  try {
    await writeFile(
      seedPath,
      JSON.stringify({ slots: [{ provider: PROV, key: KEY, label: "selfcheck" }] })
    );
    const imp = await runSeedwrite(["--import", `--file=${seedPath}`]);
    check("--import exits 0", imp.code === 0, imp.out + imp.err);
    check("--import never prints the full key", !imp.out.includes(KEY));

    const row = await db.automationVault.findUnique({ where: { provider: PROV } });
    check("row landed in the vault", !!row);
    check("row is AES-GCM ciphertext (enc:v1: prefix)", !!row && row.key.startsWith("enc:v1:"));
    check("DB row does NOT hold the raw key", !!row && !row.key.includes(KEY));

    const exp = await runSeedwrite([`--file=${outPath}`]);
    check("export exits 0", exp.code === 0, exp.out + exp.err);
    const exported = JSON.parse(await readFile(outPath, "utf8")) as {
      slots?: { provider?: string; key?: string }[];
    };
    const slot = (exported.slots ?? []).find((s) => s.provider === PROV);
    check("export round-trips to the ORIGINAL plaintext", slot?.key === KEY);
  } finally {
    await db.automationVault.deleteMany({ where: { provider: PROV } });
    await unlink(seedPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
