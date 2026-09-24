"use client";

// ─── r49 Probe loop — cooldown recovery for capacity-cooled relay lanes ──────
// STATE machine background worker: every PROBE_INTERVAL_MS it picks the two
// longest-cooled lanes and fires a 1-token health check (/api/router/probe).
//   pass → the lane exits cooldown, health baseline restored (probe-revived)
//   fail → remaining cooldown doubles, capped (probe-extended)
// Cooldown ≠ removal — this loop is the guarantee that no throttled provider
// stays dead forever AND no exhausted provider gets hammered: probes only run
// while the app is idle (never against an active run) and never more than two
// per tick.

import { buildRelayChain, isCapacityCooled, recordProbeResult, relayHealthSnapshot } from "./relay";
import { queueRelayEvent } from "./relay-events";
import { useSettingsStore, useUiStore } from "./stores";

export const PROBE_INTERVAL_MS = 60_000;
const MAX_PROBES_PER_TICK = 2;

let timer: ReturnType<typeof setInterval> | undefined = undefined;
let probing = false;

async function probeTick(): Promise<void> {
  if (probing) return;
  // Never compete with a live run for provider quota.
  if (useUiStore.getState().busy) return;
  probing = true;
  try {
    const settings = useSettingsStore.getState().settings;
    if (settings.relayEnabled === false) return;
    const health = relayHealthSnapshot();
    const now = Date.now();
    const cooledKeys = Object.entries(health)
      .filter(([k, e]) => k !== "auto::builtin" && isCapacityCooled(e))
      .sort((a, b) => (a[1].cooldownUntil ?? 0) - (b[1].cooldownUntil ?? 0))
      .slice(0, MAX_PROBES_PER_TICK)
      .map(([k]) => k);
    if (cooledKeys.length === 0) return;

    // Creds live on the chain hops (vault keys never leave the browser).
    const chain = buildRelayChain(settings);
    const byKey = new Map(chain.map((h) => [h.key, h]));

    for (const key of cooledKeys) {
      const hop = byKey.get(key);
      if (!hop?.baseUrl) continue; // cooled but no vault creds (stale entry) — leave to clock
      const started = Date.now();
      try {
        const res = await fetch("/api/router/probe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseUrl: hop.baseUrl,
            ...(hop.apiKey ? { apiKey: hop.apiKey } : {}),
            model: hop.model,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          latencyMs?: number;
          error?: string;
          status?: number;
        };
        const ok = data.ok === true;
        recordProbeResult(key, ok, ok ? undefined : data.error ?? `HTTP ${data.status ?? "?"}`, data.latencyMs);
        const idx = key.indexOf("::");
        queueRelayEvent({
          requestId: `probe-${started}`,
          hopKey: key,
          providerId: key.slice(0, idx),
          modelId: key.slice(idx + 2),
          ok,
          ...(ok ? {} : { kind: "rate-limit" }),
          attempt: "probe",
          action: ok ? "probe-revived" : "probe-extended",
          ...(typeof data.latencyMs === "number" ? { latencyMs: data.latencyMs } : {}),
          error: ok ? undefined : (data.error ?? "").slice(0, 300) || undefined,
          transport: "probe",
        });
      } catch {
        // network-level probe failure — extend conservatively via recordProbeResult
        recordProbeResult(key, false, "probe network error", Date.now() - started);
      }
    }
  } finally {
    probing = false;
  }
}

// ─── r49 Watchdog auto-sweep ─────────────────────────────────────────────────
// The user's doctrine: the logging/feedback loop is the platform's actual
// intelligence — a first-class feature, not a passive view. Every
// WATCHDOG_SWEEP_TICKS probe ticks (≈1/h) the prober also fetches the
// watchdog report; NEW critical findings toast ONCE (per session, per finding
// id — no nagging), warn findings stay silent in the Router view where the
// human applies or dismisses them. Findings are suggestions; nothing applies
// itself to the routing config (supervised control loop).

export const WATCHDOG_SWEEP_TICKS = 60;
const WATCHDOG_SEEN_KEY = "praison-watchdog-seen";

function loadSeenFindings(): string[] {
  try {
    const raw = localStorage.getItem(WATCHDOG_SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveSeenFindings(ids: string[]): void {
  try {
    localStorage.setItem(WATCHDOG_SEEN_KEY, JSON.stringify(ids.slice(-80)));
  } catch {
    /* best-effort */
  }
}

async function watchdogSweep(): Promise<void> {
  const seen = loadSeenFindings();
  const toasted: string[] = [];
  try {
    const res = await fetch("/api/router/watchdog?days=7");
    if (!res.ok) return;
    const data = (await res.json()) as {
      report?: { findings?: { id: string; severity: string; providerId: string; pattern: string; evidence: string }[] };
    };
    const findings = data.report?.findings ?? [];
    const critical = findings.filter((f) => f.severity === "critical" && !seen.includes(f.id));
    if (critical.length === 0) return;
    // dynamic import — keeps sonner out of the prober's module graph until needed
    const { toast } = await import("sonner");
    for (const f of critical.slice(0, 2)) {
      toast.error(`Watchdog: ${f.pattern} on ${f.providerId}`, {
        description: `${f.evidence} — review it in Router → Watchdog (nothing changes without you).`,
        duration: 12_000,
      });
      toasted.push(f.id);
    }
    if (critical.length > 2) {
      toast.error(`Watchdog: ${critical.length - 2} more critical finding(s)`, {
        description: "Open Router → Watchdog for the full scan.",
        duration: 12_000,
      });
      toasted.push(...critical.slice(2).map((f) => f.id));
    }
  } catch {
    return; // sweep is best-effort — the view's manual Rescan still works
  } finally {
    if (toasted.length > 0) saveSeenFindings([...seen, ...toasted]);
  }
}

/** Start the background probe loop (idempotent). */
export function startRelayProber(): void {
  if (timer) return;
  let ticks = 0;
  timer = setInterval(() => {
    void probeTick();
    ticks += 1;
    if (ticks % WATCHDOG_SWEEP_TICKS === 0) void watchdogSweep();
  }, PROBE_INTERVAL_MS);
}

/** Stop the background probe loop (test/teardown). */
export function stopRelayProber(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

/** Force one probe tick immediately (Router view "Probe now" button). */
export function probeNow(): void {
  void probeTick();
}
