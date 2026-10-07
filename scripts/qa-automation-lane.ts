// ─── r205 QA: the server lane tells the truth ────────────────────────────────
// Three layers, one script:
//   1. Pure unit tests for computeStaleRegistry (the >24h trap) and
//      humanizeLaneReason.
//   2. Pure unit tests for resolveServerDialFromSlots — the executor's exact dial
//      resolution, no network, no dials.
//   3. Live route contract: GET /api/automation/sync must report an
//      executorLane that MIRRORS the executor (first vault row, registry
//      provider pairing required, builtin skipped) — plus a raw-key leak
//      check and the legacy vaultLane field.
//
// Self-restoring (r204 incident doctrine): snapshots vault + enabled
// registry rows, DEFERS all enabled rows during the test so the live
// executor can never claim anything while a test vault key exists, and
// restores byte-for-byte in finally.

import {
  computeStaleRegistry,
  fmtSlotAge,
  humanizeLaneReason,
  pickExecutorSlot,
  type ExecutorLaneState,
} from "../src/lib/automation-lane";
import { resolveServerDialFromSlots } from "../src/lib/server/automation-executor";
import { PrismaClient } from "@prisma/client";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); if (c) pass++; else fail++; };
const HOUR = 3_600_000;
const now = Date.now();

console.log("— computeStaleRegistry (the >24h frozen-countdown trap) —");
const rows = [
  { id: "fresh", name: "Fresh", enabled: true, nextRunAt: new Date(now + HOUR).toISOString() },
  { id: "overdue-nolocal", name: "Overdue No Local", enabled: true, nextRunAt: new Date(now - 25 * HOUR).toISOString() },
  { id: "overdue-tabdrives", name: "Overdue Tab Drives", enabled: true, nextRunAt: new Date(now - 25 * HOUR).toISOString() },
  { id: "overdue-localpast", name: "Overdue Local Past", enabled: true, nextRunAt: new Date(now - 25 * HOUR).toISOString() },
  { id: "disabled", name: "Disabled", enabled: false, nextRunAt: new Date(now - 48 * HOUR).toISOString() },
  { id: "boundary", name: "Boundary 23.9h", enabled: true, nextRunAt: new Date(now - 23.9 * HOUR).toISOString() },
  { id: "nulldue", name: "Null Due", enabled: true, nextRunAt: null },
];
const localNextByWf = new Map<string, string>([
  ["overdue-tabdrives", new Date(now + 15 * 60_000).toISOString()],
  ["overdue-localpast", new Date(now - 60_000).toISOString()],
]);
const stale = computeStaleRegistry(rows, localNextByWf, now);
const staleIds = new Set(stale.map((r) => r.id));
ok(!staleIds.has("fresh"), "future due → never stale");
ok(staleIds.has("overdue-nolocal"), "overdue >24h, no local schedule → stale");
ok(!staleIds.has("overdue-tabdrives"), "overdue >24h but tab lane has a future fire → NOT stale (frozen registry countdown is healthy)");
ok(staleIds.has("overdue-localpast"), "overdue >24h, local fire also in the past → stale (neither lane driving)");
ok(!staleIds.has("disabled"), "disabled row → ignored (breaker parking is honest)");
ok(!staleIds.has("boundary"), "overdue <24h → not stale (threshold honored)");
ok(!staleIds.has("nulldue"), "null nextRunAt → ignored");

console.log("— humanizeLaneReason —");
ok(humanizeLaneReason("no-vault-key") === "no vault key is stored", "no-vault-key sentence");
ok(humanizeLaneReason("no-resolvable-provider").includes("built-in engine slot"), "no-resolvable-provider sentence names the builtin skip");

console.log("— resolveServerDialFromSlots per-slot semantics (r211: one canonical resolver — single-slot probes run through the same exported surface) —");
const r1 = resolveServerDialFromSlots(null);
ok(!r1.dial && r1.why === "no-vault-key", "no slots at all → no-vault-key");
const r2 = resolveServerDialFromSlots([{ provider: "builtin", key: "sk-x" }]);
ok(!r2.dial && r2.why === "no-resolvable-provider", "builtin slot → no-resolvable-provider (executor skips it)");
const r3 = resolveServerDialFromSlots([{ provider: "vyce", key: " sk-vyce-real-key-123456 " }]);
ok(!!r3.dial && r3.dial.providerLabel === "Vyce AI", "registry provider resolves with label");
ok(r3.dial?.url === "https://vyceai.com/v1/chat/completions", "dial URL pairs registry baseUrl with /chat/completions");
ok(r3.dial?.key === "sk-vyce-real-key-123456", "key trimmed, never reformatted");
ok(!!r3.dial && r3.slot.provider === "vyce", "chosen slot rides the dial (mask knows exactly which key)");

