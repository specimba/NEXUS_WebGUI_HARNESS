// ─── r204: the missing server executor (Local Automation Vault epic) ─────────
// The v20 layer (registry routes, ServerAutopilot panel, automation-bridge
// push) has existed for months, but NOTHING claimed due AutomationWorkflow
// rows — closed-tab schedules were dead and run-now just moved nextRunAt for
// a scheduler that never existed. This module is that scheduler.
//
// Contract (BYOK-preserving, per the epic doctrine):
//   • The claim loop STANDS DOWN while the open tab's heartbeat is fresh —
//     the client lane drives with keys that never leave the browser.
//   • Only when the heartbeat is STALE (>120s = tab closed) does the server
//     claim due rows, and it dials exclusively with an OPT-IN key from the
//     local AutomationVault table (local SQLite, never leaves this machine).
//     No vault key = honest no-op, never a shared/implicit credential.
//   • The "builtin" vault slot has no server-side endpoint pairing (the
//     built-in SDK's gateway is client-side knowledge), so the executor v1
//     dials only through a REAL registry provider (providerById) — the
//     builtin slot is skipped with an explicit reason, not guessed.
//   • r319: on a 429 from the vault dial, a step may fall back to a REGISTRY
//     no-key free lane (keyless by doctrine — no credential involved; the
//     server-side mirror of the browser lane's r318 rotation). Before this
//     the server lane had NO rotation at all: a saturated vault provider
//     meant every tab-closed run died on the same quota bucket.
//
// Everything here is exported so scripts/qa-automation-executor.ts can drive
// tickOnce() directly against the real database — the loop is just wiring.

import { db } from "@/lib/db";
import {
  FREE_PROVIDERS,
  providerById,
  providerBaseUrl,
} from "@/lib/providers";
import {
  noteProvider429,
  provider429CooldownLeftMs,
  resetProvider429,
} from "@/lib/provider-rotation";

export const CLAIM_INTERVAL_MS = 15_000;
export const HEARTBEAT_STALE_MS = 120_000;
/** r171 parity: 3 consecutive failures park the schedule (client breaker). */
export const BREAKER_LIMIT = 3;
const DIAL_TIMEOUT_MS = 90_000;

interface VaultStep {
  label: string;
  agentName?: string;
  prompt: string;
}

export interface TickResult {
  claimed: number;
  /** Why nothing was claimed (only when claimed === 0). */
  reason?: "client-alive" | "no-vault-key" | "no-resolvable-provider" | "idle";
  workflowIds: string[];
  /** Present when claimed === 1 — the run outcome for QA/panel reads. */
  outcome?: { runId: string; status: "done" | "error" };
}

interface ResolvedDial {
  url: string;
  key: string;
  model: string;
  providerLabel: string;
}

/**
 * r211: module-private single-slot probe — the per-slot semantics live here so
 * there is exactly ONE dial resolver. Until r211 this logic was ALSO exported
 * as resolveServerDial, giving dial semantics two surfaces that could drift;
 * the exported surface is now resolveServerDialFromSlots alone (the lane QA
 * exercises per-slot semantics through 1-element scans).
 *
 * Returns null (with a machine-readable reason in `why`) when the slot's
 * opt-in key cannot be paired with a real registry endpoint — the executor
 * never invents endpoints or falls back to implicit credentials.
 */
function probeSlotDial(
  vaultEntry: { provider: string; key: string } | null,
): { dial: ResolvedDial } | { dial: null; why: "no-vault-key" | "no-resolvable-provider" } {
  if (!vaultEntry || !vaultEntry.key.trim()) return { dial: null, why: "no-vault-key" };
  const reg = providerById(vaultEntry.provider);
  if (!reg) return { dial: null, why: "no-resolvable-provider" }; // "builtin" or unknown id
  // registry models are ProviderModel objects — the dial needs the raw id
  const firstModel = Array.isArray(reg.models) ? reg.models[0] : undefined;
  const model =
    typeof firstModel === "string"
      ? firstModel
      : ((firstModel as { id?: string } | undefined)?.id ?? "");
  if (!reg.baseUrl && !providerBaseUrl(reg)) return { dial: null, why: "no-resolvable-provider" };
  return {
    dial: {
      url: `${providerBaseUrl(reg).replace(/\/$/, "")}/chat/completions`,
      key: vaultEntry.key.trim(),
      model,
      providerLabel: reg.name,
    },
  };
}

