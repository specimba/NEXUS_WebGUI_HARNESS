// ─── r49 Watchdog — the routing feedback loop's pattern scanner (pure) ───────
// Scans RelayEvent rows and produces findings: failure clusters, time-of-day
// patterns, repeated quota exhaustion, hard-fail streaks. Findings are
// SUGGESTIONS for the human (weights/cooldowns apply only after a person
// confirms in the Router view) — the platform's "smart part" is a supervised
// control loop, not an unsupervised one.

export interface WatchdogEventRow {
  requestId: string;
  hopKey: string;
  providerId: string;
  modelId: string;
  ok: boolean;
  kind?: string | null;
  action?: string | null;
  transport?: string | null;
  createdAt: Date | string;
}

export interface WatchdogFinding {
  id: string;
  severity: "info" | "warn" | "critical";
  providerId: string;
  /** e.g. "capacity-cycle" | "hard-streak" | "high-fail-rate" | "auth-lock" */
  pattern: string;
  evidence: string;
  suggestion: string;
  /** Suggested relayWeight for this provider (−2…+2); absent = no weight change. */
  suggestedWeight?: number;
}

export interface WatchdogProviderStat {
  providerId: string;
  attempts: number;
  fails: number;
  failRate: number;
  kinds: Record<string, number>;
  actions: Record<string, number>;
  lastEventAt?: string;
}

export interface WatchdogReport {
  windowDays: number;
  totalEvents: number;
  providers: WatchdogProviderStat[];
  findings: WatchdogFinding[];
  /** UTC hour → rate-limit count across providers (credit-reset detector). */
  rateLimitHourHistogram: number[];
  peakRateLimitHourUtc?: number;
}

const HOUR_BUCKETS = 24;

function hourOf(d: Date): number {
  return d.getUTCHours();
}

/**
 * Build the watchdog report. Thresholds are deliberately conservative — a
 * finding must be backed by ≥ MIN_ATTEMPTS observations so one unlucky call
 * never becomes a routing change.
 */
