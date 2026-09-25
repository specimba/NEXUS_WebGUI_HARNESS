/**
 * r49 unit tests — the failover state machine + event funnel + watchdog.
 * Run: bun scripts/test-router-failover.ts
 * (relay.ts touches localStorage lazily — stub it before importing.)
 */
import type { Settings } from "../src/lib/types";

// Minimal localStorage stub (relay health + live catalog read/write here).
const store = new Map<string, string>();
const ls = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
  key: () => null,
  get length() {
    return store.size;
  },
} as Storage;
(globalThis as { localStorage?: Storage }).localStorage = ls;

import {
  CAPACITY_COOLDOWN_BASE_MS,
  CAPACITY_COOLDOWN_MAX_MS,
  MAX_RELAY_HOPS,
  STRUCTURAL_COOLDOWN_BASE_MS,
  STRUCTURAL_COOLDOWN_MAX_MS,
  SWEEP_MIN_GAP_MS,
  buildRelayChain,
  buildRelayWire,
  capacityCooldownMs,
  interleaveByProvider,
  isCapacityCooled,
  isCapacityError,
  isHardRelayFailure,
  isStructuralCreditsError,
  laneReliabilityPenalty,
  providerInCooldown,
  recordProbeResult,
  recordRelayHopResult,
  relayHealthSnapshot,
  resetRelayHealth,
  selectSweepCandidates,
  structuralCooldownMs,
} from "../src/lib/relay";
import {
  classifyRelayKind,
  flushRelayEvents,
  recordFromStatusLine,
  stripRelayMarkers,
} from "../src/lib/relay-events";
import { buildWatchdogReport, type WatchdogEventRow } from "../src/lib/router-watchdog";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

// ─── The user's exact observed error (the round's founding artifact) ─────────
const ORCA_CAPACITY_MSG =
  "Free model capacity is limited right now. Retry shortly, or add credits for higher, more stable limits: https://www.orcarouter.ai/console/billing | Recharging will increase your access frequency. (request id: 202609240541388618740118268d9d69cmOQTZg)";

console.log("classifier — the user's exact OrcaRouter capacity message:");
check("isCapacityError recognizes it", isCapacityError(ORCA_CAPACITY_MSG) === true);
check("isHardRelayFailure treats it as SOFT (capacity, not death)", isHardRelayFailure(ORCA_CAPACITY_MSG) === false);
check("plain 402 stays HARD", isHardRelayFailure("Out of credits (HTTP 402)") === true);
check("429 stays soft", isHardRelayFailure("Rate limit exceeded (HTTP 429)") === false);
check("network death stays hard", isHardRelayFailure("fetch failed") === true);
check("request-id digit runs don't trip the 4xx regex", isHardRelayFailure("error 202609240541388618740118268d9d69cmOQTZg happened") === true);

console.log("cooldown math (escalating, jittered, capped):");
check("1st capacity fail → ~2 min base", capacityCooldownMs(1, 0.5) === CAPACITY_COOLDOWN_BASE_MS);
check("2nd → 4 min", capacityCooldownMs(2, 0.5) === 4 * 60_000);
check("3rd → 8 min", capacityCooldownMs(3, 0.5) === 8 * 60_000);
check("cap at 30 min", capacityCooldownMs(12, 0.5) === CAPACITY_COOLDOWN_MAX_MS);
check("jitter −20% at rand=0", capacityCooldownMs(1, 0) === Math.round(CAPACITY_COOLDOWN_BASE_MS * 0.8));
check("jitter +20% at rand=1", capacityCooldownMs(1, 1) === Math.round(CAPACITY_COOLDOWN_BASE_MS * 1.2));
check("garbage fails clamp to 1", capacityCooldownMs(0, 0.5) === CAPACITY_COOLDOWN_BASE_MS);