/**
 * THE canonical server-lane resolver (r211: the single-slot probe above is
 * folded in as a private helper — one exported surface, no drift possible).
 * r207: resolve the dial from ALL vault slots, oldest first — the first slot
 * that RESOLVES wins. Before this, tickOnce() read only the single oldest
 * slot, so a legacy builtin slot poisoned the lane even when a perfectly
 * good registry-provider key sat right next to it (the user had to DELETE
 * the old slot to promote the new one — a blunt rule the vault card had to
 * apologize for). Unresolvable slots are now skipped, not fatal.
 *
 * Reason aggregation stays honest:
 *   • no slots, or every key empty            → "no-vault-key"
 *   • keys exist but none pairs with registry → "no-resolvable-provider"
 * The chosen slot is returned with the dial so the sync-GET lane mirror can
 * mask exactly the key the executor would use (no index guessing).
 */
export type SlotRef = { provider: string; key: string };
export function resolveServerDialFromSlots(
  slots: SlotRef[] | null,
): { dial: ResolvedDial; slot: SlotRef } | { dial: null; why: "no-vault-key" | "no-resolvable-provider" } {
  const list = Array.isArray(slots) ? slots : [];
  let sawKey = false;
  for (const slot of list) {
    if (!slot.key.trim()) continue; // empty slot: skip, keep scanning
    sawKey = true;
    const resolved = probeSlotDial(slot);
    if (resolved.dial) return { dial: resolved.dial, slot };
  }
  return { dial: null, why: sawKey ? "no-resolvable-provider" : "no-vault-key" };
}

/** r319: server-side mirror of the browser lane's free-lane rotation (r318).
 * Tries up to two no-key registry lanes that are not in their 429 cooldown
 * and whose endpoint differs from the dial that just got rate-limited. A
 * failed fallback is noted (exponential cooldown, this process's memory)
 * and the scan continues; null = no lane answered (caller throws the
 * ORIGINAL 429 error — honest failure, never a fabricated result). */