export function buildWatchdogReport(events: WatchdogEventRow[], windowDays: number): WatchdogReport {
  const rateLimitHourHistogram = new Array<number>(HOUR_BUCKETS).fill(0);
  const perProvider = new Map<
    string,
    { attempts: number; fails: number; kinds: Record<string, number>; actions: Record<string, number>; lastEventAt?: Date }
  >();
  const perHop = new Map<string, { fails: number; streak: number; maxStreak: number; lastStreakEnd?: Date }>();

  for (const e of events) {
    const created = e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt);
    const p = perProvider.get(e.providerId) ?? { attempts: 0, fails: 0, kinds: {}, actions: {} };
    p.attempts += 1;
    if (!e.ok) {
      p.fails += 1;
      const k = e.kind ?? "unknown";
      p.kinds[k] = (p.kinds[k] ?? 0) + 1;
      if (k === "rate-limit") rateLimitHourHistogram[hourOf(created)] += 1;
    }
    const a = e.action ?? (e.ok ? "served" : "failed");
    p.actions[a] = (p.actions[a] ?? 0) + 1;
    if (!p.lastEventAt || created > p.lastEventAt) p.lastEventAt = created;
    perProvider.set(e.providerId, p);

    if (!e.ok) {
      const h = perHop.get(e.hopKey) ?? { fails: 0, streak: 0, maxStreak: 0 };
      h.fails += 1;
      h.streak += 1;
      if (h.streak > h.maxStreak) h.maxStreak = h.streak;
      h.lastStreakEnd = created;
      perHop.set(e.hopKey, h);
    } else {
      const h = perHop.get(e.hopKey);
      if (h) h.streak = 0;
    }
  }

  const providers: WatchdogProviderStat[] = [...perProvider.entries()]
    .map(([providerId, s]) => ({
      providerId,
      attempts: s.attempts,
      fails: s.fails,
      failRate: s.attempts > 0 ? Math.round((s.fails / s.attempts) * 100) / 100 : 0,
      kinds: s.kinds,
      actions: s.actions,
      ...(s.lastEventAt ? { lastEventAt: s.lastEventAt.toISOString() } : {}),
    }))
    .sort((a, b) => b.fails - a.fails || b.attempts - a.attempts);

  const findings: WatchdogFinding[] = [];
  const MIN_ATTEMPTS = 6;

  for (const stat of providers) {
    if (stat.attempts < MIN_ATTEMPTS) continue;

    // High fail-rate — the provider flaps; a small negative weight buries it
    // under healthier siblings while the probe loop keeps checking recovery.
    if (stat.failRate >= 0.6) {
      findings.push({
        id: `fail-rate:${stat.providerId}`,
        severity: stat.failRate >= 0.8 ? "critical" : "warn",
        providerId: stat.providerId,
        pattern: "high-fail-rate",
        evidence: `${Math.round(stat.failRate * 100)}% of ${stat.attempts} attempts failed in the last ${windowDays}d`,
        suggestion: `Demote ${stat.providerId} (weight −1) so healthy providers answer first; the probe loop keeps checking recovery.`,
        suggestedWeight: -1,
      });
    }

    // Capacity cycle — repeated 429s: the daily-credit rhythm. Not a demotion
    // case (quality is fine) — the cooldown machinery already handles it.
    const rateLimits = stat.kinds["rate-limit"] ?? 0;
    if (rateLimits >= 4 && rateLimits >= stat.fails * 0.6) {
      findings.push({
        id: `capacity-cycle:${stat.providerId}`,
        severity: "info",
        providerId: stat.providerId,
        pattern: "capacity-cycle",
        evidence: `${rateLimits} rate-limit hits (of ${stat.fails} failures) in the last ${windowDays}d`,
        suggestion: `Capacity cooldowns already rotate ${stat.providerId} out for 2–30 min after each 429. If the peak hour repeats daily, expect the free quota reset then — schedule heavy runs around it.`,
      });
    }

    // Auth lock — 401/403 repeats mean the key is broken, not the quota.
    const auth = (stat.kinds["auth"] ?? 0) + (stat.kinds["model"] ?? 0);
    if (auth >= 3 && auth >= stat.fails * 0.5) {
      findings.push({
        id: `auth-lock:${stat.providerId}`,
        severity: "critical",
        providerId: stat.providerId,
        pattern: "auth-lock",
        evidence: `${auth} auth/model errors in the last ${windowDays}d — cooldowns cannot fix a bad key or a retired model id`,
        suggestion: `Check the ${stat.providerId} key in Settings (or drop retired model ids from its roster). Demoting until then.`,
        suggestedWeight: -2,
      });
    }
  }

  // Hard streaks — one hop died N times in a row (bypassing cooldowns).
  for (const [hopKey, h] of perHop.entries()) {
    if (h.maxStreak >= 4) {
      const providerId = hopKey.includes("::") ? hopKey.split("::")[0] : hopKey;
      findings.push({
        id: `hard-streak:${hopKey}`,
        severity: "warn",
        providerId,
        pattern: "hard-streak",
        evidence: `"${hopKey}" failed ${h.maxStreak} times in a row (last ${h.lastStreakEnd?.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
        suggestion: `The lane keeps dying without answering. Verify "${hopKey.split("::").slice(1).join("::")}" still exists upstream; consider removing it from the roster.`,
      });
    }
  }

  const peak = rateLimitHourHistogram.reduce(
    (best, v, i) => (v > rateLimitHourHistogram[best] ? i : best),
    0
  );
  const totalRateLimited = rateLimitHourHistogram.reduce((a, b) => a + b, 0);

  return {
    windowDays,
    totalEvents: events.length,
    providers,
    findings,
    rateLimitHourHistogram,
    ...(totalRateLimited > 0 ? { peakRateLimitHourUtc: peak } : {}),
  };
}
