/**
 * r672 (Owner deep-dive ship, KICKspeciBOT adaptation): the Cortex census —
 * a shared adapter that turns the Settings card's EPHEMERAL probe result into
 * a PERSISTED, always-readable liveness verdict. Kills the literal staleness:
 * before this, the probe state died with the component (useState) and the
 * card's "lane armed" badge stayed green even while the edge function was
 * down (KB-1-b audit finding #3).
 *
 * Doctrine lineage:
 * - gate-census.ts (r668-r670): the census lives in the data layer, not the
 *   DOM — same shape here, for the Cortex probe.
 * - KICK corpus (upload/kickbot, KB-1-a): HUD telemetry vocabulary —
 *   `//`-separated mono label codes (`CORTEX // ACTIVE`, `SYS://IDLE`).
 *   Adopted as VOCABULARY, not palette (our emerald/amber/violet tones stay).
 *
 * Storage contract: localStorage key CORTEX_PROBE_STORE, one small JSON blob
 * holding ONLY census-relevant fields (ok/ms/region/lanes/rate counts) —
 * never the shared secret, never BYOK keys (redaction-choke doctrine, r524).
 */

/** localStorage key for the persisted probe verdict (versioned, r649 purge-friendly). */
export const CORTEX_PROBE_STORE = "nexus.cortex-probe.v1";

/** Freshness window: older than this and the card auto-probes on mount. */
export const CORTEX_PROBE_FRESH_MS = 15 * 60 * 1000;

/** r709: how a lane answered — the edge function, the app-server direct dial (Upstash REST or Hyperbrowser), or off. r710: "direct" = the Hyperbrowser key's own auth verdict. */
export type CortexLaneTransport = "edge" | "direct" | "upstash-direct" | "off";

/** r709: per-lane transport map — census metadata only, never secrets. */
export interface CortexTransports {
  hyperbrowser?: CortexLaneTransport;
  redis?: CortexLaneTransport;
  vector?: CortexLaneTransport;
  qstash?: CortexLaneTransport;
  box?: CortexLaneTransport;
}

/** The persisted shape — everything the census needs, nothing it must not hold. */
export interface PersistedCortexProbe {
  /** When the probe ran (epoch ms). */
  at: number;
  ok: boolean;
  ms: number;
  edgeRegion?: string;
  /** v2 lane matrix, persisted verbatim when present. */
  lanes?: {
    hyperbrowser: boolean;
    redis: boolean;
    vector: boolean;
    qstash: boolean;
    box: boolean;
    sharedSecretGate: boolean;
  };
  /** r709: WHICH transport answered, per lane (census truth, no silent fallbacks). */
  transports?: CortexTransports;
  error?: string;
}

/** The derived census — what every surface renders from. */
export interface CortexCensus {
  /** A probe verdict exists at all. */
  probed: boolean;
  online: boolean;
  /** Lanes answering true in the last probe's matrix (0-6). */
  lanesArmed: number;
  lanesTotal: 6;
  /** Age of the verdict, ms (0 when unprobed). */
  ageMs: number;
  region?: string;
  ms?: number;
  /** r709: transport truth carried from the probe (edge vs the direct Upstash dial). */
  transports?: CortexTransports;
  /** r710: per-lane booleans pass through so the HUD line can name HB ✓/✗. */
  lanes?: PersistedCortexProbe["lanes"];
  error?: string;
  /** Tone for chips: emerald online, amber armed-but-offline, muted unprobed. */
  tone: "online" | "offline" | "unprobed";
}

