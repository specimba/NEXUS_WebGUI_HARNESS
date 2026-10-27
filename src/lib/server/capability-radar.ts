import { db } from "@/lib/db";
import ZAI from "z-ai-web-dev-sdk";
import { gatewayPulse } from "./gateway-pulse";

// ─── r497: Capability Radar — the hourly platform self-check ─────────────────
// Owner directive (r497): "cron automation for every 1-hour check … with that
// new workflow, findings, experimental, and tryable discoveries, we can adapt
// here for improvements in our agent and platform capabilities."
//
// WHAT IT IS: a deterministic, LLM-free, vault-free hourly scan of every
// intelligence table the platform already keeps — the durable run archive
// (RunReport), the automation registry + heartbeat + vault, the free-model
// tracker catalog and the server-side gateway 429 pulse — distilled into
// FINDINGS (what needs attention), EXPERIMENTS (what is worth trying) and
// TRYABLES (concrete adaptations), each with evidence. It deliberately needs
// NO vault key and NO open tab: the whole point of a 1-hour closed-loop check
// is that it fires when nothing else can.
//
// WHAT IT IS NOT: not an LLM summarizer (zero dials of user lanes — the
// digest is rule-based over first-party data), not a workflow runner (it
// never executes pipelines), not a cloud sync (everything stays local).
//
// One LIVE probe is allowed: a single no-key web_search through the built-in
// SDK gateway per check — the same lane /api/tools/execute already uses —
// so the radar can say "the gateway is failing NOW" vs "it failed earlier
// and has healed" (the exact r497 evidence: runs reported 401
// "missing X-Token header" for ~4h, then it healed on its own).
//
// Persistence: one CapabilityCheck row per UTC hour bucket (id = bucket) —
// re-running within the hour is an idempotent upsert, so the API's
// "Check now" button and the hourly timer can never produce duplicates.

export const RADAR_INTERVAL_MS = 3_600_000; // the owner's "every 1-hour check"
const WINDOW_HOURS = 24;
const PROBE_TIMEOUT_MS = 10_000;
/** r500: one retry for transient probe classes — a single congested instant
 * must not read as an outage for a whole hour. Auth failures do NOT retry
 * (deterministic rejection — a second call burns quota to learn nothing). */
const PROBE_RETRY_MS = 2_500;

// ── r500: probe error classification ────────────────────────────────────────
// The witnessed misdiagnosis: the live probe came back 429 "Too many
// requests" and rule R1 escalated the finding to CRITICAL "probe still
// failing" — but a 429 is the gateway ANSWERING (auth path passed, shared
// bucket just full). Auth outage and congestion demand opposite responses
// (pause schedules vs space them), so the radar now names the class.
export type ProbeClass = "ok" | "congestion" | "auth" | "down";

export function classifyProbeError(raw: string): Exclude<ProbeClass, "ok"> {
  const m = raw.toLowerCase();
  if (m.includes("429") || m.includes("too many requests") || m.includes("rate limit")) return "congestion";
  if (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("x-token") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("api key") ||
    m.includes("auth")
  )
    return "auth";
  return "down"; // timeouts, network errors, empty results, 5xx
}

export type RadarSeverity = "critical" | "warning" | "info";
export type RadarArea = "gateway" | "runs" | "registry" | "vault" | "catalog";

export interface RadarFinding {
  severity: RadarSeverity;
  area: RadarArea;
  title: string;
  evidence: string;
  /** A concrete adaptation the owner or an agent can act on. null = none. */
  tryable: string | null;
}

export interface RadarSeed {
  label: string;
  prompt: string;
}

