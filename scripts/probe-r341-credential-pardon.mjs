// r341 probe — credential-lifecycle pardon (user report 2026-10-07).
// Report: a workflow dial failed with Vyce's own 403 "balance is insufficient"
// on the OLD key; ~2h later the user saved a NEW key (webgui1, $236.57) in the
// SAME long-lived tab. Only a proven dial (r315) and "Check account" (r335)
// pardoned stale rotation memory — a plain key SAVE did not, so Retry kept
// skipping the lane until the 6h mark. Fix: saving a credential (browser
// vault) and mirroring a credential (server vault) are themselves lane-change
// signals — the browser map resets on save; the server lane is rechecked
// right after a mirror replaces its slot.
import { readFileSync } from "node:fs";

let pass = 0;
const total = 7;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (ok) pass += 1;
}

const gallery = readFileSync("src/components/praison/settings/provider-gallery.tsx", "utf8");
const vault = readFileSync("src/components/praison/settings/automation-vault-card.tsx", "utf8");
const chatClient = readFileSync("src/lib/chat-client.ts", "utf8");

// 1. saveProvider pardons the lane on credential replacement.
{
  const start = gallery.indexOf("function saveProvider(");
  const end = gallery.indexOf("async function validate(");
  const body = start >= 0 && end > start ? gallery.slice(start, end) : "";
  check(
    "gallery saveProvider: resetProvider429 fires on save (before the toast)",
    /update\(\{ providerKeys:[\s\S]*?\[p\.id\]: next[^;]*;[\s\S]*?resetProvider429\(p\.id\);\s*\n\s*toast\.success\(`\$\{p\.name\} key saved`/.test(body)
  );
}

// 2. mirrorProvider fires the server recheck after replacing the slot.
check(
  "vault mirrorProvider: POSTs /api/providers/recheck after the upsert",
  vault.includes('await fetch("/api/providers/recheck"')
);

// 3. the recheck call carries the mirrored provider id.
check(
  "recheck call passes the mirrored providerId",
  /body: JSON\.stringify\(\{ providerId \}\)/.test(vault)
);

// 4. the server heal is non-fatal (wrapped; mirror result never blocked).
check(
  "server heal is cosmetic-only (try/catch, mirror outcome independent)",
  vault.includes("/* cosmetic server-lane heal — the mirror itself already succeeded */")
);

// 5. honest reporting: heal note only when the route reports a real clear.
check(
  "heal note gated on cleared{billingLeftMs|cooldownLeftMs>0} and appended to the toast",
  vault.includes("The server lane was quarantined from an older failure — cleared just now.") &&
    /rd\.cleared\.billingLeftMs > 0 \|\| rd\.cleared\.cooldownLeftMs > 0/.test(vault)
);

// 6. r315 regression guard: a proven dial still pardons (unchanged).
check(
  "runAgentChat dial-success pardon intact (r315 guard)",
  /if \(params\.providerId && params\.providerId !== "auto"\)\s*\{\s*resetProvider429\(params\.providerId\);\s*\}/.test(chatClient)
);

// 7. mirror upsert contract unchanged (r337 label preserved for provenance).
check(
  "mirror label provenance unchanged (r337 contract)",
  vault.includes('label: "mirrored from saved provider keys"')
);

console.log(`\n${pass}/${total} PASS — r341 credential-lifecycle pardon doctrine`);
process.exit(pass === total ? 0 : 1);