const FREE_LANE_FALLBACKS = 2;
async function dialNoKeyFallback(
  prompt: string,
  failedUrl: string,
): Promise<string | null> {
  let failedOrigin = "";
  try {
    failedOrigin = new URL(failedUrl).origin;
  } catch {
    /* malformed url — skip the origin guard */
  }
  let tried = 0;
  for (const reg of FREE_PROVIDERS) {
    if (tried >= FREE_LANE_FALLBACKS) break;
    if (reg.noKey !== true) continue;
    if (provider429CooldownLeftMs(reg.id) > 0) continue;
    const baseUrl = providerBaseUrl(reg);
    if (!baseUrl) continue;
    try {
      if (failedOrigin && new URL(baseUrl).origin === failedOrigin) continue;
    } catch {
      continue;
    }
    const firstModel = Array.isArray(reg.models) ? reg.models[0] : undefined;
    const model =
      typeof firstModel === "string"
        ? firstModel
        : ((firstModel as { id?: string } | undefined)?.id ?? "");
    if (!model) continue;
    tried += 1;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), DIAL_TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                "You are executing one step of a scheduled automation pipeline. Answer the step prompt directly and concisely.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 2000,
          temperature: 0.7,
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        await res.text().catch(() => "");
        noteProvider429(reg.id);
        continue;
      }
      const j = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = j.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        noteProvider429(reg.id);
        continue;
      }
      resetProvider429(reg.id);
      return text;
    } catch {
      noteProvider429(reg.id);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** One non-streaming OpenAI-compatible chat completion for a single step. */
export async function dialStep(dial: ResolvedDial, prompt: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DIAL_TIMEOUT_MS);
  try {
    const res = await fetch(dial.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${dial.key}`,
      },
      body: JSON.stringify({
        model: dial.model,
        messages: [
          {
            role: "system",
            content:
              "You are executing one step of a scheduled automation pipeline. Answer the step prompt directly and concisely.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // r319: a 429 on the vault dial used to be a dead end — the server
      // lane had NO rotation (witnessed: tab-closed server runs 0✓ 2✗ on a
      // saturated provider). Try the no-key free lanes before throwing.
      if (res.status === 429) {
        const fallback = await dialNoKeyFallback(prompt, dial.url);
        if (fallback !== null) return fallback;
      }
      throw new Error(`dial ${res.status}: ${body.slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("dial returned empty completion");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** Execute one claimed workflow end-to-end with honest run bookkeeping. */
export async function executeWorkflow(
  wf: { id: string; name: string; task: string; stepsJson: string; intervalMs: number },
  dial: ResolvedDial,
): Promise<{ runId: string; status: "done" | "error" }> {
  let steps: VaultStep[] = [];
  try {
    const parsed = JSON.parse(wf.stepsJson) as VaultStep[];
    if (Array.isArray(parsed)) steps = parsed;
  } catch {
    /* corrupt stepsJson → runs as one prompt below */
  }
  if (steps.length === 0 && wf.task.trim()) {
    steps = [{ label: "Run task", prompt: wf.task }];
  }

  const run = await db.automationRun.create({
    data: {
      workflowId: wf.id,
      workflowName: wf.name,
      trigger: "schedule",
      status: "running",
      stepsTotal: steps.length,
      stepsJson: "[]",
    },
  });

  const outputs: { label: string; output: string; ms: number; ok: boolean }[] = [];
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const t0 = Date.now();
      try {
        const output = await dialStep(dial, step.prompt || step.label);
        outputs.push({ label: step.label, output, ms: Date.now() - t0, ok: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outputs.push({
          label: step.label,
          output: `step failed: ${message}`,
          ms: Date.now() - t0,
          ok: false,
        });
        throw Object.assign(new Error(`step ${i + 1}/${steps.length} "${step.label}" failed: ${message}`), {
          stepIndex: i,
        });
      } finally {
        // Progress writes land even on the failing step — the panel shows
        // exactly where a dead run stopped (r80 honesty, server lane).
        await db.automationRun.update({
          where: { id: run.id },
          data: { currentStep: i + 1, stepsJson: JSON.stringify(outputs) },
        });
      }
    }
    const report = outputs.map((o) => `## ${o.label}\n${o.output}`).join("\n\n");
    await db.automationRun.update({
      where: { id: run.id },
      data: { status: "done", finalReport: report, finishedAt: new Date() },
    });
    await db.automationWorkflow.update({
      where: { id: wf.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: new Date(Date.now() + wf.intervalMs),
        failStreak: 0,
      },
    });
    return { runId: run.id, status: "done" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.automationRun.update({
      where: { id: run.id },
      data: { status: "error", error: message, finishedAt: new Date() },
    });
    // Breaker parity with the client lane (r171): at BREAKER_LIMIT the
    // schedule parks itself instead of burning the vault key on a dead lane.
    const streak = (await db.automationWorkflow.findUnique({ where: { id: wf.id } }))?.failStreak ?? 0;
    const nextStreak = streak + 1;
    await db.automationWorkflow.update({
      where: { id: wf.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: new Date(Date.now() + wf.intervalMs),
        failStreak: nextStreak,
        ...(nextStreak >= BREAKER_LIMIT ? { enabled: false } : {}),
      },
    });
    return { runId: run.id, status: "error" };
  }
}

/**
 * One claim tick: stand down on a fresh heartbeat, else claim and execute
 * at most ONE due workflow per tick (bounded latency, no thundering herd).
 */
export async function tickOnce(now = new Date()): Promise<TickResult> {
  const state = await db.automationState.findUnique({ where: { id: "singleton" } });
  if (state && now.getTime() - state.lastSeenAt.getTime() < HEARTBEAT_STALE_MS) {
    return { claimed: 0, reason: "client-alive", workflowIds: [] };
  }

  const due = await db.automationWorkflow.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: 1,
  });
  if (due.length === 0) return { claimed: 0, reason: "idle", workflowIds: [] };

  // r207: ALL slots, oldest first — first RESOLVABLE one wins (a legacy
  // builtin slot no longer blocks a newer registry-provider key).
  const vaultSlots = await db.automationVault.findMany({ orderBy: { createdAt: "asc" } });
  const resolved = resolveServerDialFromSlots(
    vaultSlots.map((s) => ({ provider: s.provider, key: s.key })),
  );
  if (!resolved.dial) return { claimed: 0, reason: resolved.why, workflowIds: [] };

  const wf = due[0];
  const outcome = await executeWorkflow(
    {
      id: wf.id,
      name: wf.name,
      task: wf.task,
      stepsJson: wf.stepsJson,
      intervalMs: wf.intervalMs,
    },
    resolved.dial,
  );
  return { claimed: 1, workflowIds: [wf.id], outcome };
}

/** Boot the interval loop exactly once per server process (HMR-safe). */
export function startAutomationExecutor(): void {
  const g = globalThis as unknown as { __automationExecutor?: NodeJS.Timeout };
  if (g.__automationExecutor) return;
  g.__automationExecutor = setInterval(() => {
    void tickOnce().catch((err) => {
      console.error("[automation-executor] tick failed:", err instanceof Error ? err.message : err);
    });
  }, CLAIM_INTERVAL_MS);
  console.info("[automation-executor] claim loop started (15s tick, stands down while the tab heartbeat is fresh)");
}
