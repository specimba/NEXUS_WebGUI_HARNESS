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
import { redactDialBody } from "@/lib/redaction";
import {
  isAnthropicStyleEndpoint,
  anthropicDialectUrl,
  anthropicAuthHeaders,
  openaiBodyToAnthropic,
  anthropicResponseToHouse,
} from "@/lib/anthropic-dialect";
import { decryptVaultKey } from "@/lib/server/vault-crypto";

export const CLAIM_INTERVAL_MS = 15_000;
export const HEARTBEAT_STALE_MS = 120_000;
/** r171 parity: 3 consecutive failures park the schedule (client breaker). */
export const BREAKER_LIMIT = 3;
const DIAL_TIMEOUT_MS = 90_000;

interface VaultStep {
  label: string;
  agentName?: string;
  prompt: string;
  /** TASK-101 slice 3 (r521): the workflow-js waitForEvent shape — a step
   * that PAUSES the run until a named event lands in the automation event
   * log. All wait state persists in the run row (status "waiting" + a
   * sentinel in stepsJson), so a restart resumes the WAIT, never the step. */
  waitFor?: { event: string; timeoutMs?: number };
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
  /** Present when claimed === 1 — the run outcome for QA/panel reads.
   * r521: "waiting" joins the union — a waitForEvent step parks the run. */
  outcome?: { runId: string; status: "done" | "error" | "waiting" };
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
  // r528 TASK-102 slice 4: providers whose registry entry carries
  // dialect:"anthropic" pair an Anthropic-style /v1/messages endpoint — the
  // dial URL follows the dialect (dialStep shapes the wire accordingly).
  const dialBase = providerBaseUrl(reg).replace(/\/$/, "");
  return {
    dial: {
      url:
        reg.dialect === "anthropic"
          ? anthropicDialectUrl(dialBase) // strips a trailing /v1 — no /v1/v1
          : `${dialBase}/chat/completions`,
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
        body: JSON.stringify(
          redactDialBody({
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
        ),
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
  // r528: true when the dial rides the Anthropic /v1/messages dialect
  // (dialect:"anthropic" registry provider — vyce today).
  const anthropicLane = isAnthropicStyleEndpoint(dial.url);
  try {
    // r514: the server-lane dial rides the egress layer (per-upstream routing;
    // no token stored = byte-identical plain fetch). A typed EgressDialError
    // (pool armed but broken) rethrows honestly below — never masked as a
    // timeout, so the congestion memory is not fed a false lane death.
    // r528 TASK-102 slice 4: anthropic-dialect endpoints get x-api-key +
    // anthropic-version auth and a shaped body (system → top-level field);
    // the OpenAI dialect keeps Bearer. The redaction choke wraps EITHER
    // shape — it is dialect-agnostic by design (same r524 invariant).
    const stepSystem =
      "You are executing one step of a scheduled automation pipeline. Answer the step prompt directly and concisely.";
    res = await egressRelayDial(dial.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(anthropicLane
          ? anthropicAuthHeaders(dial.key)
          : { authorization: `Bearer ${dial.key}` }),
      },
      body: JSON.stringify(
        redactDialBody(
          anthropicLane
            ? openaiBodyToAnthropic({
                model: dial.model,
                messages: [
                  { role: "system", content: stepSystem },
                  { role: "user", content: prompt },
                ],
                max_tokens: 2000,
                temperature: 0.7,
              })
            : {
                model: dial.model,
                messages: [
                  { role: "system", content: stepSystem },
                  { role: "user", content: prompt },
                ],
                max_tokens: 2000,
                temperature: 0.7,
              },
          // the vault key rides the AUTH HEADER (untouched — the provider needs
          // it); passing it here guarantees it can never leak through the BODY
          // either, even when a workflow prompt quotes it by accident.
          dial.key ? [dial.key] : [],
        ),
      ),
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
      content?: { type?: string; text?: string }[];
    };
    // r528: the anthropic dialect answers a content-block list, not choices[].
    const text = anthropicLane
      ? anthropicResponseToHouse(j).text
      : j.choices?.[0]?.message?.content?.trim();
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

// ─── TASK-101 (r520): per-step retry — the workflow-js `retry(failedStep)` shape ───
// A transient lane death (429 storm tail, one silent hang, a 5xx blip) used
// to kill the whole multi-step run: step N failed → run error → the schedule
// waited a full interval to try again. One bounded re-attempt after a short
// backoff recovers exactly the transient class. Billing failures are EXEMPT —
// a drained wallet does not heal in 2.5s (the r333 quarantine owns that
// path), and re-dialing a corpse is the exact anti-pattern the rotation
// memories exist to prevent. The attempt trail lands in the step output so
// the run drawer shows the recovery honestly (no silent masking).
const STEP_RETRY_BACKOFF_MS = 2_500;
const BILLING_FAILURE_RE = /dial 402|please recharge|insufficient/i;

async function dialStepWithRetry(
  dial: ResolvedDial,
  prompt: string,
): Promise<{ text: string; firstFailure: string | null }> {
  try {
    return { text: await dialStep(dial, prompt), firstFailure: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (BILLING_FAILURE_RE.test(message)) throw err;
    await new Promise((resolve) => setTimeout(resolve, STEP_RETRY_BACKOFF_MS));
    // One honest re-throw if the lane is truly dead — the run still fails
    // with the SECOND failure's message (the freshest lane evidence).
    const text = await dialStep(dial, prompt);
    return { text, firstFailure: message };
  }
}

// ─── TASK-101 slice 3 (r521): the durable waitForEvent shape ────────────────
// A step may declare `waitFor: { event, timeoutMs? }`. When the executor
// arrives it checks the automation event log for that name; absent, the run
// PARKS as status "waiting" with a sentinel entry persisted in stepsJson
// (event + since + deadline) and the executor YIELDS. The claim loop
// re-evaluates the checkpoint every tick: event lands → the step completes
// with an honest "[event … received after Xs — resuming]" trail; deadline
// passes → the step fails into the normal error/breaker path. Everything
// lives in EXISTING columns (status String + stepsJson) — zero schema
// change — so a server restart resumes the WAIT, not the step.
export const AUTOMATION_EVENT_LOG_KEY = "automation.events.v1";
const EVENT_LOG_CAP = 50;
export const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;
const WAIT_MIN_TIMEOUT_MS = 30_000;

interface AutomationEventEntry {
  name: string;
  at: string; // ISO
  payload?: string;
}

export interface WaitCheckpoint {
  event: string;
  /** ISO — when the executor FIRST arrived at this step (survives restarts). */
  since: string;
  /** ISO — since + timeoutMs; past this the wait fails honestly. */
  deadline: string;
}

async function readEventLog(): Promise<AutomationEventEntry[]> {
  const row = await db.platformSetting.findUnique({ where: { id: AUTOMATION_EVENT_LOG_KEY } });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    return Array.isArray(parsed) ? (parsed as AutomationEventEntry[]) : [];
  } catch {
    return [];
  }
}

/** Emit a named event — any waiting step whose checkpoint matches resumes on
 * the next claim tick. Newest last, capped; operator-visible via
 * GET /api/automation/events. */
export async function emitAutomationEvent(name: string, payload?: string): Promise<number> {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) throw new Error("event name required");
  const log = await readEventLog();
  log.push({
    name: trimmed,
    at: new Date().toISOString(),
    ...(payload ? { payload: payload.slice(0, 500) } : {}),
  });
  const capped = log.slice(-EVENT_LOG_CAP);
  await db.platformSetting.upsert({
    where: { id: AUTOMATION_EVENT_LOG_KEY },
    create: { id: AUTOMATION_EVENT_LOG_KEY, value: JSON.stringify(capped) },
    update: { value: JSON.stringify(capped) },
  });
  return capped.length;
}

function fmtWaitDur(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.max(0, totalSeconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Shared stepsJson parser — empty array on corrupt/absent payloads. */
function parseVaultSteps(raw: string): VaultStep[] {
  try {
    const parsed = JSON.parse(raw) as VaultStep[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** r521: do steps at/after `from` include at least one DIALABLE step? Wait
 * steps never dial, so a run whose remaining steps are all waitFor steps can
 * advance (park / resume / complete) with no vault key at all. */
function remainingStepsNeedDial(steps: VaultStep[], from: number): boolean {
  return steps.some((s, idx) => idx >= from && !(s.waitFor?.event?.trim()));
}

/** Execute one claimed workflow end-to-end with honest run bookkeeping. */
export async function executeWorkflow(
  wf: { id: string; name: string; task: string; stepsJson: string; intervalMs: number },
  dial: ResolvedDial,
  resumeRunId?: string,
): Promise<{ runId: string; status: "done" | "error" | "waiting" }> {
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

  let runId: string;
  let outputs: { label: string; output: string; ms: number; ok: boolean }[] = [];
  let startIndex = 0;
  let resumeWait: WaitCheckpoint | null = null;

  const existing = resumeRunId
    ? await db.automationRun.findUnique({ where: { id: resumeRunId } })
    : null;
  if (existing) {
    // TASK-101 slice 3: resume the WAIT, never the completed work — finished
    // steps load from the persisted stepsJson (the trailing waiting sentinel
    // is stripped), the run flips back to "running", and the loop continues
    // at the wait step with the ORIGINAL since/deadline checkpoint.
    let parsed: { label: string; output: string; ms: number; ok: boolean; waiting?: WaitCheckpoint }[] = [];
    try {
      const p = JSON.parse(existing.stepsJson) as unknown;
      if (Array.isArray(p)) parsed = p as typeof parsed;
    } catch {
      /* corrupt stepsJson → remaining steps re-execute (honest) */
    }
    const trail = parsed[parsed.length - 1];
    if (trail?.waiting) resumeWait = trail.waiting;
    outputs = parsed
      .filter((e) => !(e && e.waiting))
      .map((e) => ({ label: e.label, output: e.output, ms: e.ms, ok: e.ok }));
    startIndex = Math.min(outputs.length, steps.length);
    runId = existing.id;
    await db.automationRun.update({
      where: { id: runId },
      data: { status: "running", error: null },
    });
  } else {
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
    runId = run.id;
  }

  try {
    for (let i = startIndex; i < steps.length; i++) {
      const step = steps[i];
      const t0 = Date.now();

      // ── TASK-101 slice 3: the waitForEvent step (checked BEFORE the dial —
      // a wait step never dials a provider; it either resumes, parks, or
      // times out) ──
      if (step.waitFor?.event?.trim()) {
        const eventName = step.waitFor.event.trim().slice(0, 120);
        const timeoutMs = Math.max(WAIT_MIN_TIMEOUT_MS, Number(step.waitFor.timeoutMs) || DEFAULT_WAIT_TIMEOUT_MS);
        const fresh = !(resumeWait && resumeWait.event === eventName);
        const since = fresh ? new Date().toISOString() : (resumeWait as WaitCheckpoint).since;
        const deadline = fresh
          ? new Date(Date.now() + timeoutMs).toISOString()
          : (resumeWait as WaitCheckpoint).deadline;
        const sinceMs = Date.parse(since);
        const sinceSafe = Number.isFinite(sinceMs) ? sinceMs : 0;
        const log = await readEventLog();
        const landed = log
          .filter((e) => e.name === eventName && Date.parse(e.at) >= sinceSafe)
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
        if (landed) {
          const landedMs = Date.parse(landed.at);
          const waitedS = Math.max(0, Math.round(((Number.isFinite(landedMs) ? landedMs : Date.now()) - sinceSafe) / 1000));
          outputs.push({
            label: step.label,
            output: `[event "${eventName}" received after ${fmtWaitDur(waitedS)} — resuming]${landed.payload ? `\n${landed.payload}` : ""}`,
            ms: Date.now() - t0,
            ok: true,
          });
          resumeWait = null;
          continue;
        }
        const elapsedMs = Date.now() - sinceSafe;
        if (elapsedMs >= timeoutMs) {
          outputs.push({
            label: step.label,
            output: `waited ${fmtWaitDur(Math.round(elapsedMs / 1000))} for event "${eventName}" — never arrived (timeout ${fmtWaitDur(Math.round(timeoutMs / 1000))})`,
            ms: Date.now() - t0,
            ok: false,
          });
          await db.automationRun.update({
            where: { id: runId },
            data: { currentStep: i + 1, stepsJson: JSON.stringify(outputs) },
          });
          throw new Error(
            `step ${i + 1}/${steps.length} "${step.label}" timed out waiting for event "${eventName}" (${fmtWaitDur(Math.round(timeoutMs / 1000))} budget)`
          );
        }
        // Still waiting: persist the sentinel + flip to "waiting" and YIELD
        // the run. nextRunAt stays untouched (r520 contract) so the claim
        // loop re-evaluates the wait every tick — a restart resumes the WAIT,
        // not the step (the sentinel IS the durable checkpoint).
        await db.automationRun.update({
          where: { id: runId },
          data: {
            status: "waiting",
            currentStep: i + 1,
            stepsJson: JSON.stringify([
              ...outputs,
              {
                label: step.label,
                output: `[waiting for event "${eventName}" — ${fmtWaitDur(Math.max(0, Math.round(elapsedMs / 1000)))} elapsed / ${fmtWaitDur(Math.round(timeoutMs / 1000))} budget]`,
                ms: Math.max(0, elapsedMs),
                ok: true,
                waiting: { event: eventName, since, deadline } satisfies WaitCheckpoint,
              },
            ]),
          },
        });
        return { runId, status: "waiting" };
      }

      try {
        const { text, firstFailure } = await dialStepWithRetry(dial, step.prompt || step.label);
        // TASK-101: a recovered step is still a succeeded step (ok:true — the
        // stats stay honest), but the drawer sees the save explicitly.
        const output = firstFailure
          ? `[recovered on attempt 2 — attempt 1 failed: ${firstFailure.slice(0, 160)}]\n\n${text}`
          : text;
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
          where: { id: runId },
          data: { currentStep: i + 1, stepsJson: JSON.stringify(outputs) },
        });
      }
    }
    const report = outputs.map((o) => `## ${o.label}\n${o.output}`).join("\n\n");
    await db.automationRun.update({
      where: { id: runId },
      // r521: stepsJson is rewritten on completion too — a resumed run's
      // stale waiting sentinel must never outlive the run it belonged to.
      data: { status: "done", finalReport: report, finishedAt: new Date(), stepsJson: JSON.stringify(outputs) },
    });
    await db.automationWorkflow.update({
      where: { id: wf.id },
      data: {
        lastRunAt: new Date(),
        nextRunAt: new Date(Date.now() + wf.intervalMs + scheduleStaggerMs(wf.id, wf.intervalMs)),
        failStreak: 0,
      },
    });
    return { runId, status: "done" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.automationRun.update({
      where: { id: runId },
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
    return { runId, status: "error" };
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

  // ── TASK-101 slice 3 (r521): the wait sweep ──
  // A run parked "waiting" owns the tick: re-evaluate its checkpoint (event
  // landed? deadline passed?) and resume it; only when the wait cannot
  // advance does the tick fall through to fresh claims. Workflows with a
  // waiting run are excluded from the claim below — their wait IS their due
  // work (a duplicate fresh run would double-execute the pipeline).
  const waitingRuns = await db.automationRun.findMany({
    where: { status: "waiting" },
    orderBy: { startedAt: "asc" },
  });
  const waitingWfIds = new Set(waitingRuns.map((r) => r.workflowId));
  if (waitingRuns.length > 0) {
    const waitingRun = waitingRuns[0];
    const wfRow = await db.automationWorkflow.findUnique({ where: { id: waitingRun.workflowId } });
    if (!wfRow) {
      await db.automationRun.update({
        where: { id: waitingRun.id },
        data: {
          status: "error",
          error: "workflow deleted while the run was waiting for an event",
          finishedAt: new Date(),
        },
      });
    } else {
      // TASK-101 slice 3: a wait-only resume needs NO provider dial — wait
      // steps short-circuit before any dial is read. A keyless vault (the
      // sandbox DB-rollback reality) must not deadlock a run whose remaining
      // steps only need their event checkpoint evaluated.
      const steps = parseVaultSteps(wfRow.stepsJson);
      const doneCount = (() => {
        try {
          const parsed = JSON.parse(waitingRun.stepsJson) as { waiting?: unknown }[];
          return Array.isArray(parsed) ? parsed.filter((e) => !(e && e.waiting)).length : 0;
        } catch {
          return 0;
        }
      })();
      // corrupt/empty stepsJson on a waiting run → conservatively demand a
      // dial (the honest default: prompt steps need a real lane).
      const needsDial = steps.length === 0 ? true : remainingStepsNeedDial(steps, doneCount);
      let dial: ResolvedDial;
      if (needsDial) {
        // r526: rows hold AES-256-GCM ciphertext at rest — resolve on raw keys.
        const fetchedSlots = await db.automationVault.findMany({ orderBy: { createdAt: "asc" } });
        const vaultSlots = await Promise.all(
          fetchedSlots.map(async (s) => ({ ...s, key: await decryptVaultKey(s.key) })),
        );
        const resolved = resolveServerDialFromSlots(
          vaultSlots.map((s) => ({ provider: s.provider, key: s.key })),
        );
        if (!resolved.dial) return { claimed: 0, reason: resolved.why, workflowIds: [] };
        dial = resolved.dial;
      } else {
        // Provably unreachable dial: every remaining step is a waitFor step.
        dial = { url: "", key: "", model: "", providerLabel: "no-dial (wait-only resume)", providerId: "" };
      }
      const outcome = await executeWorkflow(
        {
          id: wfRow.id,
          name: wfRow.name,
          task: wfRow.task,
          stepsJson: wfRow.stepsJson,
          intervalMs: wfRow.intervalMs,
        },
        dial,
        waitingRun.id,
      );
      return { claimed: 1, workflowIds: [wfRow.id], outcome };
    }
  }

  const dueRows = await db.automationWorkflow.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
  });
  const due = dueRows.filter((w) => !waitingWfIds.has(w.id)).slice(0, 1);
  if (due.length === 0) return { claimed: 0, reason: "idle", workflowIds: [] };

  // r207: ALL slots, oldest first — first RESOLVABLE one wins (a legacy
  // builtin slot no longer blocks a newer registry-provider key).
  // r521: EXCEPT a wait-only workflow (every step is waitFor) — its first
  // tick just parks the run, so it must be claimable with NO vault key;
  // prompt steps still demand a real lane.
  const wf = due[0];
  const wfRowSteps = parseVaultSteps(wf.stepsJson);
  const claimNeedsDial =
    wfRowSteps.length === 0
      ? Boolean(wf.task.trim())
      : remainingStepsNeedDial(wfRowSteps, 0);
  let dial: ResolvedDial;
  if (claimNeedsDial) {
    // r526: rows hold AES-256-GCM ciphertext at rest — resolve on raw keys.
    const fetchedSlots = await db.automationVault.findMany({ orderBy: { createdAt: "asc" } });
    const vaultSlots = await Promise.all(
      fetchedSlots.map(async (s) => ({ ...s, key: await decryptVaultKey(s.key) })),
    );
    const resolved = resolveServerDialFromSlots(
      vaultSlots.map((s) => ({ provider: s.provider, key: s.key })),
    );
    if (!resolved.dial) return { claimed: 0, reason: resolved.why, workflowIds: [] };
    dial = resolved.dial;
  } else {
    // Provably unreachable dial: every step short-circuits at the waitFor
    // branch (park on first arrival) before any dial field is read.
    dial = { url: "", key: "", model: "", providerLabel: "no-dial (wait-only workflow)", providerId: "" };
  }
  const outcome = await executeWorkflow(
    {
      id: wf.id,
      name: wf.name,
      task: wf.task,
      stepsJson: wf.stepsJson,
      intervalMs: wf.intervalMs,
    },
    dial,
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
