/**
 * r654 QA — vault drift auto-heal (K-series).
 * Run: bun scripts/qa-vault-drift-heal.ts
 * Covers: the pure drift predicate (mask parity, short-key all-dots
 * invariant, no-key-no-claim), and source-level pins: the heal fires at the
 * drift-creation moments (save + validate), the card sweep heals existing
 * drift on visibility, and the opt-in doctrine (no-slot precedes POST).
 */
import { readFileSync } from "node:fs";
import { slotIsDrifted } from "../src/lib/vault-mirror";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const MASK = (k: string) => (k.length > 12 ? `${k.slice(0, 4)}••••${k.slice(-4)}` : "••••••••");

// ── 1. The pure predicate ────────────────────────────────────────────────────
check("mask mismatch = drift", slotIsDrifted("sk-abcdef1234567890xyz", MASK("sk-fffffffffffffffffff")) === true);
check("mask agreement = clean", slotIsDrifted("sk-abcdef1234567890xyz", MASK("sk-abcdef1234567890xyz")) === false);
check("no browser key → no drift claim (deletion must not nag, r340)", slotIsDrifted(undefined, "sk-1••••8f71") === false);
check("empty browser key → no drift claim", slotIsDrifted("   ", "sk-1••••8f71") === false);
check("8-char key (all-dots mask both sides) can never false-positive",
  slotIsDrifted("shortkey", "••••••••") === false);
check("12-char key all-dots invariant holds too", slotIsDrifted("exactly12chr", "••••••••") === false);
check("garbage inputs never throw",
  slotIsDrifted(null as never, undefined as never) === false &&
    slotIsDrifted(42 as never, {} as never) === false);

// ── 2. Source-level wiring: the helper itself ────────────────────────────────
const mirror = readFileSync("src/lib/vault-mirror.ts", "utf8");
check("helper refuses to create the first slot (opt-in doctrine: no-slot precedes POST)",
  mirror.indexOf('"no-slot"') !== -1 &&
    mirror.indexOf('"no-slot"') < mirror.indexOf('method: "POST"'));
check("helper only heals when masks disagree (clean returns before POST)",
  mirror.indexOf("slotIsDrifted(key, slot.maskedKey") < mirror.indexOf('method: "POST"'));
check("helper carries the honest provenance label",
  mirror.includes("auto re-mirrored — drift heal"));
check("helper never throws (outer catch → failed)", mirror.includes('return "failed";'));
check("helper GETs with cache no-store (r218: cached masks heal against yesterday)",
  mirror.includes('cache: "no-store"'));
check("helper speaks the vault CSRF dialect", (mirror.match(/"x-nexus-csrf": "1"/g) ?? []).length >= 2);

// ── 3. Source-level wiring: the call sites ───────────────────────────────────
const gallery = readFileSync("src/components/nexus/settings/provider-gallery.tsx", "utf8");
check("saveProvider heals the drift it may create",
  (gallery.match(/void remirrorIfDrifted\(p\.id, key\);/g) ?? []).length >= 2);
check("gallery imports the helper", gallery.includes('from "@/lib/vault-mirror"'));
const card = readFileSync("src/components/nexus/settings/automation-vault-card.tsx", "utf8");
check("vault card sweeps drift when visible",
  card.includes("remirrorIfDrifted") && card.includes("slotIsDrifted"));
check("sweep gates on a successful read (r413: no heals over a dead read)",
  card.includes("if (loading || loadFailed) return;"));
check("sweep announces heals honestly and stays silent on zero",
  card.includes("Drifted key auto re-mirrored") && card.includes("if (healed > 0)"));
check("failed heals keep the manual chip path alive",
  card.includes("healInFlightRef.current = false;"));
check("sweep skips unresolvable providers (same guard as the drift chip)",
  card.includes("if (!providerById(s.provider)) return false;"));

console.log(`\nqa-vault-drift-heal: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