export interface RadarDigest {
  generatedAt: string;
  hourBucket: string;
  windowHours: number;
  runs: {
    total: number;
    done: number;
    error: number;
    blocked: number;
    partial: number;
    toolCalls: number;
    failureRate: number;
    quietCycles: number;
    gatewayAuthFailures: number;
  };
  perWorkflow: { name: string; total: number; errors: number; failureRate: number; lastError: string | null }[];
  registry: { enabled: number; parked: string[]; overdue: string[]; heartbeatStaleMs: number | null };
  vault: { slots: number; closedTabLane: "ready" | "no-vault-key" };
  catalog: { newModels48h: string[]; removed48h: number };
  gateway: {
    pulse1h: number;
    pulse24h: number;
    probe: { ok: boolean; ms: number; error: string | null; class: ProbeClass; attempts: number };
  };
  experiments: { name: string; why: string }[];
  findings: RadarFinding[];
  seeds: RadarSeed[];
}

/** The UTC hour bucket "2026-10-18T17:00Z" — deterministic row id. */
function hourBucketOf(d = new Date()): string {
  return `${d.toISOString().slice(0, 13)}:00Z`;
}

const trunc = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

// Lazy SDK singleton (same shape as tools.ts — never dials user keys).
let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null;
function getZai() {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

async function probeGateway(): Promise<RadarDigest["gateway"]["probe"]> {
  const t0 = Date.now();
  let attempts = 0;
  let error: string | null = null;
  while (attempts < 2) {
    attempts += 1;
    try {
      const zai = await getZai();
      const res = (await Promise.race([
        zai.functions.invoke("web_search", { query: "openai compatible api", num: 1 }),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error(`probe timed out after ${PROBE_TIMEOUT_MS / 1000}s`)), PROBE_TIMEOUT_MS),
        ),
      ])) as unknown;
      const text = typeof res === "string" ? res : JSON.stringify(res);
      if (!text || text === "[]" || text === "null") {
        error = "probe returned empty result";
      } else {
        return { ok: true, ms: Date.now() - t0, error: null, class: "ok", attempts };
      }
    } catch (e) {
      error = trunc(e instanceof Error ? e.message : String(e), 160);
    }
    if (classifyProbeError(error ?? "") === "auth") break; // deterministic — retry teaches nothing
    if (attempts < 2) await new Promise((r) => setTimeout(r, PROBE_RETRY_MS)); // let a congested bucket breathe
  }
  return {
    ok: false,
    ms: Date.now() - t0,
    error,
    class: error ? classifyProbeError(error) : "down",
    attempts,
  };
}