console.log("STATE machine (recordRelayHopResult):");
resetRelayHealth();
recordRelayHopResult("orcarouter::z-ai/glm-5.3", false, ORCA_CAPACITY_MSG);
let e = relayHealthSnapshot()["orcarouter::z-ai/glm-5.3"];
check("capacity failure enters a cooldown (cooldownUntil in the future)", isCapacityCooled(e) === true);
check("cooldown counter starts at 1", e?.cooldownCount === 1);
check("soft flag set", e?.soft === true);
const firstUntil = e?.cooldownUntil ?? 0;
recordRelayHopResult("orcarouter::z-ai/glm-5.3", false, "Rate limit exceeded (HTTP 429)");
e = relayHealthSnapshot()["orcarouter::z-ai/glm-5.3"];
check("repeat failure escalates the cooldown", (e?.cooldownUntil ?? 0) > firstUntil);
check("cooldown counter escalates", e?.cooldownCount === 2);
recordRelayHopResult("orcarouter::z-ai/glm-5.3", true);
e = relayHealthSnapshot()["orcarouter::z-ai/glm-5.3"];
check("STATE 2 success clears the cooldown (recovery bonus)", isCapacityCooled(e) === false && e?.cooldownCount === 0);
recordRelayHopResult("orcarouter::z-ai/glm-5.3", false, ORCA_CAPACITY_MSG);
recordRelayHopResult("orcarouter::z-ai/glm-5.3", false, "fetch failed — connection dropped");
e = relayHealthSnapshot()["orcarouter::z-ai/glm-5.3"];
check("hard failure invalidates cooling grace (broken ≠ throttled)", isCapacityCooled(e) === false && e?.soft === false);
check("providerInCooldown true while a lane cools", (() => {
  resetRelayHealth();
  recordRelayHopResult("vyce::deepseek-v4.1", false, ORCA_CAPACITY_MSG);
  return providerInCooldown("vyce") === true;
})());
check("providerInCooldown false after the clock runs out", (() => {
  const h = relayHealthSnapshot();
  const k = "vyce::deepseek-v4.1";
  if (h[k]) h[k].cooldownUntil = Date.now() - 1;
  ls.setItem("praison-relay-health", JSON.stringify(h));
  return providerInCooldown("vyce") === false;
})());

console.log("probe loop (recordProbeResult):");
check("probe pass revives a cooled lane", (() => {
  resetRelayHealth();
  recordRelayHopResult("kilo::kilo-auto/free", false, ORCA_CAPACITY_MSG);
  recordProbeResult("kilo::kilo-auto/free", true);
  const h = relayHealthSnapshot()["kilo::kilo-auto/free"];
  return isCapacityCooled(h) === false && (h?.ok ?? 0) === 1;
})());
check("probe fail doubles the remaining cooldown (capped)", (() => {
  resetRelayHealth();
  recordRelayHopResult("kilo::kilo-auto/free", false, ORCA_CAPACITY_MSG);
  recordProbeResult("kilo::kilo-auto/free", false, "still throttled (HTTP 429)");
  const h = relayHealthSnapshot()["kilo::kilo-auto/free"];
  const remain = (h?.cooldownUntil ?? 0) - Date.now();
  return h?.cooldownCount === 2 && remain > 3 * 60_000 && remain <= CAPACITY_COOLDOWN_MAX_MS;
})());

