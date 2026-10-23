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
  clearRescueLane,
  liveRescueLaneId,
  noteProvider429,
  noteProviderBilling,
  noteRescueLane,
  provider429CooldownLeftMs,
  providerBillingDeadLeftMs,
  resetProvider429,
} from "@/lib/provider-rotation";
import { egressRelayDial } from "@/lib/server/egress";

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
  reason?:
    | "client-alive"
    | "no-vault-key"
    | "no-resolvable-provider"
    | "billing-quarantined"
    | "idle"
    /** r443: an overlap guard no-op — the previous tick's pipeline is still running. */
    | "tick-already-running";
  workflowIds: string[];
  /** Present when claimed === 1 — the run outcome for QA/panel reads. */
  outcome?: { runId: string; status: "done" | "error" };
}

interface ResolvedDial {
  url: string;
  key: string;
  model: string;
  providerLabel: string;
  /** r333: the machine id the rotation memories key on — without it the
   * server lane could not mirror the r332 billing quarantine (the browser
   * runner has had this since r305's rotation work). */
  providerId: string;
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
      providerId: reg.id,
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
 *   • keys pair but every provider is billing-quarantined → "billing-quarantined"
 * The chosen slot is returned with the dial so the sync-GET lane mirror can
 * mask exactly the key the executor would use (no index guessing).
 */
export type SlotRef = { provider: string; key: string };
export function resolveServerDialFromSlots(
  slots: SlotRef[] | null,
):
  | { dial: ResolvedDial; slot: SlotRef }
  | {
      dial: null;
      why: "no-vault-key" | "no-resolvable-provider" | "billing-quarantined";
    } {
  const list = Array.isArray(slots) ? slots : [];
  let sawKey = false;
  let sawQuarantined = false;
  // r509: 429-cooling slots no longer win the oldest-first scan. The vault
  // went 1 → 17 slots this round (owner's full provider fleet synced), and
  // the strict oldest-first rule kept handing the tick to a Vyce slot that
  // was mid-cooldown from its own last 429 — the exact corpse-dialing the
  // browser lane's dock/rotate stack abolished. Two passes: first READY
  // slot (oldest first) wins; when every keyed slot is cooling, the
  // SOONEST-ready one is returned so the tick still dials the least-bad
  // lane instead of nothing (a cooldown is a heuristic, not a wall).
  let soonest: { dial: ResolvedDial; slot: SlotRef; left: number } | null = null;
  for (const slot of list) {
    if (!slot.key.trim()) continue; // empty slot: skip, keep scanning
    sawKey = true;
    const resolved = probeSlotDial(slot);
    if (!resolved.dial) continue; // unresolvable: skip, keep scanning
    // r333: a billing-quarantined provider (wallet drained — the r332
    // memory) is a known corpse: scan past it exactly like an unresolvable
    // slot instead of dialing it once per tick. The tick's own dial still
    // NOTES new billing deaths (dialStep), so the loop is: first billing
    // failure quarantines, every later tick skips. When EVERY keyed slot
    // is a corpse the reason says so honestly — the key exists, its lane
    // is just known-dead.
    if (providerBillingDeadLeftMs(resolved.dial.providerId) > 0) {
      sawQuarantined = true;
      continue;
    }
    const left = provider429CooldownLeftMs(resolved.dial.providerId);
    if (left <= 0) return { dial: resolved.dial, slot };
    if (!soonest || left < soonest.left) soonest = { dial: resolved.dial, slot, left };
  }
  if (soonest) return { dial: soonest.dial, slot: soonest.slot };
  return {
    dial: null,
    why: sawKey ? (sawQuarantined ? "billing-quarantined" : "no-resolvable-provider") : "no-vault-key",
  };
}

/** r319: server-side mirror of the browser lane's free-lane rotation (r318).
 * Tries up to two no-key registry lanes that are not in their 429 cooldown
 * and whose endpoint differs from the dial that just got rate-limited. A
 * failed fallback is noted (exponential cooldown, this process's memory)
 * and the scan continues; null = no lane answered (caller throws the
 * ORIGINAL 429 error — honest failure, never a fabricated result).
 *
 * r438: the lane that JUST answered (a live rescue lane, r437 memory) leads
 * the walk — the last lane that worked beats the first lane in a list. A
 * full successful fallback dial notes the rescue lane; a failed one clears
 * it (matching id only), so the proof is spent exactly when the lane dies. */
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
  // r438: a live rescue lane (a no-key lane that fully answered a recent
  // congested dial) leads the candidate order; everything else keeps
  // registry order. All guards below apply to it like any other lane.
  const rescueId = liveRescueLaneId();
  const ordered = rescueId
    ? [
        ...FREE_PROVIDERS.filter((r) => r.id === rescueId),
        ...FREE_PROVIDERS.filter((r) => r.id !== rescueId),
      ]
    : FREE_PROVIDERS;
  let tried = 0;
  for (const reg of ordered) {
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
      const res = await egressRelayDial(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
        clearRescueLane(reg.id);
        continue;
      }
      const j = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = j.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        noteProvider429(reg.id);
        clearRescueLane(reg.id);
        continue;
      }
      resetProvider429(reg.id);
      // r438: a full successful fallback answer is the rescue-memory trigger
      // — this lane leads the next congested dial's walk until it fails or
      // the 15m TTL lapses (server mirror of the runner's r437 success hook).
      noteRescueLane(reg.id);
      return text;
    } catch {
      noteProvider429(reg.id);
      clearRescueLane(reg.id);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** One non-streaming OpenAI-compatible chat completion for a single step. */
// r333: billing-body signatures — the server mirror of the r332 runner/
// engine patterns (402 status handled separately above). Vyce's 403-wrapped
// "balance is insufficient" + "please recharge" phrasing is the witnessed shape.
const BILLING_BODY_RE =
  /out of credits|insufficient (?:credits?|balance|funds)|(?:credits?|balance|funds) (?:is|are) insufficient|please recharge|credit.?gate|add credits|payment required/i;

export async function dialStep(dial: ResolvedDial, prompt: string): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DIAL_TIMEOUT_MS);
  let res: Response;
  try {
    // r514: the server-lane dial rides the egress layer (per-upstream routing;
    // no token stored = byte-identical plain fetch). A typed EgressDialError
    // (pool armed but broken) rethrows honestly below — never masked as a
    // timeout, so the congestion memory is not fed a false lane death.
    res = await egressRelayDial(dial.url, {
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
  } catch (err) {
    // r505: a SILENT vault provider (the Vyce-class outage: connection
    // accepted, no bytes for the whole 90s budget, 0% success) used to be a
    // dead end — only a 429 walked the no-key free-lane fallback (r319), so
    // a hang failed the step outright. A timeout IS a lane death: note the
    // provider's congestion memory, spend the matching rescue proof, and
    // walk the free lanes before surfacing — same doctrine as the 429 path.
    if (ac.signal.aborted) {
      if (dial.providerId) {
        noteProvider429(dial.providerId);
        clearRescueLane(dial.providerId);
      }
      const fallback = await dialNoKeyFallback(prompt, dial.url);
      if (fallback !== null) return fallback;
      throw new Error(
        `dial timed out after ${Math.round(DIAL_TIMEOUT_MS / 1000)}s (provider silent) — no-key free-lane fallback also exhausted`
      );
    }
    throw err;
  }
  try {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // r319: a 429 on the vault dial used to be a dead end — the server
      // lane had NO rotation (witnessed: tab-closed server runs 0✓ 2✗ on a
      // saturated provider). Try the no-key free lanes before throwing.
      if (res.status === 429) {
        // r333: note the vault provider's own congestion BEFORE rotating —
        // the browser runner has noted its pre-stream 429s since r306; the
        // server lane fed only the FALLBACK lanes' memory, so a saturated
        // vault provider was re-dialed first every tick.
        if (dial.providerId) {
          noteProvider429(dial.providerId);
          // r438: the dial's lane just failed — if it WAS the rescue lane,
          // its proof is spent (matching id only; an unrelated lane's
          // failure never erases another lane's evidence).
          clearRescueLane(dial.providerId);
        }
        const fallback = await dialNoKeyFallback(prompt, dial.url);
        if (fallback !== null) return fallback;
      }
      // r333: mirror the r332 browser-side billing quarantine — Vyce
      // phrases a drained wallet on a 403 ("Your account balance is
      // insufficient. Please recharge…"); a 402 is the classic shape.
      // Without this the server lane corpse-dialed the empty wallet once
      // per tick until the breaker parked the schedule.
      if (
        dial.providerId &&
        (res.status === 402 ||
          BILLING_BODY_RE.test(body))
      ) {
        noteProviderBilling(dial.providerId);
      }
      // r438: a non-429 failure of the dial's lane (billing, 5xx, …) spends
      // a matching rescue proof the same way a 429 does.
      if (dial.providerId) clearRescueLane(dial.providerId);
      throw new Error(`dial ${res.status}: ${body.slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = j.choices?.[0]?.message?.content?.trim();
    if (!text) {
      // r438: an empty completion is a lane failure — spend a matching
      // rescue proof here too (non-abort failure semantics, r437 parity).
      if (dial.providerId) clearRescueLane(dial.providerId);
      throw new Error("dial returned empty completion");
    }
    // r333: a proven-healthy vault dial clears the lane's memories — the
    // top-up self-heal (billing quarantine lifted on first success), same
    // semantics as the browser runner's resetProvider429.
    if (dial.providerId) resetProvider429(dial.providerId);
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
        nextRunAt: new Date(Date.now() + wf.intervalMs + scheduleStaggerMs(wf.id, wf.intervalMs)),
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
        nextRunAt: new Date(Date.now() + wf.intervalMs + scheduleStaggerMs(wf.id, wf.intervalMs)),
        failStreak: nextStreak,
        ...(nextStreak >= BREAKER_LIMIT ? { enabled: false } : {}),
      },
    });
    return { runId: run.id, status: "error" };
  }
}

// ─── r442: deterministic fire stagger (server lane) ───────────────────────
// Schedules enabled in the same minute re-arm collinearly forever —
// `nextRunAt = now + intervalMs` preserves the phase, so N same-minute
// schedules collide EVERY interval ("4 schedules firing within minutes" is
// the exact congestion that parked the evening runs, r437 forensics). A
// stable per-id offset spreads the first fire AND every re-arm across a
// small window WITHOUT re-randomizing between fires (each workflow's phase
// stays predictable; the board's next-fire times show it). Capped at 20% of
// the interval — the r171 browser-lane doctrine ("an unjittered re-fire
// stays collinear"), server-lane half.
const STAGGER_WINDOW_MS = 90_000;

export function scheduleStaggerMs(id: string, intervalMs: number): number {
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const windowMs = Math.min(STAGGER_WINDOW_MS, Math.max(1, Math.floor(intervalMs * 0.2)));
  return (h >>> 0) % windowMs;
}

/**
 * One claim tick: stand down on a fresh heartbeat, else claim and execute
 * at most ONE due workflow per tick (bounded latency, no thundering herd).
 * r443: the "one per tick" contract was fiction under overlap — the loop
 * fires `void tickOnce()` every 15s while a tick AWAITS THE WHOLE PIPELINE
 * (runs take minutes), so every 15s a new overlapping tick re-read the same
 * still-overdue due[0] (nextRunAt only updates at completion) and launched
 * ANOTHER concurrent copy of the same workflow. The in-flight guard makes
 * overlapping ticks honest no-ops; the cadence still claims the NEXT
 * overdue workflow the moment the current run settles.
 */
let tickInFlight = false;

export async function tickOnce(now = new Date()): Promise<TickResult> {
  if (tickInFlight) return { claimed: 0, reason: "tick-already-running", workflowIds: [] };
  tickInFlight = true;
  try {
    return await tickOnceInner(now);
  } finally {
    tickInFlight = false;
  }
}

async function tickOnceInner(now: Date): Promise<TickResult> {
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
