/**
 * r672: fixture for the Cortex census adapter (dial-free) — persistence
 * round-trip, tolerant junk, HUD status lines, tone derivation.
 */
import {
  cortexCensusOf, cortexStatusLabel, ageLabel, persistCortexProbe, readCortexProbe,
  CORTEX_PROBE_STORE, type PersistedCortexProbe,
} from "../src/lib/cortex-census";

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass += 1; } else { fail += 1; console.log("FAIL: " + name); }
}

const NOW = 1_700_000_000_000;

// 1. unprobed census
const c0 = cortexCensusOf(null, NOW);
check("unprobed: tone + zeros", c0.probed === false && c0.tone === "unprobed" && c0.lanesArmed === 0);

// 2. online with full lane matrix
const online: PersistedCortexProbe = {
  at: NOW - 60_000, ok: true, ms: 34, edgeRegion: "fra1",
  lanes: { hyperbrowser: true, redis: true, vector: true, qstash: true, box: true, sharedSecretGate: true },
};
const c1 = cortexCensusOf(online, NOW);
check("online: 6/6 lanes", c1.online && c1.lanesArmed === 6 && c1.tone === "online");
check("online: age 1m", c1.ageMs === 60_000);

// 3. partial lanes (2 of 6)
const partial: PersistedCortexProbe = {
  at: NOW - 3_600_000, ok: true, ms: 120,
  lanes: { hyperbrowser: true, redis: false, vector: true, qstash: false, box: false, sharedSecretGate: false },
};
const c2 = cortexCensusOf(partial, NOW);
check("partial: 2/6 lanes", c2.lanesArmed === 2 && c2.tone === "online");

// 4. offline verdict
const off = cortexCensusOf({ at: NOW - 7_200_000, ok: false, ms: 8001, error: "ECONNREFUSED" }, NOW);
check("offline: tone offline", off.tone === "offline" && off.online === false);
check("offline: error preserved", off.error === "ECONNREFUSED");

// 5. HUD status lines (KICK vocabulary: // separators, uppercase)
check("unprobed line", cortexStatusLabel(cortexCensusOf(null, NOW), NOW) === "CORTEX // UNPROBED");
const l1 = cortexStatusLabel(c1, NOW);
check("online line", l1 === "CORTEX // ONLINE · 6/6 LANES · FRA1 · 34MS · 1m");
const l2 = cortexStatusLabel(off, NOW);
check("offline line has PROBED age", l2.startsWith("CORTEX // OFFLINE · 0/6 LANES · PROBED ") && l2.endsWith("AGO"));

// 6. age labels
check("age just-now", ageLabel(30_000, NOW) === "just now");
check("age minutes", ageLabel(5 * 60_000, NOW) === "5m");
check("age hours", ageLabel(3 * 3_600_000, NOW) === "3h");
check("age days", ageLabel(26 * 3_600_000, NOW) === "1d");
check("age negative → just now", ageLabel(-5, NOW) === "just now");

// 7. persistence: never-throw everywhere; round-trip only where storage is writable
let canStore = false;
try {
  localStorage.setItem(CORTEX_PROBE_STORE, "warm");
  canStore = true;
} catch {
  canStore = false;
}
// persistCortexProbe must NEVER throw — even when storage is unavailable.
let neverThrew = true;
try {
  persistCortexProbe(online);
} catch {
  neverThrew = false;
}
check("persist never throws", neverThrew);
if (canStore) {
  const back = readCortexProbe();
  check("persist round-trip", back !== null && back.ok === true && back.ms === 34 && back.lanes?.qstash === true);
  localStorage.setItem(CORTEX_PROBE_STORE, "{junk not json");
  check("junk read → null", readCortexProbe() === null);
  localStorage.setItem(CORTEX_PROBE_STORE, JSON.stringify({ at: "no", ok: 1 }));
  check("shape-violating read → null", readCortexProbe() === null);
  localStorage.removeItem(CORTEX_PROBE_STORE);
  check("missing read → null", readCortexProbe() === null);
} else {
  check("read on unavailable storage → null (never-throw)", readCortexProbe() === null);
  console.log("NOTE: localStorage unwritable in this runtime — round-trip covered by browser QA");
}

// 8. r709: DIRECT transport — the edge-less Upstash dial named in the census
const directOnline: PersistedCortexProbe = {
  at: NOW - 60_000, ok: true, ms: 214,
  lanes: { hyperbrowser: false, redis: false, vector: true, qstash: true, box: false, sharedSecretGate: false },
  transports: { vector: "upstash-direct", qstash: "upstash-direct", box: "upstash-direct" },
};
const c3 = cortexCensusOf(directOnline, NOW);
check("direct online: census counts trio", c3.online && c3.lanesArmed === 2 && c3.tone === "online");
check(
  "direct online line names transport",
  cortexStatusLabel(c3, NOW) === "CORTEX // DIRECT · UPSTASH 2/3 · 214MS · 1m",
);
const directOff: PersistedCortexProbe = {
  at: NOW - 30_000, ok: false, ms: 421,
  transports: { vector: "upstash-direct", qstash: "upstash-direct", box: "upstash-direct" },
};
const c4 = cortexCensusOf(directOff, NOW);
check(
  "direct offline line names EDGE OFF + UPSTASH 0/3",
  cortexStatusLabel(c4, NOW) === "CORTEX // OFFLINE · EDGE OFF · UPSTASH 0/3 · PROBED JUST NOW",
);
// edge verdicts with transports stay on the classic ONLINE line (no DIRECT leakage)
const edgeWithT = { ...online, transports: { vector: "edge", qstash: "edge", box: "edge" } as const };
check(
  "edge transports keep classic line",
  cortexStatusLabel(cortexCensusOf(edgeWithT, NOW), NOW) === "CORTEX // ONLINE · 6/6 LANES · FRA1 · 34MS · 1m",
);
if (canStore) {
  persistCortexProbe(directOnline);
  const back = readCortexProbe();
  check(
    "transports round-trip",
    back?.transports?.vector === "upstash-direct" && back?.transports?.qstash === "upstash-direct",
  );
}

console.log(`qa-cortex-census: ${pass}/${pass + fail}`);
if (fail > 0) process.exit(1);