console.log("structural credits — the ACCOUNT shape (r54):");
check("402 detector", isStructuralCreditsError("Out of credits (HTTP 402): needs $0.02") === true && isStructuralCreditsError("Rate limit exceeded (HTTP 429)") === false);
check("structural escalation: base 10 min → ×2 → capped 4 h", (() => {
  return (
    structuralCooldownMs(1, 0.5) === STRUCTURAL_COOLDOWN_BASE_MS &&
    structuralCooldownMs(2, 0.5) === 2 * STRUCTURAL_COOLDOWN_BASE_MS &&
    structuralCooldownMs(30, 0.5) === STRUCTURAL_COOLDOWN_MAX_MS &&
    STRUCTURAL_COOLDOWN_MAX_MS > CAPACITY_COOLDOWN_MAX_MS
  );
})());
check("402 puts the lane in a LONG cooldown (> capacity base)", (() => {
  resetRelayHealth();
  recordRelayHopResult("orcarouter::kimi/kimi-k3", false, "Out of credits (HTTP 402): You're out of credits — this request needs $0.02. Add credits t…");
  const e = relayHealthSnapshot()["orcarouter::kimi/kimi-k3"];
  const remain = (e?.cooldownUntil ?? 0) - Date.now();
  return isCapacityCooled(e) === true && remain > CAPACITY_COOLDOWN_BASE_MS;
})());
check("sibling lanes cool with the account (provider-wide)", (() => {
  recordRelayHopResult("orcarouter::z-ai/glm-5.3", true); // sibling exists with history
  recordRelayHopResult("orcarouter::kimi/kimi-k3", false, "Out of credits (HTTP 402): needs $0.02");
  const sib = relayHealthSnapshot()["orcarouter::z-ai/glm-5.3"];
  return providerInCooldown("orcarouter") === true && isCapacityCooled(sib) === true && sib?.lastError === "account out of credits";
})());
check("repeat 402s escalate the structural window", (() => {
  const before = relayHealthSnapshot()["orcarouter::kimi/kimi-k3"]?.cooldownUntil ?? 0;
  recordRelayHopResult("orcarouter::kimi/kimi-k3", false, "Out of credits (HTTP 402): needs $0.02");
  const after = relayHealthSnapshot()["orcarouter::kimi/kimi-k3"]?.cooldownUntil ?? 0;
  return after > before;
})());
check("a failing probe never SHORTENS a structural cooldown", (() => {
  resetRelayHealth();
  recordRelayHopResult("orcarouter::kimi/kimi-k3", false, "Out of credits (HTTP 402): needs $0.02");
  recordRelayHopResult("orcarouter::kimi/kimi-k3", false, "Out of credits (HTTP 402): needs $0.02");
  recordRelayHopResult("orcarouter::kimi/kimi-k3", false, "Out of credits (HTTP 402): needs $0.02");
  const before = relayHealthSnapshot()["orcarouter::kimi/kimi-k3"]?.cooldownUntil ?? 0;
  recordProbeResult("orcarouter::kimi/kimi-k3", false, "still 402 during probe");
  const after = relayHealthSnapshot()["orcarouter::kimi/kimi-k3"]?.cooldownUntil ?? 0;
  return after >= before;
})());
check("a passing probe still re-admits a structurally-cooled lane", (() => {
  recordProbeResult("orcarouter::kimi/kimi-k3", true);
  const h = relayHealthSnapshot()["orcarouter::kimi/kimi-k3"];
  return isCapacityCooled(h) === false && isCapacityCooled(relayHealthSnapshot()["orcarouter::z-ai/glm-5.3"]) === false;
})());
check("hard network death still invalidates cooling grace", (() => {
  resetRelayHealth();
  recordRelayHopResult("orcarouter::kimi/kimi-k3", false, "Out of credits (HTTP 402): needs $0.02");
  recordRelayHopResult("orcarouter::kimi/kimi-k3", false, "fetch failed — connection dropped");
  const e = relayHealthSnapshot()["orcarouter::kimi/kimi-k3"];
  return isCapacityCooled(e) === false && e?.soft === false;
})());

console.log("chain integration (cooled lanes excluded while healthy alternatives exist):");
const settings: Settings = {
  provider: "custom",
  apiKey: "",
  baseUrl: "",
  defaultModel: "",
  temperature: 0.7,
  framework: "custom",
  displayName: "QA",
  seeded: true,
  providerKeys: {
    vyce: { key: "v_test" },
    opencode: { key: "oc_test" },
    orcarouter: { key: "orca_test" },
  },
  relayWeights: {},
} as unknown as Settings;
check("cooled lane drops out of the chain (≥4 healthy remain)", (() => {
  resetRelayHealth();
  recordRelayHopResult("orcarouter::z-ai/glm-5.3", false, ORCA_CAPACITY_MSG);
  const chain = buildRelayChain(settings);
  return chain.length > 4 && !chain.some((h) => h.key === "orcarouter::z-ai/glm-5.3");
})());
check("watchdog weight demotion sinks a provider's lanes", (() => {
  resetRelayChain_check: {
    resetRelayHealth();
    const demoted: Settings = { ...settings, relayWeights: { orcarouter: -2 } } as Settings;
    const chain = buildRelayChain(demoted, { taskFit: "any" });
    const firstOrca = chain.findIndex((h) => h.providerId === "orcarouter");
    const firstVyce = chain.findIndex((h) => h.providerId === "vyce");
    return firstOrca > firstVyce && firstVyce >= 0 && firstOrca >= 0;
  }
})());
check("weight +2 promotes a provider past higher tiers", (() => {
  resetRelayHealth();
  const boosted: Settings = { ...settings, relayWeights: { orcarouter: 2 }, providerKeys: { ...settings.providerKeys, vyce: { key: "v_test" } } } as Settings;
  const chain = buildRelayChain(boosted, { taskFit: "any" });
  return chain[0].providerId === "orcarouter";
})());
resetRelayHealth();

