import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveServerDialFromSlots, scheduleStaggerMs } from "@/lib/server/automation-executor";
import { type ExecutorLaneState } from "@/lib/automation-lane";

export const dynamic = "force-dynamic";

// ─── v20: Headless autopilot sync ────────────────────────────────────────────
// POST: the open tab pushes workflow snapshots (enabled schedules only) and
// heartbeats. While the heartbeat is fresh, the server stands down — the
// client scheduler drives runs with the user's own keys (BYOK lane).
// GET: the ServerAutopilot panel polls this for registry + recent server runs.

type StepPayload = { label: string; agentName?: string; prompt: string };
type WorkflowPayload = {
  id: string;
  name: string;
  task: string;
  intervalMs: number;
  enabled: boolean;
  steps: StepPayload[];
};

const HEARTBEAT_STALE_MS = 120_000;

export async function POST(req: Request) {
  // r421: an empty or malformed body is a CLIENT bug, not a server fault —
  // parse it defensively and answer a structured 400. Before this, `req.json()`
  // threw on an empty body and the outer 500 catch leaked the raw parser
  // message ("Unexpected end of JSON input") as the error string; a literal
  // `null` body skipped the throw but crashed `body.workflows` on the next
  // line into the same 500. Both now land here, with the heartbeat untouched —
  // a failed sync must not beat it (a crashed client is not an alive client).
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "empty or invalid JSON body" },
      { status: 400 },
    );
  }
  try {
    const raw = Array.isArray((body as { workflows?: unknown } | null)?.workflows)
      ? (body as { workflows: unknown[] }).workflows
      : [];
    // Tolerance style matches the row loop below (task ?? "", intervalMs
    // fallback): partial rows are tolerated, but a row without an id is
    // fatal to findUnique — drop it here instead of 500-ing the whole
    // heartbeat push for one malformed entry.
    const workflows = raw.filter(
      (w): w is WorkflowPayload =>
        !!w && typeof w === "object" && typeof (w as WorkflowPayload).id === "string" &&
        (w as WorkflowPayload).id.length > 0,
    );

    // Heartbeat FIRST — a successful sync means the client is alive.
    await db.automationState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", lastSeenAt: new Date() },
      update: { lastSeenAt: new Date() },
    });

    for (const w of workflows) {
      const data = {
        name: w.name,
        task: w.task ?? "",
        stepsJson: JSON.stringify(w.steps ?? []),
        intervalMs: Math.max(60_000, Number(w.intervalMs) || 900_000),
        enabled: w.enabled !== false,
      };
      const existing = await db.automationWorkflow.findUnique({ where: { id: w.id } });
      if (existing) {
        // Preserve the countdown across syncs — re-registering must never
        // push a due run into the future (that would starve the schedule).
        await db.automationWorkflow.update({ where: { id: w.id }, data });
      } else {
        await db.automationWorkflow.create({
          data: { id: w.id, ...data, nextRunAt: new Date(Date.now() + data.intervalMs + scheduleStaggerMs(w.id, data.intervalMs)) },
        });
      }
    }

    // Orphan guard: registry rows the client no longer sends are disabled
    // (kept for run history, never deleted).
    // v24 collapse fix: a push with ZERO enabled schedules is NOT authoritative
    // — any second client (QA browser profile, a second tab before hydration)
    // would otherwise disarm the primary user's registry every heartbeat
    // (proven live 2026-09-29: the QA instance re-disabled all 4 rows every
    // 60s in a silent tug-of-war with the real tab).
    // r234 contract fix: the guard now MATCHES that comment — prune only when
    // the push carries ≥1 enabled schedule. Before this, ANY non-empty push
    // pruned, so a cleanup POST of a single disabled row (E5a pattern) or a
    // mixed payload with zero enabled rows (N6 echo-all) silently disarmed
    // every unrelated enabled registry row. The bridge is unaffected: it only
    // ever sends enabled:true rows (buildPayload filters on schedule.enabled),
    // so its pushes prune exactly as before.
    const pushHasEnabled = workflows.some((w) => w.enabled !== false);
    if (pushHasEnabled) {
      const sentIds = new Set(workflows.map((w) => w.id));
      const all = await db.automationWorkflow.findMany({ select: { id: true, enabled: true } });
      for (const row of all) {
        if (!sentIds.has(row.id) && row.enabled) {
          await db.automationWorkflow.update({ where: { id: row.id }, data: { enabled: false } });
        }
      }
    }

    return NextResponse.json({ ok: true, registered: workflows.length });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const [state, registry, runs, vaultRows] = await Promise.all([
      db.automationState.findUnique({ where: { id: "singleton" } }),
      db.automationWorkflow.findMany({ orderBy: { name: "asc" } }),
      db.automationRun.findMany({ orderBy: { startedAt: "desc" }, take: 25 }),
      // r205/r207: read ALL vault slots — the executor resolves its dial from
      // the first RESOLVABLE row (createdAt asc; builtin/empty slots skipped)
      // and requires a registry-provider pairing. Reporting the builtin slot
      // alone (the r133 read) made the panel claim a lane the executor refuses.
      db.automationVault.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
    const lastSeen = state?.lastSeenAt?.getTime() ?? 0;
    const mask = (k: string) =>
      k.length > 12 ? `${k.slice(0, 4)}••••${k.slice(-4)}` : "••••••••";

    // r205/r207: executorLane mirrors resolveServerDialFromSlots exactly —
    // what a due closed-tab run would do RIGHT NOW, over the same slot list
    // the executor reads (oldest first, first resolvable wins). Masked only.
    const resolved = resolveServerDialFromSlots(
      vaultRows.map((s) => ({ provider: s.provider, key: s.key })),
    );
    const executorLane: ExecutorLaneState = resolved.dial
      ? {
          ready: true,
          reason: null,
          providerLabel: resolved.dial.providerLabel,
          maskedKey: mask(resolved.slot.key),
          slotProvider: resolved.slot.provider,
          slotCount: vaultRows.length,
        }
      : {
          ready: false,
          reason: resolved.why,
          providerLabel: null,
          maskedKey: vaultRows[0] ? mask(vaultRows[0].key) : null,
          slotProvider: vaultRows[0]?.provider ?? null,
          slotCount: vaultRows.length,
        };

    const builtinSlot = vaultRows.find((r) => r.provider === "builtin") ?? null;
    return NextResponse.json({
      serverDriving: Date.now() - lastSeen > HEARTBEAT_STALE_MS,
      lastSeenAt: state?.lastSeenAt ?? null,
      registry,
      runs,
      executorLane,
      // legacy (r133): builtin-slot read, superseded by executorLane — kept
      // one release for older cached bundles.
      vaultLane: builtinSlot
        ? { hasKey: true, maskedKey: mask(builtinSlot.key), updatedAt: builtinSlot.updatedAt }
        : { hasKey: false, maskedKey: null, updatedAt: null },
    });
  } catch (e) {
    return NextResponse.json(
      { serverDriving: false, registry: [], runs: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