console.log("— r210: pickExecutorSlot (card ⇄ executor dial parity) —");
// The card wires providerById as isResolvable; the QA wires fixture booleans.
const slot = (provider: string, createdAt: string, maskedKey: string | null = "sk-x") => ({ provider, createdAt, maskedKey });
const resolveVyce = (p: string) => p === "vyce";
ok(
  pickExecutorSlot([slot("vyce", "2026-01-02"), slot("builtin", "2026-01-01")], resolveVyce)?.provider === "vyce",
  "builtin OLDEST is skipped — the newer resolvable slot is the dial slot (r207 parity)",
);
ok(
  pickExecutorSlot([slot("vyce", "2026-01-01"), slot("vyce", "2026-01-02")], resolveVyce)?.createdAt === "2026-01-01",
  "oldest RESOLVABLE slot wins (input order irrelevant — sorted internally)",
);
ok(
  pickExecutorSlot([slot("vyce", "2026-01-01", null), slot("vyce", "2026-01-02", "sk-x")], resolveVyce)?.createdAt === "2026-01-02",
  "keyless slot skipped, scan continues (mirrors resolveServerDialFromSlots)",
);
ok(
  pickExecutorSlot([slot("builtin", "2026-01-01", "sk-x")], resolveVyce) === null,
  "no resolvable slot → null (honest empty answer, no guess)",
);
ok(
  pickExecutorSlot([], resolveVyce) === null,
  "empty vault → null",
);
// Cross-check against the executor's own resolver on the same fixture:
const parity = resolveServerDialFromSlots([
  { provider: "builtin", key: "sk-legacy" },
  { provider: "vyce", key: "sk-new" },
]);
ok(
  parity.dial !== null && parity.slot.provider === pickExecutorSlot([
    slot("vyce", "2026-01-02", "sk-new"), slot("builtin", "2026-01-01", "sk-legacy"),
  ], resolveVyce)?.provider,
  "pickExecutorSlot picks the SAME provider resolveServerDialFromSlots dials (parity)",
);

console.log("— r210: fmtSlotAge —");
ok(fmtSlotAge(new Date(now - 5_000).toISOString(), now) === "just now", "age: <60s → just now");
ok(fmtSlotAge(new Date(now - 5 * 60_000).toISOString(), now) === "5m ago", "age: minutes");
ok(fmtSlotAge(new Date(now - 3 * HOUR).toISOString(), now) === "3h ago", "age: hours");
ok(fmtSlotAge(new Date(now - 2 * 24 * HOUR).toISOString(), now) === "2d ago", "age: days");
ok(fmtSlotAge(new Date(now + HOUR).toISOString(), now) === "just now", "future timestamp (clock skew) → just now, never negative");

console.log("— live route contract (self-restoring) —");
const db = new PrismaClient();
const BASE = process.env.BASE_URL || "http://localhost:3000";
const addedProviders: string[] = [];
let restoreFn: (() => Promise<void>) | null = null;

async function getSync(): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/api/automation/sync`, { cache: "no-store" });
  if (!res.ok) throw new Error(`sync GET → ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