// ─── relay-events funnel ──────────────────────────────────────────────────────

console.log("event funnel (recordFromStatusLine):");
check("non-relay lines return null untouched", recordFromStatusLine("Writing files…") === null);
check(
  "markers stripped from the display prose",
  stripRelayMarkers("Model relay: Vyce AI · deepseek-v4.1 failed (boom) — rotating to Kilo… [hop:vyce::deepseek-v4.1][req:req-123]") ===
    "Model relay: Vyce AI · deepseek-v4.1 failed (boom) — rotating to Kilo…"
);

type CapturedReq = { url: string; body: unknown }[];
const captured: CapturedReq = [];
(globalThis as { fetch?: unknown }).fetch = (async (url: string | URL, init?: { method?: string; body?: string }) => {
  captured.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
  return new Response(JSON.stringify({ ok: true, inserted: 1 }), { status: 200 });
}) as typeof fetch;

check("fail line records health + queues an event", (() => {
  resetRelayHealth();
  captured.length = 0;
  const clean = recordFromStatusLine(
    "Model relay: OrcaRouter · z-ai/glm-5.3 failed (Free model capacity is limited right now) — rotating to Kilo… [hop:orcarouter::z-ai/glm-5.3][req:abc-42]",
    "browser"
  );
  const healthOk = providerInCooldown("orcarouter") === true;
  void flushRelayEvents();
  const evt = (captured[0]?.body as { events?: Record<string, unknown>[] })?.events?.[0];
  return (
    clean !== null &&
    !clean.includes("[hop:") &&
    !clean.includes("[req:") &&
    healthOk &&
    evt?.requestId === "abc-42" &&
    evt?.hopKey === "orcarouter::z-ai/glm-5.3" &&
    evt?.ok === false &&
    evt?.kind === "rate-limit" &&
    evt?.action === "cooled"
  );
})());
check("ok line (hopok) records a served event", (() => {
  captured.length = 0;
  const clean = recordFromStatusLine(
    "Model relay: Kilo Gateway · kilo-auto/free answered ✓ [hopok:kilo::kilo-auto/free][req:abc-42]",
    "browser"
  );
  void flushRelayEvents();
  const evt = (captured[0]?.body as { events?: Record<string, unknown>[] })?.events?.[0];
  return clean !== null && evt?.ok === true && evt?.action === "served" && evt?.requestId === "abc-42";
})());
check("[exhausted] marks the chain's last-lane failure", (() => {
  captured.length = 0;
  const clean = recordFromStatusLine(
    "Model relay: chain exhausted — Built-in engine was the last lane to fail (boom) [hop:auto::builtin][req:abc-42][exhausted]",
    "server"
  );
  void flushRelayEvents();
  const evt = (captured[0]?.body as { events?: Record<string, unknown>[] })?.events?.[0];
  return clean !== null && evt?.action === "exhausted" && evt?.transport === "server";
})());
check("identical line dedupes to one event", (() => {
  captured.length = 0;
  const line =
    "Model relay: X failed (Rate limit exceeded) — rotating… [hop:a::m1][req:r9]";
  recordFromStatusLine(line);
  recordFromStatusLine(line);
  void flushRelayEvents();
  const events = (captured[0]?.body as { events?: unknown[] })?.events ?? [];
  return events.length === 1;
})());
check("classifyRelayKind taxonomy", (() => {
  const cases: [string, string][] = [
    ["Rate limit exceeded (HTTP 429)", "rate-limit"],
    [ORCA_CAPACITY_MSG, "rate-limit"],
    ["Out of credits (HTTP 402): needs $0.03", "credits"],
    ["Unauthorized (HTTP 401)", "auth"],
    ["no such model: x (HTTP 404)", "model"],
    ["upstream deadline exceeded", "timeout"],
    ["fetch failed", "network"],
  ];
  return cases.every(([msg, kind]) => classifyRelayKind(msg) === kind);
})());
check("probe-tagged lines never double-record health", (() => {
  resetRelayHealth();
  const clean = recordFromStatusLine("lane re-admitted [probe:kilo::kilo-auto/free]");
  const h = relayHealthSnapshot();
  return clean !== null && !h["kilo::kilo-auto/free"];
})());

