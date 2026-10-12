#!/usr/bin/env node
/**
 * r345 probe — re-land of r337: one-click key mirror strip in the vault card.
 * Pins: (1) the card reads browser BYOK keys from the settings store;
 * (2) mirrorProvider POSTs the SAME /api/vault upsert endpoint the paste
 * form uses, non-blocking (finally clears the per-provider flag), reloads
 * slots, honest toast; (3) candidates are explicit: non-empty browser key +
 * registry-pairable provider only; (4) the chip is honest about vault state
 * (not stored / mirrored-current mask match / differs=amber drift);
 * (5) mirroring is BUTTON-gATED — no auto-effect, nothing implicit;
 * (6) regressions: the paste form (saveLane), builtin machinery
 * (testSlot/revealSlot), and the /api/vault upsert route are untouched.
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
let pass = 0, fail = 0;
const ok = (cond, name) => {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}`);
  if (cond) { pass++; } else { fail++; }
};

const card = read("src/components/praison/settings/automation-vault-card.tsx");
const route = read("src/app/api/vault/route.ts");

// ── wiring ──
ok(/import \{ useSettingsStore \} from "@\/lib\/stores";/.test(card), "card imports the settings store (browser BYOK source)");
ok(/const providerKeys = useSettingsStore\(\(s\) => s\.settings\.providerKeys\);/.test(card), "card reads settings.providerKeys");
ok(/const \[mirroring, setMirroring\] = React\.useState<string \| null>\(null\);/.test(card), "per-provider mirroring flag state exists");

// ── the handler ──
ok(/async function mirrorProvider\(pid: string\)/.test(card), "mirrorProvider handler exists");
ok(/mirrorProvider[\s\S]{0,900}method: "POST",[\s\S]{0,200}body: JSON\.stringify\(\{ provider: pid, key \}\)/.test(card),
  "handler POSTs /api/vault upsert with { provider, key } (same endpoint as paste form)");
ok(/mirrorProvider[\s\S]{0,1200}await load\(\);[\s\S]{0,400}toast\.success\(/.test(card), "handler reloads slots then toasts success");
ok(/mirrorProvider[\s\S]{0,1600}\} finally \{\s*setMirroring\(null\);/.test(card), "handler is non-blocking: finally clears the mirroring flag");
ok(/browser copy in Providers is untouched/.test(card), "success toast is explicit about the browser copy staying intact");

// ── candidates: explicit + pairable-only + honest vault state ──
ok(/const mirrorCandidates = React\.useMemo\(/.test(card), "candidates computed via useMemo");
ok(/if \(!browserKey\) return null;/.test(card), "empty browser keys are never candidates");
ok(/const p = providerById\(pid\);\s*if \(!p\) return null;/.test(card), "unresolvable provider ids are excluded (executor would skip them)");
ok(/const drift = !!slot && slot\.maskedKey !== browserMask;/.test(card), "drift detection: slot mask vs browser-key mask");
ok(/differs — mirror updates/.test(card) && /mirrored ✓/.test(card) && /not stored/.test(card),
  "chip states honest: not stored / mirrored-current / differs(amber)");
ok(/border-amber-500\/40[\s\S]{0,120}text-amber-600/.test(card), "drift chip renders amber");
ok(/c\.slot\.maskedKey\}\)/.test(card) && /c\.browserMask\}\)/.test(card), "drift title shows BOTH masks (older stored vs current browser)");

// ── explicit opt-in only ──
ok(/onClick=\{\(\) => void mirrorProvider\(c\.pid\)\}/.test(card), "mirroring fires only from the chip button");
ok(!/useEffect\([\s\S]{0,200}mirrorProvider/.test(card), "NO auto-effect mirrors anything implicitly");
ok(/disabled=\{mirroring !== null\}/.test(card), "mirror buttons disable while one is in flight");

// ── regressions ──
ok(/async function saveLane\(\)/.test(card) && /paste the provider key for closed-tab runs/.test(card),
  "paste form (saveLane) intact");
ok(/async function testSlot\(provider: string\)/.test(card) && /async function revealSlot\(provider: string\)/.test(card),
  "per-slot Test/Reveal machinery intact");
ok(/async function removeSlot\(provider: string\)/.test(card), "removeSlot intact");
ok(/const row = await db\.automationVault\.upsert\(\{/.test(route) && /where: \{ provider \}/.test(route),
  "route regression: POST still upserts by provider (unchanged)");
ok(/maskedKey: maskKey\(r\.key\)/.test(route), "route regression: GET still masks keys");

console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail === 0 ? 0 : 1);
