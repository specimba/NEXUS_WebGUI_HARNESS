// r339 probe — provider-gallery validate() must read the vault FRESH.
// Bug class: the Validate button chains saveProvider() → validate() in one
// tick (unsaved-key path). validate() used to read this render's closure
// `settings` (pre-save snapshot) and write its validatedAt stamp on a spread
// of the PRE-SAVE key map — clobbering accountId/model just persisted by
// saveProvider. Fix: both reads go through useSettingsStore.getState().
// Static doctrine probe (the clobber itself needs a real successful dial —
// zero external spend policy for this round).
import { readFileSync } from "node:fs";

const SRC = "src/components/praison/settings/provider-gallery.tsx";
const src = readFileSync(SRC, "utf8");

// Extract the validate() function body (from its signature to checkCredits).
const start = src.indexOf("async function validate(");
const end = src.indexOf("/** Probe the provider's account endpoint");
if (start < 0 || end < 0 || end <= start) {
  console.error("FAIL: could not locate validate() body boundaries");
  process.exit(1);
}
const body = src.slice(start, end);

let pass = 0;
const total = 5;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (ok) pass += 1;
}

check(
  "entry read goes through getState() (fresh, post-save)",
  /const saved = useSettingsStore\.getState\(\)\.settings\.providerKeys\?\.\[p\.id\];/.test(body)
);

check(
  "no closure-settings vault read remains inside validate()",
  !/settings\.providerKeys\?\.\[p\.id\]/.test(body.replace(/useSettingsStore\.getState\(\)\.settings\.providerKeys\?\.\[p\.id\]/g, ""))
);

check(
  "validatedAt success-write spreads the FRESH map via getState()",
  /update\(\{\s*providerKeys:\s*\{\s*\.\.\.\(useSettingsStore\.getState\(\)\.settings\.providerKeys \?\? \{\}\),/.test(body)
);

check(
  "stamp shape preserved: { ...entry, key, validatedAt: Date.now() }",
  /\[p\.id\]:\s*\{\s*\.\.\.entry,\s*key,\s*validatedAt:\s*Date\.now\(\)\s*\}/.test(body)
);

check(
  "saveProvider→validateAfter chain intact (the same-tick path this fixes)",
  /if \(opts\?\.validateAfter\) void validate\(p\);/.test(src)
);

console.log(`\n${pass}/${total} PASS — r339 gallery validate() fresh-vault doctrine`);
process.exit(pass === total ? 0 : 1);