/** Run one radar check: scan → rules → findings/seeds → idempotent upsert. */
export async function runCapabilityCheck(): Promise<RadarDigest> {
  const t0 = Date.now();
  const bucket = hourBucketOf();
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 3_600_000);
  const catalogStart = new Date(Date.now() - 48 * 3_600_000);

  // ── 1. Durable run archive (the local lane's full-fidelity history) ──────
  // r640: the archive read is isolated — one corrupt/unreadable table must not
  // 500 the whole digest (witnessed r639: SQLITE_CORRUPT killed the panel and
  // the Owner saw a bare "Capability check failed" toast). Degradation now
  // surfaces as an honest critical finding inside an otherwise live digest.
  let reports: {
    workflowName: string;
    status: string;
    stepsJson: string;
    toolCalls: number | null;
    error: string | null;
    startedAt: Date;
  }[] = [];
  let archiveError: string | null = null;
  try {
    reports = await db.runReport.findMany({
      where: { startedAt: { gte: windowStart } },
      orderBy: { startedAt: "desc" },
      select: { workflowName: true, status: true, stepsJson: true, toolCalls: true, error: true, startedAt: true },
    });
  } catch (e) {
    archiveError = trunc(e instanceof Error ? e.message : String(e), 200);
  }
  const [enabledRows, allRows, vaultCount, heartbeat, newModels, removedEvents] = await Promise.all([
    db.automationWorkflow.findMany({ where: { enabled: true }, select: { name: true, nextRunAt: true } }),
    db.automationWorkflow.findMany({ select: { name: true, enabled: true, failStreak: true } }),
    db.automationVault.count(),
    db.automationState.findUnique({ where: { id: "singleton" } }),
    db.trackedModel.findMany({
      where: { isNew: true, firstSeenAt: { gte: catalogStart } },
      orderBy: { firstSeenAt: "desc" },
      take: 6,
      select: { displayName: true, providerId: true, modelId: true },
    }),
    db.trackerEvent.count({ where: { type: "removed", createdAt: { gte: catalogStart } } }),
  ]);

  const stepText = (stepsJson: string): string => {
    try {
      const steps = JSON.parse(stepsJson) as { output?: string }[];
      return Array.isArray(steps) ? steps.map((s) => s.output ?? "").join("\n") : "";
    } catch {
      return "";
    }
  };

  const total = reports.length;
  const byStatus = (s: string): number => reports.filter((r) => r.status === s).length;
  const done = byStatus("done");
  const error = byStatus("error");
  const blocked = byStatus("blocked");
  const partial = byStatus("partial");
  const toolCalls = reports.reduce((a, r) => a + (r.toolCalls ?? 0), 0);
  const texts = reports.map((r) => ({ r, text: stepText(r.stepsJson) }));
  const gatewayAuthFailures = texts.filter(
    (t) => t.text.includes("401") || t.text.toLowerCase().includes("missing x-token"),
  ).length;
  const quietCycles = texts.filter((t) => t.text.toLowerCase().includes("quiet cycle")).length;
  const failureRate = total > 0 ? (error + blocked) / total : 0;

  // Per-workflow failure aggregation (only workflows that actually failed).
  const wfAgg = new Map<string, { total: number; errors: number; lastError: string | null; lastTs: number }>();
  for (const r of reports) {
    const a = wfAgg.get(r.workflowName) ?? { total: 0, errors: 0, lastError: null as string | null, lastTs: 0 };
    a.total += 1;
    if (r.status === "error" || r.status === "blocked") {
      a.errors += 1;
      const msg = r.error ?? "";
      if (msg && new Date(r.startedAt).getTime() >= a.lastTs) {
        a.lastError = msg;
        a.lastTs = new Date(r.startedAt).getTime();
      }
    }
    wfAgg.set(r.workflowName, a);
  }
  const perWorkflow = [...wfAgg.entries()]
    .filter(([, a]) => a.errors > 0)
    .sort((x, y) => y[1].errors - x[1].errors)
    .slice(0, 6)
    .map(([name, a]) => ({
      name,
      total: a.total,
      errors: a.errors,
      failureRate: a.errors / a.total,
      lastError: a.lastError ? trunc(a.lastError, 200) : null,
    }));

  // ── 2. Registry / vault / heartbeat ──────────────────────────────────────
  const parked = allRows.filter((r) => !r.enabled && r.failStreak >= 3).map((r) => r.name);
  const overdue = enabledRows
    .filter((r) => r.nextRunAt && r.nextRunAt.getTime() <= Date.now() - 3_600_000)
    .map((r) => r.name);
  const heartbeatStaleMs = heartbeat ? Date.now() - heartbeat.lastSeenAt.getTime() : null;

  // ── 3. Gateway pulse + live probe ────────────────────────────────────────
  const pulse = gatewayPulse();
  const probe = await probeGateway();

  const digest: RadarDigest = {
    generatedAt: new Date().toISOString(),
    hourBucket: bucket,
    windowHours: WINDOW_HOURS,
    runs: { total, done, error, blocked, partial, toolCalls, failureRate, quietCycles, gatewayAuthFailures },
    perWorkflow,
    registry: { enabled: enabledRows.length, parked, overdue, heartbeatStaleMs },
    vault: { slots: vaultCount, closedTabLane: vaultCount > 0 ? "ready" : "no-vault-key" },
    catalog: {
      newModels48h: newModels.map((m) => `${m.displayName ?? m.modelId} (${m.providerId})`),
      removed48h: removedEvents,
    },
    gateway: { pulse1h: pulse.count1h, pulse24h: pulse.count24h, probe },
    experiments: [],
    findings: archiveError
      ? [
          {
            severity: "critical" as const,
            area: "runs" as const,
            title: "Run archive unreadable — digest degraded",
            evidence: trunc(archiveError, 200),
            tryable: "Inspect db/ integrity (SQLite CORRUPT); scripts/db-recover-r640.py holds the staged cure.",
          },
        ]
      : [],
    seeds: [],
  };

  // ── 4. Rules → findings ──────────────────────────────────────────────────
  const F = digest.findings;

  // R1 — the r497 witnessed failure class: upstream gateway auth streak.
  // r500: the probe's class now decides severity honestly — a 429 means the
  // gateway is UP and congesting (warning, space the schedules), only an
  // auth/down probe with an active 401 streak stays critical.
  if (gatewayAuthFailures >= 3) {
    const share = total > 0 ? gatewayAuthFailures / total : 0;
    const retryNote = probe.attempts > 1 ? ` (probe retried ${probe.attempts}× this pass)` : "";
    if (probe.ok) {
      F.push({
        severity: "warning",
        area: "gateway",
        title: `Gateway auth streak healed — ${gatewayAuthFailures} of ${total} runs hit 401 "missing X-Token" in ${WINDOW_HOURS}h`,
        evidence: `The live probe just answered in ${probe.ms}ms — the upstream auth outage (e.g. the 13:33–17:03Z window, r497) is over. Quiet-cycle runs were honest stops, not data loss.`,
        tryable: "Re-arm any schedules you paused during the outage; consider a retry-backoff step before the first research step so a dead gateway costs one cheap probe, not a full run.",
      });
    } else if (probe.class === "congestion") {
      F.push({
        severity: "warning",
        area: "gateway",
        title: `Search gateway auth streak (${gatewayAuthFailures} of ${total} runs hit 401 "missing X-Token" in ${WINDOW_HOURS}h) — live probe is rate-limited (429), not dead`,
        evidence: `Live probe: ${probe.error ?? "unknown"}${retryNote}. A 429 is the gateway ANSWERING — auth passed, the shared bucket is full. That is congestion, not the auth outage repeating: the honest read is "lane up, load high", and the 401 streak is trailing-window history, not a live failure.`,
        tryable: "Treat as congestion, not outage: keep schedules on (the stagger already spreads same-minute fires), lean on the arxiv/wikipedia fallback rotation, and only pause if a probe comes back 401/403 — the class label on this line tells you which world you are in.",
      });
    } else {
      F.push({
        severity: "critical",
        area: "gateway",
        title: `Search gateway auth failing — ${gatewayAuthFailures} of ${total} runs hit 401 "missing X-Token" in ${WINDOW_HOURS}h, probe still failing`,
        evidence: `Live probe (${probe.class}): ${probe.error ?? "unknown"}${retryNote}. Runs honestly stopped ("quiet cycle") instead of fabricating — but research pipelines produced no new data while the streak lasted.`,
        tryable: "Pause research-heavy schedules until the probe passes (each run currently burns quota to re-discover the outage), or point first steps at no-fetch tools (arxiv/wikipedia fallbacks already rotate automatically).",
      });
    }
  } else if (!probe.ok) {
    if (probe.class === "congestion") {
      F.push({
        severity: "warning",
        area: "gateway",
        title: "Live gateway probe rate-limited (429) — lane up, bucket congesting",
        evidence: `web_search probe: ${probe.error ?? "unknown"} (${probe.ms}ms${probe.attempts > 1 ? `, ${probe.attempts} tries` : ""}). A 429 is the gateway answering — this is congestion, not an outage, and the recent archive shows no 401 streak.`,
        tryable: "No auth action needed. If completion dials also 429 this hour, the pulse chip tracks the shared bucket; spacing schedules further is the only lever that helps congestion.",
      });
    } else {
      F.push({
        severity: "critical",
        area: "gateway",
        title: "Live gateway probe failing right now",
        evidence: `web_search probe error (${probe.class}): ${probe.error ?? "unknown"} (${probe.ms}ms). Recent archive does not yet show a 401 streak.`,
        tryable: "If the next check still fails, treat the built-in search lane as down: schedule steps should lean on arxiv/wikipedia fallbacks (they auto-rotate) until this clears.",
      });
    }
  }

  // R2 — quiet cycles (honest no-data cycles are expected during outages).
  if (quietCycles >= 3 && gatewayAuthFailures < 3) {
    F.push({
      severity: "info",
      area: "runs",
      title: `${quietCycles} quiet cycles in ${WINDOW_HOURS}h`,
      evidence: "Runs completed but reported no new verifiable findings — the stop-early rule held.",
      tryable: "If quiet cycles persist across checks, widen the sources or rotate the research prompt — a healthy pipeline should surface something a few times a week.",
    });
  }

  // R3 — per-workflow failure streaks from the archive.
  for (const w of perWorkflow.filter((w) => w.errors >= 2 && w.failureRate >= 0.5).slice(0, 3)) {
    F.push({
      severity: "warning",
      area: "runs",
      title: `Pipeline "${w.name}" failing — ${w.errors}/${w.total} runs in ${WINDOW_HOURS}h`,
      evidence: `Last error: ${w.lastError ?? "unknown"}`,
      tryable: "Open the run drawer for the full error; transient kinds (network/timeout/rate-limit) are already auto-retried — hard kinds want a lane or prompt fix before the next fire.",
    });
  }

  // R4 — closed-tab lane dead (the exact loop the owner keeps hitting).
  if (vaultCount === 0 && enabledRows.length > 0) {
    F.push({
      severity: "warning",
      area: "vault",
      title: "Closed-tab lane cannot dial — vault has no key",
      evidence: `${enabledRows.length} enabled schedule${enabledRows.length === 1 ? "" : "s"} wait for the open tab; with the tab closed the server executor honestly refuses to dial (BYOK doctrine — nothing implicit).`,
      tryable: "Store one registry-provider key in Settings → Automation Vault to let closed-tab schedules fire; the browser lane stays primary while the tab is open.",
    });
  }

  // R7 — registry collapse canary (r640 lesson: a silent DB swap took 4 armed
  // schedules to 0 between two rounds and nothing flagged it for a full hour).
  // Compares this pass against the most recent PREVIOUS digest row; the canary
  // must never break the digest itself (same doctrine as the r640 archive split).
  try {
    const prevRow = await db.capabilityCheck.findFirst({
      where: { id: { not: bucket } },
      orderBy: { createdAt: "desc" },
      select: { id: true, digestJson: true },
    });
    const prev = prevRow ? (JSON.parse(prevRow.digestJson) as RadarDigest) : null;
    const prevEnabled = typeof prev?.registry?.enabled === "number" ? prev.registry.enabled : null;
    if (prevEnabled !== null && prevEnabled >= 2 && enabledRows.length === 0) {
      F.push({
        severity: "critical",
        area: "registry",
        title: `Registry collapsed ${prevEnabled} → 0 armed schedules`,
        evidence: `Previous digest ${prevRow!.id} showed ${prevEnabled} enabled; this pass sees an empty registry — the classic silent DB-swap signature (witnessed r640).`,
        tryable: "Re-arm schedules from the Workflows cards and re-mirror the vault key (browser BYOK one-click). If rows exist but disabled, resume them individually.",
      });
    } else if (prevEnabled !== null && prevEnabled >= 3 && enabledRows.length <= prevEnabled - 2) {
      F.push({
        severity: "warning",
        area: "registry",
        title: `Registry shrank ${prevEnabled} → ${enabledRows.length} armed schedules`,
        evidence: `Compared against previous digest ${prevRow!.id}. If the drop was intentional, ignore this pass.`,
        tryable: "If unintentional, check for silent DB restores (r640 pattern) before re-arming.",
      });
    }
  } catch {
    // canary is best-effort: a failed comparison never blocks the digest
  }

  // R5 — parked schedules (the 3-strike breaker).
  if (parked.length > 0) {
    F.push({
      severity: "warning",
      area: "registry",
      title: `${parked.length} schedule${parked.length === 1 ? "" : "s"} parked by the failure breaker`,
      evidence: parked.join(" · "),
      tryable: "Fix the underlying failure (usually the vault lane above), then resume from the pipeline card — the next heartbeat re-registers the row.",
    });
  }

  // R6 — no lane driving at all (heartbeat stale AND overdue enabled rows).
  const heartbeatStale = heartbeatStaleMs !== null && heartbeatStaleMs > 10 * 60_000;
  if (heartbeatStale && overdue.length > 0) {
    F.push({
      severity: "critical",
      area: "registry",
      title: `${overdue.length} enabled schedule${overdue.length === 1 ? "" : "s"} overdue with NO lane driving`,
      evidence: `Tab heartbeat stale ${Math.round(heartbeatStaleMs! / 60_000)}m; overdue: ${overdue.join(" · ")}`,
      tryable: vaultCount > 0
        ? "The server lane should claim these within its next ticks — if it does not, check the dev server is running."
        : "Open the platform once (re-arms the browser lane) or add a vault key so the closed-tab lane can claim them.",
    });
  } else if (overdue.length > 0 && !heartbeatStale) {
    F.push({
      severity: "info",
      area: "registry",
      title: `Registry mirror ${overdue.length > 0 ? "stale" : ""} — ${overdue.length} row${overdue.length === 1 ? "" : "s"} overdue while the tab drives`,
      evidence: `The browser lane fires from its own localStorage schedule (the registry's nextRunAt only advances on server-lane claims) — rows: ${overdue.join(" · ")}.`,
      tryable: null,
    });
  }

  // R7 — firsthand catalog awareness (the owner's standing directive).
  if (digest.catalog.newModels48h.length > 0) {
    F.push({
      severity: "info",
      area: "catalog",
      title: `${digest.catalog.newModels48h.length} new model${digest.catalog.newModels48h.length === 1 ? "" : "s"} surfaced in 48h`,
      evidence: digest.catalog.newModels48h.join(" · "),
      tryable: "Pin a promising free model into the relay lanes (Settings → Model relay) so runs rotate onto it before paid lanes.",
    });
  }
  if (removedEvents > 0) {
    F.push({
      severity: "warning",
      area: "catalog",
      title: `${removedEvents} model${removedEvents === 1 ? "" : "s"} removed from the free catalog in 48h`,
      evidence: "The tracker recorded disappearances — pinned lanes referencing them will 404/503 on dial.",
      tryable: "Check pinned lanes in Settings → Model relay; re-pin onto the newest sightings.",
    });
  }

  // R8 — server-side congestion signal.
  if (pulse.count1h >= 3) {
    F.push({
      severity: "warning",
      area: "gateway",
      title: `${pulse.count1h} upstream 429s observed server-side in the last hour`,
      evidence: `${pulse.count24h} in 24h — the shared gateway bucket is congesting (server vantage only; browser-direct dials are invisible here by design).`,
      tryable: "If a run also stalls, the park-and-resume rotation already handles it; consider spacing schedules with the stagger so pipelines do not collide.",
    });
  }

  // ── 5. Experiments (tryable discoveries worth a manual run) ──────────────
  const X = digest.experiments;
  if (vaultCount === 0) {
    X.push({
      name: "Seed the closed-tab lane",
      why: "Zero vault slots: the hourly schedules only run while a tab is open. Seeding one key turns every schedule into true 24/7 automation — the single highest-leverage experiment right now.",
    });
  }
  if (gatewayAuthFailures >= 3 && (probe.ok || probe.class === "congestion")) {
    X.push({
      name: "Probe-first research step",
      why:
        probe.ok
          ? "The gateway healed after the outage — a pipeline whose first step is a 1-token probe (and stops early on failure) converts outage hours from burned runs into free quiet cycles."
          : "The probe is coming back 429 (congested, not dead) — a probe-first first step still pays: it costs one cheap call and stops early, instead of burning a full research run into a full bucket.",
    });
  }
  if (digest.catalog.newModels48h.length > 0) {
    X.push({
      name: `Try the freshest lane: ${digest.catalog.newModels48h[0]}`,
      why: "Newly surfaced free models are untested on your workloads — pin it, run one research cycle through it, and compare novelty scores against the usual lane.",
    });
  }

  // ── 6. Seeds — importable improvement steps (adapt findings → pipelines) ─
  const S = digest.seeds;
  for (const f of F.filter((f) => f.severity !== "info").slice(0, 4)) {
    S.push({
      label: `Radar: ${trunc(f.title, 60)}`,
      prompt:
        f.area === "gateway"
          ? "You are a platform-care worker. Run one web_search probe of the gateway. If it fails: report the exact error and list which pipelines should pause. If it passes: report healed status and recommend re-arming any paused schedules. Never fabricate results; stop honestly on failure."
          : f.area === "vault"
            ? "You are a platform-care worker. Explain in 3 sentences why closed-tab schedules need a vault key, then list the currently enabled schedules that would benefit. Do not attempt to store any key yourself."
            : `You are a platform-care worker. Investigate this radar finding: "${trunc(f.title, 120)}". Evidence: ${trunc(f.evidence, 240)}. Produce: (1) root-cause hypothesis, (2) one concrete adaptation to try, (3) what to watch next cycle. Stop honestly if evidence is insufficient.`,
    });
  }

  // ── 7. Idempotent persistence ────────────────────────────────────────────
  const digestJson = JSON.stringify(digest);
  await db.capabilityCheck.upsert({
    where: { id: bucket },
    create: {
      id: bucket,
      digestJson,
      findings: digest.findings.length,
      critical: digest.findings.filter((f) => f.severity === "critical").length,
      warnings: digest.findings.filter((f) => f.severity === "warning").length,
      tryables: digest.findings.filter((f) => f.tryable).length + digest.experiments.length,
      durationMs: Date.now() - t0,
    },
    update: {
      digestJson,
      findings: digest.findings.length,
      critical: digest.findings.filter((f) => f.severity === "critical").length,
      warnings: digest.findings.filter((f) => f.severity === "warning").length,
      tryables: digest.findings.filter((f) => f.tryable).length + digest.experiments.length,
      durationMs: Date.now() - t0,
    },
  });
  return digest;
}