try {
  // Snapshot, then DEFER every enabled registry row so the live executor's
  // 15s tick can never claim a due row against a seeded test key.
  const vaultSnap = await db.automationVault.findMany();
  const enabledSnap = await db.automationWorkflow.findMany({ where: { enabled: true } });
  for (const row of enabledSnap) {
    await db.automationWorkflow.update({ where: { id: row.id }, data: { enabled: false } });
  }

  const restore = async () => {
    for (const provider of addedProviders) {
      await db.automationVault.deleteMany({ where: { provider } });
    }
    for (const row of vaultSnap) {
      await db.automationVault.upsert({
        where: { provider: row.provider },
        create: { provider: row.provider, key: row.key, label: row.label },
        update: { key: row.key, label: row.label },
      });
    }
    for (const row of enabledSnap) {
      await db.automationWorkflow.update({
        where: { id: row.id },
        data: { enabled: true, nextRunAt: row.nextRunAt, failStreak: row.failStreak },
      });
    }
  };
  restoreFn = restore;

  // Shape 1: empty vault → honest no-op lane.
  await db.automationVault.deleteMany();
  const s1 = (await getSync()) as { executorLane?: ExecutorLaneState; vaultLane?: { hasKey: boolean } };
  ok(s1.executorLane?.ready === false && s1.executorLane.reason === "no-vault-key", "empty vault → executorLane {ready:false, no-vault-key}");
  ok(s1.executorLane?.maskedKey === null && s1.executorLane?.slotProvider === null, "empty vault → no masked key, no slot provider");
  ok(s1.vaultLane?.hasKey === false, "legacy vaultLane still reported (compat)");

  // Shape 2: builtin-only slot → the executor skips it, and the route says so.
  // r326 incident guard (inline — bun/TS): refuse to seed+destroy vault
  // slots when a real user vault is populated. The 2026-10-07 wipe of the
  // user's live Vyce slot happened exactly this way (upsert overwrote it).
  const guardRes = await fetch(`${BASE}/api/vault`);
  const guardJson = (await guardRes.json().catch(() => null)) as { vault?: unknown[] } | null;
  const slotCount = Array.isArray(guardJson?.vault) ? guardJson.vault.length : -1;
  if (slotCount !== 0) {
    console.error(
      `[qa-guard] qa-automation-lane: ABORT — /api/vault holds ` +
        `${slotCount >= 0 ? slotCount : "an unreadable number of"} slot(s); ` +
        `seeding would DESTROY user keys (the r326 incident).`
    );
    process.exit(2);
  }
  ok(true, "qa-guard: vault empty — safe to seed");
  const postRes = await fetch(`${BASE}/api/vault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "builtin", key: "sk-builtin-lane-qa-1234567890" }),
  });
  const posted = (await postRes.json()) as { ok?: boolean };
  ok(posted.ok === true, "seed builtin vault slot via POST /api/vault");
  const s2 = (await getSync()) as { executorLane?: ExecutorLaneState; vaultLane?: { hasKey: boolean } };
  ok(s2.executorLane?.ready === false && s2.executorLane.reason === "no-resolvable-provider" && s2.executorLane.slotProvider === "builtin", "builtin-only vault → executorLane {ready:false, no-resolvable-provider, slotProvider:'builtin'}");
  ok(s2.vaultLane?.hasKey === true, "legacy vaultLane sees the builtin slot the executor skips — the exact r204 mismatch");
  await db.automationVault.deleteMany({ where: { provider: "builtin" } });

  // Shape 3: registry-provider slot → ready, labeled, masked, no raw leak.
  const testKey = "sk-vyce-lane-qa-9876543210abcdef";
  addedProviders.push("vyce");
  await fetch(`${BASE}/api/vault`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "vyce", key: testKey }),
  });
  const s3 = (await getSync()) as { executorLane?: ExecutorLaneState; registry?: unknown[]; runs?: unknown[]; serverDriving?: boolean };
  ok(s3.executorLane?.ready === true && s3.executorLane.providerLabel === "Vyce AI", "registry-provider slot → executorLane {ready:true, providerLabel:'Vyce AI'}");
  ok(typeof s3.executorLane?.maskedKey === "string" && s3.executorLane.maskedKey.includes("••••") && !s3.executorLane.maskedKey.includes(testKey), "masked preview only");
  ok(Array.isArray(s3.registry) && Array.isArray(s3.runs) && typeof s3.serverDriving === "boolean", "sync GET shape intact (registry/runs/serverDriving)");
  const raw = JSON.stringify(s3);
  ok(!raw.includes(testKey), "no raw key anywhere in the sync response");

  // r210: the vault GET now ships createdAt (dial-order input) — the card
  // needs it to mark which slot the executor dials first; never the raw key.
  const vaultRes = await fetch(`${BASE}/api/vault`, { cache: "no-store" });
  const vaultJson = (await vaultRes.json()) as {
    vault?: { provider: string; maskedKey: string; createdAt?: string; updatedAt?: string }[];
  };
  const vyceRow = (vaultJson.vault ?? []).find((r) => r.provider === "vyce");
  ok(
    !!vyceRow && typeof vyceRow.createdAt === "string" && !Number.isNaN(new Date(vyceRow.createdAt).getTime()),
    "vault GET ships createdAt per slot (r210 dial-order input)",
  );
  ok(
    !!vaultJson.vault && !JSON.stringify(vaultJson).includes(testKey),
    "vault GET still never leaks the raw key",
  );

} catch (e) {
  ok(false, `route QA threw: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (restoreFn) {
    await restoreFn();
    console.log("  (state restored: vault rows + enabled registry rows byte-for-byte)");
  }
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(`SUMMARY: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