/** HUD-vocabulary status line, e.g. "CORTEX // ONLINE · 6/6 LANES · FRA1 · 34MS". */
export function cortexStatusLabel(c: CortexCensus, now = Date.now()): string {
  if (!c.probed) return "CORTEX // UNPROBED";
  const age = ageLabel(c.ageMs, now);
  // r709: transport truth — when the edge is off but the direct Upstash dial
  // was attempted, the line NAMES the transport (no-silent-fallback doctrine):
  // CORTEX // DIRECT · UPSTASH n/3, or EDGE OFF · UPSTASH 0/3 when none answered.
  const tr = c.transports;
  const direct =
    tr?.vector === "upstash-direct" || tr?.qstash === "upstash-direct" || tr?.box === "upstash-direct";
  if (direct && !c.region) {
    // r710: the Hyperbrowser direct auth verdict joins the line; the UPSTASH
    // count stays trio-only (lanesArmed includes HB when it answered).
    const hbTag =
      tr?.hyperbrowser === "direct"
        ? ` · HB ${c.lanes?.hyperbrowser ? "✓" : "✗"}`
        : "";
    const hbArmed = !!c.lanes?.hyperbrowser && tr?.hyperbrowser === "direct";
    const trio = Math.max(0, c.lanesArmed - (hbArmed ? 1 : 0));
    if (c.online) {
      return `CORTEX // DIRECT · UPSTASH ${trio}/3${hbTag}${c.ms != null ? ` · ${c.ms}MS` : ""} · ${age}`;
    }
    return `CORTEX // OFFLINE · EDGE OFF · UPSTASH ${trio}/3${hbTag} · ${
      age === "just now" ? "PROBED JUST NOW" : `PROBED ${age} AGO`
    }`;
  }
  const lanes = `${c.lanesArmed}/${c.lanesTotal} LANES`;
  const tail = c.online
    ? [lanes, c.region?.toUpperCase(), c.ms != null ? `${c.ms}MS` : null, age]
        .filter(Boolean)
        .join(" · ")
    : [lanes, `PROBED ${age} AGO`].join(" · ");
  return c.online ? `CORTEX // ONLINE · ${tail}` : `CORTEX // OFFLINE · ${tail}`;
}

/** Compact age label for HUD lines: just now / Nm / Nh / Nd. */
export function ageLabel(ageMs: number, now = Date.now()): string {
  if (ageMs < 0) return "just now";
  const m = Math.floor(ageMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Persist a probe verdict (never-throw, tolerant of private mode / quota). */
export function persistCortexProbe(p: PersistedCortexProbe): void {
  try {
    localStorage.setItem(CORTEX_PROBE_STORE, JSON.stringify(p));
  } catch {
    /* private mode / quota — the census simply stays at its previous verdict */
  }
}

/** Read the persisted verdict (tolerant: junk → null, never throws). */
export function readCortexProbe(): PersistedCortexProbe | null {
  try {
    const raw = localStorage.getItem(CORTEX_PROBE_STORE);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.at !== "number" || typeof v.ok !== "boolean" || typeof v.ms !== "number") {
      return null;
    }
    const out: PersistedCortexProbe = { at: v.at, ok: v.ok, ms: v.ms };
    if (typeof v.edgeRegion === "string") out.edgeRegion = v.edgeRegion;
    if (typeof v.error === "string") out.error = v.error;
    if (v.lanes && typeof v.lanes === "object") {
      const l = v.lanes as Record<string, unknown>;
      out.lanes = {
        hyperbrowser: l.hyperbrowser === true,
        redis: l.redis === true,
        vector: l.vector === true,
        qstash: l.qstash === true,
        box: l.box === true,
        sharedSecretGate: l.sharedSecretGate === true,
      };
    }
    if (v.transports && typeof v.transports === "object") {
      const t = v.transports as Record<string, unknown>;
      const pick = (x: unknown): CortexLaneTransport | undefined =>
        x === "edge" || x === "upstash-direct" || x === "off" ? x : undefined;
      const tr: CortexTransports = {};
      const hb = pick(t.hyperbrowser);
      const rd = pick(t.redis);
      const ve = pick(t.vector);
      const qs = pick(t.qstash);
      const bx = pick(t.box);
      if (hb) tr.hyperbrowser = hb;
      if (rd) tr.redis = rd;
      if (ve) tr.vector = ve;
      if (qs) tr.qstash = qs;
      if (bx) tr.box = bx;
      if (Object.keys(tr).length > 0) out.transports = tr;
    }
    return out;
  } catch {
    return null;
  }
}

/** Derive the census from a persisted verdict (null → honest unprobed). */
export function cortexCensusOf(p: PersistedCortexProbe | null, now = Date.now()): CortexCensus {
  if (!p) {
    return {
      probed: false,
      online: false,
      lanesArmed: 0,
      lanesTotal: 6,
      ageMs: 0,
      tone: "unprobed",
    };
  }
  const lanesArmed = p.lanes
    ? Object.values(p.lanes).filter(Boolean).length
    : 0;
  return {
    probed: true,
    online: p.ok,
    lanesArmed,
    lanesTotal: 6,
    ageMs: Math.max(0, now - p.at),
    ...(p.edgeRegion != null ? { region: p.edgeRegion } : {}),
    ...(p.ms != null ? { ms: p.ms } : {}),
    ...(p.error != null ? { error: p.error } : {}),
    ...(p.transports != null ? { transports: p.transports } : {}),
    ...(p.lanes != null ? { lanes: p.lanes } : {}),
    tone: p.ok ? "online" : "offline",
  };
}