// ─── watchdog report ──────────────────────────────────────────────────────────

console.log("watchdog report:");
const rows = (n: number, fn: (i: number) => Partial<WatchdogEventRow>): WatchdogEventRow[] =>
  Array.from({ length: n }, (_, i) => ({
    requestId: `r${i}`,
    hopKey: "p::m",
    providerId: "p",
    modelId: "m",
    ok: true,
    createdAt: new Date("2026-09-24T10:00:00Z"),
    ...fn(i),
  })) as WatchdogEventRow[];

check("empty log → no findings, no crash", (() => {
  const r = buildWatchdogReport([], 7);
  return r.findings.length === 0 && r.totalEvents === 0 && r.rateLimitHourHistogram.length === 24;
})());
check("high fail rate (≥60% of ≥6) → demotion suggestion (−1)", (() => {
  const evts = [
    ...rows(2, () => ({ ok: true })),
    ...rows(6, (i) => ({ ok: false, kind: "network", hopKey: "p::m", createdAt: new Date(Date.UTC(2026, 8, 24, 3, i)) })),
  ];
  const r = buildWatchdogReport(evts, 7);
  const f = r.findings.find((x) => x.pattern === "high-fail-rate");
  return !!f && f.suggestedWeight === -1 && f.severity === "warn";
})());
check("critical fail rate (≥80%) escalates severity", (() => {
  const evts = [...rows(1, () => ({ ok: true })), ...rows(8, () => ({ ok: false, kind: "network" }))];
  const r = buildWatchdogReport(evts, 7);
  return r.findings.find((x) => x.pattern === "high-fail-rate")?.severity === "critical";
})());
check("capacity-cycle: 429 rhythm is INFO, never a demotion", (() => {
  const evts = [
    ...rows(2, () => ({ ok: true })),
    ...rows(5, () => ({ ok: false, kind: "rate-limit", createdAt: new Date("2026-09-24T03:30:00Z") })),
  ];
  const r = buildWatchdogReport(evts, 7);
  const f = r.findings.find((x) => x.pattern === "capacity-cycle");
  return !!f && f.suggestedWeight === undefined && r.peakRateLimitHourUtc === 3;
})());
check("auth-lock: repeated 401s → critical with −2", (() => {
  const evts = [...rows(2, () => ({ ok: true })), ...rows(4, () => ({ ok: false, kind: "auth" }))];
  const r = buildWatchdogReport(evts, 7);
  const f = r.findings.find((x) => x.pattern === "auth-lock");
  return !!f && f.severity === "critical" && f.suggestedWeight === -2;
})());
check("hard streak: 4 consecutive failures on one hop → warn", (() => {
  const evts = [
    ...rows(2, () => ({ ok: true })),
    ...rows(4, (i) => ({ ok: false, kind: "network", hopKey: "p::dead-lane", createdAt: new Date(Date.UTC(2026, 8, 20, i)) })),
  ];
  const r = buildWatchdogReport(evts, 7);
  const f = r.findings.find((x) => x.pattern === "hard-streak");
  return !!f && f.providerId === "p" && f.evidence.includes("p::dead-lane");
})());
check("sparse providers (<6 attempts) never produce findings", (() => {
  const evts = rows(3, () => ({ ok: false, kind: "network" }));
  return buildWatchdogReport(evts, 7).findings.length === 0;
})());

