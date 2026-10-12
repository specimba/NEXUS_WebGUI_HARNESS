/**
 * r416 unit witness: the tracker mirror boot path must stay honest about the
 * lane count while `tracked` is trimmed to the renderable surface.
 * Exercises parseTrackerMirror directly (kept DOM-free for exactly this — r210).
 */
import { parseTrackerMirror } from "../src/lib/tracker-types";

const row = (i: number) => ({
  id: `p::m${i}`,
  providerId: "vyce",
  modelId: `model-${i}`,
  contextWindow: 128000,
  priceIn: 0,
  priceOut: 0,
  free: true,
  isNew: i < 3,
  firstSeenAt: new Date(Date.now() - i * 60_000).toISOString(),
});

// 1. NEW mirror shape: trimmed tracked + trackedTotal alongside.
const trimmed = JSON.stringify({
  at: Date.now(),
  tracked: Array.from({ length: 60 }, (_, i) => row(i)),
  events: [],
  trackedTotal: 160,
  lastSyncAt: new Date().toISOString(),
});
const a = parseTrackerMirror(trimmed);
if (a.kind !== "data") throw new Error(`expected data, got ${a.kind}`);
if (a.data.status.trackedTotal !== 160) throw new Error(`trackedTotal should be 160, got ${a.data.status.trackedTotal}`);
if (a.data.tracked.length !== 60) throw new Error(`tracked should be 60, got ${a.data.tracked.length}`);
console.log("PASS trimmed mirror: tracked=60, trackedTotal=160 surfaced into status");

// 2. OLD mirror shape (pre-r416 blob on existing machines): no trackedTotal —
// must parse cleanly and leave trackedTotal undefined (not NaN/0).
const legacy = JSON.stringify({
  at: Date.now(),
  tracked: Array.from({ length: 120 }, (_, i) => row(i)),
  events: [{ id: "e1", type: "new", providerId: "vyce", modelId: "m", createdAt: new Date().toISOString() }],
  lastSyncAt: null,
});
const b = parseTrackerMirror(legacy);
if (b.kind !== "data") throw new Error(`expected data, got ${b.kind}`);
if (b.data.status.trackedTotal !== undefined) throw new Error(`legacy trackedTotal should be undefined, got ${b.data.status.trackedTotal}`);
if (b.data.tracked.length !== 120) throw new Error(`legacy tracked should stay 120, got ${b.data.tracked.length}`);
console.log("PASS legacy mirror: parses, trackedTotal=undefined, all 120 rows kept");

// 3. Consumer fallback contract: header shows trackedTotal ?? tracked.length.
const headerCount = (d: { status: { trackedTotal?: number }; tracked: unknown[] }) =>
  d.status.trackedTotal ?? d.tracked.length;
if (headerCount(a.data) !== 160) throw new Error("trimmed header count should be 160");
if (headerCount(b.data) !== 120) throw new Error("legacy header count should be 120");
console.log("PASS header fallback: trimmed shows true 160, legacy shows full 120");
console.log("ALL r416 MIRROR UNIT WITNESSES GREEN");