/** Latest digest + trailing history for the panel (bounded, newest first). */
export async function getRadarSnapshot(limit = 24): Promise<{
  latest: RadarDigest | null;
  history: { id: string; findings: number; critical: number; warnings: number; tryables: number; updatedAt: string }[];
}> {
  const rows = await db.capabilityCheck.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  const latest = rows[0]?.digestJson ? (JSON.parse(rows[0].digestJson) as RadarDigest) : null;
  return {
    latest,
    history: rows.map((r) => ({
      id: r.id,
      findings: r.findings,
      critical: r.critical,
      warnings: r.warnings,
      tryables: r.tryables,
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

/** Boot the hourly loop exactly once per server process (HMR-safe). */
export function startCapabilityRadar(): void {
  const g = globalThis as unknown as { __capabilityRadar?: NodeJS.Timeout };
  if (g.__capabilityRadar) return;
  // First check 8s after boot (schema/boot races settle), then hourly.
  const first = setTimeout(() => {
    void runCapabilityCheck().catch((err) =>
      console.error("[capability-radar] boot check failed:", err instanceof Error ? err.message : err),
    );
  }, 8_000);
  const hourly = setInterval(() => {
    void runCapabilityCheck().catch((err) =>
      console.error("[capability-radar] hourly check failed:", err instanceof Error ? err.message : err),
    );
  }, RADAR_INTERVAL_MS);
  g.__capabilityRadar = hourly;
  // Keep the boot timer from holding the process open in edge cases.
  first.unref?.();
  console.info("[capability-radar] hourly self-check armed (fires with or without an open tab; first pass in 8s)");
}