console.log("r54 deep-dive detections:");
check("structural-credits: 402-mass provider → critical with −1", (() => {
  const evts = [...rows(1, () => ({ ok: true })), ...rows(6, () => ({ ok: false, kind: "credits" }))];
  const r = buildWatchdogReport(evts, 7);
  const f = r.findings.find((x) => x.pattern === "structural-credits");
  return !!f && f.severity === "critical" && f.suggestedWeight === -1;
})());
check("stall-dominant: mid-stream timeout ratio → warn on the LANE", (() => {
  const evts = [
    ...rows(2, () => ({ ok: true })),
    ...rows(5, () => ({ ok: false, kind: "timeout", hopKey: "vyce::deepseek-v4.1", providerId: "vyce", modelId: "deepseek-v4.1" })),
  ];
  const r = buildWatchdogReport(evts, 7);
  const f = r.findings.find((x) => x.pattern === "stall-dominant");
  return !!f && f.providerId === "vyce" && f.evidence.includes("vyce::deepseek-v4.1");
})());
check("stale-model: repeated model-not-found → warn", (() => {
  const evts = [
    ...rows(3, () => ({ ok: true })),
    ...rows(2, () => ({ ok: false, kind: "model", hopKey: "groq::llama-3.3-70b-versatile", providerId: "groq", modelId: "llama-3.3-70b-versatile" })),
  ];
  const r = buildWatchdogReport(evts, 7);
  const f = r.findings.find((x) => x.pattern === "stale-model");
  return !!f && f.evidence.includes("groq::llama-3.3-70b-versatile");
})());
check("single-lane-vault: ≥90% of successes from one lane → warn", (() => {
  const evts = [
    ...rows(12, () => ({ ok: true, hopKey: "vyce::deepseek-v4-flash-lr", providerId: "vyce", modelId: "deepseek-v4-flash-lr" })),
    ...rows(1, () => ({ ok: true, hopKey: "groq::openai/gpt-oss-120b", providerId: "groq", modelId: "openai/gpt-oss-120b" })),
  ];
  const r = buildWatchdogReport(evts, 7);
  const f = r.findings.find((x) => x.pattern === "single-lane-vault");
  return !!f && f.providerId === "vyce" && f.evidence.includes("13");
})());
check("no single-lane-vault while the fleet actually answers", (() => {
  const evts = [
    ...rows(6, () => ({ ok: true, hopKey: "vyce::a", providerId: "vyce" })),
    ...rows(5, () => ({ ok: true, hopKey: "kilo::b", providerId: "kilo" })),
  ];
  return !buildWatchdogReport(evts, 7).findings.some((x) => x.pattern === "single-lane-vault");
})());

console.log("r54 lane reliability + roster sweep:");
check("laneReliabilityPenalty boundaries", (() => {
  const none = laneReliabilityPenalty(undefined) === 0;
  const sparse = laneReliabilityPenalty({ ok: 1, fail: 4 }) === 0; // 5 obs — not enough
  const mid = laneReliabilityPenalty({ ok: 3, fail: 3 }) === 1; // ratio 0.5
  const bad = laneReliabilityPenalty({ ok: 17, fail: 30 }) === 2; // the real 7d shape
  const good = laneReliabilityPenalty({ ok: 13, fail: 0 }) === 0;
  return none && sparse && mid && bad && good;
})());
check("chronic stallers sink below reliable siblings in the chain", (() => {
  resetRelayHealth();
  const h = relayHealthSnapshot();
  h["vyce::deepseek-v4.1"] = { ok: 17, fail: 30, lastOkAt: Date.now() };
  ls.setItem("praison-relay-health", JSON.stringify(h));
  const chain = buildRelayChain(settings);
  const lr = chain.findIndex((x) => x.key === "vyce::deepseek-v4-flash-lr");
  const apex = chain.findIndex((x) => x.key === "vyce::deepseek-v4.1");
  resetRelayHealth();
  return lr !== -1 && apex !== -1 && lr < apex;
})());
check("sweep selector: never-verified first, fresh lanes skipped, deterministic", (() => {
  const now = Date.now();
  const health: Record<string, { ok: number; fail: number; lastOkAt?: number; lastProbeAt?: number }> = {
    "a::fresh": { ok: 5, fail: 0, lastOkAt: now - 60 * 60_000 },
    "b::old-probe": { ok: 1, fail: 1, lastProbeAt: now - 7 * 60 * 60_000 },
    "c::never": { ok: 0, fail: 0 },
    "d::mid": { ok: 2, fail: 0, lastOkAt: now - 2 * 60 * 60_000 },
  };
  const picked = selectSweepCandidates(
    ["a::fresh", "b::old-probe", "c::never", "d::mid"],
    health,
    now,
    2
  );
  const tie = selectSweepCandidates(["z::a", "a::z"], {}, now, 5);
  return (
    JSON.stringify(picked) === JSON.stringify(["c::never", "b::old-probe"]) &&
    JSON.stringify(tie) === JSON.stringify(["a::z", "z::a"]) &&
    selectSweepCandidates(["a::fresh"], health, now, 2).length === 0 &&
    SWEEP_MIN_GAP_MS === 6 * 60 * 60_000
  );
})());

