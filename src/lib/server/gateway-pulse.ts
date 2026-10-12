import * as fs from "node:fs";
import * as path from "node:path";

import { liveRescueLane } from "@/lib/provider-rotation";

// ─── Gateway pulse (r161): server-side 429 observability ────────────────────
// The whole park-and-resume epic (r156–r158) made the CLIENT honest about
// rate limits, but the server — the one vantage point that sees EVERY
// completion dial through /api/chat (chat turns, workflow steps, headless
// autopilot) — noticed each 429 at agent-engine.ts and immediately forgot
// it. Cross-round questions like "is the shared gateway congesting again?"
// were unanswerable from the sandbox: runs and park state live in the
// browser's zustand store, and the client-side gateway-cadence module dies
// with the tab.
//
// This module is that missing vantage point: a capped in-memory ring of
// observed upstream 429s, write-through persisted to db/gateway-pulse.json
// so the signal survives dev-server restarts and stays readable via curl
// from outside the browser.
//
// HONEST SCOPE (do not oversell):
// - Counts ONLY completion dials made by the server (agent-engine). The
//   chat completion gateway is the shared free-tier bucket that kills
//   pipeline runs — that is the signal that matters.
// - Browser-direct BYOK dials never touch the server (by design — they are
//   the user's own keys and their own quota buckets).
// - Radar/HF/GitHub/tracker upstream 429s are different providers with
//   different buckets — deliberately NOT folded in here.
// - A restart truncates nothing (file is the source of truth on load), but
//   events older than 48h are pruned so the file cannot grow unbounded.

export interface Gateway429Event {
  /** Epoch ms when the upstream response returned 429. */
  t: number;
  /** The model id the failing dial requested (bare context, no key material). */
  model: string;
}

const CAP = 64;
const PRUNE_AFTER_MS = 48 * 60 * 60_000;
const DB_DIR = path.join(process.cwd(), "db");
const FILE = path.join(DB_DIR, "gateway-pulse.json");

let events: Gateway429Event[] = [];

/** Re-sync the in-memory ring FROM the file — the file is the source of
 * truth (external edits — QA reseeds, manual cleanup — must be honored on
 * the very next read, not shadowed by a process-lifetime cache). Falls back
 * to the existing in-memory ring only if the file is unreadable. */
function refresh(): Gateway429Event[] {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw) as { events?: Gateway429Event[] };
    if (Array.isArray(parsed.events)) {
      const cutoff = Date.now() - PRUNE_AFTER_MS;
      events = parsed.events
        .filter((e) => e && typeof e.t === "number" && e.t > cutoff)
        .slice(-CAP);
    }
  } catch {
    /* first run or unreadable file — keep whatever we have, never crash a dial over telemetry */
  }
  return events;
}

function persist(): void {
  try {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ events: events.slice(-CAP) }), "utf8");
  } catch {
    /* persistence is best-effort; the in-memory ring still serves this process */
  }
}

/** Called by the engine whenever an upstream completion dial returns 429. */
export function recordGateway429(model: string): void {
  const list = refresh();
  list.push({ t: Date.now(), model: String(model || "").slice(0, 120) });
  if (list.length > CAP) list.splice(0, list.length - CAP);
  persist();
}

export interface GatewayPulse {
  /** Epoch ms of the most recent observed 429 (null = none on record). */
  last429At: number | null;
  /** Observed 429s in the trailing hour / 24h (server-seen dials only). */
  count1h: number;
  count24h: number;
  /** Most recent events, oldest → newest (capped — the ring is the bound). */
  recent: Gateway429Event[];
  /** r438: the server lane's LIVE rescue lane — a no-key lane that fully
   * answered a recent congested dial and now leads the fallback walk.
   * Computed at read time from the in-memory r437 rescue map, NEVER
   * persisted; null = none live. Browser-tab engines keep their own. */
  rescueLane: { providerId: string; msLeft: number } | null;
}

export function gatewayPulse(): GatewayPulse {
  const list = refresh();
  const now = Date.now();
  const in1h = list.filter((e) => now - e.t < 3_600_000).length;
  const in24h = list.filter((e) => now - e.t < 86_400_000).length;
  return {
    last429At: list.length ? list[list.length - 1].t : null,
    count1h: in1h,
    count24h: in24h,
    recent: list.slice(-8),
    rescueLane: liveRescueLane(now),
  };
}