console.log("r51 fleet engagement (interleaveByProvider + wire diversity):");
check("round-robin preserves per-provider order, rotates providers", (() => {
  const mk = (id: string, m: string) => ({ key: `${id}::${m}`, providerId: id, model: m, label: m, tier: 2 as const, elo: 0.9 });
  const out = interleaveByProvider([
    mk("a", "a1"), mk("a", "a2"), mk("a", "a3"),
    mk("b", "b1"),
    mk("c", "c1"), mk("c", "c2"),
  ]);
  return (
    out.map((h) => h.key).join(",") === "a::a1,b::b1,c::c1,a::a2,c::c2,a::a3" &&
    JSON.stringify(out) === JSON.stringify(interleaveByProvider(out.map((o) => mk(o.providerId, o.model)))) // deterministic
  );
})());
check("empty input → empty output", interleaveByProvider([]).length === 0);
{
  // Full-vault diversity: 8 keyed providers → the wire must span them all
  // instead of letting one provider's high-Elo lanes eat every slot.
  const fleet: Settings = {
    seeded: true,
    providerKeys: {
      vyce: { key: "k1" },
      aihubmix: { key: "k2" },
      orcarouter: { key: "k3" },
      "google-ai-studio": { key: "k4" },
      groq: { key: "k5" },
      openrouter: { key: "k6" },
      opencode: { key: "k7" },
      kilo: { key: "k8" },
    },
    relayWeights: {},
  } as unknown as Settings;
  resetRelayHealth();
  const wire = buildRelayWire(fleet, { providerId: "vyce", model: "deepseek-v4.1" });
  check("wire respects the hop cap", wire.length <= MAX_RELAY_HOPS);
  check("built-in engine backstop ALWAYS rides last (was sliced off pre-r51)", wire[wire.length - 1]?.useAuto === true);
  // RelayWireHop carries no ids by design (stateless wire) — derive the
  // provider from the hop key "providerId::model".
  const providerOf = (h: (typeof wire)[number]) => (h.key ?? "").split("::")[0];
  const nonAuto = wire.filter((h) => !h.useAuto);
  const distinct = new Set(nonAuto.map(providerOf));
  check(`wire spans the keyed fleet (8 distinct providers across ${nonAuto.length} hops)`, distinct.size >= 8);
  check("no single provider hogs the wire (>2 slots)", [...distinct.values()].every((p) => nonAuto.filter((h) => providerOf(h) === p).length <= 2));
  check("primary lane excluded from the wire", !wire.some((h) => h.key === "vyce::deepseek-v4.1"));
  check("wire is deterministic (same input, same wire)", JSON.stringify(wire) === JSON.stringify(buildRelayWire(fleet, { providerId: "vyce", model: "deepseek-v4.1" })));
}
check("saved relayOrder is an explicit doctrine — interleave skipped", (() => {
  resetRelayHealth();
  const ordered: Settings = {
    seeded: true,
    providerKeys: { vyce: { key: "v" }, opencode: { key: "o" }, orcarouter: { key: "r" } },
    relayWeights: {},
    relayOrder: ["opencode::claude-fable-5", "vyce::deepseek-v4.1"],
  } as unknown as Settings;
  const chain = buildRelayChain(ordered);
  const first = chain.findIndex((h) => h.key === "opencode::claude-fable-5");
  const second = chain.findIndex((h) => h.key === "vyce::deepseek-v4.1");
  return first !== -1 && second !== -1 && first < second;
})());
resetRelayHealth();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
